const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapEvent, mapEventRegistration } = require('../lib/mappers');
const { slugify } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0009_eventos.sql';

const EVENT_SELECT = 'id,church_id,title,slug,description,location,starts_at,ends_at,cover_url,capacity,is_published,allow_registration,responsible_member_id,created_by,created_at,updated_at';
const REG_SELECT = 'id,church_id,event_id,member_id,name,email,phone,status,qr_token,checked_in_at,checked_in_by,notes,created_at';

// Gera um slug único por tenant a partir do título.
async function generateEventSlug(churchId, title) {
  const base = slugify(title).slice(0, 60) || `evento-${Date.now()}`;
  let slug = base;
  for (let i = 0; i < 5; i += 1) {
    const { data } = await supabase
      .from('events').select('id').eq('church_id', churchId).eq('slug', slug).maybeSingle();
    if (!data) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Conta inscrições (confirmadas e check-ins) por evento, em lote.
async function countsForEvents(eventIds) {
  const counts = new Map();
  if (eventIds.length === 0) return counts;
  const { data } = await supabase
    .from('event_registrations')
    .select('event_id,status,checked_in_at')
    .in('event_id', eventIds);
  for (const r of data || []) {
    const c = counts.get(r.event_id) || { registrationCount: 0, checkedInCount: 0 };
    if (r.status !== 'cancelled') c.registrationCount += 1;
    if (r.checked_in_at) c.checkedInCount += 1;
    counts.set(r.event_id, c);
  }
  return counts;
}

async function listEvents(churchId, { scope = 'all' } = {}) {
  const nowIso = new Date().toISOString();
  let query = supabase.from('events').select(EVENT_SELECT).eq('church_id', churchId);
  if (scope === 'upcoming') query = query.gte('starts_at', nowIso).order('starts_at', { ascending: true });
  else if (scope === 'past') query = query.lt('starts_at', nowIso).order('starts_at', { ascending: false });
  else query = query.order('starts_at', { ascending: false });

  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const counts = await countsForEvents((data || []).map((e) => e.id));
  return (data || []).map((row) => {
    const mapped = mapEvent(row);
    const c = counts.get(row.id) || { registrationCount: 0, checkedInCount: 0 };
    mapped.registrationCount = c.registrationCount;
    mapped.checkedInCount = c.checkedInCount;
    return mapped;
  });
}

async function getEventRow(id, churchId) {
  const { data, error } = await supabase
    .from('events').select(EVENT_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

async function getEvent(id, churchId) {
  const row = await getEventRow(id, churchId);
  if (!row) return null;
  const counts = await countsForEvents([row.id]);
  const mapped = mapEvent(row);
  const c = counts.get(row.id) || { registrationCount: 0, checkedInCount: 0 };
  mapped.registrationCount = c.registrationCount;
  mapped.checkedInCount = c.checkedInCount;
  return mapped;
}

function buildEventPayload(input) {
  const out = {};
  const text = (v) => (v == null || v === '' ? null : String(v).trim());
  if (input.title !== undefined) out.title = String(input.title).trim();
  if (input.description !== undefined) out.description = text(input.description);
  if (input.location !== undefined) out.location = text(input.location);
  if (input.startsAt !== undefined) out.starts_at = input.startsAt;
  if (input.endsAt !== undefined) out.ends_at = input.endsAt || null;
  if (input.coverUrl !== undefined) out.cover_url = input.coverUrl || null;
  if (input.capacity !== undefined) out.capacity = input.capacity ?? null;
  if (input.isPublished !== undefined) out.is_published = Boolean(input.isPublished);
  if (input.allowRegistration !== undefined) out.allow_registration = Boolean(input.allowRegistration);
  if (input.responsibleMemberId !== undefined) out.responsible_member_id = input.responsibleMemberId || null;
  return out;
}

async function createEvent(churchId, input, createdBy) {
  const payload = buildEventPayload(input);
  payload.church_id = churchId;
  payload.created_by = createdBy || null;
  payload.slug = await generateEventSlug(churchId, input.title);

  const { data, error } = await supabase.from('events').insert(payload).select(EVENT_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapEvent(data);
}

async function updateEvent(id, churchId, input) {
  const payload = buildEventPayload(input);
  if (Object.keys(payload).length === 0) return getEvent(id, churchId);
  const { data, error } = await supabase
    .from('events').update(payload).eq('id', id).eq('church_id', churchId).select(EVENT_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapEvent(data) : null;
}

async function deleteEvent(id, churchId) {
  const { data, error } = await supabase
    .from('events').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// --- Inscrições (F3.2) ---

async function listRegistrations(eventId, churchId) {
  const { data, error } = await supabase
    .from('event_registrations').select(REG_SELECT)
    .eq('church_id', churchId).eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapEventRegistration);
}

// Cria uma inscrição respeitando a capacidade. `eventRow` já carregado pelo caller.
async function addRegistration(eventRow, churchId, input, { allowPublic = false } = {}) {
  if (allowPublic && (!eventRow.is_published || !eventRow.allow_registration)) {
    throw AppError.forbidden('As inscrições para este evento não estão abertas.');
  }

  // Capacidade: conta inscrições não-canceladas.
  if (eventRow.capacity != null) {
    const { count } = await supabase
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventRow.id).neq('status', 'cancelled');
    if ((count ?? 0) >= eventRow.capacity) {
      throw AppError.conflict('Vagas esgotadas para este evento.');
    }
  }

  // Nome obrigatório: usa o do membro quando não enviado.
  let name = input.name ? String(input.name).trim() : null;
  if (!name && input.memberId) {
    const { data: m } = await supabase
      .from('members').select('full_name').eq('id', input.memberId).eq('church_id', churchId).maybeSingle();
    name = m?.full_name || null;
  }
  if (!name) throw AppError.badRequest('Nome é obrigatório.');

  const payload = {
    church_id: churchId,
    event_id: eventRow.id,
    member_id: input.memberId || null,
    name,
    email: input.email ? String(input.email).trim().toLowerCase() : null,
    phone: input.phone ? String(input.phone).trim() : null,
    status: input.status || 'confirmed',
    notes: input.notes ? String(input.notes).trim() : null,
  };

  const { data, error } = await supabase
    .from('event_registrations').insert(payload).select(REG_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  // Violação do índice único (membro já inscrito).
  if (error && error.code === '23505') throw AppError.conflict('Esta pessoa já está inscrita no evento.');
  if (error) throw new Error(error.message);
  return mapEventRegistration(data);
}

async function updateRegistration(id, churchId, input) {
  const payload = {};
  if (input.status !== undefined) payload.status = input.status;
  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.email !== undefined) payload.email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (input.phone !== undefined) payload.phone = input.phone || null;
  if (input.notes !== undefined) payload.notes = input.notes || null;
  const { data, error } = await supabase
    .from('event_registrations').update(payload)
    .eq('id', id).eq('church_id', churchId).select(REG_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapEventRegistration(data) : null;
}

async function deleteRegistration(id, churchId) {
  const { data, error } = await supabase
    .from('event_registrations').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// --- Check-in (F3.3) ---

async function checkin(eventId, churchId, { qrToken, registrationId, undo = false }, checkedInBy) {
  let query = supabase.from('event_registrations').select(REG_SELECT)
    .eq('church_id', churchId).eq('event_id', eventId);
  if (registrationId) query = query.eq('id', registrationId);
  else if (qrToken) query = query.eq('qr_token', qrToken);
  else throw AppError.badRequest('Informe o QR ou a inscrição.');

  const { data: reg, error } = await query.maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!reg) throw AppError.notFound('Inscrição não encontrada para este evento.');

  const payload = undo
    ? { checked_in_at: null, checked_in_by: null }
    : { checked_in_at: new Date().toISOString(), checked_in_by: checkedInBy || null };

  const { data: updated, error: upErr } = await supabase
    .from('event_registrations').update(payload).eq('id', reg.id).select(REG_SELECT).single();
  if (upErr) throw new Error(upErr.message);
  return { registration: mapEventRegistration(updated), alreadyCheckedIn: Boolean(reg.checked_in_at) && !undo };
}

// --- Público (F3.2) ---

async function getPublicEventBySlug(churchId, slug) {
  const { data, error } = await supabase
    .from('events').select(EVENT_SELECT)
    .eq('church_id', churchId).eq('slug', slug).eq('is_published', true).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const counts = await countsForEvents([data.id]);
  const mapped = mapEvent(data);
  const c = counts.get(data.id) || { registrationCount: 0, checkedInCount: 0 };
  mapped.registrationCount = c.registrationCount;
  // Não expõe qr tokens nem lista de inscritos publicamente.
  return mapped;
}

module.exports = {
  listEvents,
  getEvent,
  getEventRow,
  createEvent,
  updateEvent,
  deleteEvent,
  listRegistrations,
  addRegistration,
  updateRegistration,
  deleteRegistration,
  checkin,
  getPublicEventBySlug,
};
