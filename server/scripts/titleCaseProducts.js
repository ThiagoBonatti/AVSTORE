// Execucao manual do ajuste de nomes (o mesmo ajuste tambem roda sozinho na
// subida do servidor, ver server/migrations/index.js).
//
// Uso:
//   node server/scripts/titleCaseProducts.js           -> so mostra o que mudaria (simulacao)
//   node server/scripts/titleCaseProducts.js --apply   -> grava as alteracoes no Firestore
require('dotenv').config({ override: true });
const { titleCaseProducts } = require('../migrations/titleCaseProducts');

const APPLY = process.argv.includes('--apply');

titleCaseProducts({ apply: APPLY })
  .then((r) => {
    console.log(
      `\n${r.products} produto(s) lidos: ${r.productsChanged} a ajustar. ` +
        `${r.movements} movimentacao(oes) lidas: ${r.movementsChanged} a ajustar.`
    );
    console.log(APPLY ? 'Alteracoes gravadas no Firestore.' : 'Simulacao: nada foi gravado. Rode com --apply para aplicar.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erro ao padronizar nomes:', err);
    process.exit(1);
  });
