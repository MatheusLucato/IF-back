-- =============================================================================
-- Edifico — Migration 0044 · drop users.is_approved (fim do Centro de Aprovações)
-- -----------------------------------------------------------------------------
-- O Centro de Aprovações foi removido do produto. O cadastro de líderes (e
-- demais membros) passa a ser feito exclusivamente por convite (0042), e todo
-- usuário criado já entra ativo — não existe mais o estado "pendente de
-- aprovação". Esta migration remove a coluna `users.is_approved`, que perdeu o
-- propósito.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar.
-- =============================================================================

ALTER TABLE public.users DROP COLUMN IF EXISTS is_approved;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0044', 'drop_is_approved')
ON CONFLICT (version) DO NOTHING;
