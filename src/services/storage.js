require('dotenv').config();

const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// --- Configuração do Cloudflare R2 (S3-compatível) ---
// As envs ainda podem não existir: nesse caso o serviço opera em modo "fallback"
// e devolve um data URL (comportamento legado), sem quebrar a aplicação. Basta
// preencher as envs no .env / Render para que o upload passe a ir para o R2.
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET || '').trim();
// Base pública usada para montar a URL final do asset. Pode ser o domínio
// custom (ex.: https://cdn.suaigreja.com) ou o subdomínio r2.dev do bucket.
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
// Endpoint da API S3 do R2. Por padrão é derivado do account id, mas pode ser
// sobrescrito via env caso necessário.
const R2_ENDPOINT = (
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')
).trim();

const hasCredentials = Boolean(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_ENDPOINT);
const isConfigured = hasCredentials && Boolean(R2_PUBLIC_BASE_URL);

let client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

function extFromMime(mime) {
  return EXT_BY_MIME[mime] || 'bin';
}

function bufferToDataUrl(buffer, mime) {
  return `data:${mime || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
}

// Monta a chave do objeto isolada por tenant (igreja). Ex.:
// tenants/<churchId>/branding/<uuid>.png
function buildKey({ churchId, category, mime }) {
  const safeChurch = churchId || 'shared';
  const safeCategory = (category || 'misc').replace(/^\/+|\/+$/g, '');
  return `tenants/${safeChurch}/${safeCategory}/${randomUUID()}.${extFromMime(mime)}`;
}

function publicUrlForKey(key) {
  if (!R2_PUBLIC_BASE_URL) return null;
  return `${R2_PUBLIC_BASE_URL}/${key}`;
}

// Faz upload de um asset. Retorna { url, key, storage }.
// - storage === 'r2'  → objeto enviado ao R2, url pública pronta para uso/CDN.
// - storage === 'data-url' → fallback (envs ausentes); url é um data URL.
async function uploadAsset({ buffer, mime, churchId, category }) {
  if (!isConfigured) {
    if (hasCredentials && !R2_PUBLIC_BASE_URL) {
      console.warn('[storage] R2 com credenciais mas sem R2_PUBLIC_BASE_URL; usando data URL como fallback.');
    }
    return { url: bufferToDataUrl(buffer, mime), key: null, storage: 'data-url' };
  }

  const key = buildKey({ churchId, category, mime });

  await getClient().send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mime || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return { url: publicUrlForKey(key), key, storage: 'r2' };
}

// Remove um objeto do R2 (best-effort). Aceita a key armazenada no upload.
async function deleteAsset(key) {
  if (!isConfigured || !key) return;
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.warn(`[storage] Falha ao remover objeto ${key}: ${err.message}`);
  }
}

function isStorageConfigured() {
  return isConfigured;
}

module.exports = { uploadAsset, deleteAsset, isStorageConfigured };
