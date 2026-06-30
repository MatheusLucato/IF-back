const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const {
  createScheduleSchema,
  updateScheduleSchema,
  updateScheduleSongsSchema,
} = require('../schemas/scheduleSchemas');
const { mapSchedule } = require('../lib/mappers');
const {
  normalizeScheduleDate,
  normalizeServiceTime,
  normalizeScheduleAssignments,
  normalizeScheduleSongs,
  normalizeOptionalId,
  normalizeOptionalText,
} = require('../lib/normalizers');
const { checkScheduleConflicts } = require('../services/scheduleService');

const router = express.Router();
const supabase = getSupabase();

router.get('/schedules', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('church_id', req.churchId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ schedules: (data || []).map(mapSchedule) });
}));

router.post('/schedules', validate(createScheduleSchema), asyncHandler(async (req, res) => {
  const body = req.body;
  const normalizedDate = normalizeScheduleDate(body.date);
  const normalizedServiceTime = normalizeServiceTime(body.serviceTime);

  if (!normalizedDate) {
    throw AppError.badRequest('Data invalida.');
  }

  if (!normalizedServiceTime) {
    throw AppError.badRequest('Horario do culto invalido.');
  }

  // Check for conflicts before creating schedule
  const assignments = normalizeScheduleAssignments(body.assignments);
  if (assignments && assignments.length > 0) {
    const conflicts = await checkScheduleConflicts(normalizedDate, normalizedServiceTime, assignments, null, req.churchId);
    if (conflicts.length > 0) {
      throw AppError.conflict('Conflito de escalonamento detectado', { conflicts });
    }
  }

  const payload = {
    church_id: req.churchId,
    date: normalizedDate,
    service_time: normalizedServiceTime,
    assignments: assignments,
    songs: normalizeScheduleSongs(body.songs),
    created_by_user_id: req.user.id,
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

router.patch('/schedules/:id', validate(updateScheduleSchema), asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    throw AppError.badRequest('ID da escala e obrigatorio.');
  }

  const body = req.body;
  const payload = {};

  // Get current schedule for comparison (scoped to tenant)
  const { data: currentSchedule, error: fetchError } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', id)
    .eq('church_id', req.churchId)
    .single();

  if (fetchError) {
    throw AppError.notFound('Escala nao encontrada.');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'date')) {
    const normalizedDate = normalizeScheduleDate(body.date);
    if (!normalizedDate) {
      throw AppError.badRequest('Data invalida.');
    }
    payload.date = normalizedDate;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'serviceTime')) {
    const normalizedServiceTime = normalizeServiceTime(body.serviceTime);
    if (!normalizedServiceTime) {
      throw AppError.badRequest('Horario do culto invalido.');
    }
    payload.service_time = normalizedServiceTime;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assignments')) {
    payload.assignments = normalizeScheduleAssignments(body.assignments);

    // Check for conflicts with updated assignments
    const checkDate = payload.date || currentSchedule.date;
    const checkServiceTime = payload.service_time || currentSchedule.service_time;

    const conflicts = await checkScheduleConflicts(checkDate, checkServiceTime, payload.assignments, id, req.churchId);
    if (conflicts.length > 0) {
      throw AppError.conflict('Conflito de escalonamento detectado', { conflicts });
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
    throw AppError.badRequest('Nenhuma alteracao enviada.');
  }

  const { data, error } = await supabase
    .from('schedules')
    .update(payload)
    .eq('id', id)
    .eq('church_id', req.churchId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Escala nao encontrada.');
  }

  return res.json({ schedule: mapSchedule(data) });
}));

router.delete('/schedules/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const actor = req.user;

  if (!id) {
    throw AppError.badRequest('ID da escala e obrigatorio.');
  }

  const { data: schedule, error: fetchError } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', id)
    .eq('church_id', req.churchId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!schedule) {
    throw AppError.notFound('Escala nao encontrada.');
  }

  // Permission: Admin or Creator
  if (actor.role !== 'admin' && schedule.created_by_user_id !== actor.id) {
    throw AppError.forbidden('Sem permissao para excluir esta escala.');
  }

  const { error: deleteError } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('church_id', req.churchId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return res.status(204).send();
}));

router.get('/schedules/minister/:ministerId', asyncHandler(async (req, res) => {
  const ministerId = String(req.params.ministerId || '').trim();
  if (!ministerId) {
    throw AppError.badRequest('ID do ministro e obrigatorio.');
  }

  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('church_id', req.churchId)
    .eq('music_minister_id', ministerId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ schedules: (data || []).map(mapSchedule) });
}));

router.patch('/schedules/:id/songs', validate(updateScheduleSongsSchema), asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const { songs } = req.body;

  if (!id) {
    throw AppError.badRequest('ID da escala e obrigatorio.');
  }

  const normalizedSongs = normalizeScheduleSongs(songs);

  const { data, error } = await supabase
    .from('schedules')
    .update({ songs: normalizedSongs })
    .eq('id', id)
    .eq('church_id', req.churchId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw AppError.notFound('Escala nao encontrada.');
  }

  return res.json({ schedule: mapSchedule(data) });
}));

module.exports = router;
