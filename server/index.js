require('dotenv').config({ override: true });

const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const stockRoutes = require('./routes/stock');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// Necessario em plataformas como o Render, que colocam a aplicacao atras de
// um proxy reverso — sem isso, req.protocol/req.ip refletiriam o proxy
// interno em vez da conexao real do visitante.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check simples, usado pelo Render (e por qualquer monitor externo)
// para saber se a aplicacao esta de pe.
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stock', stockRoutes);

// Arquivos estaticos da area publica e do painel administrativo.
// Diferente da versao anterior (sessao de servidor), a autenticacao agora e
// feita pelo Firebase Authentication no navegador: a pagina do dashboard e
// servida normalmente para qualquer um, mas o JavaScript dela (public/admin/js/admin.js)
// verifica o estado de login via onAuthStateChanged e redireciona quem nao
// estiver autenticado como admin. A protecao "de verdade" (dados) acontece
// nas rotas de escrita da API acima, que exigem um ID token valido com a
// claim "admin: true" (ver server/middleware/auth.js).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (err && err.message && (err.message.includes('imagem') || err.message.includes('planilha'))) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const isSheetUpload = req.path && req.path.includes('/import/');
    return res.status(400).json({
      error: isSheetUpload ? 'Planilha muito grande. Tamanho maximo: 15MB.' : 'Imagem muito grande. Tamanho maximo: 5MB.',
    });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

app.listen(PORT, () => {
  console.log(`AVSTORE rodando em http://localhost:${PORT}`);
  console.log(`Loja:  http://localhost:${PORT}/`);
  console.log(`Admin: http://localhost:${PORT}/admin/login.html`);
});
