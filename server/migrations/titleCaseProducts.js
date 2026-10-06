// Padroniza o nome (campo "description") de TODOS os produtos com iniciais
// maiusculas ("CAMISETA BASICA" -> "Camiseta Basica") e atualiza tambem as
// copias do nome gravadas nas movimentacoes de estoque (stockMovements).
// E idempotente: rodar de novo nao altera nada que ja esteja padronizado.
const { db, FieldValue } = require('../firebase');
const { toTitleCase } = require('../textFormat');
const { buildSearchKeywords } = require('../searchKeywords');

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
}

async function titleCaseProducts({ apply = false, log = console.log } = {}) {
  const products = await db.collection('products').get();
  const productOps = [];
  const newNameByCode = new Map();

  products.forEach((doc) => {
    const current = doc.data().description || '';
    const fixed = toTitleCase(current);
    newNameByCode.set(doc.id, fixed);
    if (fixed && fixed !== current) {
      log(`${doc.id}: "${current}" -> "${fixed}"`);
      productOps.push({
        ref: doc.ref,
        data: {
          description: fixed,
          searchKeywords: buildSearchKeywords(doc.id, fixed),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  });

  const movements = await db.collection('stockMovements').get();
  const movementOps = [];
  movements.forEach((doc) => {
    const m = doc.data();
    if (!m.description) return;
    const fixed = newNameByCode.get(m.code) || toTitleCase(m.description);
    if (fixed && fixed !== m.description) movementOps.push({ ref: doc.ref, data: { description: fixed } });
  });

  if (apply) {
    await commitInChunks(productOps);
    await commitInChunks(movementOps);
  }

  return {
    products: products.size,
    productsChanged: productOps.length,
    movements: movements.size,
    movementsChanged: movementOps.length,
  };
}

module.exports = { titleCaseProducts };
