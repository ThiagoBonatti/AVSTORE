// Gera um array de prefixos (a partir de 2 caracteres) das palavras do
// codigo + descricao de um produto, em minusculas e sem acentos. E o truque
// classico para viabilizar "busca por prefixo" no Firestore usando uma
// consulta array-contains, ja que o Firestore nao possui busca textual nativa.
//
// Ex.: "Camiseta Azul" -> ["ca","cam","cami", ..., "camiseta", "az","azu","azul"]
//
// Limitacao conhecida: so encontra produtos cujo codigo ou alguma PALAVRA da
// descricao COMECE com o termo digitado (nao e uma busca "contains" completa
// nem por frase). Para busca textual completa em producao, integre um
// servico dedicado (Algolia, Typesense, Meilisearch etc.) alimentado a partir
// do Firestore.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos
}

function buildSearchKeywords(code, description) {
  const words = normalize(`${code} ${description}`)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const prefixes = new Set();
  for (const word of words) {
    for (let i = 2; i <= word.length; i += 1) {
      prefixes.add(word.slice(0, i));
    }
    prefixes.add(word);
  }

  // Limite de seguranca para nao deixar o documento grande demais
  return Array.from(prefixes).slice(0, 200);
}

module.exports = { buildSearchKeywords, normalize };
