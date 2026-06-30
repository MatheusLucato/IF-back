const express = require('express');
const { randomUUID } = require('crypto');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const {
  createMinistrySchema,
  updateMinistryProfileSchema,
  updateMinistersSchema,
  updateLeadersSchema,
  updateMembersSchema,
  linkMemberSchema,
  createTeamSchema,
  createFunctionSchema,
  deleteFunctionSchema,
  repertoireSchema,
} = require('../schemas/ministrySchemas');
const { USER_SELECT } = require('../lib/constants');
const { mapMinistry } = require('../lib/mappers');
const {
  normalizeScheduleSongs,
  normalizeStringArray,
  normalizeFunctionNames,
  sanitizeMinistryTeams,
} = require('../lib/normalizers');
const { getUserById } = require('../services/userService');
const { uploadAsset } = require('../services/storage');
const { upload } = require('../middleware/upload');
const {
  getMinistryById,
  enrichMinistries,
  canManageMinistry,
  canCreateMinistry,
  canAccessRepertoire,
  isLeaderEligible,
  runMinistryQueryWithFallback,
  updateMinistryTeamsSafely,
  syncTeamsWithMemberIds,
  insertMinistry,
  isTeamsColumnSupported,
  markTeamsColumnUnsupported,
  isMissingMinistryTeamsColumnError,
} = require('../services/ministryService');

const router = express.Router();
const supabase = getSupabase();

router.get('/ministries', asyncHandler(async (req, res) => {
  const { data, error } = await runMinistryQueryWithFallback((selectFields) => (
    supabase
      .from('ministries')
      .select(selectFields)
      .eq('church_id', req.churchId)
      .order('created_at', { ascending: false })
  ));

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries(data || []);
  return res.json({ ministries: enriched.map(mapMinistry) });
}));

router.get('/ministries/created-by/:leaderId', asyncHandler(async (req, res) => {
  const { leaderId } = req.params;

  const { data, error } = await runMinistryQueryWithFallback((selectFields) => (
    supabase
      .from('ministries')
      .select(selectFields)
      .eq('church_id', req.churchId)
      .eq('leader_id', leaderId)
      .order('created_at', { ascending: false })
  ));

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries(data || []);
  return res.json({ ministries: enriched.map(mapMinistry) });
}));

router.get('/ministries/:id', asyncHandler(async (req, res) => {
  const ministry = await getMinistryById(req.params.id, req.churchId);

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  return res.json({ ministry: mapMinistry(ministry) });
}));

router.get('/ministries/:id/repertoire', asyncHandler(async (req, res) => {
  const ministry = await getMinistryById(req.params.id, req.churchId);

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!(await canAccessRepertoire(req.user, ministry))) {
    throw AppError.forbidden('Sem permissao para visualizar este repertorio.');
  }

  return res.json({ songs: Array.isArray(ministry.repertoire) ? ministry.repertoire : [] });
}));

router.post('/ministries/:id/repertoire', validate(repertoireSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { song, songs } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!(await canAccessRepertoire(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este repertorio.');
  }

  const normalizedSongs = normalizeScheduleSongs(Array.isArray(songs) ? songs : (song ? [song] : []));
  if (normalizedSongs.length === 0) {
    throw AppError.badRequest('Informe ao menos uma musica valida.');
  }

  const songRows = normalizedSongs.map((item) => ({
    id: item.id,
    song: item,
    church_id: req.churchId,
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
    church_id: req.churchId,
  }));

  const { error: linkError } = await supabase
    .from('ministry_repertoire')
    .upsert(linkRows, { onConflict: 'ministry_id,song_id' });

  if (linkError) {
    throw new Error(linkError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(201).json({ ministry: mapMinistry(updated), songs: updated?.repertoire || [] });
}));

router.delete('/ministries/:id/repertoire/:songId', asyncHandler(async (req, res) => {
  const { id, songId } = req.params;
  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!(await canAccessRepertoire(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este repertorio.');
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

  const updated = await getMinistryById(id, req.churchId);
  return res.json({ ministry: mapMinistry(updated) });
}));

router.post('/ministries', validate(createMinistrySchema), asyncHandler(async (req, res) => {
  const { name, color, isMusicMinistry, leaderId } = req.body;

  const actor = req.user;

  // O líder pode ser indicado (admin atribuindo) ou recai sobre quem cria.
  let leader = leaderId ? await getUserById(leaderId, req.churchId) : null;

  if (!(await canCreateMinistry(actor))) {
    throw AppError.forbidden('Usuario sem permissao para criar ministerio.');
  }

  if (!leader) {
    leader = actor;
  }

  if (!isLeaderEligible(leader)) {
    if (actor.role === 'admin') {
      leader = actor;
    } else {
      throw AppError.forbidden('Usuario sem permissao para criar ministerio.');
    }
  }

  const payload = {
    id: randomUUID(),
    church_id: req.churchId,
    name: String(name).trim(),
    leader_id: leader.id,
    managers: [],
    member_count: 0,
    color: color || '#ffffff',
    image_url: null,
    functions: [],
    is_music_ministry: Boolean(isMusicMinistry),
  };

  const { data: created, error } = await insertMinistry(payload);

  if (error) {
    throw new Error(error.message);
  }

  const enriched = await enrichMinistries([created]);
  return res.status(201).json({ ministry: mapMinistry(enriched[0]) });
}));

router.patch('/ministries/:id/profile', validate(updateMinistryProfileSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, color, isMusicMinistry } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  const payload = {};
  if (typeof name === 'string' && name.trim()) {
    payload.name = name.trim();
  }
  if (typeof color === 'string' && color.trim()) {
    payload.color = color.trim();
  }
  if (isMusicMinistry !== undefined) {
    payload.is_music_ministry = Boolean(isMusicMinistry);
  }

  const { error } = await supabase
    .from('ministries')
    .update(payload)
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.patch('/ministries/:id/ministers', validate(updateMinistersSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ministerIds } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
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
      user_id: userId,
      church_id: req.churchId
    }));

    const { error: insertError } = await supabase
      .from('ministry_ministers')
      .insert(ministerRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.patch('/ministries/:id/leaders', validate(updateLeadersSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { leaderIds } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
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
        .filter((item) => item.role === 'membro' || item.role === 'lider')
        .map((item) => item.id)
    );
    const invalid = uniqueLeaderIds.filter((candidateId) => !validIds.has(candidateId));

    if (invalid.length > 0) {
      throw AppError.badRequest('Alguns administradores informados sao invalidos.');
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
      user_id: userId,
      church_id: req.churchId
    }));

    const { error: insertError } = await supabase
      .from('ministry_admins')
      .insert(adminRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.patch('/ministries/:id/members', validate(updateMembersSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { memberIds } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !canManageMinistry(actor, ministry)) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
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
      throw AppError.badRequest('Alguns membros informados sao invalidos.');
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
      church_id: req.churchId,
      function_name: 'Membro',
      function_names: ['Membro'],
      function_ids: []
    }));

    const { error: insertError } = await supabase
      .from('ministry_members')
      .insert(membershipRows);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const ministryAfterMembers = await getMinistryById(id, req.churchId);
  const syncedTeams = syncTeamsWithMemberIds(
    ministryAfterMembers?.teams,
    ministryAfterMembers?.member_user_ids || []
  );

  if (JSON.stringify(syncedTeams) !== JSON.stringify(sanitizeMinistryTeams(ministryAfterMembers?.teams))) {
    await updateMinistryTeamsSafely(id, syncedTeams);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.post('/ministries/:id/members/link', validate(linkMemberSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, functionName, functionIds } = req.body;

  const normalizedFunction = String(functionName).trim();

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;
  const memberUser = await getUserById(userId, req.churchId);

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  if (!memberUser || memberUser.role === 'admin') {
    throw AppError.badRequest('Membro informado e invalido.');
  }

  const ministryBeforeUpdate = await getMinistryById(id, req.churchId);
  const existingMember = (ministryBeforeUpdate?.memberUsers || []).find((item) => item.id === userId);

  // Names logic
  const existingNames = existingMember ? normalizeFunctionNames(existingMember.functionNames || existingMember.functionName) : [];
  const nextNames = [...new Set([...existingNames, ...normalizedFunction.split(',').map(s => s.trim())])].filter(Boolean);

  // IDs logic
  const existingIds = existingMember?.functionIds || [];
  const incomingIds = Array.isArray(functionIds) ? functionIds : [];
  const nextIds = [...new Set([...existingIds, ...incomingIds])].filter(Boolean);

  const { error: upsertError } = await supabase
    .from('ministry_members')
    .upsert({
      ministry_id: id,
      user_id: userId,
      church_id: req.churchId,
      function_name: nextNames[0] || 'Membro',
      function_names: nextNames,
      function_ids: nextIds
    }, { onConflict: 'ministry_id,user_id' });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

router.delete('/ministries/:id/members/:userId', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  const { error: deleteError } = await supabase
    .from('ministry_members')
    .delete()
    .eq('ministry_id', id)
    .eq('user_id', userId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  // Also remove from admins and ministers tables
  await supabase
    .from('ministry_admins')
    .delete()
    .eq('ministry_id', id)
    .eq('user_id', userId);

  await supabase
    .from('ministry_ministers')
    .delete()
    .eq('ministry_id', id)
    .eq('user_id', userId);

  // Update legacy managers JSON column
  const currentManagers = Array.isArray(ministry.managers) ? ministry.managers : [];
  const nextManagers = currentManagers.filter(mId => mId !== userId);
  if (nextManagers.length !== currentManagers.length) {
    await supabase
      .from('ministries')
      .update({ managers: nextManagers })
      .eq('id', id);
  }

  const ministryAfterDelete = await getMinistryById(id, req.churchId);
  const syncedTeams = syncTeamsWithMemberIds(
    ministryAfterDelete?.teams,
    ministryAfterDelete?.member_user_ids || []
  );

  if (JSON.stringify(syncedTeams) !== JSON.stringify(sanitizeMinistryTeams(ministryAfterDelete?.teams))) {
    await updateMinistryTeamsSafely(id, syncedTeams);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.post('/ministries/:id/teams', validate(createTeamSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, memberIds } = req.body;

  const teamName = String(name).trim();

  const uniqueMemberIds = normalizeStringArray(memberIds);
  if (uniqueMemberIds.length === 0) {
    throw AppError.badRequest('Selecione ao menos um membro para a equipe.');
  }

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  if (!isTeamsColumnSupported()) {
    throw AppError.preconditionFailed('Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.');
  }

  const allowedMemberIds = new Set(normalizeStringArray(ministry.member_user_ids));
  if (uniqueMemberIds.some((memberId) => !allowedMemberIds.has(memberId))) {
    throw AppError.badRequest('A equipe deve conter apenas membros vinculados ao ministerio.');
  }

  const currentTeams = sanitizeMinistryTeams(ministry.teams);
  if (currentTeams.some((team) => team.name.toLowerCase() === teamName.toLowerCase())) {
    throw AppError.conflict('Ja existe uma equipe com esse nome neste ministerio.');
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
    markTeamsColumnUnsupported();
    throw AppError.preconditionFailed('Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.');
  }

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

router.delete('/ministries/:id/teams/:teamId', asyncHandler(async (req, res) => {
  const { id, teamId } = req.params;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  if (!isTeamsColumnSupported()) {
    throw AppError.preconditionFailed('Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.');
  }

  const currentTeams = sanitizeMinistryTeams(ministry.teams);
  const nextTeams = currentTeams.filter((team) => team.id !== teamId);

  if (nextTeams.length === currentTeams.length) {
    throw AppError.notFound('Equipe nao encontrada.');
  }

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ teams: nextTeams })
    .eq('id', id);

  if (isMissingMinistryTeamsColumnError(updateError)) {
    markTeamsColumnUnsupported();
    throw AppError.preconditionFailed('Recurso de equipes indisponivel: execute a migracao SQL para adicionar a coluna ministries.teams.');
  }

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.post('/ministries/:id/functions', validate(createFunctionSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, emoji } = req.body;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  const currentFunctions = Array.isArray(ministry.functions) ? [...ministry.functions] : [];
  const roleName = String(name).trim();

  if (currentFunctions.some((item) => String(item.name || '').toLowerCase() === roleName.toLowerCase())) {
    throw AppError.conflict('Ja existe uma funcao com esse nome.');
  }

  currentFunctions.push({ id: randomUUID(), name: roleName, emoji: String(emoji).trim() });

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ functions: currentFunctions })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(201).json({ ministry: mapMinistry(updated) });
}));

router.delete('/ministries/:id/functions/:functionId', validate(deleteFunctionSchema), asyncHandler(async (req, res) => {
  const { id, functionId } = req.params;
  const { migrations } = req.body; // Array of { userId, replacementId }

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  const currentFunctions = Array.isArray(ministry.functions) ? [...ministry.functions] : [];
  const functionToDelete = currentFunctions.find((item) => item.id === functionId);

  if (!functionToDelete) {
    throw AppError.notFound('Funcao nao encontrada.');
  }

  const oldName = functionToDelete.name;
  const nextFunctions = currentFunctions.filter((item) => item.id !== functionId);

  // 1. Fetch all members of this ministry to perform cleanup/migration
  const { data: members, error: fetchMembersError } = await supabase
    .from('ministry_members')
    .select('*')
    .eq('ministry_id', id);

  if (!fetchMembersError && members) {
    const migrationMap = new Map((migrations || []).map(m => [String(m.userId), String(m.replacementId)]));
    const targetOldName = String(oldName || '').trim().toLowerCase();

    for (const m of members) {
      let fIds = Array.isArray(m.function_ids) ? [...m.function_ids] : [];

      // If we don't have IDs yet, try to build from names (migration phase)
      if (fIds.length === 0) {
        const mFunctions = Array.isArray(ministry.functions) ? ministry.functions : [];
        const mNames = Array.isArray(m.function_names) ? m.function_names : [m.function_name];
        fIds = mFunctions.filter(f => mNames.includes(f.name)).map(f => f.id);
      }

      const hasFunction = fIds.includes(functionId);

      if (hasFunction) {
        const replacementId = migrationMap.get(String(m.user_id));
        const replacementFunction = nextFunctions.find(f => f.id === replacementId);

        if (replacementFunction) {
          fIds = fIds.map(fid => fid === functionId ? replacementFunction.id : fid);
        } else {
          fIds = fIds.filter(fid => fid !== functionId);
        }

        const nextIds = [...new Set(fIds.filter(Boolean))];
        const nextNames = nextIds
          .map(id => nextFunctions.find(f => f.id === id)?.name)
          .filter(Boolean);

        if (nextNames.length === 0) nextNames.push('Membro');

        const { error: mUpdateError } = await supabase
          .from('ministry_members')
          .update({
            function_ids: nextIds,
            function_names: nextNames,
            function_name: nextNames[0]
          })
          .eq('ministry_id', id)
          .eq('user_id', m.user_id);

        if (mUpdateError) {
          console.error(`Erro ao atualizar membro ${m.user_id}:`, mUpdateError.message);
        }
      }
    }
  }

  // 2. Update the ministry functions list
  const { error: updateError } = await supabase
    .from('ministries')
    .update({ functions: nextFunctions })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

router.delete('/ministries/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor) {
    throw AppError.forbidden('Sem permissao para excluir este ministerio.');
  }

  // Allow admin or ministry leader to delete
  if (actor.role !== 'admin' && ministry.leader_id !== actor.id) {
    throw AppError.forbidden('Apenas admins ou o lider do ministerio podem excluir.');
  }

  // 1. Delete from junction tables first (Manual Cascade)
  const junctionTables = [
    'ministry_members',
    'ministry_admins',
    'ministry_ministers',
    'ministry_repertoire'
  ];

  for (const table of junctionTables) {
    await supabase
      .from(table)
      .delete()
      .eq('ministry_id', id);
  }

  // 2. Nullify references in schedules
  await supabase
    .from('schedules')
    .update({ music_ministry_id: null })
    .eq('music_ministry_id', id);

  // 3. Delete the ministry itself
  const { error: deleteError } = await supabase
    .from('ministries')
    .delete()
    .eq('id', id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return res.status(200).json({ message: 'Ministerio excluido com sucesso.' });
}));

router.post('/ministries/:id/image', upload.single('image'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    throw AppError.badRequest('Arquivo de imagem e obrigatorio.');
  }

  const ministry = await getMinistryById(id, req.churchId);
  const actor = req.user;

  if (!ministry) {
    throw AppError.notFound('Ministerio nao encontrado.');
  }

  if (!actor || !(await canManageMinistry(actor, ministry))) {
    throw AppError.forbidden('Sem permissao para editar este ministerio.');
  }

  const mime = req.file.mimetype || 'application/octet-stream';
  const { url: imageUrl } = await uploadAsset({
    buffer: req.file.buffer,
    mime,
    churchId: req.churchId,
    category: `ministries/${id}`,
  });

  const { error: updateError } = await supabase
    .from('ministries')
    .update({ image_url: imageUrl })
    .eq('id', id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const updated = await getMinistryById(id, req.churchId);
  return res.status(200).json({ ministry: mapMinistry(updated) });
}));

module.exports = router;
