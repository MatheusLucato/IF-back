const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapGivingFund, mapDonation, mapDonationSubscription, mapFinBoleto } = require('../lib/mappers');
const { normalizeBirthDate, slugify } = require('../lib/normalizers');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');
const gateway = require('../lib/paymentGateway');
const { insertTransaction } = require('./finTransactionService');
const { issueReceipt } = require('./finReceiptService');
const { settleReceivable } = require('./finPayableService');

const supabase = getSupabase();
const FUNDS_MIGRATION = '0025_giving_funds.sql';
const DONATIONS_MIGRATION = '0026_giving_donations.sql';
const BOLETOS_MIGRATION = '0027_financeiro_boletos.sql';

const FUND_SELECT = 'id,church_id,name,slug,description,category_id,goal_cents,is_active,sort_order,created_at,updated_at';
const DONATION_SELECT = 'id,church_id,fund_id,member_id,subscription_id,donor_name,donor_email,amount_cents,method,status,provider,provider_charge_id,pix_payload,pix_qr_image,checkout_url,paid_at,transaction_id,receipt_id,created_at,updated_at';
const SUB_SELECT = 'id,church_id,fund_id,member_id,donor_name,donor_email,amount_cents,period,method,status,provider,provider_sub_id,created_at,updated_at';
const BOLETO_SELECT = 'id,church_id,receivable_id,member_id,payer_name,payer_document,description,amount_cents,due_date,status,provider,provider_charge_id,bank_slip_url,digitable_line,barcode,paid_at,transaction_id,created_by,created_at,updated_at';

const text = (v) => (v == null || v === '' ? null : String(v).trim());

// ============================ Fundos (F6.1) ===============================

// Soma das doações PAGAS por fundo (para a barra de progresso da meta).
async function raisedByFund(churchId) {
  const map = new Map();
  const { data } = await supabase
    .from('donations').select('fund_id,amount_cents').eq('church_id', churchId).eq('status', 'paid');
  for (const d of data || []) {
    if (!d.fund_id) continue;
    map.set(d.fund_id, (map.get(d.fund_id) || 0) + Number(d.amount_cents));
  }
  return map;
}

async function listFunds(churchId, { activeOnly = false } = {}) {
  let query = supabase.from('giving_funds').select(FUND_SELECT).eq('church_id', churchId);
  if (activeOnly) query = query.eq('is_active', true);
  query = query.order('sort_order').order('name');
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(FUNDS_MIGRATION);
  if (error) throw new Error(error.message);

  let raised = new Map();
  try { raised = await raisedByFund(churchId); } catch { /* donations pode não existir ainda */ }
  return (data || []).map((row) => {
    const mapped = mapGivingFund(row);
    mapped.raisedCents = raised.get(row.id) || 0;
    return mapped;
  });
}

async function generateFundSlug(churchId, name) {
  const base = slugify(name).slice(0, 50) || `fundo-${Date.now()}`;
  let slug = base;
  for (let i = 0; i < 5; i += 1) {
    const { data } = await supabase.from('giving_funds').select('id').eq('church_id', churchId).eq('slug', slug).maybeSingle();
    if (!data) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 5)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function createFund(churchId, input) {
  const payload = {
    church_id: churchId,
    name: String(input.name).trim(),
    slug: await generateFundSlug(churchId, input.name),
    description: text(input.description),
    category_id: input.categoryId || null,
    goal_cents: input.goalCents == null ? null : Number(input.goalCents),
    is_active: input.isActive == null ? true : Boolean(input.isActive),
    sort_order: Number(input.sortOrder || 0),
  };
  const { data, error } = await supabase.from('giving_funds').insert(payload).select(FUND_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(FUNDS_MIGRATION);
  if (error) throw new Error(error.message);
  return mapGivingFund(data);
}

async function updateFund(id, churchId, input) {
  const payload = {};
  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.description !== undefined) payload.description = text(input.description);
  if (input.categoryId !== undefined) payload.category_id = input.categoryId || null;
  if (input.goalCents !== undefined) payload.goal_cents = input.goalCents == null ? null : Number(input.goalCents);
  if (input.isActive !== undefined) payload.is_active = Boolean(input.isActive);
  if (input.sortOrder !== undefined) payload.sort_order = Number(input.sortOrder || 0);
  const { data, error } = await supabase
    .from('giving_funds').update(payload).eq('id', id).eq('church_id', churchId).select(FUND_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(FUNDS_MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapGivingFund(data) : null;
}

async function deleteFund(id, churchId) {
  const { data, error } = await supabase
    .from('giving_funds').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(FUNDS_MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function getFund(churchId, { id, slug }) {
  let query = supabase.from('giving_funds').select(FUND_SELECT).eq('church_id', churchId);
  query = id ? query.eq('id', id) : query.eq('slug', slug);
  const { data, error } = await query.maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(FUNDS_MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

// ============================ Doações (F6.2/F6.3) =========================

// Cria a doação (fluxo público): resolve o fundo, cria a cobrança no gateway e
// grava a doação como 'pending'. O webhook confirma depois. Se recurring=true,
// cria também a assinatura (F6.3).
async function createDonation(churchId, input) {
  let fundRow = null;
  if (input.fundId) fundRow = await getFund(churchId, { id: input.fundId });
  else if (input.fundSlug) fundRow = await getFund(churchId, { slug: input.fundSlug });

  const donor = { name: input.donorName, email: input.donorEmail, document: input.donorDocument };

  let subscriptionId = null;
  if (input.recurring) {
    const sub = await gateway.createSubscription({
      amountCents: input.amountCents,
      period: input.period || 'monthly',
      description: fundRow ? `Contribuição recorrente — ${fundRow.name}` : 'Contribuição recorrente',
      donor,
    });
    const { data: subRow } = await supabase.from('donation_subscriptions').insert({
      church_id: churchId,
      fund_id: fundRow?.id || null,
      donor_name: text(input.donorName),
      donor_email: input.donorEmail ? String(input.donorEmail).trim().toLowerCase() : null,
      amount_cents: Number(input.amountCents),
      period: input.period || 'monthly',
      method: 'credit_card',
      status: sub.status,
      provider: sub.provider,
      provider_sub_id: sub.subscriptionId,
    }).select('id').single();
    subscriptionId = subRow?.id || null;
  }

  const charge = await gateway.createCharge({
    method: input.method || 'pix',
    amountCents: input.amountCents,
    description: fundRow ? `Contribuição — ${fundRow.name}` : 'Contribuição',
    donor,
  });

  const payload = {
    church_id: churchId,
    fund_id: fundRow?.id || null,
    subscription_id: subscriptionId,
    donor_name: text(input.donorName),
    donor_email: input.donorEmail ? String(input.donorEmail).trim().toLowerCase() : null,
    donor_document: text(input.donorDocument),
    amount_cents: Number(input.amountCents),
    method: input.method || 'pix',
    status: charge.status || 'pending',
    provider: charge.provider,
    provider_charge_id: charge.chargeId,
    pix_payload: charge.pixPayload || null,
    pix_qr_image: charge.pixQrImage || null,
    checkout_url: charge.checkoutUrl || null,
  };
  const { data, error } = await supabase.from('donations').insert(payload).select(DONATION_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(DONATIONS_MIGRATION);
  if (error) throw new Error(error.message);

  const donation = mapDonation(data);
  // Se o gateway já confirmou no ato (ex.: mock), concilia imediatamente.
  if (donation.status === 'paid') await confirmDonation(churchId, data);
  return donation;
}

async function listDonations(churchId, q = {}) {
  const { from, to, status, fundId, method, page = 1, pageSize = 50 } = q;
  const offset = (page - 1) * pageSize;
  let query = supabase.from('donations').select(DONATION_SELECT, { count: 'exact' }).eq('church_id', churchId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', `${to}T23:59:59`);
  if (status) query = query.eq('status', status);
  if (fundId) query = query.eq('fund_id', fundId);
  if (method) query = query.eq('method', method);
  query = query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
  const { data, error, count } = await query;
  if (isMissingRelation(error)) throw migrationPending(DONATIONS_MIGRATION);
  if (error) throw new Error(error.message);
  return { donations: (data || []).map(mapDonation), total: count ?? null, page, pageSize };
}

// Confirma uma doação paga (idempotente): cria a receita + recibo e vincula.
async function confirmDonation(churchId, donationRow) {
  if (donationRow.status === 'paid' && donationRow.transaction_id) return mapDonation(donationRow);

  let categoryId = null;
  if (donationRow.fund_id) {
    const { data: fund } = await supabase
      .from('giving_funds').select('category_id,name').eq('id', donationRow.fund_id).maybeSingle();
    categoryId = fund?.category_id || null;
  }

  const tx = await insertTransaction(churchId, {
    categoryId,
    memberId: donationRow.member_id || null,
    type: 'income',
    amountCents: donationRow.amount_cents,
    description: `Doação online${donationRow.donor_name ? ` — ${donationRow.donor_name}` : ''}`,
    source: 'donation',
    sourceId: donationRow.id,
    reconciled: true,
  });

  // Recibo (best-effort): não quebra a confirmação se a tabela não existir.
  let receiptId = null;
  try {
    const receipt = await issueReceipt(churchId, {
      transactionId: tx.id,
      memberId: donationRow.member_id || null,
      payerName: donationRow.donor_name || null,
      description: 'Contribuição online',
    });
    receiptId = receipt.id;
  } catch { /* recibo opcional */ }

  const { data, error } = await supabase.from('donations').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    transaction_id: tx.id,
    receipt_id: receiptId,
  }).eq('id', donationRow.id).eq('church_id', churchId).select(DONATION_SELECT).single();
  if (error) throw new Error(error.message);
  return mapDonation(data);
}

async function listSubscriptions(churchId) {
  const { data, error } = await supabase
    .from('donation_subscriptions').select(SUB_SELECT).eq('church_id', churchId).order('created_at', { ascending: false });
  if (isMissingRelation(error)) throw migrationPending(DONATIONS_MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapDonationSubscription);
}

// =============================== Boletos (F5.7) ===========================

async function listBoletos(churchId, { status } = {}) {
  let query = supabase.from('fin_boletos').select(BOLETO_SELECT).eq('church_id', churchId);
  if (status) query = query.eq('status', status);
  query = query.order('due_date', { ascending: false });
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(BOLETOS_MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapFinBoleto);
}

async function createBoleto(churchId, input, userId) {
  const dueDate = input.dueDate ? normalizeBirthDate(String(input.dueDate)) : null;
  if (!dueDate) throw AppError.badRequest('Vencimento inválido.');

  const charge = await gateway.createCharge({
    method: 'boleto',
    amountCents: input.amountCents,
    description: input.description || `Boleto — ${input.payerName}`,
    dueDate,
    donor: { name: input.payerName, document: input.payerDocument },
  });

  const payload = {
    church_id: churchId,
    receivable_id: input.receivableId || null,
    member_id: input.memberId || null,
    payer_name: String(input.payerName).trim(),
    payer_document: text(input.payerDocument),
    description: text(input.description),
    amount_cents: Number(input.amountCents),
    due_date: dueDate,
    status: charge.status || 'pending',
    provider: charge.provider,
    provider_charge_id: charge.chargeId,
    bank_slip_url: charge.bankSlipUrl || null,
    digitable_line: charge.digitableLine || null,
    barcode: charge.barcode || null,
    created_by: userId || null,
  };
  const { data, error } = await supabase.from('fin_boletos').insert(payload).select(BOLETO_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(BOLETOS_MIGRATION);
  if (error) throw new Error(error.message);
  return mapFinBoleto(data);
}

// Confirma um boleto pago (idempotente): dá baixa na conta a receber (se houver)
// ou cria a receita avulsa.
async function confirmBoleto(churchId, boletoRow, userId) {
  if (boletoRow.status === 'paid' && boletoRow.transaction_id) return mapFinBoleto(boletoRow);

  let transactionId = null;
  if (boletoRow.receivable_id) {
    try {
      const result = await settleReceivable(boletoRow.receivable_id, churchId, {}, userId);
      transactionId = result.transaction.id;
    } catch { /* receivable pode ter sido removido; cai no fluxo avulso */ }
  }
  if (!transactionId) {
    const tx = await insertTransaction(churchId, {
      memberId: boletoRow.member_id || null,
      type: 'income',
      amountCents: boletoRow.amount_cents,
      description: `Boleto pago — ${boletoRow.payer_name}`,
      source: 'boleto',
      sourceId: boletoRow.id,
      reconciled: true,
    });
    transactionId = tx.id;
  }

  const { data, error } = await supabase.from('fin_boletos').update({
    status: 'paid', paid_at: new Date().toISOString(), transaction_id: transactionId,
  }).eq('id', boletoRow.id).eq('church_id', churchId).select(BOLETO_SELECT).single();
  if (error) throw new Error(error.message);
  return mapFinBoleto(data);
}

// =============================== Webhook ==================================
// Recebe um evento já verificado/parseado e concilia a cobrança correspondente
// (doação OU boleto). Idempotente: ignora eventos não-pagos e cobranças já pagas.
async function handlePaymentEvent({ chargeId, status }) {
  if (!chargeId || status !== 'paid') return { handled: false, reason: 'evento ignorado' };

  // 1. Doação?
  const { data: donation } = await supabase
    .from('donations').select(DONATION_SELECT).eq('provider_charge_id', chargeId).maybeSingle();
  if (donation) {
    await confirmDonation(donation.church_id, donation);
    return { handled: true, kind: 'donation' };
  }

  // 2. Boleto?
  const { data: boleto } = await supabase
    .from('fin_boletos').select(BOLETO_SELECT).eq('provider_charge_id', chargeId).maybeSingle();
  if (boleto) {
    await confirmBoleto(boleto.church_id, boleto, null);
    return { handled: true, kind: 'boleto' };
  }

  return { handled: false, reason: 'cobrança não encontrada' };
}

module.exports = {
  listFunds, createFund, updateFund, deleteFund, getFund,
  createDonation, listDonations, confirmDonation, listSubscriptions,
  listBoletos, createBoleto, confirmBoleto,
  handlePaymentEvent,
};
