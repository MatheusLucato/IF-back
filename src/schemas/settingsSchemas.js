const { z, optionalString } = require('./common');

// Atualizacao das configuracoes da igreja (dados cadastrais + identidade visual).
// Todos os campos sao opcionais (PATCH parcial). `.passthrough()` preserva o
// objeto `settings` (jsonb arbitrario) e qualquer extensao futura sem perder
// dados; o handler so persiste as chaves que conhece.
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
}).passthrough();

module.exports = { updateSettingsSchema };
