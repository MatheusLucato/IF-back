const { AppError } = require('./errors');

// Postgres: "undefined_table" (relação inexistente). Como o SQL é aplicado
// MANUALMENTE (a migração da feature pode ainda não ter rodado), os services
// toleram a ausência da tabela e sinalizam PRECONDITION_FAILED ao front, que
// mostra um banner orientando a aplicar o SQL. Mesmo padrão do auditService.
const UNDEFINED_TABLE = '42P01';

function isMissingRelation(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

// Lança o erro padronizado de "migração pendente" apontando o arquivo a aplicar.
function migrationPending(migrationFile) {
  return AppError.preconditionFailed(
    `Recurso indisponível: execute a migração ${migrationFile} no Supabase para habilitar este módulo.`,
  );
}

module.exports = { UNDEFINED_TABLE, isMissingRelation, migrationPending };
