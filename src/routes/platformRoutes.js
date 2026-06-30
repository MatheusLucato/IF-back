const express = require('express');
const { z } = require('../schemas/common');
const { asyncHandler } = require('../lib/asyncHandler');
const { validate } = require('../middleware/validate');
const { requirePlatformAdmin } = require('../middleware/requirePlatformAdmin');
const platform = require('../services/platformService');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

const router = express.Router();

// ============================================================================
// PLATAFORMA / SUPER-ADMIN (F9.2) — cross-tenant, SÓ `plataforma_admin`.
// Todas as rotas passam por requirePlatformAdmin. Ações de escrita são auditadas
// no tenant AFETADO (churchId override) para aparecerem também na trilha da
// igreja. A montagem em app.js entra DEPOIS de `authenticate`.
// ============================================================================

const statusSchema = z.object({ status: z.enum(platform.VALID_STATUSES) });
const planSchema = z.object({ plan: z.string().trim().min(1, 'Informe o plano.') });

router.get('/platform/metrics', requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const metrics = await platform.getMetrics();
    await recordAudit(req, { action: AUDIT_ACTIONS.PLATFORM_ACCESS, entity: 'platform', entityId: 'metrics' });
    return res.json({ metrics });
  }));

router.get('/platform/churches', requirePlatformAdmin,
  asyncHandler(async (_req, res) => res.json({ churches: await platform.listChurches() })));

router.patch('/platform/churches/:id/status', requirePlatformAdmin, validate(statusSchema),
  asyncHandler(async (req, res) => {
    const { before, church } = await platform.setChurchStatus(req.params.id, req.body.status);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CHURCH_STATUS_CHANGED, entity: AUDIT_ENTITIES.CHURCH, entityId: req.params.id,
      before: { status: before.status }, after: { status: church.status }, churchId: req.params.id,
    });
    return res.json({ church });
  }));

router.patch('/platform/churches/:id/plan', requirePlatformAdmin, validate(planSchema),
  asyncHandler(async (req, res) => {
    const { before, church } = await platform.setChurchPlan(req.params.id, req.body.plan);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CHURCH_PLAN_CHANGED, entity: AUDIT_ENTITIES.CHURCH, entityId: req.params.id,
      before: { plan: before.plan }, after: { plan: church.plan }, churchId: req.params.id,
    });
    return res.json({ church });
  }));

module.exports = router;
