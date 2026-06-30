// =============================================================================
// RBAC — Catálogo de permissões (F0.6)
// -----------------------------------------------------------------------------
// Fonte única de verdade das chaves de permissão `<modulo>.<acao>`. O catálogo é
// estático no código (não no banco): novos módulos nascem com suas chaves aqui.
// O banco (tabelas roles/role_permissions) guarda apenas QUAIS chaves cada papel
// configurável tem — as chaves válidas vêm sempre deste arquivo.
//
// Estratégia (ver PLANEJAMENTO-EDIFICO.md, F0.6): introduzir o catálogo + o
// resolvedor `getUserPermissions` mapeando os papéis atuais, e migrar a
// autorização módulo a módulo. "admin = tudo" é um atalho seguro que NUNCA pode
// travar o acesso (ver SUPER_ROLES).
// =============================================================================

// Rótulos das ações (PT-BR) reutilizados na matriz da UI.
const ACTION_LABELS = {
  read: 'Ver',
  write: 'Criar / Editar',
  delete: 'Excluir',
  admin: 'Administrar',
  use: 'Usar',
};

// Módulos e suas ações. `status: 'planned'` marca módulos do roadmap ainda não
// construídos — já entram no catálogo para que cada um nasça com suas chaves,
// e a UI pode sinalizá-los como "em breve".
const MODULES = [
  { key: 'dashboard', label: 'Painel', actions: ['read'], status: 'active' },
  { key: 'ministerios', label: 'Ministérios', actions: ['read', 'write', 'delete'], status: 'active' },
  { key: 'escalas', label: 'Escalas', actions: ['read', 'write', 'delete'], status: 'active' },
  { key: 'repertorio', label: 'Repertório', actions: ['read', 'write'], status: 'active' },
  { key: 'ministros', label: 'Ministros', actions: ['read'], status: 'active' },
  { key: 'usuarios', label: 'Usuários & Aprovações', actions: ['read', 'write', 'delete'], status: 'active' },
  { key: 'configuracoes', label: 'Configurações', actions: ['read', 'write'], status: 'active' },
  { key: 'papeis', label: 'Papéis & Permissões', actions: ['read', 'write'], status: 'active' },
  { key: 'membros', label: 'Membros (Pessoas)', actions: ['read', 'write', 'delete'], status: 'active' },
  // Convites por link (0042): quem pode gerar/listar/revogar links de ingresso.
  { key: 'convites', label: 'Convites', actions: ['read', 'write'], status: 'active' },
  { key: 'secretaria', label: 'Secretaria', actions: ['read', 'write'], status: 'active' },
  { key: 'eventos', label: 'Eventos', actions: ['read', 'write', 'delete'], status: 'active' },
  { key: 'ensino', label: 'Ensino (EBD)', actions: ['read', 'write', 'delete'], status: 'active' },
  // Financeiro (Fase 5/6): `admin` cobre plano de contas, fundos, fechamento e
  // reabertura de período; `write` o operacional (lançamentos, baixas, recibos).
  { key: 'financeiro', label: 'Financeiro', actions: ['read', 'write', 'delete', 'admin'], status: 'active' },
  { key: 'comunicacao', label: 'Comunicação', actions: ['read', 'write'], status: 'active' },
  { key: 'auditoria', label: 'Auditoria', actions: ['read'], status: 'active' },
  // Inteligência (Fase 10): painel executivo + relatórios cruzados. KPIs e
  // relatórios financeiros ainda exigem `financeiro.read` (refino no handler).
  { key: 'relatorios', label: 'Painel & Relatórios', actions: ['read'], status: 'active' },
  // IA (F10.3): ação `use` libera as gerações assistidas pela Claude. Plano/feature
  // (F9.1) pode restringir depois.
  { key: 'ia', label: 'Assistente de IA', actions: ['use'], status: 'active' },
];

// Catálogo expandido (consumido por GET /api/permissions e pela matriz no front).
const PERMISSION_CATALOG = MODULES.map((module) => ({
  key: module.key,
  label: module.label,
  status: module.status,
  actions: module.actions.map((action) => ({
    action,
    key: `${module.key}.${action}`,
    label: ACTION_LABELS[action] || action,
  })),
}));

// Lista achatada de TODAS as chaves válidas.
const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((module) => module.actions.map((a) => a.key));
const ALL_PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

// Papéis "super": sempre recebem TODAS as permissões da igreja, independentemente
// do que estiver no banco. É o atalho seguro contra travamento de acesso.
const SUPER_ROLES = ['admin', 'pastor', 'plataforma_admin'];

// Mapa padrão papel-legado → permissões. Usado como fallback de ENFORCEMENT
// quando o usuário ainda não tem um papel configurável (users.role_id) ou quando
// a migração 0002 ainda não foi aplicada. Reflete o comportamento atual do app.
// IMPORTANTE: manter em sincronia com o seed de papéis-sistema da migração 0002.
const DEFAULT_ROLE_PERMISSIONS = {
  // admin/pastor/plataforma_admin caem no atalho SUPER_ROLES (tudo). Listados
  // aqui apenas por completude/documentação.
  admin: [...ALL_PERMISSION_KEYS],
  pastor: [...ALL_PERMISSION_KEYS],
  plataforma_admin: [...ALL_PERMISSION_KEYS],
  lider: [
    'dashboard.read',
    'membros.read',
    'ministerios.read', 'ministerios.write',
    'escalas.read', 'escalas.write',
    'repertorio.read', 'repertorio.write',
    'ministros.read',
    // Módulos de comunidade (Onda 3): líderes operam eventos, ensino e comunicação.
    'eventos.read', 'eventos.write',
    'ensino.read', 'ensino.write',
    'comunicacao.read', 'comunicacao.write',
    'secretaria.read',
    // Inteligência (Onda 6): líderes acessam painel/relatórios e usam a IA.
    'relatorios.read',
    'ia.use',
  ],
  membro: [
    'dashboard.read',
    'ministerios.read',
    'ministros.read',
    'eventos.read',
    'comunicacao.read',
  ],
};

function isSuperRole(role) {
  return SUPER_ROLES.includes(role);
}

function isValidPermissionKey(key) {
  return ALL_PERMISSION_KEY_SET.has(key);
}

// Mantém apenas chaves válidas e remove duplicadas (saneamento de entrada).
function sanitizePermissionKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter((key) => isValidPermissionKey(key)))];
}

function defaultPermissionsForRole(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] ? [...DEFAULT_ROLE_PERMISSIONS[role]] : [];
}

module.exports = {
  ACTION_LABELS,
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  SUPER_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  isSuperRole,
  isValidPermissionKey,
  sanitizePermissionKeys,
  defaultPermissionsForRole,
};
