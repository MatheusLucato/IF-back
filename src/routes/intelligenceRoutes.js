const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { getUserPermissions } = require('../services/permissionService');
const { rangeQuerySchema } = require('../schemas/intelligenceSchemas');
const dashboard = require('../services/dashboardService');
const reports = require('../services/analyticsReportService');

const router = express.Router();

// ============================================================================
// INTELIGÊNCIA (Fase 10) — Painel executivo e Relatórios cruzados.
// Leitura de painel/relatórios: relatorios.read. KPIs e relatórios financeiros
// são refinados pela permissão financeiro.read dentro do handler.
// ============================================================================

// Helper: o usuário pode ver dados financeiros?
async function canSeeFinance(req) {
  const permissions = req.permissions || (await getUserPermissions(req.user));
  return permissions.has('financeiro.read');
}

// --------------------------- F10.1 Dashboard executivo ---------------------
router.get('/dashboard/kpis', requirePermission('relatorios.read'),
  validate(rangeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const includeFinance = await canSeeFinance(req);
    const kpis = await dashboard.getKpis(req.churchId, req.query, { includeFinance });
    return res.json(kpis);
  }));

// ----------------------------- F10.2 Relatórios ----------------------------
router.get('/reports/catalog', requirePermission('relatorios.read'),
  asyncHandler(async (req, res) => {
    const includeFinance = await canSeeFinance(req);
    return res.json({ reports: reports.catalog({ includeFinance }) });
  }));

router.get('/reports/:key', requirePermission('relatorios.read'),
  validate(rangeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const includeFinance = await canSeeFinance(req);
    const report = await reports.run(req.churchId, req.params.key, req.query, { includeFinance });
    return res.json(report);
  }));

router.get('/reports/:key/export.csv', requirePermission('relatorios.read'),
  validate(rangeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const includeFinance = await canSeeFinance(req);
    const report = await reports.run(req.churchId, req.params.key, req.query, { includeFinance });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.key}.csv"`);
    return res.send(reports.toCsv(report));
  }));

module.exports = router;
