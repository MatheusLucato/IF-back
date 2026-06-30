-- =============================================================================
-- Edifico — Migration 0021 · Contas a pagar / a receber — Fase 5
-- -----------------------------------------------------------------------------
-- F5.3 — fin_payables: compromissos a pagar (fornecedor, vencimento, status).
--        Ao "dar baixa", gera um fin_transactions (despesa) e guarda o vínculo.
-- F5.4 — fin_receivables: valores a receber (espelho de a pagar). A baixa gera
--        um fin_transactions (receita).
--
-- status: 'open' | 'paid' | 'cancelled' (a pagar)  /  'open' | 'received' |
--         'cancelled' (a receber). paid_transaction_id liga à baixa.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020 (núcleo financeiro).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contas a pagar (F5.3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_payables (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id            uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  supplier             text NOT NULL,
  description          text,
  category_id          uuid REFERENCES fin_categories(id) ON DELETE SET NULL,
  cost_center_id       uuid REFERENCES fin_cost_centers(id) ON DELETE SET NULL,
  due_date             date NOT NULL,
  amount_cents         bigint NOT NULL CHECK (amount_cents >= 0),
  status               text NOT NULL DEFAULT 'open',  -- 'open' | 'paid' | 'cancelled'
  paid_at              date,
  paid_transaction_id  uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_payables_church   ON fin_payables(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_payables_due      ON fin_payables(church_id, due_date);
CREATE INDEX IF NOT EXISTS idx_fin_payables_status   ON fin_payables(church_id, status);

DROP TRIGGER IF EXISTS trg_fin_payables_updated_at ON fin_payables;
CREATE TRIGGER trg_fin_payables_updated_at
  BEFORE UPDATE ON fin_payables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Contas a receber (F5.4). Espelha a pagar; status 'received' no lugar de 'paid'.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_receivables (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id                uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  payer                    text NOT NULL,
  description              text,
  category_id              uuid REFERENCES fin_categories(id) ON DELETE SET NULL,
  cost_center_id           uuid REFERENCES fin_cost_centers(id) ON DELETE SET NULL,
  member_id                uuid REFERENCES members(id) ON DELETE SET NULL,
  due_date                 date NOT NULL,
  amount_cents             bigint NOT NULL CHECK (amount_cents >= 0),
  status                   text NOT NULL DEFAULT 'open',  -- 'open' | 'received' | 'cancelled'
  received_at              date,
  received_transaction_id  uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_receivables_church ON fin_receivables(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_receivables_due    ON fin_receivables(church_id, due_date);
CREATE INDEX IF NOT EXISTS idx_fin_receivables_status ON fin_receivables(church_id, status);

DROP TRIGGER IF EXISTS trg_fin_receivables_updated_at ON fin_receivables;
CREATE TRIGGER trg_fin_receivables_updated_at
  BEFORE UPDATE ON fin_receivables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_payables', 'fin_receivables'] LOOP
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

INSERT INTO schema_migrations (version, name)
VALUES ('0021', 'financeiro_payables_receivables')
ON CONFLICT (version) DO NOTHING;
