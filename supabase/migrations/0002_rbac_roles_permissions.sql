-- =============================================================================
-- Edifico — Migration 0002 · rbac_roles_permissions
-- -----------------------------------------------------------------------------
-- RBAC granular (F0.6): papéis configuráveis por igreja + matriz de permissões
-- por módulo/ação. Mantém `users.role` (papel legado) durante a transição e
-- adiciona `users.role_id` apontando para o novo papel configurável.
--
-- Modelo:
--   * roles            — papéis por tenant (is_system marca os 4 papéis-base).
--   * role_permissions — chaves `<modulo>.<acao>` concedidas a cada papel.
--   * users.role_id    — papel configurável do usuário (nullable; FK SET NULL).
--
-- O catálogo de chaves de permissão é definido no CÓDIGO
-- (IF-back/src/lib/permissions.js). O backend valida toda chave contra ele. O
-- seed abaixo dos papéis-sistema reflete IF-back/src/lib/permissions.js
-- (DEFAULT_ROLE_PERMISSIONS) — manter os dois em sincronia.
--
-- SEGURANÇA: "admin = tudo" é um atalho no código (SUPER_ROLES) que NUNCA
-- depende deste banco — então rodar (ou não) este seed não trava o acesso do
-- administrador. Usuários sem role_id usam o mapa padrão por papel legado.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar. Convenção: ver docs/CONVENCAO-BANCO.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de papéis (por tenant).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,                       -- estável; usado no fallback por papel legado
  description text,
  is_system   boolean NOT NULL DEFAULT false,      -- papéis-base não podem ser excluídos
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (church_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_roles_church_id ON roles(church_id);

-- -----------------------------------------------------------------------------
-- 2. Permissões concedidas a cada papel (chave `<modulo>.<acao>`).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  church_id      uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id   ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_church_id ON role_permissions(church_id);

-- -----------------------------------------------------------------------------
-- 3. Vínculo do usuário ao papel configurável (mantém users.role legado).
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- -----------------------------------------------------------------------------
-- 4. RLS — isolamento por tenant (mesma política das demais tabelas).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  rbac_tables text[] := ARRAY['roles', 'role_permissions'];
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  FOREACH tbl IN ARRAY rbac_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
      FOR ALL TO authenticated
      USING (%s)
      WITH CHECK (%s);
    $f$, tbl, predicate, predicate);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Seed dos papéis-sistema por igreja (4 papéis-base por tenant).
-- -----------------------------------------------------------------------------
INSERT INTO roles (church_id, name, slug, description, is_system)
SELECT c.id, r.name, r.slug, r.description, true
FROM churches c
CROSS JOIN (VALUES
  ('Administrador', 'admin',  'Acesso total à igreja.'),
  ('Pastor',        'pastor', 'Acesso total à igreja.'),
  ('Líder',         'lider',  'Gerencia ministérios, escalas e repertório.'),
  ('Membro',        'membro', 'Acesso básico de visualização.')
) AS r(name, slug, description)
ON CONFLICT (church_id, slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Seed das permissões dos papéis-sistema.
--    (Reflete DEFAULT_ROLE_PERMISSIONS em IF-back/src/lib/permissions.js.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  all_keys text[] := ARRAY[
    'dashboard.read',
    'ministerios.read', 'ministerios.write', 'ministerios.delete',
    'escalas.read', 'escalas.write', 'escalas.delete',
    'repertorio.read', 'repertorio.write',
    'ministros.read',
    'usuarios.read', 'usuarios.write', 'usuarios.delete',
    'configuracoes.read', 'configuracoes.write',
    'papeis.read', 'papeis.write',
    'membros.read', 'membros.write', 'membros.delete',
    'secretaria.read', 'secretaria.write',
    'eventos.read', 'eventos.write', 'eventos.delete',
    'ensino.read', 'ensino.write', 'ensino.delete',
    'financeiro.read', 'financeiro.write', 'financeiro.delete',
    'comunicacao.read', 'comunicacao.write',
    'auditoria.read'
  ];
  lider_keys text[] := ARRAY[
    'dashboard.read',
    'membros.read',
    'ministerios.read', 'ministerios.write',
    'escalas.read', 'escalas.write',
    'repertorio.read', 'repertorio.write',
    'ministros.read'
  ];
  membro_keys text[] := ARRAY[
    'dashboard.read',
    'ministerios.read',
    'ministros.read'
  ];
BEGIN
  -- admin + pastor → todas as permissões.
  INSERT INTO role_permissions (role_id, permission_key, church_id)
  SELECT ro.id, k.key, ro.church_id
  FROM roles ro
  CROSS JOIN unnest(all_keys) AS k(key)
  WHERE ro.is_system AND ro.slug IN ('admin', 'pastor')
  ON CONFLICT (role_id, permission_key) DO NOTHING;

  -- líder.
  INSERT INTO role_permissions (role_id, permission_key, church_id)
  SELECT ro.id, k.key, ro.church_id
  FROM roles ro
  CROSS JOIN unnest(lider_keys) AS k(key)
  WHERE ro.is_system AND ro.slug = 'lider'
  ON CONFLICT (role_id, permission_key) DO NOTHING;

  -- membro.
  INSERT INTO role_permissions (role_id, permission_key, church_id)
  SELECT ro.id, k.key, ro.church_id
  FROM roles ro
  CROSS JOIN unnest(membro_keys) AS k(key)
  WHERE ro.is_system AND ro.slug = 'membro'
  ON CONFLICT (role_id, permission_key) DO NOTHING;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Backfill: vincula cada usuário ao papel-sistema correspondente ao seu
--    papel legado (apenas quem ainda não tem role_id). plataforma_admin fica
--    sem role_id (cai no atalho SUPER_ROLES no código).
-- -----------------------------------------------------------------------------
UPDATE users u
SET role_id = ro.id
FROM roles ro
WHERE ro.church_id = u.church_id
  AND ro.is_system
  AND ro.slug = u.role::text
  AND u.role_id IS NULL
  AND u.role::text IN ('admin', 'pastor', 'lider', 'membro');

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0002', 'rbac_roles_permissions')
ON CONFLICT (version) DO NOTHING;
