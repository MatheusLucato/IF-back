-- [SUPERADO — HISTÓRICO] O admin/igreja padrão agora é criado pelo bootstrap do
-- backend (src/db.js: ensureDefaultChurch/ensureDefaultAdmin) via Supabase Auth.
-- Este seed direto em `users` é legado (password_hash local) e não reflete o
-- fluxo atual. Mantido apenas como referência.

-- Opcional: execute depois do schema
INSERT INTO users (name, full_name, email, password_hash, role)
VALUES ('Admin', 'Admin', 'admin@igrejafamilia.com', crypt('admin123', gen_salt('bf')), 'admin')
ON CONFLICT (email) DO UPDATE
SET
	name = EXCLUDED.name,
	full_name = EXCLUDED.full_name,
	password_hash = EXCLUDED.password_hash,
	role = EXCLUDED.role;
