# Configuração do Banco de Dados PostgreSQL

## Instalação do PostgreSQL (Windows)

1. Baixe o PostgreSQL em: https://www.postgresql.org/download/windows/
2. Instale com as configurações padrões
3. Durante a instalação, defina a senha do usuário "postgres"
4. Anote a porta (geralmente 5432)

## Comandos para Configuração

### 1. Criar o banco de dados
```bash
psql -U postgres -c "CREATE DATABASE futsal_domingo;"
```

### 2. Conectar ao banco e executar o schema
```bash
psql -U postgres -d futsal_domingo -f database/schema.sql
```

### 3. Verificar se as tabelas foram criadas
```bash
psql -U postgres -d futsal_domingo -c "\dt"
```

## Configuração de Acesso Local

### Arquivo de configuração do PostgreSQL:
- Localização: `C:\Program Files\PostgreSQL\[versão]\data\postgresql.conf`
- Verifique se a porta está configurada como 5432

### Arquivo de controle de acesso:
- Localização: `C:\Program Files\PostgreSQL\[versão]\data\pg_hba.conf`
- Adicione ou modifique para permitir conexões locais:
```
# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
# IPv6 local connections:
host    all             all             ::1/128                 md5
```

## Variáveis de Ambiente para o Projeto

Crie um arquivo `.env` na raiz do projeto com:
```
# Banco de Dados
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação
JWT_SECRET=sua_chave_secreta_super_segura_aqui
MASTER_PASSWORD_HASH=$2b$10$seu_hash_aqui

# Servidor
PORT=3001
NODE_ENV=development
```

## Comandos Úteis

### Iniciar/Parar Serviço PostgreSQL
```bash
# Iniciar
net start postgresql-x64-[versão]

# Parar
net stop postgresql-x64-[versão]
```

### Acessar o console do PostgreSQL
```bash
psql -U postgres -d futsal_domingo
```

### Comandos no console psql
```sql
-- Listar bancos de dados
\l

-- Listar tabelas
\dt

-- Descrever uma tabela
\d players

-- Executar um SELECT
SELECT * FROM player_ranking;

-- Sair
\q
```

## Teste de Conexão

### Script de teste Node.js (test-connection.js)
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'futsal_domingo',
  user: 'postgres',
  password: 'sua_senha_aqui'
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Conexão com PostgreSQL estabelecida com sucesso!');
    
    const result = await client.query('SELECT NOW() as current_time');
    console.log('Horário do banco:', result.rows[0].current_time);
    
    client.release();
  } catch (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL:', err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
```

Execute com: `node test-connection.js`