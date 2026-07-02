const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');

const supabase = getSupabase();

// Colunas devolvidas ao front. Mantém snake_case para casar com o tipo
// `UnavailableDate` já usado no frontend (user_id, created_at).
const UNAVAILABLE_SELECT = 'id,user_id,date,reason,church_id,created_at';

// Postgres 23505 = violação de UNIQUE (user_id, date) — data já marcada.
function isDuplicateDate(error) {
  return Boolean(error) && error.code === '23505';
}

// Lista as indisponibilidades de um usuário dentro da igreja, por data crescente.
async function listUnavailableDates(churchId, userId) {
  const { data, error } = await supabase
    .from('user_unavailable_dates')
    .select(UNAVAILABLE_SELECT)
    .eq('church_id', churchId)
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

// Marca uma nova data de indisponibilidade.
async function addUnavailableDate({ churchId, userId, date, reason }) {
  const { data, error } = await supabase
    .from('user_unavailable_dates')
    .insert([{ user_id: userId, date, reason: reason || null, church_id: churchId }])
    .select(UNAVAILABLE_SELECT)
    .single();

  if (isDuplicateDate(error)) {
    throw AppError.conflict('Data ja esta marcada como indisponivel.');
  }
  if (error) throw new Error(error.message);
  return data;
}

// Atualiza data e/ou motivo de um registro do próprio usuário. Só aplica os
// campos informados (patch parcial). Retorna a linha atualizada.
async function updateUnavailableDate({ churchId, userId, id, date, reason }) {
  const patch = {};
  if (date !== undefined) patch.date = date;
  if (reason !== undefined) patch.reason = reason || null;

  if (Object.keys(patch).length === 0) {
    // Nada a alterar: devolve o registro atual (idempotente).
    const { data, error } = await supabase
      .from('user_unavailable_dates')
      .select(UNAVAILABLE_SELECT)
      .match({ id, user_id: userId, church_id: churchId })
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw AppError.notFound('Indisponibilidade nao encontrada.');
    return data;
  }

  const { data, error } = await supabase
    .from('user_unavailable_dates')
    .update(patch)
    .match({ id, user_id: userId, church_id: churchId })
    .select(UNAVAILABLE_SELECT)
    .maybeSingle();

  if (isDuplicateDate(error)) {
    throw AppError.conflict('Data ja esta marcada como indisponivel.');
  }
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Indisponibilidade nao encontrada.');
  return data;
}

// Remove um registro do próprio usuário.
async function deleteUnavailableDate({ churchId, userId, id }) {
  const { error } = await supabase
    .from('user_unavailable_dates')
    .delete()
    .match({ id, user_id: userId, church_id: churchId });

  if (error) throw new Error(error.message);
}

module.exports = {
  listUnavailableDates,
  addUnavailableDate,
  updateUnavailableDate,
  deleteUnavailableDate,
};
