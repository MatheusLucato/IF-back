-- =============================================================================
-- Edifico — Migration 0024 · Fechamento mensal / balancete — Fase 5
-- -----------------------------------------------------------------------------
-- F5.9 — fin_closings: "trava" um mês (período) registrando saldos de abertura e
--        fechamento. Lançamentos com data dentro de um período fechado não podem
--        ser criados/editados/excluídos (validação no service, consultando esta
--        tabela). Reabrir exige papel alto (financeiro.admin) + auditoria.
--
-- period é o primeiro dia do mês (date), ex.: 2026-06-01 representa junho/2026.
-- status: 'closed' | 'reopened' (histórico via auditoria, não nesta tabela).
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fin_closings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id      uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  period         date NOT NULL,                  -- primeiro dia do mês fechado
  opening_cents  bigint NOT NULL DEFAULT 0,
  income_cents   bigint NOT NULL DEFAULT 0,
  expense_cents  bigint NOT NULL DEFAULT 0,
  closing_cents  bigint NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'closed',  -- 'closed' | 'reopened'
  notes          text,
  closed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at      timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Um registro por tenant/período.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_closings_period
  ON fin_closings(church_id, period);

DROP TRIGGER IF EXISTS trg_fin_closings_updated_at ON fin_closings;
CREATE TRIGGER trg_fin_closings_updated_at
  BEFORE UPDATE ON fin_closings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.fin_closings ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.fin_closings;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.fin_closings
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0024', 'financeiro_closings')
ON CONFLICT (version) DO NOTHING;
