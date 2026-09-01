// Logica de importacao de planilha (aba "CONTROLE ESTOQUE") para o mini ERP:
// interpreta as linhas da planilha, casa cada "Código" (SKU/codigo de barras
// por cor+tamanho) com o catalogo ja cadastrado e agrupa os itens realmente
// novos em propostas de produto (cor + tamanhos + codigos). Nao acessa o
// Firestore diretamente - recebe o catalogo existente ja carregado e devolve
// uma estrutura pura, testavel sem banco de dados.
//
// server/routes/stock.js e quem chama isto, buscando o catalogo, chamando
// parseWorkbookRows()/buildImportPreview() e devolvendo o resultado para a
// tela de "Nota de compra" revisar antes de confirmar (nada e gravado aqui).

const XLSX = require('xlsx');

const SHEET_NAME_PATTERN = /controle\s*estoque/i;

// Aliases aceitos para cada cabecalho da planilha (apos normalizeKey): a
// planilha do usuario pode variar pequenos detalhes (acento, espaco extra,
// "Valor Un" vs "Valor (UN)") sem quebrar a importacao.
const HEADER_ALIASES = {
  fornecedor: ['fornecedor'],
  peca: ['peca', 'peça', 'produto', 'descricao'],
  tamanho: ['tamanho', 'tam'],
  cor: ['cor'],
  quantidade: ['quantidade', 'qtd', 'qtde'],
  codigo: ['codigo', 'código', 'sku', 'codigo de barras', 'código de barras'],
  nf: ['nf', 'numero nf', 'nota fiscal'],
  dataNF: ['data nf', 'data da nf', 'data'],
  valorUnit: ['valor un', 'valor (un)', 'valor unitario', 'valor unitário', 'custo unitario', 'custo unitário'],
};

function stripAccents(str) {
  return String(str || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Chave de comparacao "insensivel" usada para casar cabecalhos, cores e
// nomes de produto entre si (maiusculas, sem acento, espacos colapsados).
function normalizeKey(str) {
  return stripAccents(str)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseSpaces(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

// "MACACÃO CELINA FLARE" -> "Macacão Celina Flare". Puramente cosmetico
// (o campo continua editavel na tela de revisao antes de confirmar).
function toTitleCase(str) {
  const s = collapseSpaces(str);
  if (!s) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1) : word))
    .join(' ');
}

// Gera um codigo de produto (ID do documento) a partir da descricao. So
// precisa ser um ponto de partida razoavel: o admin pode editar antes de
// confirmar a importacao. Garante caracteres compativeis com CODE_PATTERN
// de server/routes/products.js (letras, numeros, ponto, hifen, underscore).
function slugifyProductCode(description) {
  let slug = stripAccents(description || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-+$/g, '');
  }
  return slug || 'PRODUTO';
}

// Normaliza o valor da coluna "Codigo": pode chegar como numero (a planilha
// usa codigos de barras longos, ex.: 6519651968724) ou como texto.
function normalizeCode(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return String(Math.round(raw));
  const str = String(raw).trim();
  const asFloatWithZeroDecimals = str.match(/^(\d+)\.0+$/);
  if (asFloatWithZeroDecimals) return asFloatWithZeroDecimals[1];
  return str;
}

function normalizeHeaderCell(raw) {
  return normalizeKey(raw).toLowerCase();
}

function findHeaderIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map((a) => normalizeKey(a).toLowerCase());
  for (let i = 0; i < headerRow.length; i += 1) {
    const cell = normalizeHeaderCell(headerRow[i]);
    if (normalizedAliases.includes(cell)) return i;
  }
  return -1;
}

function toIsoDateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value.trim();
  }
  return null;
}

// Le o arquivo .xlsx enviado e devolve as linhas ja mapeadas por nome de
// campo (nao mais por posicao de coluna). Lanca erro com mensagem amigavel
// se a aba "CONTROLE ESTOQUE" nao existir ou faltar alguma coluna essencial.
function parseWorkbookRows(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    throw new Error('Nao foi possivel ler o arquivo. Confirme que e uma planilha .xlsx valida.');
  }

  const sheetName = workbook.SheetNames.find((name) => SHEET_NAME_PATTERN.test(name));
  if (!sheetName) {
    throw new Error(
      `A planilha nao tem uma aba "CONTROLE ESTOQUE". Abas encontradas: ${workbook.SheetNames.join(', ')}.`
    );
  }

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (grid.length === 0) {
    throw new Error(`A aba "${sheetName}" esta vazia.`);
  }

  const headerRow = grid[0];
  const columnIndex = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    columnIndex[field] = findHeaderIndex(headerRow, aliases);
  }

  const missingRequired = ['peca', 'tamanho', 'cor', 'quantidade', 'codigo', 'valorUnit'].filter(
    (field) => columnIndex[field] === -1
  );
  if (missingRequired.length) {
    throw new Error(
      `A aba "${sheetName}" esta sem as colunas: ${missingRequired.join(', ')}. Confira o cabecalho da planilha.`
    );
  }

  const rows = [];
  for (let r = 1; r < grid.length; r += 1) {
    const line = grid[r];
    if (!line || line.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')) {
      continue; // linha totalmente em branco
    }

    const get = (field) => (columnIndex[field] >= 0 ? line[columnIndex[field]] : null);

    rows.push({
      rowNumber: r + 1, // 1-based, igual ao Excel (linha 1 = cabecalho)
      fornecedor: get('fornecedor') ? collapseSpaces(get('fornecedor')) : null,
      peca: collapseSpaces(get('peca')),
      tamanho: collapseSpaces(get('tamanho')),
      cor: collapseSpaces(get('cor')),
      quantidade: get('quantidade'),
      codigo: normalizeCode(get('codigo')),
      nf: get('nf') !== null && get('nf') !== undefined && String(get('nf')).trim() !== '' ? String(get('nf')).trim() : null,
      dataNF: toIsoDateOrNull(get('dataNF')),
      valorUnit: get('valorUnit'),
    });
  }

  return { sheetName, rows };
}

// Monta a previa da importacao: casa cada linha com o catalogo existente
// (via "existingItemCodeIndex") ou agrupa em propostas de produto novo.
// Parametros:
//   rows                  - saida de parseWorkbookRows().rows
//   existingItemCodeIndex - Map<codigo(string), {code, description, variantId, color, size}>
//                           (todo item ja cadastrado no catalogo, indexado pelo
//                           codigo do item dentro de variant.itemCodes)
//   existingProductCodes  - Set<string> com todos os codigos de produto ja em uso
//                           (para nao gerar um slug duplicado)
function buildImportPreview({ rows, existingItemCodeIndex, existingProductCodes }) {
  const rowErrors = [];
  const warnings = [];
  const codeIndex = new Map(existingItemCodeIndex); // codigo -> {kind:'existing'|'staging', ...}
  const stagingByKey = new Map(); // baseKey -> staged product
  let stagingSeq = 1;

  const rawLines = [];

  for (const row of rows) {
    const lineErrors = [];
    if (!row.peca) lineErrors.push('descricao (Peça) vazia');
    if (!row.tamanho) lineErrors.push('tamanho vazio');
    if (!row.codigo) lineErrors.push('codigo vazio');

    const quantidade = Number(row.quantidade);
    if (!Number.isFinite(quantidade) || !Number.isInteger(quantidade) || quantidade <= 0) {
      lineErrors.push('quantidade invalida (precisa ser um numero inteiro maior que zero)');
    }

    const valorUnit = Number(row.valorUnit);
    if (!Number.isFinite(valorUnit) || valorUnit < 0) {
      lineErrors.push('valor unitario invalido');
    }

    if (lineErrors.length) {
      rowErrors.push({ rowNumber: row.rowNumber, message: `Linha ${row.rowNumber} ignorada: ${lineErrors.join('; ')}.` });
      continue;
    }

    if (!row.cor) {
      warnings.push(`Linha ${row.rowNumber}: coluna "Cor" vazia; a cor foi deduzida do nome do produto.`);
    }

    let target = codeIndex.get(row.codigo);

    if (!target) {
      const parts = row.peca.split(' - ').map((p) => p.trim()).filter(Boolean);
      let baseDisplay;
      let colorFallback = row.cor;

      if (parts.length >= 3) {
        baseDisplay = parts.slice(0, -2).join(' - ');
        const sizeSeg = parts[parts.length - 1];
        if (normalizeKey(sizeSeg) !== normalizeKey(row.tamanho)) {
          warnings.push(
            `Linha ${row.rowNumber}: tamanho no nome do produto ("${sizeSeg}") difere da coluna Tamanho ("${row.tamanho}"); foi usada a coluna Tamanho.`
          );
        }
        if (!colorFallback) colorFallback = parts[parts.length - 2];
      } else if (parts.length === 2 && normalizeKey(parts[1]) === normalizeKey(row.tamanho)) {
        baseDisplay = parts[0];
      } else {
        baseDisplay = row.peca;
        warnings.push(
          `Linha ${row.rowNumber}: nao foi possivel separar cor/tamanho do nome "${row.peca}" automaticamente; revise o produto proposto.`
        );
      }

      baseDisplay = toTitleCase(baseDisplay) || toTitleCase(row.peca);
      const baseKey = normalizeKey(baseDisplay);

      let staged = stagingByKey.get(baseKey);
      if (!staged) {
        staged = { tempId: `novo-${stagingSeq}`, description: baseDisplay, colors: new Map() };
        stagingSeq += 1;
        stagingByKey.set(baseKey, staged);
      }

      const colorDisplay = toTitleCase(colorFallback) || 'Sem cor';
      const colorKey = normalizeKey(colorDisplay);
      let colorEntry = staged.colors.get(colorKey);
      if (!colorEntry) {
        colorEntry = { color: colorDisplay, sizes: new Map() };
        staged.colors.set(colorKey, colorEntry);
      }

      if (colorEntry.sizes.has(row.tamanho)) {
        warnings.push(
          `Linha ${row.rowNumber}: tamanho "${row.tamanho}" repetido para "${baseDisplay} / ${colorDisplay}" com um codigo novo (${row.codigo}); o codigo do item ja cadastrado para este tamanho foi mantido.`
        );
      } else {
        colorEntry.sizes.set(row.tamanho, row.codigo);
      }

      target = { kind: 'staging', tempId: staged.tempId, colorKey, colorDisplay, size: row.tamanho };
      codeIndex.set(row.codigo, target);
    } else if (target.kind === 'existing' && normalizeKey(target.size) !== normalizeKey(row.tamanho)) {
      warnings.push(
        `Linha ${row.rowNumber}: o codigo ${row.codigo} ja pertence ao tamanho "${target.size}" no catalogo (produto ${target.code}); o tamanho "${row.tamanho}" desta linha foi ignorado e a compra foi lancada no tamanho ja cadastrado.`
      );
    }

    rawLines.push({
      rowNumber: row.rowNumber,
      target,
      fornecedor: row.fornecedor,
      nf: row.nf,
      dataNF: row.dataNF,
      quantity: quantidade,
      unitCost: Math.round(valorUnit * 100) / 100,
      itemCode: row.codigo,
    });
  }

  // Monta a lista final de produtos novos propostos, com um codigo de
  // produto sugerido (unico, sem colidir com o catalogo nem com outros
  // produtos novos desta mesma importacao).
  const usedCodes = new Set(existingProductCodes);
  const newProducts = [];
  const tempIdToRef = new Map();

  for (const staged of stagingByKey.values()) {
    const baseSlug = slugifyProductCode(staged.description);
    let code = baseSlug;
    let suffix = 2;
    while (usedCodes.has(code)) {
      code = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedCodes.add(code);

    const colorKeyToVariantId = new Map();
    const variants = [];
    let variantSeq = 1;
    for (const colorEntry of staged.colors.values()) {
      const variantId = `v${variantSeq}`;
      variantSeq += 1;
      colorKeyToVariantId.set(normalizeKey(colorEntry.color), variantId);
      variants.push({
        id: variantId,
        color: colorEntry.color,
        sizes: Array.from(colorEntry.sizes.keys()),
        itemCodes: Object.fromEntries(colorEntry.sizes),
      });
    }

    tempIdToRef.set(staged.tempId, { code, colorKeyToVariantId });
    newProducts.push({
      tempId: staged.tempId,
      code,
      description: staged.description,
      category: '',
      price: '',
      variants,
      include: true,
    });
  }

  const purchaseLines = rawLines.map((line) => {
    if (line.target.kind === 'existing') {
      return {
        rowNumber: line.rowNumber,
        kind: 'existing',
        productCode: line.target.code,
        productDescription: line.target.description,
        variantId: line.target.variantId,
        color: line.target.color,
        size: line.target.size,
        itemCode: line.itemCode,
        fornecedor: line.fornecedor,
        nf: line.nf,
        dataNF: line.dataNF,
        quantity: line.quantity,
        unitCost: line.unitCost,
        include: true,
      };
    }
    const ref = tempIdToRef.get(line.target.tempId);
    return {
      rowNumber: line.rowNumber,
      kind: 'new',
      tempId: line.target.tempId,
      productCode: ref ? ref.code : null,
      variantId: ref ? ref.colorKeyToVariantId.get(line.target.colorKey) : null,
      color: line.target.colorDisplay,
      size: line.target.size,
      itemCode: line.itemCode,
      fornecedor: line.fornecedor,
      nf: line.nf,
      dataNF: line.dataNF,
      quantity: line.quantity,
      unitCost: line.unitCost,
      include: true,
    };
  });

  return {
    newProducts,
    purchaseLines,
    warnings,
    rowErrors,
    summary: {
      totalRows: rows.length,
      importedRows: purchaseLines.length,
      skippedRows: rowErrors.length,
      newProductsCount: newProducts.length,
      existingItemsCount: purchaseLines.filter((l) => l.kind === 'existing').length,
    },
  };
}

module.exports = {
  normalizeKey,
  collapseSpaces,
  toTitleCase,
  slugifyProductCode,
  normalizeCode,
  parseWorkbookRows,
  buildImportPreview,
};
