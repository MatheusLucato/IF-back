const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  updateNotificationPrefsSchema,
  updateAutomationSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  createPrayerSchema,
  updatePrayerSchema,
  listPrayerQuerySchema,
} = require('../schemas/comunicacaoSchemas');
const svc = require('../services/comunicacaoService');
const notifications = require('../services/notificationService');

const router = express.Router();

// ============================================================================
// COMUNICAÇÃO & ENGAJAMENTO (Fase 7)
// Leitura: comunicacao.read · Escrita: comunicacao.write
// ============================================================================

// --- F7.1: preferências de notificação (próprio usuário, sem permissão extra) ---
router.get(
  '/notifications/prefs',
  asyncHandler(async (req, res) => {
    const prefs = await notifications.getPrefs(req.churchId, req.user.id);
    return res.json({ prefs, emailConfigured: notifications.emailConfigured });
  }),
);

router.patch(
  '/notifications/prefs',
  validate(updateNotificationPrefsSchema),
  asyncHandler(async (req, res) => {
    const prefs = await notifications.updatePrefs(req.churchId, req.user.id, req.body);
    return res.json({ prefs });
  }),
);

// Log de notificações (admin/líder).
router.get(
  '/notifications/log',
  requirePermission('comunicacao.write'),
  asyncHandler(async (req, res) => {
    return res.json({ notifications: await notifications.listNotifications(req.churchId) });
  }),
);

// --- F7.3: automações ---
router.get(
  '/automations',
  requirePermission('comunicacao.read', 'comunicacao.write'),
  asyncHandler(async (req, res) => res.json({ settings: await svc.getAutomationSettings(req.churchId) })),
);

router.patch(
  '/automations',
  requirePermission('comunicacao.write'),
  validate(updateAutomationSchema),
  asyncHandler(async (req, res) => {
    const settings = await svc.updateAutomationSettings(req.churchId, req.body.settings);
    return res.json({ settings });
  }),
);

// Acionamento manual do lembrete de escala (F7.3). Cron externo pode chamar isto.
router.post(
  '/automations/run/schedule-reminders',
  requirePermission('comunicacao.write'),
  asyncHandler(async (req, res) => {
    const result = await svc.runScheduleReminders(req.churchId);
    return res.json(result);
  }),
);

// --- F7.2: avisos / mural ---
router.get(
  '/announcements',
  requirePermission('comunicacao.read', 'comunicacao.write'),
  asyncHandler(async (req, res) => {
    const includeUnpublished = req.permissions?.has('comunicacao.write') && req.query.all === 'true';
    const announcements = await svc.listAnnouncements(req.churchId, { includeUnpublished });
    return res.json({ announcements });
  }),
);

router.post(
  '/announcements',
  requirePermission('comunicacao.write'),
  validate(createAnnouncementSchema),
  asyncHandler(async (req, res) => {
    const announcement = await svc.createAnnouncement(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATED, entity: AUDIT_ENTITIES.ANNOUNCEMENT,
      entityId: announcement.id, after: { title: announcement.title, audience: announcement.audience },
    });
    return res.status(201).json({ announcement });
  }),
);

router.patch(
  '/announcements/:id',
  requirePermission('comunicacao.write'),
  validate(updateAnnouncementSchema),
  asyncHandler(async (req, res) => {
    const announcement = await svc.updateAnnouncement(req.params.id, req.churchId, req.body);
    if (!announcement) throw AppError.notFound('Aviso não encontrado.');
    return res.json({ announcement });
  }),
);

router.delete(
  '/announcements/:id',
  requirePermission('comunicacao.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteAnnouncement(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Aviso não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_DELETED, entity: AUDIT_ENTITIES.ANNOUNCEMENT, entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

// --- F7.4: pedidos de oração ---
router.get(
  '/prayer-requests',
  requirePermission('comunicacao.read', 'comunicacao.write'),
  validate(listPrayerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const canSeeRestricted = Boolean(req.permissions?.has('comunicacao.write'));
    const requests = await svc.listPrayerRequests(req.churchId, {
      status: req.query.status, canSeeRestricted, userId: req.user.id,
    });
    return res.json({ requests });
  }),
);

router.post(
  '/prayer-requests',
  requirePermission('comunicacao.read', 'comunicacao.write'),
  validate(createPrayerSchema),
  asyncHandler(async (req, res) => {
    const request = await svc.createPrayerRequest(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.PRAYER_CREATED, entity: AUDIT_ENTITIES.PRAYER_REQUEST, entityId: request.id,
    });
    return res.status(201).json({ request });
  }),
);

router.patch(
  '/prayer-requests/:id',
  requirePermission('comunicacao.write'),
  validate(updatePrayerSchema),
  asyncHandler(async (req, res) => {
    const request = await svc.updatePrayerRequest(req.params.id, req.churchId, req.body);
    if (!request) throw AppError.notFound('Pedido não encontrado.');
    return res.json({ request });
  }),
);

router.delete(
  '/prayer-requests/:id',
  requirePermission('comunicacao.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deletePrayerRequest(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Pedido não encontrado.');
    return res.status(204).send();
  }),
);

module.exports = router;
