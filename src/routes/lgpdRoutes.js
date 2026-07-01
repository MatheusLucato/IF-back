const express = require('express');
const { z } = require('../schemas/common');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const lgpd = require('../services/lgpdService');
const { getMemberRow, isMemberLinkedToAdmin } = require('../services/memberService');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

const router = express.Router();

// ============================================================================
// LGPD (F9.4) — direitos do titular + anonimização (admin).
// Export/consentimentos: qualquer autenticado (sobre os PRÓPRIOS dados).
// Anonimização: membros.delete (ação irreversível, auditada).
// ============================================================================

// Portabilidade: o titular baixa os próprios dados (JSON).
router.get('/me/export', asyncHandler(async (req, res) => {
  const data = await lgpd.exportMyData(req.user, req.churchId);
  await recordAudit(req, { action: AUDIT_ACTIONS.DATA_EXPORTED, entity: AUDIT_ENTITIES.USER, entityId: req.user.id });
  res.set('Content-Disposition', 'attachment; filename="meus-dados-edifico.json"');
  return res.json(data);
}));

router.get('/me/consents', asyncHandler(async (req, res) => {
  return res.json({ consents: await lgpd.listMyConsents(req.churchId, req.user.id) });
}));

const consentSchema = z.object({
  type: z.string().trim().min(1),
  granted: z.boolean(),
});
router.post('/me/consents', validate(consentSchema), asyncHandler(async (req, res) => {
  const consent = await lgpd.setConsent(req.churchId, req.user.id, req.body.type, req.body.granted);
  await recordAudit(req, {
    action: req.body.granted ? AUDIT_ACTIONS.CONSENT_GRANTED : AUDIT_ACTIONS.CONSENT_REVOKED,
    entity: AUDIT_ENTITIES.CONSENT, entityId: consent.id, after: { type: consent.type, granted: consent.granted },
  });
  return res.json({ consent });
}));

// Anonimização de um membro (admin / direito ao esquecimento).
router.post('/members/:id/anonymize', requirePermission('membros.delete'), asyncHandler(async (req, res) => {
  // O administrador da igreja não pode ser anonimizado (apagaria o dono da conta).
  const existing = await getMemberRow(req.params.id, req.churchId);
  if (existing && await isMemberLinkedToAdmin(existing.user_id, req.churchId)) {
    throw AppError.forbidden('O administrador da igreja não pode ser anonimizado.');
  }

  const { before, member } = await lgpd.anonymizeMember(req.params.id, req.churchId);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.MEMBER_ANONYMIZED, entity: AUDIT_ENTITIES.MEMBER, entityId: req.params.id,
    before: { fullName: before.fullName, email: before.email }, after: { anonymized: true },
  });
  return res.json({ member });
}));

module.exports = router;
