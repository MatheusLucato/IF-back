const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { upload } = require('../middleware/upload');
const { uploadAsset } = require('../services/storage');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  updateMemberSchema,
  listMembersQuerySchema,
  birthdaysQuerySchema,
  updateMemberStatusSchema,
  createMemberEventSchema,
  inviteMemberSchema,
} = require('../schemas/memberSchemas');
const {
  listMembers,
  getMemberDetail,
  getMemberRow,
  updateMember,
  deleteMember,
  listBirthdays,
  listMemberEvents,
  createMemberEvent,
} = require('../services/memberService');
const { inviteMember, listInvitations, revokeInvitation } = require('../services/invitationService');

const router = express.Router();

// ============================================================================
// PESSOAS / MEMBROS (Fase 1)
// Leitura: membros.read · Escrita: membros.write · Exclusão: membros.delete
// ============================================================================

// Listagem paginada com busca/filtros (F1.2).
router.get(
  '/members',
  requirePermission('membros.read'),
  validate(listMembersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await listMembers(req.churchId, req.query);
    return res.json(result);
  }),
);

// Aniversariantes do mês (F1.7). Vem ANTES de /members/:id para não colidir.
router.get(
  '/members/birthdays',
  requirePermission('membros.read'),
  validate(birthdaysQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const month = req.query.month || new Date().getMonth() + 1;
    const members = await listBirthdays(req.churchId, month);
    return res.json({ month, members });
  }),
);

// Detalhe (perfil 360º) com agregações (F1.3).
router.get(
  '/members/:id',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const member = await getMemberDetail(req.params.id, req.churchId);
    if (!member) throw AppError.notFound('Pessoa não encontrada.');
    return res.json({ member });
  }),
);

// Nota: não há criação manual de pessoas. O cadastro acontece exclusivamente
// pelo fluxo de convite (POST /api/public/invites/:token/register), que cria o
// vínculo membro↔usuário. Ver inviteLinkService.registerViaInvite.

// Atualizar pessoa (F1.3).
router.patch(
  '/members/:id',
  requirePermission('membros.write'),
  validate(updateMemberSchema),
  asyncHandler(async (req, res) => {
    const member = await updateMember(req.params.id, req.churchId, req.body);
    if (!member) throw AppError.notFound('Pessoa não encontrada.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.MEMBER_UPDATED,
      entity: AUDIT_ENTITIES.MEMBER,
      entityId: member.id,
      after: { fullName: member.fullName },
    });
    return res.json({ member });
  }),
);

// Excluir pessoa.
router.delete(
  '/members/:id',
  requirePermission('membros.delete'),
  asyncHandler(async (req, res) => {
    const existing = await getMemberRow(req.params.id, req.churchId);
    if (!existing) throw AppError.notFound('Pessoa não encontrada.');

    await deleteMember(req.params.id, req.churchId);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.MEMBER_DELETED,
      entity: AUDIT_ENTITIES.MEMBER,
      entityId: req.params.id,
      before: { fullName: existing.full_name, email: existing.email },
    });
    return res.status(204).send();
  }),
);

// Upload de foto → R2 (com fallback data URL). Devolve { url } para o front
// persistir via PATCH /members/:id. Mesmo padrão do avatar de usuário.
router.post(
  '/members/:id/photo',
  requirePermission('membros.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Arquivo é obrigatório.');
    const mime = req.file.mimetype || 'application/octet-stream';
    const { url } = await uploadAsset({
      buffer: req.file.buffer,
      mime,
      churchId: req.churchId,
      category: `members/${req.params.id}`,
    });
    return res.json({ url });
  }),
);

// ============================================================================
// JORNADA / EVENTOS (F1.5)
// ============================================================================

router.get(
  '/members/:id/events',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const events = await listMemberEvents(req.params.id, req.churchId);
    return res.json({ events });
  }),
);

router.post(
  '/members/:id/events',
  requirePermission('membros.write'),
  validate(createMemberEventSchema),
  asyncHandler(async (req, res) => {
    const member = await getMemberRow(req.params.id, req.churchId);
    if (!member) throw AppError.notFound('Pessoa não encontrada.');
    const event = await createMemberEvent(req.params.id, req.churchId, req.body, req.user.id);
    return res.status(201).json({ event });
  }),
);

// Muda o status de membresia e registra automaticamente o marco na jornada.
router.patch(
  '/members/:id/status',
  requirePermission('membros.write'),
  validate(updateMemberStatusSchema),
  asyncHandler(async (req, res) => {
    const previous = await getMemberRow(req.params.id, req.churchId);
    if (!previous) throw AppError.notFound('Pessoa não encontrada.');

    const fromStatus = previous.membership_status;
    const toStatus = req.body.status;

    const member = await updateMember(req.params.id, req.churchId, { membershipStatus: toStatus });

    if (fromStatus !== toStatus) {
      await createMemberEvent(
        req.params.id,
        req.churchId,
        {
          type: 'status_change',
          notes: req.body.notes || null,
          metadata: { from: fromStatus, to: toStatus },
        },
        req.user.id,
      );
      await recordAudit(req, {
        action: AUDIT_ACTIONS.MEMBER_STATUS_CHANGED,
        entity: AUDIT_ENTITIES.MEMBER,
        entityId: req.params.id,
        before: { membershipStatus: fromStatus },
        after: { membershipStatus: toStatus },
      });
    }

    return res.json({ member });
  }),
);

// ============================================================================
// CONVITE / VÍNCULO DE ACESSO (F1.9)
// ============================================================================

router.get(
  '/members/:id/invitations',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const invitations = await listInvitations(req.churchId, req.params.id);
    return res.json({ invitations });
  }),
);

router.post(
  '/members/:id/invite',
  requirePermission('membros.write'),
  validate(inviteMemberSchema),
  asyncHandler(async (req, res) => {
    const member = await getMemberRow(req.params.id, req.churchId);
    if (!member) throw AppError.notFound('Pessoa não encontrada.');

    const result = await inviteMember({
      member,
      churchId: req.churchId,
      email: req.body.email,
      role: req.body.role,
      invitedBy: req.user.id,
    });

    await recordAudit(req, {
      action: result.linked ? AUDIT_ACTIONS.MEMBER_ACCESS_LINKED : AUDIT_ACTIONS.MEMBER_INVITED,
      entity: AUDIT_ENTITIES.MEMBER,
      entityId: member.id,
      after: { email: req.body.email || member.email, role: req.body.role, linked: result.linked },
    });

    return res.json(result);
  }),
);

router.post(
  '/invitations/:id/revoke',
  requirePermission('membros.write'),
  asyncHandler(async (req, res) => {
    const invitation = await revokeInvitation(req.params.id, req.churchId);
    if (!invitation) throw AppError.notFound('Convite não encontrado ou já encerrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.MEMBER_INVITE_REVOKED,
      entity: AUDIT_ENTITIES.MEMBER,
      entityId: invitation.memberId,
      after: { email: invitation.email },
    });
    return res.json({ invitation });
  }),
);

module.exports = router;
