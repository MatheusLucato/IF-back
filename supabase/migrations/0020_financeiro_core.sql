-- =============================================================================
-- Edifico — Migration 0020 · Financeiro (núcleo) — Fase 5
-- -----------------------------------------------------------------------------
-- F5.1 — Plano de contas e centros de custo:
--   · fin_categories: categorias hierárquicas de receita/despesa (parent_id).
--   · fin_cost_centers: centros de custo (planos por projeto/ministério).
-- F5.2 — Lançamentos (receitas/despesas) e caixa:
--   · fin_accounts: contas (caixa/banco) com saldo de abertura.
--   · fin_transactions: lançamentos (entrada/saída) com categoria, centro de
--     custo, conta, data, anexo e flag de conciliação.
--
-- PRINCÍPIOS (ver PLANEJAMENTO-EDIFICO.md, Fase 5):
--   · Tudo RELACIONAL (não jsonb). Valores em CENTAVOS (bigint), nunca float.
--   · kind/type em inglês ('income'|'expense') — rótulos PT-BR ficam no front.
--   · Saldo é calculado por SOMA (não desnormalizado) para evitar divergência.
--
-- Bloco 0020+ reservado para a Onda 4 (financeiro), em paralelo à Onda 3
-- (0008-0011). Aplique MANUALMENTE. Idempotente. Depende de: 0001 (churches/users),
-- 0004 (members).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Centros de custo (F5.1). Flat nesta fase.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_cost_centers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_cost_centers_church ON fin_cost_centers(church_id);

DROP TRIGGER IF EXISTS trg_fin_cost_centers_updated_at ON fin_cost_centers;
CREATE TRIGGER trg_fin_cost_centers_updated_at
  BEFORE UPDATE ON fin_cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Categorias (plano de contas, F5.1). Hierárquicas via parent_id (auto-ref).
--    kind = 'income' | 'expense' (mantida no nível raiz e herdada pela árvore).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES fin_categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'expense',  -- 'income' | 'expense'
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_categories_church ON fin_categories(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_categories_parent ON fin_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_fin_categories_kind   ON fin_categories(church_id, kind);

DROP TRIGGER IF EXISTS trg_fin_categories_updated_at ON fin_categories;
CREATE TRIGGER trg_fin_categories_updated_at
  BEFORE UPDATE ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Contas (caixa/banco, F5.2). opening_balance_cents compõe o saldo calculado.
--    type = 'cash' | 'bank' | 'other'.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id              uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  type                   text NOT NULL DEFAULT 'bank',  -- 'cash' | 'bank' | 'other'
  opening_balance_cents  bigint NOT NULL DEFAULT 0,
  bank_name              text,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_accounts_church ON fin_accounts(church_id);

DROP TRIGGER IF EXISTS trg_fin_accounts_updated_at ON fin_accounts;
CREATE TRIGGER trg_fin_accounts_updated_at
  BEFORE UPDATE ON fin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Lançamentos (F5.2). Núcleo do controle financeiro. amount_cents SEMPRE
--    positivo; o sinal é dado por `type` (income/expense). `date` é a data de
--    competência/caixa. `member_id` liga contribuições a pessoas (F5.5).
--    `source` rastreia a origem (manual, payable, receivable, donation, ...).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id       uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  category_id     uuid REFERENCES fin_categories(id) ON DELETE SET NULL,
  cost_center_id  uuid REFERENCES fin_cost_centers(id) ON DELETE SET NULL,
  member_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  type            text NOT NULL DEFAULT 'expense',  -- 'income' | 'expense'
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),
  date            date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  description     text,
  attachment_url  text,
  reconciled      boolean NOT NULL DEFAULT false,
  source          text NOT NULL DEFAULT 'manual',
  source_id       uuid,                              -- id da origem (payable/receivable/donation)
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_tx_church     ON fin_transactions(church_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_date       ON fin_transactions(church_id, date);
CREATE INDEX IF NOT EXISTS idx_fin_tx_account    ON fin_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_category   ON fin_transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_member     ON fin_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_reconciled ON fin_transactions(church_id, reconciled);

DROP TRIGGER IF EXISTS trg_fin_transactions_updated_at ON fin_transactions;
CREATE TRIGGER trg_fin_transactions_updated_at
  BEFORE UPDATE ON fin_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. RLS — isolamento por tenant (defesa em profundidade).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_cost_centers', 'fin_categories', 'fin_accounts', 'fin_transactions'] LOOP
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

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0020', 'financeiro_core')
ON CONFLICT (version) DO NOTHING;
