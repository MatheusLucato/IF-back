'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  THEME_PRESETS,
  THEME_PRESET_IDS,
  DEFAULT_THEME_ID,
  isValidThemeId,
  getThemePreset,
  resolveThemeColors,
} = require('../src/lib/themePresets');
const { validateThemeColors } = require('../src/lib/themeValidation');

test('ids dos temas sao unicos', () => {
  assert.equal(new Set(THEME_PRESET_IDS).size, THEME_PRESET_IDS.length);
});

test('o tema padrao existe no catalogo', () => {
  assert.ok(isValidThemeId(DEFAULT_THEME_ID));
});

test('todo tema passa na validacao WCAG (contraste/harmonia)', () => {
  for (const preset of THEME_PRESETS) {
    const r = validateThemeColors({ primary: preset.primary, secondary: preset.secondary });
    assert.ok(r.ok, `tema ${preset.id} inacessivel: ${JSON.stringify(r.issues)}`);
  }
});

test('getThemePreset cai no padrao para id invalido', () => {
  assert.equal(getThemePreset('inexistente').id, DEFAULT_THEME_ID);
  assert.equal(getThemePreset(null).id, DEFAULT_THEME_ID);
});

test('resolveThemeColors deriva as colunas color_* a partir do tema', () => {
  const c = resolveThemeColors('teal_edifico');
  assert.equal(c.colorPrimary, '#0f766e');
  assert.equal(c.colorButton, '#0f766e');
  assert.equal(c.colorSecondary, '#2563eb');
  assert.equal(c.colorAccent, '#2563eb');
  assert.equal(c.colorLink, '#2563eb');
});

// Guardrail anti-drift: o catalogo do front (fonte da verdade da UI) e o do back
// (usado no read/write) precisam ter os MESMOS ids e cores. Extrai id/primary/
// secondary do arquivo TS por regex — se a estrutura mudar, este teste avisa.
test('catalogo do back esta em paridade com o do front', () => {
  const tsPath = path.join(__dirname, '..', '..', 'IF-front', 'src', 'lib', 'theme-presets.ts');
  if (!fs.existsSync(tsPath)) {
    // Front nao disponivel neste checkout (ex.: deploy so do back): pula.
    return;
  }
  const src = fs.readFileSync(tsPath, 'utf8');
  const re = /id:\s*'([^']+)'[^}]*?primary:\s*'(#[0-9a-fA-F]{6})'[^}]*?secondary:\s*'(#[0-9a-fA-F]{6})'/g;
  const frontById = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    frontById.set(m[1], { primary: m[2].toLowerCase(), secondary: m[3].toLowerCase() });
  }

  assert.equal(frontById.size, THEME_PRESETS.length, 'quantidade de temas difere entre front e back');
  for (const preset of THEME_PRESETS) {
    const front = frontById.get(preset.id);
    assert.ok(front, `tema ${preset.id} ausente no front`);
    assert.equal(preset.primary.toLowerCase(), front.primary, `primary difere em ${preset.id}`);
    assert.equal(preset.secondary.toLowerCase(), front.secondary, `secondary difere em ${preset.id}`);
  }
});
