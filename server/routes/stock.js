const express = require('express');
const { db, FieldValue } = require('../firebase');
const { requireAuth } = require('../middleware/auth');
const { uploadSheet } = require('../middleware/uploadSheet');
const { buildSearchKeywords } = require('../searchKeywords');
const { parseWorkbookRows, buildImportPreview } = require('../importCatalog');

const router = express.Router();
const productsRef = db.collection('products');
const movementsRef = db.collection('stockMovements');
const filtersDocRef = db.collection('meta').doc('catalog');

// Mesmo padrao de server/routes/products.js: o codigo do produto vira o ID
// do documento no Firestore.
const CODE_PATTERN = /^[A-Za-z0-9._-]+$/;

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
    nf: data.nf || null,
    invoiceDate: data.invoiceDate || null,
    freightShare: data.freightShare ?? null,
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

// Executa uma transacao de compra ou venda para uma cor/tamanho especifico
// de um produto ja cadastrado, atualizando o estoque (e o custo medio
// ponderado) de forma atomica. Extraido para uma funcao a parte porque e
// usado tanto pelo lancamento manual (POST /movements abaixo) quanto pela
// importacao em lote de nota de compra (POST /import/commit, mais abaixo),
// que precisa lancar varias compras seguidas com a mesma logica exata.
async function runStockMovementTransaction({
  type,
  code,
  variantId,
  size,
  quantity,
  unitPrice,
  note = null,
  supplier = null,
  customer = null,
  nf = null,
  invoiceDate = null,
  freightShare = null,
  createdByEmail,
}) {
  const docRef = productsRef.doc(code);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists) throw new HttpError(404, `Produto "${code}" nao encontrado.`);

    const data = snap.data();
    const variants = Array.isArray(data.variants) ? data.variants : [];
    const idx = variants.findIndex((v) => v.id === variantId);
    if (idx < 0) throw new HttpError(404, `Variacao (cor) nao encontrada para o produto "${code}".`);

    const variant = variants[idx];
    if (!Array.isArray(variant.sizes) || !variant.sizes.includes(size)) {
      throw new HttpError(400, `O tamanho "${size}" nao existe para a cor "${variant.color}" (produto ${code}).`);
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
      nf,
      invoiceDate,
      freightShare,
      stockAfter: newQty,
      cancelled: false,
      cancelledAt: null,
      createdByEmail,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.set(movementRef, movementData);

    return { id: movementRef.id, ...movementData, createdAt: new Date().toISOString() };
  });
}

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
    const movement = await runStockMovementTransaction({
      type,
      code,
      variantId,
      size,
      quantity,
      unitPrice,
      note,
      supplier,
      customer,
      createdByEmail: req.admin.email,
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

// -------------------- Importacao de nota de compra / planilha --------------------
// Fluxo em duas etapas:
//   1) POST /import/preview - le a planilha (.xlsx) enviada, casa cada
//      "Codigo" com o catalogo ja cadastrado (nao registra nada em duplicado)
//      e propõe os produtos novos agrupados por cor/tamanho. Nao grava nada.
//   2) POST /import/commit - recebe de volta a mesma estrutura (ja revisada/
//      editada pelo admin na tela) e efetivamente cria os produtos novos e
//      lanca as compras. Tambem e o endpoint usado pela tela de "Nota de
//      compra" para lancamento manual (sem planilha): nesse caso so ha linhas
//      "existing" e nenhum produto novo.
//
// O rateio do frete e calculado no navegador (public/admin/js/nota-compra.js)
// sobre TODAS as linhas da nota de uma vez só, e cada linha ja chega aqui com
// o valor de "freightShare" (parte do frete) decidido. Isso evita recalcular
// o rateio si a nota for reenviada parcialmente apos uma falha (ver abaixo) -
// cada linha ja carrega seu proprio valor final, entao reenviar so o que
// faltou nao aplica o frete errado.

async function buildExistingCatalogIndex() {
  const snapshot = await productsRef.get();
  const existingItemCodeIndex = new Map();
  const existingProductCodes = new Set();

  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    existingProductCodes.add(doc.id);
    const variants = Array.isArray(data.variants) ? data.variants : [];
    variants.forEach((v) => {
      const itemCodes = v.itemCodes && typeof v.itemCodes === 'object' ? v.itemCodes : {};
      Object.entries(itemCodes).forEach(([size, code]) => {
        const key = String(code || '').trim();
        if (!key) return;
        existingItemCodeIndex.set(key, {
          kind: 'existing',
          code: doc.id,
          description: data.description,
          variantId: v.id,
          color: v.color,
          size,
        });
      });
    });
  });

  return { existingItemCodeIndex, existingProductCodes };
}

// Mesma logica de server/routes/products.js (nao exportada de la), usada
// aqui para manter a lista de categorias/cores em meta/catalog em dia quando
// a importacao cria produtos novos.
async function updateFiltersMeta(category, colors) {
  const uniqueColors = [...new Set((colors || []).filter(Boolean))];
  if (uniqueColors.length === 0) {
    await filtersDocRef.set({ categories: FieldValue.arrayUnion(category) }, { merge: true });
    return;
  }
  await filtersDocRef.set(
    { categories: FieldValue.arrayUnion(category), colors: FieldValue.arrayUnion(...uniqueColors) },
    { merge: true }
  );
}

// POST /api/stock/import/preview - le a planilha enviada e devolve a previa
// (nao grava nada no banco).
router.post('/import/preview', uploadSheet.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie um arquivo .xlsx.' });

  try {
    const { sheetName, rows } = parseWorkbookRows(req.file.buffer);
    const { existingItemCodeIndex, existingProductCodes } = await buildExistingCatalogIndex();
    const preview = buildImportPreview({ rows, existingItemCodeIndex, existingProductCodes });
    res.json({ sheetName, ...preview });
  } catch (err) {
    if (err && err.message) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar a planilha.' });
  }
});

// POST /api/stock/import/commit - cria os produtos novos (em lote, tudo ou
// nada) e depois lanca as compras uma a uma. Cada linha ja chega com
// "unitCost" (custo original) e "freightShare" (parte do frete ja calculada
// no navegador) - o custo final lançado e unitCost + freightShare/quantidade.
router.post('/import/commit', async (req, res) => {
  const body = req.body || {};
  const rawNewProducts = Array.isArray(body.newProducts) ? body.newProducts : [];
  const rawPurchaseLines = Array.isArray(body.purchaseLines) ? body.purchaseLines : [];

  const productsToCreate = rawNewProducts.filter((p) => p && p.include !== false);
  const linesToPost = rawPurchaseLines.filter((l) => l && l.include !== false);

  if (linesToPost.length === 0) {
    return res.status(400).json({ error: 'Nenhum item para lancar. Adicione ao menos um item a nota.' });
  }

  const { existingProductCodes } = await buildExistingCatalogIndex();
  const errors = [];
  const seenNewCodes = new Set();
  const productsByTempId = new Map();

  productsToCreate.forEach((p, i) => {
    const tempId = String((p && p.tempId) || '').trim();
    const code = String((p && p.code) || '').trim();
    const description = String((p && p.description) || '').trim();
    const category = String((p && p.category) || '').trim();
    const price = Number(p && p.price);
    const variants = Array.isArray(p && p.variants) ? p.variants : [];
    const label = description || code || `#${i + 1}`;

    if (!tempId) errors.push(`Produto novo "${label}" sem identificador interno (recarregue a previa).`);
    if (!code || !CODE_PATTERN.test(code)) {
      errors.push(`Codigo invalido para "${label}" (use letras, numeros, ponto, hifen ou underscore).`);
    } else if (existingProductCodes.has(code) || seenNewCodes.has(code)) {
      errors.push(`O codigo de produto "${code}" ja esta em uso. Escolha outro para "${label}".`);
    } else {
      seenNewCodes.add(code);
    }
    if (!description) errors.push(`Informe a descricao do produto "${label}".`);
    if (!category) errors.push(`Informe a categoria do produto "${label}".`);
    if (!Number.isFinite(price) || price < 0) errors.push(`Informe um preco de venda valido para "${label}".`);
    if (variants.length === 0) errors.push(`O produto "${label}" ficou sem nenhuma cor/tamanho.`);

    const cleanVariants = variants.map((v, vi) => ({
      id: String((v && v.id) || `v${vi + 1}`).trim(),
      color: String((v && v.color) || '').trim(),
      sizes: Array.isArray(v && v.sizes) ? v.sizes.map((s) => String(s).trim()).filter(Boolean) : [],
      itemCodes: v && v.itemCodes && typeof v.itemCodes === 'object' ? v.itemCodes : {},
    }));

    if (tempId) productsByTempId.set(tempId, { tempId, code, description, category, price, variants: cleanVariants });
  });

  linesToPost.forEach((line) => {
    const label = `Linha ${line && line.rowNumber ? line.rowNumber : '?'}`;
    const quantity = Number(line && line.quantity);
    const unitCost = Number(line && line.unitCost);
    const freightShare = Number((line && line.freightShare) || 0);

    if (!Number.isInteger(quantity) || quantity <= 0) errors.push(`${label}: quantidade invalida.`);
    if (!Number.isFinite(unitCost) || unitCost < 0) errors.push(`${label}: custo unitario invalido.`);
    if (!Number.isFinite(freightShare) || freightShare < 0) errors.push(`${label}: rateio de frete invalido.`);

    if (!line || (line.kind !== 'existing' && line.kind !== 'new')) {
      errors.push(`${label}: tipo de item invalido.`);
    } else if (line.kind === 'existing') {
      if (!line.productCode || !line.variantId || !line.size) errors.push(`${label}: item existente sem produto/cor/tamanho.`);
    } else if (line.kind === 'new') {
      if (!line.tempId || !productsByTempId.has(String(line.tempId))) {
        errors.push(`${label}: produto novo associado nao foi encontrado (talvez tenha sido removido da revisao).`);
      } else if (!line.variantId || !line.size) {
        errors.push(`${label}: item novo sem cor/tamanho.`);
      }
    }
  });

  if (errors.length) {
    return res.status(400).json({ error: errors.slice(0, 15).join(' '), errors });
  }

  // -------- Cria os produtos novos, todos de uma vez (lote atomico) --------
  const productsList = Array.from(productsByTempId.values());
  try {
    if (productsList.length) {
      const batch = db.batch();
      const filtersToUpdate = [];

      for (const p of productsList) {
        const variants = p.variants.map((v) => ({
          id: v.id,
          color: v.color,
          sizes: v.sizes,
          itemCodes: v.itemCodes,
          imageUrl: null,
          imagePath: null,
          stock: Object.fromEntries(v.sizes.map((s) => [s, 0])),
          avgCost: Object.fromEntries(v.sizes.map((s) => [s, 0])),
        }));
        const colors = variants.map((v) => v.color);
        const sizes = [...new Set(variants.flatMap((v) => v.sizes))];
        filtersToUpdate.push({ category: p.category, colors });

        batch.create(productsRef.doc(p.code), {
          description: p.description,
          category: p.category,
          price: p.price,
          variants,
          colors,
          sizes,
          searchKeywords: buildSearchKeywords(p.code, p.description),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
      await Promise.all(filtersToUpdate.map((f) => updateFiltersMeta(f.category, f.colors)));
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Erro ao criar os produtos novos - nenhum item desta nota foi lancado. Verifique os codigos e tente novamente.',
    });
  }

  // -------- Lanca as compras, uma a uma (cada uma e sua propria transacao) --------
  const round2 = (n) => Math.round(n * 100) / 100;
  const posted = [];
  let failure = null;

  for (const line of linesToPost) {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    const freightShare = Number(line.freightShare || 0);
    const adjustedUnitCost = round2(unitCost + freightShare / quantity);

    const productCode = line.kind === 'new' ? productsByTempId.get(String(line.tempId)).code : line.productCode;
    const supplier = line.fornecedor && String(line.fornecedor).trim()
      ? { name: String(line.fornecedor).trim(), contact: '' }
      : null;

    try {
      // eslint-disable-next-line no-await-in-loop
      const movement = await runStockMovementTransaction({
        type: 'purchase',
        code: productCode,
        variantId: line.variantId,
        size: line.size,
        quantity,
        unitPrice: adjustedUnitCost,
        note: line.nf ? `Nota de compra (NF ${line.nf}).` : 'Nota de compra.',
        supplier,
        nf: line.nf || null,
        invoiceDate: line.dataNF || null,
        freightShare,
        createdByEmail: req.admin.email,
      });
      posted.push({ rowNumber: line.rowNumber, movementId: movement.id });
    } catch (err) {
      failure = { rowNumber: line.rowNumber, error: err instanceof HttpError ? err.message : 'Erro ao lancar esta linha.' };
      break;
    }
  }

  const totalFreightApplied = posted.length
    ? round2(
        linesToPost
          .filter((l) => posted.some((p) => p.rowNumber === l.rowNumber))
          .reduce((sum, l) => sum + Number(l.freightShare || 0), 0)
      )
    : 0;

  const summary = {
    productsCreated: productsList.length,
    movementsCreated: posted.length,
    totalLines: linesToPost.length,
    totalFreightApplied,
    postedRowNumbers: posted.map((p) => p.rowNumber),
  };

  if (failure) {
    return res.status(207).json({
      partial: true,
      summary,
      failure,
      error:
        `Foram lancadas ${posted.length} de ${linesToPost.length} linha(s) antes de um erro na linha ${failure.rowNumber} ` +
        `(${failure.error}). Os produtos novos ja foram criados. Corrija o problema e reenvie so as linhas restantes.`,
    });
  }

  res.status(201).json({ ok: true, summary });
});

module.exports = router;
