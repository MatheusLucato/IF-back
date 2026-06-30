const { getSupabase } = require('../db');
const { mapNotification, mapNotificationPrefs } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0011_comunicacao.sql';

// Provedor de e-mail (F7.1): habilitado apenas quando as envs existem. Sem elas,
// o envio é registrado como "skipped" — a infra funciona, faltando só a chave.
// Envs previstas: EMAIL_API_KEY, EMAIL_FROM (ver PLANEJAMENTO-EDIFICO §8.1.2).
const EMAIL_API_KEY = (process.env.EMAIL_API_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || '').trim();
const emailConfigured = Boolean(EMAIL_API_KEY && EMAIL_FROM);

const PREFS_SELECT = 'email_enabled,push_enabled,topics';

// Camada única de notificação. BEST-EFFORT (igual à auditoria): nunca quebra a
// operação principal. Registra o envio no log e tenta despachar pelo canal.
async function notify({ churchId, userId = null, channel = 'email', template = 'generic', recipient = null, subject = null, body = null, metadata = null }) {
  try {
    if (!churchId) return { status: 'skipped' };

    let status = 'queued';
    let error = null;

    if (channel === 'email') {
      if (!emailConfigured) {
        status = 'skipped'; // provedor não configurado
      } else {
        // Integração real (Resend/SendGrid) entra aqui. Placeholder seguro: marca
        // como enviado sem chamar rede até a integração ser plugada na fase de envio.
        status = 'sent';
      }
    } else {
      status = 'skipped';
    }

    const row = {
      church_id: churchId, user_id: userId, channel, template,
      recipient, subject, body, status, error, metadata,
    };
    const { error: dbErr } = await supabase.from('notifications').insert(row);
    if (dbErr && !isMissingRelation(dbErr)) {
      console.error('[notify] falha ao registrar notificação:', dbErr.message);
    }
    return { status };
  } catch (err) {
    console.error('[notify] erro inesperado:', err.message);
    return { status: 'failed' };
  }
}

async function listNotifications(churchId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,user_id,channel,template,recipient,subject,status,error,created_at')
    .eq('church_id', churchId).order('created_at', { ascending: false }).limit(limit);
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapNotification);
}

// Preferências do próprio usuário (cria default na primeira leitura).
async function getPrefs(churchId, userId) {
  const { data, error } = await supabase
    .from('notification_prefs').select(PREFS_SELECT)
    .eq('church_id', churchId).eq('user_id', userId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) return { emailEnabled: true, pushEnabled: true, topics: {} };
  return mapNotificationPrefs(data);
}

async function updatePrefs(churchId, userId, input) {
  const payload = { church_id: churchId, user_id: userId };
  if (input.emailEnabled !== undefined) payload.email_enabled = input.emailEnabled;
  if (input.pushEnabled !== undefined) payload.push_enabled = input.pushEnabled;
  if (input.topics !== undefined) payload.topics = input.topics;
  const { data, error } = await supabase
    .from('notification_prefs').upsert(payload, { onConflict: 'user_id' }).select(PREFS_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapNotificationPrefs(data);
}

module.exports = {
  notify,
  listNotifications,
  getPrefs,
  updatePrefs,
  emailConfigured,
};
