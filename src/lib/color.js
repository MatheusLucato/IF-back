// Espelho CJS dos utilitarios de cor/contraste do front (IF-front/src/lib/color.ts).
// Mantido em paridade para que a validacao de tema (themeValidation.js) aplique
// EXATAMENTE as mesmas regras WCAG no servidor. Funcoes puras, cobertas por teste.

function isValidHex(hex) {
  return typeof hex === 'string' && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex.trim());
}

function normalizeHex(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return `#${full.toLowerCase()}`;
}

function parseRgb(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function hexToHsl(hex) {
  const rgb = parseRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(100, Math.max(0, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function relativeLuminance(hex) {
  const rgb = parseRgb(hex);
  if (!rgb) return 0;
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function adjustLightnessForContrast(hex, bgHex, ratio) {
  const hsl = hexToHsl(hex);
  const norm = normalizeHex(hex);
  if (!hsl || !norm) return norm || '#000000';
  if (contrastRatio(norm, bgHex) >= ratio) return norm;

  const step = relativeLuminance(bgHex) > 0.5 ? -1 : 1;
  let l = hsl.l;
  for (let i = 0; i < 100; i += 1) {
    l += step;
    if (l < 0 || l > 100) break;
    const candidate = hslToHex(hsl.h, hsl.s, l);
    if (contrastRatio(candidate, bgHex) >= ratio) return candidate;
  }
  return step < 0 ? hslToHex(hsl.h, hsl.s, 0) : hslToHex(hsl.h, hsl.s, 100);
}

module.exports = {
  isValidHex,
  normalizeHex,
  hexToHsl,
  hslToHex,
  relativeLuminance,
  contrastRatio,
  adjustLightnessForContrast,
};
