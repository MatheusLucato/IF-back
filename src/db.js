require('dotenv').config();

const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const rawSupabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function ensureDefaultAdmin() {
  const email = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@igrejafamilia.com').trim().toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .limit(1);

  if (existingError) {
    throw new Error(`Falha ao consultar usuario admin: ${existingError.message}`);
  }

  if (existing && existing.length > 0) {
    return;
  }

  const { error: insertError } = await supabase.from('users').insert({
    id: randomUUID(),
    name: 'Admin',
    full_name: 'Admin',
    email,
    password,
    password_hash: password,
    role: 'admin',
    is_approved: true,
  });

  if (insertError) {
    throw new Error(`Falha ao criar admin padrao: ${insertError.message}`);
  }
}

async function initConnection() {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    throw new Error(`Falha ao conectar no Supabase: ${error.message}`);
  }

  await ensureDefaultAdmin();
}

function getSupabase() {
  return supabase;
}

module.exports = {
  getSupabase,
  initConnection,
};
