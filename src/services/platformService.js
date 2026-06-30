// =============================================================================
// Super-Admin da plataforma (F9.2).
// -----------------------------------------------------------------------------
// Visão e gestão CROSS-TENANT de todas as igrejas. É o único lugar do app que
// atravessa o escopo por `church_id` de propósito — usa a service-role key
// (getSupabase) e é acessível SOMENTE por `plataforma_admin` (ver middleware).
// Todo acesso/ação é auditado nos routers.
// =============================================================================

const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapChurch } = require('../lib/mappers');

const supabase = getSupabase();

const VALID_STATUSES = ['active', 'suspended', 'trialing', 'canceled'];

// Agrega contagens por church_id a partir de um SELECT enxuto (só a coluna de
// tenant). Para a escala atual de tenants é suficiente; se crescer muito, migrar
// para uma view/materialized view com contagens pré-agregadas.
async function countByChurch(table) {
  const map = new Map();
  const { data, error } = await supabase.from(table).select('church_id');
  if (error) {
    if (error.code === '42P01') return map; // tabela ainda não existe → 0.
    throw new Error(error.message);
  }
  for (const row of data || []) {
    if (!row.church_id) continue;
    map.set(row.church_id, (map.get(row.church_id) || 0) + 1);
  }
  return map;
}

async function listChurches() {
  const { data: churches, error } = await supabase
    .from('churches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const [usersByChurch, membersByChurch] = await Promise.all([
    countByChurch('users'),
    countByChurch('members'),
  ]);

  return (churches || []).map((c) => ({
    ...mapChurch(c),
    createdAt: c.created_at || null,
    usersCount: usersByChurch.get(c.id) || 0,
    membersCount: membersByChurch.get(c.id) || 0,
  }));
}

async function getMetrics() {
  const [churchCount, usersByChurch, membersByChurch] = await Promise.all([
    supabase.from('churches').select('id', { count: 'exact', head: true }),
    countByChurch('users'),
    countByChurch('members'),
  ]);

  const totalUsers = [...usersByChurch.values()].reduce((a, b) => a + b, 0);
  const totalMembers = [...membersByChurch.values()].reduce((a, b) => a + b, 0);

  // Soma de doações pagas (best-effort: a tabela pode não existir ainda).
  let totalDonationsCents = 0;
  try {
    const { data } = await supabase.from('donations').select('amount_cents').eq('status', 'paid');
    totalDonationsCents = (data || []).reduce((a, d) => a + Number(d.amount_cents || 0), 0);
  } catch { /* donations opcional */ }

  // Distribuição por status/plano.
  const { data: statusRows } = await supabase.from('churches').select('status,plan');
  const byStatus = {};
  const byPlan = {};
  for (const r of statusRows || []) {
    byStatus[r.status || 'unknown'] = (byStatus[r.status || 'unknown'] || 0) + 1;
    byPlan[r.plan || 'free'] = (byPlan[r.plan || 'free'] || 0) + 1;
  }

  return {
    churches: churchCount.count ?? (statusRows || []).length,
    users: totalUsers,
    members: totalMembers,
    donationsCents: totalDonationsCents,
    byStatus,
    byPlan,
  };
}

async function getChurchRow(id) {
  const { data, error } = await supabase.from('churches').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw AppError.notFound('Igreja não encontrada.');
  return data;
}

async function setChurchStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw AppError.badRequest(`Status inválido. Use um de: ${VALID_STATUSES.join(', ')}.`);
  }
  const before = await getChurchRow(id);
  const { data, error } = await supabase
    .from('churches')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { before: mapChurch(before), church: mapChurch(data) };
}

async function setChurchPlan(id, plan) {
  const before = await getChurchRow(id);
  const { data, error } = await supabase
    .from('churches')
    .update({ plan, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { before: mapChurch(before), church: mapChurch(data) };
}

module.exports = { VALID_STATUSES, listChurches, getMetrics, setChurchStatus, setChurchPlan };
