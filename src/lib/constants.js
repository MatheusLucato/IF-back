// Colunas selecionadas em consultas recorrentes. Centralizado para manter o
// mesmo "shape" de retorno em todos os routers/services.
const USER_SELECT = 'id,name,full_name,email,role,profile_picture,birth_date,theme_preference,created_at';
const MINISTRY_SELECT_BASE = 'id,name,leader_id,managers,member_count,color,image_url,is_music_ministry,functions,repertoire,created_at';
const MINISTRY_SELECT_WITH_TEAMS = `${MINISTRY_SELECT_BASE},teams`;

// Pessoas (F1.1). Mesmo "shape" de retorno em todos os routers/services de membros.
const MEMBER_SELECT = [
  'id', 'church_id', 'user_id', 'full_name', 'social_name', 'gender', 'birth_date',
  'marital_status', 'cpf', 'rg', 'email', 'phone', 'whatsapp', 'photo_url',
  'address_zip', 'address_street', 'address_number', 'address_complement',
  'address_district', 'address_city', 'address_state',
  'membership_status', 'joined_at', 'baptism_date', 'conversion_date', 'notes',
  'is_active', 'created_at', 'updated_at',
].join(',');

module.exports = {
  USER_SELECT,
  MINISTRY_SELECT_BASE,
  MINISTRY_SELECT_WITH_TEAMS,
  MEMBER_SELECT,
};
