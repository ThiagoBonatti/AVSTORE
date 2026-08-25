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

// Cada produto pode ter varias variacoes (cores), e cada variacao pode ter
// varios tamanhos e sua propria imagem. O campo de arquivo de cada variacao
// vem do formulario com o nome "variantImage_<id>" (ver public/admin/js/admin.js).
function variantImageFieldName(variantId) {
  return `variantImage_${variantId}`;
}

function serializeProduct(doc) {
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
      imageUrl: v.imageUrl || null,
    })),
    colors: Array.isArray(data.colors) ? data.colors : [],
    sizes: Array.isArray(data.sizes) ? data.sizes : [],
    // Mantidos por compatibilidade com quem ainda espera uma imagem/cor
    // unica no topo do objeto (ex.: thumbnail da primeira variacao).
    imageUrl: variants[0]?.imageUrl || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

function validateBaseFields(body, { partial = false } = {}) {
  const required = ['code', 'description', 'category', 'price'];
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

// Analisa o campo "variants" (JSON enviado pelo formulario) e retorna a
// lista de variacoes ja validada, ou lanca um erro com a mensagem a exibir.
function parseVariants(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('Nao foi possivel interpretar as variacoes de cor/tamanho enviadas.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Cadastre ao menos uma variacao de cor.');
  }

  const seenColors = new Set();
  const variants = [];

  for (const raw_v of parsed) {
    const id = String(raw_v.id || '').trim();
    const color = String(raw_v.color || '').trim();
    const sizes = Array.isArray(raw_v.sizes)
      ? raw_v.sizes.map((s) => String(s).trim()).filter(Boolean)
      : [];

    if (!id) throw new Error('Variacao invalida (identificador ausente).');
    if (!color) throw new Error('Informe a cor de todas as variacoes cadastradas.');
    if (sizes.length === 0) throw new Error(`Informe ao menos um tamanho para a cor "${color}".`);

    const colorKey = normalize(color);
    if (seenColors.has(colorKey)) throw new Error(`A cor "${color}" foi informada mais de uma vez.`);
    seenColors.add(colorKey);

    variants.push({ id, color, sizes });
  }

  return variants;
}

function filesByFieldName(files) {
  const map = new Map();
  for (const file of files || []) map.set(file.fieldname, file);
  return map;
}

async function updateFiltersMeta(category, colors) {
  const uniqueColors = [...new Set((colors || []).filter(Boolean))];
  if (uniqueColors.length === 0) {
    await filtersDocRef.set({ categories: FieldValue.arrayUnion(category) }, { merge: true });
    return;
  }
  await filtersDocRef.set(
    {
      categories: FieldValue.arrayUnion(category),
      colors: FieldValue.arrayUnion(...uniqueColors),
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
      if (req.query.color) items = items.filter((p) => p.colors.includes(req.query.color));
      items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return res.json({ items, limit, hasMore: false, nextCursor: null });
    }

    let query = productsRef;
    if (req.query.category) query = query.where('category', '==', req.query.category);
    // "colors" e um array com as cores de todas as variacoes do produto,
    // mantido junto de "variants" para permitir esse filtro (o Firestore
    // nao consegue fazer array-contains dentro de um array de objetos).
    if (req.query.color) query = query.where('colors', 'array-contains', req.query.color);
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

// POST /api/products - cria um novo produto com uma ou mais variacoes de
// cor/tamanho, cada uma com sua propria imagem.
router.post('/', requireAuth, upload.any(), async (req, res) => {
  const errors = validateBaseFields(req.body);

  let variants;
  try {
    variants = parseVariants(req.body.variants);
  } catch (err) {
    errors.push(err.message);
  }

  if (variants) {
    const filesMap = filesByFieldName(req.files);
    for (const v of variants) {
      if (!filesMap.has(variantImageFieldName(v.id))) {
        errors.push(`Envie uma imagem para a cor "${v.color}".`);
      }
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const code = String(req.body.code).trim();
  const description = req.body.description.trim();
  const category = req.body.category.trim();
  const price = Number(req.body.price);
  const filesMap = filesByFieldName(req.files);

  const uploaded = [];

  try {
    for (const v of variants) {
      const file = filesMap.get(variantImageFieldName(v.id));
      const { url, storagePath } = await uploadProductImage(code, v.id, file);
      uploaded.push({ storagePath });
      v.imageUrl = url;
      v.imagePath = storagePath;
    }

    const colors = variants.map((v) => v.color);
    const sizes = [...new Set(variants.flatMap((v) => v.sizes))];

    try {
      await productsRef.doc(code).create({
        description,
        category,
        price,
        variants,
        colors,
        sizes,
        searchKeywords: buildSearchKeywords(code, description),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await Promise.all(uploaded.map((u) => deleteProductImage(u.storagePath)));
      if (isAlreadyExists(err)) {
        return res.status(409).json({ error: `Ja existe um produto com o codigo "${code}".` });
      }
      throw err;
    }

    await updateFiltersMeta(category, colors);

    const created = await productsRef.doc(code).get();
    res.status(201).json(serializeProduct(created));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// PUT /api/products/:code - atualiza um produto existente. A lista de
// variacoes enviada substitui a lista anterior por completo: variacoes sem
// um arquivo novo mantem a imagem ja existente (casadas pelo "id"); as que
// deixarem de ser enviadas tem sua imagem removida do Storage.
router.put('/:code', requireAuth, upload.any(), async (req, res) => {
  const code = req.params.code;
  const docRef = productsRef.doc(code);

  try {
    const existingSnap = await docRef.get();
    if (!existingSnap.exists) {
      return res.status(404).json({ error: 'Produto nao encontrado.' });
    }
    const existing = existingSnap.data();
    const existingVariants = Array.isArray(existing.variants) ? existing.variants : [];
    const existingById = new Map(existingVariants.map((v) => [v.id, v]));

    const errors = validateBaseFields(req.body, { partial: true });
    if (req.body.code !== undefined && String(req.body.code).trim() !== code) {
      errors.push('Nao e permitido alterar o codigo de um produto existente.');
    }

    let variants = null;
    if (req.body.variants !== undefined) {
      try {
        variants = parseVariants(req.body.variants);
      } catch (err) {
        errors.push(err.message);
      }
    }

    const filesMap = filesByFieldName(req.files);
    if (variants) {
      for (const v of variants) {
        const hasNewFile = filesMap.has(variantImageFieldName(v.id));
        const hasExistingImage = existingById.has(v.id);
        if (!hasNewFile && !hasExistingImage) {
          errors.push(`Envie uma imagem para a cor "${v.color}".`);
        }
      }
    }

    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const description = req.body.description !== undefined ? req.body.description.trim() : existing.description;
    const category = req.body.category !== undefined ? req.body.category.trim() : existing.category;
    const price = req.body.price !== undefined ? Number(req.body.price) : existing.price;

    const uploaded = [];
    const finalVariants = [];

    if (variants) {
      for (const v of variants) {
        const file = filesMap.get(variantImageFieldName(v.id));
        if (file) {
          const { url, storagePath } = await uploadProductImage(code, v.id, file);
          uploaded.push({ storagePath });
          finalVariants.push({ id: v.id, color: v.color, sizes: v.sizes, imageUrl: url, imagePath: storagePath });
        } else {
          const prev = existingById.get(v.id);
          finalVariants.push({
            id: v.id,
            color: v.color,
            sizes: v.sizes,
            imageUrl: prev.imageUrl,
            imagePath: prev.imagePath,
          });
        }
      }
    }

    const colors = finalVariants.length ? finalVariants.map((v) => v.color) : existing.colors || [];
    const sizes = finalVariants.length
      ? [...new Set(finalVariants.flatMap((v) => v.sizes))]
      : existing.sizes || [];

    const updates = {
      description,
      category,
      price,
      searchKeywords: buildSearchKeywords(code, description),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (finalVariants.length) {
      updates.variants = finalVariants;
      updates.colors = colors;
      updates.sizes = sizes;
    }

    try {
      await docRef.update(updates);
    } catch (err) {
      await Promise.all(uploaded.map((u) => deleteProductImage(u.storagePath)));
      throw err;
    }

    // Remove do Storage as imagens de variacoes que existiam antes e nao
    // estao mais na lista enviada (cor removida do produto), ou que foram
    // substituidas por uma imagem nova.
    if (finalVariants.length) {
      const finalById = new Map(finalVariants.map((v) => [v.id, v]));
      const toDelete = [];
      for (const prev of existingVariants) {
        const current = finalById.get(prev.id);
        if (!current || current.imagePath !== prev.imagePath) {
          if (prev.imagePath) toDelete.push(prev.imagePath);
        }
      }
      await Promise.all(toDelete.map((p) => deleteProductImage(p)));
    }

    await updateFiltersMeta(category, colors);

    const updated = await docRef.get();
    res.json(serializeProduct(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
});

// DELETE /api/products/:code - remove um produto e as imagens de todas as
// suas variacoes de cor.
router.delete('/:code', requireAuth, async (req, res) => {
  try {
    const docRef = productsRef.doc(req.params.code);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Produto nao encontrado.' });

    const data = snap.data();
    await docRef.delete();

    const variants = Array.isArray(data.variants) ? data.variants : [];
    await Promise.all(variants.map((v) => deleteProductImage(v.imagePath)));

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

module.exports = router;
