const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapClass, mapClassEnrollment, mapClassSession, mapClassAttendance } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0010_ensino.sql';

const CLASS_SELECT = 'id,church_id,name,age_range,schedule,room,description,is_active,created_by,created_at,updated_at';
const ENROLL_SELECT = 'id,church_id,class_id,member_id,status,enrolled_at,created_at,updated_at';
const SESSION_SELECT = 'id,church_id,class_id,session_date,lesson_title,offering_cents,visitors_count,notes,created_by,created_at,updated_at';
const ATTEND_SELECT = 'id,church_id,session_id,member_id,present';

// Resolve nomes/fotos de uma lista de members (mapa id → {name, photo}).
async function membersById(churchId, memberIds) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('members').select('id,full_name,photo_url').eq('church_id', churchId).in('id', ids);
  return new Map((data || []).map((m) => [m.id, m]));
}

// --- F4.1: classes ---

async function listClasses(churchId) {
  const { data, error } = await supabase
    .from('classes').select(CLASS_SELECT).eq('church_id', churchId).order('name', { ascending: true });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const classIds = (data || []).map((c) => c.id);
  const teacherMap = new Map();
  const enrollCount = new Map();
  if (classIds.length > 0) {
    const { data: teachers } = await supabase
      .from('class_teachers').select('class_id,member_id,is_lead').eq('church_id', churchId).in('class_id', classIds);
    const { data: enrolls } = await supabase
      .from('class_enrollments').select('class_id,status').eq('church_id', churchId).in('class_id', classIds);
    const people = await membersById(churchId, (teachers || []).map((t) => t.member_id));
    for (const t of teachers || []) {
      const arr = teacherMap.get(t.class_id) || [];
      arr.push({ memberId: t.member_id, isLead: Boolean(t.is_lead), name: people.get(t.member_id)?.full_name || 'Professor' });
      teacherMap.set(t.class_id, arr);
    }
    for (const e of enrolls || []) {
      if (e.status === 'active') enrollCount.set(e.class_id, (enrollCount.get(e.class_id) || 0) + 1);
    }
  }

  return (data || []).map((row) => {
    const mapped = mapClass(row);
    mapped.teachers = teacherMap.get(row.id) || [];
    mapped.enrollmentCount = enrollCount.get(row.id) || 0;
    return mapped;
  });
}

async function getClassRow(id, churchId) {
  const { data, error } = await supabase
    .from('classes').select(CLASS_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

async function getClass(id, churchId) {
  const row = await getClassRow(id, churchId);
  if (!row) return null;
  const mapped = mapClass(row);
  const { data: teachers } = await supabase
    .from('class_teachers').select('member_id,is_lead').eq('church_id', churchId).eq('class_id', id);
  const people = await membersById(churchId, (teachers || []).map((t) => t.member_id));
  mapped.teachers = (teachers || []).map((t) => ({
    memberId: t.member_id, isLead: Boolean(t.is_lead), name: people.get(t.member_id)?.full_name || 'Professor',
  }));
  return mapped;
}

function buildClassPayload(input) {
  const out = {};
  const text = (v) => (v == null || v === '' ? null : String(v).trim());
  if (input.name !== undefined) out.name = String(input.name).trim();
  if (input.ageRange !== undefined) out.age_range = text(input.ageRange);
  if (input.schedule !== undefined) out.schedule = text(input.schedule);
  if (input.room !== undefined) out.room = text(input.room);
  if (input.description !== undefined) out.description = text(input.description);
  if (input.isActive !== undefined) out.is_active = Boolean(input.isActive);
  return out;
}

async function createClass(churchId, input, createdBy) {
  const payload = { ...buildClassPayload(input), church_id: churchId, created_by: createdBy || null };
  const { data, error } = await supabase.from('classes').insert(payload).select(CLASS_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapClass(data);
}

async function updateClass(id, churchId, input) {
  const payload = buildClassPayload(input);
  if (Object.keys(payload).length === 0) return getClass(id, churchId);
  const { data, error } = await supabase
    .from('classes').update(payload).eq('id', id).eq('church_id', churchId).select(CLASS_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapClass(data) : null;
}

async function deleteClass(id, churchId) {
  const { data, error } = await supabase
    .from('classes').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Substitui os professores da classe pela lista informada.
async function setTeachers(classId, churchId, teachers) {
  await supabase.from('class_teachers').delete().eq('church_id', churchId).eq('class_id', classId);
  if (teachers.length > 0) {
    const rows = teachers.map((t) => ({
      church_id: churchId, class_id: classId, member_id: t.memberId, is_lead: Boolean(t.isLead),
    }));
    const { error } = await supabase.from('class_teachers').insert(rows);
    if (error && error.code !== '23505') throw new Error(error.message);
  }
  return getClass(classId, churchId);
}

// --- F4.2: matrícula ---

async function listEnrollments(classId, churchId) {
  const { data, error } = await supabase
    .from('class_enrollments').select(ENROLL_SELECT).eq('church_id', churchId).eq('class_id', classId);
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  const people = await membersById(churchId, (data || []).map((e) => e.member_id));
  return (data || [])
    .map((row) => {
      const mapped = mapClassEnrollment(row);
      mapped.memberName = people.get(row.member_id)?.full_name || 'Aluno';
      mapped.photoUrl = people.get(row.member_id)?.photo_url || null;
      return mapped;
    })
    .sort((a, b) => String(a.memberName).localeCompare(String(b.memberName), 'pt-BR'));
}

async function enroll(classId, churchId, input) {
  const payload = { church_id: churchId, class_id: classId, member_id: input.memberId, status: input.status || 'active' };
  const { data, error } = await supabase.from('class_enrollments').insert(payload).select(ENROLL_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error && error.code === '23505') throw AppError.conflict('Aluno já matriculado nesta classe.');
  if (error) throw new Error(error.message);
  return mapClassEnrollment(data);
}

async function updateEnrollment(id, churchId, input) {
  const { data, error } = await supabase
    .from('class_enrollments').update({ status: input.status })
    .eq('id', id).eq('church_id', churchId).select(ENROLL_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapClassEnrollment(data) : null;
}

async function removeEnrollment(id, churchId) {
  const { data, error } = await supabase
    .from('class_enrollments').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// --- F4.3: chamada/sessões ---

async function listSessions(classId, churchId) {
  const { data, error } = await supabase
    .from('class_sessions').select(SESSION_SELECT)
    .eq('church_id', churchId).eq('class_id', classId).order('session_date', { ascending: false });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const sessionIds = (data || []).map((s) => s.id);
  const presentMap = new Map();
  if (sessionIds.length > 0) {
    const { data: att } = await supabase
      .from('class_attendance').select('session_id,present').eq('church_id', churchId).in('session_id', sessionIds);
    for (const a of att || []) {
      if (a.present) presentMap.set(a.session_id, (presentMap.get(a.session_id) || 0) + 1);
    }
  }
  return (data || []).map((row) => {
    const mapped = mapClassSession(row);
    mapped.presentCount = presentMap.get(row.id) || 0;
    return mapped;
  });
}

async function getSession(id, churchId) {
  const { data, error } = await supabase
    .from('class_sessions').select(SESSION_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const mapped = mapClassSession(data);
  const { data: att } = await supabase
    .from('class_attendance').select(ATTEND_SELECT).eq('church_id', churchId).eq('session_id', id);
  mapped.attendance = (att || []).map(mapClassAttendance);
  return mapped;
}

// Salva presenças em lote (delete + insert das presentes/ausentes informadas).
async function saveAttendance(sessionId, churchId, attendance) {
  await supabase.from('class_attendance').delete().eq('church_id', churchId).eq('session_id', sessionId);
  if (attendance && attendance.length > 0) {
    const rows = attendance.map((a) => ({
      church_id: churchId, session_id: sessionId, member_id: a.memberId, present: Boolean(a.present),
    }));
    const { error } = await supabase.from('class_attendance').insert(rows);
    if (error && error.code !== '23505') throw new Error(error.message);
  }
}

async function createSession(classId, churchId, input, createdBy) {
  const payload = {
    church_id: churchId,
    class_id: classId,
    session_date: input.sessionDate,
    lesson_title: input.lessonTitle ?? null,
    offering_cents: input.offeringCents ?? 0,
    visitors_count: input.visitorsCount ?? 0,
    notes: input.notes ?? null,
    created_by: createdBy || null,
  };
  const { data, error } = await supabase.from('class_sessions').insert(payload).select(SESSION_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error && error.code === '23505') throw AppError.conflict('Já existe uma aula registrada nesta data.');
  if (error) throw new Error(error.message);
  if (input.attendance) await saveAttendance(data.id, churchId, input.attendance);
  return getSession(data.id, churchId);
}

async function updateSession(id, churchId, input) {
  const payload = {};
  if (input.lessonTitle !== undefined) payload.lesson_title = input.lessonTitle;
  if (input.offeringCents !== undefined) payload.offering_cents = input.offeringCents;
  if (input.visitorsCount !== undefined) payload.visitors_count = input.visitorsCount;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (Object.keys(payload).length > 0) {
    const { error } = await supabase.from('class_sessions').update(payload).eq('id', id).eq('church_id', churchId);
    if (isMissingRelation(error)) throw migrationPending(MIGRATION);
    if (error) throw new Error(error.message);
  }
  if (input.attendance) await saveAttendance(id, churchId, input.attendance);
  return getSession(id, churchId);
}

async function deleteSession(id, churchId) {
  const { data, error } = await supabase
    .from('class_sessions').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// --- F4.4: relatórios ---
// Frequência por aluno + totais por sessão de uma classe (agregação read-only).

async function classReport(classId, churchId) {
  const sessions = await listSessions(classId, churchId);
  const enrollments = await listEnrollments(classId, churchId);
  const sessionIds = sessions.map((s) => s.id);

  const perMember = new Map();
  if (sessionIds.length > 0) {
    const { data: att } = await supabase
      .from('class_attendance').select('member_id,present').eq('church_id', churchId).in('session_id', sessionIds);
    for (const a of att || []) {
      const m = perMember.get(a.member_id) || { present: 0, total: 0 };
      m.total += 1;
      if (a.present) m.present += 1;
      perMember.set(a.member_id, m);
    }
  }

  const totalSessions = sessions.length;
  const students = enrollments.map((e) => {
    const stat = perMember.get(e.memberId) || { present: 0, total: 0 };
    const denom = stat.total || totalSessions;
    return {
      memberId: e.memberId,
      memberName: e.memberName,
      present: stat.present,
      total: denom,
      rate: denom > 0 ? Math.round((stat.present / denom) * 100) : 0,
    };
  }).sort((a, b) => b.rate - a.rate);

  return {
    totalSessions,
    totalStudents: enrollments.length,
    averageAttendance: sessions.length
      ? Math.round(sessions.reduce((acc, s) => acc + (s.presentCount || 0), 0) / sessions.length)
      : 0,
    totalOfferingCents: sessions.reduce((acc, s) => acc + (s.offeringCents || 0), 0),
    sessions: sessions.map((s) => ({
      id: s.id, date: s.sessionDate, presentCount: s.presentCount || 0,
      visitorsCount: s.visitorsCount || 0, offeringCents: s.offeringCents || 0,
    })),
    students,
  };
}

module.exports = {
  listClasses,
  getClass,
  getClassRow,
  createClass,
  updateClass,
  deleteClass,
  setTeachers,
  listEnrollments,
  enroll,
  updateEnrollment,
  removeEnrollment,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  classReport,
};
