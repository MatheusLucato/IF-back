// Catálogo de temas prontos (Color Presets) — espelho CJS de
// IF-front/src/lib/theme-presets.ts. DEVE manter os mesmos ids e cores.
//
// O banco guarda apenas church_settings.theme (o id). O back resolve o id para as
// cores concretas ao ler (mappers.mapChurchSettings) e ao gravar (denormaliza em
// color_* para leitores diretos/legados). Assim, editar um preset aqui atualiza
// todas as igrejas que o usam, sem migração de dados.

const THEME_PRESETS = [
  { id: 'teal_edifico', name: 'Teal Edifico', primary: '#0f766e', secondary: '#2563eb' },
  { id: 'blue_sky', name: 'Azul Celestial', primary: '#1d4ed8', secondary: '#0891b2' },
  { id: 'emerald', name: 'Verde Esmeralda', primary: '#047857', secondary: '#7c3aed' },
  { id: 'forest', name: 'Verde Esperança', primary: '#15803d', secondary: '#b45309' },
  { id: 'petrol', name: 'Azul Petróleo', primary: '#0e7490', secondary: '#4f46e5' },
  { id: 'indigo', name: 'Índigo', primary: '#4338ca', secondary: '#0d9488' },
  { id: 'sapphire', name: 'Azul Safira', primary: '#1e40af', secondary: '#7c3aed' },
  { id: 'royal_purple', name: 'Roxo Majestade', primary: '#6d28d9', secondary: '#db2777' },
  { id: 'plum', name: 'Ameixa', primary: '#86198f', secondary: '#0d9488' },
  { id: 'wine', name: 'Vinho Aliança', primary: '#9f1239', secondary: '#b45309' },
  { id: 'terracotta', name: 'Terracota', primary: '#c2410c', secondary: '#0f766e' },
  { id: 'graphite', name: 'Grafite Elegante', primary: '#334155', secondary: '#0d9488' },
];

const DEFAULT_THEME_ID = 'teal_edifico';

const PRESETS_BY_ID = Object.fromEntries(THEME_PRESETS.map((p) => [p.id, p]));
const THEME_PRESET_IDS = THEME_PRESETS.map((p) => p.id);

function isValidThemeId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRESETS_BY_ID, id);
}

// Sempre devolve um preset: id desconhecido/ausente → tema padrão.
function getThemePreset(id) {
  return (id && PRESETS_BY_ID[id]) || PRESETS_BY_ID[DEFAULT_THEME_ID];
}

// Mapeia um tema para as colunas color_* de church_settings. accent/button/link
// espelham o modelo de 2 cores usado no front (theme.ts): primária alimenta
// primary/button; secundária alimenta secondary/accent/link.
function resolveThemeColors(id) {
  const preset = getThemePreset(id);
  return {
    colorPrimary: preset.primary,
    colorButton: preset.primary,
    colorSecondary: preset.secondary,
    colorAccent: preset.secondary,
    colorLink: preset.secondary,
  };
}

module.exports = {
  THEME_PRESETS,
  THEME_PRESET_IDS,
  DEFAULT_THEME_ID,
  isValidThemeId,
  getThemePreset,
  resolveThemeColors,
};
