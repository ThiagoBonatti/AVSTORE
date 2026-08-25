const path = require('path');
const crypto = require('crypto');
const { bucket } = require('./firebase');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

// Envia a imagem de uma variacao (cor) de um produto para o Firebase Storage
// e retorna uma URL publica de download (com token, no mesmo formato usado
// pelo SDK do Firebase). O token concede acesso de leitura ao arquivo mesmo
// com as Storage Rules bloqueando leitura/escrita para clientes (ver
// storage.rules). "variantId" identifica a variacao (cor) dentro do produto,
// ja que agora cada cor tem sua propria imagem.
async function uploadProductImage(code, variantId, file) {
  const ext = path.extname(file.originalname || '').toLowerCase() || EXT_BY_MIME[file.mimetype] || '';
  const token = crypto.randomUUID();
  const storagePath = `products/${code}-${variantId}-${Date.now()}${ext}`;
  const blob = bucket.file(storagePath);

  await blob.save(file.buffer, {
    contentType: file.mimetype,
    metadata: {
      contentType: file.mimetype,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;

  return { storagePath, url };
}

async function deleteProductImage(storagePath) {
  if (!storagePath) return;
  try {
    await bucket.file(storagePath).delete();
  } catch (err) {
    // Ignora "arquivo nao encontrado" (ja pode ter sido removido antes)
    if (err.code !== 404) {
      console.error('Erro ao remover imagem do Storage:', err.message);
    }
  }
}

module.exports = { uploadProductImage, deleteProductImage };
