const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const me = require('../services/meService');

const router = express.Router();

// ============================================================================
// EXPERIÊNCIA DO MEMBRO (F8.1 PWA + F6.4 portal do contribuinte).
// Endpoints "me/*" do próprio usuário autenticado (sem permissão de gestão).
// ============================================================================

router.get('/me/home', asyncHandler(async (req, res) =>
  res.json(await me.getHome(req.churchId, req.user))));

router.get('/me/schedules', asyncHandler(async (req, res) =>
  res.json({ schedules: await me.getMySchedules(req.churchId, req.user) })));

router.get('/me/donations', asyncHandler(async (req, res) =>
  res.json({ donations: await me.getMyDonations(req.churchId, req.user) })));

router.get('/me/announcements', asyncHandler(async (req, res) =>
  res.json({ announcements: await me.getAnnouncements(req.churchId) })));

router.get('/me/events', asyncHandler(async (req, res) =>
  res.json({ events: await me.getUpcomingEvents(req.churchId) })));

module.exports = router;
