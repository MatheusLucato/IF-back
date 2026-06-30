// =============================================================================
// LGPD (F9.4) — consentimento, portabilidade (exportação) e anonimização.
// -----------------------------------------------------------------------------
// - Consentimento: registro por titular (user) e tipo. Direito de revogar.
// - Exportação ("meus dados"): agrega os dados pessoais do titular em um JSON.
// - Anonimização: apaga PII do membro mas PRESERVA a linha (integridade
//   contábil/histórica — o financeiro depende de member_id).
//
// Tolerante a tabelas ausentes (migração 0031 / módulos não aplicados): cada
// agregação é best-effort para a exportação não quebrar por um módulo faltante.
// =============================================================================

const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapUser, mapMember } = require('../lib/mappers');

const supabase = getSupabase();
const MIGRATION = '0031_lgpd_consents.sql';

// Catálogo de tipos de consentimento (fonte de verdade no código).
const CONSENT_TYPES = [
  { type: 'privacy_policy', label: 'Política de Privacidade', description: 'Aceite dos termos de tratamento de dados.' },
  { type: 'communications', label: 'Comunicações', description: 'Receber avisos e comunicados da igreja.' },
  { type: 'photos', label: 'Imagem', description: 'Uso de fotos/vídeos em comunicações da igreja.' },
];
const VALID_TYPES = new Set(CONSENT_TYPES.map((c) => c.type));

function isMissing(error) {
  return Boolean(error) && error.code === '42P01';
}

function mapConsent(row) {
  return {
    id: row.id,
    type: row.type,
    granted: Boolean(row.granted),
    source: row.source || null,
    grantedAt: row.granted_at || null,
    revokedAt: row.revoked_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function memberIdForUser(churchId, userId) {
  const { data } = await supabase
    .from('members').select('id').eq('church_id', churchId).eq('user_id', userId).maybeSingle();
  return data?.id || null;
}

async function listMyConsents(churchId, userId) {
  const { data, error } = await supabase
    .from('consents').select('*').eq('church_id', churchId).eq('user_id', userId);
  if (isMissing(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);

  const byType = new Map((data || []).map((r) => [r.type, mapConsent(r)]));
  // Devolve o catálogo completo, marcando o estado atual (default: não concedido).
  return CONSENT_TYPES.map((c) => ({
    ...c,
    ...(byType.get(c.type) || { granted: false, grantedAt: null, revokedAt: null }),
  }));
}

async function setConsent(churchId, userId, type, granted) {
  if (!VALID_TYPES.has(type)) throw AppError.badRequest('Tipo de consentimento inválido.');
  const now = new Date().toISOString();
  const memberId = await memberIdForUser(churchId, userId);

  const { data: existing, error: selErr } = await supabase
    .from('consents').select('id').eq('church_id', churchId).eq('user_id', userId).eq('type', type).maybeSingle();
  if (isMissing(selErr)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);

  const patch = {
    church_id: churchId, user_id: userId, member_id: memberId, type, source: 'self',
    granted, granted_at: granted ? now : null, revoked_at: granted ? null : now, updated_at: now,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('consents').update(patch).eq('id', existing.id).select('*').single();
    if (error) throw new Error(error.message);
    return mapConsent(data);
  }
  const { data, error } = await supabase.from('consents').insert(patch).select('*').single();
  if (isMissing(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);
  return mapConsent(data);
}

// Agrega os dados pessoais do titular para portabilidade (download).
async function exportMyData(user, churchId) {
  const out = {
    exportedAt: new Date().toISOString(),
    profile: mapUser(user),
  };

  // Membro + jornada
  let memberId = null;
  try {
    const { data: member } = await supabase
      .from('members').select('*').eq('church_id', churchId).eq('user_id', user.id).maybeSingle();
    if (member) {
      memberId = member.id;
      out.member = mapMember(member);
    }
  } catch { /* members opcional */ }

  if (memberId) {
    try {
      const { data: events } = await supabase
        .from('member_events').select('type,event_date,title,notes,created_at')
        .eq('church_id', churchId).eq('member_id', memberId);
      out.journey = events || [];
    } catch { /* opcional */ }

    try {
      const { data: donations } = await supabase
        .from('donations').select('amount_cents,method,status,fund_id,paid_at,created_at')
        .eq('church_id', churchId).eq('member_id', memberId);
      out.donations = donations || [];
    } catch { /* opcional */ }
  }

  // Inscrições em eventos (por e-mail).
  if (user.email) {
    try {
      const { data: regs } = await supabase
        .from('event_registrations').select('event_id,name,email,status,created_at')
        .eq('church_id', churchId).eq('email', user.email);
      out.eventRegistrations = regs || [];
    } catch { /* opcional */ }
  }

  // Consentimentos
  try {
    const { data: consents } = await supabase
      .from('consents').select('*').eq('church_id', churchId).eq('user_id', user.id);
    out.consents = (consents || []).map(mapConsent);
  } catch { /* opcional */ }

  return out;
}

// Anonimiza um membro: remove PII, preserva a linha. Audita-se no router.
async function anonymizeMember(memberId, churchId) {
  const { data: before, error: selErr } = await supabase
    .from('members').select('*').eq('id', memberId).eq('church_id', churchId).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!before) throw AppError.notFound('Membro não encontrado.');
  if (before.anonymized_at) throw AppError.conflict('Este membro já foi anonimizado.');

  const patch = {
    full_name: 'Titular anonimizado',
    social_name: null, email: null, phone: null, whatsapp: null,
    cpf: null, rg: null, photo_url: null, notes: null,
    address_zip: null, address_street: null, address_number: null, address_complement: null,
    address_district: null, address_city: null, address_state: null,
    is_active: false, anonymized_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('members').update(patch).eq('id', memberId).eq('church_id', churchId).select('*').single();
  if (error && error.code === '42703') throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);

  // Apaga consentimentos do titular (best-effort).
  try { await supabase.from('consents').delete().eq('church_id', churchId).eq('member_id', memberId); } catch { /* opcional */ }

  return { before: mapMember(before), member: mapMember(data) };
}

module.exports = { CONSENT_TYPES, listMyConsents, setConsent, exportMyData, anonymizeMember };
