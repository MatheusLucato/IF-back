const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { createFundSchema, updateFundSchema, listDonationsQuerySchema } = require('../schemas/givingSchemas');
const giving = require('../services/givingService');
const gateway = require('../lib/paymentGateway');

const router = express.Router();

// ============================================================================
// CONTRIBUIÇÕES / DOAÇÕES (Fase 6) — gestão autenticada.
// Estrutura (fundos): financeiro.admin · Leitura (doações): financeiro.read
// ============================================================================

// Status do gateway (para a UI orientar configuração de credenciais).
router.get('/giving/gateway-status', requirePermission('financeiro.read'),
  asyncHandler(async (_req, res) => res.json({ configured: gateway.isConfigured(), provider: gateway.getProviderName() })));

// --- Fundos / campanhas (F6.1) ---
router.get('/giving/funds', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ funds: await giving.listFunds(req.churchId) })));

router.post('/giving/funds', requirePermission('financeiro.admin'), validate(createFundSchema),
  asyncHandler(async (req, res) => res.status(201).json({ fund: await giving.createFund(req.churchId, req.body) })));

router.patch('/giving/funds/:id', requirePermission('financeiro.admin'), validate(updateFundSchema),
  asyncHandler(async (req, res) => {
    const fund = await giving.updateFund(req.params.id, req.churchId, req.body);
    if (!fund) throw AppError.notFound('Fundo não encontrado.');
    return res.json({ fund });
  }));

router.delete('/giving/funds/:id', requirePermission('financeiro.admin'),
  asyncHandler(async (req, res) => {
    const ok = await giving.deleteFund(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Fundo não encontrado.');
    return res.status(204).send();
  }));

// --- Doações (F6.2) — painel ---
router.get('/giving/donations', requirePermission('financeiro.read'),
  validate(listDonationsQuerySchema, 'query'),
  asyncHandler(async (req, res) => res.json(await giving.listDonations(req.churchId, req.query))));

// --- Assinaturas / recorrência (F6.3) ---
router.get('/giving/subscriptions', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ subscriptions: await giving.listSubscriptions(req.churchId) })));

module.exports = router;
