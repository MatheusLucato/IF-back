const { getSupabase, getAuthUserFromToken, createUserClientFromToken } = require('../db');
const { AppError } = require('../lib/errors');

const supabase = getSupabase();

const PROFILE_SELECT = 'id,name,full_name,email,role,is_approved,church_id,auth_user_id,profile_picture,birth_date,theme_preference,created_at';
// `role_id` (RBAC, F0.6) é carregado quando a coluna existir. Como o SQL é
// aplicado manualmente, toleramos a coluna ausente (migração 0002 não rodada):
// nesse caso o profile vem sem role_id e o resolvedor de permissões usa o mapa
// padrão por papel legado.
const PROFILE_SELECT_WITH_ROLE = `${PROFILE_SELECT},role_id`;
let supportsRoleIdColumn = true;

// Postgres 42703 = coluna inexistente (users.role_id antes da migração 0002).
function isMissingRoleIdColumn(error) {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /column\s+users\.role_id\s+does not exist/i.test(String(error.message || ''))
    || /column\s+role_id\s+does not exist/i.test(String(error.message || ''));
}

async function loadProfileByAuthUserId(authUserId) {
  if (supportsRoleIdColumn) {
    const withRole = await supabase
      .from('users')
      .select(PROFILE_SELECT_WITH_ROLE)
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (!isMissingRoleIdColumn(withRole.error)) {
      return withRole;
    }
    supportsRoleIdColumn = false;
  }

  return supabase
    .from('users')
    .select(PROFILE_SELECT)
    .eq('auth_user_id', authUserId)
    .maybeSingle();
}

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : '';
}

// Autentica via Supabase Auth. Carrega o profile (users) vinculado ao auth user
// e injeta req.user / req.churchId DERIVADOS DO TOKEN — nunca de input do cliente.
async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw AppError.unauthenticated('Autenticacao obrigatoria.');
    }

    const authUser = await getAuthUserFromToken(token);
    if (!authUser) {
      throw AppError.unauthenticated('Sessao invalida ou expirada.');
    }

    const { data: profile, error } = await loadProfileByAuthUserId(authUser.id);

    if (error) {
      throw new Error('Falha ao carregar o perfil do usuario.');
    }

    if (!profile) {
      throw AppError.forbidden('Perfil nao encontrado para este usuario.');
    }

    if (!profile.church_id) {
      throw AppError.forbidden('Usuario sem igreja vinculada.');
    }

    req.authUser = authUser;
    req.accessToken = token;
    req.user = profile;
    req.churchId = profile.church_id;
    // Cliente com RLS (defesa em profundidade) caso a rota prefira usá-lo.
    req.db = createUserClientFromToken(token);

    return next();
  } catch (err) {
    return next(err);
  }
}

// Exige que o usuário esteja aprovado (líderes pendentes ficam de fora).
function requireApproved(req, _res, next) {
  if (req.user && req.user.is_approved === false) {
    return next(AppError.forbidden('Conta pendente de aprovacao.'));
  }
  return next();
}

// Restringe a rota a determinados papéis dentro da igreja.
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(AppError.forbidden('Sem permissao para esta acao.'));
    }
    return next();
  };
}

module.exports = { authenticate, requireApproved, requireRole };
