-- =============================================================================
-- Edifico — Migration 0031 · LGPD: consentimentos + anonimização — F9.4
-- -----------------------------------------------------------------------------
-- Base legal e direitos do titular:
--   consents            — registro de consentimento por titular (user/member) e
--                         tipo (ex.: 'privacy_policy', 'communications', 'photos').
--   members.anonymized_at — marca de anonimização. A linha é PRESERVADA (integridade
--                         contábil/histórica), mas os dados pessoais são apagados.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001, 0004 (members).
-- =============================================================================

CREATE TABLE IF NOT EXISTS consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  member_id    uuid REFERENCES members(id) ON DELETE CASCADE,
  type         text NOT NULL,                  -- 'privacy_policy' | 'communications' | 'photos' | ...
  granted      boolean NOT NULL DEFAULT true,
  source       text,                           -- 'self' | 'admin' | 'onboarding'
  granted_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consents_church ON consents(church_id);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(church_id, user_id);
CREATE INDEX IF NOT EXISTS idx_consents_member ON consents(church_id, member_id);
-- Um consentimento "ativo" por (titular, tipo): regravar atualiza o mesmo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consents_unique
  ON consents(church_id, user_id, type) WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_consents_updated_at ON consents;
CREATE TRIGGER trg_consents_updated_at
  BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Anonimização do membro (preserva a linha, remove PII).
ALTER TABLE members ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.consents;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.consents
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES ('0031', 'lgpd_consents')
ON CONFLICT (version) DO NOTHING;
