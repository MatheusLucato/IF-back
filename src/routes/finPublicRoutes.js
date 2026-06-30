const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { publicDonationSchema } = require('../schemas/givingSchemas');
const giving = require('../services/givingService');
const gateway = require('../lib/paymentGateway');

const router = express.Router();
const supabase = getSupabase();

// ============================================================================
// ROTAS PÚBLICAS DE PAGAMENTO (Fase 6) — sem autenticação.
// Montadas ANTES do middleware authenticate. O backend usa service-role e resolve
// o tenant pelo slug. Página pública: /doar/:slug.
// ============================================================================

async function resolveChurchBySlug(slug) {
  const { data } = await supabase
    .from('churches').select('id,name,trade_name,slug,status').eq('slug', slug).maybeSingle();
  return data || null;
}

// PÚBLICO: dados da igreja + fundos ativos para a página de doação.
router.get('/api/public/churches/:slug/giving', asyncHandler(async (req, res) => {
  const church = await resolveChurchBySlug(req.params.slug);
  if (!church) throw AppError.notFound('Igreja não encontrada.');

  // Branding (logo/cores) reaproveita church_settings.
  const { data: settings } = await supabase
    .from('church_settings').select('logo_url,color_primary').eq('church_id', church.id).maybeSingle();

  const funds = await giving.listFunds(church.id, { activeOnly: true });
  return res.json({
    church: { name: church.trade_name || church.name, slug: church.slug, logoUrl: settings?.logo_url || null, colorPrimary: settings?.color_primary || null },
    funds: funds.map((f) => ({ id: f.id, name: f.name, slug: f.slug, description: f.description, goalCents: f.goalCents, raisedCents: f.raisedCents })),
    gatewayConfigured: gateway.isConfigured(),
  });
}));

// PÚBLICO: cria uma doação (PIX/cartão/boleto). Devolve dados de pagamento
// (copia-e-cola PIX / QR / checkout) para o doador concluir. A confirmação vem
// pelo webhook do gateway.
router.post('/api/public/churches/:slug/donate', validate(publicDonationSchema), asyncHandler(async (req, res) => {
  const church = await resolveChurchBySlug(req.params.slug);
  if (!church) throw AppError.notFound('Igreja não encontrada.');
  if (church.status && church.status !== 'active') throw AppError.forbidden('Esta igreja não está recebendo doações no momento.');

  const donation = await giving.createDonation(church.id, req.body);
  // Não expõe ids internos sensíveis: devolve só o necessário ao checkout.
  return res.status(201).json({
    donation: {
      id: donation.id,
      status: donation.status,
      method: donation.method,
      amountCents: donation.amountCents,
      pixPayload: donation.pixPayload,
      pixQrImage: donation.pixQrImage,
      checkoutUrl: donation.checkoutUrl,
    },
  });
}));

// PÚBLICO: consulta de status de uma doação (polling do PIX na página pública).
router.get('/api/public/donations/:id/status', asyncHandler(async (req, res) => {
  const { data } = await supabase
    .from('donations').select('id,status,method').eq('id', req.params.id).maybeSingle();
  if (!data) throw AppError.notFound('Doação não encontrada.');
  return res.json({ id: data.id, status: data.status, method: data.method });
}));

// PÚBLICO: webhook do gateway de pagamento. Verifica a assinatura/token,
// parseia o evento e concilia a cobrança (doação ou boleto). Idempotente.
// Responde 200 mesmo para eventos ignorados (o gateway não deve reenviar).
router.post('/api/public/payments/webhook', asyncHandler(async (req, res) => {
  if (!gateway.verifyWebhook(req)) {
    throw AppError.unauthenticated('Webhook não autorizado.');
  }
  const event = gateway.parseWebhookEvent(req.body || {});
  const result = await giving.handlePaymentEvent(event);
  return res.json({ ok: true, ...result });
}));

module.exports = router;
