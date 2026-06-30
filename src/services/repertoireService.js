const { getSupabase } = require('../db');
const { mapStoredSong } = require('../lib/mappers');

const supabase = getSupabase();

// Busca uma musica persistida no catalogo (repertoire_songs) por id.
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

module.exports = { getStoredRepertoireSongById };
