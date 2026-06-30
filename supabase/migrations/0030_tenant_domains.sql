-- =============================================================================
-- Edifico — Migration 0030 · Subdomínio / domínio por tenant — F9.3
-- -----------------------------------------------------------------------------
-- Permite resolver o tenant pelo HOST (além do login). O `slug` já existe e serve
-- de subdomínio (`<slug>.edifico.app`); aqui adicionamos o domínio próprio
-- (premium) e o estado de verificação por TXT DNS.
--
--   custom_domain            — domínio próprio da igreja (ex.: app.minhaigreja.com.br)
--   domain_verified          — true após validação do registro TXT
--   domain_verification_token— token que o admin publica em TXT `edifico-verify=<token>`
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001.
-- =============================================================================

ALTER TABLE churches ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS domain_verified boolean NOT NULL DEFAULT false;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS domain_verification_token text;

-- Domínio próprio é único globalmente (um host → um tenant). Índice parcial para
-- ignorar NULLs (a maioria das igrejas não tem domínio próprio).
CREATE UNIQUE INDEX IF NOT EXISTS idx_churches_custom_domain
  ON churches(custom_domain) WHERE custom_domain IS NOT NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('0030', 'tenant_domains')
ON CONFLICT (version) DO NOTHING;
