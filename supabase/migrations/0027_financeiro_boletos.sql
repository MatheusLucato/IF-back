-- =============================================================================
-- Edifico — Migration 0027 · Emissão de boletos — Fase 5
-- -----------------------------------------------------------------------------
-- F5.7 — fin_boletos: boleto registrado no MESMO gateway das doações (F6.2). O
--        backend cria a cobrança (boleto) no provedor; o webhook confirma o
--        pagamento e dá baixa na conta a receber vinculada (F5.4), gerando a
--        receita. Guarda PDF/linha digitável e status.
--
-- status: 'pending' | 'paid' | 'cancelled' | 'expired'.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020, 0021 (receivables).
-- =============================================================================

CREATE TABLE IF NOT EXISTS fin_boletos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id            uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  receivable_id        uuid REFERENCES fin_receivables(id) ON DELETE SET NULL,
  member_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  payer_name           text NOT NULL,
  payer_document       text,                              -- CPF/CNPJ do pagador
  description          text,
  amount_cents         bigint NOT NULL CHECK (amount_cents >= 0),
  due_date             date NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  provider             text,
  provider_charge_id   text,
  bank_slip_url        text,                              -- PDF do boleto
  digitable_line       text,                              -- linha digitável
  barcode              text,
  paid_at              timestamptz,
  transaction_id       uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_boletos_church ON fin_boletos(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_boletos_status ON fin_boletos(church_id, status);
CREATE INDEX IF NOT EXISTS idx_fin_boletos_recv   ON fin_boletos(receivable_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_boletos_provider_charge
  ON fin_boletos(provider, provider_charge_id) WHERE provider_charge_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_fin_boletos_updated_at ON fin_boletos;
CREATE TRIGGER trg_fin_boletos_updated_at
  BEFORE UPDATE ON fin_boletos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.fin_boletos ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.fin_boletos;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.fin_boletos
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0027', 'financeiro_boletos')
ON CONFLICT (version) DO NOTHING;
