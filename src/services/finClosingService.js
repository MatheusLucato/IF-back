const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapFinClosing } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0024_financeiro_closings.sql';
const CLOSING_SELECT = 'id,church_id,period,opening_cents,income_cents,expense_cents,closing_cents,status,notes,closed_by,closed_at,updated_at';

// Normaliza 'YYYY-MM' ou 'YYYY-MM-DD' para o 1º dia do mês ('YYYY-MM-01').
function normalizePeriod(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

// Primeiro dia do mês de uma data qualquer 'YYYY-MM-DD'.
function monthStartOf(dateStr) {
  return normalizePeriod(dateStr);
}

// Próximo mês (1º dia) para montar o intervalo [início, fim).
function nextMonthStart(periodFirstDay) {
  const [y, mo] = periodFirstDay.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo, 1)); // mo é 1-based; Date month 0-based ⇒ próximo mês
  return date.toISOString().slice(0, 10);
}

async function listClosings(churchId) {
  const { data, error } = await supabase
    .from('fin_closings').select(CLOSING_SELECT)
    .eq('church_id', churchId).order('period', { ascending: false });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinClosing);
}

// Verifica se a data cai num período FECHADO (status 'closed'). Tolerante:
// se a tabela não existe ainda, retorna false (não trava lançamentos).
async function isPeriodClosed(churchId, dateStr) {
  const period = monthStartOf(dateStr);
  if (!period) return false;
  const { data, error } = await supabase
    .from('fin_closings').select('id,status')
    .eq('church_id', churchId).eq('period', period).maybeSingle();
  if (isMissingRelation(error)) return false;
  if (error) return false;
  return Boolean(data) && data.status === 'closed';
}

// Calcula saldos do mês: abertura (tudo antes do mês) + entradas/saídas do mês.
async function computePeriodTotals(churchId, period) {
  const start = period;
  const end = nextMonthStart(period);

  // Saldo de abertura das contas.
  const { data: accounts } = await supabase
    .from('fin_accounts').select('opening_balance_cents').eq('church_id', churchId);
  const accountsOpening = (accounts || []).reduce((s, a) => s + Number(a.opening_balance_cents || 0), 0);

  // Lançamentos ANTES do mês (compõem a abertura).
  const { data: before } = await supabase
    .from('fin_transactions').select('type,amount_cents')
    .eq('church_id', churchId).lt('date', start);
  const openingFromTx = (before || []).reduce(
    (s, t) => s + (t.type === 'income' ? Number(t.amount_cents) : -Number(t.amount_cents)), 0,
  );

  // Lançamentos DO mês.
  const { data: within } = await supabase
    .from('fin_transactions').select('type,amount_cents')
    .eq('church_id', churchId).gte('date', start).lt('date', end);
  let income = 0;
  let expense = 0;
  for (const t of within || []) {
    if (t.type === 'income') income += Number(t.amount_cents);
    else expense += Number(t.amount_cents);
  }

  const opening = accountsOpening + openingFromTx;
  return { opening, income, expense, closing: opening + income - expense };
}

async function closePeriod(churchId, { period: rawPeriod, notes }, closedBy) {
  const period = normalizePeriod(rawPeriod);
  if (!period) throw AppError.badRequest('Período inválido. Use o formato YYYY-MM.');

  // Não fecha um mês ainda em curso ou futuro.
  const thisMonth = monthStartOf(new Date().toISOString().slice(0, 10));
  if (period >= thisMonth) {
    throw AppError.badRequest('Só é possível fechar meses já encerrados.');
  }

  const totals = await computePeriodTotals(churchId, period);
  const payload = {
    church_id: churchId,
    period,
    opening_cents: totals.opening,
    income_cents: totals.income,
    expense_cents: totals.expense,
    closing_cents: totals.closing,
    status: 'closed',
    notes: notes ? String(notes).trim() : null,
    closed_by: closedBy || null,
    closed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('fin_closings')
    .upsert(payload, { onConflict: 'church_id,period' })
    .select(CLOSING_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinClosing(data);
}

async function reopenPeriod(churchId, period, _userId) {
  const normalized = normalizePeriod(period);
  if (!normalized) throw AppError.badRequest('Período inválido.');
  const { data, error } = await supabase
    .from('fin_closings').update({ status: 'reopened' })
    .eq('church_id', churchId).eq('period', normalized).select(CLOSING_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Período não encontrado.');
  return mapFinClosing(data);
}

module.exports = {
  normalizePeriod,
  isPeriodClosed,
  computePeriodTotals,
  listClosings,
  closePeriod,
  reopenPeriod,
};
