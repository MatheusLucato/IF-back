const { z, trimmedRequired } = require('./common');

// Schemas de validação da Fase 1 (Pessoas). Filosofia F0.4: schemas conhecem os
// campos e ficam permissivos; o saneamento fino (datas, trims) acontece no
// service/normalizers. Datas chegam como string e são normalizadas depois.

// --- Domínio (valores válidos; fonte única reusada pelo service e pelo front) ---
const MEMBERSHIP_STATUSES = ['visitor', 'regular_attender', 'member', 'inactive', 'transferred', 'deceased'];
const GENDERS = ['male', 'female', 'other'];
const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'stable_union'];
const FAMILY_ROLES = ['head', 'spouse', 'child', 'relative', 'other'];
const MEMBER_EVENT_TYPES = [
  'conversion', 'baptism', 'reception', 'status_change', 'transfer_in', 'transfer_out',
  'discipline', 'restoration', 'departure', 'death', 'note', 'other',
];
const INVITE_ROLES = ['membro', 'lider'];

// Helpers: aceitam string (com trim), null (para limpar) ou ausência.
const nullableText = z.string().trim().nullable().optional();
const enumOrNull = (values) => z.enum(values).nullable().optional();

const addressSchema = z
  .object({
    zip: nullableText,
    street: nullableText,
    number: nullableText,
    complement: nullableText,
    district: nullableText,
    city: nullableText,
    state: nullableText,
  })
  .partial()
  .optional();

// Campos comuns de pessoa (reaproveitados em create e update).
const memberFields = {
  fullName: z.string().trim().min(1, 'O nome e obrigatorio.').max(180).optional(),
  socialName: nullableText,
  gender: enumOrNull(GENDERS),
  birthDate: nullableText,
  maritalStatus: enumOrNull(MARITAL_STATUSES),
  cpf: nullableText,
  rg: nullableText,
  email: nullableText,
  phone: nullableText,
  whatsapp: nullableText,
  photoUrl: z.string().nullable().optional(), // pode ser URL ou data URL longa
  address: addressSchema,
  membershipStatus: z.enum(MEMBERSHIP_STATUSES).optional(),
  joinedAt: nullableText,
  baptismDate: nullableText,
  conversionDate: nullableText,
  notes: nullableText,
  isActive: z.boolean().optional(),
};

// POST /members — fullName é obrigatório na criação.
const createMemberSchema = z.object({
  ...memberFields,
  fullName: trimmedRequired('O nome e obrigatorio.'),
});

// PATCH /members/:id — atualização parcial.
const updateMemberSchema = z.object(memberFields);

// GET /members — busca, filtros e paginação (query string → coerção).
const listMembersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  gender: z.enum(GENDERS).optional(),
  hasAccess: z.enum(['true', 'false']).optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['name', 'recent', 'status']).optional().default('name'),
});

// GET /members/birthdays?month=
const birthdaysQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
});

// PATCH /members/:id/status — muda o status e registra um evento de jornada.
const updateMemberStatusSchema = z.object({
  status: z.enum(MEMBERSHIP_STATUSES, { message: 'Status invalido.' }),
  notes: nullableText,
});

// POST /members/:id/events — marco de jornada.
const createMemberEventSchema = z.object({
  type: z.enum(MEMBER_EVENT_TYPES, { message: 'Tipo de evento invalido.' }),
  eventDate: nullableText,
  title: nullableText,
  notes: nullableText,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

// --- Famílias (F1.4) ---
const familyMemberInput = z.object({
  memberId: trimmedRequired('memberId e obrigatorio.'),
  role: z.enum(FAMILY_ROLES).optional(),
  isHead: z.boolean().optional(),
});

const createFamilySchema = z.object({
  name: trimmedRequired('O nome da familia e obrigatorio.'),
  notes: nullableText,
  members: z.array(familyMemberInput).optional(),
});

const updateFamilySchema = z.object({
  name: z.string().trim().min(1).optional(),
  notes: nullableText,
});

const addFamilyMemberSchema = familyMemberInput;

const updateFamilyMemberSchema = z.object({
  role: z.enum(FAMILY_ROLES).optional(),
  isHead: z.boolean().optional(),
});

// --- Convite de acesso (F1.9) ---
const inviteMemberSchema = z.object({
  email: z.string().trim().email('E-mail invalido.').optional(),
  role: z.enum(INVITE_ROLES).optional().default('membro'),
});

module.exports = {
  MEMBERSHIP_STATUSES,
  GENDERS,
  MARITAL_STATUSES,
  FAMILY_ROLES,
  MEMBER_EVENT_TYPES,
  INVITE_ROLES,
  createMemberSchema,
  updateMemberSchema,
  listMembersQuerySchema,
  birthdaysQuerySchema,
  updateMemberStatusSchema,
  createMemberEventSchema,
  createFamilySchema,
  updateFamilySchema,
  addFamilyMemberSchema,
  updateFamilyMemberSchema,
  inviteMemberSchema,
};
