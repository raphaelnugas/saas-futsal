const { Pool } = require('pg');
require('dotenv').config();

// Configuração da conexão - otimizada para PostgreSQL na unidade Z:
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'futsal_nautico',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false,
  connectionTimeoutMillis: 15000, // Aumentado para 15 segundos para conexões mais lentas
  idleTimeoutMillis: 10000,
  max: 5, // Reduzido para evitar problemas de conexão com múltiplas instâncias
});

async function testConnection() {
  console.log('🔄 Testando conexão com PostgreSQL...');
  console.log(`   Host: ${pool.options.host}:${pool.options.port}`);
  console.log(`   Database: ${pool.options.database}`);
  console.log(`   User: ${pool.options.user}`);
  console.log('');
  
  const client = await pool.connect();
  
  try {
    // Testar conexão básica
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Conexão estabelecida com sucesso!');
    console.log(`   Horário do servidor: ${result.rows[0].current_time}`);
    console.log(`   Versão do PostgreSQL: ${(await client.query('SELECT version()')).rows[0].version}`);
    console.log('');
    
    // Verificar se as tabelas existem
    console.log('📋 Verificando tabelas do banco:');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (tables.rows.length === 0) {
      console.log('   ❌ Nenhuma tabela encontrada. Execute o schema primeiro.');
      console.log('   💡 Dica: Execute: npm run db:setup');
      return;
    }
    
    tables.rows.forEach(table => {
      console.log(`   ✅ ${table.table_name}`);
    });
    console.log('');
    
    // Verificar views
    console.log('👁️  Verificando views:');
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
    } else {
      console.log('   ℹ️  Nenhuma view encontrada.');
    }
    console.log('');
    
    // Testar ranking de jogadores
    console.log('🏆 Top 5 jogadores (ranking):');
    try {
      const ranking = await client.query('SELECT * FROM player_ranking LIMIT 5');
      
      if (ranking.rows.length === 0) {
        console.log('   ℹ️  Sem dados de jogadores ainda.');
        console.log('   💡 Dica: Execute: npm run db:seed');
      } else {
        ranking.rows.forEach((player, index) => {
          console.log(`   ${index + 1}. ${player.name} - ${player.total_goals_scored} gols, ${player.total_assists} assistências`);
        });
      }
    } catch (err) {
      console.log('   ⚠️  View player_ranking não encontrada.');
      console.log('   💡 Dica: Execute o schema primeiro: npm run db:setup');
    }
    console.log('');
    
    // Testar estatísticas de goleiros
    console.log('🥅 Goleiros:');
    try {
      const goalkeepers = await client.query('SELECT * FROM goalkeeper_stats');
      
      if (goalkeepers.rows.length === 0) {
        console.log('   ℹ️  Sem goleiros cadastrados.');
      } else {
        goalkeepers.rows.forEach((gk, index) => {
          console.log(`   ${index + 1}. ${gk.name} - ${gk.total_goals_conceded} gols sofridos (${gk.goals_conceded_per_game} por jogo)`);
        });
      }
    } catch (err) {
      console.log('   ⚠️  View goalkeeper_stats não encontrada.');
    }
    console.log('');
    
    // Testar partidas recentes
    console.log('⚽ Partidas recentes:');
    try {
      const matches = await client.query('SELECT * FROM daily_matches LIMIT 3');
      
      if (matches.rows.length === 0) {
        console.log('   ℹ️  Sem partidas registradas.');
      } else {
        matches.rows.forEach((match, index) => {
          console.log(`   ${index + 1}. ${match.date} - Jogo ${match.match_number}: Orange ${match.team_orange_score}x${match.team_black_score} Black`);
        });
      }
    } catch (err) {
      console.log('   ⚠️  View daily_matches não encontrada.');
    }
    console.log('');
    
    // Estatísticas do banco
    console.log('📊 Estatísticas do banco:');
    try {
      const stats = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM players) as total_players,
          (SELECT COUNT(*) FROM matches) as total_matches,
          (SELECT COUNT(*) FROM game_sundays) as total_sundays,
          (SELECT COUNT(*) FROM stats_log) as total_goals
      `);
      
      const stat = stats.rows[0];
      console.log(`   👥 Total de jogadores: ${stat.total_players}`);
      console.log(`   ⚽ Total de partidas: ${stat.total_matches}`);
      console.log(`   📅 Total de domingos: ${stat.total_sundays}`);
      console.log(`   🥅 Total de gols registrados: ${stat.total_goals}`);
    } catch (err) {
      console.log('   ⚠️  Erro ao obter estatísticas.');
    }
    
    console.log('');
    console.log('🎉 Teste de conexão concluído com sucesso!');
    console.log('');
    console.log('💡 Próximos passos:');
    console.log('   1. Configure suas variáveis de ambiente no arquivo .env');
    console.log('   2. Execute: npm run db:setup (se ainda não executou)');
    console.log('   3. Execute: npm run db:seed (para inserir dados de teste)');
    console.log('   4. Configure o backend e frontend conforme necessário');
    
  } catch (err) {
    console.error('❌ Erro durante o teste:', err.message);
    
    if (err.code === '28P01') {
      console.log('\n💡 Dica: Verifique a senha do usuário postgres no arquivo .env');
      console.log('   Exemplo: DB_PASSWORD=sua_senha_aqui');
    } else if (err.code === '3D000') {
      console.log('\n💡 Dica: O banco de dados não existe.');
      console.log('   Execute: npm run db:setup');
    } else if (err.code === 'ECONNREFUSED') {
      console.log('\n💡 Dica: Verifique se o PostgreSQL está rodando.');
      console.log('   Verifique se o serviço está iniciado.');
      console.log('   Verifique se a porta 5432 não está bloqueada.');
    } else if (err.message.includes('connect')) {
      console.log('\n💡 Dica: Problema de conexão. Verifique:');
      console.log('   - Se o PostgreSQL está rodando');
      console.log('   - Se o host e porta estão corretos');
      console.log('   - Se o usuário e senha estão corretos');
      console.log('   - Se o firewall não está bloqueando');
    }
    
    console.log('\n🔧 Configuração atual:');
    console.log(`   Host: ${pool.options.host}:${pool.options.port}`);
    console.log(`   Database: ${pool.options.database}`);
    console.log(`   User: ${pool.options.user}`);
    console.log(`   Password: ${pool.options.password ? '✅ Configurada' : '❌ Não configurada'}`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

// Executar o teste
if (require.main === module) {
  testConnection().catch(console.error);
}

module.exports = { testConnection, pool };