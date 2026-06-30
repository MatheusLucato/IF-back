const { z, trimmedRequired, optionalString } = require('./common');

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

module.exports = { onboardingSchema };
