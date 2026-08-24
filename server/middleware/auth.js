const { auth } = require('../firebase');

// Middleware que protege rotas exigindo um ID token valido do Firebase
// Authentication, emitido para um usuario com a custom claim "admin: true".
// O frontend envia o token no header: Authorization: Bearer <idToken>
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Nao autenticado. Faca login para continuar.' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);

    if (!decoded.admin) {
      return res
        .status(403)
        .json({ error: 'Este usuario nao tem permissao de administrador.' });
    }

    req.admin = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessao invalida ou expirada. Faca login novamente.' });
  }
}

module.exports = { requireAuth };
