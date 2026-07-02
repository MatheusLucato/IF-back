const { z, optionalString } = require('./common');
const { isValidThemeId } = require('../lib/themePresets');
const { isValidCnpj, isValidPhone } = require('../lib/documents');

const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Atualizacao das configuracoes da igreja (dados cadastrais + identidade visual).
// Todos os campos sao opcionais (PATCH parcial). `.passthrough()` preserva o
// objeto `settings` (jsonb arbitrario) e qualquer extensao futura sem perder
// dados; o handler so persiste as chaves que conhece.
//
// Identidade visual agora e um TEMA pre-definido (Color Presets): o cliente envia
// so `theme` (o id) e o handler deriva/persiste as cores. As colunas color_* ainda
// sao aceitas (denormalizacao/legado), mas nao sao mais escolhidas livremente.
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
  theme: optionalString,
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
  // Validação de documentos/contatos quando informados (PATCH parcial). A
  // unicidade do CNPJ é garantida no handler + índice funcional (migration 0045).
  if (isNonEmpty(data.cnpj) && !isValidCnpj(data.cnpj)) {
    ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'CNPJ invalido.' });
  }
  if (isNonEmpty(data.email) && !EMAIL_RE.test(data.email.trim())) {
    ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email invalido.' });
  }
  if (isNonEmpty(data.phone) && !isValidPhone(data.phone)) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Telefone invalido.' });
  }
  // WhatsApp e obrigatorio. Como este e um PATCH parcial, so exigimos quando a
  // chave vem no payload (a tela de Configuracoes sempre envia); atualizacoes
  // parciais que nao tocam o contato seguem passando.
  if (data.whatsapp !== undefined && !isNonEmpty(data.whatsapp)) {
    ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'WhatsApp e obrigatorio.' });
  } else if (isNonEmpty(data.whatsapp) && !isValidPhone(data.whatsapp)) {
    ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'WhatsApp invalido.' });
  }

  // Tema pre-definido: quando informado, precisa ser um id conhecido do catalogo
  // (IF-back/src/lib/themePresets.js). As cores em si sao curadas e acessiveis por
  // construcao, entao nao ha mais validacao de contraste de hex avulso.
  if (isNonEmpty(data.theme) && !isValidThemeId(data.theme)) {
    ctx.addIssue({ code: 'custom', path: ['theme'], message: 'Tema invalido.' });
  }
});

module.exports = { updateSettingsSchema };
