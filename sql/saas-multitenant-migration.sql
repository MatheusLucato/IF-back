-- =============================================================================
-- [SUPERADO — HISTÓRICO] Consolidado na baseline versionada em
-- ../supabase/migrations/0001_baseline.sql (fase F0.2). Mantido só como
-- referência. A fonte de verdade do schema agora são as migrations
-- (ver ../supabase/migrations/README.md).
-- =============================================================================

-- =============================================================================
-- Edifico — Migração para arquitetura multi-tenant (White Label SaaS)
-- Execute no SQL Editor do Supabase APÓS o supabase-schema.sql.
--
-- Estratégia (ver memória do projeto: saas-refactor-decisions):
--   * Schema único + coluna church_id em todas as tabelas + RLS.
--   * Supabase Auth como identidade. Em vez de remapear users.id (o que
--     quebraria todas as FKs existentes), adicionamos users.auth_user_id
--     que aponta para auth.users(id). FKs atuais permanecem válidas.
--   * O backend usa a service-role key (que BYPASSA o RLS). Portanto o
--     scoping por church_id no código continua obrigatório; o RLS aqui é
--     defesa em profundidade para qualquer acesso direto/anon.
--
-- Idempotente: pode ser reexecutada com segurança.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Papéis (roles) — estende o enum existente sem quebrar dados.
--    admin (= administrador da igreja), lider, membro já existem.
--    Adicionamos pastor e plataforma_admin (super admin do SaaS).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
                 JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_role' AND e.enumlabel = 'pastor') THEN
    ALTER TYPE user_role ADD VALUE 'pastor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
                 JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_role' AND e.enumlabel = 'plataforma_admin') THEN
    ALTER TYPE user_role ADD VALUE 'plataforma_admin';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Entidade Tenant: churches
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS churches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                       -- razão social / nome oficial
  trade_name  text,                                -- nome fantasia (opcional)
  cnpj        text,
  phone       text,
  whatsapp    text,
  email       text,
  website     text,
  address     text,
  city        text,
  state       text,
  country     text DEFAULT 'Brasil',
  slug        text UNIQUE,                          -- p/ futuro subdomínio/path
  status      text NOT NULL DEFAULT 'active',       -- active | trialing | suspended
  plan        text NOT NULL DEFAULT 'free',         -- gancho p/ billing futuro
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churches_status ON churches(status);
CREATE INDEX IF NOT EXISTS idx_churches_slug ON churches(slug);

-- -----------------------------------------------------------------------------
-- 3. Configurações da igreja (1:1) — identidade visual, tema e extensível.
--    Campos estáveis em colunas; o resto em settings (jsonb) p/ evitar
--    dezenas de colunas no futuro.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS church_settings (
  church_id        uuid PRIMARY KEY REFERENCES churches(id) ON DELETE CASCADE,
  -- Identidade visual
  logo_url         text,
  logo_compact_url text,
  favicon_url      text,
  cover_url        text,
  -- Tema (cores em HSL "H S% L%" ou HEX; o front converte p/ CSS vars)
  color_primary    text NOT NULL DEFAULT '#0a0a0a',
  color_secondary  text NOT NULL DEFAULT '#f5f5f5',
  color_accent     text NOT NULL DEFAULT '#2563eb',
  color_button     text NOT NULL DEFAULT '#0a0a0a',
  color_link       text NOT NULL DEFAULT '#2563eb',
  -- Localização/preferências
  language         text NOT NULL DEFAULT 'pt-BR',
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo',
  date_format      text NOT NULL DEFAULT 'dd/MM/yyyy',
  -- Extensível p/ configurações futuras
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. Vínculo Supabase Auth ↔ profile, e church_id em users.
--    auth_user_id liga o profile (users) ao auth.users do Supabase.
-- -----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. church_id nas demais entidades.
-- -----------------------------------------------------------------------------
ALTER TABLE ministries
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE user_unavailable_dates
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE repertoire_songs
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;

-- Tabelas de junção: church_id direto simplifica e blinda o RLS.
ALTER TABLE ministry_members
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE ministry_ministers
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE ministry_admins
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE ministry_repertoire
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 6. Backfill: cria UMA igreja padrão e vincula todos os dados existentes.
--    Preserva a instalação atual como o primeiro tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  default_church_id uuid;
BEGIN
  -- Só cria igreja padrão se houver dados órfãos (users sem church_id).
  IF EXISTS (SELECT 1 FROM users WHERE church_id IS NULL) THEN
    SELECT id INTO default_church_id FROM churches WHERE slug = 'igreja-familia' LIMIT 1;

    IF default_church_id IS NULL THEN
      INSERT INTO churches (name, trade_name, slug, country)
      VALUES ('Igreja Família', 'Igreja Família', 'igreja-familia', 'Brasil')
      RETURNING id INTO default_church_id;

      INSERT INTO church_settings (church_id)
      VALUES (default_church_id)
      ON CONFLICT (church_id) DO NOTHING;
    END IF;

    UPDATE users SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE ministries SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE schedules SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE user_unavailable_dates SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE repertoire_songs SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE ministry_members SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE ministry_ministers SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE ministry_admins SET church_id = default_church_id WHERE church_id IS NULL;
    UPDATE ministry_repertoire SET church_id = default_church_id WHERE church_id IS NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Tornar church_id obrigatório + índices de tenant.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- Só aplica NOT NULL se não restou nenhum órfão (evita erro em base vazia).
  IF NOT EXISTS (SELECT 1 FROM users WHERE church_id IS NULL) THEN
    ALTER TABLE users ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE ministries ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE schedules ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE user_unavailable_dates ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE repertoire_songs ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE ministry_members ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE ministry_ministers ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE ministry_admins ALTER COLUMN church_id SET NOT NULL;
    ALTER TABLE ministry_repertoire ALTER COLUMN church_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_church_id ON users(church_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_ministries_church_id ON ministries(church_id);
CREATE INDEX IF NOT EXISTS idx_schedules_church_id ON schedules(church_id);
CREATE INDEX IF NOT EXISTS idx_unavailable_church_id ON user_unavailable_dates(church_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_songs_church_id ON repertoire_songs(church_id);

-- e-mail deve ser único POR igreja (não mais global), permitindo que a mesma
-- pessoa exista em igrejas diferentes. Remove a unicidade global anterior.
DROP INDEX IF EXISTS idx_users_email_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_per_church
  ON users(church_id, lower(email));

-- -----------------------------------------------------------------------------
-- 8. Funções auxiliares de tenant para o RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_church_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT church_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    -- role::text evita depender do novo valor do enum estar commitado
    -- (ALTER TYPE ... ADD VALUE só fica visível após o commit; no SQL Editor
    --  do Supabase tudo roda numa transação só).
    WHERE auth_user_id = auth.uid() AND role::text = 'plataforma_admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS — isolamento por tenant. Política única por tabela:
--    "mesma igreja do usuário autenticado OU admin de plataforma".
--    (A service-role key do backend ignora o RLS — o scoping no código é a
--     barreira primária; isto é defesa em profundidade.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'churches','church_settings','users','ministries','schedules',
    'user_unavailable_dates','repertoire_songs','ministry_members',
    'ministry_ministers','ministry_admins','ministry_repertoire'
  ];
  predicate text;
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', tbl);

    IF tbl = 'churches' THEN
      predicate := 'id = public.current_church_id() OR public.is_platform_admin()';
    ELSE
      predicate := 'church_id = public.current_church_id() OR public.is_platform_admin()';
    END IF;

    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
      FOR ALL TO authenticated
      USING (%s)
      WITH CHECK (%s);
    $f$, tbl, predicate, predicate);
  END LOOP;
END $$;

-- =============================================================================
-- Fim. Próximo passo (backend): middleware que verifica o JWT do Supabase,
-- deriva req.user/req.churchId e remove o uso de actorId vindo do cliente.
-- =============================================================================
