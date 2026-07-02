const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { updateSettingsSchema } = require('../schemas/settingsSchemas');
const { mapUser } = require('../lib/mappers');
const { onlyDigits, isValidCnpj, formatCnpj, formatPhone } = require('../lib/documents');
const { getChurchBundle } = require('../services/churchService');
const { isValidThemeId, resolveThemeColors } = require('../lib/themePresets');
const { getUserPermissions } = require('../services/permissionService');
const { uploadAsset } = require('../services/storage');
const { upload } = require('../middleware/upload');

const router = express.Router();
const supabase = getSupabase();

// Sessao atual: perfil + igreja + configuracoes + permissoes efetivas (RBAC,
// F0.6 — o front esconde menus/acoes a partir desta lista).
router.get('/auth/me', asyncHandler(async (req, res) => {
  const { church, settings } = await getChurchBundle(req.churchId);
  const permissions = await getUserPermissions(req.user);
  return res.json({ user: mapUser(req.user), church, settings, permissions: [...permissions] });
}));

// Configuracoes da igreja.
router.get('/settings', asyncHandler(async (req, res) => {
  const { church, settings } = await getChurchBundle(req.churchId);
  return res.json({ church, settings });
}));

router.patch('/settings', validate(updateSettingsSchema), asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador da igreja pode alterar as configuracoes.');
  }
  const body = req.body || {};

  const churchPatch = {};
  const churchFields = {
    name: 'name', tradeName: 'trade_name', cnpj: 'cnpj', phone: 'phone', whatsapp: 'whatsapp',
    email: 'email', website: 'website', address: 'address', city: 'city', state: 'state', country: 'country',
  };
  for (const [key, column] of Object.entries(churchFields)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) churchPatch[column] = body[key];
  }

  // Normalização/validação de documentos e contatos (paridade com o onboarding):
  // grava a forma canônica (máscara) e mantém o CNPJ único entre as igrejas.
  if (Object.prototype.hasOwnProperty.call(churchPatch, 'cnpj')) {
    const digits = onlyDigits(churchPatch.cnpj);
    if (!digits) {
      churchPatch.cnpj = null;
    } else {
      if (!isValidCnpj(digits)) throw AppError.badRequest('CNPJ inválido.');
      const formatted = formatCnpj(digits);
      const { data: dupe } = await supabase
        .from('churches').select('id').eq('cnpj', formatted).neq('id', req.churchId).limit(1);
      if (dupe && dupe.length > 0) throw AppError.conflict('Já existe uma igreja cadastrada com este CNPJ.');
      churchPatch.cnpj = formatted;
    }
  }
  if (Object.prototype.hasOwnProperty.call(churchPatch, 'phone')) {
    churchPatch.phone = churchPatch.phone ? formatPhone(churchPatch.phone) : null;
  }
  if (Object.prototype.hasOwnProperty.call(churchPatch, 'whatsapp')) {
    churchPatch.whatsapp = churchPatch.whatsapp ? formatPhone(churchPatch.whatsapp) : null;
  }
  if (Object.prototype.hasOwnProperty.call(churchPatch, 'email') && churchPatch.email) {
    churchPatch.email = String(churchPatch.email).trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(churchPatch, 'state') && churchPatch.state) {
    churchPatch.state = String(churchPatch.state).trim().toUpperCase().slice(0, 2);
  }

  if (Object.keys(churchPatch).length > 0) {
    churchPatch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('churches').update(churchPatch).eq('id', req.churchId);
    if (error) {
      if (error.code === '23505') throw AppError.conflict('Já existe uma igreja cadastrada com este CNPJ.');
      throw new Error(error.message);
    }
  }

  const settingsPatch = {};
  const settingsFields = {
    logoUrl: 'logo_url', logoCompactUrl: 'logo_compact_url', faviconUrl: 'favicon_url', coverUrl: 'cover_url',
    colorPrimary: 'color_primary', colorSecondary: 'color_secondary', colorAccent: 'color_accent',
    colorButton: 'color_button', colorLink: 'color_link', language: 'language', timezone: 'timezone',
    dateFormat: 'date_format', settings: 'settings',
  };
  for (const [key, column] of Object.entries(settingsFields)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) settingsPatch[column] = body[key];
  }

  // Tema pré-definido (Color Presets): a igreja escolhe só o id; o back deriva e
  // persiste as cores. `theme` é a fonte da verdade; color_* fica denormalizado
  // para leitores diretos/legados. Vem por último para vencer cores avulsas.
  // Ver IF-front/src/lib/theme-presets.ts.
  if (isValidThemeId(body.theme)) {
    const c = resolveThemeColors(body.theme);
    settingsPatch.theme = body.theme;
    settingsPatch.color_primary = c.colorPrimary;
    settingsPatch.color_secondary = c.colorSecondary;
    settingsPatch.color_accent = c.colorAccent;
    settingsPatch.color_button = c.colorButton;
    settingsPatch.color_link = c.colorLink;
  }

  if (Object.keys(settingsPatch).length > 0) {
    settingsPatch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('church_settings').update(settingsPatch).eq('church_id', req.churchId);
    if (error) throw new Error(error.message);
  }

  const { church, settings } = await getChurchBundle(req.churchId);
  return res.json({ church, settings });
}));

// Upload de assets de identidade visual (logo, favicon, capa) → Cloudflare R2
// (com fallback para data URL enquanto as envs do R2 não estiverem definidas).
router.post('/settings/assets', upload.single('file'), asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Apenas o administrador da igreja pode enviar assets.');
  }
  if (!req.file) {
    throw AppError.badRequest('Arquivo e obrigatorio.');
  }
  const mime = req.file.mimetype || 'application/octet-stream';
  const { url } = await uploadAsset({
    buffer: req.file.buffer,
    mime,
    churchId: req.churchId,
    category: 'branding',
  });
  return res.json({ url });
}));

module.exports = router;
