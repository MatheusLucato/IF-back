const { z, trimmedRequired, optionalString } = require('./common');

// PATCH /users/:id/profile — atualizacao parcial do proprio perfil (ou admin).
const updateUserProfileSchema = z.object({
  name: optionalString,
  // profilePicture pode ser uma URL ou um data URL longo: mantemos permissivo.
  profilePicture: optionalString,
  themePreference: z.enum(['light', 'dark']).optional(),
});

// PATCH /users/:id/role — apenas admin altera cargos.
const updateUserRoleSchema = z.object({
  role: z.enum(['admin', 'lider', 'membro'], { message: 'Cargo invalido.' }),
});

// POST /users/:userId/unavailable-dates — marca uma data de indisponibilidade.
const addUnavailableDateSchema = z.object({
  date: trimmedRequired('A data e obrigatoria.'),
  reason: optionalString,
});

module.exports = {
  updateUserProfileSchema,
  updateUserRoleSchema,
  addUnavailableDateSchema,
};
