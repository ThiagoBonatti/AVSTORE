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

const typeToggleBtns = document.querySelectorAll('.type-toggle-btn');
const form = document.getElementById('movement-form');
const productSelect = document.getElementById('mv-product');
const variantSelect = document.getElementById('mv-variant');
const sizeSelect = document.getElementById('mv-size');
const sizeStockHint = document.getElementById('mv-size-stock-hint');
const quantityInput = document.getElementById('mv-quantity');
const priceLabel = document.getElementById('mv-price-label');
const unitPriceInput = document.getElementById('mv-unit-price');
const supplierFields = document.querySelectorAll('.supplier-field');
const supplierNameInput = document.getElementById('mv-supplier-name');
const supplierContactInput = document.getElementById('mv-supplier-contact');
const customerFields = document.querySelectorAll('.customer-field');
const customerNameInput = document.getElementById('mv-customer-name');
const customerContactInput = document.getElementById('mv-customer-contact');
const noteInput = document.getElementById('mv-note');
const mvMessage = document.getElementById('mv-message');
const submitBtn = document.getElementById('mv-submit-btn');

const stockTableBody = document.getElementById('stock-table-body');
const stockFilterInput = document.getElementById('stock-filter');

const historyTableBody = document.getElementById('history-table-body');
const historyTypeFilter = document.getElementById('history-type-filter');
const historyFilterInput = document.getElementById('history-filter');
const loadMoreBtn = document.getElementById('load-more-btn');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

let currentUser = null;
let products = [];
let movements = [];
let movementType = 'sale';

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
  await Promise.all([loadProducts(), loadHistory({ reset: true })]);
});

// -------------------- Tipo: Venda / Compra --------------------
function setMovementType(type) {
  movementType = type;
  typeToggleBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.type === type));
  supplierFields.forEach((el) => (el.hidden = type !== 'purchase'));
  customerFields.forEach((el) => (el.hidden = type !== 'sale'));
  priceLabel.textContent = type === 'purchase' ? 'Custo unitario (R$)' : 'Preco unitario (R$)';
  submitBtn.textContent = type === 'purchase' ? 'Lancar compra' : 'Lancar venda';

  // Ao trocar para venda, sugere o preco de tabela do produto selecionado
  // (o usuario pode ajustar antes de enviar).
  if (type === 'sale') {
    const product = products.find((p) => p.code === productSelect.value);
    if (product && !unitPriceInput.value) unitPriceInput.value = product.price;
  }
}

typeToggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => setMovementType(btn.dataset.type));
});

// -------------------- Produtos / catalogo --------------------
async function loadProducts() {
  const res = await authedFetch('/api/stock/products');
  const data = await res.json();
  products = data.items || [];

  const current = productSelect.value;
  productSelect.innerHTML = '<option value="">Selecione um produto...</option>';
  products.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.code;
    opt.textContent = `${p.code} - ${p.description}`;
    productSelect.appendChild(opt);
  });
  if (current && products.some((p) => p.code === current)) productSelect.value = current;

  renderStockTable();
  updateVariantOptions();
}

function updateVariantOptions() {
  const product = products.find((p) => p.code === productSelect.value);
  variantSelect.innerHTML = '<option value="">Selecione a cor...</option>';
  variantSelect.disabled = !product;

  if (product) {
    product.variants.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.color;
      variantSelect.appendChild(opt);
    });
  }
  updateSizeOptions();
}

function updateSizeOptions() {
  const product = products.find((p) => p.code === productSelect.value);
  const variant = product && product.variants.find((v) => v.id === variantSelect.value);
  sizeSelect.innerHTML = '<option value="">Selecione o tamanho...</option>';
  sizeSelect.disabled = !variant;
  sizeStockHint.textContent = '';

  if (variant) {
    variant.sizes.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      const qty = Number((variant.stock && variant.stock[s]) || 0);
      opt.textContent = `${s} (estoque: ${qty})`;
      sizeSelect.appendChild(opt);
    });
  }
  updateSizeHint();
}

function updateSizeHint() {
  const product = products.find((p) => p.code === productSelect.value);
  const variant = product && product.variants.find((v) => v.id === variantSelect.value);
  if (!variant || !sizeSelect.value) {
    sizeStockHint.textContent = '';
    return;
  }
  const qty = Number((variant.stock && variant.stock[sizeSelect.value]) || 0);
  sizeStockHint.textContent = `(estoque atual: ${qty})`;
}

productSelect.addEventListener('change', () => {
  updateVariantOptions();
  if (movementType === 'sale') {
    const product = products.find((p) => p.code === productSelect.value);
    if (product) unitPriceInput.value = product.price;
  }
});
variantSelect.addEventListener('change', updateSizeOptions);
sizeSelect.addEventListener('change', updateSizeHint);

// -------------------- Estoque atual --------------------
function renderStockTable() {
  const filter = stockFilterInput.value.trim().toLowerCase();
  stockTableBody.innerHTML = '';

  const rows = [];
  products.forEach((p) => {
    p.variants.forEach((v) => {
      v.sizes.forEach((s) => {
        const qty = Number((v.stock && v.stock[s]) || 0);
        const haystack = `${p.code} ${p.description} ${v.color}`.toLowerCase();
        if (filter && !haystack.includes(filter)) return;
        rows.push({ code: p.code, description: p.description, color: v.color, size: s, qty });
      });
    });
  });

  if (rows.length === 0) {
    stockTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhum item de estoque encontrado.</td></tr>';
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    let stockClass = '';
    if (r.qty === 0) stockClass = 'stock-out';
    else if (r.qty <= 2) stockClass = 'stock-low';
    tr.innerHTML = `
      <td>${escapeHtml(r.code)} - ${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.color)}</td>
      <td>${escapeHtml(r.size)}</td>
      <td class="${stockClass}">${r.qty}</td>
    `;
    stockTableBody.appendChild(tr);
  });
}

stockFilterInput.addEventListener('input', renderStockTable);

// -------------------- Lancamento de movimentacao --------------------
function showMvMessage(text, type) {
  mvMessage.textContent = text;
  mvMessage.className = `form-message ${type}`;
  mvMessage.hidden = false;
}
function hideMvMessage() {
  mvMessage.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMvMessage();

  const payload = {
    type: movementType,
    code: productSelect.value,
    variantId: variantSelect.value,
    size: sizeSelect.value,
    quantity: parseInt(quantityInput.value, 10),
    unitPrice: Number(unitPriceInput.value),
    note: noteInput.value.trim() || undefined,
  };

  if (movementType === 'purchase' && supplierNameInput.value.trim()) {
    payload.supplier = {
      name: supplierNameInput.value.trim(),
      contact: supplierContactInput.value.trim(),
    };
  }
  if (movementType === 'sale' && customerNameInput.value.trim()) {
    payload.customer = {
      name: customerNameInput.value.trim(),
      contact: customerContactInput.value.trim(),
    };
  }

  if (!payload.code || !payload.variantId || !payload.size) {
    showMvMessage('Selecione o produto, a cor e o tamanho.', 'error');
    return;
  }
  if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
    showMvMessage('Informe uma quantidade valida.', 'error');
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await authedFetch('/api/stock/movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showMvMessage(data.error || 'Erro ao lancar a movimentacao.', 'error');
      return;
    }

    showMvMessage(
      movementType === 'purchase' ? 'Compra lancada com sucesso!' : 'Venda lancada com sucesso!',
      'success'
    );
    form.reset();
    variantSelect.innerHTML = '<option value="">Selecione a cor...</option>';
    variantSelect.disabled = true;
    sizeSelect.innerHTML = '<option value="">Selecione o tamanho...</option>';
    sizeSelect.disabled = true;
    sizeStockHint.textContent = '';

    await Promise.all([loadProducts(), loadHistory({ reset: true })]);
  } catch (err) {
    showMvMessage('Erro de conexao com o servidor.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// -------------------- Historico --------------------
function typeBadge(type) {
  return type === 'purchase'
    ? '<span class="badge badge-purchase">Compra</span>'
    : '<span class="badge badge-sale">Venda</span>';
}

function renderHistory() {
  const typeFilter = historyTypeFilter.value;
  const textFilter = historyFilterInput.value.trim().toLowerCase();

  historyTableBody.innerHTML = '';

  const filtered = movements.filter((m) => {
    if (typeFilter && m.type !== typeFilter) return false;
    if (textFilter) {
      const haystack = `${m.code} ${m.description} ${m.color}`.toLowerCase();
      if (!haystack.includes(textFilter)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    historyTableBody.innerHTML = '<tr class="empty-row"><td colspan="11">Nenhuma movimentacao encontrada.</td></tr>';
    return;
  }

  filtered.forEach((m) => {
    const tr = document.createElement('tr');
    if (m.cancelled) tr.className = 'movement-cancelled';
    const partyText = m.type === 'purchase'
      ? (m.supplier && m.supplier.name ? escapeHtml(m.supplier.name) : '-')
      : (m.customer && m.customer.name ? escapeHtml(m.customer.name) : '-');
    const marginText = m.type === 'sale' && m.marginTotal != null
      ? `<span class="${m.marginTotal < 0 ? 'stock-out' : ''}">${currency.format(m.marginTotal)}</span>`
      : '-';
    const verNotaLink = m.nf
      ? `<a class="btn btn-ghost btn-sm" href="/admin/ver-nota.html?type=${encodeURIComponent(m.type)}&nf=${encodeURIComponent(m.nf)}">Ver nota</a>`
      : '';
    const cancelBtn = m.cancelled
      ? '<span class="field-hint">Cancelada</span>'
      : `<button class="btn btn-ghost btn-sm" data-action="cancel" data-id="${m.id}">Cancelar</button>`;
    const actionCell = `${verNotaLink}${cancelBtn}`;

    tr.innerHTML = `
      <td>${m.createdAt ? dateFormatter.format(new Date(m.createdAt)) : ''}</td>
      <td>${typeBadge(m.type)}</td>
      <td>${escapeHtml(m.code)} - ${escapeHtml(m.description)}</td>
      <td>${escapeHtml(m.color)} / ${escapeHtml(m.size)}</td>
      <td>${m.quantity}</td>
      <td>${currency.format(m.unitPrice)}</td>
      <td>${currency.format(m.totalPrice)}</td>
      <td>${marginText}</td>
      <td>${partyText}</td>
      <td>${escapeHtml(m.createdByEmail || '')}</td>
      <td>${actionCell}</td>
    `;
    historyTableBody.appendChild(tr);
  });
}

historyTableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="cancel"]');
  if (!btn) return;
  const movement = movements.find((m) => m.id === btn.dataset.id);
  if (!movement) return;

  if (!confirm(`Cancelar esta ${movement.type === 'purchase' ? 'compra' : 'venda'} de ${movement.quantity} unidade(s) de ${movement.description} (${movement.color}/${movement.size})?`)) {
    return;
  }

  btn.disabled = true;
  try {
    const res = await authedFetch(`/api/stock/movements/${encodeURIComponent(movement.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao cancelar a movimentacao.');
      btn.disabled = false;
      return;
    }
    await Promise.all([loadProducts(), loadHistory({ reset: true })]);
  } catch (err) {
    alert('Erro de conexao com o servidor.');
    btn.disabled = false;
  }
});

historyTypeFilter.addEventListener('change', renderHistory);
historyFilterInput.addEventListener('input', renderHistory);

async function loadHistory({ reset = false } = {}) {
  const params = new URLSearchParams({ limit: '150' });
  if (!reset && movements.length) {
    const oldest = movements[movements.length - 1];
    if (oldest.createdAt) params.set('before', oldest.createdAt);
  }

  const res = await authedFetch(`/api/stock/movements?${params.toString()}`);
  const data = await res.json();
  const items = data.items || [];

  movements = reset ? items : movements.concat(items);
  loadMoreBtn.hidden = items.length === 0;
  renderHistory();
}

loadMoreBtn.addEventListener('click', () => loadHistory({ reset: false }));

// -------------------- Init --------------------
setMovementType('sale');
