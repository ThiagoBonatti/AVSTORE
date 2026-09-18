// Carrinho de compras da AVSTORE.
//
// Acumula os produtos que o cliente clica em "Comprar" (persistidos no
// localStorage, entao sobrevivem a um refresh da pagina) ate ele clicar em
// "Finalizar pedido", quando o carrinho inteiro vira uma unica mensagem
// enviada pelo WhatsApp (ver public/js/store.js, funcao
// buildWhatsAppOrderUrl). Este objeto so guarda e soma os itens; quem
// desenha a UI e monta a mensagem e o store.js.
window.Cart = (function () {
  const STORAGE_KEY = 'avstore_cart_v1';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      // localStorage indisponivel (modo privado, quota cheia etc.) - o
      // carrinho continua funcionando normalmente, so nao sobrevive a um
      // refresh da pagina.
    }
  }

  let items = load();
  const listeners = [];

  function notify() {
    persist();
    listeners.forEach((fn) => {
      try { fn(items.slice()); } catch (e) { /* listener com erro nao derruba o carrinho */ }
    });
  }

  // Chave que identifica de forma unica uma variacao de produto no
  // carrinho (mesmo produto em cor/tamanho diferentes = linhas diferentes).
  function keyFor(item) {
    return [item.code, item.color, item.size].join('__');
  }

  function addItem(item, qty) {
    const key = keyFor(item);
    const existing = items.find((i) => keyFor(i) === key);
    const addQty = Math.max(1, Math.round(qty || item.qty || 1));
    if (existing) {
      existing.qty += addQty;
    } else {
      items.push(Object.assign({}, item, { qty: addQty }));
    }
    notify();
  }

  function removeItem(key) {
    items = items.filter((i) => keyFor(i) !== key);
    notify();
  }

  function setQty(key, qty) {
    const item = items.find((i) => keyFor(i) === key);
    if (!item) return;
    const next = Math.round(qty);
    if (!next || next < 1) {
      removeItem(key);
      return;
    }
    item.qty = next;
    notify();
  }

  function clear() {
    items = [];
    notify();
  }

  function getItems() {
    return items.slice();
  }

  function getCount() {
    return items.reduce((sum, i) => sum + i.qty, 0);
  }

  function getTotal() {
    return items.reduce((sum, i) => sum + i.qty * (Number(i.price) || 0), 0);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  return { addItem, removeItem, setQty, clear, getItems, getCount, getTotal, onChange, keyFor };
})();
