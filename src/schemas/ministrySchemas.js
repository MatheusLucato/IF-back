const { z, trimmedRequired, optionalString, idArray } = require('./common');

const createMinistrySchema = z.object({
  name: trimmedRequired('Nome e obrigatorio.'),
  color: optionalString,
  isMusicMinistry: z.boolean().optional(),
  leaderId: optionalString,
});

const updateMinistryProfileSchema = z.object({
  name: optionalString,
  color: optionalString,
  isMusicMinistry: z.boolean().optional(),
});

const updateMinistersSchema = z.object({
  ministerIds: idArray,
});

const updateLeadersSchema = z.object({
  leaderIds: idArray,
});

const updateMembersSchema = z.object({
  memberIds: idArray,
});

const linkMemberSchema = z.object({
  userId: trimmedRequired('userId e obrigatorio.'),
  functionName: trimmedRequired('A funcao do membro e obrigatoria.'),
  functionIds: idArray.optional(),
});

const createTeamSchema = z.object({
  name: trimmedRequired('Nome da equipe e obrigatorio.'),
  memberIds: idArray,
});

const createFunctionSchema = z.object({
  name: trimmedRequired('Nome e obrigatorio.'),
  emoji: trimmedRequired('Emoji e obrigatorio.'),
});

// migrations: lista de { userId, replacementId } usada ao remover uma funcao.
// passthrough para nao descartar campos extras enviados pelo cliente.
const deleteFunctionSchema = z.object({
  migrations: z
    .array(z.object({ userId: z.string(), replacementId: z.string() }).passthrough())
    .optional(),
}).passthrough();

// Repertorio: aceita uma musica (`song`) ou uma lista (`songs`). As estruturas
// internas sao saneadas por normalizeScheduleSongs no handler — aqui ficamos
// permissivos para nao perder campos.
const repertoireSchema = z.object({
  song: z.any().optional(),
  songs: z.array(z.any()).optional(),
}).passthrough();

module.exports = {
  createMinistrySchema,
  updateMinistryProfileSchema,
  updateMinistersSchema,
  updateLeadersSchema,
  updateMembersSchema,
  linkMemberSchema,
  createTeamSchema,
  createFunctionSchema,
  deleteFunctionSchema,
  repertoireSchema,
};
