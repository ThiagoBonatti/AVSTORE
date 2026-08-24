const multer = require('multer');

// As imagens sao recebidas em memoria (buffer) e enviadas diretamente ao
// Firebase Storage em server/storage.js — nao gravamos nada em disco local.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Formato de imagem invalido. Use JPG, PNG, WEBP ou GIF.'));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = { upload };
