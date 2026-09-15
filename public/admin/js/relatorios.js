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

const presetBtns = document.querySelectorAll('.period-preset-btn');
const fromInput = document.getElementById('period-from');
const toInput = document.getElementById('period-to');
const applyBtn = document.getElementById('period-apply-btn');

const statSales = document.getElementById('stat-sales');
const statPurchases = document.getElementById('stat-purchases');
const statMargin = document.getElementById('stat-margin');
const statMarginPct = document.getElementById('stat-margin-pct');
const statItems = document.getElementById('stat-items');
const statTicket = document.getElementById('stat-ticket');

const chartContainer = document.getElementById('product-chart');

const customerTableBody = document.getElementById('customer-table-body');
const customerFilterInput = document.getElementById('customer-filter');
const productTableBody = document.getElementById('product-table-body');
const productFilterInput = document.getElementById('product-filter');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (n) => `${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

let currentUser = null;
let byCustomer = [];
let byProduct = [];

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
  applyPreset('30');
});

// -------------------- Periodo --------------------
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function toDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDateInputValue(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function applyPreset(preset) {
  const now = new Date();
  let from;
  let to = endOfDay(now);

  if (preset === 'today') from = startOfDay(now);
  else if (preset === '7') from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  else if (preset === '30') from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  else if (preset === 'month') from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  else if (preset === 'year') from = startOfDay(new Date(now.getFullYear(), 0, 1));
  else if (preset === 'all') from = startOfDay(new Date(2000, 0, 1));
  else from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));

  presetBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.preset === preset));
  fromInput.value = toDateInputValue(from);
  toInput.value = toDateInputValue(to);
  loadReport(from, to);
}

presetBtns.forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));

applyBtn.addEventListener('click', () => {
  if (!fromInput.value || !toInput.value) return;
  presetBtns.forEach((btn) => btn.classList.remove('active'));
  const from = startOfDay(parseDateInputValue(fromInput.value));
  const to = endOfDay(parseDateInputValue(toInput.value));
  loadReport(from, to);
});

// -------------------- Carregamento do relatorio --------------------
async function loadReport(from, to) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  const res = await authedFetch(`/api/stock/report?${params.toString()}`);
  if (!res.ok) {
    chartContainer.innerHTML = '<p class="empty-state">Erro ao carregar o relatorio.</p>';
    return;
  }
  const data = await res.json();

  renderStats(data.totals);

  byCustomer = data.byCustomer || [];
  byProduct = data.byProduct || [];
  renderProductChart(byProduct);
  renderCustomerTable();
  renderProductTable();
}

function renderStats(totals) {
  statSales.textContent = currency.format(totals.salesAmount || 0);
  statPurchases.textContent = currency.format(totals.purchasesAmount || 0);
  statMargin.textContent = currency.format(totals.salesMargin || 0);
  statMargin.classList.toggle('stat-negative', (totals.salesMargin || 0) < 0);
  statMarginPct.textContent = `${percent(totals.marginPct)} sobre as vendas`;
  statItems.textContent = totals.itemsSold || 0;
  statTicket.textContent = currency.format(totals.avgTicket || 0);
}

// -------------------- Grafico: vendas por produto (ordenado pelo mais vendido) --------------------
const PRODUCT_CHART_MAX_BARS = 15;

function shortProductLabel(p) {
  const desc = p.description || p.code || '';
  return desc.length > 14 ? `${desc.slice(0, 14)}...` : desc;
}

function renderProductChart(rows) {
  chartContainer.innerHTML = '';

  const data = [...rows].sort((a, b) => (b.itemsCount || 0) - (a.itemsCount || 0)).slice(0, PRODUCT_CHART_MAX_BARS);

  if (data.length === 0) {
    chartContainer.innerHTML = '<p class="empty-state">Nenhuma venda no periodo selecionado.</p>';
    return;
  }

  const max = Math.max(1, ...data.map((d) => d.itemsCount || 0));

  chartContainer.style.position = 'relative';

  const bars = document.createElement('div');
  bars.className = 'bar-chart-bars';

  const labelsRow = document.createElement('div');
  labelsRow.className = 'bar-chart-labels';

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;

  function positionTooltip(col) {
    const contRect = chartContainer.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    tooltip.style.left = `${colRect.left - contRect.left + colRect.width / 2}px`;
    tooltip.style.top = `${colRect.top - contRect.top - 8}px`;
  }

  data.forEach((d) => {
    const col = document.createElement('div');
    col.className = 'bar-chart-col';

    const bar = document.createElement('div');
    bar.className = 'bar-chart-bar';
    const pct = max > 0 ? ((d.itemsCount || 0) / max) * 100 : 0;
    bar.style.height = `${Math.max(pct, (d.itemsCount || 0) > 0 ? 1 : 0)}%`;
    col.appendChild(bar);

    col.addEventListener('mouseenter', () => {
      tooltip.innerHTML = `<strong>${escapeHtml(d.description || d.code)}</strong><br>${d.itemsCount || 0} itens vendidos<br>${currency.format(d.amount || 0)}`;
      tooltip.hidden = false;
      positionTooltip(col);
    });
    col.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    });

    bars.appendChild(col);

    const labelEl = document.createElement('span');
    labelEl.className = 'bar-chart-label';
    labelEl.textContent = shortProductLabel(d);
    labelsRow.appendChild(labelEl);
  });

  chartContainer.appendChild(bars);
  chartContainer.appendChild(labelsRow);
  chartContainer.appendChild(tooltip);
}

// -------------------- Tabelas: por cliente / por produto --------------------
function renderCustomerTable() {
  const filter = customerFilterInput.value.trim().toLowerCase();
  const rows = byCustomer.filter((c) => !filter || c.name.toLowerCase().includes(filter));

  if (rows.length === 0) {
    customerTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma venda encontrada no periodo.</td></tr>';
    return;
  }

  customerTableBody.innerHTML = rows
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${c.ordersCount}</td>
        <td>${c.itemsCount}</td>
        <td>${currency.format(c.amount)}</td>
        <td class="${c.margin < 0 ? 'stock-out' : ''}">${currency.format(c.margin)}</td>
        <td>${percent(c.marginPct)}</td>
      </tr>
    `
    )
    .join('');
}

function renderProductTable() {
  const filter = productFilterInput.value.trim().toLowerCase();
  const rows = byProduct.filter(
    (p) => !filter || `${p.code} ${p.description}`.toLowerCase().includes(filter)
  );

  if (rows.length === 0) {
    productTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma venda encontrada no periodo.</td></tr>';
    return;
  }

  productTableBody.innerHTML = rows
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.code)} - ${escapeHtml(p.description)}</td>
        <td>${p.itemsCount}</td>
        <td>${currency.format(p.amount)}</td>
        <td>${currency.format(p.cost)}</td>
        <td class="${p.margin < 0 ? 'stock-out' : ''}">${currency.format(p.margin)}</td>
        <td>${percent(p.marginPct)}</td>
      </tr>
    `
    )
    .join('');
}

customerFilterInput.addEventListener('input', renderCustomerTable);
productFilterInput.addEventListener('input', renderProductTable);
