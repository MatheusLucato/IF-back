require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const rawSupabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();

function parseCompositeSecretKey(value) {
  if (!value) return { projectRefOrUrl: '', secretKey: '' };

  const byPipe = value.split('|');
  if (byPipe.length >= 2) {
    return {
      projectRefOrUrl: byPipe[0].trim(),
      secretKey: byPipe.slice(1).join('|').trim(),
    };
  }

  return { projectRefOrUrl: '', secretKey: value };
}

const parsedComposite = parseCompositeSecretKey(rawSupabaseSecretKey);
const SUPABASE_SECRET_KEY = parsedComposite.secretKey;

function extractProjectRefFromLegacyJwtKey(key) {
  if (!key || typeof key !== 'string') return null;

  const parts = key.split('.');
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    const ref = (payload && (payload.ref || payload.project_ref)) || null;
    if (typeof ref === 'string' && ref.trim()) {
      return ref.trim();
    }
    return null;
  } catch {
    return null;
  }
}

const compositeValue = parsedComposite.projectRefOrUrl;
const compositeUrl = /^https?:\/\//i.test(compositeValue) ? compositeValue : '';
const compositeProjectRef = compositeUrl ? '' : compositeValue;
const projectRefFromKey = extractProjectRefFromLegacyJwtKey(SUPABASE_SECRET_KEY);
const resolvedProjectRef = compositeProjectRef || projectRefFromKey;
const SUPABASE_URL = compositeUrl || (resolvedProjectRef ? `https://${resolvedProjectRef}.supabase.co` : '');

if (!SUPABASE_SECRET_KEY) {
  throw new Error('SUPABASE_SECRET_KEY e obrigatoria no .env e no Render.');
}

if (!SUPABASE_URL) {
  throw new Error('Defina SUPABASE_SECRET_KEY no formato "project_ref|sb_secret_..." (ou "https://projeto.supabase.co|sb_secret_...").');
}

// Cliente ADMIN (service-role): ignora o RLS. Usado para operações privilegiadas
// do backend (autenticação, criação de tenants, jobs). O isolamento por tenant
// é garantido no código via church_id (ver middleware/auth.js).
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Cliente por-requisição vinculado ao JWT do usuário: respeita o RLS.
// Use quando quiser que o banco aplique o isolamento de tenant (defesa em
// profundidade) além do scoping em código.
function createUserClientFromToken(accessToken) {
  if (!SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_ANON_KEY e obrigatoria para criar clientes por usuario (RLS).');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Valida o access token do Supabase e devolve o usuário do auth.users.
async function getAuthUserFromToken(accessToken) {
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}

const DEFAULT_CHURCH_SLUG = 'igreja-familia';

async function ensureDefaultChurch() {
  const { data: existing, error } = await supabase
    .from('churches')
    .select('id')
    .eq('slug', DEFAULT_CHURCH_SLUG)
    .maybeSingle();

  if (error) throw new Error(`Falha ao consultar igreja padrao: ${error.message}`);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from('churches')
    .insert({ name: 'Igreja Família', trade_name: 'Igreja Família', slug: DEFAULT_CHURCH_SLUG, country: 'Brasil' })
    .select('id')
    .single();

  if (insertError) throw new Error(`Falha ao criar igreja padrao: ${insertError.message}`);

  await supabase.from('church_settings').insert({ church_id: created.id }).select('church_id').maybeSingle();
  return created.id;
}

async function initConnection() {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    throw new Error(`Falha ao conectar no Supabase: ${error.message}`);
  }

  await ensureDefaultChurch();
}

function getSupabase() {
  return supabase;
}

module.exports = {
  getSupabase,
  createUserClientFromToken,
  getAuthUserFromToken,
  initConnection,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
};
