require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const { getSupabase, initConnection } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const supabase = getSupabase();

function normalizeOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    const parsed = new URL(input);
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}`.toLowerCase();
  } catch {
    return input.replace(/\/+$/, '').toLowerCase();
  }
}

const configuredOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((item) => normalizeOrigin(item)).filter(Boolean)
  : [];

const allowAllOrigins = configuredOrigins.length === 0;
const isDev = process.env.NODE_ENV !== 'production';
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowAllOrigins) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const isConfigured = configuredOrigins.includes(normalizedOrigin);
    const isLocalDevOrigin = isDev && localhostOriginPattern.test(normalizedOrigin);

    if (isConfigured || isLocalDevOrigin) {
      return callback(null, true);
    }

    return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
  },
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const USER_SELECT = 'id,name,full_name,email,role,is_approved,profile_picture,birth_date,theme_preference,created_at';
const USER_SELECT_WITH_PASSWORD = `${USER_SELECT},password_hash`;
const MINISTRY_SELECT_BASE = 'id,name,leader_id,managers,member_count,color,image_url,is_music_ministry,functions,repertoire,created_at';
const MINISTRY_SELECT_WITH_TEAMS = `${MINISTRY_SELECT_BASE},teams`;
let supportsMinistryTeamsColumn = true;

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function isGhostUser(row) {
  return row && row.role === 'admin';
}

function normalizeBirthDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return normalized;
}

function getMonthAndDay(dateValue) {
  const normalized = normalizeBirthDate(dateValue);
  if (!normalized) return null;

  const [, monthStr, dayStr] = normalized.split('-');
  return {
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name || row.full_name,
    email: row.email,
    role: row.role,
    isApproved: row.is_approved,
    profilePicture: row.profile_picture,
    birthDate: row.birth_date,
    themePreference: row.theme_preference || 'light',
    createdAt: row.created_at,
  };
}

function mapLeader(row) {
  if (!row || isGhostUser(row)) return null;

  return {
    id: row.id,
    name: row.name || row.full_name,
    role: row.role,
    isApproved: row.is_approved,
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeFunctionNames(value) {
  if (Array.isArray(value)) {
    const normalized = normalizeStringArray(value);
    return normalized.length > 0 ? normalized : ['Membro'];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return ['Membro'];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = normalizeStringArray(parsed);
        return normalized.length > 0 ? normalized : ['Membro'];
      }
    } catch {
      // ignore
    }
  }

  return ['Membro'];
}

function functionNamesToString(value) {
  const names = normalizeFunctionNames(value);
  return names.join(', ');
}

function mapMinistryTeam(team) {
  if (!team || typeof team !== 'object') return null;

  const id = String(team.id || '').trim();
  const name = String(team.name || '').trim();
  const memberIds = normalizeStringArray(team.memberIds);

  if (!id || !name) return null;

  return {
    id,
    name,
    memberIds,
  };
}

function sanitizeMinistryTeams(value) {
  let rawValue = value;

  if (typeof rawValue === 'string') {
    try {
      rawValue = JSON.parse(rawValue);
    } catch {
      rawValue = [];
    }
  }

  if (!Array.isArray(rawValue)) return [];
  return rawValue.map(mapMinistryTeam).filter(Boolean);
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

async function requestDeezerJson(path) {
  const response = await fetch(`https://api.deezer.com${path}`);
  if (!response.ok) {
    throw new Error('Falha ao consultar Deezer API.');
  }

  const payload = await response.json();
  if (payload && payload.error) {
    const errorMessage = payload.error.message || 'Falha ao consultar Deezer API.';
    throw new Error(errorMessage);
  }

  return payload;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapDeezerTrackToSong(track) {
  if (!track || !track.id) return null;

  const title = String(track.title || '').trim() || 'nao fornecido';
  const artist = String(track.artist?.name || '').trim() || 'nao fornecido';
  const youtubeQuery = encodeURIComponent(`${title} ${artist}`);
  const bpm = normalizeNumber(track.bpm, 0);

  return {
    id: String(track.id),
    title,
    artist,
    durationSeconds: normalizeNumber(track.duration, 0),
    key: 'nao fornecido',
    bpm: bpm > 0 ? Math.round(bpm) : 0,
    lyrics: 'nao fornecido',
    chords: 'nao fornecido',
    audioUrl: null,
    youtubeUrl: `https://www.youtube.com/results?search_query=${youtubeQuery}`,
    thumbnailUrl: track.album?.cover_big || track.album?.cover_medium || track.album?.cover || null,
    deezerUrl: track.link || null,
    source: 'deezer',
    tags: [],
  };
}

function mapDeezerArtistToArtist(artist) {
  if (!artist || !artist.id) return null;

  const name = String(artist.name || '').trim() || 'nao fornecido';
  return {
    id: String(artist.id),
    name,
    pictureUrl: artist.picture_big || artist.picture_medium || artist.picture || null,
  };
}

function normalizeScheduleMembers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const entry = member;
      const memberId = String(entry.memberId || '').trim();
      const memberName = String(entry.memberName || '').trim();
      if (!memberId || !memberName) return null;
      return {
        memberId,
        memberName,
        role: String(entry.role || 'Membro').trim() || 'Membro',
      };
    })
    .filter(Boolean);
}

function normalizeScheduleAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((assignment) => {
      if (!assignment || typeof assignment !== 'object') return null;
      const entry = assignment;
      const ministryId = String(entry.ministryId || '').trim();
      if (!ministryId) return null;
      const ministryName = String(entry.ministryName || '').trim() || 'Ministerio';
      const members = normalizeScheduleMembers(entry.members);
      return {
        ministryId,
        ministryName,
        members,
      };
    })
    .filter(Boolean);
}

function normalizeScheduleSong(value) {
  if (typeof value === 'string') {
    const id = String(value || '').trim();
    if (!id) return null;
    return {
      id,
      title: 'nao fornecido',
      artist: 'nao fornecido',
      durationSeconds: 0,
      key: 'nao fornecido',
      bpm: 0,
      lyrics: 'nao fornecido',
      chords: 'nao fornecido',
      audioUrl: null,
      youtubeUrl: null,
      thumbnailUrl: null,
      deezerUrl: null,
      source: 'manual',
      tags: [],
      memberAssignment: null,
    };
  }

  if (!value || typeof value !== 'object') return null;

  const item = value;
  const id = String(item.id || '').trim();
  if (!id) return null;

  return {
    id,
    title: String(item.title || '').trim() || 'nao fornecido',
    artist: String(item.artist || '').trim() || 'nao fornecido',
    durationSeconds: normalizeNumber(item.durationSeconds, 0),
    key: String(item.key || '').trim() || 'nao fornecido',
    bpm: normalizeNumber(item.bpm, 0),
    lyrics: String(item.lyrics || '').trim() || 'nao fornecido',
    chords: String(item.chords || '').trim() || 'nao fornecido',
    audioUrl: item.audioUrl ? String(item.audioUrl) : null,
    youtubeUrl: item.youtubeUrl ? String(item.youtubeUrl) : null,
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : null,
    deezerUrl: item.deezerUrl ? String(item.deezerUrl) : null,
    source: item.source === 'deezer' ? 'deezer' : 'manual',
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    memberAssignment: item.memberAssignment || null,
  };
}

function normalizeScheduleSongs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];

  value.forEach((item) => {
    const normalized = normalizeScheduleSong(item);
    if (!normalized) return;
    if (seen.has(normalized.id)) return;
    seen.add(normalized.id);
    output.push(normalized);
  });

  return output;
}

function normalizeServiceTime(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'morning' || normalized === 'evening' || normalized === 'both') {
    return normalized;
  }
  return '';
}

function overlapsServiceTime(a, b) {
  return a === 'both' || b === 'both' || a === b;
}

async function checkScheduleConflicts(date, serviceTime, assignments, excludeScheduleId) {
  const conflicts = [];
  
  // Get existing schedules for the same date with overlapping service time
  let query = supabase
    .from('schedules')
    .select('id, service_time, assignments')
    .eq('date', date);
  
  if (excludeScheduleId) {
    query = query.neq('id', excludeScheduleId);
  }
  
  const { data: existingSchedules, error: schedulesError } = await query;
  
  if (schedulesError) {
    throw new Error(schedulesError.message);
  }
  
  // Check each assignment for conflicts
  assignments.forEach(assignment => {
    assignment.members.forEach(member => {
      existingSchedules.forEach(existingSchedule => {
        if (overlapsServiceTime(existingSchedule.service_time, serviceTime)) {
          const existingAssignments = existingSchedule.assignments || [];
          existingAssignments.forEach(existingAssignment => {
            if (existingAssignment.members.some(existingMember => existingMember.memberId === member.memberId)) {
              conflicts.push({
                memberId: member.memberId,
                memberName: member.memberName,
                conflictingScheduleId: existingSchedule.id,
                conflictingMinistry: existingAssignment.ministryName,
                conflictingServiceTime: existingSchedule.service_time,
                message: `${member.memberName} já escalado(a) em "${existingAssignment.ministryName}" neste mesmo período`
              });
            }
          });
        }
      });
    });
  });
  
  return conflicts;
}

function normalizeScheduleDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return normalized;
}

function normalizeOptionalId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeThemePreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'dark' || normalized === 'light') {
    return normalized;
  }
  return '';
}

function mapSchedule(row) {
  return {
    id: row.id,
    date: row.date,
    serviceTime: row.service_time,
    assignments: normalizeScheduleAssignments(row.assignments),
    createdByUserId: row.created_by_user_id || null,
    musicMinistryId: row.music_ministry_id || null,
    musicMinisterId: row.music_minister_id || null,
    musicMinisterName: row.music_minister_name || null,
    songs: normalizeScheduleSongs(row.songs),
  };
}

function mapStoredSong(row) {
  if (!row) return null;

  const sourceSong = row.song && typeof row.song === 'object' ? row.song : {};
  const normalized = normalizeScheduleSong({ id: row.id, ...sourceSong });
  if (!normalized) return null;
  return normalized;
}

function mapMinistry(row) {
  return {
    id: row.id,
    name: row.name,
    leaderId: row.leader_id,
    leaderName: row.leader_name || 'Lider removido',
    managers: Array.isArray(row.managers) ? row.managers : [],
    managerUsers: Array.isArray(row.manager_users) ? row.manager_users : [],
    ministers: Array.isArray(row.ministers) ? row.ministers : [],
    ministerUsers: Array.isArray(row.minister_users) ? row.minister_users : [],
    memberUserIds: Array.isArray(row.member_user_ids) ? row.member_user_ids : [],
    memberUsers: Array.isArray(row.member_users) ? row.member_users : [],
    memberCount: Number.isFinite(row.member_count) ? row.member_count : 0,
    color: row.color || '#ffffff',
    imageUrl: row.image_url || null,
    isMusicMinistry: Boolean(row.is_music_ministry),
    functions: Array.isArray(row.functions) ? row.functions : [],
    repertoire: Array.isArray(row.repertoire) ? row.repertoire : [],
    teams: sanitizeMinistryTeams(row.teams),
    createdAt: row.created_at,
  };
}

function isLeaderEligible(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'lider' && user.is_approved;
}

async function canCreateMinistry(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!(user.role === 'lider' && user.is_approved)) return false;

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


function syncTeamsWithMemberIds(teams, validMemberIds) {
  const validIds = new Set(normalizeStringArray(validMemberIds));
  return sanitizeMinistryTeams(teams)
    .map((team) => ({
      ...team,
      memberIds: team.memberIds.filter((memberId) => validIds.has(memberId)),
    }))
    .filter((team) => team.memberIds.length > 0);
}

async function getUserById(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function getAnyAdminUser() {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function getUserWithPasswordByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT_WITH_PASSWORD)
    .eq('email', String(email || '').trim().toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function getStoredRepertoireSongById(songId) {
  const { data, error } = await supabase
    .from('repertoire_songs')
    .select('id,song')
    .eq('id', songId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return mapStoredSong(data);
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
      .select('ministry_id,user_id,function_names')
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
        const functionNames = normalizeFunctionNames(membership.function_names);
        if (!membershipMap.has(ministryId)) {
          membershipMap.set(ministryId, []);
        }
        membershipMap.get(ministryId).push({ user_id: userId, function_names: functionNames });
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
      .select('id,name,full_name,role,is_approved')
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
        const functionNames = normalizeFunctionNames(membership.function_names);
        return {
          id: user.id,
          name: user.name || user.full_name,
          functionName: functionNames[0] || 'Membro',
          functionNames,
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

async function getMinistryById(ministryId) {
  const { data, error } = await runMinistryQueryWithFallback((selectFields) => (
    supabase
      .from('ministries')
      .select(selectFields)
      .eq('id', ministryId)
      .maybeSingle()
  ));

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  const enriched = await enrichMinistries([data]);
  return enriched[0] || null;
}

app.get('/health', asyncHandler(async (_req, res) => {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    throw new Error(error.message);
  }
  res.json({ ok: true, service: 'IF-back', db: 'connected', time: new Date().toISOString() });
}));

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'IF-back',
    message: 'API online. Use /health para checar status e /api/* para rotas da aplicacao.',
    endpoints: {
      health: '/health',
    },
    time: new Date().toISOString(),
  });
});

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { name, email, password, isLeader, birthDate } = req.body || {};

  if (!name || !email || !password || !birthDate) {
    return res.status(400).json({ message: 'Nome, email, senha e data de nascimento sao obrigatorios.' });
  }

  const normalizedBirthDate = normalizeBirthDate(birthDate);
  if (!normalizedBirthDate) {
    return res.status(400).json({ message: 'Data de nascimento invalida. Use o formato YYYY-MM-DD.' });
  }

  if (new Date(`${normalizedBirthDate}T00:00:00Z`) > new Date()) {
    return res.status(400).json({ message: 'Data de nascimento nao pode ser no futuro.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .limit(1);

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing && existing.length > 0) {
    return res.status(409).json({ message: 'Email ja cadastrado.' });
  }

  const role = isLeader ? 'lider' : 'membro';
  const safeName = String(name).trim();
  const passwordHash = await bcrypt.hash(String(password), 10);
  const userPayload = {
    id: randomUUID(),
    name: safeName,
    full_name: safeName,
    email: normalizedEmail,
    password_hash: passwordHash,
    birth_date: normalizedBirthDate,
    role,
    is_approved: role === 'lider' ? false : true,
  };

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert(userPayload)
    .select(USER_SELECT)
    .single();

  if (createError) {
    throw new Error(createError.message);
  }

  return res.status(201).json({ user: mapUser(created) });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e senha sao obrigatorios.' });
  }

  const user = await getUserWithPasswordByEmail(email);

  const storedPasswordHash = user ? user.password_hash : null;
  if (!user || !storedPasswordHash) {
    return res.status(401).json({ message: 'Credenciais invalidas.' });
  }

  const isPasswordValid = await bcrypt.compare(String(password), storedPasswordHash);
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Credenciais invalidas.' });
  }

  return res.json({ user: mapUser(user) });
}));

app.get('/api/users', asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .neq('role', 'admin')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ users: (data || []).map(mapUser) });
}));

app.get('/api/users/birthdays', asyncHandler(async (req, res) => {
  const defaultMonth = new Date().getMonth() + 1;
  const month = Number(req.query.month || defaultMonth);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ message: 'Mes invalido. Use um valor entre 1 e 12.' });
  }

  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .neq('role', 'admin')
    .not('birth_date', 'is', null);

  if (error) {
    throw new Error(error.message);
  }

  const users = (data || [])
    .filter((row) => {
      const parsed = getMonthAndDay(row.birth_date);
      return parsed && parsed.month === month;
    })
    .sort((a, b) => {
      const aDate = getMonthAndDay(a.birth_date);
      const bDate = getMonthAndDay(b.birth_date);
      if (!aDate || !bDate) return 0;
      if (aDate.day !== bDate.day) return aDate.day - bDate.day;
      return String(a.name || a.full_name || '').localeCompare(String(b.name || b.full_name || ''), 'pt-BR');
    })
    .map(mapUser);

  return res.json({ month, users });
}));

app.get('/api/users/leaders', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const excludeUserId = String(req.query.excludeUserId || '').trim();

  let leaderQuery = supabase
    .from('users')
    .select(USER_SELECT)
    .neq('role', 'admin')
    .order('name', { ascending: true });

  if (search) {
    const pattern = `%${search}%`;
    leaderQuery = leaderQuery.or(`name.ilike.${pattern},full_name.ilike.${pattern},email.ilike.${pattern}`);
  }

  if (excludeUserId) {
    leaderQuery = leaderQuery.neq('id', excludeUserId);
  }

  const { data, error } = await leaderQuery;

  if (error) {
    throw new Error(error.message);
  }

  const leaders = (data || [])
    .map(mapUser)
    .filter((candidate) => candidate.role === 'membro' || (candidate.role === 'lider' && candidate.isApproved));

  return res.json({ users: leaders });
}));

app.patch('/api/users/:id/profile', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, profilePicture, themePreference } = req.body || {};

  const payload = {};

  if (typeof name === 'string' && name.trim()) {
    payload.name = name.trim();
    payload.full_name = name.trim();
  }

  if (typeof profilePicture === 'string') {
    payload.profile_picture = profilePicture;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'themePreference')) {
    const normalizedTheme = normalizeThemePreference(themePreference);
    if (!normalizedTheme) {
      return res.status(400).json({ message: 'Tema invalido. Use "light" ou "dark".' });
    }
    payload.theme_preference = normalizedTheme;
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Usuario nao encontrado.' });
  }

  return res.json({ user: mapUser(data) });
}));

app.patch('/api/users/:id/role', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body || {};

  if (!['admin', 'lider', 'membro'].includes(role)) {
    return res.status(400).json({ message: 'Cargo invalido.' });
  }

  const payload = { role };
  if (role !== 'lider') {
    payload.is_approved = true;
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Usuario nao encontrado.' });
  }

  return res.json({ user: mapUser(data) });
}));

app.post('/api/users/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('users')
    .update({ is_approved: true })
    .eq('id', id)
    .eq('role', 'lider')
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Lider nao encontrado.' });
  }

  return res.json({ user: mapUser(data) });
}));

app.delete('/api/users/:id/reject', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Usuario nao encontrado.' });
  }

  return res.status(204).send();
}));

app.get('/api/ministries', asyncHandler(async (_req, res) => {
  const { data, error } = await runMinistryQueryWithFallback((selectFields) => (
    supabase
      .from('ministries')
      .select(selectFields)
      .order('created_at', { ascending: false })
  ));

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries(data || []);
  return res.json({ ministries: enriched.map(mapMinistry) });
}));

app.get('/api/ministries/created-by/:leaderId', asyncHandler(async (req, res) => {
  const { leaderId } = req.params;

  const { data, error } = await runMinistryQueryWithFallback((selectFields) => (
    supabase
      .from('ministries')
      .select(selectFields)
      .eq('leader_id', leaderId)
      .order('created_at', { ascending: false })
  ));

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries(data || []);
  return res.json({ ministries: enriched.map(mapMinistry) });
}));

app.get('/api/ministries/:id', asyncHandler(async (req, res) => {
  const ministry = await getMinistryById(req.params.id);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  return res.json({ ministry: mapMinistry(ministry) });
}));

app.get('/api/ministries/:id/repertoire', asyncHandler(async (req, res) => {
  const ministry = await getMinistryById(req.params.id);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  return res.json({ songs: Array.isArray(ministry.repertoire) ? ministry.repertoire : [] });
}));

app.post('/api/ministries/:id/repertoire', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, song, songs } = req.body || {};

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const normalizedSongs = normalizeScheduleSongs(Array.isArray(songs) ? songs : (song ? [song] : []));
  if (normalizedSongs.length === 0) {
    return res.status(400).json({ message: 'Informe ao menos uma musica valida.' });
  }

  const songRows = normalizedSongs.map((item) => ({
    id: item.id,
    song: item,
    updated_at: new Date().toISOString(),
  }));

  const { error: songUpsertError } = await supabase
    .from('repertoire_songs')
    .upsert(songRows, { onConflict: 'id' });

  if (songUpsertError) {
    throw new Error(songUpsertError.message);
  }

  const linkRows = normalizedSongs.map((item) => ({
    ministry_id: id,
    song_id: item.id,
  }));

  const { error: linkError } = await supabase
    .from('ministry_repertoire')
    .upsert(linkRows, { onConflict: 'ministry_id,song_id' });

  if (linkError) {
    throw new Error(linkError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(201).json({ ministry: mapMinistry(updated), songs: updated?.repertoire || [] });
}));

app.delete('/api/ministries/:id/repertoire/:songId', asyncHandler(async (req, res) => {
  const { id, songId } = req.params;
  const actorId = req.body?.actorId || req.query.actorId;

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  // Remove the song from ministry_repertoire table
  const { error: linkError } = await supabase
    .from('ministry_repertoire')
    .delete()
    .eq('ministry_id', id)
    .eq('song_id', songId);

  if (linkError) {
    throw new Error(linkError.message);
  }

  const updated = await getMinistryById(id);
  return res.json({ ministry: mapMinistry(updated) });
}));

app.patch('/api/music/tracks/:id', asyncHandler(async (req, res) => {
  const songId = String(req.params.id || '').trim();
  if (!songId) {
    return res.status(400).json({ message: 'ID da musica e obrigatorio.' });
  }

  const existing = await getStoredRepertoireSongById(songId);
  const normalized = normalizeScheduleSong({ id: songId, ...(existing || {}), ...(req.body || {}) });
  if (!normalized) {
    return res.status(400).json({ message: 'Musica invalida.' });
  }

  const { error } = await supabase
    .from('repertoire_songs')
    .upsert({
      id: songId,
      song: normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ song: normalized });
}));

app.get('/api/music/search', asyncHandler(async (req, res) => {
  const query = String(req.query.query || '').trim();
  const limit = Math.min(50, Math.max(1, normalizeNumber(req.query.limit, 15)));
  const index = Math.max(0, normalizeNumber(req.query.index, 0));

  if (query.length < 2) {
    return res.json({ songs: [], total: 0, nextIndex: null });
  }

  const deezerPayload = await requestDeezerJson(`/search?q=${encodeURIComponent(query)}&limit=${limit}&index=${index}`);
  const songs = (deezerPayload.data || []).map(mapDeezerTrackToSong).filter(Boolean);

  let nextIndex = null;
  if (typeof deezerPayload.next === 'string' && deezerPayload.next.includes('index=')) {
    try {
      const nextUrl = new URL(deezerPayload.next);
      const parsed = Number(nextUrl.searchParams.get('index'));
      if (Number.isFinite(parsed)) {
        nextIndex = parsed;
      }
    } catch {
      nextIndex = null;
    }
  }

  return res.json({
    songs,
    total: normalizeNumber(deezerPayload.total, songs.length),
    nextIndex,
  });
}));

app.get('/api/music/tracks/:id', asyncHandler(async (req, res) => {
  const trackId = String(req.params.id || '').trim();
  if (!trackId) {
    return res.status(400).json({ message: 'ID da musica e obrigatorio.' });
  }

  const storedSong = await getStoredRepertoireSongById(trackId);
  if (storedSong) {
    return res.json({ song: storedSong });
  }

  const deezerTrack = await requestDeezerJson(`/track/${encodeURIComponent(trackId)}`);
  const song = mapDeezerTrackToSong(deezerTrack);

  if (!song) {
    return res.status(404).json({ message: 'Musica nao encontrada na Deezer.' });
  }

  return res.json({ song });
}));

app.get('/api/music/artists/search', asyncHandler(async (req, res) => {
  const query = String(req.query.query || '').trim();
  const limit = Math.min(50, Math.max(1, normalizeNumber(req.query.limit, 15)));
  const index = Math.max(0, normalizeNumber(req.query.index, 0));

  if (query.length < 2) {
    return res.json({ artists: [], total: 0, nextIndex: null });
  }

  const payload = await requestDeezerJson(`/search/artist?q=${encodeURIComponent(query)}&limit=${limit}&index=${index}`);
  const artists = (payload.data || []).map(mapDeezerArtistToArtist).filter(Boolean);

  let nextIndex = null;
  if (typeof payload.next === 'string' && payload.next.includes('index=')) {
    try {
      const nextUrl = new URL(payload.next);
      const parsed = Number(nextUrl.searchParams.get('index'));
      if (Number.isFinite(parsed)) {
        nextIndex = parsed;
      }
    } catch {
      nextIndex = null;
    }
  }

  return res.json({
    artists,
    total: normalizeNumber(payload.total, artists.length),
    nextIndex,
  });
}));

app.get('/api/music/artists/:id/tracks', asyncHandler(async (req, res) => {
  const artistId = String(req.params.id || '').trim();
  const limit = Math.min(500, Math.max(1, normalizeNumber(req.query.limit, 200)));

  if (!artistId) {
    return res.status(400).json({ message: 'ID do artista e obrigatorio.' });
  }

  const payload = await requestDeezerJson(`/artist/${encodeURIComponent(artistId)}/top?limit=${limit}`);
  const songs = (payload.data || []).map(mapDeezerTrackToSong).filter(Boolean);

  return res.json({ songs });
}));

app.get('/api/schedules', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ schedules: (data || []).map(mapSchedule) });
}));

app.post('/api/schedules', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const normalizedDate = normalizeScheduleDate(body.date);
  const normalizedServiceTime = normalizeServiceTime(body.serviceTime);

  if (!normalizedDate) {
    return res.status(400).json({ message: 'Data invalida.' });
  }

  if (!normalizedServiceTime) {
    return res.status(400).json({ message: 'Horario do culto invalido.' });
  }

  // Check for conflicts before creating schedule
  const assignments = normalizeScheduleAssignments(body.assignments);
  if (assignments && assignments.length > 0) {
    const conflicts = await checkScheduleConflicts(normalizedDate, normalizedServiceTime, assignments, null);
    if (conflicts.length > 0) {
      return res.status(409).json({ 
        message: 'Conflito de escalonamento detectado', 
        conflicts: conflicts 
      });
    }
  }

  const payload = {
    date: normalizedDate,
    service_time: normalizedServiceTime,
    assignments: assignments,
    songs: normalizeScheduleSongs(body.songs),
    created_by_user_id: normalizeOptionalId(body.createdByUserId),
    music_ministry_id: normalizeOptionalId(body.musicMinistryId),
    music_minister_id: normalizeOptionalId(body.musicMinisterId),
    music_minister_name: normalizeOptionalText(body.musicMinisterName),
  };

  const { data, error } = await supabase
    .from('schedules')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return res.status(201).json({ schedule: mapSchedule(data) });
}));

app.patch('/api/schedules/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ message: 'ID da escala e obrigatorio.' });
  }

  const body = req.body || {};
  const payload = {};

  // Get current schedule for comparison
  const { data: currentSchedule, error: fetchError } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) {
    return res.status(404).json({ message: 'Escala nao encontrada.' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'date')) {
    const normalizedDate = normalizeScheduleDate(body.date);
    if (!normalizedDate) {
      return res.status(400).json({ message: 'Data invalida.' });
    }
    payload.date = normalizedDate;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'serviceTime')) {
    const normalizedServiceTime = normalizeServiceTime(body.serviceTime);
    if (!normalizedServiceTime) {
      return res.status(400).json({ message: 'Horario do culto invalido.' });
    }
    payload.service_time = normalizedServiceTime;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assignments')) {
    payload.assignments = normalizeScheduleAssignments(body.assignments);
    
    // Check for conflicts with updated assignments
    const checkDate = payload.date || currentSchedule.date;
    const checkServiceTime = payload.service_time || currentSchedule.service_time;
    
    const conflicts = await checkScheduleConflicts(checkDate, checkServiceTime, payload.assignments, id);
    if (conflicts.length > 0) {
      return res.status(409).json({ 
        message: 'Conflito de escalonamento detectado', 
        conflicts: conflicts 
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'songs')) {
    payload.songs = normalizeScheduleSongs(body.songs);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'createdByUserId')) {
    payload.created_by_user_id = normalizeOptionalId(body.createdByUserId);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'musicMinistryId')) {
    payload.music_ministry_id = normalizeOptionalId(body.musicMinistryId);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'musicMinisterId')) {
    payload.music_minister_id = normalizeOptionalId(body.musicMinisterId);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'musicMinisterName')) {
    payload.music_minister_name = normalizeOptionalText(body.musicMinisterName);
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'Nenhuma alteracao enviada.' });
  }

  const { data, error } = await supabase
    .from('schedules')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Escala nao encontrada.' });
  }

  return res.json({ schedule: mapSchedule(data) });
}));

app.delete('/api/schedules/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ message: 'ID da escala e obrigatorio.' });
  }

  const { data, error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Escala nao encontrada.' });
  }

  return res.status(204).send();
}));

app.get('/api/schedules/minister/:ministerId', asyncHandler(async (req, res) => {
  const ministerId = String(req.params.ministerId || '').trim();
  if (!ministerId) {
    return res.status(400).json({ message: 'ID do ministro e obrigatorio.' });
  }

  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('music_minister_id', ministerId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ schedules: (data || []).map(mapSchedule) });
}));

app.patch('/api/schedules/:id/songs', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const { songs } = req.body || {};

  if (!id) {
    return res.status(400).json({ message: 'ID da escala e obrigatorio.' });
  }

  if (!Array.isArray(songs)) {
    return res.status(400).json({ message: 'Songs deve ser um array.' });
  }

  const normalizedSongs = normalizeScheduleSongs(songs);

  const { data, error } = await supabase
    .from('schedules')
    .update({ songs: normalizedSongs })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return res.status(404).json({ message: 'Escala nao encontrada.' });
  }

  return res.json({ schedule: mapSchedule(data) });
}));

app.post('/api/ministries', asyncHandler(async (req, res) => {
  const { name, color, isMusicMinistry, leaderId, actorId } = req.body || {};

  if (!name) {
    return res.status(400).json({ message: 'Nome e obrigatorio.' });
  }

  const effectiveActorId = actorId || leaderId;
  let actor = effectiveActorId ? await getUserById(effectiveActorId) : null;
  let leader = leaderId ? await getUserById(leaderId) : null;

  if (!actor && !leader) {
    const fallbackAdmin = await getAnyAdminUser();
    if (fallbackAdmin) {
      actor = fallbackAdmin;
      leader = fallbackAdmin;
    }
  }

  if (!actor && leader) {
    actor = leader;
  }

  if (!actor) {
    return res.status(404).json({ message: 'Usuario responsavel nao encontrado.' });
  }

  if (!(await canCreateMinistry(actor))) {
    return res.status(403).json({ message: 'Usuario sem permissao para criar ministerio.' });
  }

  if (!leader) {
    leader = actor.role === 'admin' ? actor : null;
  }

  if (!leader) {
    return res.status(404).json({ message: 'Lider nao encontrado.' });
  }

  if (!isLeaderEligible(leader)) {
    if (actor.role === 'admin') {
      leader = actor;
    } else {
      return res.status(403).json({ message: 'Usuario sem permissao para criar ministerio.' });
    }
  }

  const payload = {
    id: randomUUID(),
    name: String(name).trim(),
    leader_id: leader.id,
    managers: [],
    member_count: 0,
    color: color || '#ffffff',
    image_url: null,
    functions: [],
    is_music_ministry: Boolean(isMusicMinistry),
  };

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

  const { data: created, error } = createResponse;

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries([created]);
  return res.status(201).json({ ministry: mapMinistry(enriched[0]) });
}));

app.patch('/api/ministries/:id/profile', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, name, color } = req.body || {};

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const payload = {};
  if (typeof name === 'string' && name.trim()) {
    payload.name = name.trim();
  }
  if (typeof color === 'string' && color.trim()) {
    payload.color = color.trim();
  }

  const { error } = await supabase
    .from('ministries')
    .update(payload)
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));



app.patch('/api/ministries/:id/ministers', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, ministerIds } = req.body || {};

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  if (!Array.isArray(ministerIds)) {
    return res.status(400).json({ message: 'ministerIds precisa ser uma lista.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const uniqueMinisterIds = [...new Set(ministerIds.filter(Boolean))];

  // Sync with junction table
  await supabase
    .from('ministry_ministers')
    .delete()
    .eq('ministry_id', id);

  if (uniqueMinisterIds.length > 0) {
    const ministerRows = uniqueMinisterIds.map(userId => ({
      ministry_id: id,
      user_id: userId
    }));
    
    const { error: insertError } = await supabase
      .from('ministry_ministers')
      .insert(ministerRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.patch('/api/ministries/:id/leaders', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, leaderIds } = req.body || {};

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  if (!Array.isArray(leaderIds)) {
    return res.status(400).json({ message: 'leaderIds precisa ser uma lista.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const uniqueLeaderIds = [...new Set(leaderIds.filter(Boolean))].filter((leaderId) => leaderId !== ministry.leader_id);

  if (uniqueLeaderIds.length > 0) {
    const { data: candidates, error: candidateError } = await supabase
      .from('users')
      .select(USER_SELECT)
      .in('id', uniqueLeaderIds);

    if (candidateError) {
      throw new Error(candidateError.message);
    }

    const validIds = new Set(
      (candidates || [])
        .filter((item) => item.role === 'membro' || (item.role === 'lider' && item.is_approved))
        .map((item) => item.id)
    );
    const invalid = uniqueLeaderIds.filter((candidateId) => !validIds.has(candidateId));

    if (invalid.length > 0) {
      return res.status(400).json({ message: 'Alguns administradores informados sao invalidos.' });
    }
  }

  // 1. Update the legacy managers column
  await supabase
    .from('ministries')
    .update({ managers: uniqueLeaderIds })
    .eq('id', id);

  // 2. Sync with ministry_admins table
  await supabase
    .from('ministry_admins')
    .delete()
    .eq('ministry_id', id);

  if (uniqueLeaderIds.length > 0) {
    const adminRows = uniqueLeaderIds.map(userId => ({
      ministry_id: id,
      user_id: userId
    }));
    
    const { error: insertError } = await supabase
      .from('ministry_admins')
      .insert(adminRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.patch('/api/ministries/:id/members', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, memberIds } = req.body || {};

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  if (!Array.isArray(memberIds)) {
    return res.status(400).json({ message: 'memberIds precisa ser uma lista.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !canManageMinistry(actor, ministry)) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))];

  if (uniqueMemberIds.length > 0) {
    const { data: existingUsers, error: existingUsersError } = await supabase
      .from('users')
      .select('id,role')
      .in('id', uniqueMemberIds);

    if (existingUsersError) {
      throw new Error(existingUsersError.message);
    }

    const validIds = new Set((existingUsers || []).filter((item) => item.role !== 'admin').map((item) => item.id));
    if (uniqueMemberIds.some((memberId) => !validIds.has(memberId))) {
      return res.status(400).json({ message: 'Alguns membros informados sao invalidos.' });
    }
  }

  const { error: deleteError } = await supabase
    .from('ministry_members')
    .delete()
    .eq('ministry_id', id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (uniqueMemberIds.length > 0) {
    const membershipRows = uniqueMemberIds.map((memberId) => ({
      ministry_id: id,
      user_id: memberId,
      function_name: 'Membro',
    }));

    const { error: insertError } = await supabase
      .from('ministry_members')
      .insert(membershipRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const ministryAfterMembers = await getMinistryById(id);
  const syncedTeams = syncTeamsWithMemberIds(
    ministryAfterMembers?.teams,
    ministryAfterMembers?.member_user_ids || []
  );

  if (JSON.stringify(syncedTeams) !== JSON.stringify(sanitizeMinistryTeams(ministryAfterMembers?.teams))) {
    await updateMinistryTeamsSafely(id, syncedTeams);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.post('/api/ministries/:id/members/link', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, userId, functionName } = req.body || {};

  if (!actorId || !userId || !functionName) {
    return res.status(400).json({ message: 'actorId, userId e functionName sao obrigatorios.' });
  }

  const normalizedFunction = String(functionName).trim();
  if (!normalizedFunction) {
    return res.status(400).json({ message: 'A funcao do membro e obrigatoria.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);
  const memberUser = await getUserById(userId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  if (!memberUser || memberUser.role === 'admin') {
    return res.status(400).json({ message: 'Membro informado e invalido.' });
  }

  const ministryBeforeUpdate = await getMinistryById(id);
  const existingMember = (ministryBeforeUpdate?.memberUsers || []).find((item) => item.id === userId);
  const existingFunctions = existingMember ? normalizeFunctionNames(existingMember.functionNames || existingMember.functionName) : [];
  const nextFunctions = [...new Set([...existingFunctions, normalizedFunction])];

  const { error: upsertError } = await supabase
    .from('ministry_members')
    .upsert({
      ministry_id: id,
      user_id: userId,
      function_name: nextFunctions[0] || normalizedFunction,
      function_names: nextFunctions,
    }, { onConflict: 'ministry_id,user_id' });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

app.delete('/api/ministries/:id/members/:userId', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const actorId = req.body?.actorId || req.query.actorId;

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const { error: deleteError } = await supabase
    .from('ministry_members')
    .delete()
    .eq('ministry_id', id)
    .eq('user_id', userId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const ministryAfterDelete = await getMinistryById(id);
  const syncedTeams = syncTeamsWithMemberIds(
    ministryAfterDelete?.teams,
    ministryAfterDelete?.member_user_ids || []
  );

  if (JSON.stringify(syncedTeams) !== JSON.stringify(sanitizeMinistryTeams(ministryAfterDelete?.teams))) {
    await updateMinistryTeamsSafely(id, syncedTeams);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.post('/api/ministries/:id/teams', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId, name, memberIds } = req.body || {};

  if (!actorId || !name || !Array.isArray(memberIds)) {
    return res.status(400).json({ message: 'actorId, name e memberIds sao obrigatorios.' });
  }

  const teamName = String(name).trim();
  if (!teamName) {
    return res.status(400).json({ message: 'Nome da equipe e obrigatorio.' });
  }

  const uniqueMemberIds = normalizeStringArray(memberIds);
  if (uniqueMemberIds.length === 0) {
    return res.status(400).json({ message: 'Selecione ao menos um membro para a equipe.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  if (!supportsMinistryTeamsColumn) {
    return res.status(412).json({
      message: 'Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.',
    });
  }

  const allowedMemberIds = new Set(normalizeStringArray(ministry.member_user_ids));
  if (uniqueMemberIds.some((memberId) => !allowedMemberIds.has(memberId))) {
    return res.status(400).json({ message: 'A equipe deve conter apenas membros vinculados ao ministerio.' });
  }

  const currentTeams = sanitizeMinistryTeams(ministry.teams);
  if (currentTeams.some((team) => team.name.toLowerCase() === teamName.toLowerCase())) {
    return res.status(409).json({ message: 'Ja existe uma equipe com esse nome neste ministerio.' });
  }

  const nextTeams = [...currentTeams, {
    id: randomUUID(),
    name: teamName,
    memberIds: uniqueMemberIds,
  }];

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ teams: nextTeams })
    .eq('id', id);

  if (isMissingMinistryTeamsColumnError(updateError)) {
    supportsMinistryTeamsColumn = false;
    return res.status(412).json({
      message: 'Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.',
    });
  }

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

app.delete('/api/ministries/:id/teams/:teamId', asyncHandler(async (req, res) => {
  const { id, teamId } = req.params;
  const actorId = String(req.query.actorId || '');

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  if (!supportsMinistryTeamsColumn) {
    return res.status(412).json({
      message: 'Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.',
    });
  }

  const currentTeams = sanitizeMinistryTeams(ministry.teams);
  const nextTeams = currentTeams.filter((team) => team.id !== teamId);

  if (nextTeams.length === currentTeams.length) {
    return res.status(404).json({ message: 'Equipe nao encontrada.' });
  }

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ teams: nextTeams })
    .eq('id', id);

  if (isMissingMinistryTeamsColumnError(updateError)) {
    supportsMinistryTeamsColumn = false;
    return res.status(412).json({
      message: 'Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.',
    });
  }

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.post('/api/ministries/:id/functions', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, emoji, actorId } = req.body || {};

  if (!name || !emoji || !actorId) {
    return res.status(400).json({ message: 'Nome, emoji e actorId sao obrigatorios.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const currentFunctions = Array.isArray(ministry.functions) ? [...ministry.functions] : [];
  const roleName = String(name).trim();

  if (currentFunctions.some((item) => String(item.name || '').toLowerCase() === roleName.toLowerCase())) {
    return res.status(409).json({ message: 'Ja existe uma funcao com esse nome.' });
  }

  currentFunctions.push({ id: randomUUID(), name: roleName, emoji: String(emoji).trim() });

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ functions: currentFunctions })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

app.delete('/api/ministries/:id/functions/:functionId', asyncHandler(async (req, res) => {
  const { id, functionId } = req.params;
  const actorId = String(req.query.actorId || '');

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const currentFunctions = Array.isArray(ministry.functions) ? [...ministry.functions] : [];
  const nextFunctions = currentFunctions.filter((item) => item.id !== functionId);

  if (nextFunctions.length === currentFunctions.length) {
    return res.status(404).json({ message: 'Funcao nao encontrada.' });
  }

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ functions: nextFunctions })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.delete('/api/ministries/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const actorId = String(req.query.actorId || '');

  if (!actorId) {
    return res.status(400).json({ message: 'actorId e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor) {
    return res.status(403).json({ message: 'Sem permissao para excluir este ministerio.' });
  }

  // Allow admin or ministry leader to delete
  if (actor.role !== 'admin' && ministry.leaderId !== actor.id) {
    return res.status(403).json({ message: 'Apenas admins ou o lider do ministerio podem excluir.' });
  }

  const { error: deleteError } = await supabase
    .from('ministries')
    .delete()
    .eq('id', id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return res.status(200).json({ message: 'Ministerio excluido com sucesso.' });
}));

app.post('/api/ministries/:id/image', upload.single('image'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actorId } = req.body || {};

  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo de imagem e obrigatorio.' });
  }

  const ministry = await getMinistryById(id);
  const actor = await getUserById(actorId);

  if (!ministry) {
    return res.status(404).json({ message: 'Ministerio nao encontrado.' });
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    return res.status(403).json({ message: 'Sem permissao para editar este ministerio.' });
  }

  const mime = req.file.mimetype || 'application/octet-stream';
  const dataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ image_url: dataUrl })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: 'Erro no upload da imagem.' });
  }

  console.error(err);
  return res.status(500).json({ message: err.message || 'Erro interno no servidor.' });
});

async function bootstrap() {
  await initConnection();

  app.listen(PORT, () => {
    console.log(`IF-back API rodando na porta ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar servidor:', error.message);
  process.exit(1);
});
