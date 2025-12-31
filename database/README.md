# 🏆 Futsal D'Domingo - Configuração do Banco de Dados

## 📋 Visão Geral

Este documento fornece instruções completas para configurar o banco de dados PostgreSQL do sistema Futsal D'Domingo em localhost:5432.

## 📁 Arquivos Criados

```
database/
├── schema.sql           # Schema completo do banco de dados
├── test_data.sql        # Dados de teste iniciais
├── setup.js            # Script Node.js para configuração automática
├── setup.ps1           # Script PowerShell para Windows
├── setup.sh            # Script Bash para Linux/Mac
├── test-connection.js  # Script para testar conexão
└── POSTGRESQL_SETUP.md # Documentação detalhada
```

## 🚀 Instalação Rápida

### Opção 1: Script Automático (Recomendado)

#### Windows (PowerShell)
```powershell
# Executar como Administrador
powershell -ExecutionPolicy Bypass -File database\setup.ps1
```

#### Linux/Mac (Bash)
```bash
# Tornar executável e executar
chmod +x database/setup.sh
./database/setup.sh
```

#### Node.js (Cross-platform)
```bash
# Instalar dependências primeiro
npm install pg bcryptjs dotenv

# Executar setup
node database/setup.js
```

### Opção 2: Manual

1. **Instalar PostgreSQL**
   - Download: https://www.postgresql.org/download/
   - Instalar com configurações padrões
   - Anotar a senha do usuário `postgres`

2. **Criar banco de dados**
   ```bash
   psql -U postgres -c "CREATE DATABASE futsal_domingo;"
   ```

3. **Aplicar schema**
   ```bash
   psql -U postgres -d futsal_domingo -f database/schema.sql
   ```

4. **Inserir dados de teste (opcional)**
   ```bash
   psql -U postgres -d futsal_domingo -f database/test_data.sql
   ```

5. **Criar arquivo .env**
   ```bash
   # Copiar exemplo e editar
   cp .env.example .env
   # Editar .env com suas configurações
   ```

## 🔧 Configuração

### Arquivo .env

Crie um arquivo `.env` na raiz do projeto:

```env
# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui
MASTER_PASSWORD_HASH=$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

# Servidor
PORT=3001
NODE_ENV=development

# Configurações do Jogo
MATCH_DURATION_MINUTES=10
MAX_PLAYERS_PER_TEAM=5
SESSION_DURATION_MINUTES=120
```

### Senha Mestra Padrão

A senha mestra padrão é: `futsal2024`

Para alterar, use o script `setup.js` ou execute:
```bash
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('nova_senha', 10));"
```

## 🧪 Testar Conexão

```bash
# Testar conexão com o banco
node database/test-connection.js

# Ou manualmente
psql -U postgres -d futsal_domingo -c "SELECT NOW();"
```

## 📊 Estrutura do Banco de Dados

### Tabelas Principais

| Tabela | Descrição |
|--------|-----------|
| `system_config` | Configurações do sistema (senha mestra) |
| `players` | Jogadores cadastrados |
| `game_sundays` | Domingos com jogos marcados |
| `attendances` | Presenças dos jogadores |
| `matches` | Partidas individuais |
| `match_participants` | Participantes de cada partida |
| `stats_log` | Log de gols e assistências |

### Views Úteis

| View | Descrição |
|------|-----------|
| `player_ranking` | Ranking geral de jogadores |
| `goalkeeper_stats` | Estatísticas de goleiros |
| `daily_matches` | Partidas do dia com detalhes |

## 📈 Queries de Exemplo

### Ranking de Artilheiros
```sql
SELECT name, total_goals_scored, total_games_played, goals_per_game
FROM player_ranking
WHERE total_goals_scored > 0
ORDER BY total_goals_scored DESC
LIMIT 10;
```

### Estatísticas de Goleiros
```sql
SELECT name, total_games_played, total_goals_conceded, goals_conceded_per_game
FROM goalkeeper_stats
ORDER BY goals_conceded_per_game ASC
LIMIT 5;
```

### Partidas de um Domingo
```sql
SELECT 
    match_number,
    TO_CHAR(start_time, 'HH24:MI') as horario,
    team_orange_score || 'x' || team_black_score as placar,
    winner_team,
    team_orange_win_streak || 'x' || team_black_win_streak as sequencia
FROM daily_matches
WHERE date = CURRENT_DATE - INTERVAL '7 days'
ORDER BY match_number;
```

### Presenças do Dia
```sql
SELECT 
    COALESCE(p.name, a.guest_name) as nome,
    CASE WHEN a.player_id IS NULL THEN 'Convidado' ELSE 'Cadastrado' END as tipo,
    arrival_order as ordem_chegada
FROM attendances a
LEFT JOIN players p ON a.player_id = p.player_id
WHERE a.sunday_id = (
    SELECT sunday_id 
    FROM game_sundays 
    WHERE date = CURRENT_DATE - INTERVAL '7 days'
)
ORDER BY arrival_order;
```

## 🔧 Comandos Úteis

### PostgreSQL

```bash
# Iniciar/Parar serviço (Windows)
net start postgresql-x64-16
net stop postgresql-x64-16

# Acessar console
psql -U postgres -d futsal_domingo

# Listar bancos
\l

# Listar tabelas
\dt

# Descrever tabela
\d players

# Executar query
SELECT * FROM player_ranking;

# Sair
\q
```

### Manutenção

```bash
# Backup do banco
pg_dump -U postgres -d futsal_domingo > backup_$(date +%Y%m%d).sql

# Restaurar backup
psql -U postgres -d futsal_domingo < backup_20240101.sql

# Limpar e recriar (cuidado!)
dropdb -U postgres futsal_domingo
createdb -U postgres futsal_domingo
psql -U postgres -d futsal_domingo -f database/schema.sql
```

## 🐛 Solução de Problemas

### Erro: "psql: command not found"
- Adicione o PostgreSQL ao PATH do sistema
- Ou use o caminho completo: `C:\Program Files\PostgreSQL\16\bin\psql`

### Erro: "FATAL: password authentication failed"
- Verifique a senha do usuário `postgres`
- Tente resetar a senha através do pgAdmin

### Erro: "could not connect to server"
- Verifique se o serviço PostgreSQL está rodando
- Confira a porta (padrão: 5432)
- Verifique o firewall

### Erro: "database does not exist"
- Execute o script de setup ou crie manualmente

## 📚 Recursos Adicionais

- [Documentação PostgreSQL](https://www.postgresql.org/docs/)
- [pgAdmin - Interface Gráfica](https://www.pgadmin.org/)
- [Node.js PostgreSQL](https://node-postgres.com/)

## 🤝 Suporte

Se encontrar problemas:
1. Verifique os logs de erro
2. Confirme que o PostgreSQL está rodando
3. Teste a conexão manualmente
4. Verifique as permissões do usuário postgres

---

**✅ Status**: Schema criado e pronto para uso!