-- =============================================================================
-- Edifico — Migration 0040 · ai_usage
-- -----------------------------------------------------------------------------
-- Assistente de IA (F10.3 / Onda 6): controle de USO/CUSTO das gerações com a
-- Claude (Anthropic). Uma linha por geração, com metadados de tokens — SEM o
-- conteúdo (privacidade/LGPD: não persistimos os tópicos enviados ao modelo).
--
-- Bloco 0040+ reservado para a Onda 6 (Inteligência), para não colidir com a
-- Onda 4 (financeiro, 0020+) nem com a Onda 5 (app/plataforma, em paralelo).
--
-- best-effort: o backend só faz INSERT aqui e tolera a tabela ausente (a
-- geração NUNCA depende deste registro). Leitura/relatórios de custo: futuro.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de uso de IA (por tenant).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id     uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,  -- quem disparou (nullable)
  feature       text NOT NULL,                                 -- 'announcement' | 'meeting_minutes' | 'summary' | 'custom'
  model         text NOT NULL,                                 -- ex.: 'claude-opus-4-8'
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices (consulta escopada por tenant + ordenada por data).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_usage_church_id      ON ai_usage(church_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_church_created ON ai_usage(church_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. RLS — isolamento por tenant (mesma política das demais tabelas).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.ai_usage;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.ai_usage
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0040', 'ai_usage')
ON CONFLICT (version) DO NOTHING;
