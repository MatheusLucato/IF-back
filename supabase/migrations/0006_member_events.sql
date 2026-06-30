-- =============================================================================
-- Edifico — Migration 0006 · member_events (Jornada da pessoa)
-- -----------------------------------------------------------------------------
-- F1.5 — Status de membresia e jornada. Registra os MARCOS da caminhada de cada
-- pessoa (conversão, batismo, recepção, mudança de status, desligamento...),
-- compondo uma linha do tempo (timeline) por pessoa. Alimenta acompanhamento
-- pastoral e estatística de crescimento (Fase 10).
--
-- O `membership_status` "atual" vive em members (migration 0004); esta tabela é
-- o HISTÓRICO append-friendly desses e de outros marcos.
--
-- Tipos (member_events.type, text validado no código): conversion | baptism |
-- reception | status_change | transfer_in | transfer_out | discipline |
-- restoration | departure | death | note | other.
--
-- Aplique MANUALMENTE. Idempotente. RLS por tenant (defesa em profundidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela de eventos de jornada.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id     uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type          text NOT NULL,                              -- ver lista acima
  event_date    date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  title         text,                                       -- rótulo curto opcional
  notes         text,
  metadata      jsonb,                                      -- ex.: { from, to } na mudança de status
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices (timeline da pessoa, ordenada por data).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_member_events_church_id ON member_events(church_id);
CREATE INDEX IF NOT EXISTS idx_member_events_member     ON member_events(member_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_member_events_type       ON member_events(church_id, type);

-- -----------------------------------------------------------------------------
-- 3. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
BEGIN
  EXECUTE 'ALTER TABLE public.member_events ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.member_events;';
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON public.member_events
    FOR ALL TO authenticated
    USING (%s)
    WITH CHECK (%s);
  $f$, predicate, predicate);
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0006', 'member_events')
ON CONFLICT (version) DO NOTHING;
