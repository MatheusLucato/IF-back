const { z } = require('zod');

// Blocos reutilizaveis pelos schemas de cada recurso.
// `trimmedRequired` -> string nao vazia (apos trim). `optionalString` -> string
// opcional sem coercao. `idArray` -> lista de strings (ids), permissiva.

const trimmedRequired = (message = 'Campo obrigatorio.') => z.string().trim().min(1, message);
const optionalString = z.string().optional();
const idArray = z.array(z.string());

module.exports = { z, trimmedRequired, optionalString, idArray };
