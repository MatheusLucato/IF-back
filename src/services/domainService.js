// =============================================================================
// Subdomínio / domínio por tenant (F9.3).
// -----------------------------------------------------------------------------
// O `slug` já dá o subdomínio (`<slug>.edifico.app`). Aqui tratamos o DOMÍNIO
// PRÓPRIO (premium): o admin aponta um host, publica um TXT DNS com o token e o
// backend valida. A resolução por host (público) deixa a área pública servir o
// branding correto sem login.
//
// Tolerante à migração 0030 ausente (42703 = coluna inexistente).
// =============================================================================

const dns = require('dns').promises;
const { randomBytes } = require('crypto');
const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapChurch } = require('../lib/mappers');

const supabase = getSupabase();
const MIGRATION = '0030_tenant_domains.sql';

function isMissingDomainColumn(error) {
  return Boolean(error) && (error.code === '42703' || /custom_domain|domain_verified/i.test(String(error.message || '')));
}

// Normaliza o host: minúsculas, sem protocolo, sem barra, sem porta.
function normalizeHost(value) {
  return String(value || '')
    .trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:.*$/, '');
}

const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

async function setCustomDomain(churchId, rawDomain) {
  const domain = normalizeHost(rawDomain);
  if (!domain || !DOMAIN_RE.test(domain)) {
    throw AppError.badRequest('Domínio inválido. Use algo como app.suaigreja.com.br.');
  }

  // Domínio precisa ser único entre as igrejas.
  const { data: taken, error: takenErr } = await supabase
    .from('churches').select('id').eq('custom_domain', domain).neq('id', churchId).maybeSingle();
  if (isMissingDomainColumn(takenErr)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (taken) throw AppError.conflict('Este domínio já está em uso por outra igreja.');

  const token = `edifico-verify=${randomBytes(16).toString('hex')}`;
  const { data, error } = await supabase
    .from('churches')
    .update({ custom_domain: domain, domain_verified: false, domain_verification_token: token, updated_at: new Date().toISOString() })
    .eq('id', churchId).select('*').single();
  if (isMissingDomainColumn(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);
  return mapChurch(data);
}

async function removeCustomDomain(churchId) {
  const { data, error } = await supabase
    .from('churches')
    .update({ custom_domain: null, domain_verified: false, domain_verification_token: null, updated_at: new Date().toISOString() })
    .eq('id', churchId).select('*').single();
  if (isMissingDomainColumn(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);
  return mapChurch(data);
}

// Valida o domínio buscando o TXT esperado. O token é gravado com prefixo
// `edifico-verify=`; aceitamos o registro em qualquer entrada TXT do host.
async function verifyDomain(churchId) {
  const { data: church, error } = await supabase
    .from('churches').select('*').eq('id', churchId).maybeSingle();
  if (isMissingDomainColumn(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
  if (error) throw new Error(error.message);
  if (!church || !church.custom_domain) throw AppError.badRequest('Configure um domínio antes de verificar.');
  if (!church.domain_verification_token) throw AppError.badRequest('Token de verificação ausente. Reconfigure o domínio.');

  let records = [];
  try {
    const txt = await dns.resolveTxt(church.custom_domain);
    records = txt.map((parts) => parts.join(''));
  } catch {
    throw AppError.preconditionFailed('Não foi possível ler os registros DNS do domínio. Verifique a propagação e tente novamente.');
  }

  const found = records.some((r) => r.includes(church.domain_verification_token));
  if (!found) {
    throw AppError.preconditionFailed('Registro TXT não encontrado. Publique o TXT e aguarde a propagação do DNS.');
  }

  const { data, error: upErr } = await supabase
    .from('churches').update({ domain_verified: true, updated_at: new Date().toISOString() })
    .eq('id', churchId).select('*').single();
  if (upErr) throw new Error(upErr.message);
  return mapChurch(data);
}

// PÚBLICO: resolve a igreja pelo HOST. Tenta domínio próprio VERIFICADO primeiro;
// depois subdomínio (primeiro rótulo = slug). Retorna o slug para a SPA carregar
// o branding via /api/public/churches/:slug.
async function resolveTenantByHost(rawHost) {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  // 1. Domínio próprio verificado.
  try {
    const { data } = await supabase
      .from('churches').select('slug').eq('custom_domain', host).eq('domain_verified', true).maybeSingle();
    if (data) return { slug: data.slug, via: 'custom_domain' };
  } catch { /* coluna pode não existir → ignora */ }

  // 2. Subdomínio: primeiro rótulo como slug (ex.: "minha.edifico.app" → "minha").
  const label = host.split('.')[0];
  if (label && label !== 'www' && label !== 'app') {
    const { data } = await supabase.from('churches').select('slug').eq('slug', label).maybeSingle();
    if (data) return { slug: data.slug, via: 'subdomain' };
  }
  return null;
}

module.exports = { setCustomDomain, removeCustomDomain, verifyDomain, resolveTenantByHost, normalizeHost };
