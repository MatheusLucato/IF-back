const { z, trimmedRequired } = require('./common');

// Schemas da Fase 7 (Comunicação & Engajamento).

const nullableText = z.string().trim().nullable().optional();

const AUDIENCES = ['all', 'leaders', 'ministry', 'class'];
const PRAYER_VISIBILITIES = ['private', 'pastoral', 'public'];
const PRAYER_STATUSES = ['open', 'praying', 'answered', 'archived'];

// --- F7.1: preferências de notificação ---
const updateNotificationPrefsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  topics: z.record(z.string(), z.boolean()).optional(),
});

// --- F7.3: automações contextuais (toggles) ---
const updateAutomationSchema = z.object({
  settings: z.record(z.string(), z.boolean()),
});

// --- F7.2: avisos / mural ---
const createAnnouncementSchema = z.object({
  title: trimmedRequired('O titulo e obrigatorio.'),
  body: z.string().optional().default(''),
  audience: z.enum(AUDIENCES).optional().default('all'),
  audienceRef: z.string().trim().nullable().optional(),
  isPinned: z.boolean().optional(),
  publishAt: z.string().trim().optional(),
  expiresAt: z.string().trim().nullable().optional(),
});

const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().optional(),
  audience: z.enum(AUDIENCES).optional(),
  audienceRef: z.string().trim().nullable().optional(),
  isPinned: z.boolean().optional(),
  publishAt: z.string().trim().optional(),
  expiresAt: z.string().trim().nullable().optional(),
});

// --- F7.4: pedidos de oração ---
const createPrayerSchema = z.object({
  title: nullableText,
  body: trimmedRequired('Descreva o pedido.'),
  memberId: z.string().trim().nullable().optional(),
  requesterName: nullableText,
  visibility: z.enum(PRAYER_VISIBILITIES).optional().default('pastoral'),
  isAnonymous: z.boolean().optional(),
});

const updatePrayerSchema = z.object({
  status: z.enum(PRAYER_STATUSES).optional(),
  visibility: z.enum(PRAYER_VISIBILITIES).optional(),
  title: nullableText,
  body: z.string().trim().min(1).optional(),
});

const listPrayerQuerySchema = z.object({
  status: z.enum(PRAYER_STATUSES).optional(),
});

module.exports = {
  AUDIENCES,
  PRAYER_VISIBILITIES,
  PRAYER_STATUSES,
  updateNotificationPrefsSchema,
  updateAutomationSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  createPrayerSchema,
  updatePrayerSchema,
  listPrayerQuerySchema,
};
