const express = require('express');
const { z } = require('../schemas/common');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const billing = require('../services/billingService');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

const router = express.Router();

// ============================================================================
// BILLING / ASSINATURA (F9.1) — gestão pela igreja (admin).
// O catálogo de planos é público para qualquer autenticado (tela de upgrade);
// checkout/cancelamento exigem admin.
// ============================================================================

function ensureAdmin(req) {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador da igreja pode gerenciar a assinatura.');
  }
}

router.get('/billing/plans', asyncHandler(async (_req, res) => res.json(billing.listPlans())));

router.get('/billing/subscription', asyncHandler(async (req, res) =>
  res.json({ subscription: await billing.getSubscription(req.churchId) })));

const checkoutSchema = z.object({ plan: z.string().trim().min(1, 'Informe o plano.') });
router.post('/billing/checkout', validate(checkoutSchema), asyncHandler(async (req, res) => {
  ensureAdmin(req);
  const result = await billing.checkout(req.churchId, req.body.plan, req.user.email);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED, entity: AUDIT_ENTITIES.SUBSCRIPTION, entityId: req.churchId,
    after: { plan: result.subscription.plan, status: result.subscription.status },
  });
  return res.json(result);
}));

router.post('/billing/cancel', asyncHandler(async (req, res) => {
  ensureAdmin(req);
  const subscription = await billing.cancel(req.churchId);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED, entity: AUDIT_ENTITIES.SUBSCRIPTION, entityId: req.churchId,
    after: { plan: subscription.plan, status: subscription.status },
  });
  return res.json({ subscription });
}));

module.exports = router;
