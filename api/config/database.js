const { Pool } = require('pg');

const schema = process.env.DB_SCHEMA || 'public';

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: false,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      max: 20,
      allowExitOnIdle: true,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'futsal_nautico',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: false,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      max: 20,
      allowExitOnIdle: true,
    };

const pool = new Pool(poolConfig);

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err.message);
    return;
  }
  console.log('✅ Conexão com banco de dados estabelecida');
  client.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${schema}'`, (err, result) => {
    release();
    if (err) {
      console.error('❌ Erro ao verificar tabelas:', err.message);
      return;
    }
    console.log(`📊 ${result.rows[0].count} tabelas encontradas no schema ${schema}`);
  });
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`📝 Query em ${Date.now() - start}ms: ${text.substring(0, 50)}...`);
    }
    return res;
  } catch (error) {
    console.error('❌ Erro na query:', error.message);
    console.error('📋 Query:', text);
    console.error('📊 Parâmetros:', params);
    throw error;
  }
};

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

module.exports = { pool, query, transaction };
