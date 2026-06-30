-- =============================================================================
-- Edifico — Migration 0004 · members (Pessoas)
-- -----------------------------------------------------------------------------
-- F1.1 — Modelo de "Pessoa". Cria a entidade CENTRAL de pessoas do ChMS, separada
-- de `users` (credenciais de acesso). A maioria das pessoas de uma igreja NÃO tem
-- login: `members` existe de forma independente e liga-se ao login (quando houver)
-- via `members.user_id` (nullable).
--
-- Regra de ouro (documentar): "1 user ⇒ 1 member; member pode existir sem user".
-- O backfill abaixo cria um `member` para cada `user` atual, preservando o vínculo.
--
-- SEGURANÇA: a API é gated por RBAC (`membros.read/write/delete`, F0.6). O RLS
-- abaixo é defesa em profundidade (mesma política das demais tabelas de tenant).
-- O backend usa service-role (ignora RLS) → o scoping por `church_id` no código
-- continua obrigatório.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar. Convenção: ver docs/CONVENCAO-BANCO.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensão para busca textual eficiente (ilike '%termo%' sobre nome).
--    Opcional: se o projeto Supabase não permitir, remova esta linha e o índice
--    trgm mais abaixo — a busca continua funcionando via índice btree comum.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- 1. Função util de updated_at (genérica, reutilizada por triggers).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Tabela de pessoas (por tenant).
--    membership_status e gender/marital_status são `text` validados no código
--    (zod) — preferimos flexibilidade a enums rígidos nesta fase.
--    Valores de membership_status: visitor | regular_attender | member |
--    inactive | transferred | deceased.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id           uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL, -- login (opcional)
  full_name           text NOT NULL,
  social_name         text,
  gender              text,           -- male | female | other
  birth_date          date,
  marital_status      text,           -- single | married | divorced | widowed | stable_union
  cpf                 text,
  rg                  text,
  email               text,
  phone               text,
  whatsapp            text,
  photo_url           text,
  address_zip         text,           -- CEP
  address_street      text,
  address_number      text,
  address_complement  text,
  address_district    text,           -- bairro
  address_city        text,
  address_state       text,
  membership_status   text NOT NULL DEFAULT 'visitor',
  joined_at           date,           -- recepção como membro
  baptism_date        date,
  conversion_date     date,
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Índices: consulta sempre escopada por tenant; busca por nome/e-mail;
--    aniversariantes por mês (birth_date); 1 member por user (parcial).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_members_church_id        ON members(church_id);
CREATE INDEX IF NOT EXISTS idx_members_church_name       ON members(church_id, full_name);
CREATE INDEX IF NOT EXISTS idx_members_email            ON members(church_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_members_birth_date       ON members(church_id, birth_date);
CREATE INDEX IF NOT EXISTS idx_members_status           ON members(church_id, membership_status);
-- Garante a invariante "1 user ⇒ no máximo 1 member" (apenas quando vinculado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user_id_unique
  ON members(user_id) WHERE user_id IS NOT NULL;
-- Busca textual (acelera ilike '%termo%'); remova junto com a extensão se preciso.
CREATE INDEX IF NOT EXISTS idx_members_full_name_trgm
  ON members USING gin (full_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. Trigger de updated_at.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_members_updated_at ON members;
CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. RLS — isolamento por tenant (mesma política das demais tabelas).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.members;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.members
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- 6. BACKFILL — cria um `member` para cada `user` existente que ainda não tenha.
--    Mantém a invariante "todo user ganha um member correspondente". Usuários
--    "admin fantasma" do bootstrap também ganham member (sem prejuízo).
-- -----------------------------------------------------------------------------
INSERT INTO members (church_id, user_id, full_name, email, birth_date, photo_url, membership_status, created_at)
SELECT
  u.church_id,
  u.id,
  COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Sem nome'),
  u.email,
  u.birth_date,
  u.profile_picture,
  'member',
  u.created_at
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id);

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0004', 'members')
ON CONFLICT (version) DO NOTHING;
