const express = require('express');
const { getSupabase } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');
const { AppError } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { updateSettingsSchema } = require('../schemas/settingsSchemas');
const { mapUser } = require('../lib/mappers');
const { getChurchBundle } = require('../services/churchService');
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
  if (Object.keys(churchPatch).length > 0) {
    churchPatch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('churches').update(churchPatch).eq('id', req.churchId);
    if (error) throw new Error(error.message);
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
