# Configuração do PostgreSQL para Sistema de Futsal - Instruções Completas

## 📋 Resumo da Configuração

O banco de dados PostgreSQL foi configurado com sucesso para o sistema de gerenciamento de futsal. Abaixo estão as instruções completas e personalizadas para o seu ambiente.

## ✅ Status Atual

- ✅ **PostgreSQL Localizado**: Encontrado em `C:\Program Files\PostgreSQL\16`
- ✅ **Banco de Dados Criado**: `futsal_nautico`
- ✅ **Tabelas Criadas**: 7 tabelas principais + 3 views
- ✅ **Dados de Teste Inseridos**: 10 jogadores, 4 partidas, 35 gols registrados
- ✅ **Conexão Testada**: Conexão estabelecida com sucesso

## 🗂️ Estrutura do Banco de Dados

### Tabelas Criadas:
1. **players** - Cadastro de jogadores
2. **game_sundays** - Registro dos domingos com jogos
3. **attendances** - Presenças dos jogadores
4. **matches** - Partidas individuais
5. **match_participants** - Participantes de cada partida
6. **stats_log** - Log de gols e assistências
7. **system_config** - Configurações do sistema

### Views Criadas:
1. **player_ranking** - Ranking de jogadores
2. **goalkeeper_stats** - Estatísticas de goleiros
3. **daily_matches** - Partidas por dia

## 🔧 Configuração de Conexão

### Parâmetros de Conexão:
```
Host: localhost
Port: 5432
Database: futsal_nautico
User: postgres
Password: [sua senha do PostgreSQL]
```

### Arquivo .env (criar na raiz do projeto):
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_nautico
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui
```

## 🚀 Scripts Disponíveis

### 1. Configuração Inicial (já executado)
```bash
# Para Windows (PowerShell)
.\setup-postgresql-z-drive.bat

# Para Windows (PowerShell - alternativa)
powershell -ExecutionPolicy Bypass -File setup-postgresql-z-drive-simple.ps1
```

### 2. Teste de Conexão
```bash
node database/test-connection-local.js
```

### 3. Instalar Dependências
```bash
npm install
```

## 📊 Dados de Teste Incluídos

### Jogadores Cadastrados:
- **10 jogadores** com estatísticas variadas
- **2 goleiros** (Fernando Almeida e André Mendes)
- **8 jogadores de linha** com gols e assistências

### Partidas do Dia 10/11/2025:
1. **Jogo 1**: Orange 5x3 Black
2. **Jogo 2**: Orange 4x6 Black  
3. **Jogo 3**: Orange 7x2 Black
4. **Jogo 4**: Orange 3x5 Black

### Estatísticas:
- **Total de gols**: 35 gols
- **Artilheiro**: Marcos Souza (18 gols)
- **Maior assistência**: Diego Ferreira (11 assistências)

## 🔍 Comandos Úteis

### Verificar se PostgreSQL está rodando:
```bash
# Windows
net start | findstr postgres

# Ou verificar serviços
services.msc
```

### Conectar ao banco manualmente:
```bash
# Via psql (linha de comando)
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d futsal_nautico

# Via pgAdmin (interface gráfica)
# Abrir pgAdmin e conectar ao servidor local
```

### Verificar tabelas:
```sql
-- Listar todas as tabelas
\dt

-- Ver estrutura de uma tabela
\d players

-- Contar registros
SELECT COUNT(*) FROM players;
SELECT COUNT(*) FROM matches;
```

## 🛠️ Solução de Problemas

### Erro: "PostgreSQL não encontrado na unidade Z:"
**Solução**: O PostgreSQL foi encontrado em `C:\Program Files\PostgreSQL\16`. O script automaticamente detecta a localização correta.

### Erro: "Cannot find module 'pg'"
**Solução**: Execute `npm install` para instalar as dependências.

### Erro: "FATAL: password authentication failed"
**Solução**: Verifique a senha do usuário `postgres` e atualize no arquivo `.env`

### Erro: "database does not exist"
**Solução**: Execute o script de configuração novamente: `.\setup-postgresql-z-drive.bat`

## 📁 Arquivos Criados

```
c:\Futsal\FutsalNautico\
├── database/
│   ├── schema.sql              # Estrutura do banco de dados
│   ├── test-data.sql           # Dados de teste originais
│   ├── test-data-corrected.sql # Dados de teste corrigidos
│   ├── test-connection-local.js # Script de teste de conexão
│   └── setup.js               # Script de configuração automatizada
├── setup-postgresql-z-drive.bat     # Script de configuração para Windows
├── setup-postgresql-z-drive-simple.ps1 # Script PowerShell alternativo
├── package.json               # Configuração do Node.js
└── .env                       # Configurações de ambiente (criar)
```

## 🎯 Próximos Passos

1. **Criar o arquivo .env** com suas credenciais
2. **Desenvolver o backend** com Node.js/Express
3. **Criar o frontend** com React
4. **Implementar as regras de negócio** (sequência de vitórias, sorteio de times, etc.)

## 📞 Suporte

Se encontrar problemas:
1. Verifique se o serviço PostgreSQL está rodando
2. Confirme as credenciais no arquivo .env
3. Teste a conexão com `node database/test-connection-local.js`
4. Consulte os logs de erro para diagnóstico

---

**✅ Configuração concluída com sucesso!**
O banco de dados está pronto para uso com o sistema de gerenciamento de futsal.