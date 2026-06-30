-- =============================================================================
-- Edifico — Migration 0001 · BASELINE
-- -----------------------------------------------------------------------------
-- Consolida o estado VIVO do schema (sql/supabase-schema.sql +
-- sql/saas-multitenant-migration.sql) em uma única fonte de verdade.
--
-- COMO USAR:
--   * Banco NOVO (staging/novo projeto): rode este arquivo do início ao fim no
--     SQL Editor do Supabase. Ele cria tudo a partir do zero.
--   * Banco ATUAL (produção já migrada): este arquivo é IDEMPOTENTE — todos os
--     objetos usam IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS, então
--     rodá-lo é um NO-OP seguro que apenas REGISTRA a baseline como aplicada
--     (linha em schema_migrations). Não altera dados.
--
-- REGRA DE OURO (ver supabase/migrations/README.md): NENHUM SQL é executado
-- automaticamente pela aplicação. Todo SQL é revisado e rodado manualmente.
--
-- IMPORTANTE: antes de tratar esta baseline como autoritativa, confira-a contra
-- um dump do schema real (ver README → "Verificar a baseline contra o banco").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. Controle de versões de migration (metadado de infraestrutura).
--    Tabela append-only, NÃO é dado de tenant. RLS habilitado sem policy =>
--    invisível para clientes authenticated/anon; só a service-role acessa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 1. Enums.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'lider', 'membro', 'pastor', 'plataforma_admin');
  END IF;
END $$;

-- Garante os valores adicionados na fase multi-tenant em bancos antigos
-- (enum criado originalmente com apenas admin/lider/membro).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_role' AND e.enumlabel = 'pastor') THEN
    ALTER TYPE user_role ADD VALUE 'pastor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_role' AND e.enumlabel = 'plataforma_admin') THEN
    ALTER TYPE user_role ADD VALUE 'plataforma_admin';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'theme_preference') THEN
    CREATE TYPE theme_preference AS ENUM ('light', 'dark');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tenant: churches.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS churches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                    -- razão social / nome oficial
  trade_name  text,                             -- nome fantasia (opcional)
  cnpj        text,
  phone       text,
  whatsapp    text,
  email       text,
  website     text,
  address     text,
  city        text,
  state       text,
  country     text DEFAULT 'Brasil',
  slug        text UNIQUE,                       -- p/ futuro subdomínio/path
  status      text NOT NULL DEFAULT 'active',    -- active | trialing | suspended
  plan        text NOT NULL DEFAULT 'free',      -- gancho p/ billing futuro
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churches_status ON churches(status);
CREATE INDEX IF NOT EXISTS idx_churches_slug   ON churches(slug);

-- -----------------------------------------------------------------------------
-- 3. Configurações da igreja (1:1) — identidade visual, tema e extensível.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS church_settings (
  church_id        uuid PRIMARY KEY REFERENCES churches(id) ON DELETE CASCADE,
  -- Identidade visual
  logo_url         text,
  logo_compact_url text,
  favicon_url      text,
  cover_url        text,
  -- Tema (cores HEX/HSL; o front converte p/ CSS vars)
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
-- 4. Profiles: users (login + vínculo Supabase Auth via auth_user_id).
--    NOTA: e-mail NÃO é mais único globalmente — a unicidade é POR igreja
--    (idx_users_email_per_church abaixo), permitindo a mesma pessoa em igrejas
--    diferentes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  full_name        text NOT NULL,
  email            text NOT NULL,
  password_hash    text NOT NULL,
  birth_date       date,
  role             user_role NOT NULL DEFAULT 'membro',
  is_approved      boolean NOT NULL DEFAULT false,
  profile_picture  text,
  theme_preference theme_preference NOT NULL DEFAULT 'light',
  auth_user_id     uuid UNIQUE,                  -- → auth.users(id) do Supabase
  church_id        uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Remove resíduos da unicidade global de e-mail (caso o banco venha de antes
-- da fase multi-tenant) e garante a unicidade por igreja.
DROP INDEX IF EXISTS idx_users_email_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_birth_date   ON users(birth_date);
CREATE INDEX IF NOT EXISTS idx_users_church_id    ON users(church_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_per_church
  ON users(church_id, lower(email));

-- -----------------------------------------------------------------------------
-- 5. Ministérios e suas tabelas de junção.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ministries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  leader_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  managers          jsonb NOT NULL DEFAULT '[]'::jsonb,
  member_count      integer NOT NULL DEFAULT 0,
  color             text NOT NULL DEFAULT '#ffffff',
  image_url         text,
  is_music_ministry boolean NOT NULL DEFAULT false,
  functions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  teams             jsonb NOT NULL DEFAULT '[]'::jsonb,
  repertoire        jsonb NOT NULL DEFAULT '[]'::jsonb,
  church_id         uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Defesa p/ bancos pré-coluna `teams` (o backend tem fallback de runtime que
-- esta migration torna desnecessário — ver IF-back/src/server.js).
ALTER TABLE ministries ADD COLUMN IF NOT EXISTS teams jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ministries_leader_id  ON ministries(leader_id);
CREATE INDEX IF NOT EXISTS idx_ministries_created_at ON ministries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ministries_church_id  ON ministries(church_id);

CREATE TABLE IF NOT EXISTS ministry_members (
  ministry_id    uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  function_name  text NOT NULL DEFAULT 'Membro',
  function_names jsonb NOT NULL DEFAULT '["Membro"]'::jsonb,
  function_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  church_id      uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_members_user_id     ON ministry_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_members_ministry_id ON ministry_members(ministry_id);

CREATE TABLE IF NOT EXISTS ministry_ministers (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_ministers_user_id     ON ministry_ministers(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_ministers_ministry_id ON ministry_ministers(ministry_id);

CREATE TABLE IF NOT EXISTS ministry_admins (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_admins_user_id     ON ministry_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_admins_ministry_id ON ministry_admins(ministry_id);

-- -----------------------------------------------------------------------------
-- 6. Repertório (catálogo de músicas + junção ministério↔música).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repertoire_songs (
  id         text PRIMARY KEY,
  song       jsonb NOT NULL DEFAULT '{}'::jsonb,
  church_id  uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repertoire_songs_updated_at ON repertoire_songs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_repertoire_songs_church_id  ON repertoire_songs(church_id);

CREATE TABLE IF NOT EXISTS ministry_repertoire (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  song_id     text NOT NULL REFERENCES repertoire_songs(id) ON DELETE CASCADE,
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_repertoire_song_id ON ministry_repertoire(song_id);

-- -----------------------------------------------------------------------------
-- 7. Escalas.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date               date NOT NULL,
  service_time       text NOT NULL,
  assignments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  songs              jsonb NOT NULL DEFAULT '[]'::jsonb,
  music_ministry_id  uuid REFERENCES ministries(id) ON DELETE SET NULL,
  music_minister_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  music_minister_name text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  church_id          uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_date              ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_service_time      ON schedules(service_time);
CREATE INDEX IF NOT EXISTS idx_schedules_created_by        ON schedules(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_music_minister_id ON schedules(music_minister_id);
CREATE INDEX IF NOT EXISTS idx_schedules_church_id         ON schedules(church_id);

-- -----------------------------------------------------------------------------
-- 8. Indisponibilidades por usuário/data.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_unavailable_dates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       date NOT NULL,
  reason     text,
  church_id  uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_user_unavailable_dates_user_id ON user_unavailable_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_user_unavailable_dates_date    ON user_unavailable_dates(date);
CREATE INDEX IF NOT EXISTS idx_unavailable_church_id          ON user_unavailable_dates(church_id);

-- -----------------------------------------------------------------------------
-- 9. Trigger: mantém ministries.member_count em sincronia.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_ministry_member_count()
RETURNS trigger AS $$
DECLARE
  target_ministry_id uuid;
BEGIN
  target_ministry_id := COALESCE(NEW.ministry_id, OLD.ministry_id);

  UPDATE ministries
  SET member_count = (
    SELECT COUNT(*)::integer
    FROM ministry_members
    WHERE ministry_id = target_ministry_id
  )
  WHERE id = target_ministry_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_insert ON ministry_members;
DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_delete ON ministry_members;
DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_update ON ministry_members;

CREATE TRIGGER trg_sync_ministry_member_count_insert
AFTER INSERT ON ministry_members
FOR EACH ROW EXECUTE FUNCTION sync_ministry_member_count();

CREATE TRIGGER trg_sync_ministry_member_count_delete
AFTER DELETE ON ministry_members
FOR EACH ROW EXECUTE FUNCTION sync_ministry_member_count();

CREATE TRIGGER trg_sync_ministry_member_count_update
AFTER UPDATE OF ministry_id ON ministry_members
FOR EACH ROW EXECUTE FUNCTION sync_ministry_member_count();

-- -----------------------------------------------------------------------------
-- 10. Funções auxiliares de tenant para o RLS.
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
    WHERE auth_user_id = auth.uid() AND role::text = 'plataforma_admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- 11. RLS — isolamento por tenant (defesa em profundidade; a barreira primária
--     é o scoping por church_id no backend, que usa a service-role key).
--     Política única por tabela: "mesma igreja do usuário OU admin de plataforma".
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

-- -----------------------------------------------------------------------------
-- 12. Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0001', 'baseline')
ON CONFLICT (version) DO NOTHING;

-- =============================================================================
-- Fim da baseline 0001.
-- =============================================================================
