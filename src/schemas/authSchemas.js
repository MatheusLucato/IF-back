const { z, trimmedRequired, optionalString } = require('./common');

// Cadastro de membro/lider em uma igreja existente. A validacao semantica da
// data de nascimento (formato/limite) continua no handler via normalizeBirthDate.
const registerSchema = z.object({
  name: trimmedRequired('Nome e obrigatorio.'),
  email: trimmedRequired('Email e obrigatorio.'),
  password: trimmedRequired('Senha e obrigatoria.'),
  birthDate: trimmedRequired('Data de nascimento e obrigatoria.'),
  churchId: trimmedRequired('Selecione a igreja.'),
  isLeader: z.boolean().optional(),
});

// Onboarding: cria tenant (igreja) + admin + identidade visual.
const onboardingSchema = z.object({
  admin: z.object({
    name: trimmedRequired('Nome do administrador e obrigatorio.'),
    email: trimmedRequired('Email do administrador e obrigatorio.'),
    password: trimmedRequired('Senha do administrador e obrigatoria.'),
  }),
  church: z.object({
    name: trimmedRequired('O nome da igreja e obrigatorio.'),
    tradeName: optionalString,
    city: optionalString,
    state: optionalString,
    country: optionalString,
  }).passthrough(),
  identity: z.object({
    logoUrl: optionalString,
    colorPrimary: optionalString,
    colorSecondary: optionalString,
  }).passthrough().optional(),
});

module.exports = { registerSchema, onboardingSchema };
