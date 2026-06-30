-- =============================================================================
-- Edifico — Migration 0007 · invitations (Convite/vínculo de acesso)
-- -----------------------------------------------------------------------------
-- F1.9 — Convite de acesso. Transforma uma PESSOA (member) em USUÁRIO do app.
-- Um registro por convite: guarda o e-mail-alvo, o member vinculado, o papel a
-- conceder e o status do fluxo. Ao aceitar, o backend cria/vincula `users` e
-- seta `members.user_id`.
--
-- Status (invitations.status): pending | accepted | revoked | expired.
--
-- NOTA sobre identidade: o Supabase Auth tem e-mail GLOBALMENTE único
-- (1 e-mail = 1 conta = 1 igreja). O fluxo de convite respeita isso — ver
-- PLANEJAMENTO-EDIFICO.md (F1.9 → riscos).
--
-- Aplique MANUALMENTE. Idempotente. RLS por tenant (defesa em profundidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de convites.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id     uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id     uuid REFERENCES members(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'membro',  -- papel legado a conceder (membro|lider)
  token         text NOT NULL UNIQUE,            -- token opaco do link de aceite
  status        text NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
  invited_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at    timestamptz,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invitations_church_id ON invitations(church_id);
CREATE INDEX IF NOT EXISTS idx_invitations_member     ON invitations(member_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status     ON invitations(church_id, status);
-- Um único convite PENDENTE por e-mail dentro da igreja (evita duplicidade).
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email
  ON invitations(church_id, lower(email)) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 3. Trigger de updated_at.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_invitations_updated_at ON invitations;
CREATE TRIGGER trg_invitations_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.invitations;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.invitations
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0007', 'invitations')
ON CONFLICT (version) DO NOTHING;
