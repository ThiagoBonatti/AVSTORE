// Padronizacao de textos exibidos na loja.
//
// toTitleCase: deixa a primeira letra de cada palavra maiuscula e o restante
// minusculo, colapsando espacos repetidos. Tambem trata palavras compostas
// separadas por hifen, barra ou parenteses.
//   "MACACÃO CELINA FLARE"  -> "Macacão Celina Flare"
//   "camiseta  t-shirt"     -> "Camiseta T-Shirt"
function collapseSpaces(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function toTitleCase(str) {
  const s = collapseSpaces(str);
  if (!s) return s;
  return s
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s\-\/(])(\p{L})/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase('pt-BR'));
}

module.exports = { toTitleCase, collapseSpaces };
