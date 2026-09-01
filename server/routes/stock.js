const express = require('express');
const { db, FieldValue } = require('../firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const productsRef = db.collection('products');
const movementsRef = db.collection('stockMovements');

// Todas as rotas deste arquivo sao da area restrita (mini ERP de compras,
// vendas e estoque) e exigem um admin autenticado.
router.use(requireAuth);

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

// Erro com um status HTTP amarrado, para poder jogar de dentro de uma
// transacao do Firestore e ainda assim responder com o codigo certo.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function serializeProductForStock(doc) {
  const data = doc.data() || {};
  const variants = Array.isArray(data.variants) ? data.variants : [];
  return {
    code: doc.id,
    description: data.description,
    category: data.category,
    price: data.price,
    variants: variants.map((v) => ({
      id: v.id,
      color: v.color,
      sizes: Array.isArray(v.sizes) ? v.sizes : [],
      stock: v.stock || {},
      avgCost: v.avgCost || {},
      imageUrl: v.imageUrl || null,
    })),
  };
}

function serializeMovement(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    type: data.type,
    code: data.code,
    description: data.description,
    color: data.color,
    size: data.size,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    totalPrice: data.totalPrice,
    costAtSale: data.costAtSale ?? null,
    marginTotal: data.marginTotal ?? null,
    supplier: data.supplier || null,
    customer: data.customer || null,
    note: data.note || null,
    stockAfter: data.stockAfter,
    cancelled: Boolean(data.cancelled),
    createdByEmail: data.createdByEmail || null,
    createdAt: toIso(data.createdAt),
    cancelledAt: toIso(data.cancelledAt),
  };
}

// GET /api/stock/products - catalogo completo (com estoque por cor/tamanho)
// para alimentar os seletores de produto/cor/tamanho das telas de compra,
// venda e para a tabela de estoque atual. Diferente de GET /api/products
// (publico), aqui expomos a quantidade em estoque - informacao de negocio
// que nao deve aparecer na loja.
router.get('/products', async (req, res) => {
  try {
    const snapshot = await productsRef.orderBy('description').get();
    res.json({ items: snapshot.docs.map(serializeProductForStock) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar produtos para o estoque.' });
  }
});

// GET /api/stock/movements - historico de compras/vendas, mais recentes
// primeiro. Sem filtro por tipo/produto no servidor (evita depender de
// indices compostos no Firestore) - a tela filtra em memoria o lote
// carregado. "limit" cobre a maior parte do uso normal de uma loja pequena;
// use "before" (ISO de um createdAt ja carregado) para buscar movimentacoes
// mais antigas.
router.get('/movements', async (req, res) => {
  try {
    const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 150));
    let query = movementsRef.orderBy('createdAt', 'desc');
    if (req.query.before) {
      const beforeDate = new Date(req.query.before);
      if (!Number.isNaN(beforeDate.getTime())) query = query.startAfter(beforeDate);
    }
    const snapshot = await query.limit(limit).get();
    res.json({ items: snapshot.docs.map(serializeMovement) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar o historico de movimentacoes.' });
  }
});

// GET /api/stock/report?from=ISO&to=ISO - dados agregados para o dashboard
// (painel de vendas, compras e margem). Busca todas as movimentacoes com
// createdAt dentro do periodo (um unico filtro de intervalo, sem misturar
// com outro campo — nao exige indice composto no Firestore) e agrega tudo
// em memoria: totais, vendas por dia, por cliente e por produto.
router.get('/report', async (req, res) => {
  try {
    const now = new Date();
    const to = req.query.to ? new Date(req.query.to) : now;
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Periodo invalido.' });
    }

    const snapshot = await movementsRef
      .where('createdAt', '>=', from)
      .where('createdAt', '<=', to)
      .orderBy('createdAt', 'asc')
      .limit(5000)
      .get();

    const movements = snapshot.docs.map(serializeMovement).filter((m) => !m.cancelled);

    const totals = {
      salesAmount: 0,
      salesCost: 0,
      salesMargin: 0,
      purchasesAmount: 0,
      itemsSold: 0,
      salesCount: 0,
      purchasesCount: 0,
    };

    const byDayMap = new Map();
    const byCustomerMap = new Map();
    const byProductMap = new Map();

    function dayKey(iso) {
      return (iso || '').slice(0, 10);
    }
    function ensureDay(key) {
      if (!byDayMap.has(key)) byDayMap.set(key, { date: key, salesAmount: 0, purchasesAmount: 0 });
      return byDayMap.get(key);
    }

    for (const m of movements) {
      const day = ensureDay(dayKey(m.createdAt));

      if (m.type === 'sale') {
        const cost = m.costAtSale != null ? m.costAtSale * m.quantity : 0;
        const margin = m.marginTotal != null ? m.marginTotal : m.totalPrice - cost;

        totals.salesAmount += m.totalPrice;
        totals.salesCost += cost;
        totals.salesMargin += margin;
        totals.itemsSold += m.quantity;
        totals.salesCount += 1;
        day.salesAmount += m.totalPrice;

        const customerKey = m.customer && m.customer.name ? m.customer.name.trim().toLowerCase() : '__sem_cliente__';
        const customerName = m.customer && m.customer.name ? m.customer.name.trim() : 'Cliente nao identificado';
        if (!byCustomerMap.has(customerKey)) {
          byCustomerMap.set(customerKey, { key: customerKey, name: customerName, ordersCount: 0, itemsCount: 0, amount: 0, cost: 0, margin: 0 });
        }
        const custEntry = byCustomerMap.get(customerKey);
        custEntry.ordersCount += 1;
        custEntry.itemsCount += m.quantity;
        custEntry.amount += m.totalPrice;
        custEntry.cost += cost;
        custEntry.margin += margin;

        const prodKey = m.code;
        if (!byProductMap.has(prodKey)) {
          byProductMap.set(prodKey, { code: m.code, description: m.description, itemsCount: 0, amount: 0, cost: 0, margin: 0 });
        }
        const prodEntry = byProductMap.get(prodKey);
        prodEntry.itemsCount += m.quantity;
        prodEntry.amount += m.totalPrice;
        prodEntry.cost += cost;
        prodEntry.margin += margin;
      } else {
        totals.purchasesAmount += m.totalPrice;
        totals.purchasesCount += 1;
        day.purchasesAmount += m.totalPrice;
      }
    }

    const round2 = (n) => Math.round(n * 100) / 100;
    totals.salesAmount = round2(totals.salesAmount);
    totals.salesCost = round2(totals.salesCost);
    totals.salesMargin = round2(totals.salesMargin);
    totals.purchasesAmount = round2(totals.purchasesAmount);
    totals.marginPct = totals.salesAmount > 0 ? round2((totals.salesMargin / totals.salesAmount) * 100) : 0;
    totals.avgTicket = totals.salesCount > 0 ? round2(totals.salesAmount / totals.salesCount) : 0;

    const byDay = Array.from(byDayMap.values())
      .map((d) => ({ date: d.date, salesAmount: round2(d.salesAmount), purchasesAmount: round2(d.purchasesAmount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const byCustomer = Array.from(byCustomerMap.values())
      .map((c) => ({
        ...c,
        amount: round2(c.amount),
        cost: round2(c.cost),
        margin: round2(c.margin),
        marginPct: c.amount > 0 ? round2((c.margin / c.amount) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const byProduct = Array.from(byProductMap.values())
      .map((p) => ({
        ...p,
        amount: round2(p.amount),
        cost: round2(p.cost),
        margin: round2(p.margin),
        marginPct: p.amount > 0 ? round2((p.margin / p.amount) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals,
      byDay,
      byCustomer,
      byProduct,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar o relatorio.' });
  }
});

// POST /api/stock/movements - lanca uma compra (entrada) ou venda (saida)
// para uma cor/tamanho especifico de um produto ja cadastrado, atualizando
// o estoque daquela variacao de forma atomica (transacao do Firestore).
router.post('/movements', async (req, res) => {
  const { type, code, variantId, size } = req.body;
  const quantity = Number(req.body.quantity);
  const unitPrice = Number(req.body.unitPrice);
  const note = req.body.note ? String(req.body.note).trim() : null;

  const errors = [];
  if (type !== 'purchase' && type !== 'sale') errors.push('Tipo de movimentacao invalido.');
  if (!code) errors.push('Selecione um produto.');
  if (!variantId) errors.push('Selecione uma cor.');
  if (!size) errors.push('Selecione um tamanho.');
  if (!Number.isInteger(quantity) || quantity <= 0) errors.push('Informe uma quantidade valida (numero inteiro maior que zero).');
  if (Number.isNaN(unitPrice) || unitPrice < 0) {
    errors.push(type === 'purchase' ? 'Informe um custo unitario valido.' : 'Informe um preco unitario valido.');
  }

  let supplier = null;
  if (type === 'purchase' && req.body.supplier && String(req.body.supplier.name || '').trim()) {
    supplier = {
      name: String(req.body.supplier.name).trim(),
      contact: req.body.supplier.contact ? String(req.body.supplier.contact).trim() : '',
    };
  }

  let customer = null;
  if (type === 'sale' && req.body.customer && String(req.body.customer.name || '').trim()) {
    customer = {
      name: String(req.body.customer.name).trim(),
      contact: req.body.customer.contact ? String(req.body.customer.contact).trim() : '',
    };
  }

  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const docRef = productsRef.doc(code);

    const movement = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists) throw new HttpError(404, 'Produto nao encontrado.');

      const data = snap.data();
      const variants = Array.isArray(data.variants) ? data.variants : [];
      const idx = variants.findIndex((v) => v.id === variantId);
      if (idx < 0) throw new HttpError(404, 'Variacao (cor) nao encontrada para este produto.');

      const variant = variants[idx];
      if (!Array.isArray(variant.sizes) || !variant.sizes.includes(size)) {
        throw new HttpError(400, `O tamanho "${size}" nao existe para a cor "${variant.color}".`);
      }

      const currentQty = Number((variant.stock && variant.stock[size]) || 0);
      const currentAvgCost = Number((variant.avgCost && variant.avgCost[size]) || 0);

      if (type === 'sale' && quantity > currentQty) {
        throw new HttpError(
          400,
          `Estoque insuficiente para ${variant.color} / ${size}. Disponivel: ${currentQty} unidade(s).`
        );
      }

      const totalPrice = Math.round(unitPrice * quantity * 100) / 100;

      let newQty;
      let newAvgCost;
      let costAtSale = null;
      let marginTotal = null;

      if (type === 'purchase') {
        // Custo medio ponderado: mistura o custo do estoque que ja existia
        // com o custo desta compra, na proporcao das quantidades. E o que
        // permite calcular a margem de uma venda mesmo quando o produto foi
        // comprado em lotes com custos diferentes.
        newQty = currentQty + quantity;
        newAvgCost = newQty > 0 ? (currentAvgCost * currentQty + unitPrice * quantity) / newQty : 0;
      } else {
        newQty = currentQty - quantity;
        newAvgCost = currentAvgCost; // vender nao muda o custo medio do que sobrou
        costAtSale = currentAvgCost;
        marginTotal = Math.round((unitPrice - currentAvgCost) * quantity * 100) / 100;
      }

      const newVariants = variants.slice();
      newVariants[idx] = {
        ...variant,
        stock: { ...(variant.stock || {}), [size]: newQty },
        avgCost: { ...(variant.avgCost || {}), [size]: newAvgCost },
      };
      transaction.update(docRef, { variants: newVariants });

      const movementRef = movementsRef.doc();
      const movementData = {
        type,
        code,
        description: data.description,
        variantId,
        color: variant.color,
        size,
        quantity,
        unitPrice,
        totalPrice,
        costAtSale,
        marginTotal,
        supplier,
        customer,
        note,
        stockAfter: newQty,
        cancelled: false,
        cancelledAt: null,
        createdByEmail: req.admin.email,
        createdAt: FieldValue.serverTimestamp(),
      };
      transaction.set(movementRef, movementData);

      return { id: movementRef.id, ...movementData, createdAt: new Date().toISOString() };
    });

    res.status(201).json(movement);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar a movimentacao.' });
  }
});

// DELETE /api/stock/movements/:id - cancela (estorna) uma movimentacao,
// revertendo seu efeito no estoque. Nao apaga o registro: mantem para o
// historico, apenas marcado como cancelado.
router.delete('/movements/:id', async (req, res) => {
  try {
    const movementRef = movementsRef.doc(req.params.id);

    const result = await db.runTransaction(async (transaction) => {
      const movementSnap = await transaction.get(movementRef);
      if (!movementSnap.exists) throw new HttpError(404, 'Movimentacao nao encontrada.');

      const movement = movementSnap.data();
      if (movement.cancelled) throw new HttpError(400, 'Esta movimentacao ja foi cancelada.');

      const docRef = productsRef.doc(movement.code);
      const productSnap = await transaction.get(docRef);
      if (!productSnap.exists) {
        throw new HttpError(400, 'O produto desta movimentacao nao existe mais. Ajuste o estoque manualmente.');
      }

      const data = productSnap.data();
      const variants = Array.isArray(data.variants) ? data.variants : [];
      const idx = variants.findIndex((v) => v.id === movement.variantId);
      if (idx < 0) {
        throw new HttpError(400, 'A cor desta movimentacao nao existe mais no produto. Ajuste o estoque manualmente.');
      }

      const variant = variants[idx];
      const currentQty = Number((variant.stock && variant.stock[movement.size]) || 0);
      const currentAvgCost = Number((variant.avgCost && variant.avgCost[movement.size]) || 0);
      const revertedQty = movement.type === 'purchase' ? currentQty - movement.quantity : currentQty + movement.quantity;

      if (revertedQty < 0) {
        throw new HttpError(
          400,
          `Nao e possivel cancelar: o estoque atual (${currentQty}) e menor do que a quantidade desta compra (${movement.quantity}) - parte dela ja foi vendida.`
        );
      }

      // Ao cancelar uma compra, tenta "tirar" a contribuicao dela do custo
      // medio ponderado (aproximado - se ja houve outras compras/vendas
      // depois desta, o resultado e uma aproximacao razoavel, nao um estorno
      // contabil exato). Cancelar uma venda so devolve a quantidade: o custo
      // medio do que ja estava em estoque nao muda.
      let revertedAvgCost = currentAvgCost;
      if (movement.type === 'purchase') {
        const totalCostValue = currentAvgCost * currentQty;
        const reducedCostValue = totalCostValue - movement.unitPrice * movement.quantity;
        revertedAvgCost = revertedQty > 0 ? Math.max(0, reducedCostValue / revertedQty) : 0;
      }

      const newVariants = variants.slice();
      newVariants[idx] = {
        ...variant,
        stock: { ...(variant.stock || {}), [movement.size]: revertedQty },
        avgCost: { ...(variant.avgCost || {}), [movement.size]: revertedAvgCost },
      };
      transaction.update(docRef, { variants: newVariants });
      transaction.update(movementRef, { cancelled: true, cancelledAt: FieldValue.serverTimestamp() });

      return { id: movementRef.id, revertedQty };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar a movimentacao.' });
  }
});

module.exports = router;
