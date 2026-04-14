-- Opcional: execute depois do schema
INSERT INTO users (name, full_name, email, password, password_hash, role, is_approved)
VALUES ('Admin', 'Admin', 'admin@igrejafamilia.com', 'admin123', 'admin123', 'admin', true)
ON CONFLICT (email) DO UPDATE
SET
	name = EXCLUDED.name,
	full_name = EXCLUDED.full_name,
	password = EXCLUDED.password,
	password_hash = EXCLUDED.password_hash,
	role = EXCLUDED.role,
	is_approved = EXCLUDED.is_approved;
