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

const headerNfInput = document.getElementById('header-nf');
const headerDataNfInput = document.getElementById('header-data-nf');
const headerClienteInput = document.getElementById('header-cliente');
const headerFreteInput = document.getElementById('header-frete');

const manualProductSelect = document.getElementById('manual-product');
const manualColorSelect = document.getElementById('manual-color');
const manualSizeSelect = document.getElementById('manual-size');
const manualQuantityInput = document.getElementById('manual-quantity');
const manualUnitPriceInput = document.getElementById('manual-unit-price');
const manualAddBtn = document.getElementById('manual-add-btn');

const linesCountEl = document.getElementById('lines-count');
const itemsTableBody = document.getElementById('items-table-body');
const emptyItemsHint = document.getElementById('empty-items-hint');
const totalsSubtotalEl = document.getElementById('totals-subtotal');
const totalsFreightEl = document.getElementById('totals-freight');
const totalsGrandEl = document.getElementById('totals-grand');
const finalizeBtn = document.getElementById('finalize-btn');
const finalizeMessage = document.getElementById('finalize-message');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

let currentUser = null;
let catalogProducts = [];
let lines = [];
let lineSeq = 0;

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
  await loadCatalog();
  renderItems();
});

// -------------------- Catalogo --------------------
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
  const unitPrice = Number(manualUnitPriceInput.value);

  if (!product || !variant || !size) {
    alert('Selecione o produto, a cor e o tamanho.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    alert('Informe uma quantidade valida.');
    return;
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    alert('Informe um valor unitario valido.');
    return;
  }
  const availableQty = Number((variant.stock && variant.stock[size]) || 0);
  if (quantity > availableQty) {
    if (!confirm(`Estoque disponivel para ${variant.color} / ${size} e ${availableQty} unidade(s). Adicionar mesmo assim? (o servidor vai recusar ao finalizar se nao houver estoque suficiente)`)) {
      return;
    }
  }

  lineSeq += 1;
  lines.push({
    uid: `line-${lineSeq}`,
    productCode: product.code,
    productDescription: product.description,
    variantId: variant.id,
    color: variant.color,
    size,
    itemCode: (variant.itemCodes && variant.itemCodes[size]) || null,
    quantity,
    unitPrice,
  });

  manualQuantityInput.value = '1';
  manualUnitPriceInput.value = '';
  renderItems();
});

// -------------------- Rateio do frete --------------------
function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeFreightShares(lineList, freight) {
  const subtotals = lineList.map((l) => l.quantity * l.unitPrice);
  const total = subtotals.reduce((a, b) => a + b, 0);
  const shares = lineList.map((l, i) => (freight > 0 && total > 0 ? round2(freight * (subtotals[i] / total)) : 0));
  if (freight > 0 && total > 0 && shares.length) {
    const allocated = round2(shares.reduce((a, b) => a + b, 0));
    shares[shares.length - 1] = round2(shares[shares.length - 1] + round2(freight - allocated));
  }
  return shares;
}

function currentFreight() {
  const v = Number(headerFreteInput.value);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

// -------------------- Itens da nota --------------------
function renderItems() {
  linesCountEl.textContent = lines.length;
  emptyItemsHint.hidden = lines.length > 0;

  const freight = currentFreight();
  const shares = computeFreightShares(lines, freight);

  itemsTableBody.innerHTML = lines
    .map((l, i) => {
      const share = shares[i];
      const subtotal = round2(l.quantity * l.unitPrice);
      return `
        <tr data-uid="${escapeHtml(l.uid)}">
          <td>${escapeHtml(l.productCode)} - ${escapeHtml(l.productDescription || '')}</td>
          <td>${escapeHtml(l.color || '')}</td>
          <td>${escapeHtml(l.size || '')}</td>
          <td>${escapeHtml(l.itemCode || '-')}</td>
          <td>${l.quantity}</td>
          <td>${currency.format(l.unitPrice)}</td>
          <td data-cell="share">${currency.format(share)}</td>
          <td data-cell="subtotal">${currency.format(subtotal)}</td>
          <td><button type="button" class="icon-btn" data-action="remove-line" aria-label="Remover item">✕</button></td>
        </tr>
      `;
    })
    .join('');

  const subtotalSum = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  totalsSubtotalEl.textContent = currency.format(subtotalSum);
  totalsFreightEl.textContent = currency.format(freight);
  totalsGrandEl.textContent = currency.format(round2(subtotalSum + freight));
}

headerFreteInput.addEventListener('input', renderItems);

itemsTableBody.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-action="remove-line"]');
  if (!removeBtn) return;
  const row = removeBtn.closest('tr[data-uid]');
  lines = lines.filter((l) => l.uid !== row.dataset.uid);
  renderItems();
});

// -------------------- Finalizar a nota --------------------
function showFinalizeMessage(text, type) {
  finalizeMessage.textContent = text;
  finalizeMessage.className = `form-message ${type}`;
  finalizeMessage.hidden = false;
}
function hideFinalizeMessage() {
  finalizeMessage.hidden = true;
}

// Mesmo cuidado de nota-compra.js: bloqueia cliques repetidos enquanto uma
// finalizacao esta em andamento, para nunca deixar duas requisicoes de
// finalizacao em voo ao mesmo tempo.
let finalizeInFlight = false;

finalizeBtn.addEventListener('click', async () => {
  hideFinalizeMessage();
  if (finalizeInFlight) return;
  if (lines.length === 0) {
    showFinalizeMessage('Adicione ao menos um item antes de finalizar a nota.', 'error');
    return;
  }

  const nf = headerNfInput.value.trim() || null;
  const invoiceDate = headerDataNfInput.value ? new Date(headerDataNfInput.value).toISOString() : null;
  const cliente = headerClienteInput.value.trim() || null;
  const freight = currentFreight();
  const shares = computeFreightShares(lines, freight);

  const payload = {
    lines: lines.map((l, i) => ({
      productCode: l.productCode,
      variantId: l.variantId,
      size: l.size,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      freightShare: shares[i],
      nf,
      invoiceDate,
      cliente,
    })),
  };

  finalizeInFlight = true;
  finalizeBtn.disabled = true;
  try {
    const res = await authedFetch('/api/stock/sale-note/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.partial) {
      const postedUids = new Set(data.summary.postedRowNumbers.map((rn) => lines[rn] && lines[rn].uid).filter(Boolean));
      lines = lines.filter((l) => !postedUids.has(l.uid));
      renderItems();
      showFinalizeMessage(
        `${data.error || 'parte da nota foi lancada. Corrija o item indicado e clique em "Finalizar nota de venda" novamente para lancar o restante.'}`,
        'error'
      );
      await loadCatalog();
      return;
    }

    if (!res.ok) {
      showFinalizeMessage(data.error || 'Erro ao finalizar a nota.', 'error');
      return;
    }

    lines = [];
    headerNfInput.value = '';
    headerDataNfInput.value = '';
    headerClienteInput.value = '';
    headerFreteInput.value = '0';
    renderItems();
    showFinalizeMessage(`Nota de venda lancada com sucesso: ${data.summary.movementsCreated} venda(s) registrada(s).`, 'success');
    await loadCatalog();
  } catch (err) {
    showFinalizeMessage('Erro de conexao com o servidor.', 'error');
  } finally {
    finalizeInFlight = false;
    finalizeBtn.disabled = false;
  }
});

// -------------------- Init --------------------
renderItems();
