const express = require('express');
const { db, FieldValue } = require('../firebase');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { uploadProductImage, deleteProductImage } = require('../storage');
const { buildSearchKeywords, normalize } = require('../searchKeywords');

const router = express.Router();
const productsRef = db.collection('products');
const filtersDocRef = db.collection('meta').doc('catalog');

// O codigo do produto e usado como ID do documento no Firestore, entao ele
// garante unicidade automaticamente (docRef.create() falha se ja existir) e
// nao pode conter "/" (separador de caminho de documentos).
const CODE_PATTERN = /^[A-Za-z0-9._-]+$/;

function serializeProduct(doc) {
  const data = doc.data() || {};
  return {
    code: doc.id,
    description: data.description,
    category: data.category,
    color: data.color,
    size: data.size,
    price: data.price,
    imageUrl: data.imageUrl || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

function validateFields(body, { partial = false } = {}) {
  const required = ['code', 'description', 'category', 'color', 'size', 'price'];
  const errors = [];

  for (const field of required) {
    if (partial && body[field] === undefined) continue;
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      errors.push(`O campo "${field}" e obrigatorio.`);
    }
  }

  if (body.code && !CODE_PATTERN.test(String(body.code).trim())) {
    errors.push('O codigo deve conter apenas letras, numeros, ponto, hifen ou underscore.');
  }
  if (body.price !== undefined && body.price !== '' && Number.isNaN(Number(body.price))) {
    errors.push('O campo "price" deve ser um numero valido.');
  }
  if (body.price !== undefined && Number(body.price) < 0) {
    errors.push('O campo "price" nao pode ser negativo.');
  }

  return errors;
}

async function updateFiltersMeta(category, color) {
  await filtersDocRef.set(
    {
      categories: FieldValue.arrayUnion(category),
      colors: FieldValue.arrayUnion(color),
    },
    { merge: true }
  );
}

function isAlreadyExists(err) {
  return err && (err.code === 6 || err.code === 'already-exists' || /ALREADY_EXISTS/i.test(err.message || ''));
}

// -------------------- ROTAS PUBLICAS --------------------

// GET /api/products/filters - valores distintos de categoria/cor ja usados
// (mantidos em meta/catalog via arrayUnion a cada criacao/edicao, pois o
// Firestore nao possui um "SELECT DISTINCT" nativo). Precisa vir ANTES da
// rota "/:code" para nao ser interpretada como um codigo de produto.
router.get('/filters', async (req, res) => {
  try {
    const snap = await filtersDocRef.get();
    const data = snap.exists ? snap.data() : {};
    res.json({
      categories: (data.categories || []).slice().sort(),
      colors: (data.colors || []).slice().sort(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar filtros.' });
  }
});

// GET /api/products - lista publica com paginacao por cursor e filtros
// por categoria/cor. Quando "search" e informado, faz uma busca por
// prefixo (ver server/searchKeywords.js) e retorna um unico lote de ate
// 50 resultados (sem paginacao por cursor nesse modo).
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const search = normalize(req.query.search || '').trim();

    if (search) {
      const snapshot = await productsRef.where('searchKeywords', 'array-contains', search).limit(50).get();
      let items = snapshot.docs.map(serializeProduct);
      if (req.query.category) items = items.filter((p) => p.category === req.query.category);
      if (req.query.color) items = items.filter((p) => p.color === req.query.color);
      items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return res.json({ items, limit, hasMore: false, nextCursor: null });
    }

    let query = productsRef;
    if (req.query.category) query = query.where('category', '==', req.query.category);
    if (req.query.color) query = query.where('color', '==', req.query.color);
    query = query.orderBy('createdAt', 'desc');

    if (req.query.cursor) {
      const cursorSnap = await productsRef.doc(req.query.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snapshot = await query.limit(limit + 1).get();
    const hasMore = snapshot.docs.length > limit;
    const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

    res.json({
      items: docs.map(serializeProduct),
      limit,
      hasMore,
      nextCursor: hasMore ? docs[docs.length - 1].id : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
});

// GET /api/products/:code - detalhe de um produto
router.get('/:code', async (req, res) => {
  try {
    const doc = await productsRef.doc(req.params.code).get();
    if (!doc.exists) return res.status(404).json({ error: 'Produto nao encontrado.' });
    res.json(serializeProduct(doc));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar produto.' });
  }
});

// -------------------- ROTAS ADMINISTRATIVAS (protegidas) --------------------

// POST /api/products - cria um novo produto
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  const errors = validateFields(req.body);
  if (!req.file) errors.push('A imagem do produto e obrigatoria.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const code = String(req.body.code).trim();
  const description = req.body.description.trim();
  const category = req.body.category.trim();
  const color = req.body.color.trim();
  const size = req.body.size.trim();
  const price = Number(req.body.price);

  let uploadedImage = null;

  try {
    uploadedImage = await uploadProductImage(code, req.file);

    try {
      await productsRef.doc(code).create({
        description,
        category,
        color,
        size,
        price,
        imageUrl: uploadedImage.url,
        imagePath: uploadedImage.storagePath,
        searchKeywords: buildSearchKeywords(code, description),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await deleteProductImage(uploadedImage.storagePath);
      if (isAlreadyExists(err)) {
        return res.status(409).json({ error: `Ja existe um produto com o codigo "${code}".` });
      }
      throw err;
    }

    await updateFiltersMeta(category, color);

    const created = await productsRef.doc(code).get();
    res.status(201).json(serializeProduct(created));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// PUT /api/products/:code - atualiza um produto existente (imagem opcional).
// O codigo (ID do documento) nao pode ser alterado nesta rota.
router.put('/:code', requireAuth, upload.single('image'), async (req, res) => {
  const code = req.params.code;
  const docRef = productsRef.doc(code);

  try {
    const existingSnap = await docRef.get();
    if (!existingSnap.exists) {
      return res.status(404).json({ error: 'Produto nao encontrado.' });
    }

    const errors = validateFields(req.body, { partial: true });
    if (req.body.code !== undefined && String(req.body.code).trim() !== code) {
      errors.push('Nao e permitido alterar o codigo de um produto existente.');
    }
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const existing = existingSnap.data();
    const description = req.body.description !== undefined ? req.body.description.trim() : existing.description;
    const category = req.body.category !== undefined ? req.body.category.trim() : existing.category;
    const color = req.body.color !== undefined ? req.body.color.trim() : existing.color;
    const size = req.body.size !== undefined ? req.body.size.trim() : existing.size;
    const price = req.body.price !== undefined ? Number(req.body.price) : existing.price;

    const updates = {
      description,
      category,
      color,
      size,
      price,
      searchKeywords: buildSearchKeywords(code, description),
      updatedAt: FieldValue.serverTimestamp(),
    };

    let uploadedImage = null;
    if (req.file) {
      uploadedImage = await uploadProductImage(code, req.file);
      updates.imageUrl = uploadedImage.url;
      updates.imagePath = uploadedImage.storagePath;
    }

    try {
      await docRef.update(updates);
    } catch (err) {
      if (uploadedImage) await deleteProductImage(uploadedImage.storagePath);
      throw err;
    }

    if (uploadedImage && existing.imagePath) {
      await deleteProductImage(existing.imagePath);
    }

    await updateFiltersMeta(category, color);

    const updated = await docRef.get();
    res.json(serializeProduct(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
});

// DELETE /api/products/:code - remove um produto e sua imagem
router.delete('/:code', requireAuth, async (req, res) => {
  try {
    const docRef = productsRef.doc(req.params.code);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Produto nao encontrado.' });

    const data = snap.data();
    await docRef.delete();
    await deleteProductImage(data.imagePath);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

module.exports = router;
