const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');

const supabase = getSupabase();

// Postgres: relacao inexistente. Como o SQL e aplicado MANUALMENTE (a migracao
// 0003 pode ainda nao ter rodado), toleramos a ausencia da tabela de auditoria:
// o registro vira no-op e a listagem sinaliza PRECONDITION_FAILED ao front.
const UNDEFINED_TABLE = '42P01';

function isMissingAuditSchema(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

// Catalogo de acoes/entidades auditadas. Fonte unica de verdade no codigo — a
// tabela e generica. Convencao: '<entidade>.<acao>' em snake_case.
// Instrumentamos primeiro os modulos criticos (mudanca de papel, exclusao de
// pessoas, gestao de papeis); financas entram com suas proprias acoes na Fase 5.
const AUDIT_ACTIONS = {
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DELETED: 'user.deleted',
  USER_ROLE_ASSIGNED: 'user.role_assigned',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  // Pessoas / Membros (Fase 1)
  MEMBER_CREATED: 'member.created',
  MEMBER_UPDATED: 'member.updated',
  MEMBER_DELETED: 'member.deleted',
  MEMBER_STATUS_CHANGED: 'member.status_changed',
  MEMBER_INVITED: 'member.invited',
  MEMBER_INVITE_REVOKED: 'member.invite_revoked',
  MEMBER_ACCESS_LINKED: 'member.access_linked',
  // Convites por link (0042)
  INVITE_LINK_CREATED: 'invite_link.created',
  INVITE_LINK_REVOKED: 'invite_link.revoked',
  // Secretaria (Fase 2)
  TEMPLATE_CREATED: 'document_template.created',
  TEMPLATE_UPDATED: 'document_template.updated',
  TEMPLATE_DELETED: 'document_template.deleted',
  DOCUMENT_ISSUED: 'document.issued',
  DOCUMENT_DELETED: 'document.deleted',
  INSTITUTION_DOC_CREATED: 'institution_document.created',
  INSTITUTION_DOC_DELETED: 'institution_document.deleted',
  // Eventos (Fase 3)
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_DELETED: 'event.deleted',
  EVENT_REGISTRATION_CREATED: 'event_registration.created',
  EVENT_CHECKED_IN: 'event_registration.checked_in',
  // Ensino (Fase 4)
  CLASS_CREATED: 'class.created',
  CLASS_UPDATED: 'class.updated',
  CLASS_DELETED: 'class.deleted',
  // Comunicação (Fase 7)
  ANNOUNCEMENT_CREATED: 'announcement.created',
  ANNOUNCEMENT_DELETED: 'announcement.deleted',
  PRAYER_CREATED: 'prayer_request.created',
  // Financeiro (Fase 5/6)
  FIN_TRANSACTION_CREATED: 'fin_transaction.created',
  FIN_TRANSACTION_UPDATED: 'fin_transaction.updated',
  FIN_TRANSACTION_DELETED: 'fin_transaction.deleted',
  FIN_PAYABLE_PAID: 'fin_payable.paid',
  FIN_RECEIVABLE_RECEIVED: 'fin_receivable.received',
  FIN_RECEIPT_ISSUED: 'fin_receipt.issued',
  FIN_PERIOD_CLOSED: 'fin_closing.closed',
  FIN_PERIOD_REOPENED: 'fin_closing.reopened',
  FIN_RECONCILED: 'fin_transaction.reconciled',
  DONATION_PAID: 'donation.paid',
  BOLETO_CREATED: 'fin_boleto.created',
  BOLETO_PAID: 'fin_boleto.paid',
  // Plataforma / Super-Admin (F9.2)
  CHURCH_STATUS_CHANGED: 'church.status_changed',
  CHURCH_PLAN_CHANGED: 'church.plan_changed',
  PLATFORM_ACCESS: 'platform.accessed',
  // LGPD (F9.4)
  DATA_EXPORTED: 'lgpd.data_exported',
  CONSENT_GRANTED: 'lgpd.consent_granted',
  CONSENT_REVOKED: 'lgpd.consent_revoked',
  MEMBER_ANONYMIZED: 'member.anonymized',
  // Billing (F9.1)
  SUBSCRIPTION_CHANGED: 'subscription.changed',
};

const AUDIT_ENTITIES = {
  USER: 'user',
  ROLE: 'role',
  MEMBER: 'member',
  INVITE_LINK: 'invite_link',
  DOCUMENT_TEMPLATE: 'document_template',
  ISSUED_DOCUMENT: 'issued_document',
  INSTITUTION_DOCUMENT: 'institution_document',
  EVENT: 'event',
  EVENT_REGISTRATION: 'event_registration',
  CLASS: 'class',
  ANNOUNCEMENT: 'announcement',
  PRAYER_REQUEST: 'prayer_request',
  CHURCH: 'church',
  CONSENT: 'consent',
  SUBSCRIPTION: 'subscription',
  // Financeiro (Fase 5/6)
  FIN_TRANSACTION: 'fin_transaction',
  FIN_PAYABLE: 'fin_payable',
  FIN_RECEIVABLE: 'fin_receivable',
  FIN_RECEIPT: 'fin_receipt',
  FIN_CLOSING: 'fin_closing',
  DONATION: 'donation',
  FIN_BOLETO: 'fin_boleto',
};

// Extrai o IP de origem respeitando o proxy (Render/Cloudflare colocam o IP real
// no x-forwarded-for; pegamos o primeiro da lista).
function extractIp(req) {
  if (!req) return null;
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

// Registra um evento de auditoria. BEST-EFFORT: a auditoria NUNCA pode quebrar a
// operacao principal — qualquer falha (schema ausente, erro de rede) e apenas
// logada. Captura ator/tenant/IP a partir do req (derivados do token).
async function recordAudit(req, { action, entity, entityId = null, before = null, after = null, churchId: churchIdOverride = null }) {
  try {
    const actor = (req && req.user) || null;
    // `churchIdOverride` permite registrar a ação no tenant AFETADO (ex.: Super-Admin
    // agindo sobre outra igreja). Sem override, usa o tenant do ator (padrão).
    const churchId = churchIdOverride || (req && req.churchId) || (actor && actor.church_id) || null;
    if (!churchId || !action || !entity) return;

    const row = {
      church_id: churchId,
      user_id: (actor && actor.id) || null,
      actor_name: (actor && (actor.name || actor.full_name)) || null,
      actor_email: (actor && actor.email) || null,
      action,
      entity,
      entity_id: entityId != null ? String(entityId) : null,
      before: before ?? null,
      after: after ?? null,
      ip: extractIp(req),
      user_agent: (req && req.headers && req.headers['user-agent']) || null,
    };

    const { error } = await supabase.from('audit_log').insert(row);
    if (error && !isMissingAuditSchema(error)) {
      console.error('[audit] falha ao registrar evento:', error.message);
    }
  } catch (err) {
    console.error('[audit] erro inesperado ao registrar evento:', err.message);
  }
}

function mapAuditEntry(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    actorName: row.actor_name || null,
    actorEmail: row.actor_email || null,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id || null,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip || null,
    userAgent: row.user_agent || null,
    createdAt: row.created_at,
  };
}

// Lista eventos de auditoria do tenant, paginados e (opcionalmente) filtrados.
// Lanca PRECONDITION_FAILED quando a tabela ainda nao existe (migracao 0003
// pendente) — o front mostra o banner orientando a aplicar o SQL.
async function listAudit(churchId, { limit = 50, offset = 0, entity, action, userId } = {}) {
  let query = supabase
    .from('audit_log')
    .select('id,user_id,actor_name,actor_email,action,entity,entity_id,before,after,ip,user_agent,created_at', { count: 'exact' })
    .eq('church_id', churchId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (entity) query = query.eq('entity', entity);
  if (action) query = query.eq('action', action);
  if (userId) query = query.eq('user_id', userId);

  const { data, error, count } = await query;

  if (isMissingAuditSchema(error)) {
    throw AppError.preconditionFailed(
      'Recurso de auditoria indisponível: execute a migração 0003_audit_log.sql no Supabase.',
    );
  }
  if (error) throw new Error(error.message);

  return {
    entries: (data || []).map(mapAuditEntry),
    total: count ?? null,
    limit,
    offset,
  };
}

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  recordAudit,
  listAudit,
  isMissingAuditSchema,
};
