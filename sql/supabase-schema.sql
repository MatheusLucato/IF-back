-- Execute no SQL Editor do Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'lider', 'membro');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  password_hash text NOT NULL,
  birth_date date,
  role user_role NOT NULL DEFAULT 'membro',
  is_approved boolean NOT NULL DEFAULT false,
  profile_picture text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS password text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'membro',
  ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_picture text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

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
SET password = 'change-me'
WHERE password IS NULL OR btrim(password) = '';

UPDATE users
SET password = password_hash
WHERE (password IS NULL OR btrim(password) = '')
  AND password_hash IS NOT NULL
  AND btrim(password_hash) <> '';

UPDATE users
SET password_hash = password
WHERE password_hash IS NULL OR btrim(password_hash) = '';

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
  ALTER COLUMN password SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'membro',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN is_approved SET DEFAULT false,
  ALTER COLUMN is_approved SET NOT NULL,
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
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ministries
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS managers jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS member_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS functions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE ministries
SET managers = '[]'::jsonb
WHERE managers IS NULL;

UPDATE ministries
SET functions = '[]'::jsonb
WHERE functions IS NULL;

UPDATE ministries
SET member_count = 0
WHERE member_count IS NULL;

UPDATE ministries
SET color = '#ffffff'
WHERE color IS NULL;

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
  ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS ministry_members (
  ministry_id uuid NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ministry_id, user_id)
);

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
