# Sistema de Controle de Partidas de Futsal - Planejamento

## Visão Geral
Sistema web moderno para gerenciamento de partidas de futsal entre amigos aos domingos, com controle de jogadores, times, estatísticas e cronômetro.

## Tecnologias Utilizadas
- **Frontend**: React.js com TypeScript, Tailwind CSS
- **Backend**: Node.js com Express.js e TypeScript
- **Banco de Dados**: PostgreSQL (porta 5432)
- **Autenticação**: Senha mestra com sessão de 2 horas
- **Bibliotecas Adicionais**: Lucide React (ícones), Recharts (gráficos), Sonner (notificações)

## 1. BANCO DE DADOS - PostgreSQL

### Tabelas Principais

#### 1.1 Jogadores
```sql
CREATE TABLE jogadores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    foto_url VARCHAR(500),
    is_goleiro BOOLEAN DEFAULT FALSE,
    dias_jogados INTEGER DEFAULT 0,
    total_gols INTEGER DEFAULT 0,
    total_assistencias INTEGER DEFAULT 0,
    total_gols_sofridos INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.2 Partidas
```sql
CREATE TABLE partidas (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    hora_inicio TIME,
    hora_fim TIME,
    duracao_minutos INTEGER DEFAULT 10,
    time_laranja_id INTEGER REFERENCES times(id),
    time_preto_id INTEGER REFERENCES times(id),
    gols_laranja INTEGER DEFAULT 0,
    gols_preto INTEGER DEFAULT 0,
    vencedor VARCHAR(10), -- 'laranja' ou 'preto'
    status VARCHAR(20) DEFAULT 'agendada', -- agendada, em_andamento, finalizada
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.3 Times
```sql
CREATE TABLE times (
    id SERIAL PRIMARY KEY,
    cor VARCHAR(10) NOT NULL, -- 'laranja' ou 'preto'
    partida_id INTEGER REFERENCES partidas(id),
    sequencia_vitorias INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.4 JogadoresTimes (relacionamento muitos-para-muitos)
```sql
CREATE TABLE jogadores_times (
    id SERIAL PRIMARY KEY,
    jogador_id INTEGER REFERENCES jogadores(id),
    time_id INTEGER REFERENCES times(id),
    is_goleiro BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.5 Gols
```sql
CREATE TABLE gols (
    id SERIAL PRIMARY KEY,
    partida_id INTEGER REFERENCES partidas(id),
    autor_id INTEGER REFERENCES jogadores(id),
    assistencia_id INTEGER REFERENCES jogadores(id),
    goleiro_vazado_id INTEGER REFERENCES jogadores(id),
    time_marcador VARCHAR(10), -- 'laranja' ou 'preto'
    tempo_minuto INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.6 Presencas
```sql
CREATE TABLE presencas (
    id SERIAL PRIMARY KEY,
    jogador_id INTEGER REFERENCES jogadores(id),
    data DATE NOT NULL,
    is_convidado BOOLEAN DEFAULT FALSE,
    nome_convidado VARCHAR(100),
    foto_convidado VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.7 ConfiguracoesSistema
```sql
CREATE TABLE configuracoes_sistema (
    id SERIAL PRIMARY KEY,
    senha_mestra VARCHAR(255) NOT NULL,
    tempo_sessao_minutos INTEGER DEFAULT 120,
    max_jogadores_partida INTEGER DEFAULT 10,
    duracao_partida_minutos INTEGER DEFAULT 10,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Índices e Constraints
```sql
-- Índices para performance
CREATE INDEX idx_jogadores_nome ON jogadores(nome);
CREATE INDEX idx_partidas_data ON partidas(data);
CREATE INDEX idx_presencas_data ON presencas(data);
CREATE INDEX idx_gols_partida ON gols(partida_id);

-- Constraints únicos
ALTER TABLE presencas ADD CONSTRAINT unique_presenca_jogador_data UNIQUE (jogador_id, data);
```

## 2. BACKEND - Node.js com Express

### Estrutura de Diretórios
```
api/
├── src/
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── jogadorController.js
│   │   ├── partidaController.js
│   │   ├── estatisticaController.js
│   │   └── presencaController.js
│   ├── models/
│   │   ├── Jogador.js
│   │   ├── Partida.js
│   │   ├── Time.js
│   │   ├── Gol.js
│   │   └── Presenca.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── jogadores.js
│   │   ├── partidas.js
│   │   ├── estatisticas.js
│   │   └── presencas.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── errorHandler.js
│   ├── services/
│   │   ├── sorteioService.js
│   │   ├── partidaService.js
│   │   └── estatisticaService.js
│   ├── utils/
│   │   ├── database.js
│   │   ├── validators.js
│   │   └── constants.js
│   └── app.js
├── server.js
└── package.json
```

### Endpoints da API

#### Autenticação
- `POST /api/auth/login` - Login com senha mestra
- `POST /api/auth/logout` - Logout
- `GET /api/auth/verify` - Verificar sessão ativa

#### Jogadores
- `GET /api/jogadores` - Listar todos os jogadores
- `GET /api/jogadores/:id` - Buscar jogador por ID
- `POST /api/jogadores` - Criar novo jogador (protegido)
- `PUT /api/jogadores/:id` - Atualizar jogador (protegido)
- `DELETE /api/jogadores/:id` - Remover jogador (protegido)

#### Partidas
- `GET /api/partidas` - Listar partidas (com filtros por data)
- `GET /api/partidas/:id` - Buscar partida por ID
- `POST /api/partidas` - Criar partida (protegido)
- `PUT /api/partidas/:id` - Atualizar partida (protegido)
- `POST /api/partidas/:id/iniciar` - Iniciar partida e cronômetro (protegido)
- `POST /api/partidas/:id/finalizar` - Finalizar partida (protegido)
- `POST /api/partidas/:id/gol` - Registrar gol (protegido)

#### Presenças
- `GET /api/presencas/:data` - Listar presenças do dia
- `POST /api/presencas` - Adicionar presença (protegido)
- `DELETE /api/presencas/:id` - Remover presença (protegido)

#### Estatísticas
- `GET /api/estatisticas/ranking` - Ranking geral de jogadores
- `GET /api/estatisticas/artilheiros` - Top artilheiros
- `GET /api/estatisticas/assistencias` - Top assistentes
- `GET /api/estatisticas/goleiros` - Ranking de goleiros

### Funcionalidades do Backend

#### Sistema de Sorteio
- Sorteio automático de times com 10 jogadores
- Distribuição de goleiros (1 por time)
- Sorteio aleatório de 4 jogadores de linha para cada time

#### Controle de Sequência de Vitórias
- Monitoramento automático de vitórias consecutivas
- Alerta quando time chega na 3ª partida após 2 vitórias

#### Cronômetro
- Início manual da partida
- Alerta sonoro e vibratório aos 10 minutos
- Registro automático de tempo de jogo

#### Segurança
- Senha mestra única para todos os usuários
- Sessão válida por 2 horas
- Proteção de rotas sensíveis

## 3. FRONTEND - React.js

### Estrutura de Componentes
```
src/
├── components/
│   ├── common/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   └── Modal.tsx
│   ├── auth/
│   │   └── LoginForm.tsx
│   ├── ranking/
│   │   ├── RankingTable.tsx
│   │   ├── JogadorCard.tsx
│   │   └── FiltrosRanking.tsx
│   ├── partida/
│   │   ├── Cronometro.tsx
│   │   ├── Placar.tsx
│   │   ├── TimeFormacao.tsx
│   │   ├── SorteioTimes.tsx
│   │   └── ControlePartida.tsx
│   ├── presenca/
│   │   ├── ListaPresenca.tsx
│   │   ├── AdicionarConvidado.tsx
│   │   └── PresencaForm.tsx
│   └── estatisticas/
│       ├── GraficoEstatisticas.tsx
│       └── TabelaEstatisticas.tsx
├── pages/
│   ├── Index.tsx (página pública de ranking)
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── Partida.tsx
│   ├── GerenciarJogadores.tsx
│   └── Calendario.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── usePartida.ts
│   ├── useCronometro.ts
│   └── usePresenca.ts
├── services/
│   ├── api.ts
│   ├── authService.ts
│   ├── partidaService.ts
│   └── estatisticaService.ts
├── utils/
│   ├── constants.ts
│   ├── helpers.ts
│   └── types.ts
└── App.tsx
```

### Páginas e Funcionalidades

#### 1. Página Pública - Ranking (Index.tsx)
- **URL**: `/`
- **Acesso**: Público
- **Funcionalidades**:
  - Tabela de ranking com estatísticas dos jogadores
  - Filtros por: nome, artilheiros, assistências, goleiros, partidas jogadas
  - Hover mostra foto do jogador
  - Design responsivo para mobile
  - Cores vivas e contemporâneas

#### 2. Login (Login.tsx)
- **URL**: `/login`
- **Funcionalidades**:
  - Campo único para senha mestra
  - Redirecionamento automático após login
  - Mensagem de erro para senha inválida

#### 3. Dashboard (Dashboard.tsx)
- **URL**: `/dashboard`
- **Acesso**: Protegido (senha mestra)
- **Funcionalidades**:
  - Calendário com domingos clicáveis
  - Se hoje for domingo, mostra painel de presenças
  - Lista de participantes do dia
  - Botão para adicionar/remover jogadores
  - Opção de adicionar convidados

#### 4. Partida (Partida.tsx)
- **URL**: `/partida/:id`
- **Acesso**: Protegido
- **Funcionalidades**:
  - **Cronômetro** com display grande
  - **Placar** com cores dos times (laranja/preto)
  - **Formações** dos times em tempo real
  - **Botões de gol** posicionados estrategicamente
  - **Contador de vitórias** ao lado do nome dos times
  - **Alerta** sonoro e vibratório aos 10 minutos
  - **Botão sortear times** (habilitado com 10 jogadores)

#### 5. Gerenciar Jogadores (GerenciarJogadores.tsx)
- **URL**: `/jogadores`
- **Acesso**: Protegido
- **Funcionalidades**:
  - CRUD completo de jogadores
  - Upload de foto
  - Marcar/desmarcar como goleiro
  - Visualização de estatísticas

#### 6. Calendário (Calendario.tsx)
- **URL**: `/calendario`
- **Acesso**: Protegido
- **Funcionalidades**:
  - Visualização mensal
  - Domingos destacados
  - Clique para ver partidas do dia
  - Estatísticas mensais

### Componentes Específicos

#### Cronômetro (Cronometro.tsx)
- Display grande e visível
- Botão iniciar/parar
- Alerta sonoro aos 10 minutos
- Notificação push/vibração

#### Sorteio de Times (SorteioTimes.tsx)
- Dois quadrantes coloridos (laranja e preto)
- Animação de sorteio
- Mostra goleiros sorteados
- Lista jogadores por time

#### Controle de Partida (ControlePartida.tsx)
- Botões de gol laterais ao placar
- Seleção rápida de autor e assistência
- Auto-preenchimento de goleiro vazado
- Histórico de gols da partida

### Estado Global (Zustand)
```typescript
interface AppState {
  // Autenticação
  isAuthenticated: boolean;
  login: (senha: string) => Promise<boolean>;
  logout: () => void;
  
  // Partida atual
  partidaAtual: Partida | null;
  setPartidaAtual: (partida: Partida) => void;
  
  // Cronômetro
  tempoRestante: number;
  isRunning: boolean;
  startCronometro: () => void;
  stopCronometro: () => void;
  
  // Presenças do dia
  presencasHoje: Jogador[];
  addPresenca: (jogador: Jogador) => void;
  removePresenca: (jogadorId: number) => void;
}
```

### Estilos e Design
- **Cores Primárias**: Laranja vibrante (#FF6B35) e Preto (#1A1A1A)
- **Cores Secundárias**: Branco, Cinza claro, Verde (para sucesso)
- **Tipografia**: Fontes grandes e legíveis
- **Efeitos**: Hover, transições suaves, sombras
- **Responsividade**: Mobile-first, breakpoints para tablet e desktop

### Funcionalidades de UX
- **Loading states** em todas as requisições
- **Toasts** para notificações (sucesso, erro, alerta)
- **Confirmações** para ações destrutivas
- **Auto-save** quando possível
- **Keyboard shortcuts** para ações rápidas
- **PWA** para funcionamento offline (opcional)

## 4. FLUXOS DE TRABALHO

### 4.1 Fluxo de Login
1. Usuário acessa `/login`
2. Digita senha mestra
3. Sistema valida no backend
4. Cria sessão de 2 horas
5. Redireciona para `/dashboard`

### 4.2 Fluxo de Presença do Dia
1. Acessar dashboard no domingo
2. Ver lista de jogadores cadastrados
3. Adicionar jogadores presentes
4. Adicionar convidados se necessário
5. Aguardar completar 10 jogadores
6. Habilitar botão "Sortear Times"

### 4.3 Fluxo de Sorteio de Times
1. Com 10 jogadores presentes
2. Clicar "Sortear Times"
3. Sistema sorteia 2 goleiros (1 por time)
4. Sorteia 4 jogadores para cada time
5. Exibe formação nos quadrantes coloridos
6. Cria partida no banco de dados

### 4.4 Fluxo de Partida
1. Iniciar cronômetro
2. Jogar por 10 minutos
3. Registrar gols com autor e assistência
4. Sistema registra goleiro vazado automaticamente
5. Aos 10 minutos, alerta sonoro
6. Finalizar partida quando bola sair
7. Atualizar estatísticas
8. Time perdedor sai, novo sorteio

### 4.5 Fluxo de Estatísticas
1. Atualização automática após cada partida
2. Cálculo de: gols, assistências, gols sofridos
3. Atualização de dias jogados
4. Geração de rankings
5. Exibição pública em `/`

## 5. CONSIDERAÇÕES TÉCNICAS

### Segurança
- Senha mestra hasheada no banco
- Sessões com JWT e expiração
- Validação de entrada de dados
- Proteção contra SQL injection

### Performance
- Índices apropriados no banco
- Paginação em listagens grandes
- Cache de estatísticas
- Lazy loading de imagens

### Escalabilidade
- Arquitetura modular
- Separação de responsabilidades
- Código reutilizável
- Documentação clara

### Manutenibilidade
- TypeScript para type safety
- Testes unitários e de integração
- CI/CD pipeline
- Logs estruturados

## 6. CRONOGRAMA SUGERIDO

### Fase 1 - Estrutura Base (2 semanas)
- Configuração do projeto
- Banco de dados
- Autenticação básica
- CRUD jogadores

### Fase 2 - Funcionalidades Core (3 semanas)
- Sistema de presenças
- Sorteio de times
- Controle de partidas
- Registro de gols

### Fase 3 - Interface e UX (2 semanas)
- Página pública de ranking
- Dashboard administrativo
- Cronômetro e alertas
- Responsividade

### Fase 4 - Polimento (1 semana)
- Testes e ajustes
- Otimização de performance
- Documentação final
- Deploy

## 7. REQUISITOS DE DEPLOY

### Backend
- Node.js 18+
- PostgreSQL 14+
- Variáveis de ambiente configuradas
- PM2 para gerenciamento de processos

### Frontend
- Build otimizado
- CDN para assets estáticos
- Configuração de rotas SPA
- SSL/TLS habilitado

### Banco de Dados
- Backup automático
- Monitoramento de performance
- Índices otimizados
- Segurança configurada

Este planejamento fornece uma base sólida para o desenvolvimento do sistema de controle de partidas de futsal, com foco na experiência do usuário, segurança e escalabilidade.