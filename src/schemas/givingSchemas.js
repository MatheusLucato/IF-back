const { z, trimmedRequired } = require('./common');

// Schemas de Contribuições/Doações online (Fase 6) e Boletos (F5.7). Valores em
// centavos. As rotas públicas (/doar) usam publicDonationSchema; o webhook não
// valida via zod (o corpo varia por provedor) — é tratado no service do gateway.

const DONATION_METHODS = ['pix', 'credit_card', 'boleto'];
const SUBSCRIPTION_PERIODS = ['weekly', 'monthly', 'yearly'];

const nullableText = z.string().trim().nullable().optional();
const optionalId = z.string().uuid().nullable().optional();
const cents = z.coerce.number().int().min(0, 'Valor inválido.');
const dateText = z.string().trim();

// --- Fundos / campanhas (F6.1) ---
const createFundSchema = z.object({
  name: trimmedRequired('O nome do fundo é obrigatório.'),
  description: nullableText,
  categoryId: optionalId,
  goalCents: cents.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const updateFundSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: nullableText,
  categoryId: optionalId,
  goalCents: cents.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

// --- Doação pública (F6.2). Página /doar/:slug. ---
const publicDonationSchema = z.object({
  fundSlug: z.string().trim().optional(),
  fundId: optionalId,
  amountCents: cents.refine((v) => v >= 100, 'O valor mínimo é R$ 1,00.'),
  method: z.enum(DONATION_METHODS).optional().default('pix'),
  donorName: z.string().trim().min(1, 'Informe seu nome.').optional(),
  donorEmail: z.string().trim().email('E-mail inválido.').optional(),
  donorDocument: nullableText,
  recurring: z.boolean().optional(),
  period: z.enum(SUBSCRIPTION_PERIODS).optional().default('monthly'),
});

const listDonationsQuerySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  status: z.string().trim().optional(),
  fundId: z.string().uuid().optional(),
  method: z.enum(DONATION_METHODS).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// --- Boletos (F5.7) ---
const createBoletoSchema = z.object({
  payerName: trimmedRequired('O nome do pagador é obrigatório.'),
  payerDocument: nullableText,
  description: nullableText,
  amountCents: cents.refine((v) => v > 0, 'O valor deve ser maior que zero.'),
  dueDate: dateText,
  memberId: optionalId,
  receivableId: optionalId,
});

module.exports = {
  DONATION_METHODS,
  SUBSCRIPTION_PERIODS,
  createFundSchema,
  updateFundSchema,
  publicDonationSchema,
  listDonationsQuerySchema,
  createBoletoSchema,
};
