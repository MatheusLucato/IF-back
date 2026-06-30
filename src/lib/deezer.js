// Integracao com a API publica da Deezer (busca de musicas/artistas) e
// conversao do payload da Deezer para o formato de "song" da aplicacao.
const { normalizeNumber } = require('./normalizers');

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

module.exports = {
  requestDeezerJson,
  mapDeezerTrackToSong,
  mapDeezerArtistToArtist,
};
