const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuração da conexão
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: 'postgres' // Conectar ao postgres default para criar o database
});

async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Iniciando configuração do banco de dados...');
    
    // Criar database se não existir
    const dbName = process.env.DB_NAME || 'futsal_domingo';
    
    try {
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database ${dbName} criado com sucesso!`);
    } catch (err) {
      if (err.code === '42P04') {
        console.log(`ℹ️  Database ${dbName} já existe.`);
      } else {
        throw err;
      }
    }
    
    // Conectar ao database específico
    const specificPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: dbName
    });
    
    const specificClient = await specificPool.connect();
    
    try {
      // Ler o arquivo schema.sql
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
      
      // Executar o schema
      await specificClient.query(schemaSQL);
      console.log('✅ Schema aplicado com sucesso!');
      
      // Verificar tabelas criadas
      const tables = await specificClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);
      
      console.log('\n📋 Tabelas criadas:');
      tables.rows.forEach(table => {
        console.log(`  - ${table.table_name}`);
      });
      
      // Criar configuração inicial
      const bcrypt = require('bcryptjs');
      const defaultPassword = 'futsal2024';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      try {
        await specificClient.query(`
          INSERT INTO system_config (master_password_hash, session_duration_minutes, match_duration_minutes)
          VALUES ($1, 120, 10)
        `, [hashedPassword]);
        console.log(`\n✅ Configuração inicial criada!`);
        console.log(`   Senha mestra padrão: ${defaultPassword}`);
      } catch (err) {
        if (err.code === '23505') {
          console.log('\nℹ️  Configuração já existe.');
        } else {
          throw err;
        }
      }
      
    } finally {
      specificClient.release();
      await specificPool.end();
    }
    
    console.log('\n🎉 Configuração do banco de dados concluída com sucesso!');
    console.log('\nPróximos passos:');
    console.log('1. Configure suas variáveis de ambiente no arquivo .env');
    console.log('2. Execute: npm install bcryptjs pg');
    console.log('3. Teste a conexão com: node database/test-connection.js');
    
  } catch (err) {
    console.error('❌ Erro durante a configuração:', err.message);
    console.log('\nVerifique:');
    console.log('- Se o PostgreSQL está rodando na porta 5432');
    console.log('- Se o usuário postgres existe e a senha está correta');
    console.log('- Se a porta 5432 não está sendo usada por outro serviço');
  } finally {
    client.release();
    await pool.end();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };