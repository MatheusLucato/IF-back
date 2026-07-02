-- =============================================================================
-- Edifico — Migration 0046 · indisponibilidade_permissions
-- -----------------------------------------------------------------------------
-- Novo módulo próprio de Indisponibilidades para escalas (autoatendimento). A
-- funcionalidade já existia embutida no Perfil e usa a tabela existente
-- `user_unavailable_dates` (baseline 0001) — nenhuma tabela/coluna nova aqui.
--
-- Esta migração apenas CONCEDE as chaves de permissão do novo módulo aos
-- papéis-sistema (admin, pastor, lider, membro) das igrejas JÁ existentes, de
-- modo que ninguém perca o acesso ao autoatendimento após o módulo passar a ser
-- protegido por RBAC. Igrejas novas já nascem com as chaves via
-- seedSystemRolesForChurch (DEFAULT_ROLE_PERMISSIONS em IF-back/src/lib/permissions.js).
--
-- Reflete DEFAULT_ROLE_PERMISSIONS: admin/pastor = tudo; lider e membro recebem
-- indisponibilidade.read/write/delete. Mantenha os dois em sincronia.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar (ON CONFLICT DO NOTHING).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Concede as 3 chaves a admin, pastor, lider e membro (todos gerenciam as
-- próprias datas; a posse é reforçada no backend). Só age quando o schema de
-- RBAC (roles/role_permissions da 0002) já existe — caso contrário, é um no-op.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  new_keys text[] := ARRAY[
    'indisponibilidade.read',
    'indisponibilidade.write',
    'indisponibilidade.delete'
  ];
BEGIN
  IF to_regclass('public.role_permissions') IS NULL THEN
    RAISE NOTICE 'RBAC ausente (migração 0002 não aplicada) — pulando 0046.';
    RETURN;
  END IF;

  INSERT INTO role_permissions (role_id, permission_key, church_id)
  SELECT ro.id, k.key, ro.church_id
  FROM roles ro
  CROSS JOIN unnest(new_keys) AS k(key)
  WHERE ro.is_system
    AND ro.slug IN ('admin', 'pastor', 'lider', 'membro')
  ON CONFLICT (role_id, permission_key) DO NOTHING;
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0046', 'indisponibilidade_permissions')
ON CONFLICT (version) DO NOTHING;
