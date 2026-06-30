const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const {
  createFamilySchema,
  updateFamilySchema,
  addFamilyMemberSchema,
  updateFamilyMemberSchema,
} = require('../schemas/memberSchemas');
const {
  listFamilies,
  getFamily,
  createFamily,
  updateFamily,
  deleteFamily,
  addFamilyMember,
  updateFamilyMember,
  removeFamilyMember,
} = require('../services/familyService');

const router = express.Router();

// ============================================================================
// FAMÍLIAS / NÚCLEOS FAMILIARES (F1.4)
// Compartilha as permissões do módulo de pessoas (membros.read/write).
// ============================================================================

router.get(
  '/families',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const families = await listFamilies(req.churchId);
    return res.json({ families });
  }),
);

router.get(
  '/families/:id',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const family = await getFamily(req.params.id, req.churchId);
    if (!family) throw AppError.notFound('Família não encontrada.');
    return res.json({ family });
  }),
);

router.post(
  '/families',
  requirePermission('membros.write'),
  validate(createFamilySchema),
  asyncHandler(async (req, res) => {
    const family = await createFamily(req.churchId, req.body);
    return res.status(201).json({ family });
  }),
);

router.patch(
  '/families/:id',
  requirePermission('membros.write'),
  validate(updateFamilySchema),
  asyncHandler(async (req, res) => {
    const family = await updateFamily(req.params.id, req.churchId, req.body);
    if (!family) throw AppError.notFound('Família não encontrada.');
    return res.json({ family });
  }),
);

router.delete(
  '/families/:id',
  requirePermission('membros.write'),
  asyncHandler(async (req, res) => {
    const ok = await deleteFamily(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Família não encontrada.');
    return res.status(204).send();
  }),
);

// Integrantes da família.
router.post(
  '/families/:id/members',
  requirePermission('membros.write'),
  validate(addFamilyMemberSchema),
  asyncHandler(async (req, res) => {
    const family = await addFamilyMember(req.params.id, req.churchId, req.body);
    if (!family) throw AppError.notFound('Família não encontrada.');
    return res.status(201).json({ family });
  }),
);

router.patch(
  '/families/:id/members/:linkId',
  requirePermission('membros.write'),
  validate(updateFamilyMemberSchema),
  asyncHandler(async (req, res) => {
    const family = await updateFamilyMember(req.params.linkId, req.churchId, req.body);
    if (!family) throw AppError.notFound('Vínculo não encontrado.');
    return res.json({ family });
  }),
);

router.delete(
  '/families/:id/members/:linkId',
  requirePermission('membros.write'),
  asyncHandler(async (req, res) => {
    const familyId = await removeFamilyMember(req.params.linkId, req.churchId);
    if (!familyId) throw AppError.notFound('Vínculo não encontrado.');
    const family = await getFamily(familyId, req.churchId);
    return res.json({ family });
  }),
);

module.exports = router;
