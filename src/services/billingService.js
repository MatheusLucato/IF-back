// =============================================================================
// Billing / assinatura (F9.1).
// -----------------------------------------------------------------------------
// Lê/aplica o plano da igreja e expõe feature-gating por limite. Tolerante à
// migração 0032 ausente: cai no plano `free` (lido de churches.plan) para não
// quebrar nada antes do SQL ser aplicado. Mantém churches.plan como espelho.
// =============================================================================

const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { getPlan, isValidPlanKey, DEFAULT_PLAN_KEY, PLANS } = require('../lib/plans');
const provider = require('../lib/billingProvider');

const supabase = getSupabase();
const MIGRATION = '0032_billing_subscriptions.sql';
const SUB_SELECT = 'id,church_id,plan,status,provider,provider_sub_id,provider_customer_id,current_period_end,cancel_at_period_end,created_at,updated_at';

function isMissing(error) {
  return Boolean(error) && error.code === '42P01';
}

function mapSubscription(row, churchPlanFallback) {
  const planKey = (row && row.plan) || churchPlanFallback || DEFAULT_PLAN_KEY;
  const plan = getPlan(planKey);
  return {
    plan: plan.key,
    planName: plan.name,
    status: (row && row.status) || 'active',
    limits: plan.limits,
    features: plan.features,
    priceCents: plan.priceCents,
    currentPeriodEnd: (row && row.current_period_end) || null,
    cancelAtPeriodEnd: Boolean(row && row.cancel_at_period_end),
    provider: (row && row.provider) || null,
  };
}

// Plano efetivo da igreja: subscription se existir; senão churches.plan; senão free.
async function getSubscription(churchId) {
  const { data: church } = await supabase.from('churches').select('plan').eq('id', churchId).maybeSingle();
  const fallback = church?.plan || DEFAULT_PLAN_KEY;

  const { data, error } = await supabase
    .from('subscriptions').select(SUB_SELECT).eq('church_id', churchId).maybeSingle();
  if (isMissing(error)) return mapSubscription(null, fallback); // migração 0032 pendente → free.
  if (error) throw new Error(error.message);
  return mapSubscription(data, fallback);
}

// Aplica um plano à igreja (upsert da assinatura + espelho em churches.plan).
async function applyPlan(churchId, planKey, { status = 'active', providerName = null, providerSubId = null, currentPeriodEnd = null } = {}) {
  const plan = getPlan(planKey);
  const now = new Date().toISOString();

  const payload = {
    church_id: churchId, plan: plan.key, status,
    provider: providerName, provider_sub_id: providerSubId,
    current_period_end: currentPeriodEnd, cancel_at_period_end: false, updated_at: now,
  };

  // Upsert por church_id (UNIQUE).
  const { data: existing, error: selErr } = await supabase
    .from('subscriptions').select('id').eq('church_id', churchId).maybeSingle();
  if (isMissing(selErr)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);

  if (existing) {
    const { error } = await supabase.from('subscriptions').update(payload).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('subscriptions').insert(payload);
    if (isMissing(error)) throw AppError.preconditionFailed(`Execute a migração ${MIGRATION} no Supabase.`);
    if (error) throw new Error(error.message);
  }

  // Espelho denormalizado (feature gating barato em outros lugares).
  await supabase.from('churches').update({ plan: plan.key, updated_at: now }).eq('id', churchId);
  return getSubscription(churchId);
}

// Inicia a assinatura de um plano. No mock, ativa na hora; no provedor real,
// retorna a URL de checkout para o cliente concluir o pagamento.
async function checkout(churchId, planKey, customerEmail) {
  if (!isValidPlanKey(planKey)) throw AppError.badRequest('Plano inválido.');

  // Plano gratuito não passa pelo provedor.
  if (planKey === 'free') {
    const sub = await applyPlan(churchId, 'free', { providerName: null });
    return { subscription: sub, checkoutUrl: null };
  }

  const result = await provider.createCheckout({ plan: planKey, churchId, customerEmail });
  if (result.immediate) {
    const sub = await applyPlan(churchId, planKey, {
      status: result.status || 'active', providerName: provider.getProviderName(), providerSubId: result.providerSubId,
    });
    return { subscription: sub, checkoutUrl: null };
  }
  // Provedor real: o webhook confirmará e chamará applyPlan.
  return { subscription: await getSubscription(churchId), checkoutUrl: result.url };
}

async function cancel(churchId) {
  const { data } = await supabase.from('subscriptions').select(SUB_SELECT).eq('church_id', churchId).maybeSingle();
  if (data?.provider_sub_id) {
    try { await provider.cancelSubscription(data.provider_sub_id); } catch { /* best-effort */ }
  }
  return applyPlan(churchId, 'free', { status: 'canceled' });
}

// Webhook do provedor de billing: confirma/cancela a assinatura.
async function handleBillingEvent(event) {
  if (!event || !event.churchId) return { handled: false };
  if (event.status === 'canceled') {
    await applyPlan(event.churchId, 'free', { status: 'canceled' });
    return { handled: true, kind: 'canceled' };
  }
  if (event.plan && isValidPlanKey(event.plan)) {
    await applyPlan(event.churchId, event.plan, {
      status: 'active', providerName: provider.getProviderName(), providerSubId: event.providerSubId,
    });
    return { handled: true, kind: 'active' };
  }
  return { handled: false };
}

function listPlans() {
  return { plans: PLANS, providerConfigured: provider.isConfigured(), provider: provider.getProviderName() };
}

// Feature-gating por limite: lança CONFLICT quando o uso atinge o teto do plano.
async function assertWithinLimit(churchId, limitKey, currentCount) {
  const sub = await getSubscription(churchId);
  const max = sub.limits ? sub.limits[limitKey] : null;
  if (max != null && Number(currentCount) >= Number(max)) {
    throw AppError.conflict(`Limite do plano ${sub.planName} atingido para ${limitKey} (${max}). Faça upgrade para continuar.`);
  }
  return true;
}

module.exports = { getSubscription, checkout, cancel, applyPlan, handleBillingEvent, listPlans, assertWithinLimit };
