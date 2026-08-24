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

const form = document.getElementById('product-form');
if (!form) {
  // Esta pagina nao e o dashboard (nao ha nada mais a fazer aqui).
} else {
  const codeInput = document.getElementById('code');
  const codeLockedHint = document.getElementById('code-locked-hint');
  const descriptionInput = document.getElementById('description');
  const categoryInput = document.getElementById('category');
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const priceInput = document.getElementById('price');
  const imageInput = document.getElementById('image');
  const imagePreview = document.getElementById('image-preview');
  const imageRequiredHint = document.getElementById('image-required-hint');

  const formTitle = document.getElementById('form-title');
  const submitBtn = document.getElementById('submit-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const formMessage = document.getElementById('form-message');

  const tableBody = document.getElementById('product-table-body');
  const productCountEl = document.getElementById('product-count');
  const categoryList = document.getElementById('category-list');
  const colorList = document.getElementById('color-list');

  const adminUsernameEl = document.getElementById('admin-username');
  const logoutBtn = document.getElementById('logout-btn');

  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  let currentUser = null;
  let allProducts = [];
  let editingCode = null;

  // -------------------- fetch autenticado --------------------
  // Anexa o ID token do Firebase Authentication como Bearer token nas
  // chamadas que exigem admin (POST/PUT/DELETE em /api/products).
  async function authedFetch(url, options = {}) {
    const token = await currentUser.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
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
    await loadProducts();
  });

  // -------------------- Listagem de produtos --------------------
  // O dashboard carrega o catalogo inteiro (a listagem publica /api/products
  // e paginada por cursor, aqui buscamos todas as paginas de uma vez para
  // exibir a tabela completa).
  async function loadProducts() {
    let cursor = null;
    let items = [];

    do {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();
      items = items.concat(data.items);
      cursor = data.hasMore ? data.nextCursor : null;
    } while (cursor);

    allProducts = items;
    renderTable();
    renderDatalists();
  }

  function renderTable() {
    tableBody.innerHTML = '';
    productCountEl.textContent = allProducts.length;

    if (allProducts.length === 0) {
      tableBody.innerHTML = '<tr class="empty-row"><td colspan="9">Nenhum produto cadastrado ainda.</td></tr>';
      return;
    }

    allProducts.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img class="table-thumb" src="${p.imageUrl || ''}" alt="${escapeHtml(p.description)}" /></td>
        <td>${escapeHtml(p.code)}</td>
        <td class="description-cell">${escapeHtml(p.description)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${escapeHtml(p.color)}</td>
        <td>${escapeHtml(p.size)}</td>
        <td>${currency.format(p.price)}</td>
        <td>${p.createdAt ? dateFormatter.format(new Date(p.createdAt)) : ''}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-code="${escapeHtml(p.code)}">Editar</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-code="${escapeHtml(p.code)}">Excluir</button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function renderDatalists() {
    const categories = [...new Set(allProducts.map((p) => p.category))].sort();
    const colors = [...new Set(allProducts.map((p) => p.color))].sort();
    categoryList.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
    colorList.innerHTML = colors.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const code = btn.dataset.code;
    const product = allProducts.find((p) => p.code === code);
    if (!product) return;

    if (btn.dataset.action === 'edit') startEdit(product);
    if (btn.dataset.action === 'delete') deleteProduct(product);
  });

  // -------------------- Formulario: criar / editar --------------------
  function startEdit(product) {
    editingCode = product.code;
    codeInput.value = product.code;
    codeInput.readOnly = true;
    codeLockedHint.textContent = '(nao pode ser alterado)';
    descriptionInput.value = product.description;
    categoryInput.value = product.category;
    colorInput.value = product.color;
    sizeInput.value = product.size;
    priceInput.value = product.price;
    imageInput.value = '';
    imageRequiredHint.textContent = '(envie apenas se quiser trocar a imagem atual)';

    if (product.imageUrl) {
      imagePreview.src = product.imageUrl;
      imagePreview.style.display = 'block';
    }

    formTitle.textContent = `Editando produto: ${product.code}`;
    submitBtn.textContent = 'Salvar alteracoes';
    cancelEditBtn.hidden = false;
    hideMessage();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    form.reset();
    editingCode = null;
    codeInput.readOnly = false;
    codeLockedHint.textContent = '';
    imagePreview.style.display = 'none';
    imagePreview.src = '';
    imageRequiredHint.textContent = '(obrigatoria)';
    formTitle.textContent = 'Cadastrar novo produto';
    submitBtn.textContent = 'Cadastrar produto';
    cancelEditBtn.hidden = true;
  }

  cancelEditBtn.addEventListener('click', resetForm);

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    imagePreview.src = URL.createObjectURL(file);
    imagePreview.style.display = 'block';
  });

  function showMessage(text, type) {
    formMessage.textContent = text;
    formMessage.className = `form-message ${type}`;
    formMessage.hidden = false;
  }
  function hideMessage() {
    formMessage.hidden = true;
  }

  async function deleteProduct(product) {
    if (!confirm(`Excluir o produto "${product.description}" (codigo ${product.code})?`)) return;
    try {
      const res = await authedFetch(`/api/products/${encodeURIComponent(product.code)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao excluir produto.');
      }
      await loadProducts();
    } catch (err) {
      alert(err.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const isEdit = Boolean(editingCode);

    if (!isEdit && !imageInput.files[0]) {
      showMessage('A imagem do produto e obrigatoria para novos cadastros.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('code', codeInput.value.trim());
    formData.append('description', descriptionInput.value.trim());
    formData.append('category', categoryInput.value.trim());
    formData.append('color', colorInput.value.trim());
    formData.append('size', sizeInput.value.trim());
    formData.append('price', priceInput.value);
    if (imageInput.files[0]) formData.append('image', imageInput.files[0]);

    submitBtn.disabled = true;

    try {
      const url = isEdit ? `/api/products/${encodeURIComponent(editingCode)}` : '/api/products';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await authedFetch(url, { method, body: formData });
      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || 'Erro ao salvar produto.', 'error');
        return;
      }

      showMessage(isEdit ? 'Produto atualizado com sucesso!' : 'Produto cadastrado com sucesso!', 'success');
      resetForm();
      await loadProducts();
    } catch (err) {
      showMessage('Erro de conexao com o servidor.', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
