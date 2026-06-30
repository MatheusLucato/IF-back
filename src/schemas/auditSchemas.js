const { z } = require('./common');

// GET /audit — filtros e paginacao (validados como query string, por isso a
// coercao de numeros). Limites defensivos para nao varrer a tabela inteira.
const listAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  entity: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
});

module.exports = { listAuditQuerySchema };
