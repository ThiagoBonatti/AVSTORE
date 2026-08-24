(function () {
  const grid = document.getElementById('product-grid');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const sentinel = document.getElementById('sentinel');
  const categorySelect = document.getElementById('filter-category');
  const colorSelect = document.getElementById('filter-color');
  const searchInput = document.getElementById('filter-search');

  const cartToggle = document.getElementById('cart-toggle');
  const cartPanel = document.getElementById('cart-panel');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartClose = document.getElementById('cart-close');
  const cartItemsEl = document.getElementById('cart-items');
  const cartEmptyEl = document.getElementById('cart-empty');
  const cartTotalEl = document.getElementById('cart-total');
  const cartCountEl = document.getElementById('cart-count');
  const cartClearBtn = document.getElementById('cart-clear');
  const cartCheckoutBtn = document.getElementById('cart-checkout');

  const modal = document.getElementById('product-modal');
  const modalContent = document.getElementById('modal-content');
  const modalClose = document.getElementById('modal-close');

  document.getElementById('year').textContent = new Date().getFullYear();

  let state = {
    cursor: null,
    limit: 12,
    category: '',
    color: '',
    search: '',
    loading: false,
    hasMore: true,
  };

  let searchDebounce = null;

  // -------------------- Carregamento de filtros --------------------
  async function loadFilters() {
    try {
      const res = await fetch('/api/products/filters');
      const data = await res.json();
      fillSelect(categorySelect, data.categories);
      fillSelect(colorSelect, data.colors);
    } catch (e) {
      console.error('Erro ao carregar filtros', e);
    }
  }

  function fillSelect(select, values) {
    const current = select.value;
    select.innerHTML = '<option value="">Todas</option>';
    values.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    select.value = current;
  }

  // -------------------- Carregamento de produtos --------------------
  async function loadProducts({ reset = false } = {}) {
    if (state.loading) return;
    if (!reset && !state.hasMore) return;

    state.loading = true;
    loadingState.hidden = false;

    if (reset) {
      state.cursor = null;
      state.hasMore = true;
      grid.innerHTML = '';
    }

    const params = new URLSearchParams({
      limit: state.limit,
    });
    if (state.cursor) params.set('cursor', state.cursor);
    if (state.category) params.set('category', state.category);
    if (state.color) params.set('color', state.color);
    if (state.search) params.set('search', state.search);

    try {
      const res = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();

      data.items.forEach((product) => grid.appendChild(renderProductCard(product)));

      state.hasMore = data.hasMore;
      state.cursor = data.nextCursor;

      emptyState.hidden = grid.children.length > 0;
    } catch (e) {
      console.error('Erro ao carregar produtos', e);
    } finally {
      state.loading = false;
      loadingState.hidden = true;
    }
  }

  function renderProductCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      <img src="${product.imageUrl || ''}" alt="${escapeHtml(product.description)}" loading="lazy" />
      <div class="product-card-body">
        <div class="product-card-tags">
          <span>${escapeHtml(product.category)}</span>
          <span>&middot;</span>
          <span>${escapeHtml(product.color)}</span>
        </div>
        <h3>${escapeHtml(product.description)}</h3>
        <span class="size-tag">Tamanho: ${escapeHtml(product.size)}</span>
        <span class="price">${formatBRL(product.price)}</span>
      </div>
      <div class="product-card-actions">
        <button class="btn btn-primary btn-block" data-action="add">Adicionar ao carrinho</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add"]')) return;
      openProductModal(product);
    });

    card.querySelector('[data-action="add"]').addEventListener('click', (e) => {
      e.stopPropagation();
      Cart.add(product, 1);
      showToast(`"${product.description}" adicionado ao carrinho.`);
    });

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // -------------------- Scroll infinito --------------------
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) loadProducts();
      });
    },
    { rootMargin: '200px' }
  );
  observer.observe(sentinel);

  // -------------------- Filtros --------------------
  categorySelect.addEventListener('change', () => {
    state.category = categorySelect.value;
    loadProducts({ reset: true });
  });
  colorSelect.addEventListener('change', () => {
    state.color = colorSelect.value;
    loadProducts({ reset: true });
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = searchInput.value.trim();
      loadProducts({ reset: true });
    }, 300);
  });

  // -------------------- Modal de produto --------------------
  function openProductModal(product) {
    modalContent.innerHTML = `
      <img src="${product.imageUrl || ''}" alt="${escapeHtml(product.description)}" />
      <div class="modal-info">
        <h2>${escapeHtml(product.description)}</h2>
        <span class="modal-price">${formatBRL(product.price)}</span>
        <div class="modal-meta">
          <span>Codigo: ${escapeHtml(product.code)}</span>
          <span>Categoria: ${escapeHtml(product.category)}</span>
          <span>Cor: ${escapeHtml(product.color)}</span>
          <span>Tamanho: ${escapeHtml(product.size)}</span>
        </div>
        <button class="btn btn-primary" data-action="add-modal">Adicionar ao carrinho</button>
      </div>
    `;
    modalContent.querySelector('[data-action="add-modal"]').addEventListener('click', () => {
      Cart.add(product, 1);
      showToast(`"${product.description}" adicionado ao carrinho.`);
      closeModal();
    });
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    modalContent.innerHTML = '';
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // -------------------- Carrinho (painel lateral) --------------------
  function renderCart() {
    const items = Cart.items;
    cartItemsEl.innerHTML = '';
    cartEmptyEl.hidden = items.length > 0;

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${item.imageUrl || ''}" alt="${escapeHtml(item.description)}" />
        <div class="cart-item-info">
          <h4>${escapeHtml(item.description)}</h4>
          <span class="cart-item-meta">${escapeHtml(item.color)} &middot; ${escapeHtml(item.size)} &middot; ${formatBRL(item.price)}</span>
          <div class="cart-item-controls">
            <button class="qty-btn" data-action="dec">-</button>
            <span>${item.qty}</span>
            <button class="qty-btn" data-action="inc">+</button>
            <button class="cart-item-remove" data-action="remove">Remover</button>
          </div>
        </div>
      `;
      row.querySelector('[data-action="dec"]').addEventListener('click', () =>
        Cart.updateQty(item.code, item.qty - 1)
      );
      row.querySelector('[data-action="inc"]').addEventListener('click', () =>
        Cart.updateQty(item.code, item.qty + 1)
      );
      row.querySelector('[data-action="remove"]').addEventListener('click', () => Cart.remove(item.code));
      cartItemsEl.appendChild(row);
    });

    cartTotalEl.textContent = formatBRL(Cart.totalPrice());
    cartCountEl.textContent = Cart.totalItems();
  }

  function openCart() {
    cartPanel.classList.add('open');
    cartOverlay.classList.add('visible');
  }
  function closeCart() {
    cartPanel.classList.remove('open');
    cartOverlay.classList.remove('visible');
  }

  cartToggle.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  cartClearBtn.addEventListener('click', () => {
    if (confirm('Deseja esvaziar o carrinho?')) Cart.clear();
  });

  cartCheckoutBtn.addEventListener('click', () => {
    if (Cart.items.length === 0) return;
    alert(
      `Pedido simulado no valor de ${formatBRL(Cart.totalPrice())}.\n` +
        'Integre aqui seu metodo de pagamento/checkout preferido.'
    );
    Cart.clear();
    closeCart();
  });

  document.addEventListener('cart:changed', renderCart);

  // -------------------- Toast --------------------
  let toastTimeout = null;
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  // -------------------- Init --------------------
  loadFilters();
  loadProducts({ reset: true });
  renderCart();
})();
