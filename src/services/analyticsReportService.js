// =============================================================================
// Relatórios cruzados (F10.2) — combina módulos para decisões baseadas em dados.
// -----------------------------------------------------------------------------
// Um pequeno construtor de relatórios "de alto valor": cada tipo devolve
// { columns, rows } pronto para tabela e exportável em CSV. Os relatórios
// financeiros exigem `financeiro.read` (filtrados no catálogo pela rota).
//
// Tolerância a migração pendente: cada relatório propaga o erro; a rota mapeia
// 42P01 → PRECONDITION_FAILED (banner "migração pendente" no front).
// =============================================================================

const { getSupabase } = require('../db');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const finReports = require('./finReportService');

const supabase = getSupabase();

const STATUS_LABELS = {
  visitor: 'Visitante',
  regular_attender: 'Frequentador',
  member: 'Membro',
  inactive: 'Inativo',
  transferred: 'Transferido',
  deceased: 'Falecido',
};

// Catálogo de relatórios. `finance: true` marca os que dependem de financeiro.read.
const REPORTS = [
  { key: 'members-by-status', label: 'Membros por status', finance: false, migration: '0004_members.sql' },
  { key: 'members-growth', label: 'Crescimento de membros (12 meses)', finance: false, migration: '0004_members.sql' },
  { key: 'giving-by-fund', label: 'Doações por fundo', finance: true, migration: '0026_giving_donations.sql' },
  { key: 'attendance-by-class', label: 'Presença média por classe (EBD)', finance: false, migration: '0010_ensino.sql' },
  { key: 'finance-by-category', label: 'Financeiro por categoria', finance: true, migration: '0020_financeiro_core.sql' },
];

// Catálogo visível ao usuário, filtrado pela permissão de financeiro.
function catalog({ includeFinance = false } = {}) {
  return REPORTS
    .filter((r) => includeFinance || !r.finance)
    .map(({ key, label, finance }) => ({ key, label, finance }));
}

function brl(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

// --- Relatórios ------------------------------------------------------------
async function membersByStatus(churchId) {
  const { data, error } = await supabase
    .from('members').select('membership_status').eq('church_id', churchId);
  if (error) throw error;
  const counts = {};
  for (const r of data || []) {
    const s = r.membership_status || 'visitor';
    counts[s] = (counts[s] || 0) + 1;
  }
  const rows = Object.entries(counts)
    .map(([status, total]) => ({ status: STATUS_LABELS[status] || status, total }))
    .sort((a, b) => b.total - a.total);
  return { columns: [{ key: 'status', label: 'Status' }, { key: 'total', label: 'Quantidade' }], rows };
}

async function membersGrowth(churchId) {
  const { data, error } = await supabase
    .from('members').select('created_at').eq('church_id', churchId);
  if (error) throw error;
  // Últimos 12 meses (YYYY-MM) inicializados em zero para não pular meses vazios.
  const months = [];
  const base = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  for (const r of data || []) {
    const m = String(r.created_at || '').slice(0, 7);
    if (m in counts) counts[m] += 1;
  }
  const rows = months.map((m) => ({ month: m, total: counts[m] }));
  return { columns: [{ key: 'month', label: 'Mês' }, { key: 'total', label: 'Novos membros' }], rows };
}

async function givingByFund(churchId, { from, to }) {
  const donations = await supabase
    .from('donations').select('fund_id,amount_cents')
    .eq('church_id', churchId).eq('status', 'paid')
    .gte('paid_at', `${from}T00:00:00`).lte('paid_at', `${to}T23:59:59`);
  if (donations.error) throw donations.error;
  const funds = await supabase.from('giving_funds').select('id,name').eq('church_id', churchId);
  if (funds.error) throw funds.error;
  const fundName = new Map((funds.data || []).map((f) => [f.id, f.name]));

  const totals = new Map();
  for (const d of donations.data || []) {
    const key = d.fund_id || 'none';
    const cur = totals.get(key) || { count: 0, cents: 0 };
    cur.count += 1; cur.cents += Number(d.amount_cents || 0);
    totals.set(key, cur);
  }
  const rows = [...totals.entries()]
    .map(([id, v]) => ({ fund: id === 'none' ? 'Sem fundo' : (fundName.get(id) || '—'), count: v.count, total: brl(v.cents) }))
    .sort((a, b) => b.count - a.count);
  return { columns: [{ key: 'fund', label: 'Fundo' }, { key: 'count', label: 'Doações' }, { key: 'total', label: 'Total (R$)' }], rows };
}

async function attendanceByClass(churchId, { from, to }) {
  const sessions = await supabase
    .from('class_sessions').select('id,class_id')
    .eq('church_id', churchId)
    .gte('session_date', from).lte('session_date', to);
  if (sessions.error) throw sessions.error;
  const sessionClass = new Map((sessions.data || []).map((s) => [s.id, s.class_id]));
  const sessionIds = [...sessionClass.keys()];

  const classes = await supabase.from('classes').select('id,name').eq('church_id', churchId);
  if (classes.error) throw classes.error;
  const className = new Map((classes.data || []).map((c) => [c.id, c.name]));

  const tallies = new Map(); // classId -> { present, total }
  if (sessionIds.length) {
    const att = await supabase
      .from('class_attendance').select('session_id,present')
      .eq('church_id', churchId).in('session_id', sessionIds);
    if (att.error) throw att.error;
    for (const a of att.data || []) {
      const classId = sessionClass.get(a.session_id);
      if (!classId) continue;
      const cur = tallies.get(classId) || { present: 0, total: 0 };
      cur.total += 1; if (a.present) cur.present += 1;
      tallies.set(classId, cur);
    }
  }
  const rows = [...tallies.entries()]
    .map(([classId, v]) => ({
      class: className.get(classId) || '—',
      samples: v.total,
      rate: v.total ? `${Math.round((v.present / v.total) * 100)}%` : '—',
    }))
    .sort((a, b) => b.samples - a.samples);
  return { columns: [{ key: 'class', label: 'Classe' }, { key: 'samples', label: 'Chamadas' }, { key: 'rate', label: 'Presença média' }], rows };
}

async function financeByCategory(churchId, range) {
  const groups = await finReports.grouped(churchId, { ...range, groupBy: 'category' });
  const rows = groups.map((g) => ({
    category: g.label,
    income: brl(g.incomeCents),
    expense: brl(g.expenseCents),
    balance: brl(g.balanceCents),
  }));
  return {
    columns: [
      { key: 'category', label: 'Categoria' },
      { key: 'income', label: 'Entradas (R$)' },
      { key: 'expense', label: 'Saídas (R$)' },
      { key: 'balance', label: 'Saldo (R$)' },
    ],
    rows,
  };
}

const RUNNERS = {
  'members-by-status': (churchId) => membersByStatus(churchId),
  'members-growth': (churchId) => membersGrowth(churchId),
  'giving-by-fund': (churchId, range) => givingByFund(churchId, range),
  'attendance-by-class': (churchId, range) => attendanceByClass(churchId, range),
  'finance-by-category': (churchId, range) => financeByCategory(churchId, range),
};

function findReport(key) {
  return REPORTS.find((r) => r.key === key) || null;
}

// Roda um relatório. `includeFinance` (da rota) bloqueia os financeiros sem
// permissão. Erros de tabela ausente viram PRECONDITION_FAILED.
async function run(churchId, key, { from, to } = {}, { includeFinance = false } = {}) {
  const meta = findReport(key);
  if (!meta) throw new Error('NOT_FOUND');
  if (meta.finance && !includeFinance) throw new Error('FORBIDDEN');
  const today = new Date().toISOString().slice(0, 10);
  const range = { from: from || `${new Date().getFullYear()}-01-01`, to: to || today };
  try {
    const result = await RUNNERS[key](churchId, range);
    return { key, label: meta.label, ...result };
  } catch (error) {
    if (isMissingRelation(error)) throw migrationPending(meta.migration);
    throw error;
  }
}

// Serializa { columns, rows } em CSV (Excel abre direto; ; + BOM UTF-8).
function toCsv({ columns, rows }) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(';');
  const lines = [header];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c.key])).join(';'));
  return `﻿${lines.join('\r\n')}`;
}

module.exports = { catalog, run, toCsv };
