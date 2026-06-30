-- =============================================================================
-- Edifico — Migration 0026 · Doações online (PIX/cartão) + recorrência — Fase 6
-- -----------------------------------------------------------------------------
-- F6.2 — donations: doação criada na página pública /doar/:slug. O backend cria
--        uma cobrança no gateway; o WEBHOOK confirma e marca status='paid',
--        gerando fin_transactions (receita) + recibo (F5.5). provider_charge_id
--        é o id da cobrança no provedor (idempotência do webhook).
-- F6.3 — donation_subscriptions: doação recorrente (assinatura no gateway). Cada
--        cobrança recorrente confirmada gera uma `donations` ligada à assinatura.
--
-- SEGURANÇA: a página é pública, mas o backend cria a cobrança com a chave do
-- gateway (server-side). Webhook idempotente por provider_event_id / charge_id.
-- Não armazenamos dados de cartão (tokenização no gateway — PCI).
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0020, 0025 (funds), 0004.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Assinaturas (recorrência, F6.3). Criadas antes de donations referenciá-las.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donation_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id            uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  fund_id              uuid REFERENCES giving_funds(id) ON DELETE SET NULL,
  member_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  donor_name           text,
  donor_email          text,
  amount_cents         bigint NOT NULL CHECK (amount_cents >= 0),
  period               text NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'weekly' | 'yearly'
  method               text NOT NULL DEFAULT 'credit_card',
  status               text NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'cancelled' | 'failed'
  provider             text,
  provider_sub_id      text,
  manage_token         text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donation_subs_church ON donation_subscriptions(church_id);
CREATE INDEX IF NOT EXISTS idx_donation_subs_member ON donation_subscriptions(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_donation_subs_provider
  ON donation_subscriptions(provider, provider_sub_id) WHERE provider_sub_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_donation_subs_updated_at ON donation_subscriptions;
CREATE TRIGGER trg_donation_subs_updated_at
  BEFORE UPDATE ON donation_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Doações (F6.2). status: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'.
--    method: 'pix' | 'credit_card' | 'boleto'. transaction_id liga à receita criada.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id            uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  fund_id              uuid REFERENCES giving_funds(id) ON DELETE SET NULL,
  member_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  subscription_id      uuid REFERENCES donation_subscriptions(id) ON DELETE SET NULL,
  donor_name           text,
  donor_email          text,
  donor_document       text,                              -- CPF (opcional, exigido por alguns gateways no PIX)
  amount_cents         bigint NOT NULL CHECK (amount_cents >= 0),
  method               text NOT NULL DEFAULT 'pix',       -- 'pix' | 'credit_card' | 'boleto'
  status               text NOT NULL DEFAULT 'pending',
  provider             text,                              -- ex.: 'asaas' | 'mercadopago' | 'stripe'
  provider_charge_id   text,                              -- id da cobrança no gateway
  pix_payload          text,                              -- copia-e-cola do PIX
  pix_qr_image         text,                              -- imagem base64/URL do QR
  checkout_url         text,                              -- link de pagamento (cartão/boleto)
  paid_at              timestamptz,
  transaction_id       uuid REFERENCES fin_transactions(id) ON DELETE SET NULL,
  receipt_id           uuid,                              -- fin_receipts.id (sem FK p/ evitar dependência de ordem)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donations_church  ON donations(church_id);
CREATE INDEX IF NOT EXISTS idx_donations_status  ON donations(church_id, status);
CREATE INDEX IF NOT EXISTS idx_donations_member  ON donations(member_id);
CREATE INDEX IF NOT EXISTS idx_donations_fund    ON donations(fund_id);
CREATE INDEX IF NOT EXISTS idx_donations_created ON donations(church_id, created_at);
-- Idempotência do webhook: uma cobrança do provedor = uma doação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_provider_charge
  ON donations(provider, provider_charge_id) WHERE provider_charge_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_donations_updated_at ON donations;
CREATE TRIGGER trg_donations_updated_at
  BEFORE UPDATE ON donations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS. NOTA: criação/atualização vinda do fluxo público e do webhook usa a
--    service-role (ignora RLS); estas policies protegem o acesso autenticado.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['donation_subscriptions', 'donations'] LOOP
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
VALUES ('0026', 'giving_donations')
ON CONFLICT (version) DO NOTHING;
