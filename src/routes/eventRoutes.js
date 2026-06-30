const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { upload } = require('../middleware/upload');
const { uploadAsset } = require('../services/storage');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  createRegistrationSchema,
  updateRegistrationSchema,
  checkinSchema,
} = require('../schemas/eventSchemas');
const svc = require('../services/eventService');

const router = express.Router();

// ============================================================================
// AGENDA & EVENTOS (Fase 3)
// Leitura: eventos.read · Escrita: eventos.write · Exclusão: eventos.delete
// ============================================================================

router.get(
  '/events',
  requirePermission('eventos.read', 'eventos.write'),
  validate(listEventsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const events = await svc.listEvents(req.churchId, { scope: req.query.scope });
    return res.json({ events });
  }),
);

router.get(
  '/events/:id',
  requirePermission('eventos.read', 'eventos.write'),
  asyncHandler(async (req, res) => {
    const event = await svc.getEvent(req.params.id, req.churchId);
    if (!event) throw AppError.notFound('Evento não encontrado.');
    return res.json({ event });
  }),
);

router.post(
  '/events',
  requirePermission('eventos.write'),
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const event = await svc.createEvent(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.EVENT_CREATED,
      entity: AUDIT_ENTITIES.EVENT,
      entityId: event.id,
      after: { title: event.title, startsAt: event.startsAt },
    });
    return res.status(201).json({ event });
  }),
);

router.patch(
  '/events/:id',
  requirePermission('eventos.write'),
  validate(updateEventSchema),
  asyncHandler(async (req, res) => {
    const event = await svc.updateEvent(req.params.id, req.churchId, req.body);
    if (!event) throw AppError.notFound('Evento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.EVENT_UPDATED,
      entity: AUDIT_ENTITIES.EVENT,
      entityId: event.id,
      after: { title: event.title },
    });
    return res.json({ event });
  }),
);

router.delete(
  '/events/:id',
  requirePermission('eventos.delete'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteEvent(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Evento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.EVENT_DELETED,
      entity: AUDIT_ENTITIES.EVENT,
      entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

// Upload de capa → R2.
router.post(
  '/events/:id/cover',
  requirePermission('eventos.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Arquivo é obrigatório.');
    const { url } = await uploadAsset({
      buffer: req.file.buffer,
      mime: req.file.mimetype || 'application/octet-stream',
      churchId: req.churchId,
      category: `events/${req.params.id}`,
    });
    return res.json({ url });
  }),
);

// --- Inscrições (F3.2) ---
router.get(
  '/events/:id/registrations',
  requirePermission('eventos.read', 'eventos.write'),
  asyncHandler(async (req, res) => {
    const event = await svc.getEventRow(req.params.id, req.churchId);
    if (!event) throw AppError.notFound('Evento não encontrado.');
    const registrations = await svc.listRegistrations(req.params.id, req.churchId);
    return res.json({ registrations });
  }),
);

router.post(
  '/events/:id/registrations',
  requirePermission('eventos.write'),
  validate(createRegistrationSchema),
  asyncHandler(async (req, res) => {
    const event = await svc.getEventRow(req.params.id, req.churchId);
    if (!event) throw AppError.notFound('Evento não encontrado.');
    const registration = await svc.addRegistration(event, req.churchId, req.body);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.EVENT_REGISTRATION_CREATED,
      entity: AUDIT_ENTITIES.EVENT_REGISTRATION,
      entityId: registration.id,
      after: { eventId: req.params.id, name: registration.name },
    });
    return res.status(201).json({ registration });
  }),
);

router.patch(
  '/events/:id/registrations/:regId',
  requirePermission('eventos.write'),
  validate(updateRegistrationSchema),
  asyncHandler(async (req, res) => {
    const registration = await svc.updateRegistration(req.params.regId, req.churchId, req.body);
    if (!registration) throw AppError.notFound('Inscrição não encontrada.');
    return res.json({ registration });
  }),
);

router.delete(
  '/events/:id/registrations/:regId',
  requirePermission('eventos.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteRegistration(req.params.regId, req.churchId);
    if (!ok) throw AppError.notFound('Inscrição não encontrada.');
    return res.status(204).send();
  }),
);

// --- Check-in (F3.3) ---
router.post(
  '/events/:id/checkin',
  requirePermission('eventos.write'),
  validate(checkinSchema),
  asyncHandler(async (req, res) => {
    const event = await svc.getEventRow(req.params.id, req.churchId);
    if (!event) throw AppError.notFound('Evento não encontrado.');
    const result = await svc.checkin(req.params.id, req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.EVENT_CHECKED_IN,
      entity: AUDIT_ENTITIES.EVENT_REGISTRATION,
      entityId: result.registration.id,
      after: { eventId: req.params.id, checkedInAt: result.registration.checkedInAt },
    });
    return res.json(result);
  }),
);

module.exports = router;
