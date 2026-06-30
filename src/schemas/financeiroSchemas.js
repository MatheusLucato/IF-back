const { z, trimmedRequired } = require('./common');

// Schemas de validação do Financeiro (Fase 5). Filosofia F0.4: schemas conhecem
// os campos; saneamento fino (datas, trims) fica no service. VALORES EM CENTAVOS
// (inteiro) desde a borda — o front converte reais→centavos antes de enviar.

// --- Domínio (fonte única reusada pelo service e pelo front) ---
const CATEGORY_KINDS = ['income', 'expense'];
const ACCOUNT_TYPES = ['cash', 'bank', 'other'];
const TRANSACTION_TYPES = ['income', 'expense'];
const PAYABLE_STATUSES = ['open', 'paid', 'cancelled'];
const RECEIVABLE_STATUSES = ['open', 'received', 'cancelled'];

const nullableText = z.string().trim().nullable().optional();
const optionalId = z.string().uuid().nullable().optional();
// Datas chegam como 'YYYY-MM-DD' (normalizadas no service via normalizeBirthDate).
const dateText = z.string().trim();
const cents = z.coerce.number().int().min(0, 'Valor inválido.');

// --- Plano de contas: categorias (F5.1) ---
const createCategorySchema = z.object({
  name: trimmedRequired('O nome da categoria é obrigatório.'),
  kind: z.enum(CATEGORY_KINDS).optional().default('expense'),
  parentId: optionalId,
  isActive: z.boolean().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  parentId: optionalId,
  isActive: z.boolean().optional(),
});

// --- Centros de custo (F5.1) ---
const createCostCenterSchema = z.object({
  name: trimmedRequired('O nome do centro de custo é obrigatório.'),
  description: nullableText,
  isActive: z.boolean().optional(),
});

const updateCostCenterSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: nullableText,
  isActive: z.boolean().optional(),
});

// --- Contas (caixa/banco, F5.2) ---
const createAccountSchema = z.object({
  name: trimmedRequired('O nome da conta é obrigatório.'),
  type: z.enum(ACCOUNT_TYPES).optional().default('bank'),
  openingBalanceCents: cents.optional().default(0),
  bankName: nullableText,
  isActive: z.boolean().optional(),
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  openingBalanceCents: cents.optional(),
  bankName: nullableText,
  isActive: z.boolean().optional(),
});

// --- Lançamentos (F5.2) ---
const createTransactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES, { message: 'Tipo inválido (income/expense).' }),
  amountCents: cents.refine((v) => v > 0, 'O valor deve ser maior que zero.'),
  date: dateText,
  accountId: optionalId,
  categoryId: optionalId,
  costCenterId: optionalId,
  memberId: optionalId,
  description: nullableText,
  attachmentUrl: z.string().nullable().optional(),
});

const updateTransactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  amountCents: cents.optional(),
  date: dateText.optional(),
  accountId: optionalId,
  categoryId: optionalId,
  costCenterId: optionalId,
  memberId: optionalId,
  description: nullableText,
  attachmentUrl: z.string().nullable().optional(),
  reconciled: z.boolean().optional(),
});

const listTransactionsQuerySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  reconciled: z.enum(['true', 'false']).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// --- Contas a pagar (F5.3) ---
const createPayableSchema = z.object({
  supplier: trimmedRequired('O fornecedor é obrigatório.'),
  description: nullableText,
  categoryId: optionalId,
  costCenterId: optionalId,
  dueDate: dateText,
  amountCents: cents.refine((v) => v > 0, 'O valor deve ser maior que zero.'),
});

const updatePayableSchema = z.object({
  supplier: z.string().trim().min(1).optional(),
  description: nullableText,
  categoryId: optionalId,
  costCenterId: optionalId,
  dueDate: dateText.optional(),
  amountCents: cents.optional(),
  status: z.enum(PAYABLE_STATUSES).optional(),
});

// Baixa: cria o lançamento na conta informada, na data do pagamento.
const settlePayableSchema = z.object({
  accountId: optionalId,
  paidAt: dateText.optional(),
});

// --- Contas a receber (F5.4) ---
const createReceivableSchema = z.object({
  payer: trimmedRequired('O pagador é obrigatório.'),
  description: nullableText,
  categoryId: optionalId,
  costCenterId: optionalId,
  memberId: optionalId,
  dueDate: dateText,
  amountCents: cents.refine((v) => v > 0, 'O valor deve ser maior que zero.'),
});

const updateReceivableSchema = z.object({
  payer: z.string().trim().min(1).optional(),
  description: nullableText,
  categoryId: optionalId,
  costCenterId: optionalId,
  memberId: optionalId,
  dueDate: dateText.optional(),
  amountCents: cents.optional(),
  status: z.enum(RECEIVABLE_STATUSES).optional(),
});

const settleReceivableSchema = z.object({
  accountId: optionalId,
  receivedAt: dateText.optional(),
});

// --- Recibos (F5.5) ---
// Emite recibo para uma contribuição já lançada (transactionId) OU lança e emite
// num passo só (amountCents + memberId/payerName + categoryId).
const issueReceiptSchema = z.object({
  transactionId: optionalId,
  memberId: optionalId,
  payerName: nullableText,
  amountCents: cents.optional(),
  description: nullableText,
  date: dateText.optional(),
  accountId: optionalId,
  categoryId: optionalId,
});

// --- Conciliação (F5.6) ---
const reconcileMatchSchema = z.object({
  transactionId: z.string().uuid(),
});

const reconcileBulkSchema = z.object({
  matches: z.array(z.object({
    lineId: z.string().uuid(),
    transactionId: z.string().uuid(),
  })).min(1),
});

// --- Fechamento (F5.9) ---
const closePeriodSchema = z.object({
  period: dateText, // 'YYYY-MM' ou 'YYYY-MM-DD' (normalizado p/ 1º dia no service)
  notes: nullableText,
});

// --- Relatórios (F5.8) ---
const reportQuerySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  groupBy: z.enum(['category', 'cost_center', 'account', 'month']).optional().default('category'),
});

module.exports = {
  CATEGORY_KINDS,
  ACCOUNT_TYPES,
  TRANSACTION_TYPES,
  PAYABLE_STATUSES,
  RECEIVABLE_STATUSES,
  createCategorySchema,
  updateCategorySchema,
  createCostCenterSchema,
  updateCostCenterSchema,
  createAccountSchema,
  updateAccountSchema,
  createTransactionSchema,
  updateTransactionSchema,
  listTransactionsQuerySchema,
  createPayableSchema,
  updatePayableSchema,
  settlePayableSchema,
  createReceivableSchema,
  updateReceivableSchema,
  settleReceivableSchema,
  issueReceiptSchema,
  reconcileMatchSchema,
  reconcileBulkSchema,
  closePeriodSchema,
  reportQuerySchema,
};
