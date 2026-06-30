const { getSupabase } = require('../db');
const { USER_SELECT } = require('../lib/constants');

const supabase = getSupabase();

// Busca um usuario por id, opcionalmente restrito ao tenant.
async function getUserById(userId, churchId) {
  let query = supabase
    .from('users')
    .select(USER_SELECT)
    .eq('id', userId);

  if (churchId) {
    query = query.eq('church_id', churchId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

module.exports = { getUserById };
