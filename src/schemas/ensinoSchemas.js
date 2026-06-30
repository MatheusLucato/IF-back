const { z, trimmedRequired } = require('./common');

// Schemas da Fase 4 (Ensino / EBD).

const nullableText = z.string().trim().nullable().optional();
const ENROLLMENT_STATUSES = ['active', 'inactive', 'transferred'];

// --- F4.1: classes ---
const createClassSchema = z.object({
  name: trimmedRequired('O nome da classe e obrigatorio.'),
  ageRange: nullableText,
  schedule: nullableText,
  room: nullableText,
  description: nullableText,
  isActive: z.boolean().optional(),
});

const updateClassSchema = z.object({
  name: z.string().trim().min(1).optional(),
  ageRange: nullableText,
  schedule: nullableText,
  room: nullableText,
  description: nullableText,
  isActive: z.boolean().optional(),
});

// Professores: substitui a lista completa de professores da classe.
const setTeachersSchema = z.object({
  teachers: z.array(z.object({
    memberId: trimmedRequired('memberId e obrigatorio.'),
    isLead: z.boolean().optional(),
  })).default([]),
});

// --- F4.2: matrícula ---
const enrollSchema = z.object({
  memberId: trimmedRequired('memberId e obrigatorio.'),
  status: z.enum(ENROLLMENT_STATUSES).optional(),
});

const updateEnrollmentSchema = z.object({
  status: z.enum(ENROLLMENT_STATUSES),
});

// --- F4.3: chamada/sessão ---
const createSessionSchema = z.object({
  sessionDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida (use YYYY-MM-DD).'),
  lessonTitle: nullableText,
  offeringCents: z.coerce.number().int().min(0).optional(),
  visitorsCount: z.coerce.number().int().min(0).optional(),
  notes: nullableText,
  // Presenças em lote: [{ memberId, present }]
  attendance: z.array(z.object({
    memberId: trimmedRequired('memberId e obrigatorio.'),
    present: z.boolean(),
  })).optional(),
});

const updateSessionSchema = z.object({
  lessonTitle: nullableText,
  offeringCents: z.coerce.number().int().min(0).optional(),
  visitorsCount: z.coerce.number().int().min(0).optional(),
  notes: nullableText,
  attendance: z.array(z.object({
    memberId: trimmedRequired('memberId e obrigatorio.'),
    present: z.boolean(),
  })).optional(),
});

module.exports = {
  ENROLLMENT_STATUSES,
  createClassSchema,
  updateClassSchema,
  setTeachersSchema,
  enrollSchema,
  updateEnrollmentSchema,
  createSessionSchema,
  updateSessionSchema,
};
