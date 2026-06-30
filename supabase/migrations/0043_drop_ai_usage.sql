-- =============================================================================
-- Edifico — Migration 0043 · drop ai_usage (remoção do Assistente de IA)
-- -----------------------------------------------------------------------------
-- O Assistente de IA (F10.3 / Onda 6) foi removido do produto. Esta migration
-- desfaz a 0040: remove a tabela `ai_usage` (e, em cascata, sua policy de RLS e
-- índices) e apaga o registro de 0040 do ledger `schema_migrations`.
--
-- Painel executivo (F10.1) e Relatórios (F10.2) NÃO são afetados.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar.
-- =============================================================================

DROP TABLE IF EXISTS public.ai_usage CASCADE;

-- A 0040 deixa de existir como migration: limpa o ledger para refletir o estado.
DELETE FROM schema_migrations WHERE version = '0040';

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0043', 'drop_ai_usage')
ON CONFLICT (version) DO NOTHING;
