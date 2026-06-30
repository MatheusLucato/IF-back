const { z, trimmedRequired } = require('./common');

// Schemas da Fase 2 (Secretaria & Documentos). Filosofia F0.4: permissivos; o
// saneamento fino fica no service.

const nullableText = z.string().trim().nullable().optional();

const TEMPLATE_TYPES = ['transfer', 'recommendation', 'baptism', 'membership', 'declaration', 'other'];
const DOCUMENT_CATEGORIES = ['ata', 'estatuto', 'ato_administrativo', 'oficio', 'outro'];

// --- F2.1: modelos de documentos ---
const createTemplateSchema = z.object({
  name: trimmedRequired('O nome do modelo e obrigatorio.'),
  type: z.enum(TEMPLATE_TYPES).optional().default('other'),
  description: nullableText,
  body: z.string().optional().default(''),
  isActive: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(TEMPLATE_TYPES).optional(),
  description: nullableText,
  body: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Preview: renderiza um modelo (por id ou corpo avulso) para uma pessoa.
const previewDocumentSchema = z.object({
  templateId: z.string().trim().optional(),
  body: z.string().optional(),
  memberId: z.string().trim().optional(),
});

// --- F2.2: emissão de documentos ---
const issueDocumentSchema = z.object({
  templateId: z.string().trim().optional(),
  title: z.string().trim().min(1).optional(),
  type: z.enum(TEMPLATE_TYPES).optional(),
  body: z.string().optional(),                 // corpo avulso (opcional ao template)
  renderedContent: z.string().optional(),      // snapshot já renderizado pelo front
});

// --- F2.4: documentos institucionais ---
const createInstitutionDocumentSchema = z.object({
  title: trimmedRequired('O titulo e obrigatorio.'),
  category: z.enum(DOCUMENT_CATEGORIES).optional().default('outro'),
  description: nullableText,
  fileUrl: trimmedRequired('O arquivo e obrigatorio.'),
});

const updateInstitutionDocumentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  description: nullableText,
  fileUrl: z.string().trim().min(1).optional(),
});

module.exports = {
  TEMPLATE_TYPES,
  DOCUMENT_CATEGORIES,
  createTemplateSchema,
  updateTemplateSchema,
  previewDocumentSchema,
  issueDocumentSchema,
  createInstitutionDocumentSchema,
  updateInstitutionDocumentSchema,
};
