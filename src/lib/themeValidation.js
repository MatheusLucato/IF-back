// Validacao de acessibilidade do tema (paridade com IF-front/src/lib/theme-validation.ts).
// Enforcement no servidor: o back nunca persiste um par de cores que deixaria a UI
// ilegivel, mesmo que a chamada nao venha da tela de configuracoes.

const {
  isValidHex,
  normalizeHex,
  hexToHsl,
  contrastRatio,
  adjustLightnessForContrast,
} = require('./color');

const WHITE = '#ffffff';
const PRIMARY_MIN_ON_BG = 4.5;
const SECONDARY_MIN_ON_BG = 3.0;
const SIMILAR_CONTRAST = 1.3;
const SIMILAR_HUE = 30;

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// { primary, secondary } -> { ok, issues: [{ field, code, message, suggestion }] }
function validateThemeColors(input) {
  const issues = [];
  const primaryValid = isValidHex(input && input.primary);
  const secondaryValid = isValidHex(input && input.secondary);

  if (!primaryValid) {
    issues.push({
      field: 'primary',
      code: 'invalid_hex',
      message: 'A cor primaria precisa estar no formato hexadecimal (ex.: #0F766E).',
    });
  }
  if (!secondaryValid) {
    issues.push({
      field: 'secondary',
      code: 'invalid_hex',
      message: 'A cor secundaria precisa estar no formato hexadecimal (ex.: #2563EB).',
    });
  }
  if (!primaryValid || !secondaryValid) {
    return { ok: false, issues };
  }

  const primary = normalizeHex(input.primary);
  const secondary = normalizeHex(input.secondary);

  if (contrastRatio(primary, WHITE) < PRIMARY_MIN_ON_BG) {
    issues.push({
      field: 'primary',
      code: 'low_contrast_background',
      message: 'A cor primaria esta clara demais para o fundo: textos, icones e links ficariam quase invisiveis. Escolha um tom mais escuro.',
      suggestion: adjustLightnessForContrast(primary, WHITE, PRIMARY_MIN_ON_BG),
    });
  }

  if (contrastRatio(secondary, WHITE) < SECONDARY_MIN_ON_BG) {
    issues.push({
      field: 'secondary',
      code: 'low_contrast_background',
      message: 'A cor secundaria esta clara demais e se confunde com o fundo branco. Escolha um tom mais forte.',
      suggestion: adjustLightnessForContrast(secondary, WHITE, SECONDARY_MIN_ON_BG),
    });
  }

  const hslP = hexToHsl(primary);
  const hslS = hexToHsl(secondary);
  if (
    hslP &&
    hslS &&
    contrastRatio(primary, secondary) < SIMILAR_CONTRAST &&
    hueDistance(hslP.h, hslS.h) < SIMILAR_HUE
  ) {
    issues.push({
      field: 'pair',
      code: 'colors_too_similar',
      message: 'As cores primaria e secundaria sao muito parecidas e ficariam indistinguiveis. Diferencie melhor as duas (matiz ou tom).',
      suggestion: adjustLightnessForContrast(secondary, primary, 2),
    });
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { validateThemeColors, PRIMARY_MIN_ON_BG, SECONDARY_MIN_ON_BG };
