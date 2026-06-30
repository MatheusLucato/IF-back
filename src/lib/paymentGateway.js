// =============================================================================
// Camada de gateway de pagamento (Fase 6) — provider-agnóstica.
// -----------------------------------------------------------------------------
// Reaproveitada por doações online (F6.2/F6.3) e boletos (F5.7). A escolha do
// provedor é por env (default: Asaas, que cobre PIX + cartão + boleto num só
// integrador, popular entre igrejas no Brasil). Trocar de provedor = adicionar
// um objeto provider abaixo; o resto do sistema fala só com esta interface.
//
// ⚠️ CREDENCIAIS SÃO SUAS. Sem as env vars o gateway responde "não configurado"
//    com instrução clara — NUNCA usamos chaves fictícias. Defina manualmente:
//
//   PAYMENTS_PROVIDER       (opcional) 'asaas' (default) | 'mock'
//   PAYMENTS_API_KEY        chave de API do provedor (server-side)
//   PAYMENTS_WEBHOOK_SECRET token que valida os webhooks recebidos
//   PAYMENTS_ENV            (opcional) 'sandbox' (default) | 'production'
//
// Interface exposta:
//   isConfigured() -> boolean
//   getProviderName() -> string
//   createCharge({ method, amountCents, description, dueDate, donor }) -> charge
//   createSubscription({ amountCents, period, description, donor }) -> sub
//   verifyWebhook(req) -> boolean
//   parseWebhookEvent(body) -> { chargeId, subscriptionId, status, raw }
// =============================================================================

const { AppError } = require('./errors');

const PROVIDER = (process.env.PAYMENTS_PROVIDER || 'asaas').trim().toLowerCase();
const API_KEY = (process.env.PAYMENTS_API_KEY || '').trim();
const WEBHOOK_SECRET = (process.env.PAYMENTS_WEBHOOK_SECRET || '').trim();
const ENV = (process.env.PAYMENTS_ENV || 'sandbox').trim().toLowerCase();

function notConfigured() {
  return AppError.preconditionFailed(
    'Gateway de pagamento não configurado. Defina PAYMENTS_API_KEY (e PAYMENTS_WEBHOOK_SECRET) no ambiente do backend para habilitar doações online e boletos.',
  );
}

function reais(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

// --- Provider: Asaas ------------------------------------------------------
// Docs: https://docs.asaas.com — billingType PIX | CREDIT_CARD | BOLETO.
const ASAAS_BASE = ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://api-sandbox.asaas.com/v3';

async function asaasFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: API_KEY,
      'User-Agent': 'Edifico',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || `Falha no gateway (${res.status}).`;
    throw AppError.badRequest(`Gateway: ${msg}`);
  }
  return data;
}

// Cria/garante um cliente no Asaas a partir dos dados do doador.
async function asaasEnsureCustomer(donor) {
  const payload = {
    name: donor.name || 'Doador',
    email: donor.email || undefined,
    cpfCnpj: donor.document || undefined,
  };
  const customer = await asaasFetch('/customers', { method: 'POST', body: payload });
  return customer.id;
}

// Mapa de status do Asaas → status interno da doação/boleto.
function asaasMapStatus(status) {
  const s = String(status || '').toUpperCase();
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(s)) return 'paid';
  if (['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED'].includes(s)) return 'refunded';
  if (['OVERDUE'].includes(s)) return 'pending';
  if (['DELETED', 'CANCELLED'].includes(s)) return 'cancelled';
  return 'pending';
}

const asaasProvider = {
  name: 'asaas',

  async createCharge({ method, amountCents, description, dueDate, donor }) {
    const customerId = await asaasEnsureCustomer(donor || {});
    const billingType = method === 'credit_card' ? 'CREDIT_CARD' : method === 'boleto' ? 'BOLETO' : 'PIX';
    const payment = await asaasFetch('/payments', {
      method: 'POST',
      body: {
        customer: customerId,
        billingType,
        value: reais(amountCents),
        dueDate: dueDate || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        description: description || 'Contribuição',
      },
    });

    const out = {
      provider: 'asaas',
      chargeId: payment.id,
      status: asaasMapStatus(payment.status),
      checkoutUrl: payment.invoiceUrl || null,
      bankSlipUrl: payment.bankSlipUrl || null,
      digitableLine: payment.identificationField || null,
      barcode: payment.barCode || null,
      pixPayload: null,
      pixQrImage: null,
    };

    // PIX: busca o QR/copia-e-cola num segundo passo.
    if (billingType === 'PIX') {
      try {
        const qr = await asaasFetch(`/payments/${payment.id}/pixQrCode`);
        out.pixPayload = qr.payload || null;
        out.pixQrImage = qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null;
      } catch {
        // QR pode ainda não estar pronto; o front pode reconsultar via status.
      }
    }
    return out;
  },

  async createSubscription({ amountCents, period, description, donor }) {
    const customerId = await asaasEnsureCustomer(donor || {});
    const cycle = period === 'weekly' ? 'WEEKLY' : period === 'yearly' ? 'YEARLY' : 'MONTHLY';
    const sub = await asaasFetch('/subscriptions', {
      method: 'POST',
      body: {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: reais(amountCents),
        cycle,
        nextDueDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
        description: description || 'Contribuição recorrente',
      },
    });
    return { provider: 'asaas', subscriptionId: sub.id, status: sub.status === 'ACTIVE' ? 'active' : 'pending' };
  },

  // Asaas envia o token configurado no header `asaas-access-token`.
  verifyWebhook(req) {
    if (!WEBHOOK_SECRET) return false;
    const token = req.headers['asaas-access-token'] || req.headers['Asaas-Access-Token'];
    return token === WEBHOOK_SECRET;
  },

  parseWebhookEvent(body) {
    const payment = body?.payment || {};
    return {
      chargeId: payment.id || null,
      subscriptionId: payment.subscription || null,
      status: asaasMapStatus(payment.status),
      raw: body,
    };
  },
};

// --- Provider: mock (desenvolvimento sem credenciais) ---------------------
// Útil para exercitar o fluxo localmente. Marca como pago imediatamente para
// PIX simulado. NUNCA usar em produção (não cobra de verdade).
const mockProvider = {
  name: 'mock',
  async createCharge({ method, amountCents }) {
    const chargeId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      provider: 'mock',
      chargeId,
      status: 'pending',
      checkoutUrl: method === 'credit_card' ? `https://example.test/checkout/${chargeId}` : null,
      bankSlipUrl: method === 'boleto' ? `https://example.test/boleto/${chargeId}.pdf` : null,
      digitableLine: method === 'boleto' ? '00190.00009 01234.567890 12345.678901 2 99990000010000' : null,
      barcode: null,
      pixPayload: method === 'pix' ? `00020126_${chargeId}` : null,
      pixQrImage: null,
    };
  },
  async createSubscription() {
    return { provider: 'mock', subscriptionId: `mocksub_${Date.now()}`, status: 'active' };
  },
  verifyWebhook() { return true; },
  parseWebhookEvent(body) {
    return {
      chargeId: body?.chargeId || body?.payment?.id || null,
      subscriptionId: body?.subscriptionId || null,
      status: body?.status || 'paid',
      raw: body,
    };
  },
};

function getProvider() {
  if (PROVIDER === 'mock') return mockProvider;
  return asaasProvider;
}

function isConfigured() {
  if (PROVIDER === 'mock') return true;
  return Boolean(API_KEY);
}

function getProviderName() {
  return getProvider().name;
}

async function createCharge(params) {
  if (!isConfigured()) throw notConfigured();
  return getProvider().createCharge(params);
}

async function createSubscription(params) {
  if (!isConfigured()) throw notConfigured();
  return getProvider().createSubscription(params);
}

function verifyWebhook(req) {
  return getProvider().verifyWebhook(req);
}

function parseWebhookEvent(body) {
  return getProvider().parseWebhookEvent(body);
}

module.exports = {
  isConfigured,
  getProviderName,
  createCharge,
  createSubscription,
  verifyWebhook,
  parseWebhookEvent,
};
