'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validateThemeColors } = require('../src/lib/themeValidation');
const { contrastRatio } = require('../src/lib/color');
const { updateSettingsSchema } = require('../src/schemas/settingsSchemas');

test('validateThemeColors aprova um par com bom contraste', () => {
  const r = validateThemeColors({ primary: '#0f766e', secondary: '#2563eb' });
  assert.equal(r.ok, true);
  assert.equal(r.issues.length, 0);
});

test('validateThemeColors bloqueia branco sobre branco', () => {
  const r = validateThemeColors({ primary: '#ffffff', secondary: '#ffffff' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'low_contrast_background'));
});

test('validateThemeColors bloqueia hex invalido', () => {
  const r = validateThemeColors({ primary: '#zzzzzz', secondary: '#2563eb' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.field === 'primary' && i.code === 'invalid_hex'));
});

test('validateThemeColors bloqueia cores quase identicas', () => {
  const r = validateThemeColors({ primary: '#2563eb', secondary: '#2a66ec' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'colors_too_similar'));
});

test('a sugestao devolvida realmente passa no contraste', () => {
  const r = validateThemeColors({ primary: '#bfe3df', secondary: '#2563eb' });
  const issue = r.issues.find((i) => i.field === 'primary' && i.suggestion);
  assert.ok(issue);
  assert.ok(contrastRatio(issue.suggestion, '#ffffff') >= 4.5);
});

// --- Enforcement via schema (paridade com o front) ---

test('updateSettingsSchema rejeita tema inacessivel com issues por campo', () => {
  const r = updateSettingsSchema.safeParse({ colorButton: '#ffffff', colorSecondary: '#ffffff' });
  assert.equal(r.success, false);
  const paths = r.error.issues.map((i) => i.path.join('.'));
  assert.ok(paths.includes('colorPrimary') || paths.includes('colorSecondary'));
});

test('updateSettingsSchema aceita tema acessivel', () => {
  const r = updateSettingsSchema.safeParse({ colorButton: '#0f766e', colorPrimary: '#0f766e', colorSecondary: '#2563eb' });
  assert.equal(r.success, true);
});

test('updateSettingsSchema ignora validacao de tema quando o PATCH nao mexe nas cores', () => {
  const r = updateSettingsSchema.safeParse({ name: 'Igreja Teste' });
  assert.equal(r.success, true);
});
