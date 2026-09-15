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
const headerDescontoInput = document.getElementById('header-desconto');
const headerVendedorInput = document.getElementById('header-vendedor');
const headerComissaoInput = document.getElementById('header-comissao');

const manualCodeInput = document.getElementById('manual-code');
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
const totalsDiscountEl = document.getElementById('totals-discount');
const totalsGrandEl = document.getElementById('totals-grand');
const totalsCommissionWrap = document.getElementById('totals-commission-wrap');
const totalsCommissionEl = document.getElementById('totals-commission');
const finalizeBtn = document.getElementById('finalize-btn');
const finalizeMessage = document.getElementById('finalize-message');

const saleNotesTableBody = document.getElementById('sale-notes-table-body');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

let currentUser = null;
let catalogProducts = [];
let lines = [];
let lineSeq = 0;
let allMovementsForNotes = [];

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
  await Promise.all([loadCatalog(), loadAllMovementsForNotes()]);
  setNextHeaderNf();
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

// Ao escolher o produto direto no combo (sem usar o atalho de codigo
// abaixo), preenche o Valor unitario sozinho com o preco de venda cadastrado
// - o campo continua editavel depois, e so um ponto de partida.
manualProductSelect.addEventListener('change', () => {
  updateManualColorOptions();
  const product = catalogProducts.find((p) => p.code === manualProductSelect.value);
  if (product && product.price != null) {
    manualUnitPriceInput.value = product.price;
  }
  updateManualCodeFromSelection();
});
manualColorSelect.addEventListener('change', () => {
  updateManualSizeOptions();
  updateManualCodeFromSelection();
});
manualSizeSelect.addEventListener('change', updateManualCodeFromSelection);

// -------------------- Codigo de barras (atalho) --------------------
// Procura o codigo digitado em todos os produtos/cores/tamanhos ja
// carregados (mesmo campo usado em Produtos/Estoque atual: variant.itemCodes[tamanho])
// e, se achar, preenche Produto/Cor/Tamanho e o Valor unitario (preco de
// venda cadastrado do produto) sozinho. Os campos continuam editaveis depois
// - isto e so um atalho, nao substitui o preenchimento manual.
function findByItemCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  for (const product of catalogProducts) {
    for (const variant of product.variants || []) {
      const itemCodes = variant.itemCodes || {};
      const size = Object.keys(itemCodes).find((s) => String(itemCodes[s] || '').trim() === code);
      if (size) return { product, variant, size };
    }
  }
  return null;
}

// Nem todo produto tem codigo de barras por tamanho cadastrado (aquele campo
// e opcional na tela de Produtos) - por isso, quando o codigo digitado nao
// bate com nenhum item, tambem tenta casar direto com o "Codigo" principal
// do produto (o mesmo identificador usado no cadastro/estoque). Nesse caso
// so o produto e preenchido; cor e tamanho continuam para selecao manual.
function findByProductCode(rawCode) {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) return null;
  const product = catalogProducts.find((p) => String(p.code || '').trim().toLowerCase() === code);
  return product ? { product, variant: null, size: null } : null;
}

function applyCodeMatch(match) {
  manualProductSelect.value = match.product.code;
  updateManualColorOptions();
  if (match.variant) {
    manualColorSelect.value = match.variant.id;
    updateManualSizeOptions();
  }
  if (match.size) {
    manualSizeSelect.value = match.size;
  }
  if (match.product.price != null) {
    manualUnitPriceInput.value = match.product.price;
  }
}

// Caminho inverso do atalho acima: quando o admin monta a linha escolhendo
// Produto, Cor e Tamanho direto nos combos (sem digitar nada em Codigo),
// preenche esse campo sozinho com o mesmo "codigo do item" que aparece na
// coluna Codigo da tela Produtos Cadastrados para essa cor/tamanho. Se a
// combinacao ainda nao tiver um codigo cadastrado, o campo fica em branco -
// nunca mostra o codigo de outro tamanho/cor por engano.
function updateManualCodeFromSelection() {
  const product = catalogProducts.find((p) => p.code === manualProductSelect.value);
  const variant = product && product.variants.find((v) => v.id === manualColorSelect.value);
  const size = manualSizeSelect.value;
  const itemCode = variant && size ? (variant.itemCodes && variant.itemCodes[size]) || '' : '';
  manualCodeInput.value = itemCode;
  manualCodeInput.classList.remove('input-error');
}

// "showError" so marca o campo em vermelho quando o admin realmente terminou
// de digitar (blur/Enter) - durante a digitacao (evento "input") o codigo
// ainda esta incompleto na maior parte do tempo, entao so preenche quando ja
// da pra achar uma correspondencia e nunca marca erro nesse meio-tempo.
function handleManualCodeLookup(showError) {
  const value = manualCodeInput.value.trim();
  if (!value) {
    manualCodeInput.classList.remove('input-error');
    return;
  }
  const match = findByItemCode(value) || findByProductCode(value);
  if (match) {
    applyCodeMatch(match);
    manualCodeInput.classList.remove('input-error');
  } else if (showError) {
    manualCodeInput.classList.add('input-error');
  } else {
    manualCodeInput.classList.remove('input-error');
  }
}

manualCodeInput.addEventListener('input', () => handleManualCodeLookup(false));
manualCodeInput.addEventListener('change', () => handleManualCodeLookup(true));
manualCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleManualCodeLookup(true);
  }
});

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

  manualCodeInput.value = '';
  manualCodeInput.classList.remove('input-error');
  manualQuantityInput.value = '1';
  manualUnitPriceInput.value = '';
  renderItems();
});

// -------------------- Rateio do frete / desconto --------------------
// Mesma logica proporcional para os dois: cada item recebe uma fatia do
// valor do cabecalho de acordo com o seu peso no subtotal da nota (qtd x
// valor unitario). O ultimo item absorve a diferenca de arredondamento, para
// a soma das fatias bater exatamente com o valor digitado no cabecalho.
function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeProportionalShares(lineList, amount) {
  const subtotals = lineList.map((l) => l.quantity * l.unitPrice);
  const total = subtotals.reduce((a, b) => a + b, 0);
  const shares = lineList.map((l, i) => (amount > 0 && total > 0 ? round2(amount * (subtotals[i] / total)) : 0));
  if (amount > 0 && total > 0 && shares.length) {
    const allocated = round2(shares.reduce((a, b) => a + b, 0));
    shares[shares.length - 1] = round2(shares[shares.length - 1] + round2(amount - allocated));
  }
  return shares;
}

function computeFreightShares(lineList, freight) {
  return computeProportionalShares(lineList, freight);
}

function computeDiscountShares(lineList, desconto) {
  return computeProportionalShares(lineList, desconto);
}

function currentFreight() {
  const v = Number(headerFreteInput.value);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function currentDesconto() {
  const v = Number(headerDescontoInput.value);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

// -------------------- Comissao --------------------
// So um numero entre 0 e 100 vale como percentual valido - vazio ou fora
// dessa faixa conta como "sem comissao" (nao trava o lancamento da nota).
function currentComissaoPercentual() {
  const raw = headerComissaoInput.value.trim();
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

// -------------------- Itens da nota --------------------
function renderItems() {
  linesCountEl.textContent = lines.length;
  emptyItemsHint.hidden = lines.length > 0;

  const freight = currentFreight();
  const desconto = currentDesconto();
  const freightShares = computeFreightShares(lines, freight);
  const discountShares = computeDiscountShares(lines, desconto);

  itemsTableBody.innerHTML = lines
    .map((l, i) => {
      const share = freightShares[i];
      const discountShare = discountShares[i];
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
          <td data-cell="discount">${currency.format(discountShare)}</td>
          <td data-cell="subtotal">${currency.format(subtotal)}</td>
          <td><button type="button" class="icon-btn" data-action="remove-line" aria-label="Remover item">✕</button></td>
        </tr>
      `;
    })
    .join('');

  const subtotalSum = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  totalsSubtotalEl.textContent = currency.format(subtotalSum);
  totalsFreightEl.textContent = currency.format(freight);
  totalsDiscountEl.textContent = currency.format(desconto);
  totalsGrandEl.textContent = currency.format(round2(subtotalSum + freight - desconto));

  const comissaoPercentual = currentComissaoPercentual();
  if (comissaoPercentual !== null) {
    totalsCommissionWrap.hidden = false;
    totalsCommissionEl.textContent = currency.format(round2(subtotalSum * (comissaoPercentual / 100)));
  } else {
    totalsCommissionWrap.hidden = true;
  }
}

headerFreteInput.addEventListener('input', renderItems);
headerDescontoInput.addEventListener('input', renderItems);
headerComissaoInput.addEventListener('input', renderItems);

itemsTableBody.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-action="remove-line"]');
  if (!removeBtn) return;
  const row = removeBtn.closest('tr[data-uid]');
  lines = lines.filter((l) => l.uid !== row.dataset.uid);
  renderItems();
});

// -------------------- Numero da nota (sequencial automatico) --------------------
// O campo "Nro da nota" e so-leitura na tela: em vez do admin digitar,
// calculamos o proximo numero como o maior "nf" numerico ja usado em vendas
// anteriores + 1 (o mesmo "allMovementsForNotes" carregado abaixo para a
// grade de Notas de venda). NF antigas nao-numericas (ex.: importadas de
// outro sistema) sao ignoradas nesse calculo, mas nao atrapalham.
function computeNextSaleNoteNumber() {
  let maxN = 0;
  allMovementsForNotes.forEach((m) => {
    if (m.type !== 'sale' || !m.nf) return;
    const n = Number(String(m.nf).trim());
    if (Number.isFinite(n) && n > maxN) maxN = n;
  });
  return maxN + 1;
}

function setNextHeaderNf() {
  headerNfInput.value = String(computeNextSaleNoteNumber());
}

// -------------------- Notas de venda (agrupadas por NF) --------------------
// Mesma grade que existia na tela "Compras, vendas e estoque" (agora
// "Estoque e Movimentações"), movida para ca. Agrupa por numero de NF, uma
// linha por nota em vez de uma linha por item - so movimentacoes com NF
// preenchida entram aqui.
function groupMovementsByNote() {
  const map = new Map();
  allMovementsForNotes.forEach((m) => {
    if (m.type !== 'sale' || !m.nf || m.cancelled) return;
    if (!map.has(m.nf)) {
      map.set(m.nf, { nf: m.nf, subtotal: 0, freight: 0, party: null, createdAt: m.createdAt });
    }
    const entry = map.get(m.nf);
    entry.subtotal += m.totalPrice || 0;
    entry.freight += m.freightShare || 0;
    if (!entry.party) {
      entry.party = m.customer && m.customer.name ? m.customer.name : null;
    }
    if (m.createdAt && (!entry.createdAt || m.createdAt > entry.createdAt)) entry.createdAt = m.createdAt;
  });
  return Array.from(map.values())
    .map((e) => ({ ...e, subtotal: round2(e.subtotal), freight: round2(e.freight), total: round2(e.subtotal + e.freight) }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function renderSaleNotesGrid() {
  const notes = groupMovementsByNote();
  if (notes.length === 0) {
    saleNotesTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhuma nota de venda encontrada.</td></tr>';
    return;
  }
  const rowsHtml = notes
    .map(
      (n) => `
        <tr>
          <td>${escapeHtml(n.nf)}</td>
          <td>${currency.format(n.total)}</td>
          <td>${currency.format(n.freight)}</td>
          <td>${escapeHtml(n.party || '-')}</td>
          <td class="row-actions">
            <a class="btn btn-ghost btn-sm" href="/admin/ver-nota.html?type=sale&nf=${encodeURIComponent(n.nf)}">Ver nota</a>
            <button type="button" class="btn btn-danger btn-sm" data-action="cancel-note" data-nf="${escapeHtml(n.nf)}">Cancelar nota</button>
          </td>
        </tr>
      `
    )
    .join('');

  const totalGeral = round2(notes.reduce((sum, n) => sum + n.total, 0));
  const totalFrete = round2(notes.reduce((sum, n) => sum + n.freight, 0));
  const totalsRowHtml = `
    <tr class="notes-totals-row">
      <td>Total (${notes.length} ${notes.length === 1 ? 'nota' : 'notas'})</td>
      <td>${currency.format(totalGeral)}</td>
      <td>${currency.format(totalFrete)}</td>
      <td></td>
      <td></td>
    </tr>
  `;

  saleNotesTableBody.innerHTML = rowsHtml + totalsRowHtml;
}

// Cancela a nota inteira de uma vez (todos os itens ainda ativos daquela
// NF), em vez de precisar cancelar item por item na tela de Historico de
// movimentacoes. Devolve a quantidade de cada item ao estoque, do mesmo
// jeito que cancelar um item avulso.
saleNotesTableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="cancel-note"]');
  if (!btn) return;

  const nf = btn.dataset.nf;
  if (!confirm(`Cancelar a nota de venda ${nf} inteira? Todos os itens ainda ativos dessa nota serao cancelados e a quantidade sera devolvida ao estoque.`)) {
    return;
  }

  btn.disabled = true;
  try {
    const res = await authedFetch('/api/stock/notes/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sale', nf }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao cancelar a nota.');
      btn.disabled = false;
      return;
    }
    await Promise.all([loadCatalog(), loadAllMovementsForNotes()]);
  } catch (err) {
    alert('Erro de conexao com o servidor.');
    btn.disabled = false;
  }
});

// Busca TODAS as movimentacoes (paginando em lotes de 300, o maximo aceito
// pela API por chamada) para alimentar a grade de notas e o calculo do
// proximo numero de nota. Para uma loja pequena isso costuma ser 1-2
// chamadas; o limite de 20 paginas (ate 6000 movimentacoes) e so uma trava
// de seguranca contra um loop infinito.
async function loadAllMovementsForNotes() {
  const collected = [];
  let before = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: '300' });
    if (before) params.set('before', before);
    // eslint-disable-next-line no-await-in-loop
    const res = await authedFetch(`/api/stock/movements?${params.toString()}`);
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();
    const items = data.items || [];
    collected.push(...items);
    if (items.length < 300) break;
    before = items[items.length - 1].createdAt;
  }
  allMovementsForNotes = collected;
  renderSaleNotesGrid();
}

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
  if (!headerNfInput.value.trim()) {
    showFinalizeMessage('Informe o numero da nota antes de finalizar.', 'error');
    headerNfInput.focus();
    return;
  }

  const nf = headerNfInput.value.trim() || null;
  const invoiceDate = headerDataNfInput.value ? new Date(headerDataNfInput.value).toISOString() : null;
  const cliente = headerClienteInput.value.trim() || null;
  const vendedor = headerVendedorInput.value.trim() || null;
  const comissaoPercentual = currentComissaoPercentual();
  const freight = currentFreight();
  const desconto = currentDesconto();
  const freightShares = computeFreightShares(lines, freight);
  const discountShares = computeDiscountShares(lines, desconto);

  const payload = {
    lines: lines.map((l, i) => ({
      productCode: l.productCode,
      variantId: l.variantId,
      size: l.size,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      freightShare: freightShares[i],
      discountShare: discountShares[i],
      nf,
      invoiceDate,
      cliente,
      vendedor,
      comissaoPercentual,
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
      await Promise.all([loadCatalog(), loadAllMovementsForNotes()]);
      return;
    }

    if (!res.ok) {
      showFinalizeMessage(data.error || 'Erro ao finalizar a nota.', 'error');
      return;
    }

    lines = [];
    headerDataNfInput.value = '';
    headerClienteInput.value = '';
    headerFreteInput.value = '0';
    headerDescontoInput.value = '0';
    headerVendedorInput.value = '';
    headerComissaoInput.value = '';
    renderItems();
    showFinalizeMessage(`Nota de venda lancada com sucesso: ${data.summary.movementsCreated} venda(s) registrada(s).`, 'success');
    // Recarrega o catalogo (estoque atualizado) e as movimentacoes (grade de
    // Notas de venda) e so ai calcula o proximo numero de nota - precisa ser
    // depois do reload, senao a nota que acabou de ser lancada ainda nao
    // entraria na conta e o proximo numero saira repetido.
    await Promise.all([loadCatalog(), loadAllMovementsForNotes()]);
    setNextHeaderNf();
  } catch (err) {
    showFinalizeMessage('Erro de conexao com o servidor.', 'error');
  } finally {
    finalizeInFlight = false;
    finalizeBtn.disabled = false;
  }
});

// -------------------- Init --------------------
renderItems();
