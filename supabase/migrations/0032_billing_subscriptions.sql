-- =============================================================================
-- Edifico — Migration 0032 · Assinatura / billing por tenant — F9.1
-- -----------------------------------------------------------------------------
-- Uma assinatura por igreja. O CATÁLOGO de planos (preço, limites, recursos) vive
-- no código (lib/plans.js); aqui guardamos apenas QUAL plano cada igreja tem e o
-- estado da cobrança no provedor (Stripe/mock). `churches.plan` permanece como
-- espelho denormalizado do plano efetivo (feature gating barato).
--
--   plan                  — chave do plano (free | basic | pro)
--   status                — active | trialing | past_due | canceled
--   provider/provider_*   — identificadores no provedor de cobrança
--   current_period_end    — fim do período pago (grace/expiração)
--   cancel_at_period_end  — cancelamento agendado para o fim do período
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001.
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id            uuid NOT NULL UNIQUE REFERENCES churches(id) ON DELETE CASCADE,
  plan                 text NOT NULL DEFAULT 'free',
  status               text NOT NULL DEFAULT 'active',
  provider             text,
  provider_sub_id      text,
  provider_customer_id text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_church ON subscriptions(church_id);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.subscriptions;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.subscriptions
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0032', 'billing_subscriptions')
ON CONFLICT (version) DO NOTHING;
