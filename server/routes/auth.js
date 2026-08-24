const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/me - o login em si acontece no navegador via Firebase
// Authentication (ver public/admin/login.html). Esta rota apenas confirma
// que o ID token enviado e valido e pertence a um usuario com a claim
// "admin: true", usada pelo painel para decidir se deve seguir para o
// dashboard ou voltar para a tela de login.
router.get('/me', requireAuth, (req, res) => {
  res.json({ authenticated: true, email: req.admin.email });
});

module.exports = router;
