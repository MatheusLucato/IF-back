const { getSupabase } = require('../db');
const { AppError } = require('../lib/errors');
const { mapDocumentTemplate, mapIssuedDocument, mapInstitutionDocument, mapMember, mapChurch } = require('../lib/mappers');
const { MEMBER_SELECT } = require('../lib/constants');
const { isMissingRelation, migrationPending } = require('../lib/schemaGuard');

const supabase = getSupabase();
const MIGRATION = '0008_secretaria.sql';

const TEMPLATE_SELECT = 'id,church_id,name,type,description,body,is_active,created_by,created_at,updated_at';
const ISSUED_SELECT = 'id,church_id,member_id,template_id,title,type,rendered_content,file_url,issued_by,issued_at';
const INST_SELECT = 'id,church_id,title,category,description,file_url,uploaded_by,created_at,updated_at';

// Formata uma data ISO (YYYY-MM-DD ou timestamp) para dd/mm/aaaa pt-BR.
function formatDate(value) {
  if (!value) return '';
  const str = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return String(value);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const GENDER_LABELS = { male: 'Masculino', female: 'Feminino', other: 'Outro' };
const MARITAL_LABELS = {
  single: 'Solteiro(a)', married: 'Casado(a)', divorced: 'Divorciado(a)',
  widowed: 'Viúvo(a)', stable_union: 'União estável',
};

// Catálogo de variáveis disponíveis para os modelos (consumido pela UI).
const TEMPLATE_VARIABLES = [
  { key: 'nome', label: 'Nome completo' },
  { key: 'nome_social', label: 'Nome social' },
  { key: 'cpf', label: 'CPF' },
  { key: 'rg', label: 'RG' },
  { key: 'email', label: 'E-mail' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'genero', label: 'Gênero' },
  { key: 'estado_civil', label: 'Estado civil' },
  { key: 'data_nascimento', label: 'Data de nascimento' },
  { key: 'data_batismo', label: 'Data de batismo' },
  { key: 'data_conversao', label: 'Data de conversão' },
  { key: 'data_membresia', label: 'Data de recepção como membro' },
  { key: 'endereco', label: 'Endereço completo' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'igreja', label: 'Nome da igreja' },
  { key: 'igreja_cidade', label: 'Cidade da igreja' },
  { key: 'igreja_estado', label: 'Estado da igreja' },
  { key: 'data_hoje', label: 'Data de hoje' },
];

function buildAddress(member) {
  if (!member) return '';
  const parts = [
    [member.address_street, member.address_number].filter(Boolean).join(', '),
    member.address_complement,
    member.address_district,
    [member.address_city, member.address_state].filter(Boolean).join('/'),
    member.address_zip ? `CEP ${member.address_zip}` : null,
  ].filter(Boolean);
  return parts.join(' - ');
}

// Monta o dicionário de valores das variáveis a partir da pessoa + igreja.
function buildVariableValues(member, church) {
  return {
    nome: member?.full_name || '',
    nome_social: member?.social_name || '',
    cpf: member?.cpf || '',
    rg: member?.rg || '',
    email: member?.email || '',
    telefone: member?.phone || member?.whatsapp || '',
    genero: GENDER_LABELS[member?.gender] || '',
    estado_civil: MARITAL_LABELS[member?.marital_status] || '',
    data_nascimento: formatDate(member?.birth_date),
    data_batismo: formatDate(member?.baptism_date),
    data_conversao: formatDate(member?.conversion_date),
    data_membresia: formatDate(member?.joined_at),
    endereco: buildAddress(member),
    cidade: member?.address_city || '',
    igreja: church?.trade_name || church?.name || '',
    igreja_cidade: church?.city || '',
    igreja_estado: church?.state || '',
    data_hoje: formatDate(new Date().toISOString()),
  };
}

// Substitui {{chave}} pelos valores. Render simples por chave (sem eval) — evita
// injeção: chaves desconhecidas viram string vazia.
function renderTemplate(body, values) {
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : '';
  });
}

async function getChurchRow(churchId) {
  const { data } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle();
  return data || null;
}

async function getMemberRow(memberId, churchId) {
  if (!memberId) return null;
  const { data } = await supabase
    .from('members').select(MEMBER_SELECT).eq('id', memberId).eq('church_id', churchId).maybeSingle();
  return data || null;
}

// =============================== F2.1 — Templates ===========================

async function listTemplates(churchId) {
  const { data, error } = await supabase
    .from('document_templates').select(TEMPLATE_SELECT)
    .eq('church_id', churchId).order('name', { ascending: true });
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapDocumentTemplate);
}

async function createTemplate(churchId, input, createdBy) {
  const payload = {
    church_id: churchId,
    name: input.name,
    type: input.type || 'other',
    description: input.description ?? null,
    body: input.body ?? '',
    created_by: createdBy || null,
  };
  if (typeof input.isActive === 'boolean') payload.is_active = input.isActive;
  const { data, error } = await supabase
    .from('document_templates').insert(payload).select(TEMPLATE_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapDocumentTemplate(data);
}

async function updateTemplate(id, churchId, input) {
  const payload = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.type !== undefined) payload.type = input.type;
  if (input.description !== undefined) payload.description = input.description;
  if (input.body !== undefined) payload.body = input.body;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  if (Object.keys(payload).length === 0) {
    const { data } = await supabase.from('document_templates').select(TEMPLATE_SELECT)
      .eq('id', id).eq('church_id', churchId).maybeSingle();
    return data ? mapDocumentTemplate(data) : null;
  }
  const { data, error } = await supabase
    .from('document_templates').update(payload)
    .eq('id', id).eq('church_id', churchId).select(TEMPLATE_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapDocumentTemplate(data) : null;
}

async function deleteTemplate(id, churchId) {
  const { data, error } = await supabase
    .from('document_templates').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function getTemplateRow(id, churchId) {
  const { data, error } = await supabase
    .from('document_templates').select(TEMPLATE_SELECT)
    .eq('id', id).eq('church_id', churchId).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data || null;
}

// Renderiza um modelo (por id ou corpo avulso) para uma pessoa → texto pronto.
async function renderDocument(churchId, { templateId, body, memberId }) {
  let templateBody = body;
  let template = null;
  if (templateId) {
    template = await getTemplateRow(templateId, churchId);
    if (!template) throw AppError.notFound('Modelo não encontrado.');
    if (templateBody === undefined) templateBody = template.body;
  }
  const member = await getMemberRow(memberId, churchId);
  const church = await getChurchRow(churchId);
  const values = buildVariableValues(member, church);
  return {
    template: template ? mapDocumentTemplate(template) : null,
    content: renderTemplate(templateBody, values),
    values,
  };
}

// =============================== F2.2 — Emissão =============================

async function listIssuedDocuments(churchId, { memberId } = {}) {
  let query = supabase
    .from('issued_documents').select(ISSUED_SELECT)
    .eq('church_id', churchId).order('issued_at', { ascending: false });
  if (memberId) query = query.eq('member_id', memberId);
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapIssuedDocument);
}

// Emite (registra) um documento para uma pessoa. Renderiza no servidor a partir
// do template (ou usa o snapshot enviado pelo front) e arquiva o conteúdo.
async function issueDocument(churchId, memberId, input, issuedBy) {
  const member = await getMemberRow(memberId, churchId);
  if (!member) throw AppError.notFound('Pessoa não encontrada.');

  let rendered = input.renderedContent;
  let type = input.type;
  let title = input.title;

  if (rendered === undefined || input.templateId) {
    const result = await renderDocument(churchId, {
      templateId: input.templateId,
      body: input.body,
      memberId,
    });
    if (rendered === undefined) rendered = result.content;
    if (!type && result.template) type = result.template.type;
    if (!title && result.template) title = result.template.name;
  }

  const payload = {
    church_id: churchId,
    member_id: memberId,
    template_id: input.templateId || null,
    title: title || 'Documento',
    type: type || 'other',
    rendered_content: rendered || '',
    issued_by: issuedBy || null,
  };

  const { data, error } = await supabase
    .from('issued_documents').insert(payload).select(ISSUED_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  const mapped = mapIssuedDocument(data);
  mapped.memberName = member.full_name;
  return mapped;
}

async function deleteIssuedDocument(id, churchId) {
  const { data, error } = await supabase
    .from('issued_documents').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// =============================== F2.4 — Institucionais ======================

async function listInstitutionDocuments(churchId, { category } = {}) {
  let query = supabase
    .from('institution_documents').select(INST_SELECT)
    .eq('church_id', churchId).order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return (data || []).map(mapInstitutionDocument);
}

async function createInstitutionDocument(churchId, input, uploadedBy) {
  const payload = {
    church_id: churchId,
    title: input.title,
    category: input.category || 'outro',
    description: input.description ?? null,
    file_url: input.fileUrl,
    uploaded_by: uploadedBy || null,
  };
  const { data, error } = await supabase
    .from('institution_documents').insert(payload).select(INST_SELECT).single();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return mapInstitutionDocument(data);
}

async function updateInstitutionDocument(id, churchId, input) {
  const payload = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.category !== undefined) payload.category = input.category;
  if (input.description !== undefined) payload.description = input.description;
  if (input.fileUrl !== undefined) payload.file_url = input.fileUrl;
  const { data, error } = await supabase
    .from('institution_documents').update(payload)
    .eq('id', id).eq('church_id', churchId).select(INST_SELECT).maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return data ? mapInstitutionDocument(data) : null;
}

async function deleteInstitutionDocument(id, churchId) {
  const { data, error } = await supabase
    .from('institution_documents').delete().eq('id', id).eq('church_id', churchId).select('id').maybeSingle();
  if (isMissingRelation(error)) throw migrationPending(MIGRATION);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// =============================== F2.3 — Histórico ==========================
// Agrega marcos de jornada (member_events, F1.5) + documentos emitidos (F2.2)
// numa única timeline read-only. Best-effort: ausência de uma fonte não quebra.

async function getMemberHistory(memberId, churchId) {
  const entries = [];

  const { data: events } = await supabase
    .from('member_events')
    .select('id,type,event_date,title,notes,created_at')
    .eq('church_id', churchId).eq('member_id', memberId);
  for (const e of events || []) {
    entries.push({
      kind: 'event',
      id: e.id,
      date: e.event_date || (e.created_at ? String(e.created_at).slice(0, 10) : null),
      eventType: e.type,
      title: e.title || null,
      notes: e.notes || null,
    });
  }

  const { data: docs } = await supabase
    .from('issued_documents')
    .select('id,title,type,issued_at')
    .eq('church_id', churchId).eq('member_id', memberId);
  for (const d of docs || []) {
    entries.push({
      kind: 'document',
      id: d.id,
      date: d.issued_at ? String(d.issued_at).slice(0, 10) : null,
      documentType: d.type,
      title: d.title,
      notes: null,
    });
  }

  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return entries;
}

module.exports = {
  TEMPLATE_VARIABLES,
  getMemberHistory,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateRow,
  renderDocument,
  listIssuedDocuments,
  issueDocument,
  deleteIssuedDocument,
  listInstitutionDocuments,
  createInstitutionDocument,
  updateInstitutionDocument,
  deleteInstitutionDocument,
};
