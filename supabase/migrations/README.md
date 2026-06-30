# Migrations do Edifico

Esta pasta é a **fonte única de verdade** do schema do banco. Toda mudança de
banco — daqui em diante — vira um arquivo de migration **numerado, revisável e
versionado**, em vez de SQL "idempotente gigante" + *fallbacks* de schema em
runtime (como o `supportsMinistryTeamsColumn` em `src/server.js`).

> **Regra de ouro (inegociável):** a aplicação **nunca executa SQL
> automaticamente**. Todo SQL é gerado, revisado e aplicado **manualmente** por
> você no SQL Editor do Supabase (ou via Supabase CLI). Os scripts npm aqui
> apenas **geram/listam arquivos** — não tocam no banco.

---

## Convenção de nomes

```
NNNN_descricao_em_snake_case.sql
```

- `NNNN` = número sequencial de 4 dígitos, **sem buracos** (`0001`, `0002`, …).
- `descricao` curta no infinitivo/sujeito (ex.: `create_members_table`,
  `add_audit_log`, `members_add_cpf_index`).
- Um arquivo por funcionalidade. Migrations **nunca** são editadas depois de
  aplicadas — corrige-se com uma **nova** migration.

A baseline `0001_baseline.sql` consolida todo o estado que existia antes deste
versionamento (os antigos `sql/supabase-schema.sql` +
`sql/saas-multitenant-migration.sql`).

---

## Controle do que já foi aplicado

A baseline cria a tabela `schema_migrations (version, name, applied_at)`. **Toda
migration termina registrando-se** nela:

```sql
INSERT INTO schema_migrations (version, name)
VALUES ('0002', 'create_members_table')
ON CONFLICT (version) DO NOTHING;
```

Para ver o que já foi aplicado no banco:

```sql
SELECT version, name, applied_at FROM schema_migrations ORDER BY version;
```

`schema_migrations` é metadado de infraestrutura (não é dado de tenant): tem RLS
habilitado **sem policy**, então fica invisível para clientes `authenticated`/
`anon` — só a service-role do backend a enxerga.

---

## Fluxo de trabalho

### 1. Criar uma nova migration

```bash
npm run db:new -- create_members_table
```

Isso cria `supabase/migrations/000N_create_members_table.sql` já com o cabeçalho
padrão e o rodapé de `INSERT INTO schema_migrations`. Edite o conteúdo.

`npm run db:list` mostra todas as migrations da pasta.

### 2. Escrever o SQL

- Idempotente sempre que possível (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  `DROP ... IF EXISTS`), para ser seguro reaplicar.
- Siga a [convenção de banco](../../docs/CONVENCAO-BANCO.md) (snake_case,
  `church_id NOT NULL`, timestamps, índices de tenant, RLS).
- Migrations de dados (backfill) separadas das de estrutura, quando possível.

### 3. Revisar e aplicar manualmente

**Opção A — SQL Editor do Supabase (padrão do projeto):**
1. Abra o projeto no painel Supabase → **SQL Editor**.
2. Cole o conteúdo do arquivo da migration **pendente**.
3. Rode e confira o resultado.

**Opção B — Supabase CLI (opcional, para quem tiver configurado):**
```bash
supabase db push        # aplica as migrations pendentes desta pasta
supabase migration list # compara local x remoto
```
A CLI espera as migrations exatamente em `supabase/migrations/`, que é onde elas
já estão.

### 4. Staging antes de produção

Mudanças de risco (alterar/renomear coluna, mudar tipo, backfill grande) devem
ser testadas primeiro num **projeto Supabase de staging** (cópia do schema) e só
então aplicadas em produção.

---

## A baseline `0001` e o banco que JÁ existe

A `0001_baseline.sql` foi escrita para servir aos dois cenários:

- **Banco novo (staging / novo projeto):** rode a baseline inteira — ela cria
  tudo do zero.
- **Banco atual (produção, já migrada à mão):** a baseline é **idempotente**.
  Rodá-la é um **no-op seguro** — todos os objetos já existem, então nada muda;
  o único efeito é registrar a linha `('0001','baseline')` em
  `schema_migrations`, "adotando" o banco existente no novo sistema de
  versionamento. **Não altera dados.**

### Verificar a baseline contra o banco (faça isto uma vez)

A baseline foi derivada dos arquivos SQL do repositório, não de um *dump* do
banco vivo. Antes de tratá-la como autoritativa, confirme que não há divergência:

```bash
# Requer Supabase CLI logado/linkado ao projeto:
supabase db dump --schema public -f schema_atual.sql
# Compare schema_atual.sql com 0001_baseline.sql (tabelas, colunas, índices,
# enums, funções, policies). Ajuste a baseline se algo divergir.
```

Sem a CLI, dá para inspecionar pelo SQL Editor:

```sql
-- Colunas por tabela:
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- Índices:
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY tablename, indexname;

-- Policies de RLS:
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
```

---

## Depois da baseline: aposentar os *fallbacks* de runtime

Com o schema garantido por migration, o *fallback* `supportsMinistryTeamsColumn`
/ `runMinistryQueryWithFallback` em `src/server.js` deixa de ser necessário (a
coluna `ministries.teams` sempre existe). A remoção dele é trabalho de uma fase
de modularização (F0.3), **não** desta — fica registrada aqui como pendência.
