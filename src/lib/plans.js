// =============================================================================
// Catálogo de planos (F9.1) — fonte única de verdade no código.
// -----------------------------------------------------------------------------
// Os planos definem PREÇO + LIMITES + recursos. O banco (subscriptions) só guarda
// QUAL plano cada igreja assina e o estado da cobrança. Limites com valor `null`
// = ilimitado. O feature gating consulta este catálogo via billingService.
// =============================================================================

const PLANS = [
  {
    key: 'free',
    name: 'Gratuito',
    priceCents: 0,
    description: 'Para começar a organizar a igreja.',
    limits: { members: 100, users: 5, ministries: 5 },
    features: ['Pessoas', 'Ministérios & Escalas', 'Eventos', 'Comunicação'],
  },
  {
    key: 'basic',
    name: 'Essencial',
    priceCents: 9900,
    description: 'A igreja crescendo, com finanças e ensino.',
    limits: { members: 500, users: 20, ministries: 20 },
    features: ['Tudo do Gratuito', 'Financeiro', 'Ensino (EBD)', 'Secretaria', 'Contribuições online'],
  },
  {
    key: 'pro',
    name: 'Pro',
    priceCents: 24900,
    description: 'Sem limites, com domínio próprio e app do membro.',
    limits: { members: null, users: null, ministries: null },
    features: ['Tudo do Essencial', 'Domínio próprio', 'App do membro (PWA)', 'Suporte prioritário'],
  },
];

const PLAN_BY_KEY = new Map(PLANS.map((p) => [p.key, p]));
const DEFAULT_PLAN_KEY = 'free';

function getPlan(key) {
  return PLAN_BY_KEY.get(key) || PLAN_BY_KEY.get(DEFAULT_PLAN_KEY);
}

function isValidPlanKey(key) {
  return PLAN_BY_KEY.has(key);
}

module.exports = { PLANS, DEFAULT_PLAN_KEY, getPlan, isValidPlanKey };
