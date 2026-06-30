#!/usr/bin/env node
/*
 * Edifico — gerador de migrations.
 *
 * NÃO toca no banco. Apenas cria/lista arquivos em supabase/migrations/,
 * seguindo a convenção NNNN_descricao.sql. O SQL é sempre aplicado manualmente
 * (ver supabase/migrations/README.md).
 *
 * Uso:
 *   node scripts/new-migration.js create_members_table
 *   node scripts/new-migration.js --list
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const FILE_RE = /^(\d{4})_(.+)\.sql$/;

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((file) => {
      const match = file.match(FILE_RE);
      return match ? { file, version: match[1], name: match[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

function nextVersion(migrations) {
  const last = migrations.length ? Number(migrations[migrations.length - 1].version) : 0;
  return String(last + 1).padStart(4, '0');
}

function slugify(raw) {
  return String(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (ã→a, ç→c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function template(version, name) {
  return `-- =============================================================================
-- Edifico — Migration ${version} · ${name}
-- -----------------------------------------------------------------------------
-- Descreva aqui o objetivo desta migration.
--
-- Aplique MANUALMENTE (SQL Editor do Supabase ou \`supabase db push\`).
-- Convenção: ver docs/CONVENCAO-BANCO.md.
-- =============================================================================

-- TODO: seu SQL aqui (idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS).


-- -----------------------------------------------------------------------------
-- Registra esta migration como aplicada.
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('${version}', '${name}')
ON CONFLICT (version) DO NOTHING;
`;
}

function main() {
  const arg = process.argv[2];
  const migrations = listMigrations();

  if (!arg || arg === '--list' || arg === '-l') {
    if (!migrations.length) {
      console.log('Nenhuma migration encontrada em supabase/migrations/.');
    } else {
      console.log('Migrations em supabase/migrations/:\n');
      migrations.forEach((m) => console.log(`  ${m.version}  ${m.file}`));
    }
    if (!arg) {
      console.log('\nUso: node scripts/new-migration.js <descricao_em_snake_case>');
    }
    return;
  }

  const name = slugify(arg);
  if (!name) {
    console.error('Descrição inválida. Ex.: node scripts/new-migration.js create_members_table');
    process.exit(1);
  }

  const version = nextVersion(migrations);
  const fileName = `${version}_${name}.sql`;
  const filePath = path.join(MIGRATIONS_DIR, fileName);

  if (fs.existsSync(filePath)) {
    console.error(`Já existe: ${fileName}`);
    process.exit(1);
  }

  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  fs.writeFileSync(filePath, template(version, name), 'utf8');
  console.log(`Criada: supabase/migrations/${fileName}`);
  console.log('Edite o SQL e aplique manualmente (ver supabase/migrations/README.md).');
}

main();
