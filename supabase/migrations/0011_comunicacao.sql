-- =============================================================================
-- Edifico — Migration 0011 · Comunicação & Engajamento (Fase 7)
-- -----------------------------------------------------------------------------
-- F7.1 — notifications (log de envios) + notification_prefs (preferências por user).
-- F7.2 — announcements: avisos / mural interno segmentado por audiência.
-- F7.3 — automation_settings: toggles das automações contextuais (lembrete de
--        escala, aniversário, evento). Reusa o log/prefs de F7.1.
-- F7.4 — prayer_requests: pedidos de oração com visibilidade.
--
-- SEGURANÇA: API gated por RBAC (`comunicacao.read/write`, F0.6). RLS abaixo é
-- defesa em profundidade. Backend usa service-role → scoping por church_id no código.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001 (churches/users), 0004 (members).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Log de notificações enviadas (F7.1). `channel`: email | push | inapp.
--    `status`: queued | sent | failed | skipped.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  channel      text NOT NULL DEFAULT 'email',
  template     text NOT NULL DEFAULT 'generic',
  recipient    text,
  subject      text,
  body         text,
  status       text NOT NULL DEFAULT 'queued',
  error        text,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_church  ON notifications(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);

-- -----------------------------------------------------------------------------
-- 2. Preferências de notificação por usuário (F7.1). `channels` e `topics` em jsonb.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_prefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled  boolean NOT NULL DEFAULT true,
  topics      jsonb NOT NULL DEFAULT '{}'::jsonb,        -- { schedule:true, birthday:true, ... }
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_prefs(user_id);

DROP TRIGGER IF EXISTS trg_notif_prefs_updated_at ON notification_prefs;
CREATE TRIGGER trg_notif_prefs_updated_at
  BEFORE UPDATE ON notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Avisos / mural interno (F7.2). `audience`: all | leaders | ministry | class.
--    `audience_ref` aponta o ministério/classe quando segmentado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id     uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  audience      text NOT NULL DEFAULT 'all',
  audience_ref  uuid,
  is_pinned     boolean NOT NULL DEFAULT false,
  publish_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_church  ON announcements(church_id, publish_at DESC);

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Configurações de automação contextual (F7.3). 1 linha por tenant; toggles
--    em jsonb (schedule_reminder, birthday, event_confirmation, ...).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_settings_church ON automation_settings(church_id);

DROP TRIGGER IF EXISTS trg_automation_settings_updated_at ON automation_settings;
CREATE TRIGGER trg_automation_settings_updated_at
  BEFORE UPDATE ON automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Pedidos de oração (F7.4). `visibility`: private | pastoral | public.
--    `status`: open | praying | answered | archived.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prayer_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES members(id) ON DELETE SET NULL,
  requester_name text,
  title        text,
  body         text NOT NULL,
  visibility   text NOT NULL DEFAULT 'pastoral',
  status       text NOT NULL DEFAULT 'open',
  is_anonymous boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prayer_church   ON prayer_requests(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayer_status   ON prayer_requests(church_id, status);

DROP TRIGGER IF EXISTS trg_prayer_updated_at ON prayer_requests;
CREATE TRIGGER trg_prayer_updated_at
  BEFORE UPDATE ON prayer_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['notifications', 'notification_prefs', 'announcements', 'automation_settings', 'prayer_requests'] LOOP
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
VALUES ('0011', 'comunicacao')
ON CONFLICT (version) DO NOTHING;
