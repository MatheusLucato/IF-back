const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapFinPayable, mapFinReceivable } = require('../lib/mappers');
const { normalizeBirthDate } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { insertTransaction } = require('./finTransactionService');

const supabase = getSupabase();
const MIGRATION = '0021_financeiro_payables_receivables.sql';
const PAYABLE_SELECT = 'id,church_id,supplier,description,category_id,cost_center_id,due_date,amount_cents,status,paid_at,paid_transaction_id,created_by,created_at,updated_at';
const RECEIVABLE_SELECT = 'id,church_id,payer,description,category_id,cost_center_id,member_id,due_date,amount_cents,status,received_at,received_transaction_id,created_by,created_at,updated_at';

const text = (v) => (v == null || v === '' ? null : String(v).trim());
const dateOrNull = (v) => (v ? normalizeBirthDate(String(v)) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ============================ Contas a pagar (F5.3) ========================

async function listPayables(churchId, { status, scope } = {}) {
  let query = supabase.from('fin_payables').select(PAYABLE_SELECT).eq('church_id', churchId);
  if (status) query = query.eq('status', status);
  if (scope === 'overdue') query = query.eq('status', 'open').lt('due_date', today());
  query = query.order('due_date', { ascending: true });
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinPayable);
}

async function getPayableRow(id, churchId) {
  const { data, error } = await supabase
    .from('fin_payables').select(PAYABLE_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

async function createPayable(churchId, input, userId) {
  const payload = {
    church_id: churchId,
    supplier: String(input.supplier).trim(),
    description: text(input.description),
    category_id: input.categoryId || null,
    cost_center_id: input.costCenterId || null,
    due_date: dateOrNull(input.dueDate),
    amount_cents: Number(input.amountCents),
    status: 'open',
    created_by: userId || null,
  };
  if (!payload.due_date) throw AppError.badRequest('Vencimento inválido.');
  const { data, error } = await supabase.from('fin_payables').insert(payload).select(PAYABLE_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinPayable(data);
}

async function updatePayable(id, churchId, input) {
  const payload = {};
  if (input.supplier !== undefined) payload.supplier = String(input.supplier).trim();
  if (input.description !== undefined) payload.description = text(input.description);
  if (input.categoryId !== undefined) payload.category_id = input.categoryId || null;
  if (input.costCenterId !== undefined) payload.cost_center_id = input.costCenterId || null;
  if (input.dueDate !== undefined) payload.due_date = dateOrNull(input.dueDate);
  if (input.amountCents !== undefined) payload.amount_cents = Number(input.amountCents);
  if (input.status !== undefined) payload.status = input.status;
  const { data, error } = await supabase
    .from('fin_payables').update(payload).eq('id', id).eq('church_id', churchId).select(PAYABLE_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinPayable(data) : null;
}

async function deletePayable(id, churchId) {
  const { data, error } = await supabase
    .from('fin_payables').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Baixa: gera o lançamento de despesa e marca a conta como paga.
async function settlePayable(id, churchId, { accountId, paidAt } = {}, userId) {
  const row = await getPayableRow(id, churchId);
  if (!row) throw AppError.notFound('Conta a pagar não encontrada.');
  if (row.status === 'paid') throw AppError.conflict('Esta conta já foi paga.');
  if (row.status === 'cancelled') throw AppError.conflict('Esta conta está cancelada.');

  const paidDate = dateOrNull(paidAt) || today();
  const tx = await insertTransaction(churchId, {
    accountId: accountId || null,
    categoryId: row.category_id || null,
    costCenterId: row.cost_center_id || null,
    type: 'expense',
    amountCents: row.amount_cents,
    date: paidDate,
    description: `Pagamento: ${row.supplier}${row.description ? ` — ${row.description}` : ''}`,
    source: 'payable',
    sourceId: row.id,
    createdBy: userId || null,
  });

  const { data, error } = await supabase
    .from('fin_payables')
    .update({ status: 'paid', paid_at: paidDate, paid_transaction_id: tx.id })
    .eq('id', id).eq('church_id', churchId).select(PAYABLE_SELECT).single();
  if (error) throw new Error(error.message);
  return { payable: mapFinPayable(data), transaction: tx };
}

// =========================== Contas a receber (F5.4) =======================

async function listReceivables(churchId, { status, scope } = {}) {
  let query = supabase.from('fin_receivables').select(RECEIVABLE_SELECT).eq('church_id', churchId);
  if (status) query = query.eq('status', status);
  if (scope === 'overdue') query = query.eq('status', 'open').lt('due_date', today());
  query = query.order('due_date', { ascending: true });
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinReceivable);
}

async function getReceivableRow(id, churchId) {
  const { data, error } = await supabase
    .from('fin_receivables').select(RECEIVABLE_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

async function createReceivable(churchId, input, userId) {
  const payload = {
    church_id: churchId,
    payer: String(input.payer).trim(),
    description: text(input.description),
    category_id: input.categoryId || null,
    cost_center_id: input.costCenterId || null,
    member_id: input.memberId || null,
    due_date: dateOrNull(input.dueDate),
    amount_cents: Number(input.amountCents),
    status: 'open',
    created_by: userId || null,
  };
  if (!payload.due_date) throw AppError.badRequest('Vencimento inválido.');
  const { data, error } = await supabase.from('fin_receivables').insert(payload).select(RECEIVABLE_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinReceivable(data);
}

async function updateReceivable(id, churchId, input) {
  const payload = {};
  if (input.payer !== undefined) payload.payer = String(input.payer).trim();
  if (input.description !== undefined) payload.description = text(input.description);
  if (input.categoryId !== undefined) payload.category_id = input.categoryId || null;
  if (input.costCenterId !== undefined) payload.cost_center_id = input.costCenterId || null;
  if (input.memberId !== undefined) payload.member_id = input.memberId || null;
  if (input.dueDate !== undefined) payload.due_date = dateOrNull(input.dueDate);
  if (input.amountCents !== undefined) payload.amount_cents = Number(input.amountCents);
  if (input.status !== undefined) payload.status = input.status;
  const { data, error } = await supabase
    .from('fin_receivables').update(payload).eq('id', id).eq('church_id', churchId).select(RECEIVABLE_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinReceivable(data) : null;
}

async function deleteReceivable(id, churchId) {
  const { data, error } = await supabase
    .from('fin_receivables').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Baixa: gera o lançamento de receita e marca como recebida.
async function settleReceivable(id, churchId, { accountId, receivedAt } = {}, userId) {
  const row = await getReceivableRow(id, churchId);
  if (!row) throw AppError.notFound('Conta a receber não encontrada.');
  if (row.status === 'received') throw AppError.conflict('Esta conta já foi recebida.');
  if (row.status === 'cancelled') throw AppError.conflict('Esta conta está cancelada.');

  const recDate = dateOrNull(receivedAt) || today();
  const tx = await insertTransaction(churchId, {
    accountId: accountId || null,
    categoryId: row.category_id || null,
    costCenterId: row.cost_center_id || null,
    memberId: row.member_id || null,
    type: 'income',
    amountCents: row.amount_cents,
    date: recDate,
    description: `Recebimento: ${row.payer}${row.description ? ` — ${row.description}` : ''}`,
    source: 'receivable',
    sourceId: row.id,
    createdBy: userId || null,
  });

  const { data, error } = await supabase
    .from('fin_receivables')
    .update({ status: 'received', received_at: recDate, received_transaction_id: tx.id })
    .eq('id', id).eq('church_id', churchId).select(RECEIVABLE_SELECT).single();
  if (error) throw new Error(error.message);
  return { receivable: mapFinReceivable(data), transaction: tx };
}

module.exports = {
  listPayables, getPayableRow, createPayable, updatePayable, deletePayable, settlePayable,
  listReceivables, getReceivableRow, createReceivable, updateReceivable, deleteReceivable, settleReceivable,
};
