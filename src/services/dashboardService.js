// =============================================================================
// Dashboard executivo (F10.1) — agregações cross-módulo, somente leitura.
// -----------------------------------------------------------------------------
// Consolida indicadores de Pessoas, Eventos, Ensino (EBD), Doações e Financeiro
// num único payload para a liderança. Cada bloco é TOLERANTE à sua migração
// ainda não aplicada (relação inexistente → bloco `null`), de modo que o painel
// nunca quebra por causa de um módulo não habilitado — exibe só o que existe.
//
// O bloco financeiro só é calculado quando o chamador passa includeFinance=true
// (a rota refina pela permissão `financeiro.read`): tesoureiro vê dinheiro, os
// demais papéis veem o resto.
// =============================================================================

const { getSupabase } = require('../db');
const { isMissingRelation } = require('../lib/schemaGuard');
const finReports = require('./finReportService');

const supabase = getSupabase();

// Status de membresia considerados "ativos" (presentes na comunidade).
const ACTIVE_MEMBERSHIP = new Set(['regular_attender', 'member']);

function startOfMonthISO(date = new Date()) {
  return `${date.toISOString().slice(0, 7)}-01`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Executa um agregador tolerando a tabela ausente (migração pendente) e qualquer
// falha pontual: devolve `fallback` em vez de derrubar o painel inteiro.
async function safeBlock(fn, fallback = null) {
  try {
    return await fn();
  } catch (error) {
    if (isMissingRelation(error)) return fallback;
    // Erros transitórios também não devem quebrar o consolidado.
    return fallback;
  }
}

// --- Pessoas ---------------------------------------------------------------
async function peopleKpis(churchId) {
  const { data, error } = await supabase
    .from('members')
    .select('membership_status,birth_date,created_at')
    .eq('church_id', churchId);
  if (error) throw error;
  const rows = data || [];
  const monthStart = startOfMonthISO();
  const currentMonth = new Date().getMonth() + 1;

  const byStatus = {};
  let active = 0;
  let newThisMonth = 0;
  let birthdaysThisMonth = 0;
  for (const r of rows) {
    const status = r.membership_status || 'visitor';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (ACTIVE_MEMBERSHIP.has(status)) active += 1;
    if (r.created_at && String(r.created_at).slice(0, 10) >= monthStart) newThisMonth += 1;
    if (r.birth_date && Number(String(r.birth_date).slice(5, 7)) === currentMonth) birthdaysThisMonth += 1;
  }
  return { total: rows.length, active, byStatus, newThisMonth, birthdaysThisMonth };
}

// --- Eventos ---------------------------------------------------------------
async function eventsKpis(churchId) {
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('church_id', churchId)
    .gte('starts_at', nowIso);
  if (error) throw error;
  return { upcoming: count || 0 };
}

// --- Ensino (EBD) ----------------------------------------------------------
async function ebdKpis(churchId, { from, to }) {
  const enrollments = await supabase
    .from('class_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('church_id', churchId)
    .eq('status', 'active');
  if (enrollments.error) throw enrollments.error;

  // Taxa média de presença no período (presentes / registros de chamada).
  const attendance = await supabase
    .from('class_attendance')
    .select('present,created_at')
    .eq('church_id', churchId)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`);
  if (attendance.error) throw attendance.error;
  const att = attendance.data || [];
  const present = att.filter((a) => a.present).length;
  const attendanceRate = att.length ? Math.round((present / att.length) * 100) : null;

  return { activeEnrollments: enrollments.count || 0, attendanceRate, attendanceSamples: att.length };
}

// --- Doações online --------------------------------------------------------
async function givingKpis(churchId, { from, to }) {
  const { data, error } = await supabase
    .from('donations')
    .select('amount_cents,paid_at,status')
    .eq('church_id', churchId)
    .eq('status', 'paid')
    .gte('paid_at', `${from}T00:00:00`)
    .lte('paid_at', `${to}T23:59:59`);
  if (error) throw error;
  const rows = data || [];
  const totalCents = rows.reduce((acc, r) => acc + Number(r.amount_cents || 0), 0);
  return { paidCount: rows.length, paidCents: totalCents };
}

// --- Financeiro (gated por permissão na rota) ------------------------------
async function financeKpis(churchId, range) {
  const summary = await finReports.summary(churchId, range);
  return {
    incomeCents: summary.incomeCents,
    expenseCents: summary.expenseCents,
    balanceCents: summary.balanceCents,
    byMonth: summary.byMonth,
  };
}

// Monta o consolidado. `range` (from/to) recorta as métricas de fluxo (doações,
// presença, financeiro); as de pessoas/eventos são de estado atual + mês.
async function getKpis(churchId, { from, to } = {}, { includeFinance = false } = {}) {
  const range = {
    from: from || startOfMonthISO(),
    to: to || todayISO(),
  };

  const [people, events, ebd, giving, finance] = await Promise.all([
    safeBlock(() => peopleKpis(churchId)),
    safeBlock(() => eventsKpis(churchId)),
    safeBlock(() => ebdKpis(churchId, range)),
    safeBlock(() => givingKpis(churchId, range)),
    includeFinance ? safeBlock(() => financeKpis(churchId, range)) : Promise.resolve(null),
  ]);

  return { range, people, events, ebd, giving, finance };
}

module.exports = { getKpis };
