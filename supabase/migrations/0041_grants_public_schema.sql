-- =============================================================================
-- Edifico — Migration 0041 · grants_public_schema
-- -----------------------------------------------------------------------------
-- Concede os privilégios dos roles padrão do Supabase (anon, authenticated,
-- service_role) sobre o schema `public`.
--
-- POR QUE EXISTE: o Supabase normalmente aplica esses GRANTs automaticamente,
-- mas projetos criados/restaurados fora do fluxo normal podem nascer SEM eles.
-- Sintoma: o backend conecta (a service_role key é válida e auth.admin funciona)
-- mas qualquer `select`/`insert` em tabela do public falha com
-- "permission denied for table ...". Não é RLS nem chave errada — é GRANT.
--
-- O que cada role precisa:
--   * service_role  -> acesso TOTAL (backend privilegiado; ignora RLS).
--   * authenticated -> CRUD base; o ISOLAMENTO por tenant é feito pelo RLS.
--   * anon          -> CRUD base; idem (RLS restringe o que é visível).
-- O ALTER DEFAULT PRIVILEGES garante que tabelas/sequences FUTURAS já nasçam
-- com os grants, sem precisar repetir isto a cada nova migration.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: GRANT/ALTER DEFAULT PRIVILEGES são seguros de reaplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Acesso ao schema.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. service_role: acesso total às tabelas/sequences/funções EXISTENTES.
-- -----------------------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- -----------------------------------------------------------------------------
-- 3. anon/authenticated: grant base (o RLS é quem isola por tenant).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 4. Privilégios padrão para objetos FUTUROS (evita repetir o problema).
--    Aplica-se a objetos criados pelo role que executa este ALTER (postgres no
--    SQL Editor). É o mesmo dono que cria os objetos das demais migrations.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0041', 'grants_public_schema')
ON CONFLICT (version) DO NOTHING;
