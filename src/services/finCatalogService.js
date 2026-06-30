const { getSupabase } = require('../db');
const { mapFinCategory, mapFinCostCenter, mapFinAccount } = require('../lib/mappers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0020_financeiro_core.sql';

const CATEGORY_SELECT = 'id,church_id,parent_id,name,kind,is_active,created_at,updated_at';
const COST_CENTER_SELECT = 'id,church_id,name,description,is_active,created_at,updated_at';
const ACCOUNT_SELECT = 'id,church_id,name,type,opening_balance_cents,bank_name,is_active,created_at,updated_at';

const text = (v) => (v == null || v === '' ? null : String(v).trim());

// ============================ Categorias (F5.1) ============================

async function listCategories(churchId) {
  const { data, error } = await supabase
    .from('fin_categories').select(CATEGORY_SELECT)
    .eq('church_id', churchId).order('kind').order('name');
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinCategory);
}

async function createCategory(churchId, input) {
  const payload = {
    church_id: churchId,
    name: String(input.name).trim(),
    kind: input.kind || 'expense',
    parent_id: input.parentId || null,
    is_active: input.isActive == null ? true : Boolean(input.isActive),
  };
  const { data, error } = await supabase.from('fin_categories').insert(payload).select(CATEGORY_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinCategory(data);
}

async function updateCategory(id, churchId, input) {
  const payload = {};
  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.kind !== undefined) payload.kind = input.kind;
  if (input.parentId !== undefined) payload.parent_id = input.parentId || null;
  if (input.isActive !== undefined) payload.is_active = Boolean(input.isActive);
  const { data, error } = await supabase
    .from('fin_categories').update(payload).eq('id', id).eq('church_id', churchId).select(CATEGORY_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinCategory(data) : null;
}

async function deleteCategory(id, churchId) {
  const { data, error } = await supabase
    .from('fin_categories').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// ========================== Centros de custo (F5.1) ========================

async function listCostCenters(churchId) {
  const { data, error } = await supabase
    .from('fin_cost_centers').select(COST_CENTER_SELECT)
    .eq('church_id', churchId).order('name');
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinCostCenter);
}

async function createCostCenter(churchId, input) {
  const payload = {
    church_id: churchId,
    name: String(input.name).trim(),
    description: text(input.description),
    is_active: input.isActive == null ? true : Boolean(input.isActive),
  };
  const { data, error } = await supabase.from('fin_cost_centers').insert(payload).select(COST_CENTER_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinCostCenter(data);
}

async function updateCostCenter(id, churchId, input) {
  const payload = {};
  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.description !== undefined) payload.description = text(input.description);
  if (input.isActive !== undefined) payload.is_active = Boolean(input.isActive);
  const { data, error } = await supabase
    .from('fin_cost_centers').update(payload).eq('id', id).eq('church_id', churchId).select(COST_CENTER_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinCostCenter(data) : null;
}

async function deleteCostCenter(id, churchId) {
  const { data, error } = await supabase
    .from('fin_cost_centers').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// ============================== Contas (F5.2) ==============================

// Calcula o saldo de cada conta: abertura + entradas - saídas dos lançamentos.
async function computeAccountBalances(churchId) {
  const balances = new Map();
  const { data } = await supabase
    .from('fin_transactions').select('account_id,type,amount_cents').eq('church_id', churchId);
  for (const t of data || []) {
    if (!t.account_id) continue;
    const cur = balances.get(t.account_id) || 0;
    balances.set(t.account_id, cur + (t.type === 'income' ? Number(t.amount_cents) : -Number(t.amount_cents)));
  }
  return balances;
}

async function listAccounts(churchId, { withBalance = true } = {}) {
  const { data, error } = await supabase
    .from('fin_accounts').select(ACCOUNT_SELECT).eq('church_id', churchId).order('name');
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);

  const balances = withBalance ? await computeAccountBalances(churchId) : null;
  return (data || []).map((row) => {
    const mapped = mapFinAccount(row);
    if (balances) {
      mapped.balanceCents = Number(row.opening_balance_cents || 0) + (balances.get(row.id) || 0);
    }
    return mapped;
  });
}

async function createAccount(churchId, input) {
  const payload = {
    church_id: churchId,
    name: String(input.name).trim(),
    type: input.type || 'bank',
    opening_balance_cents: Number(input.openingBalanceCents || 0),
    bank_name: text(input.bankName),
    is_active: input.isActive == null ? true : Boolean(input.isActive),
  };
  const { data, error } = await supabase.from('fin_accounts').insert(payload).select(ACCOUNT_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinAccount(data);
}

async function updateAccount(id, churchId, input) {
  const payload = {};
  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.type !== undefined) payload.type = input.type;
  if (input.openingBalanceCents !== undefined) payload.opening_balance_cents = Number(input.openingBalanceCents || 0);
  if (input.bankName !== undefined) payload.bank_name = text(input.bankName);
  if (input.isActive !== undefined) payload.is_active = Boolean(input.isActive);
  const { data, error } = await supabase
    .from('fin_accounts').update(payload).eq('id', id).eq('church_id', churchId).select(ACCOUNT_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapFinAccount(data) : null;
}

async function deleteAccount(id, churchId) {
  const { data, error } = await supabase
    .from('fin_accounts').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listCostCenters, createCostCenter, updateCostCenter, deleteCostCenter,
  listAccounts, createAccount, updateAccount, deleteAccount,
  computeAccountBalances,
};
