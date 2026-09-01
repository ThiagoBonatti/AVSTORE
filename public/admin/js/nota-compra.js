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
const linesTableBody = document.getElementById('lines-table-body');
const freightInput = document.getElementById('freight-input');
const totalsSubtotalEl = document.getElementById('totals-subtotal');
const totalsFreightEl = document.getElementById('totals-freight');
const totalsGrandEl = document.getElementById('totals-grand');
const finalizeBtn = document.getElementById('finalize-btn');
const finalizeMessage = document.getElementById('finalize-message');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

let currentUser = null;
let catalogProducts = [];
let newProducts = [];
let lines = [];
let batchSeq = 0;
let manualSeq = 0;

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
  renderLines();
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
  renderLines();
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
    renderLines();

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
  if (field === 'code') renderLines(); // o codigo aparece na coluna "Produto" da tabela de itens
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
  renderLines();
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

// -------------------- Tabela de itens da nota --------------------
function productLabelForLine(line) {
  if (line.kind === 'existing') return `${line.productCode} - ${line.productDescription || ''}`;
  const product = newProducts.find((p) => p.tempId === line.tempId);
  return product ? `[NOVO] ${product.code || '?'} - ${product.description || ''}` : '[NOVO] (produto removido)';
}

function renderLines() {
  const freight = Number(freightInput.value) || 0;
  const shares = computeFreightShares(lines, freight);

  linesCountEl.textContent = lines.length;
  finalizeBtn.disabled = lines.length === 0;

  if (lines.length === 0) {
    linesTableBody.innerHTML = '<tr class="empty-row"><td colspan="12">Nenhum item adicionado ainda.</td></tr>';
  } else {
    linesTableBody.innerHTML = lines
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
            <td>${currency.format(share)}</td>
            <td>${currency.format(adjustedCost)}</td>
            <td>${currency.format(subtotal)}</td>
            <td><button type="button" class="icon-btn" data-action="remove-line" aria-label="Remover item">✕</button></td>
          </tr>
        `;
      })
      .join('');
  }

  const subtotalSum = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));
  totalsSubtotalEl.textContent = currency.format(subtotalSum);
  totalsFreightEl.textContent = currency.format(freight);
  totalsGrandEl.textContent = currency.format(round2(subtotalSum + freight));
}

linesTableBody.addEventListener('change', (e) => {
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
  } else {
    line[field] = e.target.value.trim() || null;
  }
  renderLines();
});

linesTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-line"]');
  if (!btn) return;
  const row = btn.closest('tr[data-uid]');
  lines = lines.filter((l) => l.uid !== row.dataset.uid);
  renderLines();
});

freightInput.addEventListener('input', renderLines);

// -------------------- Finalizar nota --------------------
function showFinalizeMessage(text, type) {
  finalizeMessage.textContent = text;
  finalizeMessage.className = `form-message ${type}`;
  finalizeMessage.hidden = false;
}
function hideFinalizeMessage() {
  finalizeMessage.hidden = true;
}

finalizeBtn.addEventListener('click', async () => {
  hideFinalizeMessage();
  if (lines.length === 0) return;

  const referencedTempIds = new Set(lines.filter((l) => l.kind === 'new').map((l) => l.tempId));
  const productsPayload = newProducts
    .filter((p) => referencedTempIds.has(p.tempId))
    .map((p) => ({
      tempId: p.tempId,
      code: String(p.code || '').trim(),
      description: String(p.description || '').trim(),
      category: String(p.category || '').trim(),
      price: Number(p.price),
      variants: p.variants,
    }));

  const freight = Number(freightInput.value) || 0;
  const shares = computeFreightShares(lines, freight);
  const linesPayload = lines.map((l, i) => ({
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

  finalizeBtn.disabled = true;
  try {
    const res = await authedFetch('/api/stock/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newProducts: productsPayload, purchaseLines: linesPayload }),
    });
    const data = await res.json();

    if (data.partial) {
      const postedUids = new Set(data.summary.postedRowNumbers);
      // Todos os produtos novos enviados nesta tentativa ja foram criados
      // (a falha aconteceu depois, no lancamento das compras) - as linhas
      // restantes que apontavam para eles agora sao itens de um produto que
      // ja existe no catalogo.
      lines.forEach((l) => {
        if (l.kind === 'new') {
          const product = newProducts.find((p) => p.tempId === l.tempId);
          if (product) {
            l.kind = 'existing';
            l.productCode = product.code;
            l.productDescription = product.description;
          }
        }
      });
      newProducts = [];
      lines = lines.filter((l) => !postedUids.has(l.uid));
      renderNewProducts();
      renderLines();
      showFinalizeMessage(data.error || 'Parte da nota foi lancada. Corrija a linha indicada e clique em "Finalizar nota" novamente para lancar o restante.', 'error');
      await loadCatalog();
      return;
    }

    if (!res.ok) {
      showFinalizeMessage(data.error || 'Erro ao finalizar a nota.', 'error');
      return;
    }

    showFinalizeMessage(
      `Nota lancada com sucesso: ${data.summary.productsCreated} produto(s) novo(s) e ${data.summary.movementsCreated} compra(s) registrada(s).`,
      'success'
    );
    newProducts = [];
    lines = [];
    freightInput.value = '0';
    renderNewProducts();
    renderLines();
    await loadCatalog();
  } catch (err) {
    showFinalizeMessage('Erro de conexao com o servidor.', 'error');
  } finally {
    finalizeBtn.disabled = lines.length === 0;
  }
});

// -------------------- Init --------------------
renderNewProducts();
renderLines();
