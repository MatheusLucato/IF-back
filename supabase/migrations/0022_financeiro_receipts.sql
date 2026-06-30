-- =============================================================================
-- Edifico — Migration 0022 · Recibos de contribuição — Fase 5
-- -----------------------------------------------------------------------------
-- F5.5 — fin_receipts: recibo numerado de uma contribuição (dízimo/oferta).
--        A contribuição em si é um fin_transactions (receita) com member_id; o
--        recibo guarda a numeração sequencial por tenant/ano + o PDF (R2).
--
-- NUMERAÇÃO CONCORRENTE: usa um contador atômico (fin_receipt_counters) acessado
-- pela função fin_next_receipt_number(), chamada via RPC. O INSERT ... ON CONFLICT
-- DO UPDATE garante incremento atômico mesmo sob concorrência (sem race).
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020 (fin_transactions), 0004.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contador de recibos por tenant/ano.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_receipt_counters (
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  last_number  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (church_id, year)
);

ALTER TABLE public.fin_receipt_counters ENABLE ROW LEVEL SECURITY;
-- Metadado de numeração: só a service-role do backend (que chama a RPC) a usa.
-- Sem policy para authenticated/anon (invisível ao cliente).

-- Função atômica: reserva e devolve o próximo número do tenant/ano.
CREATE OR REPLACE FUNCTION public.fin_next_receipt_number(p_church_id uuid, p_year integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
BEGIN
  INSERT INTO fin_receipt_counters (church_id, year, last_number)
  VALUES (p_church_id, p_year, 1)
  ON CONFLICT (church_id, year)
  DO UPDATE SET last_number = fin_receipt_counters.last_number + 1
  RETURNING last_number INTO next_num;
  RETURN next_num;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Recibos. `number` é o sequencial do ano; `year` separa as séries.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id       uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  transaction_id  uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  number          integer NOT NULL,
  year            integer NOT NULL,
  payer_name      text,                    -- nome impresso (snapshot)
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),
  description     text,
  file_url        text,                    -- PDF no R2 (opcional)
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_receipts_church  ON fin_receipts(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_receipts_member  ON fin_receipts(member_id);
CREATE INDEX IF NOT EXISTS idx_fin_receipts_tx      ON fin_receipts(transaction_id);
-- Número único por tenant/ano.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_receipts_number
  ON fin_receipts(church_id, year, number);

-- -----------------------------------------------------------------------------
-- 3. RLS.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.fin_receipts ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.fin_receipts;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.fin_receipts
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0022', 'financeiro_receipts')
ON CONFLICT (version) DO NOTHING;
