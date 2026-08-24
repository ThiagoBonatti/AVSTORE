// Utilitario de manutencao: reconstroi do zero o documento meta/catalog
// (categorias e cores usadas nos filtros da loja) varrendo TODOS os produtos
// atuais no Firestore.
//
// Por que isso existe: o documento meta/catalog e alimentado via arrayUnion
// a cada produto criado/editado (ver server/routes/products.js), entao ele
// so CRESCE — se voce excluir o ultimo produto de uma categoria, ela
// continua aparecendo no filtro da loja. Rode este script sempre que quiser
// "limpar" categorias/cores que nao sao mais usadas por nenhum produto.
//
// Uso: node server/scripts/rebuildFilters.js
require('dotenv').config({ override: true });
const { db } = require('../firebase');

(async () => {
  try {
    const snapshot = await db.collection('products').get();

    const categories = new Set();
    const colors = new Set();

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.category) categories.add(data.category);
      if (data.color) colors.add(data.color);
    });

    await db.collection('meta').doc('catalog').set({
      categories: Array.from(categories).sort(),
      colors: Array.from(colors).sort(),
    });

    console.log(`Filtros reconstruidos: ${categories.size} categoria(s), ${colors.size} cor(es).`);
    process.exit(0);
  } catch (err) {
    console.error('Erro ao reconstruir filtros:', err);
    process.exit(1);
  }
})();
