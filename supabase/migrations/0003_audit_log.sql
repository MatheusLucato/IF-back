-- =============================================================================
-- Edifico — Migration 0003 · audit_log
-- -----------------------------------------------------------------------------
-- Auditoria + base de LGPD (F0.7): trilha append-only de ações sensíveis
-- (quem, o quê, quando, antes/depois) por tenant. Pré-requisito de finanças e
-- de dados pessoais — é a base de "prestação de contas" (accountability) que a
-- LGPD exige.
--
-- Modelo:
--   * audit_log — um evento por linha. `before`/`after` guardam o diff (jsonb).
--                 `user_id` é o ATOR (nullable: ações de sistema/sem sessão).
--                 `actor_name`/`actor_email` são desnormalizados para preservar
--                 a identidade mesmo se o usuário for excluído depois.
--
-- O catálogo de ações/entidades vive no CÓDIGO
-- (IF-back/src/services/auditService.js). A tabela é genérica de propósito.
--
-- APPEND-ONLY: o backend só faz INSERT/SELECT aqui. Não há trigger bloqueando
-- UPDATE/DELETE (mantido simples); o expurgo/particionamento fica para o futuro
-- (ver PLANEJAMENTO-EDIFICO.md, F0.7 → riscos de volume).
--
-- SEGURANÇA: a leitura na API é gated por `auditoria.read` (RBAC, F0.6). O RLS
-- abaixo é defesa em profundidade (mesma política das demais tabelas de tenant).
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar. Convenção: ver docs/CONVENCAO-BANCO.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de auditoria (por tenant, append-only).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,  -- ator (nullable)
  actor_name  text,                                          -- snapshot do nome do ator
  actor_email text,                                          -- snapshot do e-mail do ator
  action      text NOT NULL,                                 -- ex.: 'user.role_changed'
  entity      text NOT NULL,                                 -- ex.: 'user', 'role'
  entity_id   text,                                          -- id do alvo (texto: ids podem não ser uuid)
  before      jsonb,                                         -- estado anterior (diff)
  after       jsonb,                                         -- estado posterior (diff)
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices (consulta sempre escopada por tenant + ordenada por data).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_log_church_id      ON audit_log(church_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_church_created ON audit_log(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity         ON audit_log(church_id, entity, entity_id);

-- -----------------------------------------------------------------------------
-- 3. RLS — isolamento por tenant (mesma política das demais tabelas).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.audit_log;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.audit_log
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0003', 'audit_log')
ON CONFLICT (version) DO NOTHING;
