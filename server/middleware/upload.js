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

// Cada produto agora pode ter varias variacoes de cor, cada uma com sua
// propria imagem. O formulario envia um arquivo por variacao, com o nome do
// campo no formato "variantImage_<id>" (id gerado no admin/js/admin.js), por
// isso usamos upload.any() em vez de upload.single()/upload.array() — o
// numero e os nomes dos campos de arquivo variam de produto para produto.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 }, // 5MB por imagem, ate 20 variacoes
});

module.exports = { upload };
