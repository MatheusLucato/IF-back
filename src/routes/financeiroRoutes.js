const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { upload } = require('../middleware/upload');
const { uploadAsset } = require('../services/storage');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  createCategorySchema, updateCategorySchema,
  createCostCenterSchema, updateCostCenterSchema,
  createAccountSchema, updateAccountSchema,
  createTransactionSchema, updateTransactionSchema, listTransactionsQuerySchema,
  createPayableSchema, updatePayableSchema, settlePayableSchema,
  createReceivableSchema, updateReceivableSchema, settleReceivableSchema,
  issueReceiptSchema, reconcileMatchSchema, reconcileBulkSchema,
  closePeriodSchema, reportQuerySchema,
} = require('../schemas/financeiroSchemas');
const { createBoletoSchema } = require('../schemas/givingSchemas');
const catalog = require('../services/finCatalogService');
const tx = require('../services/finTransactionService');
const ar = require('../services/finPayableService');
const receipts = require('../services/finReceiptService');
const recon = require('../services/finReconciliationService');
const reports = require('../services/finReportService');
const closings = require('../services/finClosingService');
const giving = require('../services/givingService');

const router = express.Router();

// ============================================================================
// FINANCEIRO (Fase 5/6) — todas as rotas exigem o módulo financeiro.
// Leitura: financeiro.read · Operacional: financeiro.write · Estrutura/fechamento:
// financeiro.admin · Exclusão: financeiro.delete
// ============================================================================

// --------------------------- Plano de contas (F5.1) ------------------------
router.get('/financeiro/categories', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ categories: await catalog.listCategories(req.churchId) })));

router.post('/financeiro/categories', requirePermission('financeiro.admin'), validate(createCategorySchema),
  asyncHandler(async (req, res) => res.status(201).json({ category: await catalog.createCategory(req.churchId, req.body) })));

router.patch('/financeiro/categories/:id', requirePermission('financeiro.admin'), validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await catalog.updateCategory(req.params.id, req.churchId, req.body);
    if (!category) throw AppError.notFound('Categoria não encontrada.');
    return res.json({ category });
  }));

router.delete('/financeiro/categories/:id', requirePermission('financeiro.admin'),
  asyncHandler(async (req, res) => {
    const ok = await catalog.deleteCategory(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Categoria não encontrada.');
    return res.status(204).send();
  }));

// --------------------------- Centros de custo (F5.1) -----------------------
router.get('/financeiro/cost-centers', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ costCenters: await catalog.listCostCenters(req.churchId) })));

router.post('/financeiro/cost-centers', requirePermission('financeiro.admin'), validate(createCostCenterSchema),
  asyncHandler(async (req, res) => res.status(201).json({ costCenter: await catalog.createCostCenter(req.churchId, req.body) })));

router.patch('/financeiro/cost-centers/:id', requirePermission('financeiro.admin'), validate(updateCostCenterSchema),
  asyncHandler(async (req, res) => {
    const costCenter = await catalog.updateCostCenter(req.params.id, req.churchId, req.body);
    if (!costCenter) throw AppError.notFound('Centro de custo não encontrado.');
    return res.json({ costCenter });
  }));

router.delete('/financeiro/cost-centers/:id', requirePermission('financeiro.admin'),
  asyncHandler(async (req, res) => {
    const ok = await catalog.deleteCostCenter(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Centro de custo não encontrado.');
    return res.status(204).send();
  }));

// ------------------------------- Contas (F5.2) -----------------------------
router.get('/financeiro/accounts', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ accounts: await catalog.listAccounts(req.churchId) })));

router.post('/financeiro/accounts', requirePermission('financeiro.admin'), validate(createAccountSchema),
  asyncHandler(async (req, res) => res.status(201).json({ account: await catalog.createAccount(req.churchId, req.body) })));

router.patch('/financeiro/accounts/:id', requirePermission('financeiro.admin'), validate(updateAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await catalog.updateAccount(req.params.id, req.churchId, req.body);
    if (!account) throw AppError.notFound('Conta não encontrada.');
    return res.json({ account });
  }));

router.delete('/financeiro/accounts/:id', requirePermission('financeiro.admin'),
  asyncHandler(async (req, res) => {
    const ok = await catalog.deleteAccount(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Conta não encontrada.');
    return res.status(204).send();
  }));

// ---------------------------- Lançamentos (F5.2) ---------------------------
router.get('/financeiro/transactions', requirePermission('financeiro.read'),
  validate(listTransactionsQuerySchema, 'query'),
  asyncHandler(async (req, res) => res.json(await tx.listTransactions(req.churchId, req.query))));

router.post('/financeiro/transactions', requirePermission('financeiro.write'), validate(createTransactionSchema),
  asyncHandler(async (req, res) => {
    const transaction = await tx.createTransaction(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_TRANSACTION_CREATED, entity: AUDIT_ENTITIES.FIN_TRANSACTION,
      entityId: transaction.id, after: { type: transaction.type, amountCents: transaction.amountCents, date: transaction.date },
    });
    return res.status(201).json({ transaction });
  }));

router.patch('/financeiro/transactions/:id', requirePermission('financeiro.write'), validate(updateTransactionSchema),
  asyncHandler(async (req, res) => {
    const transaction = await tx.updateTransaction(req.params.id, req.churchId, req.body);
    if (!transaction) throw AppError.notFound('Lançamento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_TRANSACTION_UPDATED, entity: AUDIT_ENTITIES.FIN_TRANSACTION, entityId: transaction.id,
    });
    return res.json({ transaction });
  }));

router.delete('/financeiro/transactions/:id', requirePermission('financeiro.delete'),
  asyncHandler(async (req, res) => {
    const ok = await tx.deleteTransaction(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Lançamento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_TRANSACTION_DELETED, entity: AUDIT_ENTITIES.FIN_TRANSACTION, entityId: req.params.id,
    });
    return res.status(204).send();
  }));

// Anexo de comprovante → R2 (devolve { url } para o PATCH persistir).
router.post('/financeiro/transactions/:id/attachment', requirePermission('financeiro.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Arquivo é obrigatório.');
    const { url } = await uploadAsset({
      buffer: req.file.buffer, mime: req.file.mimetype || 'application/octet-stream',
      churchId: req.churchId, category: `financeiro/${req.params.id}`,
    });
    return res.json({ url });
  }));

// --------------------------- Contas a pagar (F5.3) -------------------------
router.get('/financeiro/payables', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ payables: await ar.listPayables(req.churchId, req.query) })));

router.post('/financeiro/payables', requirePermission('financeiro.write'), validate(createPayableSchema),
  asyncHandler(async (req, res) => res.status(201).json({ payable: await ar.createPayable(req.churchId, req.body, req.user.id) })));

router.patch('/financeiro/payables/:id', requirePermission('financeiro.write'), validate(updatePayableSchema),
  asyncHandler(async (req, res) => {
    const payable = await ar.updatePayable(req.params.id, req.churchId, req.body);
    if (!payable) throw AppError.notFound('Conta a pagar não encontrada.');
    return res.json({ payable });
  }));

router.delete('/financeiro/payables/:id', requirePermission('financeiro.delete'),
  asyncHandler(async (req, res) => {
    const ok = await ar.deletePayable(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Conta a pagar não encontrada.');
    return res.status(204).send();
  }));

router.post('/financeiro/payables/:id/settle', requirePermission('financeiro.write'), validate(settlePayableSchema),
  asyncHandler(async (req, res) => {
    const result = await ar.settlePayable(req.params.id, req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_PAYABLE_PAID, entity: AUDIT_ENTITIES.FIN_PAYABLE, entityId: result.payable.id,
      after: { amountCents: result.payable.amountCents },
    });
    return res.json(result);
  }));

// -------------------------- Contas a receber (F5.4) ------------------------
router.get('/financeiro/receivables', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ receivables: await ar.listReceivables(req.churchId, req.query) })));

router.post('/financeiro/receivables', requirePermission('financeiro.write'), validate(createReceivableSchema),
  asyncHandler(async (req, res) => res.status(201).json({ receivable: await ar.createReceivable(req.churchId, req.body, req.user.id) })));

router.patch('/financeiro/receivables/:id', requirePermission('financeiro.write'), validate(updateReceivableSchema),
  asyncHandler(async (req, res) => {
    const receivable = await ar.updateReceivable(req.params.id, req.churchId, req.body);
    if (!receivable) throw AppError.notFound('Conta a receber não encontrada.');
    return res.json({ receivable });
  }));

router.delete('/financeiro/receivables/:id', requirePermission('financeiro.delete'),
  asyncHandler(async (req, res) => {
    const ok = await ar.deleteReceivable(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Conta a receber não encontrada.');
    return res.status(204).send();
  }));

router.post('/financeiro/receivables/:id/settle', requirePermission('financeiro.write'), validate(settleReceivableSchema),
  asyncHandler(async (req, res) => {
    const result = await ar.settleReceivable(req.params.id, req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_RECEIVABLE_RECEIVED, entity: AUDIT_ENTITIES.FIN_RECEIVABLE, entityId: result.receivable.id,
      after: { amountCents: result.receivable.amountCents },
    });
    return res.json(result);
  }));

// ------------------------------ Recibos (F5.5) -----------------------------
router.get('/financeiro/receipts', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ receipts: await receipts.listReceipts(req.churchId, req.query) })));

router.get('/financeiro/receipts/annual', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    return res.json({ year, rows: await receipts.annualByMember(req.churchId, year, req.query.memberId) });
  }));

router.get('/financeiro/receipts/:id', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => {
    const receipt = await receipts.getReceipt(req.params.id, req.churchId);
    if (!receipt) throw AppError.notFound('Recibo não encontrado.');
    return res.json({ receipt });
  }));

router.post('/financeiro/receipts', requirePermission('financeiro.write'), validate(issueReceiptSchema),
  asyncHandler(async (req, res) => {
    const receipt = await receipts.issueReceipt(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_RECEIPT_ISSUED, entity: AUDIT_ENTITIES.FIN_RECEIPT, entityId: receipt.id,
      after: { number: receipt.formattedNumber, amountCents: receipt.amountCents },
    });
    return res.status(201).json({ receipt });
  }));

// ----------------------- Conciliação bancária OFX (F5.6) -------------------
router.get('/financeiro/reconciliation/imports', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ imports: await recon.listImports(req.churchId) })));

router.get('/financeiro/reconciliation/imports/:id/lines', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ lines: await recon.getLinesWithSuggestions(req.churchId, req.params.id) })));

// Upload do .ofx (multipart). O parser roda no service.
router.post('/financeiro/reconciliation/import', requirePermission('financeiro.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Envie o arquivo .ofx.');
    const content = req.file.buffer.toString('latin1'); // OFX costuma vir em ISO-8859-1
    const result = await recon.importOfx(req.churchId, {
      content, fileName: req.file.originalname, accountId: req.body.accountId || null,
    }, req.user.id);
    return res.status(201).json(result);
  }));

router.post('/financeiro/reconciliation/lines/:id/match', requirePermission('financeiro.write'), validate(reconcileMatchSchema),
  asyncHandler(async (req, res) => {
    const line = await recon.confirmMatch(req.churchId, req.params.id, req.body.transactionId);
    await recordAudit(req, { action: AUDIT_ACTIONS.FIN_RECONCILED, entity: AUDIT_ENTITIES.FIN_TRANSACTION, entityId: req.body.transactionId });
    return res.json({ line });
  }));

router.post('/financeiro/reconciliation/match-bulk', requirePermission('financeiro.write'), validate(reconcileBulkSchema),
  asyncHandler(async (req, res) => res.json({ lines: await recon.confirmBulk(req.churchId, req.body.matches) })));

router.post('/financeiro/reconciliation/lines/:id/ignore', requirePermission('financeiro.write'),
  asyncHandler(async (req, res) => res.json({ line: await recon.ignoreLine(req.churchId, req.params.id) })));

// ----------------------------- Relatórios (F5.8) ---------------------------
router.get('/financeiro/reports/summary', requirePermission('financeiro.read'),
  validate(reportQuerySchema, 'query'),
  asyncHandler(async (req, res) => res.json(await reports.summary(req.churchId, req.query))));

router.get('/financeiro/reports/grouped', requirePermission('financeiro.read'),
  validate(reportQuerySchema, 'query'),
  asyncHandler(async (req, res) => res.json({ groups: await reports.grouped(req.churchId, req.query) })));

router.get('/financeiro/reports/export.csv', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => {
    const csv = await reports.exportCsv(req.churchId, req.query);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="financeiro.csv"');
    return res.send(csv);
  }));

// ---------------------------- Fechamento (F5.9) ----------------------------
router.get('/financeiro/closings', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ closings: await closings.listClosings(req.churchId) })));

router.post('/financeiro/closings', requirePermission('financeiro.admin'), validate(closePeriodSchema),
  asyncHandler(async (req, res) => {
    const closing = await closings.closePeriod(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_PERIOD_CLOSED, entity: AUDIT_ENTITIES.FIN_CLOSING, entityId: closing.id,
      after: { period: closing.period, closingCents: closing.closingCents },
    });
    return res.status(201).json({ closing });
  }));

router.post('/financeiro/closings/:period/reopen', requirePermission('financeiro.admin'),
  asyncHandler(async (req, res) => {
    const closing = await closings.reopenPeriod(req.churchId, req.params.period, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.FIN_PERIOD_REOPENED, entity: AUDIT_ENTITIES.FIN_CLOSING, entityId: closing.id,
      before: { period: closing.period },
    });
    return res.json({ closing });
  }));

// ------------------------------- Boletos (F5.7) ----------------------------
router.get('/financeiro/boletos', requirePermission('financeiro.read'),
  asyncHandler(async (req, res) => res.json({ boletos: await giving.listBoletos(req.churchId, req.query) })));

router.post('/financeiro/boletos', requirePermission('financeiro.write'), validate(createBoletoSchema),
  asyncHandler(async (req, res) => {
    const boleto = await giving.createBoleto(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.BOLETO_CREATED, entity: AUDIT_ENTITIES.FIN_BOLETO, entityId: boleto.id,
      after: { amountCents: boleto.amountCents, payerName: boleto.payerName },
    });
    return res.status(201).json({ boleto });
  }));

module.exports = router;
