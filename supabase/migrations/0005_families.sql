-- =============================================================================
-- Edifico — Migration 0005 · families (Núcleos familiares)
-- -----------------------------------------------------------------------------
-- F1.4 — Famílias. Igrejas pensam por família/domicílio; relatórios e visitas
-- pedem esse agrupamento. Modelo simples:
--   * families        — o núcleo (nome do domicílio/sobrenome).
--   * family_members  — vínculo N:N pessoa↔família, com papel e "chefe".
--
-- Uma pessoa pode pertencer a mais de uma família (ex.: filhos de pais
-- separados) — por isso N:N e não um FK direto em members.
--
-- Papéis (family_members.role, text validado no código): head | spouse | child |
-- relative | other.
--
-- Aplique MANUALMENTE. Idempotente. RLS por tenant (defesa em profundidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS families (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'other', -- head | spouse | child | relative | other
  is_head     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices + unicidade (uma pessoa entra uma vez por família).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_families_church_id          ON families(church_id);
CREATE INDEX IF NOT EXISTS idx_family_members_church_id     ON family_members(church_id);
CREATE INDEX IF NOT EXISTS idx_family_members_family        ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_member        ON family_members(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_unique
  ON family_members(family_id, member_id);

-- -----------------------------------------------------------------------------
-- 3. Trigger de updated_at (em families).
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_families_updated_at ON families;
CREATE TRIGGER trg_families_updated_at
  BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['families', 'family_members'] LOOP
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
VALUES ('0005', 'families')
ON CONFLICT (version) DO NOTHING;
