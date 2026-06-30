const { AppError } = require('../lib/errors');

// Guarda das rotas cross-tenant da plataforma (F9.2). SÓ o papel
// `plataforma_admin` passa. É o único ponto do app onde o escopo por `church_id`
// é deliberadamente atravessado — por isso a checagem é explícita e estreita, e
// todo acesso é auditado nos handlers. Deve vir depois de `authenticate`.
function requirePlatformAdmin(req, _res, next) {
  if (!req.user) return next(AppError.unauthenticated('Autenticacao obrigatoria.'));
  if (req.user.role !== 'plataforma_admin') {
    return next(AppError.forbidden('Área restrita à administração da plataforma.'));
  }
  return next();
}

module.exports = { requirePlatformAdmin };
