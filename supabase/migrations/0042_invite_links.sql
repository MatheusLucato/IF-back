-- =============================================================================
-- Edifico — Migration 0042 · invite_links (Convite por LINK reutilizável)
-- -----------------------------------------------------------------------------
-- Novo fluxo de ingresso: o admin/pastor gera um LINK de convite que identifica
-- a igreja. O membro acessa o link e faz apenas o cadastro pessoal — a conta já
-- nasce vinculada à igreja do convite. A lista de igrejas deixa de ser pública.
--
-- Conceito DISTINTO de `invitations` (0007 / F1.9), que converte uma PESSOA
-- (member) já cadastrada em USUÁRIO por e-mail. Aqui o link é reutilizável e
-- configurável (validade/limite de usos/revogação) e não está preso a um member.
--
-- Aplique MANUALMENTE. Idempotente. RLS por tenant (defesa em profundidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de links de convite.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,             -- token opaco que vai na URL
  label       text,                             -- apelido opcional ("Geral", "Célula Norte")
  role        text NOT NULL DEFAULT 'membro',   -- papel legado a conceder (membro|lider)
  max_uses    integer,                          -- null = ilimitado
  uses        integer NOT NULL DEFAULT 0,       -- quantos cadastros já usaram o link
  expires_at  timestamptz,                      -- null = nunca expira
  is_active   boolean NOT NULL DEFAULT true,    -- false = revogado
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invite_links_church_id ON invite_links(church_id);
CREATE INDEX IF NOT EXISTS idx_invite_links_active     ON invite_links(church_id) WHERE is_active;

-- -----------------------------------------------------------------------------
-- 3. Trigger de updated_at.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_invite_links_updated_at ON invite_links;
CREATE TRIGGER trg_invite_links_updated_at
  BEFORE UPDATE ON invite_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.invite_links ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.invite_links;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.invite_links
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- 5. Consumo atômico do convite.
--    Incrementa `uses` somente se o link ainda for válido (ativo, não expirado e
--    dentro do limite). Retorna a linha consumida ou NULL — sem condição de
--    corrida no limite de usos. SECURITY DEFINER: o aceite é público (anon),
--    chamado pelo backend com service-role, mas a função se basta sozinha.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_invite_link(p_token text)
RETURNS invite_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv invite_links;
BEGIN
  UPDATE invite_links
  SET uses = uses + 1, updated_at = now()
  WHERE token = p_token
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_uses IS NULL OR uses < max_uses)
  RETURNING * INTO inv;
  RETURN inv; -- NULL quando nada foi atualizado (inválido/expirado/esgotado)
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_invite_link(text) TO service_role;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0042', 'invite_links')
ON CONFLICT (version) DO NOTHING;
