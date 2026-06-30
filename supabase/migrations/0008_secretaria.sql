-- =============================================================================
-- Edifico — Migration 0008 · Secretaria & Documentos (Fase 2)
-- -----------------------------------------------------------------------------
-- F2.1 — document_templates: modelos de documentos (carta de transferência,
--        recomendação, batismo, declaração de membresia) com placeholders
--        ({{nome}}, {{data_batismo}}) resolvidos a partir de members/church.
-- F2.2 — issued_documents: histórico de emissões (snapshot do conteúdo + dados).
-- F2.4 — institution_documents: repositório de documentos institucionais (atas,
--        estatuto, atos administrativos) com upload por tenant.
--
-- SEGURANÇA: API gated por RBAC (`secretaria.read/write`, F0.6). RLS abaixo é
-- defesa em profundidade (mesma política das demais tabelas de tenant). O backend
-- usa service-role (ignora RLS) → o scoping por `church_id` no código continua
-- obrigatório.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou `supabase db push`).
-- Idempotente: seguro reaplicar. Depende de: 0001 (churches/users), 0004 (members).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modelos de documentos (F2.1).
--    `type` é text validado no código (transfer | recommendation | baptism |
--    membership | declaration | other). `body` guarda o texto com placeholders.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'other',
  description text,
  body        text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_templates_church   ON document_templates(church_id);
CREATE INDEX IF NOT EXISTS idx_doc_templates_type     ON document_templates(church_id, type);

DROP TRIGGER IF EXISTS trg_doc_templates_updated_at ON document_templates;
CREATE TRIGGER trg_doc_templates_updated_at
  BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Documentos emitidos (F2.2). Guarda o snapshot do conteúdo renderizado no
--    momento da emissão (rendered_content) + file_url opcional (PDF no R2).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issued_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id         uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id         uuid REFERENCES members(id) ON DELETE SET NULL,
  template_id       uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  title             text NOT NULL,
  type              text NOT NULL DEFAULT 'other',
  rendered_content  text NOT NULL DEFAULT '',
  file_url          text,
  issued_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issued_docs_church  ON issued_documents(church_id);
CREATE INDEX IF NOT EXISTS idx_issued_docs_member  ON issued_documents(church_id, member_id);
CREATE INDEX IF NOT EXISTS idx_issued_docs_issued  ON issued_documents(church_id, issued_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Documentos institucionais (F2.4). Biblioteca de arquivos da igreja.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title        text NOT NULL,
  category     text NOT NULL DEFAULT 'other',
  description  text,
  file_url     text NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inst_docs_church    ON institution_documents(church_id);
CREATE INDEX IF NOT EXISTS idx_inst_docs_category  ON institution_documents(church_id, category);

DROP TRIGGER IF EXISTS trg_inst_docs_updated_at ON institution_documents;
CREATE TRIGGER trg_inst_docs_updated_at
  BEFORE UPDATE ON institution_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — isolamento por tenant (mesma política das demais tabelas).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := 'church_id = public.current_church_id() OR public.is_platform_admin()';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['document_templates', 'issued_documents', 'institution_documents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
      FOR ALL TO authenticated
      USING (%s)
      WITH CHECK (%s);
    $f$, tbl, predicate, predicate);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('0008', 'secretaria')
ON CONFLICT (version) DO NOTHING;
