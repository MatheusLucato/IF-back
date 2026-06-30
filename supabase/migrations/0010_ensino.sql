-- =============================================================================
-- Edifico — Migration 0010 · Ensino (EBD / Classes) (Fase 4)
-- -----------------------------------------------------------------------------
-- F4.1 — classes + class_teachers: turmas (faixa, sala, horário) e professores.
-- F4.2 — class_enrollments: matrícula de pessoas como alunos de uma classe.
-- F4.3 — class_sessions + class_attendance: chamada/presença por data de aula.
-- F4.4 — relatórios: agregações sobre class_attendance (sem tabela nova; índices).
--
-- SEGURANÇA: API gated por RBAC (`ensino.read/write/delete`, F0.6). RLS abaixo é
-- defesa em profundidade. Backend usa service-role → scoping por church_id no código.
--
-- Aplique MANUALMENTE. Idempotente. Depende de: 0001 (churches/users), 0004 (members).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Classes / turmas (F4.1).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  age_range   text,
  schedule    text,
  room        text,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classes_church ON classes(church_id);

DROP TRIGGER IF EXISTS trg_classes_updated_at ON classes;
CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Professores da classe (F4.1).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_teachers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  is_lead     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_teachers_church ON class_teachers(church_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_teachers_unique ON class_teachers(class_id, member_id);

-- -----------------------------------------------------------------------------
-- 3. Matrículas de alunos (F4.2). `status`: active | inactive | transferred.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active',
  enrolled_at  date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_enroll_church ON class_enrollments(church_id);
CREATE INDEX IF NOT EXISTS idx_class_enroll_class  ON class_enrollments(class_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_enroll_unique ON class_enrollments(class_id, member_id);

DROP TRIGGER IF EXISTS trg_class_enroll_updated_at ON class_enrollments;
CREATE TRIGGER trg_class_enroll_updated_at
  BEFORE UPDATE ON class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Sessões de aula (F4.3). Uma por (classe, data). Guarda oferta/visitantes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id       uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date    date NOT NULL,
  lesson_title    text,
  offering_cents  integer NOT NULL DEFAULT 0,           -- oferta em centavos
  visitors_count  integer NOT NULL DEFAULT 0,
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_sessions_church ON class_sessions(church_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_class  ON class_sessions(class_id, session_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_sessions_unique ON class_sessions(class_id, session_date);

DROP TRIGGER IF EXISTS trg_class_sessions_updated_at ON class_sessions;
CREATE TRIGGER trg_class_sessions_updated_at
  BEFORE UPDATE ON class_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Presença por aluno/sessão (F4.3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  present     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_attendance_church  ON class_attendance(church_id);
CREATE INDEX IF NOT EXISTS idx_class_attendance_session ON class_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_class_attendance_member  ON class_attendance(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_attendance_unique ON class_attendance(session_id, member_id);

-- -----------------------------------------------------------------------------
-- 6. RLS — isolamento por tenant.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['classes', 'class_teachers', 'class_enrollments', 'class_sessions', 'class_attendance'] LOOP
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
VALUES ('0010', 'ensino')
ON CONFLICT (version) DO NOTHING;
