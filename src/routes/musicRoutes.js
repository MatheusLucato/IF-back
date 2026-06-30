const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { normalizeNumber, normalizeScheduleSong } = require('../lib/normalizers');
const { requestDeezerJson, mapDeezerTrackToSong, mapDeezerArtistToArtist } = require('../lib/deezer');
const { getStoredRepertoireSongById } = require('../services/repertoireService');
const { canManageAnyMusicMinistry } = require('../services/ministryService');

const router = express.Router();
const supabase = getSupabase();

router.patch('/music/tracks/:id', asyncHandler(async (req, res) => {
  const songId = String(req.params.id || '').trim();

  if (!songId) {
    throw AppError.badRequest('ID da musica e obrigatorio.');
  }

  const actor = req.user;
  if (!(await canManageAnyMusicMinistry(actor))) {
    throw AppError.forbidden('Sem permissao para editar musicas.');
  }

  const existing = await getStoredRepertoireSongById(songId);
  const normalized = normalizeScheduleSong({ id: songId, ...(existing || {}), ...(req.body || {}) });
  if (!normalized) {
    throw AppError.badRequest('Musica invalida.');
  }

  const { error } = await supabase
    .from('repertoire_songs')
    .upsert({
      id: songId,
      song: normalized,
      church_id: req.churchId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    throw new Error(error.message);
  }

  return res.json({ song: normalized });
}));

router.get('/music/search', asyncHandler(async (req, res) => {
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

router.get('/music/tracks/:id', asyncHandler(async (req, res) => {
  const trackId = String(req.params.id || '').trim();
  if (!trackId) {
    throw AppError.badRequest('ID da musica e obrigatorio.');
  }

  const storedSong = await getStoredRepertoireSongById(trackId);
  if (storedSong) {
    return res.json({ song: storedSong });
  }

  const deezerTrack = await requestDeezerJson(`/track/${encodeURIComponent(trackId)}`);
  const song = mapDeezerTrackToSong(deezerTrack);

  if (!song) {
    throw AppError.notFound('Musica nao encontrada na Deezer.');
  }

  return res.json({ song });
}));

router.get('/music/artists/search', asyncHandler(async (req, res) => {
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

router.get('/music/artists/:id/tracks', asyncHandler(async (req, res) => {
  const artistId = String(req.params.id || '').trim();
  const limit = Math.min(500, Math.max(1, normalizeNumber(req.query.limit, 200)));

  if (!artistId) {
    throw AppError.badRequest('ID do artista e obrigatorio.');
  }

  const payload = await requestDeezerJson(`/artist/${encodeURIComponent(artistId)}/top?limit=${limit}`);
  const songs = (payload.data || []).map(mapDeezerTrackToSong).filter(Boolean);

  return res.json({ songs });
}));

module.exports = router;
