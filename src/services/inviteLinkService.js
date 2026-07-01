const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { USER_SELECT } = require('../lib/constants');
const { mapInviteLink, mapUser } = require('../lib/mappers');
const { normalizeBirthDate } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { createAuthUser, getChurchBundle } = require('./churchService');
const { ensureMemberForUser } = require('./memberService');

const supabase = getSupabase();
const INVITE_LINKS_MIGRATION = '0042_invite_links.sql';
const INVITE_LINK_SELECT =
  'id,church_id,token,label,role,max_uses,uses,expires_at,is_active,created_by,created_at,updated_at';
// Papéis que um convite pode conceder. O fluxo nasce com "membro" (papel padrão);
// o admin/pastor ajusta depois em Papéis & Permissões.
const INVITABLE_ROLES = ['membro', 'lider'];

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Um link é "válido" enquanto estiver ativo, não expirado e dentro do limite.
function isLinkUsable(row) {
  if (!row || !row.is_active) return false;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return false;
  if (row.max_uses != null && row.uses >= row.max_uses) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Administração (autenticado, escopo da igreja do usuário).
// ----------------------------------------------------------------------------

async function createInviteLink({ churchId, role, label, maxUses, expiresInDays, createdBy }) {
  const grantedRole = INVITABLE_ROLES.includes(role) ? role : 'membro';
  const expiresAt =
    expiresInDays && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { data, error } = await supabase
    .from('invite_links')
    .insert({
      church_id: churchId,
      token: newToken(),
      label: label ? String(label).trim() : null,
      role: grantedRole,
      max_uses: maxUses && maxUses > 0 ? maxUses : null,
      expires_at: expiresAt,
      created_by: createdBy || null,
    })
    .select(INVITE_LINK_SELECT)
    .single();

  if (isMissingRelation(error)) throw migrationPending(INVITE_LINKS_MIGRATION);
  if (error) throw new Error(error.message);
  return mapInviteLink(data);
}

async function listInviteLinks(churchId) {
  const { data, error } = await supabase
    .from('invite_links')
    .select(INVITE_LINK_SELECT)
    .eq('church_id', churchId)
    .order('created_at', { ascending: false });

  if (isMissingRelation(error)) throw migrationPending(INVITE_LINKS_MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapInviteLink);
}

async function revokeInviteLink(id, churchId) {
  const { data, error } = await supabase
    .from('invite_links')
    .update({ is_active: false })
    .eq('id', id)
    .eq('church_id', churchId)
    .eq('is_active', true)
    .select(INVITE_LINK_SELECT)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(INVITE_LINKS_MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapInviteLink(data) : null;
}

// ----------------------------------------------------------------------------
// Fluxo público (sem login). A igreja é resolvida SOMENTE pelo token — nenhuma
// outra igreja é exposta.
// ----------------------------------------------------------------------------

async function getInviteRowByToken(token) {
  const { data, error } = await supabase
    .from('invite_links')
    .select(INVITE_LINK_SELECT)
    .eq('token', token)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(INVITE_LINKS_MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

// Resolve o convite + identidade da igreja para a tela pública de cadastro.
// Lança erro amigável quando inválido/expirado (nunca vaza outras igrejas).
async function getInviteByToken(token) {
  const invite = await getInviteRowByToken(token);
  if (!invite) throw AppError.notFound('Convite não encontrado.');
  if (!isLinkUsable(invite)) {
    throw AppError.gone('Este convite não está mais disponível. Peça um novo link à liderança da sua igreja.');
  }

  const { church, settings } = await getChurchBundle(invite.church_id);
  if (!church) throw AppError.notFound('Igreja do convite não encontrada.');

  return {
    invite: { token: invite.token, role: invite.role },
    church: { name: church.tradeName || church.name, slug: church.slug },
    settings,
  };
}

// Cria a conta (auth + users + member) já vinculada à igreja do convite e
// consome um uso do link de forma atômica. O convite é a autorização: a conta
// nasce aprovada com o papel padrão do link.
async function registerViaInvite(token, { name, email, password, birthDate, gender, phone, cpf }) {
  const invite = await getInviteRowByToken(token);
  if (!invite) throw AppError.notFound('Convite não encontrado.');
  if (!isLinkUsable(invite)) {
    throw AppError.gone('Este convite não está mais disponível. Peça um novo link à liderança da sua igreja.');
  }

  const normalizedBirthDate = normalizeBirthDate(birthDate);
  if (!normalizedBirthDate) {
    throw AppError.badRequest('Data de nascimento invalida. Use o formato YYYY-MM-DD.');
  }
  if (new Date(`${normalizedBirthDate}T00:00:00Z`) > new Date()) {
    throw AppError.badRequest('Data de nascimento nao pode ser no futuro.');
  }

  // Campos essenciais exigidos no cadastro: garantem que a pessoa nasça com o
  // perfil preenchido (o restante fica opcional e aparece como "Não informado").
  const normalizedGender = ['male', 'female', 'other'].includes(gender) ? gender : null;
  if (!normalizedGender) throw AppError.badRequest('Genero invalido.');
  const normalizedPhone = String(phone || '').trim();
  if (!normalizedPhone) throw AppError.badRequest('Telefone e obrigatorio.');
  const normalizedCpf = String(cpf || '').trim();
  if (!normalizedCpf) throw AppError.badRequest('CPF e obrigatorio.');

  const churchId = invite.church_id;
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', normalizedEmail).eq('church_id', churchId).limit(1);
  if (existing && existing.length > 0) {
    throw AppError.conflict('Email ja cadastrado nesta igreja.');
  }

  const authUser = await createAuthUser(normalizedEmail, String(password));

  const safeName = String(name).trim();
  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      id: randomUUID(),
      name: safeName,
      full_name: safeName,
      email: normalizedEmail,
      password_hash: 'supabase-auth',
      birth_date: normalizedBirthDate,
      role: invite.role,
      auth_user_id: authUser.id,
      church_id: churchId,
    })
    .select(USER_SELECT)
    .single();
  if (createError) throw new Error(createError.message);

  // Invariante "1 user ⇒ 1 member" (F1.1): cria a pessoa correspondente já com
  // os dados essenciais coletados no cadastro.
  await ensureMemberForUser(created, churchId, {
    gender: normalizedGender,
    phone: normalizedPhone,
    cpf: normalizedCpf,
  });

  // Consome um uso do link de forma atômica (respeita limite/expiração).
  const { error: consumeError } = await supabase.rpc('consume_invite_link', { p_token: token });
  if (consumeError) console.warn('[invite-link] falha ao consumir uso do convite:', consumeError.message);

  return mapUser(created);
}

module.exports = {
  createInviteLink,
  listInviteLinks,
  revokeInviteLink,
  getInviteByToken,
  registerViaInvite,
};
