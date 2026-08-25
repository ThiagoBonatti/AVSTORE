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

// Cada produto de exemplo ja nasce com 1-2 variacoes de cor, cada uma com
// seus proprios tamanhos e sua propria imagem placeholder — para refletir o
// novo modelo de dados (variants) usado pelo cadastro de produtos.
const sampleProducts = [
  {
    code: 'CAM-001',
    description: 'Camiseta Basica Algodao',
    category: 'Camisetas',
    price: 59.9,
    variants: [
      { id: 'branco', color: 'Branco', sizes: ['P', 'M', 'G'], bg: '#2c3e50' },
      { id: 'preto', color: 'Preto', sizes: ['M', 'G', 'GG'], bg: '#1c1c1c' },
    ],
  },
  {
    code: 'CAM-003',
    description: 'Camiseta Estampada Vintage',
    category: 'Camisetas',
    price: 69.9,
    variants: [{ id: 'azul', color: 'Azul', sizes: ['P', 'M'], bg: '#2980b9' }],
  },
  {
    code: 'CAL-001',
    description: 'Calca Jeans Slim',
    category: 'Calcas',
    price: 149.9,
    variants: [{ id: 'azul', color: 'Azul', sizes: ['38', '40', '42'], bg: '#34495e' }],
  },
  {
    code: 'CAL-002',
    description: 'Calca Jogger Moletom',
    category: 'Calcas',
    price: 119.9,
    variants: [
      { id: 'cinza', color: 'Cinza', sizes: ['P', 'M', 'G'], bg: '#7f8c8d' },
      { id: 'preto', color: 'Preto', sizes: ['M', 'G'], bg: '#111111' },
    ],
  },
  {
    code: 'JAQ-001',
    description: 'Jaqueta Corta-Vento',
    category: 'Jaquetas',
    price: 199.9,
    variants: [{ id: 'verde', color: 'Verde', sizes: ['G', 'GG'], bg: '#27ae60' }],
  },
  {
    code: 'JAQ-002',
    description: 'Jaqueta Jeans',
    category: 'Jaquetas',
    price: 219.9,
    variants: [{ id: 'azul', color: 'Azul', sizes: ['M'], bg: '#3b6ea5' }],
  },
  {
    code: 'VES-001',
    description: 'Vestido Midi Estampado',
    category: 'Vestidos',
    price: 179.9,
    variants: [{ id: 'vermelho', color: 'Vermelho', sizes: ['P', 'M'], bg: '#c0392b' }],
  },
  {
    code: 'VES-002',
    description: 'Vestido Longo Verao',
    category: 'Vestidos',
    price: 189.9,
    variants: [{ id: 'amarelo', color: 'Amarelo', sizes: ['M'], bg: '#f1c40f' }],
  },
  {
    code: 'TEN-001',
    description: 'Tenis Casual Urbano',
    category: 'Calcados',
    price: 249.9,
    variants: [
      { id: 'branco', color: 'Branco', sizes: ['39', '40', '41'], bg: '#95a5a6' },
      { id: 'preto', color: 'Preto', sizes: ['41', '42'], bg: '#000000' },
    ],
  },
];

async function seedProducts() {
  let created = 0;

  for (const p of sampleProducts) {
    const docRef = productsRef.doc(p.code);
    const existing = await docRef.get();
    if (existing.exists) continue;

    const variants = [];
    for (const v of p.variants) {
      const svg = makePlaceholderSvg(`${p.description} - ${v.color}`, v.bg);
      const fakeFile = {
        buffer: Buffer.from(svg, 'utf8'),
        mimetype: 'image/svg+xml',
        originalname: `${p.code}-${v.id}.svg`,
      };
      const { url, storagePath } = await uploadProductImage(p.code, v.id, fakeFile);
      variants.push({ id: v.id, color: v.color, sizes: v.sizes, imageUrl: url, imagePath: storagePath });
    }

    const colors = variants.map((v) => v.color);
    const sizes = [...new Set(variants.flatMap((v) => v.sizes))];

    await docRef.create({
      description: p.description,
      category: p.category,
      price: p.price,
      variants,
      colors,
      sizes,
      searchKeywords: buildSearchKeywords(p.code, p.description),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await filtersDocRef.set(
      {
        categories: FieldValue.arrayUnion(p.category),
        colors: FieldValue.arrayUnion(...colors),
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
