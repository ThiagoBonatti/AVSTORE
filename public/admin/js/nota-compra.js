import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { firebaseConfig, USE_FIREBASE_EMULATOR } from '/firebase-config.js';

const app = initializeApp(firebaseConfig);
const authClient = getAuth(app);
if (USE_FIREBASE_EMULATOR) {
  connectAuthEmulator(authClient, 'http://127.0.0.1:9099', { disableWarnings: true });
}

const adminUsernameEl = document.getElementById('admin-username');
const logoutBtn = document.getElementById('logout-btn');

const importFileInput = document.getElementById('import-file-input');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');
const importFeedback = document.getElementById('import-feedback');

const newProductsSection = document.getElementById('new-products-section');
const newProductsList = document.getElementById('new-products-list');
const categoryList = document.getElementById('category-list');

const manualForm = document.getElementById('manual-item-form');
const manualProductSelect = document.getElementById('manual-product');
const manualColorSelect = document.getElementById('manual-color');
const manualSizeSelect = document.getElementById('manual-size');
const manualQuantityInput = document.getElementById('manual-quantity');
const manualUnitCostInput = document.getElementById('manual-unit-cost');
const manualFornecedorInput = document.getElementById('manual-fornecedor');
const manualNfInput = document.getElementById('manual-nf');
const manualDataNfInput = document.getElementById('manual-data-nf');
const manualAddBtn = document.getElementById('manual-add-btn');

const linesCountEl = document.getElementById('lines-count');
const notaGroupsEl = document.getElementById('nota-groups');
const finalizeMessage = document.getElementById('finalize-message');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const SEM_NF_KEY = '__sem_nf__';

let currentUser = null;
let catalogProducts = [];
let newProducts = [];
let lines = [];
let batchSeq = 0;
let manualSeq = 0;
const freightByNf = new Map(); // groupKey -> valor do frete desta nota (persiste entre re-renders)

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function authedFetch(url, options = {}) {
  const token = await currentUser.getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

// -------------------- Sessao --------------------
logoutBtn.addEventListener('click', async () => {
  await signOut(authClient);
  window.location.href = '/admin/login.html';
});

onAuthStateChanged(authClient, async (user) => {
  if (!user) {
    window.location.href = '/admin/login.html';
    return;
  }

  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Este usuario nao tem permissao de administrador.');
      await signOut(authClient);
      window.location.href = '/admin/login.html';
      return;
    }
  } catch (err) {
    alert('Erro de conexao com o servidor.');
    return;
  }

  currentUser = user;
  adminUsernameEl.textContent = user.email;
  await Promise.all([loadCatalog(), loadCategories()]);
  renderGroups();
});

// -------------------- Catalogo (para o formulario manual) --------------------
async function loadCatalog() {
  const res = await authedFetch('/api/stock/products');
  const data = await res.json();
  catalogProducts = data.items || [];

  const current = manualProductSelect.value;
  manualProductSelect.innerHTML = '<option value="">Selecione um produto...</option>';
  catalogProducts.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.code;
    opt.textContent = `${p.code} - ${p.description}`;
    manualProductSelect.appendChild(opt);
  });
  if (current && catalogProducts.some((p) => p.code === current)) manualProductSelect.value = current;
  updateManualColorOptions();
}

async function loadCategories() {
  try {
    const res = await fetch('/api/products/filters');
    const data = await res.json();
    categoryList.innerHTML = (data.categories || []).map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  } catch (err) {
    // silencioso - o campo de categoria continua funcionando como texto livre
  }
}

function updateManualColorOptions() {
  const product = catalogProducts.find((p) => p.code === manualProductSelect.value);
  manualColorSelect.innerHTML = '<option value="">Selecione a cor...</option>';
  manualColorSelect.disabled = !product;
  if (product) {
    product.variants.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.color;
      manualColorSelect.appendChild(opt);
    });
  }
  updateManualSizeOptions();
}

function updateManualSizeOptions() {
  const product = catalogProducts.find((p) => p.code === manualProductSelect.value);
  const variant = product && product.variants.find((v) => v.id === manualColorSelect.value);
  manualSizeSelect.innerHTML = '<option value="">Selecione o tamanho...</option>';
  manualSizeSelect.disabled = !variant;
  if (variant) {
    variant.sizes.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      const qty = Number((variant.stock && variant.stock[s]) || 0);
      opt.textContent = `${s} (estoque: ${qty})`;
      manualSizeSelect.appendChild(opt);
    });
  }
}

manualProductSelect.addEventListener('change', updateManualColorOptions);
manualColorSelect.addEventListener('change', updateManualSizeOptions);

manualAddBtn.addEventListener('click', () => {
  const product = catalogProducts.find((p) => p.code === manualProductSelect.value);
  const variant = product && product.variants.find((v) => v.id === manualColorSelect.value);
  const size = manualSizeSelect.value;
  const quantity = parseInt(manualQuantityInput.value, 10);
  const unitCost = Number(manualUnitCostInput.value);

  if (!product || !variant || !size) {
    alert('Selecione o produto, a cor e o tamanho.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    alert('Informe uma quantidade valida.');
    return;
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    alert('Informe um custo unitario valido.');
    return;
  }

  manualSeq += 1;
  lines.push({
    uid: `manual-${manualSeq}`,
    kind: 'existing',
    productCode: product.code,
    productDescription: product.description,
    variantId: variant.id,
    color: variant.color,
    size,
    itemCode: (variant.itemCodes && variant.itemCodes[size]) || null,
    fornecedor: manualFornecedorInput.value.trim() || null,
    nf: manualNfInput.value.trim() || null,
    dataNF: manualDataNfInput.value ? new Date(manualDataNfInput.value).toISOString() : null,
    quantity,
    unitCost,
  });

  manualQuantityInput.value = '1';
  manualUnitCostInput.value = '';
  renderGroups();
});

// -------------------- Importar planilha --------------------
importBtn.addEventListener('click', async () => {
  const file = importFileInput.files[0];
  if (!file) {
    alert('Escolha um arquivo .xlsx antes de importar.');
    return;
  }

  importBtn.disabled = true;
  importStatus.textContent = 'Processando planilha...';
  importFeedback.hidden = true;

  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await authedFetch('/api/stock/import/preview', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      importFeedback.hidden = false;
      importFeedback.className = 'import-feedback error';
      importFeedback.innerHTML = `<p class="import-feedback-summary">${escapeHtml(data.error || 'Erro ao processar a planilha.')}</p>`;
      return;
    }

    batchSeq += 1;
    const prefix = `imp${batchSeq}`;

    // Reescreve os tempId para nao colidir com uma importacao anterior nesta
    // mesma sessao (ex.: o admin importa a mesma planilha, ou duas notas
    // diferentes, sem recarregar a pagina).
    const tempIdMap = new Map();
    const importedProducts = (data.newProducts || []).map((p) => {
      const newTempId = `${prefix}-${p.tempId}`;
      tempIdMap.set(p.tempId, newTempId);
      return { ...p, tempId: newTempId };
    });

    const importedLines = (data.purchaseLines || []).map((l) => ({
      uid: `${prefix}-row${l.rowNumber}`,
      kind: l.kind,
      tempId: l.kind === 'new' ? tempIdMap.get(l.tempId) : undefined,
      productCode: l.kind === 'existing' ? l.productCode : undefined,
      productDescription: l.kind === 'existing' ? l.productDescription : undefined,
      variantId: l.variantId,
      color: l.color,
      size: l.size,
      itemCode: l.itemCode,
      fornecedor: l.fornecedor,
      nf: l.nf,
      dataNF: l.dataNF,
      quantity: l.quantity,
      unitCost: l.unitCost,
    }));

    newProducts = newProducts.concat(importedProducts);
    lines = lines.concat(importedLines);

    renderNewProducts();
    renderGroups();

    const warnings = data.warnings || [];
    const rowErrors = data.rowErrors || [];
    importFeedback.hidden = false;
    importFeedback.className = 'import-feedback';
    let html = `<p class="import-feedback-summary">Planilha "${escapeHtml(data.sheetName || '')}" processada: `
      + `${importedProducts.length} produto(s) novo(s), ${importedLines.length} item(ns) para lancar`
      + (rowErrors.length ? `, ${rowErrors.length} linha(s) ignorada(s)` : '') + '.</p>';
    if (warnings.length) {
      html += `<details><summary>${warnings.length} aviso(s)</summary><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`;
    }
    if (rowErrors.length) {
      html += `<details><summary>${rowErrors.length} linha(s) ignorada(s)</summary><ul>${rowErrors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul></details>`;
    }
    importFeedback.innerHTML = html;
    importFileInput.value = '';
  } catch (err) {
    importFeedback.hidden = false;
    importFeedback.className = 'import-feedback error';
    importFeedback.innerHTML = '<p class="import-feedback-summary">Erro de conexao ao processar a planilha.</p>';
  } finally {
    importBtn.disabled = false;
    importStatus.textContent = '';
  }
});

// -------------------- Produtos novos (revisao antes de confirmar) --------------------
function renderNewProducts() {
  newProductsSection.hidden = newProducts.length === 0;
  newProductsList.innerHTML = newProducts
    .map((p) => {
      const variantsSummary = p.variants
        .map((v) => {
          const codes = Object.entries(v.itemCodes || {})
            .map(([size, code]) => `${size}: ${code}`)
            .join(', ');
          return `<div>${escapeHtml(v.color)} - tamanhos ${escapeHtml(v.sizes.join(', '))}${codes ? ` (codigos: ${escapeHtml(codes)})` : ''}</div>`;
        })
        .join('');

      return `
        <div class="new-product-card" data-temp-id="${escapeHtml(p.tempId)}">
          <label class="full">
            Descricao
            <input type="text" data-field="description" value="${escapeHtml(p.description)}" />
          </label>
          <label>
            Codigo do produto
            <input type="text" data-field="code" value="${escapeHtml(p.code)}" />
          </label>
          <label>
            Categoria
            <input type="text" data-field="category" list="category-list" value="${escapeHtml(p.category)}" placeholder="Categoria..." />
          </label>
          <label>
            Preco de venda (R$)
            <input type="number" min="0" step="0.01" data-field="price" value="${escapeHtml(p.price)}" />
          </label>
          <div class="new-product-actions">
            <button type="button" class="btn btn-danger btn-sm" data-action="remove-product">Remover produto</button>
          </div>
          <div class="full new-product-variants">${variantsSummary}</div>
        </div>
      `;
    })
    .join('');
}

newProductsList.addEventListener('input', (e) => {
  const card = e.target.closest('[data-temp-id]');
  if (!card) return;
  const field = e.target.dataset.field;
  if (!field) return;
  const product = newProducts.find((p) => p.tempId === card.dataset.tempId);
  if (!product) return;
  product[field] = field === 'price' ? e.target.value : e.target.value;
  if (field === 'code') renderGroups(); // o codigo aparece na coluna "Produto" da tabela de itens
});

newProductsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-product"]');
  if (!btn) return;
  const card = btn.closest('[data-temp-id]');
  const tempId = card.dataset.tempId;
  if (!confirm('Remover este produto novo e todos os itens da nota associados a ele?')) return;
  newProducts = newProducts.filter((p) => p.tempId !== tempId);
  lines = lines.filter((l) => !(l.kind === 'new' && l.tempId === tempId));
  renderNewProducts();
  renderGroups();
});

// -------------------- Rateio do frete --------------------
function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeFreightShares(lineList, freight) {
  const subtotals = lineList.map((l) => l.quantity * l.unitCost);
  const total = subtotals.reduce((a, b) => a + b, 0);
  const shares = lineList.map((l, i) => (freight > 0 && total > 0 ? round2(freight * (subtotals[i] / total)) : 0));
  if (freight > 0 && total > 0 && shares.length) {
    const allocated = round2(shares.reduce((a, b) => a + b, 0));
    shares[shares.length - 1] = round2(shares[shares.length - 1] + round2(freight - allocated));
  }
  return shares;
}

// -------------------- Itens da nota, agrupados por NF --------------------
// A planilha pode trazer mais de uma nota fiscal (colunas "NF" diferentes).
// Cada NF vira um grupo com sua propria tabela, seu proprio frete e seu
// proprio botao de finalizar - assim cada nota pode ser lancada de forma
// independente, sem misturar o rateio de frete entre notas diferentes.
// Itens sem NF preenchida (ex.: adicionados manualmente sem informar a NF)
// caem no grupo "Sem NF".
function productLabelForLine(line) {
  if (line.kind === 'existing') return `${line.productCode} - ${line.productDescription || ''}`;
  const product = newProducts.find((p) => p.tempId === line.tempId);
  return product ? `[NOVO] ${product.code || '?'} - ${product.description || ''}` : '[NOVO] (produto removido)';
}

function groupLines() {
  const map = new Map();
  lines.forEach((l) => {
    const key = l.nf && String(l.nf).trim() ? String(l.nf).trim() : SEM_NF_KEY;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  });
  const keys = Array.from(map.keys());
  keys.sort((a, b) => {
    if (a === SEM_NF_KEY) return 1;
    if (b === SEM_NF_KEY) return -1;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, 'pt-BR');
  });
  return keys.map((key) => ({
    key,
    label: key === SEM_NF_KEY ? 'Sem NF' : `NF ${key}`,
    items: map.get(key),
  }));
}

function renderGroups() {
  linesCountEl.textContent = lines.length;
  const groups = groupLines();

  if (groups.length === 0) {
    notaGroupsEl.innerHTML = '<p class="variants-hint">Nenhum item adicionado ainda. Importe uma planilha ou adicione um item manualmente acima.</p>';
    return;
  }

  notaGroupsEl.innerHTML = groups.map(renderGroupCardHtml).join('');
}

function renderGroupCardHtml(group) {
  const freight = freightByNf.get(group.key) || 0;
  const shares = computeFreightShares(group.items, freight);

  const rows = group.items
    .map((l, i) => {
      const share = shares[i];
      const adjustedCost = round2(l.unitCost + (l.quantity ? share / l.quantity : 0));
      const subtotal = round2(l.quantity * l.unitCost);
      return `
        <tr data-uid="${escapeHtml(l.uid)}">
          <td>${escapeHtml(productLabelForLine(l))}</td>
          <td>${escapeHtml(l.color || '')}</td>
          <td>${escapeHtml(l.size || '')}</td>
          <td>${escapeHtml(l.itemCode || '-')}</td>
          <td><input class="lines-table-input wide" type="text" data-field="fornecedor" value="${escapeHtml(l.fornecedor || '')}" /></td>
          <td><input class="lines-table-input" type="text" data-field="nf" value="${escapeHtml(l.nf || '')}" /></td>
          <td><input class="lines-table-input" type="number" min="1" step="1" data-field="quantity" value="${l.quantity}" /></td>
          <td><input class="lines-table-input" type="number" min="0" step="0.01" data-field="unitCost" value="${l.unitCost}" /></td>
          <td data-cell="share">${currency.format(share)}</td>
          <td data-cell="adjusted">${currency.format(adjustedCost)}</td>
          <td data-cell="subtotal">${currency.format(subtotal)}</td>
          <td><button type="button" class="icon-btn" data-action="remove-line" aria-label="Remover item">✕</button></td>
        </tr>
      `;
    })
    .join('');

  const subtotalSum = round2(group.items.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));

  return `
    <div class="nota-group" data-group-key="${escapeHtml(group.key)}">
      <div class="card-header-row">
        <h3>${escapeHtml(group.label)} (<span data-cell="count">${group.items.length}</span> ${group.items.length === 1 ? 'item' : 'itens'})</h3>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th>Tamanho</th>
              <th>Codigo</th>
              <th>Fornecedor</th>
              <th>NF</th>
              <th>Qtd</th>
              <th>Custo unit.</th>
              <th>Rateio frete</th>
              <th>Custo c/ frete</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody data-group-tbody>${rows}</tbody>
        </table>
      </div>
      <div class="nota-footer">
        <label class="nota-freight-field">
          Frete total desta nota (R$)
          <input type="number" min="0" step="0.01" value="${freight}" data-role="freight-input" />
        </label>
        <div class="nota-totals">
          <span>Subtotal: <strong data-cell="totals-subtotal">${currency.format(subtotalSum)}</strong></span>
          <span>Frete: <strong data-cell="totals-freight">${currency.format(freight)}</strong></span>
          <span>Total com frete: <strong data-cell="totals-grand">${currency.format(round2(subtotalSum + freight))}</strong></span>
        </div>
        <button type="button" class="btn btn-primary" data-action="finalize-group">Finalizar esta nota</button>
      </div>
    </div>
  `;
}

// Atualiza so os numeros (rateio, custo c/frete, totais) de um grupo sem
// recriar o input de frete - assim o campo nao perde o foco enquanto o
// admin digita o valor do frete.
function updateGroupDisplay(key) {
  const card = notaGroupsEl.querySelector(`.nota-group[data-group-key="${cssEscape(key)}"]`);
  if (!card) return;
  const group = groupLines().find((g) => g.key === key);
  if (!group) return;

  const freight = freightByNf.get(key) || 0;
  const shares = computeFreightShares(group.items, freight);

  group.items.forEach((l, i) => {
    const row = card.querySelector(`tr[data-uid="${cssEscape(l.uid)}"]`);
    if (!row) return;
    const share = shares[i];
    const adjustedCost = round2(l.unitCost + (l.quantity ? share / l.quantity : 0));
    const shareCell = row.querySelector('[data-cell="share"]');
    const adjustedCell = row.querySelector('[data-cell="adjusted"]');
    if (shareCell) shareCell.textContent = currency.format(share);
    if (adjustedCell) adjustedCell.textContent = currency.format(adjustedCost);
  });

  const subtotalSum = round2(group.items.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));
  const subtotalEl = card.querySelector('[data-cell="totals-subtotal"]');
  const freightEl = card.querySelector('[data-cell="totals-freight"]');
  const grandEl = card.querySelector('[data-cell="totals-grand"]');
  if (subtotalEl) subtotalEl.textContent = currency.format(subtotalSum);
  if (freightEl) freightEl.textContent = currency.format(freight);
  if (grandEl) grandEl.textContent = currency.format(round2(subtotalSum + freight));
}

notaGroupsEl.addEventListener('input', (e) => {
  if (e.target.dataset.role !== 'freight-input') return;
  const card = e.target.closest('.nota-group');
  if (!card) return;
  const key = card.dataset.groupKey;
  const v = Number(e.target.value);
  freightByNf.set(key, Number.isFinite(v) && v >= 0 ? v : 0);
  updateGroupDisplay(key);
});

notaGroupsEl.addEventListener('change', (e) => {
  const row = e.target.closest('tr[data-uid]');
  if (!row) return;
  const field = e.target.dataset.field;
  if (!field) return;
  const line = lines.find((l) => l.uid === row.dataset.uid);
  if (!line) return;

  if (field === 'quantity') {
    const v = parseInt(e.target.value, 10);
    line.quantity = Number.isInteger(v) && v > 0 ? v : line.quantity;
  } else if (field === 'unitCost') {
    const v = Number(e.target.value);
    line.unitCost = Number.isFinite(v) && v >= 0 ? v : line.unitCost;
  } else if (field === 'nf') {
    // Editar a NF pode mover o item para outro grupo (ou criar um novo) -
    // por isso, ao contrario dos outros campos, este exige recriar toda a
    // lista de grupos.
    line.nf = e.target.value.trim() || null;
  } else {
    line[field] = e.target.value.trim() || null;
  }
  renderGroups();
});

notaGroupsEl.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-action="remove-line"]');
  if (removeBtn) {
    const row = removeBtn.closest('tr[data-uid]');
    lines = lines.filter((l) => l.uid !== row.dataset.uid);
    renderGroups();
    return;
  }

  const finalizeGroupBtn = e.target.closest('[data-action="finalize-group"]');
  if (finalizeGroupBtn) {
    const card = finalizeGroupBtn.closest('.nota-group');
    finalizeGroup(card.dataset.groupKey, finalizeGroupBtn);
  }
});

// -------------------- Finalizar uma nota (um grupo de NF) --------------------
function showFinalizeMessage(text, type) {
  finalizeMessage.textContent = text;
  finalizeMessage.className = `form-message ${type}`;
  finalizeMessage.hidden = false;
}
function hideFinalizeMessage() {
  finalizeMessage.hidden = true;
}

async function finalizeGroup(key, buttonEl) {
  hideFinalizeMessage();
  const group = groupLines().find((g) => g.key === key);
  if (!group || group.items.length === 0) return;

  const referencedTempIds = new Set(group.items.filter((l) => l.kind === 'new').map((l) => l.tempId));
  const createdProducts = newProducts.filter((p) => referencedTempIds.has(p.tempId));
  const productsPayload = createdProducts.map((p) => ({
    tempId: p.tempId,
    code: String(p.code || '').trim(),
    description: String(p.description || '').trim(),
    category: String(p.category || '').trim(),
    price: Number(p.price),
    variants: p.variants,
  }));

  const freight = freightByNf.get(key) || 0;
  const shares = computeFreightShares(group.items, freight);
  const linesPayload = group.items.map((l, i) => ({
    rowNumber: l.uid,
    kind: l.kind,
    tempId: l.tempId,
    productCode: l.productCode,
    variantId: l.variantId,
    size: l.size,
    itemCode: l.itemCode,
    fornecedor: l.fornecedor,
    nf: l.nf,
    dataNF: l.dataNF,
    quantity: l.quantity,
    unitCost: l.unitCost,
    freightShare: shares[i],
  }));

  if (buttonEl) buttonEl.disabled = true;
  try {
    const res = await authedFetch('/api/stock/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newProducts: productsPayload, purchaseLines: linesPayload }),
    });
    const data = await res.json();

    // Tanto na resposta de sucesso total (201) quanto na parcial (207) os
    // produtos novos referenciados por este grupo ja foram criados no
    // catalogo (a criacao dos produtos acontece antes do lancamento das
    // compras, de forma atomica). Por isso, em ambos os casos, propagamos a
    // conversao "produto novo -> produto existente" para QUALQUER linha em
    // QUALQUER grupo que referencie o mesmo produto - assim, se a mesma peca
    // aparecer em outra NF, a proxima finalizacao ja trata como existente.
    if (res.ok || data.partial) {
      lines.forEach((l) => {
        if (l.kind === 'new' && referencedTempIds.has(l.tempId)) {
          const product = createdProducts.find((p) => p.tempId === l.tempId);
          if (product) {
            l.kind = 'existing';
            l.productCode = product.code;
            l.productDescription = product.description;
          }
        }
      });
      newProducts = newProducts.filter((p) => !referencedTempIds.has(p.tempId));
    }

    if (data.partial) {
      const postedUids = new Set(data.summary.postedRowNumbers);
      lines = lines.filter((l) => !postedUids.has(l.uid));
      renderNewProducts();
      renderGroups();
      showFinalizeMessage(
        `${group.label}: ${data.error || 'parte da nota foi lancada. Corrija a linha indicada e clique em "Finalizar esta nota" novamente para lancar o restante.'}`,
        'error'
      );
      await loadCatalog();
      return;
    }

    if (!res.ok) {
      showFinalizeMessage(`${group.label}: ${data.error || 'erro ao finalizar a nota.'}`, 'error');
      return;
    }

    const postedUids = new Set(group.items.map((l) => l.uid));
    lines = lines.filter((l) => !postedUids.has(l.uid));
    freightByNf.delete(key);
    renderNewProducts();
    renderGroups();
    showFinalizeMessage(
      `${group.label} lancada com sucesso: ${data.summary.productsCreated} produto(s) novo(s) e ${data.summary.movementsCreated} compra(s) registrada(s).`,
      'success'
    );
    await loadCatalog();
  } catch (err) {
    showFinalizeMessage(`${group.label}: erro de conexao com o servidor.`, 'error');
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}

// -------------------- Init --------------------
renderNewProducts();
renderGroups();
