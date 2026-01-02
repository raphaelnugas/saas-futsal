# 🏆 Saas de Pelada - Sistema de Gerenciamento

Sistema web completo para gerenciamento de partidas de futsal aos domingos, com controle de jogadores, times, estatísticas e cronômetro em tempo real.

## 📋 Sumário

- [🚀 Instalação Rápida](#-instalação-rápida)
- [📦 Pré-requisitos](#-pré-requisitos)
- [🔧 Configuração](#-configuração)
- [🗄️ Banco de Dados](#️-banco-de-dados)
- [🧪 Testes](#-testes)
- [📚 Documentação](#-documentação)
- [🐛 Solução de Problemas](#-solução-de-problemas)

## 🚀 Instalação Rápida

### 1. Clone o repositório
```bash
git clone https://github.com/seu-usuario/futsal-domingo.git
cd futsal-domingo
```

### 2. Execute o setup automático

#### Windows (PowerShell)
```powershell
# Executar como Administrador
powershell -ExecutionPolicy Bypass -File setup-complete.ps1
```

#### Linux/Mac (Bash)
```bash
# Tornar executável e executar
chmod +x setup-complete.sh
./setup-complete.sh
```

### 3. Configure o banco de dados

#### Opção A: Script Automático
```bash
# Instalar dependências e configurar banco
npm install
npm run db:setup
```

#### Opção B: Manual
```bash
# Instalar PostgreSQL primeiro
# Depois aplicar schema
psql -U postgres -d futsal_domingo -f database/schema.sql

# Inserir dados de teste (opcional)
psql -U postgres -d futsal_domingo -f database/test_data.sql
```

### 4. Configure as variáveis de ambiente

Edite o arquivo `.env` com suas configurações:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui
JWT_SECRET=sua_chave_secreta
```

### 5. Inicie o servidor

```bash
# Modo desenvolvimento
npm run dev

# Modo produção
npm start
```

## 📦 Pré-requisitos

### Sistema
- **Node.js** v18.0 ou superior
- **PostgreSQL** v14.0 ou superior
- **npm** ou **yarn**

### Dependências Principais
- Express.js (Backend)
- React.js (Frontend)
- PostgreSQL (Banco de dados)
- Socket.io (Tempo real)
- JWT (Autenticação)

### Instalação das Dependências

```bash
# Backend
cd api && npm install

# Frontend
cd ../frontend && npm install

# Ou instalar tudo de uma vez (na raiz)
npm install
```

## 🔧 Configuração

### PostgreSQL

1. **Instalar PostgreSQL**
   - Windows: [Download](https://www.postgresql.org/download/windows/)
   - Linux: `sudo apt-get install postgresql postgresql-contrib`
   - Mac: `brew install postgresql`

2. **Configurar usuário e senha**
   ```bash
   # Acessar PostgreSQL
   sudo -u postgres psql
   
   # Criar senha para usuário postgres
   \password postgres
   ```

3. **Criar banco de dados**
   ```bash
   createdb -U postgres futsal_domingo
   ```

### Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|---------|
| `DB_HOST` | Host do PostgreSQL | `localhost` |
| `DB_PORT` | Porta do PostgreSQL | `5432` |
| `DB_NAME` | Nome do banco de dados | `futsal_domingo` |
| `DB_USER` | Usuário do PostgreSQL | `postgres` |
| `DB_PASSWORD` | Senha do PostgreSQL | `sua_senha` |
| `JWT_SECRET` | Chave secreta JWT | `segredo` |
| `PORT` | Porta do servidor | `3001` |
| `NODE_ENV` | Ambiente | `development` |

## 🗄️ Banco de Dados

### Estrutura

O banco de dados foi projetado seguindo as melhores práticas:

- **Normalização** para evitar redundâncias
- **Índices** para performance
- **Triggers** para automatização
- **Views** para consultas complexas
- **Funções** para lógica de negócio

### Tabelas Principais

```sql
-- Jogadores
CREATE TABLE players (
    player_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    photo_url VARCHAR(255),
    is_goalkeeper BOOLEAN DEFAULT FALSE,
    total_games_played INTEGER DEFAULT 0,
    total_goals_scored INTEGER DEFAULT 0,
    total_assists INTEGER DEFAULT 0,
    total_goals_conceded INTEGER DEFAULT 0
);

-- Partidas
CREATE TABLE matches (
    match_id SERIAL PRIMARY KEY,
    sunday_id INT REFERENCES game_sundays(sunday_id),
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    team_orange_score INT DEFAULT 0,
    team_black_score INT DEFAULT 0,
    team_orange_win_streak INT DEFAULT 0,
    team_black_win_streak INT DEFAULT 0,
    winner_team VARCHAR(10),
    status VARCHAR(20) DEFAULT 'scheduled'
);
```

### Comandos do Banco de Dados

```bash
# Setup do banco
npm run db:setup

# Testar conexão
npm run db:test

# Inserir dados de teste
npm run db:seed

# Backup do banco
npm run db:backup

# Acessar console PostgreSQL
npm run db:shell
```

## 🧪 Testes

### Testar Conexão com Banco
```bash
node database/test-connection.js
```

### Testar API
```bash
# Login com senha mestra
curl -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"password": "futsal2024"}'

# Listar jogadores
curl http://localhost:3001/api/players

# Ranking
curl http://localhost:3001/api/ranking
```

### Testar Frontend
```bash
cd frontend
npm install
npm run dev
```

Acesse: http://localhost:3000

## 📚 Documentação

### Documentos Criados

- 📋 [Planejamento Completo](planejamento-sistema-futsal.md) - Especificações detalhadas
- 🗄️ [Schema do Banco](database/schema.sql) - Estrutura do PostgreSQL
- 🔧 [Setup do Banco](database/README.md) - Configuração do PostgreSQL
- 📊 [Dados de Teste](database/test_data.sql) - Inserts para testes
- ⚙️ [Variáveis de Ambiente](.env.example) - Configurações

### Fluxo de Uso

1. **Domingo de Manhã**
   - Jogadores chegam e fazem check-in
   - Sistema sorteia times quando completar 10 jogadores
   - Partida começa com cronômetro de 10 minutos

2. **Durante a Partida**
   - Gols são registrados com autor e assistência
   - Cronômetro emite alerta aos 10 minutos
   - Placar é atualizado em tempo real

3. **Após a Partida**
   - Time perdedor sai, novo sorteio é feito
   - Estatísticas são atualizadas automaticamente
   - Ranking é recalculado

### Regras Implementadas

✅ **Sorteio Automático**: 10 jogadores → 2 times (5 cada)  
✅ **Sequência de Vitórias**: Contador de vitórias consecutivas  
✅ **Regra das 3 Partidas**: Time sai após 3ª partida seguida  
✅ **Cronômetro Inteligente**: Alerta aos 10 minutos, continua até bola sair  
✅ **Estatísticas Automáticas**: Gols, assistências, gols sofridos  
✅ **Convidados**: Suporte para jogadores não cadastrados  
✅ **Autenticação Simples**: Senha mestra única para todos  
✅ **Interface Responsiva**: Funciona em desktop e mobile  

## 🐛 Solução de Problemas

### PostgreSQL não conecta
```bash
# Verificar se está rodando
sudo systemctl status postgresql

# Iniciar serviço
sudo systemctl start postgresql

# Verificar logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Erro de senha
```bash
# Resetar senha do postgres
sudo -u postgres psql
\password postgres
```

### Porta 5432 em uso
```bash
# Verificar processos
sudo lsof -i :5432

# Matar processos (cuidado!)
sudo kill -9 PID
```

### Node.js não encontra módulos
```bash
# Limpar cache
npm cache clean --force

# Reinstalar dependências
rm -rf node_modules package-lock.json
npm install
```

### Frontend não carrega
```bash
# Verificar porta 3000
lsof -i :3000

# Build manual
cd frontend && npm run build
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie sua feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🏆 Agradecimentos

- Equipe Futsal D'Domingo
- Comunidade de desenvolvimento open source
- PostgreSQL, Node.js e React.js

---

**✅ Status do Projeto**: Schema do banco de dados criado e configurado com sucesso! 🎉

Pronto para começar a desenvolver o sistema completo de gerenciamento de partidas de futsal!
