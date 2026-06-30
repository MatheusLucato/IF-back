const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapFinBankImport, mapFinBankLine, mapFinTransaction } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const { parseOfx } = require('../lib/ofx');
const { setReconciled, TX_SELECT } = require('./finTransactionService');

const supabase = getSupabase();
const MIGRATION = '0023_financeiro_reconciliation.sql';
const IMPORT_SELECT = 'id,church_id,account_id,file_name,bank_id,period_start,period_end,total_lines,matched_lines,created_by,created_at';
const LINE_SELECT = 'id,church_id,import_id,account_id,fitid,posted_at,amount_cents,type,memo,status,matched_transaction_id,created_at';

// Janela de datas (em dias) para sugerir match automático.
const MATCH_WINDOW_DAYS = 3;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Importa um extrato OFX: cria o job e grava as linhas (ignorando duplicatas por fitid).
async function importOfx(churchId, { content, fileName, accountId }, userId) {
  const parsed = parseOfx(content);
  if (!parsed.transactions.length) {
    throw AppError.badRequest('Nenhuma transação encontrada no arquivo OFX.');
  }

  const dates = parsed.transactions.map((t) => t.postedAt).sort();
  const importPayload = {
    church_id: churchId,
    account_id: accountId || null,
    file_name: fileName || null,
    bank_id: parsed.bankId || null,
    period_start: dates[0] || null,
    period_end: dates[dates.length - 1] || null,
    total_lines: parsed.transactions.length,
    matched_lines: 0,
    created_by: userId || null,
  };
  const { data: job, error: jobErr } = await supabase
    .from('fin_bank_imports').insert(importPayload).select(IMPORT_SELECT).single();
  if (isMissingRelation(jobErr)) throw migrationPending(MIGRATION);
  if (jobErr) throw new Error(jobErr.message);

  // Insere as linhas; ignora as que violarem o índice único (account_id, fitid).
  let inserted = 0;
  for (const t of parsed.transactions) {
    const linePayload = {
      church_id: churchId,
      import_id: job.id,
      account_id: accountId || null,
      fitid: t.fitid || null,
      posted_at: t.postedAt,
      amount_cents: t.amountCents,
      type: t.type,
      memo: t.memo || null,
      status: 'unmatched',
    };
    const { error } = await supabase.from('fin_bank_lines').insert(linePayload);
    if (!error) inserted += 1;
    // 23505 = duplicada (já importada antes): ignora silenciosamente.
    else if (error.code !== '23505') throw new Error(error.message);
  }

  return { import: mapFinBankImport(job), insertedLines: inserted, skipped: parsed.transactions.length - inserted };
}

async function listImports(churchId) {
  const { data, error } = await supabase
    .from('fin_bank_imports').select(IMPORT_SELECT).eq('church_id', churchId).order('created_at', { ascending: false });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinBankImport);
}

// Lança candidatos de match (mesmo valor absoluto e tipo, dentro da janela de
// datas, ainda não conciliados) para cada linha não conciliada do import.
async function getLinesWithSuggestions(churchId, importId) {
  const { data: lines, error } = await supabase
    .from('fin_bank_lines').select(LINE_SELECT)
    .eq('church_id', churchId).eq('import_id', importId).order('posted_at');
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const out = [];
  for (const line of lines || []) {
    const mapped = mapFinBankLine(line);
    if (line.status === 'unmatched') {
      const absCents = Math.abs(Number(line.amount_cents));
      const { data: candidates } = await supabase
        .from('fin_transactions').select(TX_SELECT)
        .eq('church_id', churchId)
        .eq('type', line.type)
        .eq('amount_cents', absCents)
        .eq('reconciled', false)
        .gte('date', addDays(line.posted_at, -MATCH_WINDOW_DAYS))
        .lte('date', addDays(line.posted_at, MATCH_WINDOW_DAYS))
        .limit(5);
      mapped.suggestions = (candidates || []).map(mapFinTransaction);
    } else {
      mapped.suggestions = [];
    }
    out.push(mapped);
  }
  return out;
}

// Recalcula matched_lines do import (mantém o resumo atualizado).
async function refreshImportCount(churchId, importId) {
  const { count } = await supabase
    .from('fin_bank_lines').select('id', { count: 'exact', head: true })
    .eq('church_id', churchId).eq('import_id', importId).eq('status', 'matched');
  await supabase.from('fin_bank_imports').update({ matched_lines: count ?? 0 }).eq('id', importId).eq('church_id', churchId);
}

// Confirma o match de uma linha com um lançamento: marca a linha como 'matched'
// e o lançamento como conciliado (reconciled = true).
async function confirmMatch(churchId, lineId, transactionId) {
  const { data: line, error } = await supabase
    .from('fin_bank_lines').select(LINE_SELECT).eq('id', lineId).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!line) throw AppError.notFound('Linha do extrato não encontrada.');

  await setReconciled(transactionId, churchId, true);
  const { data, error: upErr } = await supabase
    .from('fin_bank_lines').update({ status: 'matched', matched_transaction_id: transactionId })
    .eq('id', lineId).eq('church_id', churchId).select(LINE_SELECT).single();
  if (upErr) throw new Error(upErr.message);
  await refreshImportCount(churchId, line.import_id);
  return mapFinBankLine(data);
}

async function confirmBulk(churchId, matches) {
  const results = [];
  for (const m of matches) {
    results.push(await confirmMatch(churchId, m.lineId, m.transactionId));
  }
  return results;
}

async function ignoreLine(churchId, lineId) {
  const { data, error } = await supabase
    .from('fin_bank_lines').update({ status: 'ignored' })
    .eq('id', lineId).eq('church_id', churchId).select(LINE_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Linha do extrato não encontrada.');
  return mapFinBankLine(data);
}

module.exports = {
  importOfx, listImports, getLinesWithSuggestions, confirmMatch, confirmBulk, ignoreLine,
};
