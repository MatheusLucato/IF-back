const multer = require('multer');

// Upload em memoria (5 MB) usado por avatar/logo/imagem de ministerio antes de
// enviar ao Cloudflare R2 (services/storage.js).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = { upload };
