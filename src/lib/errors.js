// Erro de aplicacao padronizado. Carrega um status HTTP, um `code` estavel
// (consumivel pelo frontend) e um `details` opcional. O errorHandler converte
// qualquer AppError no envelope unico { error: { code, message, details } }.
//
// Use as factories estaticas (AppError.notFound, AppError.forbidden, ...) em vez
// de `throw new Error(...)` para que a resposta saia no formato padronizado e
// com o status correto.

const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  UPLOAD_ERROR: 'UPLOAD_ERROR',
  INTERNAL: 'INTERNAL',
};

class AppError extends Error {
  constructor(message, { status = 400, code = ERROR_CODES.BAD_REQUEST, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    // Marca para o errorHandler distinguir erros esperados de bugs (500).
    this.isAppError = true;
  }

  static badRequest(message, details) {
    return new AppError(message, { status: 400, code: ERROR_CODES.BAD_REQUEST, details });
  }

  static validation(message, details) {
    return new AppError(message, { status: 400, code: ERROR_CODES.VALIDATION_ERROR, details });
  }

  static unauthenticated(message = 'Autenticacao obrigatoria.') {
    return new AppError(message, { status: 401, code: ERROR_CODES.UNAUTHENTICATED });
  }

  static forbidden(message = 'Sem permissao para esta acao.') {
    return new AppError(message, { status: 403, code: ERROR_CODES.FORBIDDEN });
  }

  static notFound(message = 'Recurso nao encontrado.') {
    return new AppError(message, { status: 404, code: ERROR_CODES.NOT_FOUND });
  }

  static conflict(message, details) {
    return new AppError(message, { status: 409, code: ERROR_CODES.CONFLICT, details });
  }

  static preconditionFailed(message) {
    return new AppError(message, { status: 412, code: ERROR_CODES.PRECONDITION_FAILED });
  }
}

module.exports = { AppError, ERROR_CODES };
