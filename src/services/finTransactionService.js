const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapFinTransaction } = require('../lib/mappers');
const { normalizeBirthDate } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { isPeriodClosed } = require('./finClosingService');

const supabase = getSupabase();
const MIGRATION = '0020_financeiro_core.sql';
const TX_SELECT = 'id,church_id,account_id,category_id,cost_center_id,member_id,type,amount_cents,date,description,attachment_url,reconciled,source,source_id,created_by,created_at,updated_at';

const text = (v) => (v == null || v === '' ? null : String(v).trim());
const dateOrToday = (v) => normalizeBirthDate(String(v || '')) || new Date().toISOString().slice(0, 10);

// Garante que a data NÃO cai num mês fechado (F5.9). Lança 409 quando bloqueado.
async function assertPeriodOpen(churchId, dateStr) {
  if (await isPeriodClosed(churchId, dateStr)) {
    throw AppError.conflict('O período (mês) deste lançamento está fechado. Reabra-o para alterar.');
  }
}

// Insert de baixo nível (sem trava de período): usado por fluxos do sistema
// (baixa de a pagar/receber, webhook de doação, boleto). O caller é responsável
// por checar o período quando fizer sentido.
async function insertTransaction(churchId, fields) {
  const payload = {
    church_id: churchId,
    account_id: fields.accountId || null,
    category_id: fields.categoryId || null,
    cost_center_id: fields.costCenterId || null,
    member_id: fields.memberId || null,
    type: fields.type,
    amount_cents: Number(fields.amountCents),
    date: dateOrToday(fields.date),
    description: text(fields.description),
    attachment_url: fields.attachmentUrl ? String(fields.attachmentUrl) : null,
    reconciled: Boolean(fields.reconciled),
    source: fields.source || 'manual',
    source_id: fields.sourceId || null,
    created_by: fields.createdBy || null,
  };
  const { data, error } = await supabase.from('fin_transactions').insert(payload).select(TX_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinTransaction(data);
}

async function getTransactionRow(id, churchId) {
  const { data, error } = await supabase
    .from('fin_transactions').select(TX_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

async function listTransactions(churchId, q) {
  const { from, to, type, accountId, categoryId, costCenterId, memberId, reconciled, search, page = 1, pageSize = 50 } = q;
  const offset = (page - 1) * pageSize;

  let query = supabase.from('fin_transactions').select(TX_SELECT, { count: 'exact' }).eq('church_id', churchId);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  if (type) query = query.eq('type', type);
  if (accountId) query = query.eq('account_id', accountId);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (costCenterId) query = query.eq('cost_center_id', costCenterId);
  if (memberId) query = query.eq('member_id', memberId);
  if (reconciled === 'true') query = query.eq('reconciled', true);
  if (reconciled === 'false') query = query.eq('reconciled', false);
  if (search) query = query.ilike('description', `%${String(search).replace(/[(),]/g, ' ').trim()}%`);

  query = query.order('date', { ascending: false }).order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  // Totais do filtro inteiro (não só da página) para o rodapé da tela.
  const totals = await sumByType(churchId, q);
  return {
    transactions: (data || []).map(mapFinTransaction),
    total: count ?? null,
    page,
    pageSize,
    totals,
  };
}

// Soma entradas/saídas do filtro (sem paginação) — para totalizadores.
async function sumByType(churchId, q = {}) {
  let query = supabase.from('fin_transactions').select('type,amount_cents').eq('church_id', churchId);
  if (q.from) query = query.gte('date', q.from);
  if (q.to) query = query.lte('date', q.to);
  if (q.type) query = query.eq('type', q.type);
  if (q.accountId) query = query.eq('account_id', q.accountId);
  if (q.categoryId) query = query.eq('category_id', q.categoryId);
  if (q.costCenterId) query = query.eq('cost_center_id', q.costCenterId);
  if (q.memberId) query = query.eq('member_id', q.memberId);
  const { data } = await query;
  let income = 0;
  let expense = 0;
  for (const t of data || []) {
    if (t.type === 'income') income += Number(t.amount_cents);
    else expense += Number(t.amount_cents);
  }
  return { incomeCents: income, expenseCents: expense, balanceCents: income - expense };
}

async function createTransaction(churchId, input, userId) {
  const date = dateOrToday(input.date);
  await assertPeriodOpen(churchId, date);
  return insertTransaction(churchId, {
    accountId: input.accountId,
    categoryId: input.categoryId,
    costCenterId: input.costCenterId,
    memberId: input.memberId,
    type: input.type,
    amountCents: input.amountCents,
    date,
    description: input.description,
    attachmentUrl: input.attachmentUrl,
    createdBy: userId,
    source: 'manual',
  });
}

async function updateTransaction(id, churchId, input) {
  const existing = await getTransactionRow(id, churchId);
  if (!existing) return null;

  // Bloqueia se a data atual OU a nova data caem em mês fechado.
  await assertPeriodOpen(churchId, existing.date);
  if (input.date !== undefined) await assertPeriodOpen(churchId, dateOrToday(input.date));

  const payload = {};
  if (input.type !== undefined) payload.type = input.type;
  if (input.amountCents !== undefined) payload.amount_cents = Number(input.amountCents);
  if (input.date !== undefined) payload.date = dateOrToday(input.date);
  if (input.accountId !== undefined) payload.account_id = input.accountId || null;
  if (input.categoryId !== undefined) payload.category_id = input.categoryId || null;
  if (input.costCenterId !== undefined) payload.cost_center_id = input.costCenterId || null;
  if (input.memberId !== undefined) payload.member_id = input.memberId || null;
  if (input.description !== undefined) payload.description = text(input.description);
  if (input.attachmentUrl !== undefined) payload.attachment_url = input.attachmentUrl ? String(input.attachmentUrl) : null;
  if (input.reconciled !== undefined) payload.reconciled = Boolean(input.reconciled);

  const { data, error } = await supabase
    .from('fin_transactions').update(payload).eq('id', id).eq('church_id', churchId).select(TX_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinTransaction(data) : null;
}

async function deleteTransaction(id, churchId) {
  const existing = await getTransactionRow(id, churchId);
  if (!existing) return false;
  await assertPeriodOpen(churchId, existing.date);
  const { error } = await supabase.from('fin_transactions').delete().eq('id', id).eq('church_id', churchId);
  if (error) throw new Error(error.message);
  return true;
}

async function setReconciled(id, churchId, value) {
  const { data, error } = await supabase
    .from('fin_transactions').update({ reconciled: Boolean(value) })
    .eq('id', id).eq('church_id', churchId).select(TX_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinTransaction(data) : null;
}

module.exports = {
  TX_SELECT,
  insertTransaction,
  getTransactionRow,
  listTransactions,
  sumByType,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  setReconciled,
  assertPeriodOpen,
};
