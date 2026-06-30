const { getSupabase } = require('../db');
const { mapAnnouncement, mapPrayerRequest } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { notify, getPrefs } = require('./notificationService');

const supabase = getSupabase();
const MIGRATION = '0011_comunicacao.sql';

const ANN_SELECT = 'id,church_id,title,body,audience,audience_ref,is_pinned,publish_at,expires_at,author_id,created_at,updated_at';
const PRAYER_SELECT = 'id,church_id,member_id,requester_name,title,body,visibility,status,is_anonymous,created_by,created_at,updated_at';

// =============================== F7.2 — Avisos =============================

// Feed: avisos publicados e não expirados, fixados primeiro.
async function listAnnouncements(churchId, { includeUnpublished = false } = {}) {
  let query = supabase.from('announcements').select(ANN_SELECT).eq('church_id', churchId);
  if (!includeUnpublished) {
    const nowIso = new Date().toISOString();
    query = query.lte('publish_at', nowIso);
  }
  query = query.order('is_pinned', { ascending: false }).order('publish_at', { ascending: false });
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  const nowIso = new Date().toISOString();
  return (data || [])
    .filter((row) => includeUnpublished || !row.expires_at || row.expires_at > nowIso)
    .map(mapAnnouncement);
}

async function createAnnouncement(churchId, input, authorId) {
  const payload = {
    church_id: churchId,
    title: input.title,
    body: input.body ?? '',
    audience: input.audience || 'all',
    audience_ref: input.audienceRef || null,
    is_pinned: Boolean(input.isPinned),
    author_id: authorId || null,
  };
  if (input.publishAt) payload.publish_at = input.publishAt;
  if (input.expiresAt !== undefined) payload.expires_at = input.expiresAt || null;
  const { data, error } = await supabase.from('announcements').insert(payload).select(ANN_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapAnnouncement(data);
}

async function updateAnnouncement(id, churchId, input) {
  const payload = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.body !== undefined) payload.body = input.body;
  if (input.audience !== undefined) payload.audience = input.audience;
  if (input.audienceRef !== undefined) payload.audience_ref = input.audienceRef || null;
  if (input.isPinned !== undefined) payload.is_pinned = input.isPinned;
  if (input.publishAt !== undefined) payload.publish_at = input.publishAt;
  if (input.expiresAt !== undefined) payload.expires_at = input.expiresAt || null;
  const { data, error } = await supabase
    .from('announcements').update(payload).eq('id', id).eq('church_id', churchId).select(ANN_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapAnnouncement(data) : null;
}

async function deleteAnnouncement(id, churchId) {
  const { data, error } = await supabase
    .from('announcements').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// =============================== F7.4 — Oração ==============================

async function listPrayerRequests(churchId, { status, canSeeRestricted = false, userId = null } = {}) {
  let query = supabase.from('prayer_requests').select(PRAYER_SELECT)
    .eq('church_id', churchId).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  // Quem não tem gestão pastoral só vê os públicos + os próprios.
  return (data || [])
    .filter((row) => canSeeRestricted || row.visibility === 'public' || (userId && row.created_by === userId))
    .map((row) => {
      const mapped = mapPrayerRequest(row);
      if (mapped.isAnonymous) mapped.requesterName = null;
      return mapped;
    });
}

async function createPrayerRequest(churchId, input, createdBy) {
  const payload = {
    church_id: churchId,
    member_id: input.memberId || null,
    requester_name: input.isAnonymous ? null : (input.requesterName || null),
    title: input.title || null,
    body: input.body,
    visibility: input.visibility || 'pastoral',
    is_anonymous: Boolean(input.isAnonymous),
    created_by: createdBy || null,
  };
  const { data, error } = await supabase.from('prayer_requests').insert(payload).select(PRAYER_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapPrayerRequest(data);
}

async function updatePrayerRequest(id, churchId, input) {
  const payload = {};
  if (input.status !== undefined) payload.status = input.status;
  if (input.visibility !== undefined) payload.visibility = input.visibility;
  if (input.title !== undefined) payload.title = input.title;
  if (input.body !== undefined) payload.body = input.body;
  const { data, error } = await supabase
    .from('prayer_requests').update(payload).eq('id', id).eq('church_id', churchId).select(PRAYER_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapPrayerRequest(data) : null;
}

async function deletePrayerRequest(id, churchId) {
  const { data, error } = await supabase
    .from('prayer_requests').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// =============================== F7.3 — Automações ==========================

const DEFAULT_AUTOMATIONS = {
  schedule_reminder: false,
  birthday: false,
  event_confirmation: false,
};

async function getAutomationSettings(churchId) {
  const { data, error } = await supabase
    .from('automation_settings').select('settings').eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return { ...DEFAULT_AUTOMATIONS, ...((data && data.settings) || {}) };
}

async function updateAutomationSettings(churchId, settings) {
  const merged = { ...DEFAULT_AUTOMATIONS, ...settings };
  const { data, error } = await supabase
    .from('automation_settings').upsert({ church_id: churchId, settings: merged }, { onConflict: 'church_id' })
    .select('settings').single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return { ...DEFAULT_AUTOMATIONS, ...((data && data.settings) || {}) };
}

// Gatilho de lembrete de escala (F7.3): encontra escalas nos próximos `daysAhead`
// dias e registra uma notificação por usuário escalado (respeitando prefs). Pode
// ser acionado manualmente (admin) ou por um cron externo no futuro.
async function runScheduleReminders(churchId, { daysAhead = 3 } = {}) {
  const automations = await getAutomationSettings(churchId);
  if (!automations.schedule_reminder) {
    return { triggered: false, reason: 'automation_disabled', notified: 0 };
  }

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

  const { data: schedules, error } = await supabase
    .from('schedules').select('id,date,service_time,assignments,music_minister_id')
    .eq('church_id', churchId).gte('date', start).lte('date', endDate);
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  // Coleta os user ids escalados.
  const userIds = new Set();
  for (const s of schedules || []) {
    const assignments = Array.isArray(s.assignments) ? s.assignments : [];
    for (const a of assignments) {
      for (const m of (a.members || [])) {
        if (m.memberId) userIds.add(m.memberId);
      }
    }
    if (s.music_minister_id) userIds.add(s.music_minister_id);
  }
  if (userIds.size === 0) return { triggered: true, notified: 0, schedules: (schedules || []).length };

  const { data: users } = await supabase
    .from('users').select('id,email,name,full_name').eq('church_id', churchId).in('id', [...userIds]);
  const usersById = new Map((users || []).map((u) => [u.id, u]));

  let notified = 0;
  for (const uid of userIds) {
    const u = usersById.get(uid);
    if (!u || !u.email) continue;
    const prefs = await getPrefs(churchId, uid);
    if (!prefs.emailEnabled) continue;
    if (prefs.topics && prefs.topics.schedule === false) continue;
    await notify({
      churchId,
      userId: uid,
      channel: 'email',
      template: 'schedule_reminder',
      recipient: u.email,
      subject: 'Lembrete: você está escalado(a)',
      body: `Olá ${u.name || u.full_name || ''}, você tem uma escala nos próximos ${daysAhead} dias.`,
      metadata: { kind: 'schedule_reminder' },
    });
    notified += 1;
  }

  return { triggered: true, notified, schedules: (schedules || []).length };
}

module.exports = {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listPrayerRequests,
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  getAutomationSettings,
  updateAutomationSettings,
  runScheduleReminders,
};
