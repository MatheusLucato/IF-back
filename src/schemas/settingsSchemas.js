const { z, optionalString } = require('./common');
const { validateThemeColors, PRIMARY_MIN_ON_BG, SECONDARY_MIN_ON_BG } = require('../lib/themeValidation');
const { isValidHex, normalizeHex, contrastRatio } = require('../lib/color');

const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const WHITE = '#ffffff';

// Atualizacao das configuracoes da igreja (dados cadastrais + identidade visual).
// Todos os campos sao opcionais (PATCH parcial). `.passthrough()` preserva o
// objeto `settings` (jsonb arbitrario) e qualquer extensao futura sem perder
// dados; o handler so persiste as chaves que conhece.
//
// O `.superRefine` faz o ENFORCEMENT de acessibilidade do tema (paridade com
// IF-front/src/lib/theme-validation.ts): o servidor nunca persiste um par de
// cores que deixaria a UI ilegivel, mesmo fora da tela de configuracoes.
const updateSettingsSchema = z.object({
  name: optionalString,
  tradeName: optionalString,
  cnpj: optionalString,
  phone: optionalString,
  whatsapp: optionalString,
  email: optionalString,
  website: optionalString,
  address: optionalString,
  city: optionalString,
  state: optionalString,
  country: optionalString,
  logoUrl: optionalString,
  logoCompactUrl: optionalString,
  faviconUrl: optionalString,
  coverUrl: optionalString,
  colorPrimary: optionalString,
  colorSecondary: optionalString,
  colorAccent: optionalString,
  colorButton: optionalString,
  colorLink: optionalString,
  language: optionalString,
  timezone: optionalString,
  dateFormat: optionalString,
  settings: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((data, ctx) => {
  // colorButton tem precedencia (cor que de fato pinta a UI no modelo de 2 cores).
  const primary = isNonEmpty(data.colorButton) ? data.colorButton : data.colorPrimary;
  const hasPrimary = isNonEmpty(primary);
  const hasSecondary = isNonEmpty(data.colorSecondary);
  if (!hasPrimary && !hasSecondary) return; // PATCH nao mexe no tema

  const addThemeIssue = (path, message, suggestion) => {
    ctx.addIssue({
      code: 'custom',
      path: [path],
      message: suggestion ? `${message} Sugestao: ${String(suggestion).toUpperCase()}.` : message,
    });
  };

  // Caso real (tela de configuracoes / onboarding): as duas cores vem juntas.
  if (hasPrimary && hasSecondary) {
    const result = validateThemeColors({ primary, secondary: data.colorSecondary });
    if (!result.ok) {
      const pathByField = { primary: 'colorPrimary', secondary: 'colorSecondary', pair: 'colorSecondary' };
      result.issues.forEach((i) => addThemeIssue(pathByField[i.field] || 'colorPrimary', i.message, i.suggestion));
    }
    return;
  }

  // PATCH com apenas uma cor: valida hex + visibilidade no fundo (sem a regra de par).
  const single = hasPrimary
    ? { value: primary, path: 'colorPrimary', min: PRIMARY_MIN_ON_BG }
    : { value: data.colorSecondary, path: 'colorSecondary', min: SECONDARY_MIN_ON_BG };
  if (!isValidHex(single.value)) {
    addThemeIssue(single.path, 'A cor precisa estar no formato hexadecimal (ex.: #0F766E).');
    return;
  }
  if (contrastRatio(normalizeHex(single.value), WHITE) < single.min) {
    addThemeIssue(single.path, 'A cor esta clara demais e ficaria quase invisivel sobre o fundo. Escolha um tom mais escuro.');
  }
});

module.exports = { updateSettingsSchema };
