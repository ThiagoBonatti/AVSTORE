// Carrinho de compras persistido em localStorage.
// Cada item: { code, description, price, imageUrl, size, color, qty }
// "code" e o identificador unico do produto (mesmo ID usado no Firestore).

const CART_STORAGE_KEY = 'avstore_cart';

const Cart = {
  items: [],

  load() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch (e) {
      this.items = [];
    }
    return this.items;
  },

  save() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(this.items));
    document.dispatchEvent(new CustomEvent('cart:changed', { detail: this.items }));
  },

  add(product, qty = 1) {
    const existing = this.items.find((i) => i.code === product.code);
    if (existing) {
      existing.qty += qty;
    } else {
      this.items.push({
        code: product.code,
        description: product.description,
        price: product.price,
        imageUrl: product.imageUrl,
        size: product.size,
        color: product.color,
        qty,
      });
    }
    this.save();
  },

  updateQty(code, qty) {
    const item = this.items.find((i) => i.code === code);
    if (!item) return;
    if (qty <= 0) {
      this.remove(code);
      return;
    }
    item.qty = qty;
    this.save();
  },

  remove(code) {
    this.items = this.items.filter((i) => i.code !== code);
    this.save();
  },

  clear() {
    this.items = [];
    this.save();
  },

  totalItems() {
    return this.items.reduce((sum, i) => sum + i.qty, 0);
  },

  totalPrice() {
    return this.items.reduce((sum, i) => sum + i.qty * i.price, 0);
  },
};

Cart.load();

function formatBRL(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
