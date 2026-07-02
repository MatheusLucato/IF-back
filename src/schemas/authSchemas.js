const { z, trimmedRequired, optionalString } = require('./common');
const { isValidThemeId } = require('../lib/themePresets');
const { isValidCpf, isValidCnpj, isValidPhone } = require('../lib/documents');

const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Onboarding: cria tenant (igreja) + admin + identidade visual. Os campos
// essenciais da igreja (CNPJ, contato, endereço) sao obrigatorios para que a
// tela de Configuracoes nao nasca com lacunas e para garantir CNPJ unico/valido.
const onboardingSchema = z.object({
  admin: z.object({
    name: trimmedRequired('Nome do administrador e obrigatorio.'),
    email: trimmedRequired('Email do administrador e obrigatorio.').refine((v) => EMAIL_RE.test(v.trim()), 'Email do administrador invalido.'),
    password: trimmedRequired('Senha do administrador e obrigatoria.'),
    // Dados essenciais da pessoa: garantem que o admin nasça com o perfil
    // preenchido, igual ao cadastro por convite (inviteRegisterSchema).
    gender: z.enum(['male', 'female'], { message: 'Genero e obrigatorio.' }),
    phone: trimmedRequired('Telefone e obrigatorio.').refine(isValidPhone, 'Telefone invalido.'),
    cpf: trimmedRequired('CPF e obrigatorio.').refine(isValidCpf, 'CPF invalido.'),
  }),
  church: z.object({
    name: trimmedRequired('O nome da igreja e obrigatorio.'),
    tradeName: optionalString,
    cnpj: trimmedRequired('O CNPJ e obrigatorio.').refine(isValidCnpj, 'CNPJ invalido.'),
    phone: optionalString.refine((v) => !isNonEmpty(v) || isValidPhone(v), 'Telefone da igreja invalido.'),
    whatsapp: trimmedRequired('O WhatsApp da igreja e obrigatorio.').refine(isValidPhone, 'WhatsApp da igreja invalido.'),
    email: trimmedRequired('O email da igreja e obrigatorio.').refine((v) => EMAIL_RE.test(v.trim()), 'Email da igreja invalido.'),
    website: optionalString,
    address: trimmedRequired('O endereco da igreja e obrigatorio.'),
    city: trimmedRequired('A cidade e obrigatoria.'),
    state: trimmedRequired('O estado (UF) e obrigatorio.'),
    country: optionalString,
  }).passthrough(),
  // Identidade visual = tema pre-definido (Color Presets). A igreja envia so o id;
  // o handler deriva as cores. `theme` opcional: ausente => tema padrao.
  identity: z.object({
    logoUrl: optionalString,
    theme: optionalString,
  }).passthrough().optional(),
}).superRefine((data, ctx) => {
  const theme = data.identity && data.identity.theme;
  if (isNonEmpty(theme) && !isValidThemeId(theme)) {
    ctx.addIssue({ code: 'custom', path: ['identity', 'theme'], message: 'Tema invalido.' });
  }
});

module.exports = { onboardingSchema };
