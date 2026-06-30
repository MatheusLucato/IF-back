// =============================================================================
// Assistente de IA (F10.3) — geração assistida com os modelos Claude (Anthropic).
// -----------------------------------------------------------------------------
// CHAMADA SEMPRE NO BACKEND: a chave nunca vai ao frontend. O cliente envia
// tópicos/notas e recebe um rascunho EDITÁVEL — revisão humana é obrigatória
// antes de salvar/enviar (combate alucinação). Enviamos só o mínimo necessário
// ao modelo (privacidade/LGPD).
//
// Integração via HTTP direto (Messages API) — coerente com o estilo provider-
// agnóstico do projeto (paymentGateway/notify), sem nova dependência npm.
//
// ⚠️ CREDENCIAL É SUA. Sem ANTHROPIC_API_KEY o serviço responde "não configurado"
//    (PRECONDITION_FAILED) e nada quebra. Defina manualmente no backend:
//
//   ANTHROPIC_API_KEY   chave da API (console.anthropic.com) — server-side
//   ANTHROPIC_MODEL     (opcional) id do modelo; default 'claude-opus-4-8'
// =============================================================================

const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { isMissingRelation } = require('../lib/schemaGuard');

const supabase = getSupabase();

const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
// Default no modelo Claude mais capaz; sobrescrevível por env.
const MODEL = (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8').trim();
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 2048;

// Casos de uso suportados → (rótulo + system prompt em PT-BR). Começamos por
// poucos casos de alto valor e baixo risco; novos casos = nova entrada aqui.
const FEATURES = {
  announcement: {
    label: 'Comunicado',
    system: 'Você é um assistente de comunicação de uma igreja. A partir dos tópicos fornecidos, redija um comunicado claro, acolhedor e objetivo, em português do Brasil, pronto para ser publicado. Use um tom respeitoso e organizado. Não invente datas, nomes, valores ou fatos que não estejam nos tópicos. Devolva apenas o texto do comunicado.',
  },
  meeting_minutes: {
    label: 'Ata de reunião',
    system: 'Você é um secretário de igreja. A partir das notas fornecidas, redija uma ata de reunião formal e bem estruturada, em português do Brasil, com pauta, decisões e encaminhamentos quando presentes. Não invente participantes, decisões ou dados ausentes nas notas. Devolva apenas o texto da ata.',
  },
  summary: {
    label: 'Resumo',
    system: 'Você é um assistente que resume textos para a liderança de uma igreja. Produza um resumo conciso, fiel e em tópicos quando fizer sentido, em português do Brasil. Não acrescente informações que não estejam no texto original. Devolva apenas o resumo.',
  },
  custom: {
    label: 'Instrução livre',
    system: 'Você é um assistente útil para a administração de uma igreja. Responda em português do Brasil de forma clara e objetiva, seguindo a instrução do usuário. Não invente fatos.',
  },
};

function isConfigured() {
  return Boolean(API_KEY);
}

function notConfigured() {
  return AppError.preconditionFailed(
    'Assistente de IA não configurado. Defina ANTHROPIC_API_KEY no ambiente do backend para habilitar as gerações com a Claude.',
  );
}

// Catálogo (sem o system prompt) para a UI montar os botões "gerar com IA".
function listFeatures() {
  return Object.entries(FEATURES).map(([key, { label }]) => ({ key, label }));
}

// Registra uso (controle de custo) sem PII do conteúdo — só metadados de tokens.
// Best-effort: NUNCA quebra a geração (tolera a migração 0040 ausente).
async function logUsage(churchId, userId, { feature, model, usage }) {
  try {
    await supabase.from('ai_usage').insert({
      church_id: churchId,
      user_id: userId || null,
      feature,
      model,
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
    });
  } catch (error) {
    if (!isMissingRelation(error)) {
      // Falha não-fatal: apenas ignora (geração já foi entregue).
    }
  }
}

// Gera um rascunho. `feature` escolhe o system prompt; `input` são os tópicos/
// notas/texto do usuário. Retorna { text, feature, model, usage }.
async function generate(churchId, userId, { feature = 'custom', input, instructions }) {
  if (!isConfigured()) throw notConfigured();
  const preset = FEATURES[feature] || FEATURES.custom;

  // Monta a mensagem do usuário: instrução opcional + conteúdo-fonte.
  const userContent = [
    instructions ? `Instrução adicional: ${instructions}` : null,
    'Conteúdo de base:',
    String(input || '').trim(),
  ].filter(Boolean).join('\n\n');

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: preset.system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (error) {
    throw AppError.badRequest(`Falha ao contatar a IA: ${error.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || `Erro da API de IA (${response.status}).`;
    throw AppError.badRequest(`IA: ${msg}`);
  }

  // Concatena os blocos de texto da resposta (a Messages API devolve `content[]`).
  const text = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    : '';

  if (data.stop_reason === 'refusal') {
    throw AppError.badRequest('A IA recusou esta solicitação por motivos de segurança. Ajuste o conteúdo e tente novamente.');
  }

  await logUsage(churchId, userId, { feature, model: data.model || MODEL, usage: data.usage });

  return { text, feature, model: data.model || MODEL, usage: data.usage || null };
}

module.exports = { isConfigured, listFeatures, generate };
