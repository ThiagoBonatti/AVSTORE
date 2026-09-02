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

  document.getElementById('year').textContent = new Date().getFullYear();

  // Numero (com DDI 55 + DDD) para onde o botao "Comprar" envia a mensagem
  // pelo WhatsApp. Formato exigido pelo link wa.me: apenas digitos.
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

  function formatBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // -------------------- Cores conhecidas -> amostra visual --------------------
  // Mapeia nomes de cor comuns (em portugues) para um tom aproximado, usado
  // para desenhar a bolinha de cor clicavel em cada produto. Cores nao
  // reconhecidas caem no fallback (chip com o nome escrito).
  const COLOR_HEX = {
    branco: '#ffffff',
    'off white': '#f5f5f0',
    preto: '#111111',
    cinza: '#9ca3af',
    chumbo: '#4b5563',
    azul: '#2563eb',
    'azul marinho': '#1e3a5f',
    marinho: '#1e3a5f',
    'azul claro': '#60a5fa',
    vermelho: '#dc2626',
    verde: '#16a34a',
    'verde militar': '#4d5d3a',
    amarelo: '#f1c40f',
    laranja: '#f97316',
    roxo: '#8b5cf6',
    lilas: '#c4b5fd',
    rosa: '#ec4899',
    marrom: '#78350f',
    bege: '#e8dcc8',
    caqui: '#8a7f5e',
    dourado: '#caa43d',
    prateado: '#c0c0c0',
    vinho: '#7f1d3d',
    creme: '#f5f0e1',
    nude: '#e3c9a8',
  };

  function normalizeColorKey(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function colorToHex(name) {
    return COLOR_HEX[normalizeColorKey(name)] || null;
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

  function buildWhatsAppUrl(product, variant, size) {
    const lines = [
      'Ola! Tenho interesse neste produto da AVSTORE:',
      `${product.description} (Codigo: ${product.code})`,
      `Cor: ${variant.color}`,
      `Tamanho: ${size}`,
      `Valor: ${formatBRL(product.price)}`,
    ];
    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
  }

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
      window.open(buildWhatsAppUrl(product, variant, size), '_blank', 'noopener');
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
          <span>Codigo: ${escapeHtml(product.code)}</span>
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

    function selectVariant(index) {
      selectedIndex = index;
      const v = variants[index];
      imageEl.src = v.imageUrl || '/img/sem-imagem.gif';
      fillSizeSelect(sizeSelectEl, v.sizes, v.sizes[0]);
      renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);
    }

    fillSizeSelect(sizeSelectEl, variants[0].sizes, variants[0].sizes[0]);
    renderSwatches(swatchesEl, variants, selectedIndex, selectVariant);

    modalContent.querySelector('[data-action="buy-modal"]').addEventListener('click', () => {
      const variant = variants[selectedIndex];
      const size = sizeSelectEl.value || variant.sizes[0] || '';
      window.open(buildWhatsAppUrl(product, variant, size), '_blank', 'noopener');
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
