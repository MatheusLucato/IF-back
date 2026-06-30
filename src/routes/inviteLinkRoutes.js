const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const { createInviteLinkSchema } = require('../schemas/inviteLinkSchemas');
const { createInviteLink, listInviteLinks, revokeInviteLink } = require('../services/inviteLinkService');

const router = express.Router();

// ============================================================================
// CONVITES POR LINK (substitui a escolha de igreja no cadastro público)
// Leitura: convites.read · Escrita/Revogação: convites.write
// ============================================================================

router.get(
  '/invites',
  requirePermission('convites.read'),
  asyncHandler(async (req, res) => {
    const invites = await listInviteLinks(req.churchId);
    return res.json({ invites });
  }),
);

router.post(
  '/invites',
  requirePermission('convites.write'),
  validate(createInviteLinkSchema),
  asyncHandler(async (req, res) => {
    const invite = await createInviteLink({
      churchId: req.churchId,
      role: req.body.role,
      label: req.body.label,
      maxUses: req.body.maxUses,
      expiresInDays: req.body.expiresInDays,
      createdBy: req.user.id,
    });
    await recordAudit(req, {
      action: AUDIT_ACTIONS.INVITE_LINK_CREATED,
      entity: AUDIT_ENTITIES.INVITE_LINK,
      entityId: invite.id,
      after: { label: invite.label, role: invite.role, maxUses: invite.maxUses, expiresAt: invite.expiresAt },
    });
    return res.status(201).json({ invite });
  }),
);

router.post(
  '/invites/:id/revoke',
  requirePermission('convites.write'),
  asyncHandler(async (req, res) => {
    const invite = await revokeInviteLink(req.params.id, req.churchId);
    if (!invite) throw AppError.notFound('Convite não encontrado ou já revogado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.INVITE_LINK_REVOKED,
      entity: AUDIT_ENTITIES.INVITE_LINK,
      entityId: invite.id,
      after: { label: invite.label },
    });
    return res.json({ invite });
  }),
);

module.exports = router;
