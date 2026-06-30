const express = require('express');
const cors = require('cors');

const { buildCorsOptions } = require('./lib/cors');
const { authenticate } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const publicRoutes = require('./routes/publicRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const auditRoutes = require('./routes/auditRoutes');
const ministryRoutes = require('./routes/ministryRoutes');
const musicRoutes = require('./routes/musicRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const memberRoutes = require('./routes/memberRoutes');
const familyRoutes = require('./routes/familyRoutes');
const secretariaRoutes = require('./routes/secretariaRoutes');
const eventRoutes = require('./routes/eventRoutes');
const ensinoRoutes = require('./routes/ensinoRoutes');
const comunicacaoRoutes = require('./routes/comunicacaoRoutes');
const finPublicRoutes = require('./routes/finPublicRoutes');
const financeiroRoutes = require('./routes/financeiroRoutes');
const givingRoutes = require('./routes/givingRoutes');
const bibleRoutes = require('./routes/bibleRoutes');
const platformRoutes = require('./routes/platformRoutes');
const domainRoutes = require('./routes/domainRoutes');
const lgpdRoutes = require('./routes/lgpdRoutes');
const billingRoutes = require('./routes/billingRoutes');
const meRoutes = require('./routes/meRoutes');
const intelligenceRoutes = require('./routes/intelligenceRoutes');

// Monta a aplicacao Express (sem subir o servidor). Mantido separado do
// bootstrap para permitir testes que exercitam o app sem abrir porta/conexao.
function createApp() {
  const app = express();
  const corsOptions = buildCorsOptions();

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));

  // Rotas publicas (health, raiz, /api/public, onboarding, register).
  // Precisam vir ANTES do middleware authenticate para nao exigirem token.
  app.use(publicRoutes);
  // Pagamentos públicos (página de doação + webhook do gateway, Fase 6).
  app.use(finPublicRoutes);

  // ===========================================================================
  // A PARTIR DAQUI TODAS AS ROTAS /api EXIGEM AUTENTICACAO (Supabase JWT).
  // req.user e req.churchId sao derivados do token, nunca de input do cliente.
  // ===========================================================================
  app.use('/api', authenticate);
  app.use('/api', sessionRoutes);
  app.use('/api', userRoutes);
  app.use('/api', roleRoutes);
  app.use('/api', auditRoutes);
  app.use('/api', ministryRoutes);
  app.use('/api', musicRoutes);
  app.use('/api', scheduleRoutes);
  app.use('/api', memberRoutes);
  app.use('/api', familyRoutes);
  app.use('/api', secretariaRoutes);
  app.use('/api', eventRoutes);
  app.use('/api', ensinoRoutes);
  app.use('/api', comunicacaoRoutes);
  app.use('/api', financeiroRoutes);
  app.use('/api', givingRoutes);
  app.use('/api', bibleRoutes);
  app.use('/api', platformRoutes);
  app.use('/api', domainRoutes);
  app.use('/api', lgpdRoutes);
  app.use('/api', billingRoutes);
  app.use('/api', meRoutes);
  app.use('/api', intelligenceRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
