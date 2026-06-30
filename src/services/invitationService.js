const crypto = require('crypto');
const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapInvitation } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const INVITATIONS_MIGRATION = '0007_invitations.sql';
const INVITE_SELECT = 'id,member_id,email,role,token,status,invited_by,expires_at,accepted_at,created_at,updated_at';
const INVITE_TTL_DAYS = 7;

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function findUserByEmailInChurch(email, churchId) {
  const { data } = await supabase
    .from('users')
    .select('id,email,church_id')
    .eq('church_id', churchId)
    .ilike('email', email)
    .maybeSingle();
  return data || null;
}

// Liga uma pessoa a um login (define members.user_id). Não sobrescreve vínculo.
async function linkMemberToUser(memberId, churchId, userId) {
  const { data, error } = await supabase
    .from('members')
    .update({ user_id: userId })
    .eq('id', memberId)
    .eq('church_id', churchId)
    .is('user_id', null)
    .select('id,user_id')
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending('0004_members.sql');
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Convida/vincula acesso para uma pessoa (F1.9). Estratégia em camadas:
//   1. Se já existe um login com esse e-mail na igreja → vincula direto (caso
//      comum: a pessoa fez self-register antes).
//   2. Senão, cria o registro de convite (pending) e tenta disparar o convite
//      nativo do Supabase Auth (best-effort: depende de SMTP/F7.1). Mesmo sem
//      e-mail, o convite fica registrado para acompanhamento.
async function inviteMember({ member, churchId, email, role = 'membro', invitedBy }) {
  const targetEmail = (email || member.email || '').trim().toLowerCase();
  if (!targetEmail) {
    throw AppError.badRequest('Informe um e-mail para o convite (ou cadastre o e-mail da pessoa).');
  }
  if (member.user_id) {
    throw AppError.conflict('Esta pessoa já possui acesso vinculado.');
  }

  // Caminho 1: login já existente na igreja → vínculo direto.
  const existingUser = await findUserByEmailInChurch(targetEmail, churchId);
  if (existingUser) {
    const linked = await linkMemberToUser(member.id, churchId, existingUser.id);
    if (!linked) throw AppError.conflict('Não foi possível vincular: o acesso já está em uso.');
    return { linked: true, invitation: null, emailSent: false, message: 'Acesso vinculado a uma conta existente.' };
  }

  // Caminho 2: cria o convite (pending). Reaproveita um convite pendente igual.
  const insertPayload = {
    church_id: churchId,
    member_id: member.id,
    email: targetEmail,
    role,
    token: newToken(),
    status: 'pending',
    invited_by: invitedBy || null,
    expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };

  let invitationRow;
  const { data, error } = await supabase
    .from('invitations')
    .insert(insertPayload)
    .select(INVITE_SELECT)
    .single();

  if (isMissingRelation(error)) throw migrationPending(INVITATIONS_MIGRATION);
  if (error && error.code === '23505') {
    // Já há um convite pendente para este e-mail nesta igreja: devolve o atual.
    const { data: existing } = await supabase
      .from('invitations')
      .select(INVITE_SELECT)
      .eq('church_id', churchId)
      .ilike('email', targetEmail)
      .eq('status', 'pending')
      .maybeSingle();
    invitationRow = existing;
  } else if (error) {
    throw new Error(error.message);
  } else {
    invitationRow = data;
  }

  // Best-effort: dispara o convite nativo do Supabase (não bloqueia em falha).
  let emailSent = false;
  try {
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(targetEmail, {
      data: { church_id: churchId, member_id: member.id, invited_role: role },
    });
    emailSent = !inviteError;
    if (inviteError) {
      console.warn('[invite] convite Supabase não enviado:', inviteError.message);
    }
  } catch (err) {
    console.warn('[invite] falha ao acionar convite Supabase:', err.message);
  }

  return {
    linked: false,
    invitation: invitationRow ? mapInvitation(invitationRow) : null,
    emailSent,
    message: emailSent
      ? 'Convite enviado por e-mail.'
      : 'Convite registrado. O envio automático de e-mail ainda não está configurado (F7.1); compartilhe o acesso manualmente.',
  };
}

async function listInvitations(churchId, memberId) {
  let query = supabase
    .from('invitations')
    .select(INVITE_SELECT)
    .eq('church_id', churchId)
    .order('created_at', { ascending: false });

  if (memberId) query = query.eq('member_id', memberId);

  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(INVITATIONS_MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapInvitation);
}

async function revokeInvitation(invitationId, churchId) {
  const { data, error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)
    .eq('church_id', churchId)
    .eq('status', 'pending')
    .select(INVITE_SELECT)
    .maybeSingle();

  if (isMissingRelation(error)) throw migrationPending(INVITATIONS_MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapInvitation(data) : null;
}

module.exports = {
  inviteMember,
  linkMemberToUser,
  listInvitations,
  revokeInvitation,
};
