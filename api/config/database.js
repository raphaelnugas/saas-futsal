const { Pool } = require('pg');

// Configuração da conexão
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'futsal_nautico',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: false,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 10000,
  max: 20,
  allowExitOnIdle: true
});

// Testar conexão ao iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err.message);
    return;
  }
  
  console.log('✅ Conexão com banco de dados estabelecida');
  
  // Testar se as tabelas existem
  client.query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = \'public\'', (err, result) => {
    release();
    
    if (err) {
      console.error('❌ Erro ao verificar tabelas:', err.message);
      return;
    }
    
    const tableCount = parseInt(result.rows[0].count);
    console.log(`📊 ${tableCount} tabelas encontradas no banco de dados`);
  });
});

// Função auxiliar para queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`📝 Query executada em ${duration}ms: ${text.substring(0, 50)}...`);
    }
    
    return res;
  } catch (error) {
    console.error('❌ Erro na query:', error.message);
    console.error('📋 Query:', text);
    console.error('📊 Parâmetros:', params);
    throw error;
  }
};

// Função para transações
const transaction = async (callback) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  transaction
};