const { z, trimmedRequired, optionalString } = require('./common');
const { validateThemeColors } = require('../lib/themeValidation');

const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

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
}).superRefine((data, ctx) => {
  // Enforcement de acessibilidade do tema quando ambas as cores sao informadas.
  const primary = data.identity && data.identity.colorPrimary;
  const secondary = data.identity && data.identity.colorSecondary;
  if (!isNonEmpty(primary) || !isNonEmpty(secondary)) return;

  const result = validateThemeColors({ primary, secondary });
  if (result.ok) return;
  const pathByField = { primary: 'colorPrimary', secondary: 'colorSecondary', pair: 'colorSecondary' };
  result.issues.forEach((i) => {
    ctx.addIssue({
      code: 'custom',
      path: ['identity', pathByField[i.field] || 'colorPrimary'],
      message: i.suggestion ? `${i.message} Sugestao: ${String(i.suggestion).toUpperCase()}.` : i.message,
    });
  });
});

module.exports = { onboardingSchema };
