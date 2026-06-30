// =============================================================================
// Camada de billing/assinatura (F9.1) — provider-agnóstica.
// -----------------------------------------------------------------------------
// Cobra das IGREJAS (assinatura da plataforma), distinta do gateway de doações
// (paymentGateway.js, que move dinheiro das ofertas). Default: Stripe (padrão de
// SaaS). Sem credenciais, opera em modo `mock`: o checkout ativa o plano na hora,
// para exercitar o fluxo de feature-gating sem cobrar de verdade.
//
// ⚠️ CREDENCIAIS SÃO SUAS. Defina manualmente (sem valores fictícios):
//   BILLING_PROVIDER        (opcional) 'stripe' (default quando há chave) | 'mock'
//   STRIPE_SECRET_KEY       chave secreta da conta Stripe (server-side)
//   STRIPE_WEBHOOK_SECRET   segredo do endpoint de webhook
//   BILLING_SUCCESS_URL     (opcional) URL de retorno após o checkout
//
// Interface:
//   isConfigured() -> boolean
//   getProviderName() -> string
//   createCheckout({ plan, churchId, customerEmail }) -> { url, providerSubId, status, immediate }
//   cancelSubscription(providerSubId) -> { status }
//   parseWebhookEvent(body) -> { churchId, plan, status, providerSubId }
// =============================================================================

const PROVIDER = (process.env.BILLING_PROVIDER || '').trim().toLowerCase();
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const SUCCESS_URL = (process.env.BILLING_SUCCESS_URL || '').trim();

// Sem chave Stripe (ou BILLING_PROVIDER=mock), caímos no mock: ativa na hora.
function useMock() {
  return PROVIDER === 'mock' || !STRIPE_KEY;
}

const mockProvider = {
  name: 'mock',
  async createCheckout({ plan }) {
    // Mock ativa imediatamente — sem redirecionar para um checkout real.
    return {
      url: null,
      providerSubId: `mocksub_${plan}_${Date.now()}`,
      status: 'active',
      immediate: true,
    };
  },
  async cancelSubscription() {
    return { status: 'canceled' };
  },
  parseWebhookEvent(body) {
    return {
      churchId: body?.churchId || null,
      plan: body?.plan || null,
      status: body?.status || 'active',
      providerSubId: body?.providerSubId || null,
    };
  },
};

// Stripe: estrutura pronta; a integração HTTP real (Checkout Session) é feita na
// conversa que ativar o billing com credenciais. Sem a chave, nunca é chamado.
const stripeProvider = {
  name: 'stripe',
  async createCheckout({ plan, churchId, customerEmail }) {
    // Placeholder consciente: a chamada real à API do Stripe (Checkout Session)
    // entra quando STRIPE_SECRET_KEY estiver definido e validado. Mantemos a
    // assinatura estável para o service não precisar mudar.
    void plan; void churchId; void customerEmail; void SUCCESS_URL;
    return { url: null, providerSubId: null, status: 'pending', immediate: false };
  },
  async cancelSubscription() {
    return { status: 'canceled' };
  },
  parseWebhookEvent(body) {
    const meta = body?.data?.object?.metadata || {};
    return {
      churchId: meta.churchId || null,
      plan: meta.plan || null,
      status: body?.type === 'customer.subscription.deleted' ? 'canceled' : 'active',
      providerSubId: body?.data?.object?.id || null,
    };
  },
};

function getProvider() {
  return useMock() ? mockProvider : stripeProvider;
}

function isConfigured() {
  return useMock() || Boolean(STRIPE_KEY);
}

module.exports = {
  isConfigured,
  getProviderName: () => getProvider().name,
  createCheckout: (params) => getProvider().createCheckout(params),
  cancelSubscription: (id) => getProvider().cancelSubscription(id),
  parseWebhookEvent: (body) => getProvider().parseWebhookEvent(body),
};
