const { getSupabase } = require('../db');
const { mapChurch, mapChurchSettings } = require('../lib/mappers');

const supabase = getSupabase();

// Carrega igreja (tenant) + configuracoes/identidade visual em um unico bundle.
async function getChurchBundle(churchId) {
  const { data: church } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle();
  const { data: settings } = await supabase.from('church_settings').select('*').eq('church_id', churchId).maybeSingle();
  return { church: mapChurch(church), settings: mapChurchSettings(settings) };
}

// Cria a identidade no Supabase Auth. Lanca 409 quando o email ja existe.
async function createAuthUser(email, password) {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (/already.*registered|exists/i.test(error.message || '')) {
      const err = new Error('Email ja cadastrado.');
      err.statusCode = 409;
      throw err;
    }
    throw new Error(error.message);
  }
  return data.user;
}

module.exports = { getChurchBundle, createAuthUser };
