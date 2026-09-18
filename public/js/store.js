(function () {
  const grid = document.getElementById('product-grid');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const sentinel = document.getElementById('sentinel');
  const categorySelect = document.getElementById('filter-category');
  const colorSelect = document.getElementById('filter-color');
  const searchInput = document.getElementById('filter-search');

  const modal = document.getElementById('product-modal');
  const modalContent = document.getElementById('modal-content');
  const modalClose = document.getElementById('modal-close');

  const cartToggle = document.getElementById('cart-toggle');
  const cartCount = document.getElementById('cart-count');
  const cartModal = document.getElementById('cart-modal');
  const cartModalClose = document.getElementById('cart-modal-close');
  const cartItemsEl = document.getElementById('cart-items');
  const cartEmptyState = document.getElementById('cart-empty-state');
  const cartSummary = document.getElementById('cart-summary');
  const cartTotalValue = document.getElementById('cart-total-value');
  const cartCheckoutBtn = document.getElementById('cart-checkout');
  const cartClearBtn = document.getElementById('cart-clear');
  const toastEl = document.getElementById('toast');

  document.getElementById('year').textContent = new Date().getFullYear();

  // Numero (com DDI 55 + DDD) para onde o pedido do carrinho e enviado pelo
  // WhatsApp. Formato exigido pelo link wa.me: apenas digitos.
  const WHATSAPP_NUMBER = '5534996575057';

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
  let toastTimeout = null;

  function formatBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, 2200);
  }

  // -------------------- Cores conhecidas -> amostra visual --------------------
  // Mapeia nomes de cor (em portugues) para um tom aproximado, usado para
  // desenhar a bolinha de cor clicavel em cada produto. Inclui tanto cores
  // simples quanto os nomes compostos ja cadastrados no catalogo (ex.:
  // "Rosa Claro", "Marron Cafe", "Vinho Bordo") - um nome composto sem
  // correspondencia exata aqui ainda cai no fallback de colorToHex logo
  // abaixo (clareia/escurece a cor base pela primeira palavra), entao uma
  // cor nova cadastrada no futuro raramente fica sem nenhuma cor no chip.
  const COLOR_HEX = {
    branco: '#ffffff',
    'off white': '#f5f5f0',
    'branco perola': '#efe9df',
    preto: '#111111',
    cinza: '#9ca3af',
    chumbo: '#4b5563',
    azul: '#2563eb',
    'azul marinho': '#1e3a5f',
    marinho: '#1e3a5f',
    'azul claro': '#60a5fa',
    'azul escuro': '#1d4ed8',
    vermelho: '#dc2626',
    verde: '#16a34a',
    'verde militar': '#4d5d3a',
    amarelo: '#f1c40f',
    'amarelo manteiga': '#f2e2a1',
    laranja: '#f97316',
    roxo: '#8b5cf6',
    lilas: '#c4b5fd',
    rosa: '#ec4899',
    'rosa claro': '#ffb6c1',
    'rosa escuro': '#d6336c',
    marrom: '#78350f',
    marron: '#78350f',
    'marrom claro': '#a9744f',
    'marron claro': '#a9744f',
    'marrom cafe': '#4b3621',
    'marron cafe': '#4b3621',
    cacau: '#5c4033',
    cafe: '#5c4033',
    'cafe claro': '#b08968',
    bege: '#e8dcc8',
    caqui: '#8a7f5e',
    dourado: '#caa43d',
    prateado: '#c0c0c0',
    vinho: '#7f1d3d',
    'vinho bordo': '#6d1a36',
    creme: '#f5f0e1',
    nude: '#e3c9a8',
  };

  function normalizeColorKey(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    const toHex = (n) => clamp(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Clareia/escurece um hex misturando com branco/preto na proporcao
  // "amount" (0 a 1) - usado pelo fallback de colorToHex para aproximar
  // variacoes tipo "X Claro"/"X Escuro" que nao tem uma entrada propria.
  function lightenHex(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  function darkenHex(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
  }

  // Resolve o hex mais proximo para um nome de cor: primeiro tenta o nome
  // completo no mapa acima; se nao achar, tenta a primeira palavra como cor
  // base (ex.: "Verde" em "Verde Agua") e, se o nome tiver "claro"/"escuro",
  // clareia ou escurece essa base - assim uma cor composta nova ainda ganha
  // um tom bem proximo em vez de cair sempre no chip so com texto.
  function colorToHex(name) {
    const key = normalizeColorKey(name);
    if (COLOR_HEX[key]) return COLOR_HEX[key];

    const baseWord = key.split(' ')[0];
    const baseHex = COLOR_HEX[baseWord];
    if (!baseHex) return null;
    if (/\bclaro\b|\bclara\b/.test(key)) return lightenHex(baseHex, 0.35);
    if (/\bescuro\b|\bescura\b/.test(key)) return darkenHex(baseHex, 0.3);
    return baseHex;
  }

  // Um chip muito claro (branco, off white, pearl...) some visualmente
  // contra o fundo branco do card, sobrando so uma borda quase invisivel -
  // por isso ganha uma borda mais escura para continuar bem visivel.
  function isLightColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.85;
  }

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

  // -------------------- Amostras de cor + selecao de tamanho --------------------
  // Renderiza uma bolinha (ou chip, se a cor nao for reconhecida) por
  // variacao dentro de "container". Clicar numa amostra troca a imagem
  // exibida e a lista de tamanhos disponiveis para a cor escolhida.
  function renderSwatches(container, variants, selectedIndex, onSelect) {
    container.innerHTML = '';
    if (variants.length <= 1) return; // uma unica cor nao precisa de seletor

    variants.forEach((v, index) => {
      const hex = colorToHex(v.color);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch' + (hex ? '' : ' color-swatch-text') + (index === selectedIndex ? ' selected' : '');
      btn.title = v.color;
      btn.setAttribute('aria-label', `Cor ${v.color}`);
      if (hex) {
        btn.style.background = hex;
        if (isLightColor(hex)) btn.classList.add('color-swatch-light');
      } else {
        btn.textContent = v.color.slice(0, 2).toUpperCase();
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(index);
      });
      container.appendChild(btn);
    });
  }

  function fillSizeSelect(select, sizes, selected) {
    select.innerHTML = '';
    sizes.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      select.appendChild(opt);
    });
    if (selected && sizes.includes(selected)) select.value = selected;
  }

  // O "codigo" que o cliente ve (e que vai na mensagem do WhatsApp) e o
  // codigo do item cadastrado para aquela cor/tamanho especifica (o mesmo
  // que aparece em Produtos Cadastrados e no atalho de Nota de Venda no
  // admin) - nao o codigo generico do produto. Produtos antigos ou
  // combinacoes sem codigo de item cadastrado caem no codigo do produto,
  // para o campo nunca ficar em branco.
  function resolveItemCode(product, variant, size) {
    const itemCode = variant && variant.itemCodes && size ? variant.itemCodes[size] : null;
    return (itemCode && String(itemCode).trim()) || product.code;
  }

  // -------------------- Carrinho de compras --------------------
  // Clicar em "Comprar" nao abre mais o WhatsApp na hora: adiciona a
  // variacao escolhida (cor/tamanho) ao carrinho, que fica acumulando ate o
  // cliente clicar em "Finalizar pedido pelo WhatsApp" no carrinho. Nesse
  // momento todos os itens viram uma unica mensagem, no mesmo formato que
  // ja era usado no botao "Comprar" direto (produto, codigo, cor, tamanho,
  // valor), so que listando cada item do pedido.
  function addToCart(product, variant, size) {
    if (!size) {
      showToast('Selecione um tamanho antes de comprar.');
      return;
    }
    Cart.addItem({
      code: resolveItemCode(product, variant, size),
      description: product.description,
      color: variant.color,
      size,
      price: product.price,
      imageUrl: variant.imageUrl,
    });
    showToast(`${product.description} adicionado ao carrinho.`);
  }

  function buildWhatsAppOrderUrl(items, total) {
    const lines = ['Ola! Gostaria de fechar este pedido na AVSTORE:', ''];
    items.forEach((item, index) => {
      lines.push(`${index + 1}) ${item.description} (Codigo: ${item.code})`);
      lines.push(`Cor: ${item.color} | Tamanho: ${item.size} | Qtd: ${item.qty}`);
      lines.push(`Valor unitario: ${formatBRL(item.price)}`);
      lines.push('');
    });
    lines.push(`Total do pedido: ${formatBRL(total)}`);
    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
  }

  function updateCartBadge() {
    const count = Cart.getCount();
    cartCount.textContent = String(count);
    cartCount.hidden = count === 0;
  }

  function renderCart() {
    const items = Cart.getItems();
    cartItemsEl.innerHTML = '';

    if (items.length === 0) {
      cartEmptyState.hidden = false;
      cartSummary.hidden = true;
      return;
    }

    cartEmptyState.hidden = true;
    cartSummary.hidden = false;

    items.forEach((item) => {
      const key = Cart.keyFor(item);
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.dataset.key = key;
      row.innerHTML = `
        <img src="${item.imageUrl || '/img/sem-imagem.gif'}" alt="" class="cart-item-thumb" />
        <div class="cart-item-info">
          <strong>${escapeHtml(item.description)}</strong>
          <span class="cart-item-meta">Cor: ${escapeHtml(item.color)} · Tamanho: ${escapeHtml(item.size)} · Cod: ${escapeHtml(item.code)}</span>
          <span class="cart-item-price">${formatBRL(item.price)}</span>
        </div>
        <div class="cart-item-actions">
          <div class="qty-stepper">
            <button type="button" class="icon-btn" data-action="qty-dec" aria-label="Diminuir quantidade">−</button>
            <span class="qty-value">${item.qty}</span>
            <button type="button" class="icon-btn" data-action="qty-inc" aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="icon-btn cart-remove" data-action="remove" aria-label="Remover item">✕</button>
        </div>
      `;
      cartItemsEl.appendChild(row);
    });

    cartTotalValue.textContent = formatBRL(Cart.getTotal());
  }

  function openCartModal() {
    renderCart();
    cartModal.hidden = false;
  }

  function closeCartModal() {
    cartModal.hidden = true;
  }

  cartToggle.addEventListener('click', openCartModal);
  cartModalClose.addEventListener('click', closeCartModal);
  cartModal.addEventListener('click', (e) => {
    if (e.target === cartModal) closeCartModal();
  });

  cartItemsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.cart-item');
    if (!row) return;
    const key = row.dataset.key;
    const items = Cart.getItems();
    const item = items.find((i) => Cart.keyFor(i) === key);
    if (!item) return;

    if (e.target.closest('[data-action="qty-inc"]')) {
      Cart.setQty(key, item.qty + 1);
      renderCart();
    } else if (e.target.closest('[data-action="qty-dec"]')) {
      Cart.setQty(key, item.qty - 1);
      renderCart();
    } else if (e.target.closest('[data-action="remove"]')) {
      Cart.removeItem(key);
      renderCart();
    }
  });

  cartClearBtn.addEventListener('click', () => {
    Cart.clear();
    renderCart();
  });

  cartCheckoutBtn.addEventListener('click', () => {
    const items = Cart.getItems();
    if (items.length === 0) {
      showToast('Seu carrinho esta vazio.');
      return;
    }
    const total = Cart.getTotal();
    window.open(buildWhatsAppOrderUrl(items, total), '_blank', 'noopener');
    Cart.clear();
    renderCart();
    closeCartModal();
    showToast('Pedido enviado! Confira o WhatsApp para finalizar.');
  });

  Cart.onChange(updateCartBadge);
  updateCartBadge();

  function renderProductCard(product) {
    const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [
      { color: '', sizes: [], imageUrl: product.imageUrl },
    ];

    let selectedIndex = 0;

    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      <img data-field="image" src="${variants[0].imageUrl || '/img/sem-imagem.gif'}" alt="${escapeHtml(product.description)}" loading="lazy" />
      <div class="product-card-body">
        <div class="product-card-tags">
          <span>${escapeHtml(product.category)}</span>
        </div>
        <h3>${escapeHtml(product.description)}</h3>
        <div class="color-swatches" data-field="swatches"></div>
        <label class="size-select-label">
          Tamanho
          <select class="size-select" data-field="size-select"></select>
        </label>
        <span class="price">${formatBRL(product.price)}</span>
      </div>
      <div class="product-card-actions">
        <button class="btn btn-primary btn-block" data-action="buy">Comprar</button>
      </div>
    `;

    const imageEl = card.querySelector('[data-field="image"]');
    const swatchesEl = card.querySelector('[data-field="swatches"]');
    const sizeSelectEl = card.querySelector('[data-field="size-select"]');

    function selectVariant(index) {
      selectedIndex = index;
      const v = variants[index];
      imageEl.src = v.imageUrl || '/img/sem-imagem.gif';
      fillSizeSelect(sizeSelectEl, v.sizes, v.sizes[0]);
      renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);
    }

    fillSizeSelect(sizeSelectEl, variants[0].sizes, variants[0].sizes[0]);
    renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);

    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="buy"]') || e.target.closest('.color-swatch') || e.target.closest('.size-select')) {
        return;
      }
      openProductModal(product);
    });

    card.querySelector('[data-action="buy"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const variant = variants[selectedIndex];
      const size = sizeSelectEl.value || variant.sizes[0] || '';
      addToCart(product, variant, size);
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
    const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [
      { color: '', sizes: [], imageUrl: product.imageUrl },
    ];
    let selectedIndex = 0;

    modalContent.innerHTML = `
      <img data-field="image" src="${variants[0].imageUrl || '/img/sem-imagem.gif'}" alt="${escapeHtml(product.description)}" />
      <div class="modal-info">
        <h2>${escapeHtml(product.description)}</h2>
        <span class="modal-price">${formatBRL(product.price)}</span>
        <div class="modal-meta">
          <span>Codigo: <span data-field="codigo"></span></span>
          <span>Categoria: ${escapeHtml(product.category)}</span>
        </div>
        <div class="color-swatches" data-field="swatches"></div>
        <label class="size-select-label">
          Tamanho
          <select class="size-select" data-field="size-select"></select>
        </label>
        <button class="btn btn-primary" data-action="buy-modal">Comprar</button>
      </div>
    `;

    const imageEl = modalContent.querySelector('[data-field="image"]');
    const swatchesEl = modalContent.querySelector('[data-field="swatches"]');
    const sizeSelectEl = modalContent.querySelector('[data-field="size-select"]');
    const codigoEl = modalContent.querySelector('[data-field="codigo"]');

    // Mostra o codigo do item cadastrado para a cor/tamanho escolhidos (o
    // mesmo que aparece em Produtos Cadastrados no admin) - atualiza sempre
    // que o cliente troca a cor ou o tamanho, em vez de mostrar sempre o
    // codigo generico do produto.
    function updateCodigo() {
      const variant = variants[selectedIndex];
      const size = sizeSelectEl.value || (variant.sizes && variant.sizes[0]) || '';
      codigoEl.textContent = resolveItemCode(product, variant, size);
    }

    function selectVariant(index) {
      selectedIndex = index;
      const v = variants[index];
      imageEl.src = v.imageUrl || '/img/sem-imagem.gif';
      fillSizeSelect(sizeSelectEl, v.sizes, v.sizes[0]);
      renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);
      updateCodigo();
    }

    fillSizeSelect(sizeSelectEl, variants[0].sizes, variants[0].sizes[0]);
    renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);
    updateCodigo();
    sizeSelectEl.addEventListener('change', updateCodigo);

    modalContent.querySelector('[data-action="buy-modal"]').addEventListener('click', () => {
      const variant = variants[selectedIndex];
      const size = sizeSelectEl.value || variant.sizes[0] || '';
      addToCart(product, variant, size);
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

  // -------------------- Init --------------------
  loadFilters();
  loadProducts({ reset: true });
})();
