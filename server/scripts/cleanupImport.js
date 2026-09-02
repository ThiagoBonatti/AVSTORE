// Utilitario de manutencao: apaga os produtos e as movimentacoes de compra
// criados por UMA importacao de planilha especifica, para permitir refazer o
// cadastro do zero.
//
// So mexe nos codigos de produto listados em PRODUCT_CODES abaixo - nenhum
// outro produto ou movimentacao do catalogo e tocado. Por padrao roda em
// modo SIMULACAO (so mostra o que seria apagado, sem apagar nada de verdade);
// so apaga de fato quando chamado com --confirm.
//
// Uso:
//   node server/scripts/cleanupImport.js            (simulacao - so mostra)
//   node server/scripts/cleanupImport.js --confirm   (apaga de verdade)
require('dotenv').config({ override: true });
const { db } = require('../firebase');

// Codigos de produto gerados pela importacao da planilha "Controle AV
// STORE.xlsx" (aba CONTROLE ESTOQUE, 91 linhas / 14 produtos novos). Se voce
// rodar isso para uma importacao diferente, atualize esta lista antes.
const PRODUCT_CODES = [
  'LEGGING-MODELADORA-FLARE-LULU-ULTRA',
  'REGATA-MODELADORA-LULU-ULTRA',
  'MACACAO-CELINA-FLARE-ULTRA-URBAN',
  'MACACAO-MODELADOR-FRAN-TRILOBAL-LONGO',
  'CORTA-VENTO-AVA',
  'LEGGING-FUSEAU-ULTRA-URBAN',
  'CONJUNTO-MODELADOR-TRILOBAL-MAIA-COM-LEGGING',
  'CONJUNTO-COTELE-SCULP-MAIA-COM-LEGGING',
  'CONJUNTO-ASSIMETRICO-COM-LEGGING-TRILOBAL',
  'JAQUETA-MELINA-ULTRA-URBAN',
  'MACACAO-MODELADOR-CELINA-FLARE-ULTRA',
  'CONJUNTO-MODELADOR-TRILOBAL-LILI-COM-SHORT',
  'MACACAO-MODELADOR-FRAN-COTELE-SCULP-LONGO',
  'CAMISETA-SLIM-FIT-LESSA',
];

const CONFIRM = process.argv.includes('--confirm');

(async () => {
  try {
    const productsRef = db.collection('products');
    const movementsRef = db.collection('stockMovements');

    console.log(
      CONFIRM
        ? 'MODO EXCLUSAO REAL - isso vai apagar produtos e movimentacoes do Firestore de producao.\n'
        : 'MODO SIMULACAO - nada sera apagado ainda. Revise a lista abaixo e rode de novo com --confirm para apagar.\n'
    );

    // -------- 1) Quais desses produtos realmente existem --------
    console.log(`Verificando ${PRODUCT_CODES.length} codigo(s) de produto...`);
    const existingProducts = [];
    for (const code of PRODUCT_CODES) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await productsRef.doc(code).get();
      if (snap.exists) {
        const data = snap.data();
        existingProducts.push(code);
        console.log(`  [existe]     ${code}  (${data.description || '?'})`);
      } else {
        console.log(`  [nao existe] ${code}`);
      }
    }
    console.log(`\n-> ${existingProducts.length} de ${PRODUCT_CODES.length} produto(s) existem no catalogo e serao apagados.`);

    // -------- 2) Movimentacoes de compra ligadas a esses codigos --------
    console.log(`\nProcurando movimentacoes de compra desses codigos...`);
    const movementsToDelete = [];
    for (const code of PRODUCT_CODES) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await movementsRef.where('code', '==', code).where('type', '==', 'purchase').get();
      snap.forEach((doc) => {
        const data = doc.data();
        movementsToDelete.push({ id: doc.id, code, color: data.color, size: data.size, quantity: data.quantity, createdAt: data.createdAt });
      });
    }
    movementsToDelete.sort((a, b) => (a.code + a.color + a.size).localeCompare(b.code + b.color + b.size));
    movementsToDelete.forEach((m) => {
      console.log(`  [compra] ${m.id} | ${m.code} | ${m.color || '?'}/${m.size || '?'} | qtd ${m.quantity}`);
    });
    console.log(`\n-> ${movementsToDelete.length} movimentacao(oes) de compra serao apagadas.`);

    if (!CONFIRM) {
      console.log(
        '\nNada foi apagado (simulacao). Se a lista acima esta certa, rode:\n' +
          '  node server/scripts/cleanupImport.js --confirm'
      );
      process.exit(0);
    }

    // -------- 3) Apaga de verdade --------
    console.log('\nApagando movimentacoes...');
    for (const m of movementsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      await movementsRef.doc(m.id).delete();
    }
    console.log(`  -> ${movementsToDelete.length} movimentacao(oes) apagada(s).`);

    console.log('\nApagando produtos...');
    for (const code of existingProducts) {
      // eslint-disable-next-line no-await-in-loop
      await productsRef.doc(code).delete();
    }
    console.log(`  -> ${existingProducts.length} produto(s) apagado(s).`);

    console.log(
      '\nPronto. O documento meta/catalog (categorias/cores dos filtros) pode ter ficado com ' +
        'entradas sem uso - rode "npm run rebuild-filters" se quiser limpar isso tambem.'
    );
    process.exit(0);
  } catch (err) {
    console.error('\nErro durante a limpeza:', err);
    process.exit(1);
  }
})();
