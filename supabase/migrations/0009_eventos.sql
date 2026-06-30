-- =============================================================================
-- Edifico — Migration 0009 · Agenda & Eventos (Fase 3)
-- -----------------------------------------------------------------------------
-- F3.1 — events: agenda institucional (programações, conferências, retiros),
--        DISTINTA de "Calendário" (= escalas de culto). Sem recorrência nesta fase.
-- F3.2 — event_registrations: inscrições (ligadas a members ou lead avulso), com
--        controle de capacidade e slug público por evento.
-- F3.3 — check-in via QR: qr_token por inscrição + checked_in_at.
--
-- SEGURANÇA: gestão gated por RBAC (`eventos.read/write/delete`, F0.6). O registro
-- público (F3.2) é feito pelo backend com service-role a partir do slug — não há
-- acesso anônimo direto às tabelas. RLS abaixo é defesa em profundidade.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001 (churches/users), 0004 (members).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Eventos (F3.1). `slug` é único por tenant para a página pública (/e/:slug).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id      uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title          text NOT NULL,
  slug           text NOT NULL,
  description    text,
  location       text,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,
  cover_url      text,
  capacity       integer,                              -- NULL = sem limite
  is_published   boolean NOT NULL DEFAULT false,       -- controla a página pública
  allow_registration boolean NOT NULL DEFAULT true,
  responsible_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_church        ON events(church_id);
CREATE INDEX IF NOT EXISTS idx_events_starts_at     ON events(church_id, starts_at);
-- slug único por tenant (a página pública resolve por church_id + slug).
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_church_slug ON events(church_id, slug);

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Inscrições (F3.2) + check-in (F3.3).
--    member_id é opcional (inscrição de não-membro = lead). `status`: confirmed |
--    cancelled | waitlist. `qr_token` é gerado na inscrição para o check-in.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id      uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id      uuid REFERENCES members(id) ON DELETE SET NULL,
  name           text NOT NULL,
  email          text,
  phone          text,
  status         text NOT NULL DEFAULT 'confirmed',
  qr_token       text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_regs_church  ON event_registrations(church_id);
CREATE INDEX IF NOT EXISTS idx_event_regs_event   ON event_registrations(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_regs_qr ON event_registrations(qr_token);
-- Evita inscrição duplicada do mesmo membro no mesmo evento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_regs_member_unique
  ON event_registrations(event_id, member_id) WHERE member_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_event_regs_updated_at ON event_registrations;
CREATE TRIGGER trg_event_regs_updated_at
  BEFORE UPDATE ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['events', 'event_registrations'] LOOP
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
VALUES ('0009', 'eventos')
ON CONFLICT (version) DO NOTHING;
