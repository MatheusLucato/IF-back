const { z, trimmedRequired, optionalString } = require('./common');

// As chaves de permissão são saneadas contra o catálogo no service
// (sanitizePermissionKeys); aqui o schema só garante o formato bruto.
const permissionKeyArray = z.array(z.string()).optional();

// POST /roles — cria um papel configurável.
const createRoleSchema = z.object({
  name: trimmedRequired('O nome do papel e obrigatorio.'),
  description: optionalString,
  permissions: permissionKeyArray,
});

// PATCH /roles/:id — atualização parcial (nome/descrição só para papéis não-sistema).
const updateRoleSchema = z.object({
  name: optionalString,
  description: optionalString,
  permissions: permissionKeyArray,
});

// PATCH /users/:id/role-assignment — atribui (ou remove com null) um papel.
const assignRoleSchema = z.object({
  roleId: z.string().trim().min(1).nullable(),
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
};
