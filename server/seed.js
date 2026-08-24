require('dotenv').config({ override: true });

const { db, auth, FieldValue } = require('./firebase');
const { uploadProductImage } = require('./storage');
const { buildSearchKeywords } = require('./searchKeywords');

const productsRef = db.collection('products');
const filtersDocRef = db.collection('meta').doc('catalog');

// --- Usuario admin -------------------------------------------------------
async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ADMIN_EMAIL/ADMIN_PASSWORD nao definidos no .env — pulando criacao do admin.');
    return;
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Usuario admin "${email}" ja existe (uid=${user.uid}).`);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`Usuario admin "${email}" criado (uid=${user.uid}) com a senha definida em ADMIN_PASSWORD.`);
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });
  console.log(`Custom claim "admin: true" garantida para ${email}.`);
}

// --- Imagem placeholder SVG (gerada em memoria, sem depender de imagens externas) ---
function makePlaceholderSvg(label, bgColor) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="${bgColor}"/>
  <text x="300" y="300" font-family="Arial, sans-serif" font-size="36" fill="#ffffff"
        text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>`;
}

const sampleProducts = [
  { code: 'CAM-001', description: 'Camiseta Basica Algodao', category: 'Camisetas', color: 'Branco', size: 'M', price: 59.9, bg: '#2c3e50' },
  { code: 'CAM-002', description: 'Camiseta Basica Algodao', category: 'Camisetas', color: 'Preto', size: 'G', price: 59.9, bg: '#1c1c1c' },
  { code: 'CAM-003', description: 'Camiseta Estampada Vintage', category: 'Camisetas', color: 'Azul', size: 'P', price: 69.9, bg: '#2980b9' },
  { code: 'CAL-001', description: 'Calca Jeans Slim', category: 'Calcas', color: 'Azul', size: '40', price: 149.9, bg: '#34495e' },
  { code: 'CAL-002', description: 'Calca Jogger Moletom', category: 'Calcas', color: 'Cinza', size: 'M', price: 119.9, bg: '#7f8c8d' },
  { code: 'CAL-003', description: 'Calca Sarja Reta', category: 'Calcas', color: 'Preto', size: '42', price: 139.9, bg: '#111111' },
  { code: 'JAQ-001', description: 'Jaqueta Corta-Vento', category: 'Jaquetas', color: 'Verde', size: 'G', price: 199.9, bg: '#27ae60' },
  { code: 'JAQ-002', description: 'Jaqueta Jeans', category: 'Jaquetas', color: 'Azul', size: 'M', price: 219.9, bg: '#3b6ea5' },
  { code: 'VES-001', description: 'Vestido Midi Estampado', category: 'Vestidos', color: 'Vermelho', size: 'P', price: 179.9, bg: '#c0392b' },
  { code: 'VES-002', description: 'Vestido Longo Verao', category: 'Vestidos', color: 'Amarelo', size: 'M', price: 189.9, bg: '#f1c40f' },
  { code: 'TEN-001', description: 'Tenis Casual Urbano', category: 'Calcados', color: 'Branco', size: '41', price: 249.9, bg: '#95a5a6' },
  { code: 'TEN-002', description: 'Tenis Esportivo Corrida', category: 'Calcados', color: 'Preto', size: '42', price: 279.9, bg: '#000000' },
];

async function seedProducts() {
  let created = 0;

  for (const p of sampleProducts) {
    const docRef = productsRef.doc(p.code);
    const existing = await docRef.get();
    if (existing.exists) continue;

    const svg = makePlaceholderSvg(p.description, p.bg);
    const fakeFile = {
      buffer: Buffer.from(svg, 'utf8'),
      mimetype: 'image/svg+xml',
      originalname: `${p.code}.svg`,
    };
    const { url, storagePath } = await uploadProductImage(p.code, fakeFile);

    await docRef.create({
      description: p.description,
      category: p.category,
      color: p.color,
      size: p.size,
      price: p.price,
      imageUrl: url,
      imagePath: storagePath,
      searchKeywords: buildSearchKeywords(p.code, p.description),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await filtersDocRef.set(
      {
        categories: FieldValue.arrayUnion(p.category),
        colors: FieldValue.arrayUnion(p.color),
      },
      { merge: true }
    );

    created += 1;
  }

  console.log(`Seed concluido: ${created} produto(s) de exemplo inserido(s).`);
}

(async () => {
  try {
    await ensureAdminUser();
    await seedProducts();
    process.exit(0);
  } catch (err) {
    console.error('Erro ao rodar o seed:', err);
    process.exit(1);
  }
})();
