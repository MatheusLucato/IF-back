const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { listAuditQuerySchema } = require('../schemas/auditSchemas');
const { listAudit } = require('../services/auditService');

const router = express.Router();

// Trilha de auditoria do tenant (F0.7). Leitura restrita a quem tem
// `auditoria.read` (no fallback por papel legado, apenas admin/pastor — super).
router.get(
  '/audit',
  requirePermission('auditoria.read'),
  validate(listAuditQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, offset, entity, action, userId } = req.query;
    const result = await listAudit(req.churchId, { limit, offset, entity, action, userId });
    return res.json(result);
  }),
);

module.exports = router;
