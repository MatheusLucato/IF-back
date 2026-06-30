const { getSupabase } = require('../db');
const { MEMBER_SELECT } = require('../lib/constants');
const { mapMember, mapFamily, mapMemberEvent } = require('../lib/mappers');
const { normalizeBirthDate, getMonthAndDay } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MEMBERS_MIGRATION = '0004_members.sql';

// Saneia termos de busca para o filtro `.or()` do PostgREST: vírgula e parênteses
// têm significado sintático ali e quebrariam a query.
function sanitizeSearchTerm(term) {
  return String(term || '').replace(/[(),]/g, ' ').trim();
}

// Converte o payload da API (camelCase, address aninhado) para colunas do banco
// (snake_case). `partial` apenas documenta a intenção — em ambos os casos só
// gravamos as chaves presentes no input (update parcial seguro).
function buildMemberDbPayload(input) {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const text = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };
  const dateValue = (v) => (v == null || v === '' ? null : normalizeBirthDate(String(v)));

  if (has('fullName')) out.full_name = String(input.fullName).trim();
  if (has('socialName')) out.social_name = text(input.socialName);
  if (has('gender')) out.gender = text(input.gender);
  if (has('birthDate')) out.birth_date = dateValue(input.birthDate);
  if (has('maritalStatus')) out.marital_status = text(input.maritalStatus);
  if (has('cpf')) out.cpf = text(input.cpf);
  if (has('rg')) out.rg = text(input.rg);
  if (has('email')) out.email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (has('phone')) out.phone = text(input.phone);
  if (has('whatsapp')) out.whatsapp = text(input.whatsapp);
  if (has('photoUrl')) out.photo_url = input.photoUrl == null ? null : String(input.photoUrl);
  if (has('membershipStatus')) out.membership_status = input.membershipStatus;
  if (has('joinedAt')) out.joined_at = dateValue(input.joinedAt);
  if (has('baptismDate')) out.baptism_date = dateValue(input.baptismDate);
  if (has('conversionDate')) out.conversion_date = dateValue(input.conversionDate);
  if (has('notes')) out.notes = text(input.notes);
  if (has('isActive')) out.is_active = Boolean(input.isActive);

  if (has('address') && input.address && typeof input.address === 'object') {
    const a = input.address;
    const map = {
      zip: 'address_zip',
      street: 'address_street',
      number: 'address_number',
      complement: 'address_complement',
      district: 'address_district',
      city: 'address_city',
      state: 'address_state',
    };
    for (const [key, col] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(a, key)) out[col] = text(a[key]);
    }
  }

  return out;
}

// Lista paginada com busca/filtros/ordenação (F1.2). Retorna { members, total, page, pageSize }.
async function listMembers(churchId, { search, status, gender, hasAccess, active, page = 1, pageSize = 20, sort = 'name' }) {
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('members')
    .select(MEMBER_SELECT, { count: 'exact' })
    .eq('church_id', churchId);

  const term = sanitizeSearchTerm(search);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      `full_name.ilike.${pattern},social_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},cpf.ilike.${pattern}`,
    );
  }
  if (status) query = query.eq('membership_status', status);
  if (gender) query = query.eq('gender', gender);
  if (hasAccess === 'true') query = query.not('user_id', 'is', null);
  if (hasAccess === 'false') query = query.is('user_id', null);
  if (active === 'true') query = query.eq('is_active', true);
  if (active === 'false') query = query.eq('is_active', false);

  if (sort === 'recent') query = query.order('created_at', { ascending: false });
  else if (sort === 'status') query = query.order('membership_status', { ascending: true }).order('full_name', { ascending: true });
  else query = query.order('full_name', { ascending: true });

  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);

  return {
    members: (data || []).map(mapMember),
    total: count ?? null,
    page,
    pageSize,
  };
}

// Busca a linha bruta (uso interno: auditoria, integrações).
async function getMemberRow(memberId, churchId) {
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_SELECT)
    .eq('id', memberId)
    .eq('church_id', churchId)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

// Detalhe da pessoa com agregações para o perfil (F1.3): famílias (com co-membros),
// ministérios vinculados (quando a pessoa tem login) e contagem de eventos.
async function getMemberDetail(memberId, churchId) {
  const row = await getMemberRow(memberId, churchId);
  if (!row) return null;

  const member = mapMember(row);
  member.families = await getMemberFamilies(memberId, churchId);
  member.ministries = await getMemberMinistries(row.user_id, churchId);
  return member;
}

// Famílias da pessoa, cada uma com os demais integrantes (nome/papel) para a aba Família.
async function getMemberFamilies(memberId, churchId) {
  const { data: links, error } = await supabase
    .from('family_members')
    .select('family_id,role,is_head')
    .eq('church_id', churchId)
    .eq('member_id', memberId);

  // Famílias são opcionais: se a migração 0005 não rodou, apenas omite a aba.
  if (isMissingRelation(error) || error || !links || links.length === 0) return [];

  const familyIds = [...new Set(links.map((l) => l.family_id))];
  const { data: families } = await supabase
    .from('families')
    .select('id,name,notes,created_at,updated_at')
    .eq('church_id', churchId)
    .in('id', familyIds);

  const { data: allLinks } = await supabase
    .from('family_members')
    .select('id,family_id,member_id,role,is_head')
    .eq('church_id', churchId)
    .in('family_id', familyIds);

  const memberIds = [...new Set((allLinks || []).map((l) => l.member_id))];
  const { data: people } = await supabase
    .from('members')
    .select('id,full_name,photo_url')
    .eq('church_id', churchId)
    .in('id', memberIds);
  const peopleById = new Map((people || []).map((p) => [p.id, p]));

  return (families || []).map((fam) => {
    const mapped = mapFamily(fam);
    mapped.members = (allLinks || [])
      .filter((l) => l.family_id === fam.id)
      .map((l) => ({
        id: l.id,
        memberId: l.member_id,
        role: l.role || 'other',
        isHead: Boolean(l.is_head),
        name: peopleById.get(l.member_id)?.full_name || 'Pessoa',
        photoUrl: peopleById.get(l.member_id)?.photo_url || null,
      }));
    return mapped;
  });
}

// Ministérios da pessoa via vínculo de login (best-effort; usa users hoje).
async function getMemberMinistries(userId, churchId) {
  if (!userId) return [];
  try {
    const { data: links, error } = await supabase
      .from('ministry_members')
      .select('ministry_id,function_names')
      .eq('user_id', userId);
    if (error || !links || links.length === 0) return [];

    const ministryIds = [...new Set(links.map((l) => l.ministry_id))];
    const { data: ministries } = await supabase
      .from('ministries')
      .select('id,name,color')
      .eq('church_id', churchId)
      .in('id', ministryIds);
    const byId = new Map((ministries || []).map((m) => [m.id, m]));

    return links
      .filter((l) => byId.has(l.ministry_id))
      .map((l) => ({
        ministryId: l.ministry_id,
        name: byId.get(l.ministry_id).name,
        color: byId.get(l.ministry_id).color || null,
        functionNames: Array.isArray(l.function_names) ? l.function_names : [],
      }));
  } catch {
    return [];
  }
}

async function createMember(churchId, input) {
  const payload = { ...buildMemberDbPayload(input), church_id: churchId };

  const { data, error } = await supabase
    .from('members')
    .insert(payload)
    .select(MEMBER_SELECT)
    .single();

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);
  return mapMember(data);
}

async function updateMember(memberId, churchId, input) {
  const payload = buildMemberDbPayload(input);
  if (Object.keys(payload).length === 0) {
    // Nada a alterar: devolve o estado atual.
    const row = await getMemberRow(memberId, churchId);
    return row ? mapMember(row) : null;
  }

  const { data, error } = await supabase
    .from('members')
    .update(payload)
    .eq('id', memberId)
    .eq('church_id', churchId)
    .select(MEMBER_SELECT)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapMember(data) : null;
}

async function deleteMember(memberId, churchId) {
  const { data, error } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
    .eq('church_id', churchId)
    .select('id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Aniversariantes do mês (F1.7) — substitui o /api/users/birthdays. Filtra por
// mês no app (datas guardadas como `date`), ordena por dia e nome.
async function listBirthdays(churchId, month) {
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_SELECT)
    .eq('church_id', churchId)
    .eq('is_active', true)
    .not('birth_date', 'is', null);

  if (isMissingRelation(error)) throw migrationPending(MEMBERS_MIGRATION);
  if (error) throw new Error(error.message);

  return (data || [])
    .filter((row) => {
      const parsed = getMonthAndDay(row.birth_date);
      return parsed && parsed.month === month;
    })
    .sort((a, b) => {
      const aDate = getMonthAndDay(a.birth_date);
      const bDate = getMonthAndDay(b.birth_date);
      if (!aDate || !bDate) return 0;
      if (aDate.day !== bDate.day) return aDate.day - bDate.day;
      return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'pt-BR');
    })
    .map(mapMember);
}

// Garante a invariante "todo user ⇒ 1 member" ao criar um login novo
// (register/onboarding). BEST-EFFORT: nunca quebra o cadastro — se a migração
// 0004 ainda não rodou (ou qualquer erro), apenas não cria o member.
// Recebe a linha BRUTA do user (snake_case) recém-criada.
async function ensureMemberForUser(userRow, churchId) {
  if (!userRow || !userRow.id || !churchId) return null;
  try {
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('user_id', userRow.id)
      .maybeSingle();
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('members')
      .insert({
        church_id: churchId,
        user_id: userRow.id,
        full_name: userRow.full_name || userRow.name || 'Sem nome',
        email: userRow.email || null,
        birth_date: userRow.birth_date || null,
        photo_url: userRow.profile_picture || null,
        membership_status: 'member',
      })
      .select('id')
      .single();
    if (error) return null;
    return data.id;
  } catch {
    return null;
  }
}

// --- Jornada / eventos (F1.5) ---

async function listMemberEvents(memberId, churchId) {
  const { data, error } = await supabase
    .from('member_events')
    .select('id,member_id,type,event_date,title,notes,metadata,created_by,created_at')
    .eq('church_id', churchId)
    .eq('member_id', memberId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (isMissingRelation(error)) throw migrationPending('0006_member_events.sql');
  if (error) throw new Error(error.message);
  return (data || []).map(mapMemberEvent);
}

async function createMemberEvent(memberId, churchId, input, createdBy) {
  const payload = {
    church_id: churchId,
    member_id: memberId,
    type: input.type,
    event_date: input.eventDate ? normalizeBirthDate(String(input.eventDate)) : null,
    title: input.title ? String(input.title).trim() : null,
    notes: input.notes ? String(input.notes).trim() : null,
    metadata: input.metadata ?? null,
    created_by: createdBy || null,
  };
  // event_date NOT NULL com default no banco: só envia se válido.
  if (!payload.event_date) delete payload.event_date;

  const { data, error } = await supabase
    .from('member_events')
    .insert(payload)
    .select('id,member_id,type,event_date,title,notes,metadata,created_by,created_at')
    .single();

  if (isMissingRelation(error)) throw migrationPending('0006_member_events.sql');
  if (error) throw new Error(error.message);
  return mapMemberEvent(data);
}

module.exports = {
  buildMemberDbPayload,
  ensureMemberForUser,
  listMembers,
  getMemberRow,
  getMemberDetail,
  getMemberFamilies,
  createMember,
  updateMember,
  deleteMember,
  listBirthdays,
  listMemberEvents,
  createMemberEvent,
};
