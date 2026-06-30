-- =============================================================================
-- [SUPERADO — HISTÓRICO] Este arquivo foi consolidado na baseline versionada
-- em ../supabase/migrations/0001_baseline.sql (fase F0.2). Mantido apenas como
-- referência histórica. NÃO é mais a fonte de verdade do schema — para criar/
-- evoluir o banco, use as migrations (ver ../supabase/migrations/README.md).
-- =============================================================================

-- Execute no SQL Editor do Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'lider', 'membro');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'theme_preference') THEN
    CREATE TYPE theme_preference AS ENUM ('light', 'dark');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  birth_date date,
  role user_role NOT NULL DEFAULT 'membro',
  profile_picture text,
  theme_preference theme_preference NOT NULL DEFAULT 'light',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'membro',
  ADD COLUMN IF NOT EXISTS profile_picture text,
  ADD COLUMN IF NOT EXISTS theme_preference theme_preference DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE users
SET theme_preference = 'light'
WHERE theme_preference IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
      AND udt_name <> 'user_role'
  ) THEN
    ALTER TABLE users
    ALTER COLUMN role TYPE user_role
    USING (
      CASE
        WHEN role::text IN ('admin', 'lider', 'membro') THEN role::text
        ELSE 'membro'
      END
    )::user_role;
  END IF;
END $$;

UPDATE users
SET name = 'Usuario'
WHERE name IS NULL OR btrim(name) = '';

UPDATE users
SET full_name = name
WHERE (full_name IS NULL OR btrim(full_name) = '')
  AND name IS NOT NULL
  AND btrim(name) <> '';

UPDATE users
SET name = full_name
WHERE (name IS NULL OR btrim(name) = '')
  AND full_name IS NOT NULL
  AND btrim(full_name) <> '';

UPDATE users
SET full_name = 'Usuario'
WHERE full_name IS NULL OR btrim(full_name) = '';

UPDATE users
SET email = concat('user_', id::text, '@local.invalid')
WHERE email IS NULL OR btrim(email) = '';

UPDATE users
SET role = 'membro'
WHERE role IS NULL;

ALTER TABLE users
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN full_name SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'membro',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN theme_preference SET DEFAULT 'light',
  ALTER COLUMN theme_preference SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  leader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  managers jsonb NOT NULL DEFAULT '[]'::jsonb,
  member_count integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#ffffff',
  image_url text,
  is_music_ministry boolean NOT NULL DEFAULT false,
  functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  teams jsonb NOT NULL DEFAULT '[]'::jsonb,
  repertoire jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ministry_members (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  function_name text NOT NULL DEFAULT 'Membro',
  function_names jsonb NOT NULL DEFAULT '["Membro"]'::jsonb,
  function_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE TABLE IF NOT EXISTS ministry_ministers (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_ministers_user_id ON ministry_ministers(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_ministers_ministry_id ON ministry_ministers(ministry_id);

CREATE TABLE IF NOT EXISTS ministry_admins (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ministry_admins_user_id ON ministry_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_admins_ministry_id ON ministry_admins(ministry_id);

CREATE TABLE IF NOT EXISTS repertoire_songs (
  id text PRIMARY KEY,
  song jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ministry_repertoire (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  song_id text NOT NULL REFERENCES repertoire_songs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_repertoire_songs_updated_at ON repertoire_songs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ministry_repertoire_song_id ON ministry_repertoire(song_id);

CREATE INDEX IF NOT EXISTS idx_ministry_members_user_id ON ministry_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ministry_members_ministry_id ON ministry_members(ministry_id);

CREATE OR REPLACE FUNCTION sync_ministry_member_count()
RETURNS trigger AS $$
DECLARE
  target_ministry_id uuid;
BEGIN
  target_ministry_id := COALESCE(NEW.ministry_id, OLD.ministry_id);

  UPDATE ministries
  SET member_count = (
    SELECT COUNT(*)::integer
    FROM ministry_members
    WHERE ministry_id = target_ministry_id
  )
  WHERE id = target_ministry_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_insert ON ministry_members;
DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_delete ON ministry_members;
DROP TRIGGER IF EXISTS trg_sync_ministry_member_count_update ON ministry_members;

CREATE TRIGGER trg_sync_ministry_member_count_insert
AFTER INSERT ON ministry_members
FOR EACH ROW
EXECUTE FUNCTION sync_ministry_member_count();

CREATE TRIGGER trg_sync_ministry_member_count_delete
AFTER DELETE ON ministry_members
FOR EACH ROW
EXECUTE FUNCTION sync_ministry_member_count();

CREATE TRIGGER trg_sync_ministry_member_count_update
AFTER UPDATE OF ministry_id ON ministry_members
FOR EACH ROW
EXECUTE FUNCTION sync_ministry_member_count();

UPDATE ministries m
SET member_count = COALESCE(mm.cnt, 0)
FROM (
  SELECT ministry_id, COUNT(*)::integer AS cnt
  FROM ministry_members
  GROUP BY ministry_id
) mm
WHERE m.id = mm.ministry_id;

UPDATE ministries
SET member_count = 0
WHERE id NOT IN (SELECT DISTINCT ministry_id FROM ministry_members);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_birth_date ON users(birth_date);
CREATE INDEX IF NOT EXISTS idx_ministries_leader_id ON ministries(leader_id);
CREATE INDEX IF NOT EXISTS idx_ministries_created_at ON ministries(created_at DESC);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  service_time text NOT NULL,
  assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  songs jsonb NOT NULL DEFAULT '[]'::jsonb,
  music_ministry_id uuid REFERENCES ministries(id) ON DELETE SET NULL,
  music_minister_id uuid REFERENCES users(id) ON DELETE SET NULL,
  music_minister_name text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS date date,
  ADD COLUMN IF NOT EXISTS service_time text,
  ADD COLUMN IF NOT EXISTS assignments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS songs jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS music_ministry_id uuid REFERENCES ministries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS music_minister_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS music_minister_name text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE schedules
SET assignments = '[]'::jsonb
WHERE assignments IS NULL;

UPDATE schedules
SET songs = '[]'::jsonb
WHERE songs IS NULL;

ALTER TABLE schedules
  ALTER COLUMN assignments SET DEFAULT '[]'::jsonb,
  ALTER COLUMN assignments SET NOT NULL,
  ALTER COLUMN songs SET DEFAULT '[]'::jsonb,
  ALTER COLUMN songs SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_service_time ON schedules(service_time);
CREATE INDEX IF NOT EXISTS idx_schedules_created_by ON schedules(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_music_minister_id ON schedules(music_minister_id);

CREATE TABLE IF NOT EXISTS user_unavailable_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_user_unavailable_dates_user_id ON user_unavailable_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_user_unavailable_dates_date ON user_unavailable_dates(date);

