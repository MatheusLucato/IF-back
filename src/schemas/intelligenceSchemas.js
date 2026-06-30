const { z } = require('./common');

// Datas YYYY-MM-DD opcionais para recortar as métricas de fluxo (F10.1/F10.2).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');

const rangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
}).passthrough();

module.exports = { rangeQuerySchema };
