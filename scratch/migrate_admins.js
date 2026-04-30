const { getSupabase } = require('../src/db');

async function migrate() {
  const supabase = getSupabase();
  console.log('Iniciando migração de tabelas de acesso...');

  // 1. Criar tabela ministry_admins se não existir (via RPC ou assumindo que podemos tentar inserir)
  // Como não temos RPC de execução de SQL, vamos apenas tentar usar a tabela.
  // Mas o usuário pediu para criar se necessário. 
  // Em projetos Supabase, geralmente criamos via Dashboard.
  // Vou tentar detectar se a tabela existe tentando um select.

  const { error: adminTableError } = await supabase.from('ministry_admins').select('count').limit(1);
  
  if (adminTableError && adminTableError.code === '42P01') {
    console.log('Tabela ministry_admins não encontrada. Você precisa criá-la no SQL Editor do Supabase:');
    console.log(`
      CREATE TABLE IF NOT EXISTS ministry_admins (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ministry_id UUID REFERENCES ministries(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(ministry_id, user_id)
      );
    `);
    // Se não pudermos criar via código, avisamos o usuário.
  } else {
    console.log('Tabela ministry_admins já existe.');
  }

  // 2. Migrar dados da coluna 'managers' para a nova tabela
  console.log('Migrando dados de administradores da coluna JSON para a nova tabela...');
  const { data: ministries, error: fetchError } = await supabase.from('ministries').select('id, managers');
  
  if (fetchError) {
    console.error('Erro ao buscar ministérios:', fetchError.message);
    return;
  }

  for (const m of ministries) {
    const managers = Array.isArray(m.managers) ? m.managers : [];
    if (managers.length > 0) {
      const rows = managers.map(userId => ({
        ministry_id: m.id,
        user_id: userId
      }));
      
      const { error: insertError } = await supabase.from('ministry_admins').upsert(rows, { onConflict: 'ministry_id,user_id' });
      if (insertError) {
        console.error(`Erro ao migrar administradores do ministério ${m.id}:`, insertError.message);
      }
    }
  }

  console.log('Migração concluída!');
}

migrate();
