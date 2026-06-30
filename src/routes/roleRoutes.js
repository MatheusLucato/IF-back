const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { PERMISSION_CATALOG } = require('../lib/permissions');
const {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
} = require('../schemas/roleSchemas');
const {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
} = require('../services/permissionService');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

const router = express.Router();

// Catálogo de permissões (estático). Quem pode ver a tela de papéis pode lê-lo.
router.get('/permissions', requirePermission('papeis.read'), asyncHandler(async (_req, res) => {
  return res.json({ modules: PERMISSION_CATALOG });
}));

router.get('/roles', requirePermission('papeis.read'), asyncHandler(async (req, res) => {
  const roles = await listRoles(req.churchId);
  return res.json({ roles });
}));

router.post('/roles', requirePermission('papeis.write'), validate(createRoleSchema), asyncHandler(async (req, res) => {
  const role = await createRole(req.churchId, req.body);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.ROLE_CREATED,
    entity: AUDIT_ENTITIES.ROLE,
    entityId: role.id,
    after: { name: role.name, slug: role.slug, permissions: role.permissions },
  });
  return res.status(201).json({ role });
}));

router.patch('/roles/:id', requirePermission('papeis.write'), validate(updateRoleSchema), asyncHandler(async (req, res) => {
  const role = await updateRole(req.churchId, req.params.id, req.body);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    entity: AUDIT_ENTITIES.ROLE,
    entityId: role.id,
    after: { name: role.name, slug: role.slug, permissions: role.permissions },
  });
  return res.json({ role });
}));

router.delete('/roles/:id', requirePermission('papeis.write'), asyncHandler(async (req, res) => {
  await deleteRole(req.churchId, req.params.id);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.ROLE_DELETED,
    entity: AUDIT_ENTITIES.ROLE,
    entityId: req.params.id,
  });
  return res.status(204).send();
}));

// Atribui (ou remove, com roleId null) um papel configurável a um usuário.
router.patch('/users/:id/role-assignment', requirePermission('papeis.write'), validate(assignRoleSchema), asyncHandler(async (req, res) => {
  await assignRoleToUser(req.churchId, req.params.id, req.body.roleId);
  await recordAudit(req, {
    action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
    entity: AUDIT_ENTITIES.USER,
    entityId: req.params.id,
    after: { roleId: req.body.roleId || null },
  });
  return res.json({ ok: true });
}));

module.exports = router;
