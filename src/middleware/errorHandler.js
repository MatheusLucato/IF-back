const multer = require('multer');
const { ZodError } = require('zod');
const { AppError, ERROR_CODES } = require('../lib/errors');

// Converte um ZodError em uma lista enxuta de problemas { path, message } para
// devolver ao cliente em `details` sem vazar a estrutura interna do zod.
function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path || ''),
    message: issue.message,
  }));
}

// Handler de erros unico para toda a API. Todas as respostas de erro saem no
// mesmo envelope: { error: { code, message, details } }.
function errorHandler(err, _req, res, _next) {
  // Erros esperados da aplicacao (lancados pelos handlers/services).
  if (err && err.isAppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Falha de validacao zod que tenha escapado do middleware `validate`.
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Dados invalidos.',
        details: formatZodIssues(err),
      },
    });
  }

  // Erros de upload do multer (tamanho, campo inesperado, etc.).
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: { code: ERROR_CODES.UPLOAD_ERROR, message: 'Erro no upload do arquivo.' },
    });
  }

  // Qualquer outra coisa e um bug inesperado: loga inteiro, mas nao vaza detalhes.
  console.error(err);
  return res.status(500).json({
    error: { code: ERROR_CODES.INTERNAL, message: 'Erro interno no servidor.' },
  });
}

module.exports = { errorHandler, formatZodIssues };
