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
  is_approved boolean NOT NULL DEFAULT false,
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
  ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false,
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

UPDATE users
SET is_approved = false
WHERE is_approved IS NULL;

ALTER TABLE users
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN full_name SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'membro',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN is_approved SET DEFAULT false,
  ALTER COLUMN is_approved SET NOT NULL,
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
  functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  teams jsonb NOT NULL DEFAULT '[]'::jsonb,
  repertoire jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ministries
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS managers jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS member_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS is_music_ministry boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS functions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS teams jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repertoire jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE ministries
SET managers = '[]'::jsonb
WHERE managers IS NULL;

UPDATE ministries
SET functions = '[]'::jsonb
WHERE functions IS NULL;

UPDATE ministries
SET teams = '[]'::jsonb
WHERE teams IS NULL;

UPDATE ministries
SET repertoire = '[]'::jsonb
WHERE repertoire IS NULL;

UPDATE ministries
SET member_count = 0
WHERE member_count IS NULL;

UPDATE ministries
SET color = '#ffffff'
WHERE color IS NULL;

UPDATE ministries
SET is_music_ministry = false
WHERE is_music_ministry IS NULL;

UPDATE ministries
SET is_music_ministry = false
WHERE name = 'Recepção';

UPDATE ministries
SET name = 'Ministerio sem nome'
WHERE name IS NULL OR btrim(name) = '';

ALTER TABLE ministries
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN managers SET DEFAULT '[]'::jsonb,
  ALTER COLUMN managers SET NOT NULL,
  ALTER COLUMN member_count SET DEFAULT 0,
  ALTER COLUMN member_count SET NOT NULL,
  ALTER COLUMN color SET DEFAULT '#ffffff',
  ALTER COLUMN color SET NOT NULL,
  ALTER COLUMN functions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN functions SET NOT NULL,
  ALTER COLUMN teams SET DEFAULT '[]'::jsonb,
  ALTER COLUMN teams SET NOT NULL,
  ALTER COLUMN repertoire SET DEFAULT '[]'::jsonb,
  ALTER COLUMN repertoire SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS ministry_members (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

ALTER TABLE ministry_members
  ADD COLUMN IF NOT EXISTS function_name text;

ALTER TABLE ministry_members
  ADD COLUMN IF NOT EXISTS function_names jsonb;

UPDATE ministry_members
SET function_name = 'Membro'
WHERE function_name IS NULL OR btrim(function_name) = '';

UPDATE ministry_members
SET function_names = jsonb_build_array(function_name)
WHERE function_names IS NULL
  OR jsonb_typeof(function_names) <> 'array'
  OR jsonb_array_length(function_names) = 0;

ALTER TABLE ministry_members
  ALTER COLUMN function_name SET NOT NULL,
  ALTER COLUMN function_name SET DEFAULT 'Membro',
  ALTER COLUMN function_names SET NOT NULL,
  ALTER COLUMN function_names SET DEFAULT '["Membro"]'::jsonb;

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
