const { z, trimmedRequired, optionalString } = require('./common');

// Geração de um link de convite (admin/pastor). Tudo opcional além do papel
// padrão: o link nasce "membro", reutilizável, sem validade e sem limite.
const createInviteLinkSchema = z.object({
  role: z.enum(['membro', 'lider']).optional(),
  label: optionalString,
  maxUses: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().optional(),
}).passthrough();

// Cadastro público via convite: apenas dados pessoais. A igreja vem do token na
// URL — o cliente nunca informa churchId. A validação semântica da data de
// nascimento continua no service (normalizeBirthDate).
const inviteRegisterSchema = z.object({
  name: trimmedRequired('Nome e obrigatorio.'),
  email: trimmedRequired('Email e obrigatorio.'),
  password: trimmedRequired('Senha e obrigatoria.'),
  birthDate: trimmedRequired('Data de nascimento e obrigatoria.'),
}).passthrough();

module.exports = { createInviteLinkSchema, inviteRegisterSchema };
