const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
  const newPassword = process.argv[2];
  if (!newPassword) {
    console.error('Erro: informe a nova senha como argumento. Ex.: node scripts/update-master-password.js nautico');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'futsal_nautico',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: false,
  });

  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const updateRes = await client.query(
      'UPDATE system_config SET master_password_hash = $1, updated_at = NOW() WHERE config_id = (SELECT config_id FROM system_config ORDER BY config_id DESC LIMIT 1)',
      [hash]
    );

    const checkRes = await client.query(
      'SELECT config_id, master_password_hash FROM system_config ORDER BY config_id DESC LIMIT 1'
    );

    console.log(JSON.stringify({ updated: updateRes.rowCount, row: checkRes.rows[0] }));
  } catch (err) {
    console.error('Falha ao atualizar senha mestra:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();