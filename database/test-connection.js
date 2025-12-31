const { Pool } = require('pg');
require('dotenv').config();

// Configuração da conexão
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'futsal_domingo',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

async function testConnection() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Testando conexão com PostgreSQL...');
    
    // Testar conexão básica
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Conexão estabelecida com sucesso!');
    console.log(`   Horário do servidor: ${result.rows[0].current_time}`);
    
    // Verificar se as tabelas existem
    console.log('\n📋 Verificando tabelas do banco:');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (tables.rows.length === 0) {
      console.log('   ❌ Nenhuma tabela encontrada. Execute o schema primeiro.');
      return;
    }
    
    tables.rows.forEach(table => {
      console.log(`   ✅ ${table.table_name}`);
    });
    
    // Testar views
    console.log('\n👁️  Verificando views:');
    const views = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (views.rows.length > 0) {
      views.rows.forEach(view => {
        console.log(`   👁️  ${view.table_name}`);
      });
    }
    
    // Testar ranking de jogadores
    console.log('\n🏆 Top 5 jogadores (ranking):');
    const ranking = await client.query('SELECT * FROM player_ranking LIMIT 5');
    
    if (ranking.rows.length === 0) {
      console.log('   ℹ️  Sem dados de jogadores ainda.');
    } else {
      ranking.rows.forEach((player, index) => {
        console.log(`   ${index + 1}. ${player.name} - ${player.total_goals_scored} gols, ${player.total_assists} assistências`);
      });
    }
    
    // Testar estatísticas de goleiros
    console.log('\n🥅 Goleiros:');
    const goalkeepers = await client.query('SELECT * FROM goalkeeper_stats');
    
    if (goalkeepers.rows.length === 0) {
      console.log('   ℹ️  Sem goleiros cadastrados.');
    } else {
      goalkeepers.rows.forEach((gk, index) => {
        console.log(`   ${index + 1}. ${gk.name} - ${gk.total_goals_conceded} gols sofridos (${gk.goals_conceded_per_game} por jogo)`);
      });
    }
    
    // Testar partidas recentes
    console.log('\n⚽ Partidas recentes:');
    const matches = await client.query('SELECT * FROM daily_matches LIMIT 3');
    
    if (matches.rows.length === 0) {
      console.log('   ℹ️  Sem partidas registradas.');
    } else {
      matches.rows.forEach((match, index) => {
        console.log(`   ${index + 1}. ${match.date} - Jogo ${match.match_number}: Orange ${match.team_orange_score}x${match.team_black_score} Black`);
      });
    }
    
    console.log('\n🎉 Teste de conexão concluído com sucesso!');
    
  } catch (err) {
    console.error('❌ Erro durante o teste:', err.message);
    
    if (err.code === '28P01') {
      console.log('\n💡 Dica: Verifique a senha do usuário postgres.');
    } else if (err.code === '3D000') {
      console.log('\n💡 Dica: O banco de dados não existe. Execute o setup primeiro.');
    } else if (err.code === 'ECONNREFUSED') {
      console.log('\n💡 Dica: Verifique se o PostgreSQL está rodando na porta 5432.');
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}

// Executar o teste
testConnection();