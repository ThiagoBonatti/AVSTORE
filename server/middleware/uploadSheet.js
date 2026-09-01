const multer = require('multer');

// Upload da planilha (.xlsx) usada para importar produtos e notas de compra
// (ver server/importCatalog.js). Em memoria, igual as imagens de produto -
// nao gravamos nada em disco local.
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // alguns navegadores/SO mandam isso para .xlsx
]);

function fileFilter(req, file, cb) {
  const isXlsxExtension = /\.xlsx$/i.test(file.originalname || '');
  if (!ALLOWED_MIME.has(file.mimetype) && !isXlsxExtension) {
    return cb(new Error('Formato de arquivo invalido. Envie uma planilha .xlsx.'));
  }
  cb(null, true);
}

const uploadSheet = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

module.exports = { uploadSheet };
