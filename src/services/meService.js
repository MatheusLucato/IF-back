// =============================================================================
// Agregadores do MEMBRO (F8.1 PWA do membro + F6.4 portal do contribuinte).
// -----------------------------------------------------------------------------
// Endpoints "me/*" focados na experiência do próprio usuário (não na gestão):
// home, agenda, avisos, minhas escalas e minhas contribuições. Reaproveita os
// services de cada módulo, sempre escopado ao tenant + à pessoa logada.
// =============================================================================

const { getSupabase } = require('../db');
const { mapSchedule, mapDonation } = require('../lib/mappers');
const comunicacao = require('./comunicacaoService');
const events = require('./eventService');

const supabase = getSupabase();

async function memberIdForUser(churchId, userId) {
  try {
    const { data } = await supabase
      .from('members').select('id').eq('church_id', churchId).eq('user_id', userId).maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

// Minhas escalas (próximas): filtra as escalas cujas atribuições referenciam a
// pessoa (por memberId OU pelo próprio user.id, cobrindo escalas antigas).
async function getMySchedules(churchId, user) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('schedules').select('*').eq('church_id', churchId).gte('date', today).order('date', { ascending: true });
  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(error.message);
  }
  const memberId = await memberIdForUser(churchId, user.id);
  const ids = new Set([memberId, user.id].filter(Boolean));

  return (data || [])
    .map(mapSchedule)
    .map((s) => {
      const mine = (s.assignments || [])
        .map((a) => ({ ...a, members: (a.members || []).filter((m) => ids.has(m.memberId)) }))
        .filter((a) => a.members.length > 0);
      return mine.length ? { id: s.id, date: s.date, serviceTime: s.serviceTime, assignments: mine } : null;
    })
    .filter(Boolean);
}

// Minhas contribuições (F6.4): doações vinculadas ao meu cadastro de membro.
async function getMyDonations(churchId, user) {
  const memberId = await memberIdForUser(churchId, user.id);
  if (!memberId) return [];
  const { data, error } = await supabase
    .from('donations')
    .select('id,church_id,fund_id,member_id,amount_cents,method,status,paid_at,created_at,receipt_id')
    .eq('church_id', churchId).eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapDonation);
}

async function getAnnouncements(churchId) {
  try { return await comunicacao.listAnnouncements(churchId); } catch { return []; }
}

async function getUpcomingEvents(churchId) {
  try { return await events.listEvents(churchId, { scope: 'upcoming' }); } catch { return []; }
}

// Home: contadores + destaques para a tela inicial do membro.
async function getHome(churchId, user) {
  const [schedules, announcements, upcoming, donations] = await Promise.all([
    getMySchedules(churchId, user),
    getAnnouncements(churchId),
    getUpcomingEvents(churchId),
    getMyDonations(churchId, user),
  ]);

  const totalGivenCents = donations
    .filter((d) => d.status === 'paid')
    .reduce((a, d) => a + Number(d.amountCents || 0), 0);

  return {
    user: { id: user.id, name: user.name || user.full_name },
    upcomingSchedules: schedules.slice(0, 3),
    nextEvents: upcoming.slice(0, 3),
    latestAnnouncements: announcements.slice(0, 3),
    stats: {
      schedules: schedules.length,
      events: upcoming.length,
      announcements: announcements.length,
      totalGivenCents,
    },
  };
}

module.exports = { getHome, getMySchedules, getMyDonations, getAnnouncements, getUpcomingEvents };
