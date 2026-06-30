const { z } = require('./common');

// Datas YYYY-MM-DD opcionais para recortar as métricas de fluxo (F10.1/F10.2).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');

const rangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
}).passthrough();

// Geração de IA (F10.3): feature + conteúdo-base. Permissivo, mas exige texto.
const aiGenerateSchema = z.object({
  feature: z.enum(['announcement', 'meeting_minutes', 'summary', 'custom']).optional(),
  input: z.string().trim().min(1, 'Informe os tópicos ou o texto de base.').max(20000, 'Conteúdo muito longo.'),
  instructions: z.string().trim().max(2000).optional(),
}).passthrough();

module.exports = { rangeQuerySchema, aiGenerateSchema };
