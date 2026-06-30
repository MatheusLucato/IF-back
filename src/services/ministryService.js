const { getSupabase } = require('../db');
const { MINISTRY_SELECT_BASE, MINISTRY_SELECT_WITH_TEAMS } = require('../lib/constants');
const { mapLeader, isGhostUser, mapStoredSong } = require('../lib/mappers');
const { normalizeStringArray, normalizeFunctionNames, sanitizeMinistryTeams } = require('../lib/normalizers');

const supabase = getSupabase();

// Estado encapsulado: tolera bancos que ainda nao rodaram a migracao da coluna
// ministries.teams. Quando detectamos a coluna ausente, desligamos o suporte e
// passamos a operar so com o select base. (Comportamento legado preservado.)
let supportsMinistryTeamsColumn = true;

function isTeamsColumnSupported() {
  return supportsMinistryTeamsColumn;
}

function markTeamsColumnUnsupported() {
  supportsMinistryTeamsColumn = false;
}

function isMissingMinistryTeamsColumnError(error) {
  if (!error) return false;
  const message = String(error.message || '');
  if (error.code === '42703') return true;
  return /column\s+ministries\.teams\s+does not exist/i.test(message)
    || /column\s+teams\s+does not exist/i.test(message);
}

async function runMinistryQueryWithFallback(queryFactory) {
  const preferredSelect = supportsMinistryTeamsColumn ? MINISTRY_SELECT_WITH_TEAMS : MINISTRY_SELECT_BASE;
  let result = await queryFactory(preferredSelect);

  if (supportsMinistryTeamsColumn && isMissingMinistryTeamsColumnError(result.error)) {
    supportsMinistryTeamsColumn = false;
    result = await queryFactory(MINISTRY_SELECT_BASE);
  }

  return result;
}

async function updateMinistryTeamsSafely(ministryId, teams) {
  if (!supportsMinistryTeamsColumn) return;

  const { error } = await supabase
    .from('ministries')
    .update({ teams })
    .eq('id', ministryId);

  if (isMissingMinistryTeamsColumnError(error)) {
    supportsMinistryTeamsColumn = false;
    return;
  }

  if (error) {
    throw new Error(error.message);
  }
}

// Insere um ministerio aplicando o fallback da coluna teams (cria com teams: []
// quando suportado; reexecuta sem teams se a coluna nao existir).
async function insertMinistry(payload) {
  let createPayload = payload;
  if (supportsMinistryTeamsColumn) {
    createPayload = { ...payload, teams: [] };
  }

  let createResponse = await supabase
    .from('ministries')
    .insert(createPayload)
    .select(supportsMinistryTeamsColumn ? MINISTRY_SELECT_WITH_TEAMS : MINISTRY_SELECT_BASE)
    .single();

  if (supportsMinistryTeamsColumn && isMissingMinistryTeamsColumnError(createResponse.error)) {
    supportsMinistryTeamsColumn = false;
    createResponse = await supabase
      .from('ministries')
      .insert(payload)
      .select(MINISTRY_SELECT_BASE)
      .single();
  }

  return createResponse;
}

function isLeaderEligible(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'lider';
}

async function canCreateMinistry(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'lider') return false;

  const { data: createdMinistries, error: createdError } = await supabase
    .from('ministries')
    .select('id')
    .eq('leader_id', user.id)
    .limit(1);

  if (createdError) {
    throw new Error(createdError.message);
  }

  if ((createdMinistries || []).length > 0) {
    return true;
  }

  const { data: managedMinistries, error: managedError } = await supabase
    .from('ministries')
    .select('id,managers');

  if (managedError) {
    throw new Error(managedError.message);
  }

  const isManagerInAnyMinistry = (managedMinistries || []).some((ministry) => {
    if (Array.isArray(ministry.managers)) {
      return ministry.managers.includes(user.id);
    }

    if (typeof ministry.managers === 'string') {
      try {
        const parsed = JSON.parse(ministry.managers);
        return Array.isArray(parsed) && parsed.includes(user.id);
      } catch {
        return false;
      }
    }

    return false;
  });

  if (isManagerInAnyMinistry) {
    return false;
  }

  return true;
}

async function canManageMinistry(actor, ministry) {
  if (!actor || !ministry) return false;
  if (actor.role === 'admin') return true;
  if (ministry.leader_id === actor.id) return true;

  // Check ministry_admins table
  const { data, error } = await supabase
    .from('ministry_admins')
    .select('user_id')
    .eq('ministry_id', ministry.id)
    .eq('user_id', actor.id)
    .maybeSingle();

  return !error && !!data;
}

async function canAccessRepertoire(actor, ministry) {
  if (!actor || !ministry) return false;
  if (actor.role === 'admin') return true;

  // Rule: Must be a music ministry
  if (!ministry.is_music_ministry) return false;

  // Rule: Must be leader or administrator of that ministry
  return await canManageMinistry(actor, ministry);
}

async function canManageAnyMusicMinistry(actor) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;

  // Check if leader of any music ministry
  const { data: leaderOf, error: leaderError } = await supabase
    .from('ministries')
    .select('id')
    .eq('leader_id', actor.id)
    .eq('is_music_ministry', true)
    .limit(1);

  if (!leaderError && leaderOf && leaderOf.length > 0) return true;

  // Check if admin of any music ministry
  const { data: adminOf, error: adminError } = await supabase
    .from('ministry_admins')
    .select('ministry_id')
    .eq('user_id', actor.id);

  if (!adminError && adminOf && adminOf.length > 0) {
    const ministryIds = adminOf.map(a => a.ministry_id);
    const { data: musicMinistries } = await supabase
      .from('ministries')
      .select('id')
      .in('id', ministryIds)
      .eq('is_music_ministry', true)
      .limit(1);

    if (musicMinistries && musicMinistries.length > 0) return true;
  }

  return false;
}

function syncTeamsWithMemberIds(teams, validMemberIds) {
  const validIds = new Set(normalizeStringArray(validMemberIds));
  return sanitizeMinistryTeams(teams)
    .map((team) => ({
      ...team,
      memberIds: team.memberIds.filter((memberId) => validIds.has(memberId)),
    }))
    .filter((team) => team.memberIds.length > 0);
}

async function enrichMinistries(rows) {
  const ministryIds = [...new Set((rows || []).map((row) => row.id).filter(Boolean))];
  const leaderIds = [...new Set((rows || []).map((row) => row.leader_id).filter(Boolean))];
  const adminIdsMap = new Map();
  const ministersMap = new Map();
  const membershipMap = new Map();
  const memberIds = new Set();
  const repertoireMap = new Map();
  const repertoireSongIds = new Set();

  if (ministryIds.length > 0) {
    // 1. Fetch ministers from the new junction table
    const { data: ministers, error: ministersError } = await supabase
      .from('ministry_ministers')
      .select('ministry_id,user_id')
      .in('ministry_id', ministryIds);

    if (!ministersError) {
      for (const minister of ministers || []) {
        if (!ministersMap.has(minister.ministry_id)) {
          ministersMap.set(minister.ministry_id, []);
        }
        ministersMap.get(minister.ministry_id).push(minister.user_id);
        memberIds.add(minister.user_id);
      }
    }

    // 1b. Fetch administrators from the junction table
    const { data: admins, error: adminsError } = await supabase
      .from('ministry_admins')
      .select('ministry_id,user_id')
      .in('ministry_id', ministryIds);

    if (!adminsError) {
      for (const admin of admins || []) {
        if (!adminIdsMap.has(admin.ministry_id)) {
          adminIdsMap.set(admin.ministry_id, []);
        }
        adminIdsMap.get(admin.ministry_id).push(admin.user_id);
        memberIds.add(admin.user_id);
      }
    }
  }

  if (ministryIds.length > 0) {
    let memberships = null;
    let membershipError = null;

    const withFunctionsResponse = await supabase
      .from('ministry_members')
      .select('ministry_id,user_id,function_names,function_ids')
      .in('ministry_id', ministryIds);

    memberships = withFunctionsResponse.data;
    membershipError = withFunctionsResponse.error;

    if (membershipError && membershipError.code === '42703') {
      const legacyResponse = await supabase
        .from('ministry_members')
        .select('ministry_id,user_id,function_name')
        .in('ministry_id', ministryIds);

      memberships = (legacyResponse.data || []).map((item) => ({
        ...item,
        function_names: [String(item.function_name || 'Membro').trim() || 'Membro'],
      }));
      membershipError = legacyResponse.error;
    }

    if (membershipError && membershipError.code === '42703') {
      const fallbackResponse = await supabase
        .from('ministry_members')
        .select('ministry_id,user_id')
        .in('ministry_id', ministryIds);

      memberships = (fallbackResponse.data || []).map((item) => ({
        ...item,
        function_names: ['Membro'],
      }));
      membershipError = fallbackResponse.error;
    }

    if (membershipError && membershipError.code !== '42P01') {
      throw new Error(membershipError.message);
    }

    if (!membershipError) {
      for (const membership of memberships || []) {
        const ministryId = membership.ministry_id;
        const userId = membership.user_id;
        if (!membershipMap.has(ministryId)) {
          membershipMap.set(ministryId, []);
        }
        membershipMap.get(ministryId).push({
          user_id: userId,
          function_names: normalizeFunctionNames(membership.function_names),
          function_ids: Array.isArray(membership.function_ids) ? membership.function_ids : []
        });
        memberIds.add(userId);
      }
    }
  }

  if (ministryIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from('ministry_repertoire')
      .select('ministry_id,song_id')
      .in('ministry_id', ministryIds);

    if (linksError) {
      throw new Error(linksError.message);
    }

    for (const link of links || []) {
      if (!repertoireMap.has(link.ministry_id)) {
        repertoireMap.set(link.ministry_id, []);
      }
      repertoireMap.get(link.ministry_id).push(link.song_id);
      repertoireSongIds.add(link.song_id);
    }
  }

  let repertoireSongMap = new Map();
  if (repertoireSongIds.size > 0) {
    const { data: songs, error: songsError } = await supabase
      .from('repertoire_songs')
      .select('id,song')
      .in('id', [...repertoireSongIds]);

    if (songsError) {
      throw new Error(songsError.message);
    }

    repertoireSongMap = new Map((songs || [])
      .map((item) => [item.id, mapStoredSong(item)])
      .filter((entry) => Boolean(entry[1])));
  }

  const userIds = [...new Set([...leaderIds, ...memberIds])];

  let userMap = new Map();
  if (userIds.length > 0) {
    const { data: users, error } = await supabase
      .from('users')
      .select('id,name,full_name,role')
      .in('id', userIds);

    if (error) {
      throw new Error(error.message);
    }

    userMap = new Map((users || []).map((user) => [user.id, user]));
  }

  return (rows || []).map((row) => {
    const allManagerIds = adminIdsMap.get(row.id) || [];
    const managerUsers = allManagerIds
      .map((managerId) => userMap.get(managerId))
      .map(mapLeader)
      .filter(Boolean);

    const allMinisterIds = ministersMap.get(row.id) || [];
    const ministerUsers = allMinisterIds
      .map((ministerId) => userMap.get(ministerId))
      .map(mapLeader)
      .filter(Boolean);

    const memberships = membershipMap.get(row.id) || [];
    const memberUsers = memberships
      .map((membership) => {
        const user = userMap.get(membership.user_id);
        if (!user || isGhostUser(user)) return null;

        const ministryFunctions = Array.isArray(row.functions) ? row.functions : [];
        let finalNames = [];
        const fIds = Array.isArray(membership.function_ids) ? membership.function_ids : [];

        if (fIds.length > 0) {
          finalNames = fIds
            .map(id => ministryFunctions.find(f => f.id === id)?.name)
            .filter(Boolean);
        }

        if (finalNames.length === 0) {
          finalNames = normalizeFunctionNames(membership.function_names);
        }

        return {
          id: user.id,
          name: user.name || user.full_name,
          functionName: finalNames[0] || 'Membro',
          functionNames: finalNames,
          functionIds: fIds,
        };
      })
      .filter(Boolean);
    const memberUserIds = memberUsers.map((member) => member.id);

    const leader = userMap.get(row.leader_id);
    const leaderName = leader && !isGhostUser(leader)
      ? (leader.name || leader.full_name || 'Lider removido')
      : 'Lider oculto';

    return {
      ...row,
      leader_name: leaderName,
      manager_users: managerUsers,
      managers: allManagerIds,
      ministers: allMinisterIds,
      minister_users: ministerUsers,
      member_users: memberUsers,
      member_user_ids: memberUserIds,
      member_count: memberUserIds.length,
      repertoire: (repertoireMap.get(row.id) || [])
        .map((songId) => repertoireSongMap.get(songId))
        .filter(Boolean),
    };
  });
}

async function getMinistryById(ministryId, churchId) {
  const { data, error } = await runMinistryQueryWithFallback((selectFields) => {
    let query = supabase
      .from('ministries')
      .select(selectFields)
      .eq('id', ministryId);
    if (churchId) {
      query = query.eq('church_id', churchId);
    }
    return query.maybeSingle();
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  const enriched = await enrichMinistries([data]);
  return enriched[0] || null;
}

module.exports = {
  isTeamsColumnSupported,
  markTeamsColumnUnsupported,
  isMissingMinistryTeamsColumnError,
  runMinistryQueryWithFallback,
  updateMinistryTeamsSafely,
  insertMinistry,
  isLeaderEligible,
  canCreateMinistry,
  canManageMinistry,
  canAccessRepertoire,
  canManageAnyMusicMinistry,
  syncTeamsWithMemberIds,
  enrichMinistries,
  getMinistryById,
};
