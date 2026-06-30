const { AppError } = require('../lib/errors');
const { getUserPermissions } = require('../services/permissionService');

// Middleware de autorização granular (F0.6). Bloqueia a rota a menos que o
// usuário tenha PELO MENOS UMA das chaves informadas (`<modulo>.<acao>`).
//
// Resolve as permissões sob demanda (não há custo nas rotas não protegidas):
// papéis "super" (admin/pastor) passam pelo atalho seguro; demais usam o papel
// configurável (role_id) ou o mapa padrão por papel legado. Deve ser montado
// SEMPRE depois de `authenticate` (precisa de req.user).
function requirePermission(...permissionKeys) {
  const required = permissionKeys.filter(Boolean);

  return async (req, _res, next) => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Autenticacao obrigatoria.');
      }

      const permissions = await getUserPermissions(req.user);
      // Disponibiliza para handlers downstream que queiram refinar a checagem.
      req.permissions = permissions;

      const allowed = required.length === 0 || required.some((key) => permissions.has(key));
      if (!allowed) {
        throw AppError.forbidden('Sem permissao para esta acao.');
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requirePermission };
