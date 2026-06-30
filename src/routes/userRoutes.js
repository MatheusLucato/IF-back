const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const {
  updateUserProfileSchema,
  updateUserRoleSchema,
  addUnavailableDateSchema,
} = require('../schemas/userSchemas');
const { USER_SELECT } = require('../lib/constants');
const { mapUser } = require('../lib/mappers');
const { getMonthAndDay, normalizeThemePreference } = require('../lib/normalizers');
const { getUserById } = require('../services/userService');
const { uploadAsset } = require('../services/storage');
const { upload } = require('../middleware/upload');
const { recordAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

const router = express.Router();
const supabase = getSupabase();

router.get('/users', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq('church_id', req.churchId)
    .neq('role', 'admin')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ users: (data || []).map(mapUser) });
}));

router.get('/users/birthdays', asyncHandler(async (req, res) => {
  const defaultMonth = new Date().getMonth() + 1;
  const month = Number(req.query.month || defaultMonth);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw AppError.badRequest('Mes invalido. Use um valor entre 1 e 12.');
  }

  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq('church_id', req.churchId)
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

router.get('/users/leaders', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const excludeUserId = String(req.query.excludeUserId || '').trim();

  let leaderQuery = supabase
    .from('users')
    .select(USER_SELECT)
    .eq('church_id', req.churchId)
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

router.patch('/users/:id/profile', validate(updateUserProfileSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, profilePicture, themePreference } = req.body;

  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw AppError.forbidden('Sem permissao para editar este perfil.');
  }

  const payload = {};

  if (typeof name === 'string' && name.trim()) {
    payload.name = name.trim();
    payload.full_name = name.trim();
  }

  if (typeof profilePicture === 'string') {
    payload.profile_picture = profilePicture;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'themePreference')) {
    // zod ja restringe a 'light'|'dark'; normalizeThemePreference reaproveita o saneamento.
    payload.theme_preference = normalizeThemePreference(themePreference);
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .eq('church_id', req.churchId)
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Usuario nao encontrado.');
  }

  return res.json({ user: mapUser(data) });
}));

// Upload da foto de perfil → Cloudflare R2 (com fallback para data URL).
// Devolve { url } para o frontend persistir via PATCH /api/users/:id/profile.
router.post('/users/:id/avatar', upload.single('file'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw AppError.forbidden('Sem permissao para editar este perfil.');
  }
  if (!req.file) {
    throw AppError.badRequest('Arquivo e obrigatorio.');
  }

  const mime = req.file.mimetype || 'application/octet-stream';
  const { url } = await uploadAsset({
    buffer: req.file.buffer,
    mime,
    churchId: req.churchId,
    category: `avatars/${id}`,
  });
  return res.json({ url });
}));

router.patch('/users/:id/role', validate(updateUserRoleSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador pode alterar cargos.');
  }

  // Estado anterior para o diff de auditoria (mudanca de papel e acao sensivel).
  const previous = await getUserById(id, req.churchId);

  const payload = { role };
  if (role !== 'lider') {
    payload.is_approved = true;
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .eq('church_id', req.churchId)
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Usuario nao encontrado.');
  }

  await recordAudit(req, {
    action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
    entity: AUDIT_ENTITIES.USER,
    entityId: id,
    before: { role: previous ? previous.role : null, isApproved: previous ? previous.is_approved : null },
    after: { role: data.role, isApproved: data.is_approved },
  });

  return res.json({ user: mapUser(data) });
}));

router.post('/users/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador pode aprovar lideres.');
  }

  const { data, error } = await supabase
    .from('users')
    .update({ is_approved: true })
    .eq('id', id)
    .eq('church_id', req.churchId)
    .eq('role', 'lider')
    .select(USER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Lider nao encontrado.');
  }

  await recordAudit(req, {
    action: AUDIT_ACTIONS.USER_APPROVED,
    entity: AUDIT_ENTITIES.USER,
    entityId: id,
    after: { name: data.name || data.full_name, email: data.email, role: data.role, isApproved: true },
  });

  return res.json({ user: mapUser(data) });
}));

router.delete('/users/:id/reject', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador pode rejeitar cadastros.');
  }

  // Snapshot antes de excluir (a linha some — preservamos a identidade na trilha).
  const rejected = await getUserById(id, req.churchId);

  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('church_id', req.churchId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Usuario nao encontrado.');
  }

  await recordAudit(req, {
    action: AUDIT_ACTIONS.USER_REJECTED,
    entity: AUDIT_ENTITIES.USER,
    entityId: id,
    before: rejected
      ? { name: rejected.name || rejected.full_name, email: rejected.email, role: rejected.role }
      : null,
  });

  return res.status(204).send();
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const actor = req.user;

  // Permission: Only the user themselves or an admin can delete the account
  if (actor.role !== 'admin' && actor.id !== id) {
    throw AppError.forbidden('Sem permissao para excluir este usuario.');
  }

  const userToDelete = await getUserById(id, req.churchId);
  if (!userToDelete) {
    throw AppError.notFound('Usuario nao encontrado.');
  }

  // 1. Find all ministries where this user is the LEADER
  const { data: ledMinistries } = await supabase
    .from('ministries')
    .select('id')
    .eq('leader_id', id);

  if (ledMinistries && ledMinistries.length > 0) {
    for (const m of ledMinistries) {
      // For each led ministry, perform the same cascade we do when deleting a ministry
      const junctionTables = ['ministry_members', 'ministry_admins', 'ministry_ministers', 'ministry_repertoire'];
      for (const table of junctionTables) {
        await supabase.from(table).delete().eq('ministry_id', m.id);
      }
      await supabase.from('schedules').update({ music_ministry_id: null }).eq('music_ministry_id', m.id);
      await supabase.from('ministries').delete().eq('id', m.id);
    }
  }

  // 2. Remove user from all junction tables (memberships, admin rights, minister assignments)
  const userJunctionTables = ['ministry_members', 'ministry_admins', 'ministry_ministers'];
  for (const table of userJunctionTables) {
    await supabase.from(table).delete().eq('user_id', id);
  }

  // 3. Cleanup schedules
  // Delete schedules created by this user
  await supabase.from('schedules').delete().eq('created_by_user_id', id);
  // Nullify where they were assigned as music minister
  await supabase.from('schedules').update({ music_minister_id: null, music_minister_name: 'Removido' }).eq('music_minister_id', id);

  // 4. Capture the linked auth user before removing the profile
  const { data: profileRow } = await supabase
    .from('users')
    .select('auth_user_id')
    .eq('id', id)
    .eq('church_id', req.churchId)
    .maybeSingle();

  // 5. Delete the user record itself (scoped to the tenant)
  const { error: deleteError } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('church_id', req.churchId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  // 6. Remove the identity from Supabase Auth (best effort)
  if (profileRow?.auth_user_id) {
    try {
      await supabase.auth.admin.deleteUser(profileRow.auth_user_id);
    } catch (authDeleteError) {
      console.error('Falha ao remover usuario do Supabase Auth:', authDeleteError.message);
    }
  }

  await recordAudit(req, {
    action: AUDIT_ACTIONS.USER_DELETED,
    entity: AUDIT_ENTITIES.USER,
    entityId: id,
    before: {
      name: userToDelete.name || userToDelete.full_name,
      email: userToDelete.email,
      role: userToDelete.role,
    },
  });

  return res.status(200).json({ message: 'Usuario e todos os dados relacionados foram excluidos com sucesso.' });
}));

// --- INDISPONIBILIDADES DE ESCALA ---

// Ler datas indisponíveis (do próprio usuário ou de alguém se for líder/admin)
router.get('/users/:userId/unavailable-dates', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const { data, error } = await supabase
    .from('user_unavailable_dates')
    .select('*')
    .eq('church_id', req.churchId)
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (error) throw new Error(error.message);

  return res.status(200).json(data);
}));

// Adicionar data indisponível
router.post('/users/:userId/unavailable-dates', validate(addUnavailableDateSchema), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { date, reason } = req.body;

  // Apenas o próprio usuário, ou um líder/admin, pode marcar indisponibilidade.
  if (req.user.id !== userId && req.user.role === 'membro') {
    throw AppError.forbidden('Nao autorizado.');
  }

  const { data, error } = await supabase
    .from('user_unavailable_dates')
    .insert([{ user_id: userId, date, reason, church_id: req.churchId }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw AppError.conflict('Data ja esta marcada como indisponivel.');
    }
    throw new Error(error.message);
  }

  return res.status(201).json(data);
}));

// Remover data indisponível
router.delete('/users/:userId/unavailable-dates/:id', asyncHandler(async (req, res) => {
  const { userId, id } = req.params;

  if (req.user.id !== userId && req.user.role === 'membro') {
    throw AppError.forbidden('Nao autorizado.');
  }

  const { error } = await supabase
    .from('user_unavailable_dates')
    .delete()
    .match({ id, user_id: userId, church_id: req.churchId });

  if (error) throw new Error(error.message);

  return res.status(204).send();
}));

module.exports = router;
