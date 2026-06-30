// Migra usuários existentes (anteriores ao Supabase Auth) para o auth.users.
// Para cada profile (tabela users) sem auth_user_id, cria um usuário no Supabase
// Auth com uma senha temporária e vincula auth_user_id. Em seguida, cada pessoa
// deve usar "Esqueci a senha" para definir a própria senha.
//
// Uso (a partir de IF-back):  node scratch/migrate_users_to_auth.js
//
// Requer SUPABASE_SECRET_KEY no .env. Idempotente: pula quem já tem auth_user_id.

require('dotenv').config();
const { getSupabase } = require('../src/db');

const TEMP_PASSWORD = process.env.MIGRATION_TEMP_PASSWORD || 'Mudar@123456';

async function main() {
  const supabase = getSupabase();

  const { data: profiles, error } = await supabase
    .from('users')
    .select('id,email,auth_user_id')
    .is('auth_user_id', null);

  if (error) throw new Error(error.message);

  if (!profiles || profiles.length === 0) {
    console.log('Nada a migrar: todos os usuários já possuem auth_user_id.');
    return;
  }

  console.log(`Migrando ${profiles.length} usuário(s)...`);
  let migrated = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const email = (profile.email || '').trim().toLowerCase();
    if (!email || email.endsWith('@local.invalid')) {
      skipped += 1;
      continue;
    }

    let authUserId = null;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
    });

    if (created?.user) {
      authUserId = created.user.id;
    } else if (createError && /already.*registered|exists/i.test(createError.message || '')) {
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      authUserId = list?.users?.find((u) => (u.email || '').toLowerCase() === email)?.id || null;
    } else if (createError) {
      console.error(`  ! ${email}: ${createError.message}`);
      skipped += 1;
      continue;
    }

    if (!authUserId) {
      skipped += 1;
      continue;
    }

    const { error: linkError } = await supabase
      .from('users')
      .update({ auth_user_id: authUserId })
      .eq('id', profile.id);

    if (linkError) {
      console.error(`  ! ${email}: ${linkError.message}`);
      skipped += 1;
      continue;
    }

    migrated += 1;
    console.log(`  ✓ ${email}`);
  }

  console.log(`\nConcluído. Migrados: ${migrated}, pulados: ${skipped}.`);
  console.log(`Senha temporária: "${TEMP_PASSWORD}". Peça aos usuários para usar "Esqueci a senha".`);
}

main().catch((err) => {
  console.error('Falha na migração:', err.message);
  process.exit(1);
});
