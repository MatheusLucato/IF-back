const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePermission } = require('../middleware/requirePermission');
const { upload } = require('../middleware/upload');
const { uploadAsset } = require('../services/storage');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');
const {
  createTemplateSchema,
  updateTemplateSchema,
  previewDocumentSchema,
  issueDocumentSchema,
  createInstitutionDocumentSchema,
  updateInstitutionDocumentSchema,
} = require('../schemas/secretariaSchemas');
const svc = require('../services/secretariaService');

const router = express.Router();

// ============================================================================
// SECRETARIA & DOCUMENTOS (Fase 2)
// Leitura: secretaria.read · Escrita: secretaria.write
// ============================================================================

// Variáveis disponíveis para os modelos (UI lista os placeholders).
router.get(
  '/secretaria/variables',
  requirePermission('secretaria.read', 'secretaria.write'),
  asyncHandler(async (_req, res) => res.json({ variables: svc.TEMPLATE_VARIABLES })),
);

// --- F2.1: modelos de documentos ---
router.get(
  '/document-templates',
  requirePermission('secretaria.read', 'secretaria.write'),
  asyncHandler(async (req, res) => res.json({ templates: await svc.listTemplates(req.churchId) })),
);

router.post(
  '/document-templates',
  requirePermission('secretaria.write'),
  validate(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const template = await svc.createTemplate(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.TEMPLATE_CREATED,
      entity: AUDIT_ENTITIES.DOCUMENT_TEMPLATE,
      entityId: template.id,
      after: { name: template.name, type: template.type },
    });
    return res.status(201).json({ template });
  }),
);

router.patch(
  '/document-templates/:id',
  requirePermission('secretaria.write'),
  validate(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    const template = await svc.updateTemplate(req.params.id, req.churchId, req.body);
    if (!template) throw AppError.notFound('Modelo não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      entity: AUDIT_ENTITIES.DOCUMENT_TEMPLATE,
      entityId: template.id,
      after: { name: template.name },
    });
    return res.json({ template });
  }),
);

router.delete(
  '/document-templates/:id',
  requirePermission('secretaria.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteTemplate(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Modelo não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.TEMPLATE_DELETED,
      entity: AUDIT_ENTITIES.DOCUMENT_TEMPLATE,
      entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

// Preview de render (template + pessoa → texto).
router.post(
  '/secretaria/preview',
  requirePermission('secretaria.read', 'secretaria.write'),
  validate(previewDocumentSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.renderDocument(req.churchId, req.body);
    return res.json(result);
  }),
);

// --- F2.2: emissão de documentos por pessoa ---
router.get(
  '/members/:id/documents',
  requirePermission('secretaria.read', 'secretaria.write'),
  asyncHandler(async (req, res) => {
    const documents = await svc.listIssuedDocuments(req.churchId, { memberId: req.params.id });
    return res.json({ documents });
  }),
);

router.post(
  '/members/:id/documents',
  requirePermission('secretaria.write'),
  validate(issueDocumentSchema),
  asyncHandler(async (req, res) => {
    const document = await svc.issueDocument(req.churchId, req.params.id, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.DOCUMENT_ISSUED,
      entity: AUDIT_ENTITIES.ISSUED_DOCUMENT,
      entityId: document.id,
      after: { title: document.title, memberId: req.params.id },
    });
    return res.status(201).json({ document });
  }),
);

router.delete(
  '/issued-documents/:id',
  requirePermission('secretaria.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteIssuedDocument(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Documento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      entity: AUDIT_ENTITIES.ISSUED_DOCUMENT,
      entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

// --- F2.3: histórico eclesiástico consolidado (timeline read-only) ---
router.get(
  '/members/:id/history',
  requirePermission('membros.read'),
  asyncHandler(async (req, res) => {
    const history = await svc.getMemberHistory(req.params.id, req.churchId);
    return res.json({ history });
  }),
);

// --- F2.4: documentos institucionais ---
router.get(
  '/institution-documents',
  requirePermission('secretaria.read', 'secretaria.write'),
  asyncHandler(async (req, res) => {
    const documents = await svc.listInstitutionDocuments(req.churchId, { category: req.query.category });
    return res.json({ documents });
  }),
);

router.post(
  '/institution-documents',
  requirePermission('secretaria.write'),
  validate(createInstitutionDocumentSchema),
  asyncHandler(async (req, res) => {
    const document = await svc.createInstitutionDocument(req.churchId, req.body, req.user.id);
    await recordAudit(req, {
      action: AUDIT_ACTIONS.INSTITUTION_DOC_CREATED,
      entity: AUDIT_ENTITIES.INSTITUTION_DOCUMENT,
      entityId: document.id,
      after: { title: document.title, category: document.category },
    });
    return res.status(201).json({ document });
  }),
);

router.patch(
  '/institution-documents/:id',
  requirePermission('secretaria.write'),
  validate(updateInstitutionDocumentSchema),
  asyncHandler(async (req, res) => {
    const document = await svc.updateInstitutionDocument(req.params.id, req.churchId, req.body);
    if (!document) throw AppError.notFound('Documento não encontrado.');
    return res.json({ document });
  }),
);

router.delete(
  '/institution-documents/:id',
  requirePermission('secretaria.write'),
  asyncHandler(async (req, res) => {
    const ok = await svc.deleteInstitutionDocument(req.params.id, req.churchId);
    if (!ok) throw AppError.notFound('Documento não encontrado.');
    await recordAudit(req, {
      action: AUDIT_ACTIONS.INSTITUTION_DOC_DELETED,
      entity: AUDIT_ENTITIES.INSTITUTION_DOCUMENT,
      entityId: req.params.id,
    });
    return res.status(204).send();
  }),
);

// Upload de arquivo institucional → R2 (devolve { url } para persistir via POST acima).
router.post(
  '/institution-documents/upload',
  requirePermission('secretaria.write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('Arquivo é obrigatório.');
    const mime = req.file.mimetype || 'application/octet-stream';
    const { url } = await uploadAsset({
      buffer: req.file.buffer,
      mime,
      churchId: req.churchId,
      category: 'institution-documents',
    });
    return res.json({ url });
  }),
);

module.exports = router;
