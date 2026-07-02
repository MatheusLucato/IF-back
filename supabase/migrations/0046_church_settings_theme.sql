-- =============================================================================
-- Edifico — Migration 0046 · Tema pré-definido por igreja (Color Presets)
-- -----------------------------------------------------------------------------
-- A escolha livre de cores (color picker) foi substituída por temas prontos,
-- curados pela equipe do Edifico. A igreja agora seleciona apenas o IDENTIFICADOR
-- de um tema; as cores concretas vivem no código (IF-back/src/lib/themePresets.js
-- e o espelho no front). Assim, ajustar um tema não exige tocar no banco.
--
-- Esta coluna é a nova fonte da verdade da identidade visual. As colunas color_*
-- continuam existindo (denormalizadas a partir do tema no gravar) para leitores
-- diretos/legados — mas o read path resolve as cores a partir de `theme`.
--
-- NULL = igreja sem tema definido (dados antigos): o sistema mantém o
-- comportamento anterior, usando as cores já gravadas em color_*.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar.
-- =============================================================================

ALTER TABLE public.church_settings
  ADD COLUMN IF NOT EXISTS theme text;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0046', 'church_settings_theme')
ON CONFLICT (version) DO NOTHING;
