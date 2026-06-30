const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapFinReceipt } = require('../lib/mappers');
const { normalizeBirthDate } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { insertTransaction, getTransactionRow } = require('./finTransactionService');

const supabase = getSupabase();
const MIGRATION = '0022_financeiro_receipts.sql';
const RECEIPT_SELECT = 'id,church_id,transaction_id,member_id,number,year,payer_name,amount_cents,description,file_url,issued_at,issued_by,created_at';

// Reserva o próximo número sequencial do ano (atômico via RPC, F5.5).
async function nextReceiptNumber(churchId, year) {
  const { data, error } = await supabase.rpc('fin_next_receipt_number', { p_church_id: churchId, p_year: year });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Number(data);
}

async function listReceipts(churchId, { memberId, year } = {}) {
  let query = supabase.from('fin_receipts').select(RECEIPT_SELECT).eq('church_id', churchId);
  if (memberId) query = query.eq('member_id', memberId);
  if (year) query = query.eq('year', Number(year));
  query = query.order('year', { ascending: false }).order('number', { ascending: false });
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinReceipt);
}

async function getReceipt(id, churchId) {
  const { data, error } = await supabase
    .from('fin_receipts').select(RECEIPT_SELECT).eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinReceipt(data) : null;
}

// Emite um recibo. Dois caminhos:
//   1. transactionId informado → recibo da contribuição já lançada (income).
//   2. sem transactionId → lança a contribuição (income) E emite o recibo.
// Numeração por tenant/ano (atômica). PDF fica a cargo do front (impressão) ou,
// futuramente, da geração server-side reaproveitando a infra de documentos (F2.2).
async function issueReceipt(churchId, input, userId) {
  let txRow = null;

  if (input.transactionId) {
    txRow = await getTransactionRow(input.transactionId, churchId);
    if (!txRow) throw AppError.notFound('Lançamento não encontrado.');
    if (txRow.type !== 'income') throw AppError.badRequest('Recibo só pode ser emitido para uma entrada (receita).');
  } else {
    const amount = Number(input.amountCents || 0);
    if (amount <= 0) throw AppError.badRequest('Informe o valor da contribuição.');
    const tx = await insertTransaction(churchId, {
      accountId: input.accountId || null,
      categoryId: input.categoryId || null,
      memberId: input.memberId || null,
      type: 'income',
      amountCents: amount,
      date: input.date ? normalizeBirthDate(String(input.date)) : null,
      description: input.description || 'Contribuição (dízimo/oferta)',
      source: 'receipt',
      createdBy: userId || null,
    });
    txRow = await getTransactionRow(tx.id, churchId);
  }

  // Nome do contribuinte (snapshot): explícito > membro vinculado.
  let payerName = input.payerName ? String(input.payerName).trim() : null;
  const memberId = input.memberId || txRow.member_id || null;
  if (!payerName && memberId) {
    const { data: m } = await supabase
      .from('members').select('full_name').eq('id', memberId).eq('church_id', churchId).maybeSingle();
    payerName = m?.full_name || null;
  }

  const year = Number((txRow.date || new Date().toISOString()).slice(0, 4));
  const number = await nextReceiptNumber(churchId, year);

  const payload = {
    church_id: churchId,
    transaction_id: txRow.id,
    member_id: memberId,
    number,
    year,
    payer_name: payerName,
    amount_cents: Number(txRow.amount_cents),
    description: input.description || txRow.description || 'Contribuição (dízimo/oferta)',
    issued_by: userId || null,
  };

  const { data, error } = await supabase.from('fin_receipts').insert(payload).select(RECEIPT_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinReceipt(data);
}

// Relatório anual de contribuições por membro (base p/ comprovante anual).
async function annualByMember(churchId, year, memberId) {
  let query = supabase
    .from('fin_receipts').select('member_id,amount_cents,payer_name')
    .eq('church_id', churchId).eq('year', Number(year));
  if (memberId) query = query.eq('member_id', memberId);
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const byMember = new Map();
  for (const r of data || []) {
    const key = r.member_id || 'avulso';
    const cur = byMember.get(key) || { memberId: r.member_id || null, payerName: r.payer_name || 'Avulso', totalCents: 0, count: 0 };
    cur.totalCents += Number(r.amount_cents);
    cur.count += 1;
    byMember.set(key, cur);
  }
  return [...byMember.values()].sort((a, b) => b.totalCents - a.totalCents);
}

module.exports = { listReceipts, getReceipt, issueReceipt, annualByMember };
