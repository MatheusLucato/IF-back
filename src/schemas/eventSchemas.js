const { z, trimmedRequired } = require('./common');

// Schemas da Fase 3 (Agenda & Eventos).

const nullableText = z.string().trim().nullable().optional();

// Aceita datetime ISO (com timezone) ou 'YYYY-MM-DDTHH:mm' (input local do front).
const dateTime = z.string().trim().min(1);

const REGISTRATION_STATUSES = ['confirmed', 'cancelled', 'waitlist'];

// --- F3.1: eventos ---
const createEventSchema = z.object({
  title: trimmedRequired('O titulo e obrigatorio.'),
  description: nullableText,
  location: nullableText,
  startsAt: dateTime,
  endsAt: z.string().trim().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  isPublished: z.boolean().optional(),
  allowRegistration: z.boolean().optional(),
  responsibleMemberId: z.string().trim().nullable().optional(),
});

const updateEventSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: nullableText,
  location: nullableText,
  startsAt: z.string().trim().min(1).optional(),
  endsAt: z.string().trim().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  isPublished: z.boolean().optional(),
  allowRegistration: z.boolean().optional(),
  responsibleMemberId: z.string().trim().nullable().optional(),
});

const listEventsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).optional().default('all'),
});

// --- F3.2: inscrições (gestão interna) ---
const createRegistrationSchema = z.object({
  memberId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email('E-mail invalido.').nullable().optional(),
  phone: nullableText,
  status: z.enum(REGISTRATION_STATUSES).optional(),
  notes: nullableText,
});

// Registro público (página /e/:slug). Não exige login.
const publicRegistrationSchema = z.object({
  name: trimmedRequired('O nome e obrigatorio.'),
  email: z.string().trim().email('E-mail invalido.').optional(),
  phone: nullableText,
});

const updateRegistrationSchema = z.object({
  status: z.enum(REGISTRATION_STATUSES).optional(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: nullableText,
  notes: nullableText,
});

// --- F3.3: check-in ---
const checkinSchema = z.object({
  qrToken: z.string().trim().optional(),
  registrationId: z.string().trim().optional(),
  undo: z.boolean().optional(),
});

module.exports = {
  REGISTRATION_STATUSES,
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  createRegistrationSchema,
  publicRegistrationSchema,
  updateRegistrationSchema,
  checkinSchema,
};
