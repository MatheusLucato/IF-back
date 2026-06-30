const { AppError } = require('../lib/errors');
const { formatZodIssues } = require('./errorHandler');

// Middleware de validacao por schema (zod). Valida `req[source]` (default: body),
// e, em caso de sucesso, SUBSTITUI o valor pelo resultado parseado (com defaults
// aplicados e chaves desconhecidas removidas, conforme o schema).
//
// Estrategia desta fase (F0.4): comecar permissivo. Schemas declaram os campos
// conhecidos; payloads com estruturas internas ricas (escalas, repertorio) usam
// schemas .passthrough() para nao perder dados — o saneamento profundo continua
// nos normalizers. Em caso de falha, devolve 400 com o envelope padronizado e a
// lista de problemas em `details`.
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] || {});
    if (!result.success) {
      return next(AppError.validation('Dados invalidos.', formatZodIssues(result.error)));
    }
    // `query` e `params` sao getters somente-leitura no Express 5: nao da para
    // reatribuir. Para esses, copiamos os valores parseados de volta nas chaves.
    if (source === 'body') {
      req.body = result.data;
    } else {
      Object.assign(req[source], result.data);
    }
    return next();
  };
}

module.exports = { validate };
