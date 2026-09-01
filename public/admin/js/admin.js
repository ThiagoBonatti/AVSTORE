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
  const priceInput = document.getElementById('price');

  const variantsList = document.getElementById('variants-list');
  const variantRowTemplate = document.getElementById('variant-row-template');
  const addVariantBtn = document.getElementById('add-variant-btn');

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
  let isEditingProduct = false;

  function makeVariantId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

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
      const colors = (p.colors || []).join(', ');
      const sizes = (p.sizes || []).join(', ');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img class="table-thumb" src="${p.imageUrl || ''}" alt="${escapeHtml(p.description)}" /></td>
        <td>${escapeHtml(p.code)}</td>
        <td class="description-cell">${escapeHtml(p.description)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${escapeHtml(colors)}</td>
        <td>${escapeHtml(sizes)}</td>
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
    const colors = [...new Set(allProducts.flatMap((p) => p.colors || []))].sort();
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

  // -------------------- Variacoes (cor + tamanhos + codigo do item + imagem) --------------------
  // Cada tamanho de uma cor pode ter seu proprio "codigo do item" (SKU),
  // usado para controle interno/codigo de barras. A lista de campos de
  // codigo e regerada sempre que o campo "Tamanhos" muda, preservando os
  // valores ja digitados para os tamanhos que continuam presentes.
  function renderItemCodesList(row, sizes, initialCodes = {}) {
    const container = row.querySelector('[data-field="item-codes-list"]');
    const previousValues = {};
    container.querySelectorAll('[data-item-code-input]').forEach((input) => {
      previousValues[input.dataset.size] = input.value;
    });

    container.innerHTML = '';
    sizes.forEach((size) => {
      const wrap = document.createElement('label');
      wrap.className = 'item-code-row';
      const safeSize = escapeHtml(size);
      wrap.innerHTML = `
        <span class="item-code-size">${safeSize}</span>
        <input type="text" data-item-code-input data-size="${safeSize}" placeholder="Codigo (opcional)" />
      `;
      const input = wrap.querySelector('input');
      input.value = previousValues[size] ?? initialCodes[size] ?? '';
      container.appendChild(wrap);
    });
  }

  function createVariantRow({ id, color = '', sizes = [], itemCodes = {}, imageUrl = null } = {}) {
    const variantId = id || makeVariantId();
    const fragment = variantRowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('[data-variant-row]');
    row.dataset.id = variantId;

    const colorInput = row.querySelector('[data-field="color"]');
    const sizesInput = row.querySelector('[data-field="sizes"]');
    const imageInput = row.querySelector('[data-field="image"]');
    const imagePreview = row.querySelector('[data-field="image-preview"]');
    const imageHint = row.querySelector('[data-field="image-hint"]');
    const removeBtn = row.querySelector('[data-action="remove-variant"]');

    colorInput.value = color;
    sizesInput.value = sizes.join(', ');
    renderItemCodesList(row, sizes, itemCodes);

    sizesInput.addEventListener('input', () => {
      const currentSizes = sizesInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      renderItemCodesList(row, currentSizes);
    });

    if (imageUrl) {
      imagePreview.src = imageUrl;
      imagePreview.style.display = 'block';
      imageHint.textContent = '(envie apenas se quiser trocar a imagem desta cor)';
    } else {
      imageHint.textContent = '(obrigatoria)';
    }

    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      imagePreview.src = URL.createObjectURL(file);
      imagePreview.style.display = 'block';
    });

    removeBtn.addEventListener('click', () => {
      if (variantsList.querySelectorAll('[data-variant-row]').length <= 1) {
        showMessage('O produto precisa de ao menos uma cor cadastrada.', 'error');
        return;
      }
      row.remove();
    });

    variantsList.appendChild(row);
    return row;
  }

  addVariantBtn.addEventListener('click', () => createVariantRow());

  function resetVariants() {
    variantsList.innerHTML = '';
    createVariantRow();
  }

  function collectVariants() {
    const rows = variantsList.querySelectorAll('[data-variant-row]');
    const variants = [];
    rows.forEach((row) => {
      const id = row.dataset.id;
      const color = row.querySelector('[data-field="color"]').value.trim();
      const sizes = row
        .querySelector('[data-field="sizes"]')
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const itemCodes = {};
      row.querySelectorAll('[data-item-code-input]').forEach((input) => {
        const val = input.value.trim();
        if (val) itemCodes[input.dataset.size] = val;
      });
      const file = row.querySelector('[data-field="image"]').files[0] || null;
      variants.push({ id, color, sizes, itemCodes, file });
    });
    return variants;
  }

  // -------------------- Formulario: criar / editar --------------------
  function startEdit(product) {
    editingCode = product.code;
    isEditingProduct = true;
    codeInput.value = product.code;
    codeInput.readOnly = true;
    codeLockedHint.textContent = '(nao pode ser alterado)';
    descriptionInput.value = product.description;
    categoryInput.value = product.category;
    priceInput.value = product.price;

    variantsList.innerHTML = '';
    (product.variants || []).forEach((v) => createVariantRow(v));
    if (!variantsList.querySelector('[data-variant-row]')) createVariantRow();

    formTitle.textContent = `Editando produto: ${product.code}`;
    submitBtn.textContent = 'Salvar alteracoes';
    cancelEditBtn.hidden = false;
    hideMessage();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    form.reset();
    editingCode = null;
    isEditingProduct = false;
    codeInput.readOnly = false;
    codeLockedHint.textContent = '';
    resetVariants();
    formTitle.textContent = 'Cadastrar novo produto';
    submitBtn.textContent = 'Cadastrar produto';
    cancelEditBtn.hidden = true;
  }

  cancelEditBtn.addEventListener('click', resetForm);

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

    const isEdit = isEditingProduct;
    const variants = collectVariants();

    if (variants.length === 0) {
      showMessage('Cadastre ao menos uma cor.', 'error');
      return;
    }
    for (const v of variants) {
      if (!v.color) {
        showMessage('Informe a cor de todas as variacoes.', 'error');
        return;
      }
      if (v.sizes.length === 0) {
        showMessage(`Informe ao menos um tamanho para a cor "${v.color}".`, 'error');
        return;
      }
      if (!isEdit && !v.file) {
        showMessage(`Envie uma imagem para a cor "${v.color}".`, 'error');
        return;
      }
    }

    const formData = new FormData();
    formData.append('code', codeInput.value.trim());
    formData.append('description', descriptionInput.value.trim());
    formData.append('category', categoryInput.value.trim());
    formData.append('price', priceInput.value);
    formData.append(
      'variants',
      JSON.stringify(variants.map((v) => ({ id: v.id, color: v.color, sizes: v.sizes, itemCodes: v.itemCodes })))
    );
    variants.forEach((v) => {
      if (v.file) formData.append(`variantImage_${v.id}`, v.file);
    });

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

  resetVariants();
}
