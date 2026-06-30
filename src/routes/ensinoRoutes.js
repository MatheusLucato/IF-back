const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  createClassSchema,
  updateClassSchema,
  setTeachersSchema,
  enrollSchema,
  updateEnrollmentSchema,
  createSessionSchema,
  updateSessionSchema,
} = require('../schemas/ensinoSchemas');
const svc = require('../services/ensinoService');

const router = express.Router();

// ============================================================================
// ENSINO (EBD / Classes) (Fase 4)
// Leitura: ensino.read · Escrita: ensino.write · Exclusão: ensino.delete
// ============================================================================

// --- F4.1: classes ---
router.get(
  '/classes',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => res.json({ classes: await svc.listClasses(req.churchId) })),
);

router.get(
  '/classes/:id',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => {
    const klass = await svc.getClass(req.params.id, req.churchId);
    if (!klass) throw AppError.notFound('Classe não encontrada.');
    return res.json({ class: klass });
  }),
);

router.post(
  '/classes',
  requirePermission('ensino.write'),
  validate(createClassSchema),
  asyncHandler(async (req, res) => {
    const klass = await svc.createClass(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CLASS_CREATED, entity: AUDIT_ENTITIES.CLASS,
      entityId: klass.id, after: { name: klass.name },
    });
    return res.status(201).json({ class: klass });
  }),
);

router.patch(
  '/classes/:id',
  requirePermission('ensino.write'),
  validate(updateClassSchema),
  asyncHandler(async (req, res) => {
    const klass = await svc.updateClass(req.params.id, req.churchId, req.body);
    if (!klass) throw AppError.notFound('Classe não encontrada.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CLASS_UPDATED, entity: AUDIT_ENTITIES.CLASS,
      entityId: klass.id, after: { name: klass.name },
    });
    return res.json({ class: klass });
  }),
);

router.delete(
  '/classes/:id',
  requirePermission('ensino.delete'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteClass(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Classe não encontrada.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CLASS_DELETED, entity: AUDIT_ENTITIES.CLASS, entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

router.put(
  '/classes/:id/teachers',
  requirePermission('ensino.write'),
  validate(setTeachersSchema),
  asyncHandler(async (req, res) => {
    const klass = await svc.getClassRow(req.params.id, req.churchId);
    if (!klass) throw AppError.notFound('Classe não encontrada.');
    const updated = await svc.setTeachers(req.params.id, req.churchId, req.body.teachers);
    return res.json({ class: updated });
  }),
);

// --- F4.2: matrícula ---
router.get(
  '/classes/:id/enrollments',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => {
    res.json({ enrollments: await svc.listEnrollments(req.params.id, req.churchId) });
  }),
);

router.post(
  '/classes/:id/enrollments',
  requirePermission('ensino.write'),
  validate(enrollSchema),
  asyncHandler(async (req, res) => {
    const klass = await svc.getClassRow(req.params.id, req.churchId);
    if (!klass) throw AppError.notFound('Classe não encontrada.');
    const enrollment = await svc.enroll(req.params.id, req.churchId, req.body);
    return res.status(201).json({ enrollment });
  }),
);

router.patch(
  '/enrollments/:id',
  requirePermission('ensino.write'),
  validate(updateEnrollmentSchema),
  asyncHandler(async (req, res) => {
    const enrollment = await svc.updateEnrollment(req.params.id, req.churchId, req.body);
    if (!enrollment) throw AppError.notFound('Matrícula não encontrada.');
    return res.json({ enrollment });
  }),
);

router.delete(
  '/enrollments/:id',
  requirePermission('ensino.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.removeEnrollment(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Matrícula não encontrada.');
    return res.status(204).send();
  }),
);

// --- F4.3: chamada/sessões ---
router.get(
  '/classes/:id/sessions',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => {
    res.json({ sessions: await svc.listSessions(req.params.id, req.churchId) });
  }),
);

router.get(
  '/sessions/:id',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => {
    const session = await svc.getSession(req.params.id, req.churchId);
    if (!session) throw AppError.notFound('Aula não encontrada.');
    return res.json({ session });
  }),
);

router.post(
  '/classes/:id/sessions',
  requirePermission('ensino.write'),
  validate(createSessionSchema),
  asyncHandler(async (req, res) => {
    const klass = await svc.getClassRow(req.params.id, req.churchId);
    if (!klass) throw AppError.notFound('Classe não encontrada.');
    const session = await svc.createSession(req.params.id, req.churchId, req.body, req.user.id);
    return res.status(201).json({ session });
  }),
);

router.patch(
  '/sessions/:id',
  requirePermission('ensino.write'),
  validate(updateSessionSchema),
  asyncHandler(async (req, res) => {
    const session = await svc.updateSession(req.params.id, req.churchId, req.body);
    if (!session) throw AppError.notFound('Aula não encontrada.');
    return res.json({ session });
  }),
);

router.delete(
  '/sessions/:id',
  requirePermission('ensino.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteSession(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Aula não encontrada.');
    return res.status(204).send();
  }),
);

// --- F4.4: relatórios ---
router.get(
  '/classes/:id/report',
  requirePermission('ensino.read', 'ensino.write'),
  asyncHandler(async (req, res) => {
    const report = await svc.classReport(req.params.id, req.churchId);
    return res.json({ report });
  }),
);

module.exports = router;
