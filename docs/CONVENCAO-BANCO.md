# Convenção de Banco — Edifico

Regras para evoluir o schema com segurança num produto **multi-tenant white
label**. Vale para toda migration em [`supabase/migrations/`](../supabase/migrations/).
Em caso de dúvida, espelhe o que a [baseline `0001`](../supabase/migrations/0001_baseline.sql)
já faz.

---

## 1. Princípios inegociáveis

- **Banco sob controle do usuário.** Nenhum SQL roda automaticamente pela
  aplicação. Todo SQL é gerado, **explicado** e aplicado **manualmente**
  (SQL Editor do Supabase ou Supabase CLI). Ver
  [migrations/README.md](../supabase/migrations/README.md).
- **Migration é imutável.** Migration aplicada nunca é editada; corrige-se com
  uma **nova** migration numerada.
- **Idempotência.** Prefira `IF NOT EXISTS` / `CREATE OR REPLACE` /
  `DROP ... IF EXISTS` para que reaplicar seja seguro.
- **Sem env fictícia.** Toda variável de ambiente nova é listada (nome,
  finalidade, exemplo, onde é usada) — sem valores inventados.

---

## 2. Nomenclatura

| Objeto | Convenção | Exemplo |
|--------|-----------|---------|
| Tabela | `snake_case`, **plural** | `members`, `family_members` |
| Coluna | `snake_case`, **singular** | `full_name`, `birth_date` |
| Chave primária | `id uuid` (default `gen_random_uuid()`) | `id` |
| Chave estrangeira | `<entidade_singular>_id` | `member_id`, `church_id` |
| Índice | `idx_<tabela>_<coluna(s)>` | `idx_members_church_id` |
| Índice único | `idx_<tabela>_<coluna(s)>` (com `UNIQUE`) | `idx_users_email_per_church` |
| Enum (tipo) | `snake_case` singular | `user_role`, `theme_preference` |
| Função | `snake_case`, verbo | `current_church_id()`, `sync_ministry_member_count()` |
| Trigger | `trg_<descrição>` | `trg_sync_ministry_member_count_insert` |
| Policy RLS | `tenant_isolation` (padrão único por tabela) | — |

- O banco é **snake_case**; a API é **camelCase**. A conversão fica nos
  `mapX(row)` do backend (ex.: `mapUser`, `mapMinistry` em `src/server.js`) —
  **não** vaze snake_case para o frontend nem camelCase para o banco.

---

## 3. Multi-tenant: `church_id` é obrigatório

Toda tabela de dados de negócio **carrega `church_id`** — inclusive tabelas de
junção (simplifica e blinda o RLS):

```sql
church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE
```

- Crie sempre o índice `idx_<tabela>_church_id`.
- No backend, **toda** query é escopada por `.eq('church_id', req.churchId)`.
  Esta é a **barreira primária** de isolamento (o backend usa a service-role
  key, que **ignora o RLS**).
- **Exceção:** metadados de infraestrutura que não pertencem a um tenant (ex.:
  `schema_migrations`) **não** levam `church_id`.

---

## 4. RLS (defesa em profundidade)

Mesmo com o scoping no código, toda tabela de tenant habilita RLS com a política
padrão "mesma igreja do usuário OU admin de plataforma". Reaproveite o bloco
`DO $$ ... tenant_tables ...` da baseline — **adicione o nome da nova tabela ao
array** numa migration:

```sql
ALTER TABLE public.minha_tabela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.minha_tabela;
CREATE POLICY tenant_isolation ON public.minha_tabela
  FOR ALL TO authenticated
  USING (church_id = public.current_church_id() OR public.is_platform_admin())
  WITH CHECK (church_id = public.current_church_id() OR public.is_platform_admin());
```

- Tabelas em `public` **sem RLS** geram alerta de segurança no Supabase. Se a
  tabela não for de tenant e não deva ser lida por clientes, habilite RLS **sem
  policy** (nega tudo a `authenticated`/`anon`; só a service-role acessa) — é o
  que a baseline faz com `schema_migrations`.
- Funções de tenant (`current_church_id()`, `is_platform_admin()`) são
  `SECURITY DEFINER` com `search_path = public`. `is_platform_admin()` compara
  `role::text` de propósito, para não depender de o valor do enum estar
  "commitado" na mesma transação.

---

## 5. Colunas padrão

- **PK:** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (exceto catálogos com id
  textual externo, como `repertoire_songs.id text`).
- **Timestamps:** `created_at timestamptz NOT NULL DEFAULT now()`; adicione
  `updated_at timestamptz NOT NULL DEFAULT now()` quando a entidade é editável.
- **Defaults explícitos** em `NOT NULL` (ex.: `jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `boolean NOT NULL DEFAULT false`) — evita linhas inválidas e simplifica o
  backfill.

---

## 6. Tipos

- **Enum** para conjuntos fechados e estáveis (`user_role`, `theme_preference`).
  Adicionar valor: `ALTER TYPE ... ADD VALUE` protegido por checagem em
  `pg_enum` (idempotente — ver baseline). Lembre: um valor de enum recém-criado
  **não** pode ser usado na mesma transação em que foi adicionado.
- **`jsonb`** só para estruturas internas e flexíveis (ex.: `ministries.teams`,
  `schedules.assignments`, `church_settings.settings`). **Evite** `jsonb` para
  dados que precisam de integridade referencial, filtros relacionais ou
  relatórios (ex.: futuro financeiro) — esses pedem **colunas/tabelas
  próprias**.
- **`text`** para strings (não `varchar(n)`); valide tamanho/forma na aplicação
  (zod — F0.4).
- **Dinheiro (quando entrar a Fase 5):** `numeric(14,2)`, nunca `float`.

---

## 7. Índices

- Crie índice para toda FK usada em filtro/join e para colunas de busca/ordenação
  frequentes (ex.: `created_at DESC`, `date`).
- Unicidade **por tenant**, não global. Padrão de e-mail:
  `CREATE UNIQUE INDEX idx_users_email_per_church ON users(church_id, lower(email));`
  (e-mail é único **por igreja**, não globalmente — a mesma pessoa pode existir
  em igrejas diferentes).
- Para busca textual de pessoas (Fase 1), considerar `pg_trgm` em `full_name`.

---

## 8. Exclusões e integridade

- **`ON DELETE CASCADE`** quando o filho não faz sentido sem o pai (junções de
  ministério, settings da igreja).
- **`ON DELETE SET NULL`** quando a referência é opcional e o registro sobrevive
  (ex.: `schedules.created_by_user_id`, `schedules.music_minister_id`).
- Prefira deixar o banco fazer a cascata a repetir cascata manual no código.

---

## 9. Checklist para uma nova migration

1. `npm run db:new -- descricao` cria o arquivo numerado.
2. Tabela nova tem: `id`, `church_id NOT NULL` (se for de tenant), timestamps,
   defaults explícitos.
3. Índices: `idx_<tabela>_church_id` + os de busca/FK.
4. RLS habilitado + policy `tenant_isolation` (ou RLS sem policy, se metadado).
5. SQL idempotente e revisável; backfill separado da estrutura quando der.
6. Termina com `INSERT INTO schema_migrations (version, name) VALUES (...) ON CONFLICT DO NOTHING;`.
7. Mappers/validação no backend atualizados (snake_case ⇄ camelCase).
8. Aplicada **manualmente** em staging → produção.
