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

const stockTableBody = document.getElementById('stock-table-body');
const stockFilterInput = document.getElementById('stock-filter');

const historyTableBody = document.getElementById('history-table-body');
const historyTypeFilter = document.getElementById('history-type-filter');
const historyFilterInput = document.getElementById('history-filter');
const loadMoreBtn = document.getElementById('load-more-btn');
const exportHistoryBtn = document.getElementById('export-history-btn');
const exportHistoryMessage = document.getElementById('export-history-message');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

let currentUser = null;
let products = [];
let movements = [];

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
  // loadProducts() e loadHistory() rodam em paralelo (mais rapido), mas a
  // coluna "Codigo" do historico depende do catalogo ja carregado - redesenha
  // por garantia caso loadHistory tenha terminado primeiro.
  renderHistory();
});

// -------------------- Produtos / catalogo --------------------
// O lancamento manual de compra/venda avulsa saiu desta tela (agora e feito
// nas telas dedicadas "Nota de compra" e "Nota de venda", que ja tem os
// mesmos campos de produto/cor/tamanho e ainda cuidam do numero da nota e
// do rateio de frete) - o catalogo continua sendo carregado aqui so para
// alimentar a tabela "Estoque atual" abaixo.
async function loadProducts() {
  const res = await authedFetch('/api/stock/products');
  const data = await res.json();
  products = data.items || [];
  renderStockTable();
}

// -------------------- Estoque atual --------------------
function renderStockTable() {
  const filter = stockFilterInput.value.trim().toLowerCase();
  stockTableBody.innerHTML = '';

  const rows = [];
  products.forEach((p) => {
    p.variants.forEach((v) => {
      v.sizes.forEach((s) => {
        const qty = Number((v.stock && v.stock[s]) || 0);
        const itemCode = (v.itemCodes && v.itemCodes[s]) || '';
        const haystack = `${p.code} ${itemCode} ${p.description} ${v.color}`.toLowerCase();
        if (filter && !haystack.includes(filter)) return;
        rows.push({ code: p.code, itemCode, description: p.description, color: v.color, size: s, qty });
      });
    });
  });

  if (rows.length === 0) {
    stockTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhum item de estoque encontrado.</td></tr>';
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    let stockClass = '';
    if (r.qty === 0) stockClass = 'stock-out';
    else if (r.qty <= 2) stockClass = 'stock-low';
    tr.innerHTML = `
      <td>${escapeHtml(r.itemCode || '-')}</td>
      <td class="description-cell">${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.color)}</td>
      <td>${escapeHtml(r.size)}</td>
      <td class="${stockClass}">${r.qty}</td>
    `;
    stockTableBody.appendChild(tr);
  });
}

stockFilterInput.addEventListener('input', renderStockTable);

// -------------------- Historico --------------------
function typeBadge(type) {
  return type === 'purchase'
    ? '<span class="badge badge-purchase">Compra</span>'
    : '<span class="badge badge-sale">Venda</span>';
}

// Busca o codigo de barras (item code) de uma movimentacao a partir do
// catalogo ja carregado (produtos nao guardam o itemCode na propria
// movimentacao - so na variante do produto), casando por codigo do produto +
// cor + tamanho. Se o produto/cor/tamanho nao existir mais (ex.: produto
// excluido depois), mostra "-" em vez de quebrar.
function findItemCode(m) {
  const product = products.find((p) => p.code === m.code);
  if (!product) return '';
  const variant = (product.variants || []).find((v) => v.color === m.color);
  if (!variant) return '';
  return (variant.itemCodes && variant.itemCodes[m.size]) || '';
}

function renderHistory() {
  const typeFilter = historyTypeFilter.value;
  const textFilter = historyFilterInput.value.trim().toLowerCase();

  historyTableBody.innerHTML = '';

  const filtered = movements.filter((m) => {
    if (typeFilter && m.type !== typeFilter) return false;
    if (textFilter) {
      const haystack = `${m.code} ${findItemCode(m)} ${m.description} ${m.color} ${m.nf || ''}`.toLowerCase();
      if (!haystack.includes(textFilter)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    historyTableBody.innerHTML = '<tr class="empty-row"><td colspan="13">Nenhuma movimentacao encontrada.</td></tr>';
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
    const editNfLabel = m.nf ? 'Editar nota' : 'Adicionar nota';
    const editNfBtn = `<button class="btn btn-ghost btn-sm" data-action="edit-nf" data-id="${m.id}">${editNfLabel}</button>`;
    const actionCell = `${verNotaLink}${editNfBtn}${cancelBtn}`;

    tr.innerHTML = `
      <td>${m.createdAt ? dateFormatter.format(new Date(m.createdAt)) : ''}</td>
      <td>${typeBadge(m.type)}</td>
      <td>${escapeHtml(m.nf || '-')}</td>
      <td>${escapeHtml(findItemCode(m) || '-')}</td>
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
  const cancelBtn = e.target.closest('[data-action="cancel"]');
  const editNfBtn = e.target.closest('[data-action="edit-nf"]');
  if (!cancelBtn && !editNfBtn) return;

  const btn = cancelBtn || editNfBtn;
  const movement = movements.find((m) => m.id === btn.dataset.id);
  if (!movement) return;

  if (cancelBtn) {
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
      renderHistory();
    } catch (err) {
      alert('Erro de conexao com o servidor.');
      btn.disabled = false;
    }
    return;
  }

  // "Adicionar nota" / "Editar nota" - corrige so o numero da nota de uma
  // movimentacao ja lancada (ex.: vendas antigas, lancadas antes do numero
  // da nota virar obrigatorio na tela de Nota de venda). Depois de salvar, a
  // movimentacao passa a aparecer nas grades de Notas de Compra/Venda (nas
  // telas dedicadas) e ganha o link "Ver nota" (se ainda nao tivesse).
  const novoNf = prompt(
    `Numero da nota para ${movement.description} (${movement.color}/${movement.size}):`,
    movement.nf || ''
  );
  if (novoNf === null) return; // cancelou o prompt

  editNfBtn.disabled = true;
  try {
    const res = await authedFetch(`/api/stock/movements/${encodeURIComponent(movement.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nf: novoNf }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao atualizar o numero da nota.');
      editNfBtn.disabled = false;
      return;
    }
    await loadHistory({ reset: true });
    renderHistory();
  } catch (err) {
    alert('Erro de conexao com o servidor.');
    editNfBtn.disabled = false;
  }
});

historyTypeFilter.addEventListener('change', renderHistory);
historyFilterInput.addEventListener('input', renderHistory);

// -------------------- Exportar Historico para Excel --------------------
// O download exige o token de autenticacao no header (mesmo esquema de todo
// o app), entao nao da pra so usar um link <a href="..."> direto - o
// navegador nao mandaria o Authorization junto. Em vez disso busca o arquivo
// via authedFetch(), pega a resposta como blob e simula o clique num link
// temporario para disparar o download. Respeita os mesmos filtros de
// tipo/busca que a tela tem aplicados no momento do clique.
function showExportMessage(text, type) {
  exportHistoryMessage.textContent = text;
  exportHistoryMessage.className = `form-message ${type}`;
  exportHistoryMessage.hidden = false;
}
function hideExportMessage() {
  exportHistoryMessage.hidden = true;
}

exportHistoryBtn.addEventListener('click', async () => {
  hideExportMessage();
  exportHistoryBtn.disabled = true;
  try {
    const params = new URLSearchParams();
    if (historyTypeFilter.value) params.set('type', historyTypeFilter.value);
    if (historyFilterInput.value.trim()) params.set('search', historyFilterInput.value.trim());

    const res = await authedFetch(`/api/stock/movements/export?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showExportMessage(data.error || 'Erro ao exportar o historico.', 'error');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico-movimentacoes-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showExportMessage('Erro de conexao com o servidor.', 'error');
  } finally {
    exportHistoryBtn.disabled = false;
  }
});

// As grades "Notas de compra" e "Notas de venda" (agrupadas por NF) saíram
// desta tela e foram para as telas dedicadas "Notas de Compra"
// (public/admin/js/nota-compra.js) e "Notas de Venda"
// (public/admin/js/nota-venda.js), que tem a mesma logica de agrupamento.

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
// (o carregamento inicial de produtos e historico ja acontece em
// onAuthStateChanged, acima)
