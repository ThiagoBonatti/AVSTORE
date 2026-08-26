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
    supplier: data.supplier || null,
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

      if (type === 'sale' && quantity > currentQty) {
        throw new HttpError(
          400,
          `Estoque insuficiente para ${variant.color} / ${size}. Disponivel: ${currentQty} unidade(s).`
        );
      }

      const newQty = type === 'purchase' ? currentQty + quantity : currentQty - quantity;
      const newVariants = variants.slice();
      newVariants[idx] = { ...variant, stock: { ...(variant.stock || {}), [size]: newQty } };
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
        totalPrice: Math.round(unitPrice * quantity * 100) / 100,
        supplier,
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
      const revertedQty = movement.type === 'purchase' ? currentQty - movement.quantity : currentQty + movement.quantity;

      if (revertedQty < 0) {
        throw new HttpError(
          400,
          `Nao e possivel cancelar: o estoque atual (${currentQty}) e menor do que a quantidade desta compra (${movement.quantity}) - parte dela ja foi vendida.`
        );
      }

      const newVariants = variants.slice();
      newVariants[idx] = { ...variant, stock: { ...(variant.stock || {}), [movement.size]: revertedQty } };
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
