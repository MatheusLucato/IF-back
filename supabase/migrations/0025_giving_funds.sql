-- =============================================================================
-- Edifico — Migration 0025 · Fundos / campanhas de arrecadação — Fase 6
-- -----------------------------------------------------------------------------
-- F6.1 — giving_funds: destinos de doação (dízimo, oferta, missões, construção,
--        campanha X). Liga a uma fin_categories (receita) para cair no relatório
--        certo quando a doação online vira fin_transactions. `goal_cents` é a meta
--        opcional da campanha. `slug` permite link público por fundo (opcional).
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020 (fin_categories).
-- =============================================================================

CREATE TABLE IF NOT EXISTS giving_funds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text NOT NULL,
  description  text,
  category_id  uuid REFERENCES fin_categories(id) ON DELETE SET NULL,
  goal_cents   bigint,                        -- NULL = sem meta
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_giving_funds_church ON giving_funds(church_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_funds_slug ON giving_funds(church_id, slug);

DROP TRIGGER IF EXISTS trg_giving_funds_updated_at ON giving_funds;
CREATE TRIGGER trg_giving_funds_updated_at
  BEFORE UPDATE ON giving_funds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.giving_funds ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.giving_funds;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.giving_funds
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0025', 'giving_funds')
ON CONFLICT (version) DO NOTHING;
