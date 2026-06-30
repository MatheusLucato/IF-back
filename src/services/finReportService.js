const { getSupabase } = require('../db');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0020_financeiro_core.sql';

// Busca os lançamentos do período (sem paginação) para agregar nos relatórios.
async function fetchRange(churchId, { from, to } = {}) {
  let query = supabase
    .from('fin_transactions')
    .select('id,date,type,amount_cents,category_id,cost_center_id,account_id,member_id,description')
    .eq('church_id', churchId);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  const { data, error } = await query.order('date', { ascending: true });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || [];
}

// Fluxo de caixa: totais + série mensal (DRE simplificado).
async function summary(churchId, range = {}) {
  const rows = await fetchRange(churchId, range);
  let income = 0;
  let expense = 0;
  const byMonth = new Map();
  for (const r of rows) {
    const month = String(r.date).slice(0, 7); // YYYY-MM
    const m = byMonth.get(month) || { month, incomeCents: 0, expenseCents: 0 };
    if (r.type === 'income') { income += Number(r.amount_cents); m.incomeCents += Number(r.amount_cents); }
    else { expense += Number(r.amount_cents); m.expenseCents += Number(r.amount_cents); }
    byMonth.set(month, m);
  }
  const series = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, balanceCents: m.incomeCents - m.expenseCents }));
  return { incomeCents: income, expenseCents: expense, balanceCents: income - expense, byMonth: series, count: rows.length };
}

// Resolve rótulos (nomes) das chaves de agrupamento.
async function labelMap(churchId, groupBy) {
  const table = groupBy === 'category' ? 'fin_categories'
    : groupBy === 'cost_center' ? 'fin_cost_centers'
      : groupBy === 'account' ? 'fin_accounts' : null;
  if (!table) return new Map();
  const { data } = await supabase.from(table).select('id,name').eq('church_id', churchId);
  return new Map((data || []).map((r) => [r.id, r.name]));
}

// Agrupa por categoria/centro de custo/conta/mês.
async function grouped(churchId, { from, to, groupBy = 'category' } = {}) {
  const rows = await fetchRange(churchId, { from, to });
  const labels = await labelMap(churchId, groupBy);
  const keyField = groupBy === 'category' ? 'category_id'
    : groupBy === 'cost_center' ? 'cost_center_id'
      : groupBy === 'account' ? 'account_id' : null;

  const groups = new Map();
  for (const r of rows) {
    const key = groupBy === 'month' ? String(r.date).slice(0, 7) : (r[keyField] || 'none');
    const label = groupBy === 'month' ? key : (labels.get(r[keyField]) || 'Sem classificação');
    const g = groups.get(key) || { key, label, incomeCents: 0, expenseCents: 0 };
    if (r.type === 'income') g.incomeCents += Number(r.amount_cents);
    else g.expenseCents += Number(r.amount_cents);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, balanceCents: g.incomeCents - g.expenseCents }))
    .sort((a, b) => (b.incomeCents + b.expenseCents) - (a.incomeCents + a.expenseCents));
}

// Exporta os lançamentos do período em CSV (Excel abre direto). Sem dependência.
async function exportCsv(churchId, range = {}) {
  const rows = await fetchRange(churchId, range);
  const cats = await labelMap(churchId, 'category');
  const ccs = await labelMap(churchId, 'cost_center');
  const accs = await labelMap(churchId, 'account');

  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const reais = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

  const header = ['Data', 'Tipo', 'Valor', 'Categoria', 'Centro de custo', 'Conta', 'Descrição'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      esc(r.date),
      esc(r.type === 'income' ? 'Entrada' : 'Saída'),
      esc(reais(r.amount_cents)),
      esc(cats.get(r.category_id) || ''),
      esc(ccs.get(r.cost_center_id) || ''),
      esc(accs.get(r.account_id) || ''),
      esc(r.description || ''),
    ].join(';'));
  }
  // BOM para o Excel reconhecer UTF-8.
  return `﻿${lines.join('\r\n')}`;
}

module.exports = { summary, grouped, exportCsv };
