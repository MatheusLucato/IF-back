-- =============================================================================
-- Edifico — Migration 0023 · Importação OFX + conciliação bancária — Fase 5
-- -----------------------------------------------------------------------------
-- F5.6 — Importa extrato OFX e concilia com lançamentos (fin_transactions).
--   · fin_bank_imports: um "job" de importação (arquivo, conta, contagem).
--   · fin_bank_lines: cada linha do extrato OFX, com vínculo opcional ao
--     lançamento conciliado (matched_transaction_id) e status do match.
--
-- O match é feito no backend (valor + data + descrição), com confirmação manual
-- antes de marcar o lançamento como reconciled. fitid evita reimportar a mesma
-- linha (índice único por conta/fitid).
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020 (contas/lançamentos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Job de importação.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_bank_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id     uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  account_id    uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  file_name     text,
  bank_id       text,                       -- BANKID do OFX (quando presente)
  period_start  date,
  period_end    date,
  total_lines   integer NOT NULL DEFAULT 0,
  matched_lines integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bank_imports_church ON fin_bank_imports(church_id);

-- -----------------------------------------------------------------------------
-- 2. Linhas do extrato. status: 'unmatched' | 'matched' | 'ignored'.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_bank_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id              uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  import_id              uuid NOT NULL REFERENCES fin_bank_imports(id) ON DELETE CASCADE,
  account_id             uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  fitid                  text,                              -- id da transação no OFX
  posted_at              date NOT NULL,
  amount_cents           bigint NOT NULL,                   -- sinalizado: + crédito / - débito
  type                   text,                              -- 'income' | 'expense' (derivado do sinal)
  memo                   text,
  status                 text NOT NULL DEFAULT 'unmatched', -- 'unmatched' | 'matched' | 'ignored'
  matched_transaction_id uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bank_lines_church ON fin_bank_lines(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_bank_lines_import ON fin_bank_lines(import_id);
CREATE INDEX IF NOT EXISTS idx_fin_bank_lines_status ON fin_bank_lines(church_id, status);
-- Evita reimportar a mesma linha (mesma conta + mesmo fitid).
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_bank_lines_fitid
  ON fin_bank_lines(account_id, fitid) WHERE fitid IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. RLS.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_bank_imports', 'fin_bank_lines'] LOOP
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
VALUES ('0023', 'financeiro_reconciliation')
ON CONFLICT (version) DO NOTHING;
