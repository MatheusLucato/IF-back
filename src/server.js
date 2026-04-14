require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { randomUUID } = require('crypto');
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

const USER_SELECT = 'id,name,full_name,email,role,is_approved,profile_picture,birth_date,created_at';
const USER_SELECT_WITH_PASSWORD = `${USER_SELECT},password,password_hash`;
const MINISTRY_SELECT = 'id,name,leader_id,managers,member_count,color,image_url,functions,created_at';

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

function mapMinistry(row) {
  return {
    id: row.id,
    name: row.name,
    leaderId: row.leader_id,
    leaderName: row.leader_name || 'Lider removido',
    managers: Array.isArray(row.managers) ? row.managers : [],
    managerUsers: Array.isArray(row.manager_users) ? row.manager_users : [],
    memberUserIds: Array.isArray(row.member_user_ids) ? row.member_user_ids : [],
    memberCount: Number.isFinite(row.member_count) ? row.member_count : 0,
    color: row.color || '#ffffff',
    imageUrl: row.image_url || null,
    functions: Array.isArray(row.functions) ? row.functions : [],
    createdAt: row.created_at,
  };
}

function isLeaderEligible(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'lider' && user.is_approved;
}

function canCreateMinistry(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'lider' && user.is_approved;
}

function canManageMinistry(actor, ministry) {
  if (!actor || !ministry) return false;
  if (actor.role === 'admin') return true;
  if (ministry.leader_id === actor.id) return true;
  const managers = Array.isArray(ministry.managers) ? ministry.managers : [];
  return managers.includes(actor.id);
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

async function enrichMinistries(rows) {
  const ministryIds = [...new Set((rows || []).map((row) => row.id).filter(Boolean))];
  const leaderIds = [...new Set((rows || []).map((row) => row.leader_id).filter(Boolean))];
  const managerIds = [...new Set(
    (rows || [])
      .flatMap((row) => (Array.isArray(row.managers) ? row.managers : []))
      .filter(Boolean)
  )];
  const membershipMap = new Map();

  if (ministryIds.length > 0) {
    const { data: memberships, error: membershipError } = await supabase
      .from('ministry_members')
      .select('ministry_id,user_id')
      .in('ministry_id', ministryIds);

    if (membershipError && membershipError.code !== '42P01') {
      throw new Error(membershipError.message);
    }

    if (!membershipError) {
      for (const membership of memberships || []) {
        const ministryId = membership.ministry_id;
        const userId = membership.user_id;
        if (!membershipMap.has(ministryId)) {
          membershipMap.set(ministryId, new Set());
        }
        membershipMap.get(ministryId).add(userId);
      }
    }
  }

  const userIds = [...new Set([...leaderIds, ...managerIds])];

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
    const managers = Array.isArray(row.managers) ? row.managers : [];
    const managerUsers = managers
      .map((managerId) => userMap.get(managerId))
      .map(mapLeader)
      .filter(Boolean);
    const memberUserIds = Array.from(membershipMap.get(row.id) || []);

    const leader = userMap.get(row.leader_id);
    const leaderName = leader && !isGhostUser(leader)
      ? (leader.name || leader.full_name || 'Lider removido')
      : 'Lider oculto';

    return {
      ...row,
      leader_name: leaderName,
      manager_users: managerUsers,
      member_user_ids: memberUserIds,
      member_count: memberUserIds.length,
    };
  });
}

async function getMinistryById(ministryId) {
  const { data, error } = await supabase
    .from('ministries')
    .select(MINISTRY_SELECT)
    .eq('id', ministryId)
    .maybeSingle();

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
  const userPayload = {
    id: randomUUID(),
    name: safeName,
    full_name: safeName,
    email: normalizedEmail,
    password: String(password),
    password_hash: String(password),
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

  const storedPassword = user ? (user.password || user.password_hash) : null;
  if (!user || storedPassword !== String(password)) {
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

  let leaderQuery = supabase
    .from('users')
    .select(USER_SELECT)
    .eq('role', 'lider')
    .eq('is_approved', true)
    .order('name', { ascending: true });

  if (search) {
    const pattern = `%${search}%`;
    leaderQuery = leaderQuery.or(`name.ilike.${pattern},full_name.ilike.${pattern},email.ilike.${pattern}`);
  }

  const { data, error } = await leaderQuery;

  if (error) {
    throw new Error(error.message);
  }

  const leaders = (data || []).map(mapUser);

  return res.json({ users: leaders });
}));

app.patch('/api/users/:id/profile', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, profilePicture } = req.body || {};

  const payload = {};

  if (typeof name === 'string' && name.trim()) {
    payload.name = name.trim();
    payload.full_name = name.trim();
  }

  if (typeof profilePicture === 'string') {
    payload.profile_picture = profilePicture;
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
  const { data, error } = await supabase
    .from('ministries')
    .select(MINISTRY_SELECT)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries(data || []);
  return res.json({ ministries: enriched.map(mapMinistry) });
}));

app.get('/api/ministries/created-by/:leaderId', asyncHandler(async (req, res) => {
  const { leaderId } = req.params;

  const { data, error } = await supabase
    .from('ministries')
    .select(MINISTRY_SELECT)
    .eq('leader_id', leaderId)
    .order('created_at', { ascending: false });

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

app.post('/api/ministries', asyncHandler(async (req, res) => {
  const { name, color, leaderId, actorId } = req.body || {};

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

  if (!canCreateMinistry(actor)) {
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
  };

  const { data: created, error } = await supabase
    .from('ministries')
    .insert(payload)
    .select(MINISTRY_SELECT)
    .single();

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

  if (!actor || !canManageMinistry(actor, ministry)) {
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

  if (!actor || !canManageMinistry(actor, ministry)) {
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

    const validIds = new Set((candidates || []).filter(isLeaderEligible).map((item) => item.id));
    const invalid = uniqueLeaderIds.filter((candidateId) => !validIds.has(candidateId));

    if (invalid.length > 0) {
      return res.status(400).json({ message: 'Alguns lideres informados sao invalidos.' });
    }
  }

  const { error } = await supabase
    .from('ministries')
    .update({ managers: uniqueLeaderIds })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
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
      .select('id')
      .in('id', uniqueMemberIds);

    if (existingUsersError) {
      throw new Error(existingUsersError.message);
    }

    const validIds = new Set((existingUsers || []).map((item) => item.id));
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
    }));

    const { error: insertError } = await supabase
      .from('ministry_members')
      .insert(membershipRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
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

  if (!actor || !canManageMinistry(actor, ministry)) {
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

  if (!actor || !canManageMinistry(actor, ministry)) {
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

  if (!actor || !canManageMinistry(actor, ministry)) {
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
