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

const noteTitleEl = document.getElementById('note-title');
const loadMessageEl = document.getElementById('load-message');
const noteContentEl = document.getElementById('note-content');
const fieldNfEl = document.getElementById('field-nf');
const fieldDataEl = document.getElementById('field-data');
const fieldPartyLabelEl = document.getElementById('field-party-label');
const fieldPartyEl = document.getElementById('field-party');
const fieldFreteEl = document.getElementById('field-frete');
const fieldTotalEl = document.getElementById('field-total');
const itemsTableBody = document.getElementById('items-table-body');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

let currentUser = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
  await loadNote();
});

function showMessage(text, type) {
  loadMessageEl.textContent = text;
  loadMessageEl.className = `form-message ${type}`;
  loadMessageEl.hidden = false;
  noteContentEl.hidden = true;
}

// -------------------- Carrega e renderiza a nota --------------------
async function loadNote() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const nf = params.get('nf');

  if ((type !== 'purchase' && type !== 'sale') || !nf) {
    showMessage('Link invalido: informe o tipo (compra ou venda) e o numero da nota na URL.', 'error');
    return;
  }

  noteTitleEl.textContent = `${type === 'purchase' ? 'Nota de compra' : 'Nota de venda'} ${nf}`;
  fieldPartyLabelEl.textContent = type === 'purchase' ? 'Fornecedor' : 'Cliente';

  try {
    const res = await authedFetch(`/api/stock/movements?type=${encodeURIComponent(type)}&nf=${encodeURIComponent(nf)}`);
    const data = await res.json();
    if (!res.ok) {
      showMessage(data.error || 'Erro ao carregar a nota.', 'error');
      return;
    }
    const items = (data.items || []).filter((m) => !m.cancelled);
    if (items.length === 0) {
      showMessage('Nenhum item encontrado para esta nota (os itens podem ter sido cancelados).', 'error');
      return;
    }

    renderNote(type, nf, items);
  } catch (err) {
    showMessage('Erro de conexao com o servidor.', 'error');
  }
}

function renderNote(type, nf, items) {
  const first = items[0];
  const party = type === 'purchase' ? first.supplier : first.customer;
  const totalFreight = round2(items.reduce((sum, m) => sum + (m.freightShare || 0), 0));
  const totalValue = round2(items.reduce((sum, m) => sum + (m.totalPrice || 0), 0));

  fieldNfEl.textContent = nf;
  fieldDataEl.textContent = first.invoiceDate ? dateFormatter.format(new Date(first.invoiceDate)) : '-';
  fieldPartyEl.textContent = party && party.name ? party.name : '-';
  fieldFreteEl.textContent = currency.format(totalFreight);
  fieldTotalEl.textContent = currency.format(round2(totalValue + totalFreight));

  itemsTableBody.innerHTML = items
    .map((m) => `
      <tr>
        <td>${escapeHtml(m.code)}</td>
        <td>${escapeHtml(m.description || '')}</td>
        <td>${escapeHtml(m.size || '')}</td>
        <td>${escapeHtml(m.color || '')}</td>
        <td>${currency.format(m.unitPrice)}</td>
        <td>${m.quantity}</td>
        <td>${currency.format(m.totalPrice)}</td>
        <td>${currency.format(m.freightShare || 0)}</td>
      </tr>
    `)
    .join('');

  loadMessageEl.hidden = true;
  noteContentEl.hidden = false;
}
