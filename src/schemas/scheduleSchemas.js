const { z, optionalString } = require('./common');

// Escalas carregam estruturas ricas (assignments, songs) que sao saneadas pelos
// normalizers no handler, e a validacao semantica de data/horario continua la
// (mensagens especificas). Por isso os schemas aqui ficam permissivos
// (.passthrough(), campos opcionais) — papel do zod e padronizar o envelope e
// servir de base para apertar depois.
const createScheduleSchema = z.object({
  date: optionalString,
  serviceTime: optionalString,
  assignments: z.array(z.any()).optional(),
  songs: z.array(z.any()).optional(),
  musicMinistryId: optionalString.nullable(),
  musicMinisterId: optionalString.nullable(),
  musicMinisterName: optionalString.nullable(),
}).passthrough();

const updateScheduleSchema = z.object({
  date: optionalString,
  serviceTime: optionalString,
  assignments: z.array(z.any()).optional(),
  songs: z.array(z.any()).optional(),
  createdByUserId: optionalString.nullable(),
  musicMinistryId: optionalString.nullable(),
  musicMinisterId: optionalString.nullable(),
  musicMinisterName: optionalString.nullable(),
}).passthrough();

const updateScheduleSongsSchema = z.object({
  songs: z.array(z.any()),
});

module.exports = {
  createScheduleSchema,
  updateScheduleSchema,
  updateScheduleSongsSchema,
};
