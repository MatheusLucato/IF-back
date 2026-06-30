const express = require('express');
const { randomUUID } = require('crypto');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { onboardingSchema } = require('../schemas/authSchemas');
const { inviteRegisterSchema } = require('../schemas/inviteLinkSchemas');
const { USER_SELECT } = require('../lib/constants');
const { mapChurch, mapUser } = require('../lib/mappers');
const { slugify } = require('../lib/normalizers');
const { getChurchBundle, createAuthUser } = require('../services/churchService');
const { ensureMemberForUser } = require('../services/memberService');
const { getInviteByToken, registerViaInvite } = require('../services/inviteLinkService');
const { publicRegistrationSchema } = require('../schemas/eventSchemas');
const eventService = require('../services/eventService');

const router = express.Router();
const supabase = getSupabase();

// Resolve a igreja (tenant) pelo slug para as rotas públicas de eventos.
async function resolveChurchBySlug(slug) {
  const { data } = await supabase.from('churches').select('id,name,trade_name,slug').eq('slug', slug).maybeSingle();
  return data || null;
}

router.get('/health', asyncHandler(async (_req, res) => {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    throw new Error(error.message);
  }
  res.json({ ok: true, service: 'IF-back', db: 'connected', time: new Date().toISOString() });
}));

router.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'IF-back',
    message: 'API online. Use /health para checar status e /api/* para rotas da aplicacao.',
    endpoints: {
      health: '/health',
    },
    time: new Date().toISOString(),
  });
});

// PUBLICO: resolve um convite por token (cadastro por LINK, 0042). Só devolve a
// identidade da igreja que está convidando — nenhuma outra igreja é exposta.
// 404 = token inexistente; 410 = convite expirado/esgotado/revogado.
router.get('/api/public/invites/:token', asyncHandler(async (req, res) => {
  const invite = await getInviteByToken(req.params.token);
  return res.json(invite);
}));

// PUBLICO: cadastro pessoal a partir de um convite. A igreja vem do token; o
// cliente nunca informa churchId. A conta nasce vinculada e aprovada.
router.post('/api/public/invites/:token/register', validate(inviteRegisterSchema), asyncHandler(async (req, res) => {
  const user = await registerViaInvite(req.params.token, req.body);
  return res.status(201).json({ user });
}));

// PUBLICO: resolve o tenant pelo HOST (F9.3). A SPA chama no boot quando servida
// por subdominio/dominio proprio para descobrir qual igreja carregar. Usa o header
// Host por padrao; aceita ?host= para testes. Retorna 404 silencioso (sem tenant).
router.get('/api/public/resolve-tenant', asyncHandler(async (req, res) => {
  const domainService = require('../services/domainService');
  const host = req.query.host || req.headers['x-forwarded-host'] || req.headers.host || '';
  const resolved = await domainService.resolveTenantByHost(host);
  if (!resolved) throw AppError.notFound('Tenant nao encontrado para este host.');
  return res.json(resolved);
}));

// PUBLICO: branding de uma igreja por slug (white label da area publica).
router.get('/api/public/churches/:slug', asyncHandler(async (req, res) => {
  const { data: church } = await supabase.from('churches').select('*').eq('slug', req.params.slug).maybeSingle();
  if (!church) throw AppError.notFound('Igreja nao encontrada.');
  const { settings } = await getChurchBundle(church.id);
  return res.json({ church: mapChurch(church), settings });
}));

// PUBLICO: manifest PWA por tenant (F0.9). Gera o manifest a partir do nome,
// cores e logo da igreja. A SPA (mesmo dominio) monta o manifest no cliente via
// Blob; esta rota serve cenarios standalone/por-slug (portal publico, app
// futuro). `FRONTEND_URL` (opcional) define a origem do app para start_url/scope
// e para o icone de fallback; sem ela, usamos caminhos relativos.
router.get('/api/public/:slug/manifest.json', asyncHandler(async (req, res) => {
  const { data: church } = await supabase
    .from('churches')
    .select('id,name,trade_name')
    .eq('slug', req.params.slug)
    .maybeSingle();
  if (!church) throw AppError.notFound('Igreja nao encontrada.');

  const { settings } = await getChurchBundle(church.id);

  const appBase = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  const startUrl = appBase ? `${appBase}/` : '/';
  const iconFallback = appBase ? `${appBase}/icon.svg` : '/icon.svg';
  const name = church.trade_name || church.name || 'Edifico';
  const themeColor = (settings && settings.colorPrimary) || '#0a0a0a';

  const icons = [];
  const logoUrl = settings && settings.logoUrl;
  if (logoUrl && /^https?:\/\//.test(logoUrl)) {
    icons.push({ src: logoUrl, sizes: '512x512 192x192', purpose: 'any' });
  }
  icons.push({ src: iconFallback, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' });

  const manifest = {
    name: `${name} · Edifico`,
    short_name: String(name).split(/\s+/)[0].slice(0, 30),
    description: `${name} — gestao da igreja com Edifico.`,
    id: startUrl,
    start_url: startUrl,
    scope: startUrl,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0c',
    theme_color: themeColor,
    lang: 'pt-BR',
    icons,
  };

  res.set('Content-Type', 'application/manifest+json; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  return res.send(JSON.stringify(manifest));
}));

// PUBLICO: detalhe de um evento publicado (página /e/:churchSlug/:eventSlug).
// F3.2 — só expõe eventos com is_published = true; nunca lista inscritos/tokens.
router.get('/api/public/churches/:churchSlug/events/:eventSlug', asyncHandler(async (req, res) => {
  const church = await resolveChurchBySlug(req.params.churchSlug);
  if (!church) throw AppError.notFound('Igreja nao encontrada.');
  const event = await eventService.getPublicEventBySlug(church.id, req.params.eventSlug);
  if (!event) throw AppError.notFound('Evento nao encontrado.');
  return res.json({
    church: { name: church.trade_name || church.name, slug: church.slug },
    event,
  });
}));

// PUBLICO: inscrição em um evento (F3.2). Sem login: cria um "lead". O backend
// usa service-role e valida que o evento aceita inscrições antes de gravar.
router.post(
  '/api/public/churches/:churchSlug/events/:eventSlug/register',
  validate(publicRegistrationSchema),
  asyncHandler(async (req, res) => {
    const church = await resolveChurchBySlug(req.params.churchSlug);
    if (!church) throw AppError.notFound('Igreja nao encontrada.');
    const eventRow = await eventService.getPublicEventBySlug(church.id, req.params.eventSlug);
    if (!eventRow) throw AppError.notFound('Evento nao encontrado.');

    // Recarrega a linha bruta para a checagem de capacidade/flags.
    const rawEvent = await eventService.getEventRow(eventRow.id, church.id);
    const registration = await eventService.addRegistration(rawEvent, church.id, req.body, { allowPublic: true });
    return res.status(201).json({
      registration: { id: registration.id, name: registration.name, status: registration.status },
    });
  }),
);

// PUBLICO: webhook do provedor de billing (F9.1). Confirma/cancela a assinatura
// da igreja. Idempotente. No modo mock nao ha assinatura de webhook; com Stripe,
// a verificacao de assinatura entra junto das credenciais.
router.post('/api/public/billing/webhook', asyncHandler(async (req, res) => {
  const billingProvider = require('../lib/billingProvider');
  const billing = require('../services/billingService');
  const event = billingProvider.parseWebhookEvent(req.body || {});
  const result = await billing.handleBillingEvent(event);
  return res.json({ received: true, ...result });
}));

// PUBLICO: onboarding — cria tenant (igreja) + admin + configuracoes.
router.post('/api/onboarding', validate(onboardingSchema), asyncHandler(async (req, res) => {
  const { admin, church, identity } = req.body;

  const email = String(admin.email).trim().toLowerCase();

  let slug = slugify(church.name);
  const { data: slugTaken } = await supabase.from('churches').select('id').eq('slug', slug).maybeSingle();
  if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  // 1. Auth user (Supabase Auth)
  const authUser = await createAuthUser(email, String(admin.password));

  // 2. Igreja (tenant)
  const { data: createdChurch, error: churchError } = await supabase
    .from('churches')
    .insert({
      name: String(church.name).trim(),
      trade_name: church.tradeName ? String(church.tradeName).trim() : String(church.name).trim(),
      city: church.city || null,
      state: church.state || null,
      country: church.country || 'Brasil',
      slug,
    })
    .select('*')
    .single();
  if (churchError) throw new Error(churchError.message);

  // 3. Configuracoes / identidade visual
  await supabase.from('church_settings').insert({
    church_id: createdChurch.id,
    logo_url: identity?.logoUrl || null,
    color_primary: identity?.colorPrimary || undefined,
    color_secondary: identity?.colorSecondary || undefined,
  });

  // 4. Profile admin vinculado
  const safeName = String(admin.name).trim();
  const { data: createdUser, error: userError } = await supabase
    .from('users')
    .insert({
      id: randomUUID(),
      name: safeName,
      full_name: safeName,
      email,
      password_hash: 'supabase-auth',
      role: 'admin',
      is_approved: true,
      auth_user_id: authUser.id,
      church_id: createdChurch.id,
    })
    .select(USER_SELECT)
    .single();
  if (userError) throw new Error(userError.message);

  // Invariante "1 user ⇒ 1 member" (F1.1): cria a pessoa correspondente ao admin.
  await ensureMemberForUser(createdUser, createdChurch.id);

  return res.status(201).json({ church: mapChurch(createdChurch), user: mapUser(createdUser) });
}));

module.exports = router;
