-- =============================================================================
-- Edifico — Migration 0045 · CNPJ único por igreja
-- -----------------------------------------------------------------------------
-- O cadastro da igreja (onboarding) passou a exigir CNPJ válido e o produto não
-- pode ter duas igrejas com o mesmo CNPJ. Esta migration cria um índice ÚNICO
-- FUNCIONAL sobre os DÍGITOS do CNPJ (regexp_replace remove máscara), de modo que
-- "12.345.678/0001-99" e "12345678000199" colidam mesmo com formatações diferentes.
--
-- É PARCIAL (WHERE cnpj IS NOT NULL AND btrim(cnpj) <> ''): igrejas antigas, que
-- nunca preencheram CNPJ (NULL), continuam válidas e não conflitam entre si.
--
-- ATENÇÃO: se já existirem CNPJs duplicados na base, a criação do índice falha —
-- resolva os duplicados antes de aplicar.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_churches_cnpj_digits
  ON public.churches ((regexp_replace(cnpj, '[^0-9]', '', 'g')))
  WHERE cnpj IS NOT NULL AND btrim(cnpj) <> '';

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0045', 'churches_cnpj_unique')
ON CONFLICT (version) DO NOTHING;
