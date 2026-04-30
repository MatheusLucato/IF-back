-- Opcional: execute depois do schema
INSERT INTO users (name, full_name, email, password_hash, role, is_approved)
VALUES ('Admin', 'Admin', 'admin@igrejafamilia.com', crypt('admin123', gen_salt('bf')), 'admin', true)
ON CONFLICT (email) DO UPDATE
SET
	name = EXCLUDED.name,
	full_name = EXCLUDED.full_name,
	password_hash = EXCLUDED.password_hash,
	role = EXCLUDED.role,
	is_approved = EXCLUDED.is_approved;
