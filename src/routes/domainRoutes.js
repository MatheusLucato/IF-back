const express = require('express');
const { z } = require('../schemas/common');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const domains = require('../services/domainService');

const router = express.Router();

// ============================================================================
// DOMÍNIO POR TENANT (F9.3) — configuração pelo admin da igreja.
// O subdomínio (slug) é automático; aqui o admin gerencia o DOMÍNIO PRÓPRIO.
// ============================================================================

function ensureAdmin(req) {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador da igreja pode gerenciar o domínio.');
  }
}

const setDomainSchema = z.object({ customDomain: z.string().trim().min(1, 'Informe o domínio.') });

router.post('/settings/domain', validate(setDomainSchema), asyncHandler(async (req, res) => {
  ensureAdmin(req);
  const church = await domains.setCustomDomain(req.churchId, req.body.customDomain);
  return res.json({ church });
}));

router.post('/settings/domain/verify', asyncHandler(async (req, res) => {
  ensureAdmin(req);
  const church = await domains.verifyDomain(req.churchId);
  return res.json({ church });
}));

router.delete('/settings/domain', asyncHandler(async (req, res) => {
  ensureAdmin(req);
  const church = await domains.removeCustomDomain(req.churchId);
  return res.json({ church });
}));

module.exports = router;
