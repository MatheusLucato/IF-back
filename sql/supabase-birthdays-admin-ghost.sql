-- Migração incremental: data de nascimento + visão de aniversariantes sem admin
-- Pode ser executada em bancos já existentes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date date;

CREATE INDEX IF NOT EXISTS idx_users_birth_date ON users(birth_date);

-- View util para consultas de aniversariantes sem exibir admins (admin fantasma)
CREATE OR REPLACE VIEW public.v_users_birthdays AS
SELECT
  u.id,
  COALESCE(NULLIF(btrim(u.name), ''), u.full_name) AS name,
  u.email,
  u.birth_date,
  u.created_at
FROM users u
WHERE u.role <> 'admin'
  AND u.birth_date IS NOT NULL;
