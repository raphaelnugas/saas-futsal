# **Planejamento de Projeto: Futsal D'Domingo**

Este documento detalha o planejamento técnico para a criação de um sistema web de gerenciamento de partidas de futsal, com base nas regras e requisitos fornecidos.

**Stack Tecnológica:**

* **Frontend:** React (com Hooks, Context API/Zustand, React Router)  
* **Backend:** Node.js (com Express.js, Socket.io)  
* **Banco de Dados:** PostgreSQL

## **1\. Banco de Dados (PostgreSQL)**

O esquema de banco de dados será projetado para ser normalizado, garantindo a integridade dos dados e facilitando consultas complexas para estatísticas.

### **Schema SQL (Proposta)**

\-- Tabela principal para os jogadores cadastrados  
CREATE TABLE players (  
    player\_id SERIAL PRIMARY KEY,  
    name VARCHAR(100) NOT NULL,  
    photo\_url VARCHAR(255) NULL, \-- URL para a foto  
    is\_goalkeeper BOOLEAN NOT NULL DEFAULT false,  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

\-- Tabela para registrar os domingos em que houve jogos  
CREATE TABLE game\_sundays (  
    sunday\_id SERIAL PRIMARY KEY,  
    date DATE NOT NULL UNIQUE,  
    \-- (Opcional) Podemos adicionar um campo para a senha mestra do dia, se ela mudar  
    master\_password\_hash VARCHAR(255) NULL  
);

\-- Tabela de presença (Quem compareceu em qual domingo)  
CREATE TABLE attendances (  
    attendance\_id SERIAL PRIMARY KEY,  
    sunday\_id INT NOT NULL REFERENCES game\_sundays(sunday\_id) ON DELETE CASCADE,  
    player\_id INT REFERENCES players(player\_id) ON DELETE SET NULL, \-- Permite convidados (player\_id NULL)  
    guest\_name VARCHAR(100) NULL, \-- Para convidados não cadastrados  
    guest\_photo\_url VARCHAR(255) NULL,  
    UNIQUE(sunday\_id, player\_id) \-- Impede duplicidade de presença  
);

\-- Tabela para cada partida individual  
CREATE TABLE matches (  
    match\_id SERIAL PRIMARY KEY,  
    sunday\_id INT NOT NULL REFERENCES game\_sundays(sunday\_id) ON DELETE CASCADE,  
    start\_time TIMESTAMP WITH TIME ZONE,  
    end\_time TIMESTAMP WITH TIME ZONE NULL,  
    team\_orange\_score INT NOT NULL DEFAULT 0,  
    team\_black\_score INT NOT NULL DEFAULT 0,  
    \-- Controla a regra de 2 vitórias seguidas  
    team\_orange\_win\_streak INT NOT NULL DEFAULT 0,  
    team\_black\_win\_streak INT NOT NULL DEFAULT 0  
);

\-- Tabela de "escalação" (Quais jogadores participaram de qual partida e em qual time)  
CREATE TABLE match\_participants (  
    participant\_id SERIAL PRIMARY KEY,  
    match\_id INT NOT NULL REFERENCES matches(match\_id) ON DELETE CASCADE,  
    player\_id INT REFERENCES players(player\_id) ON DELETE SET NULL, \-- Permite convidados  
    guest\_name\_snapshot VARCHAR(100) NULL, \-- Snapshot do nome do convidado na hora do jogo  
    team VARCHAR(10) NOT NULL CHECK (team IN ('orange', 'black'))  
);

\-- Log de estatísticas (Gols e Assistências)  
CREATE TABLE stats\_log (  
    stat\_id SERIAL PRIMARY KEY,  
    match\_id INT NOT NULL REFERENCES matches(match\_id) ON DELETE CASCADE,  
    player\_scorer\_id INT REFERENCES players(player\_id), \-- Quem marcou o gol  
    player\_assist\_id INT NULL REFERENCES players(player\_id), \-- Quem deu a assistência (opcional)  
    team\_scored VARCHAR(10) NOT NULL CHECK (team\_scored IN ('orange', 'black')),  
    \-- O goleiro que sofreu o gol será inferido via lógica no backend  
    \-- Gols contra podem ser registrados com player\_scorer\_id e um flag extra (a ser avaliado)  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

## **2\. Backend (Node.js)**

O backend será responsável pela lógica de negócio, autenticação, comunicação em tempo real (cronômetro/placar) e serviço da API.

**Bibliotecas Principais:**

* express: Para o roteamento da API REST.  
* pg: Driver oficial do PostgreSQL para Node.js.  
* jsonwebtoken (JWT): Para gerenciamento da sessão de 2h da senha mestra.  
* bcryptjs: Para comparar a hash da senha mestra (armazenada no .env).  
* socket.io: Para comunicação WebSocket (cronômetro e placar ao vivo).  
* cors: Para habilitar o acesso do frontend React.

### **2.1. Autenticação (Senha Mestra)**

* A senha mestra será armazenada como uma hash (Bcrypt) no arquivo de ambiente (.env).  
* **Endpoint POST /api/login**:  
  * Recebe { password: "..." }.  
  * Compara a senha enviada com a hash armazenada.  
  * Se correto, gera um JWT com expiresIn: '2h'.  
* **Middleware de Autenticação**:  
  * Todas as rotas "privadas" (ex: POST /api/match/goal) verificarão a validade do JWT enviado no header Authorization.

### **2.2. Lógica de Negócio (Regras)**

* **Sorteio de Times**:  
  * O frontend enviará 10 IDs (sejam player\_id ou IDs temporários de convidados) da lista de presença.  
  * O backend identificará os goleiros (via players.is\_goalkeeper).  
  * Separará 1 goleiro para orange e 1 para black.  
  * Embaralhará (shuffle) os 8 jogadores de linha restantes e distribuirá 4 para cada time.  
  * Retornará a composição final dos dois times.  
* **Contagem de Gols (Lógica do Goleiro Vazado)**:  
  * Quando POST /api/match/:id/goal for chamado com { scorer\_id, assist\_id, team\_scored: 'orange' }:  
    1. O backend registra o gol no stats\_log.  
    2. O backend atualiza matches.team\_orange\_score.  
    3. O backend consulta match\_participants para encontrar todos os player\_id do team: 'black' naquela match\_id.  
    4. Desses IDs, ele consulta a tabela players para achar qual deles tem is\_goalkeeper \= true.  
    5. Esse player\_id (o goleiro) terá um "gol sofrido" contabilizado nas consultas de ranking (não precisa de um campo extra, pode ser COUNT no stats\_log onde o time do goleiro \!= team\_scored).  
* **Controle de Vitórias (Win Streak)**:  
  * Ao finalizar uma partida (POST /api/match/:id/end), o backend:  
    1. Compara team\_orange\_score e team\_black\_score.  
    2. Determina o vencedor (ex: 'orange').  
    3. Busca o team\_orange\_win\_streak da *partida anterior* desse time (lógica complexa, talvez seja melhor armazenar no frontend ou em matches).  
    4. *Simplificação:* A tabela matches terá team\_orange\_win\_streak e team\_black\_win\_streak da *partida atual*.  
    5. Se 'orange' ganhou: UPDATE matches SET team\_orange\_win\_streak \= (streak\_anterior\_orange \+ 1), team\_black\_win\_streak \= 0 WHERE match\_id \= ?.  
    6. O frontend usará esse dado para exibir o contador e aplicar a regra de saída no 3º jogo.

### **2.3. WebSockets (Socket.io)**

* O servidor Socket.io irá gerenciar o estado do jogo em tempo real.  
* **Eventos (Server \-\> Client):**  
  * timer\_update: Emite a cada segundo o tempo restante (ex: 600, 599, ...).  
  * timer\_alarm: Emite quando o tempo chegar a 0\.  
  * live\_score\_update: Emite o novo placar (ex: { orange: 1, black: 0 }) após um gol.  
  * new\_match\_started: Força todos os clientes logados a verem a tela da partida atual.  
* **Eventos (Client \-\> Server) (Apenas de usuários autenticados):**  
  * start\_timer: Inicia o cronômetro no servidor.  
  * pause\_timer: (Opcional, mas recomendado).  
  * reset\_timer: Zera o cronômetro.

### **2.4. API Endpoints (Principais)**

| Método | Rota | Descrição | Auth |
| :---- | :---- | :---- | :---- |
| POST | /api/login | Login com senha mestra. | Pública |
| GET | /api/ranking | Retorna o ranking público (calculado). | Pública |
| GET | /api/players | Lista todos os jogadores cadastrados. | Pública |
| POST | /api/players | Adiciona novo jogador. | Master |
| PUT | /api/players/:id | Edita perfil do jogador. | Master |
| GET | /api/sunday/:date | Pega dados do domingo (lista de presentes, partidas). | Master |
| POST | /api/sunday/attendance | Adiciona jogador/convidado à lista de presença. | Master |
| DELETE | /api/sunday/attendance/:id | Remove da lista de presença. | Master |
| POST | /api/match/draw | Envia 10 IDs, recebe 2 times sorteados. | Master |
| POST | /api/match/start | Inicia nova partida no DB (com os 10 jogadores). | Master |
| POST | /api/match/:id/goal | Lança gol/assistência para uma partida. | Master |
| POST | /api/match/:id/end | Finaliza a partida, zera cronômetro, calcula streaks. | Master |

## **3\. Frontend (React)**

O frontend será uma Single Page Application (SPA) focada em usabilidade, performance e design moderno, com alta responsividade.

**Bibliotecas Principais:**

* react-router-dom: Para navegação (Página Pública vs. Painel Admin).  
* axios: Para chamadas à API REST.  
* socket.io-client: Para conexão com o backend em tempo real.  
* tailwindcss: Para estilização rápida, moderna e responsiva (cores vívidas e contemporâneas).  
* framer-motion: Para as animações de botões e transições fluidas.  
* react-icons ou lucide-react: Para iconografia.  
* zustand (ou Context API): Para gerenciamento de estado global (auth, estado da partida).

### **3.1. Estrutura de Componentes (Proposta)**

/src  
|-- /components  
|   |-- /ui  
|   |   |-- Button.js       (Botão customizado com efeitos)  
|   |   |-- Card.js         (Componente base de card)  
|   |   |-- Input.js  
|   |   |-- Modal.js        (Para  
|   |  
|   |-- /public  
|   |   |-- RankingTable.js (Tabela de ranking com filtros)  
|   |   |-- PlayerTooltip.js(Mostra foto ao passar o mouse)  
|   |  
|   |-- /admin  
|   |   |-- SundayPanel.js      (Painel principal do domingo)  
|   |   |-- AttendanceList.js   (Lista de presentes, add/remove)  
|   |   |-- TeamDraw.js         (Interface de sorteio com quadrantes)  
|   |   |-- MatchControl.js     (Painel do jogo ao vivo)  
|   |   |-- Stopwatch.js        (Recebe dados do Socket.io)  
|   |   |-- Scoreboard.js       (Placar ao vivo com botões de gol)  
|   |   |-- WinStreakCounter.js (Contador 'W: 2')  
|  
|-- /pages  
|   |-- HomePage.js         (Página pública, renderiza RankingTable)  
|   |-- LoginPage.js  
|   |-- AdminDashboard.js   (Página privada, renderiza SundayPanel)  
|  
|-- /hooks  
|   |-- useAuth.js          (Gerencia o estado de autenticação)  
|   |-- useSocket.js        (Gerencia a conexão Socket.io e eventos)  
|  
|-- /contexts (ou /store se usar Zustand)  
|   |-- AuthContext.js  
|   |-- MatchContext.js     (Armazena placar, tempo, streaks)  
|  
|-- App.js                  (Define as rotas)

### **3.2. Páginas (Views) e Fluxo**

1. **/ (HomePage):**  
   * Acessível publicamente.  
   * Exibe o RankingTable.js.  
   * Tabela permite filtrar por colunas (Gols, Assist., Gols Sofridos, etc.).  
   * Ao passar o mouse no nome (PlayerTooltip.js), exibe a foto (players.photo\_url).  
   * Totalmente responsiva (tabela vira lista/cards em mobile).  
2. **/login (LoginPage):**  
   * Formulário simples com um campo: "Senha Mestra".  
   * Ao submeter, chama POST /api/login.  
   * Se sucesso, salva o JWT no localStorage e redireciona para /admin.  
3. **/admin (AdminDashboard \- Rota Privada):**  
   * Verifica se o usuário está autenticado (via AuthContext).  
   * Se o dia for Domingo, exibe o SundayPanel.js. (Se não for, exibe o calendário ou uma mensagem).  
   * **Fluxo do SundayPanel.js:**  
     1. **Presença:** O admin vê o AttendanceList.js. Ele pode adicionar jogadores cadastrados ou "Convidados" (com nome temporário e upload de foto opcional).  
     2. **Sorteio:** Quando 10 jogadores estão na lista para a partida, o admin os seleciona e clica em "Sortear".  
     3. **Visualização:** O TeamDraw.js exibe os dois quadrantes (preto e laranja) com os times formados (retornados pelo POST /api/match/draw).  
     4. **Início:** O admin clica em "Iniciar Partida".  
     5. **Jogo:** A view muda para MatchControl.js.  
        * O Stopwatch.js é iniciado (via evento start\_timer do Socket.io).  
        * O Scoreboard.js é exibido. Botões "Marcar Gol" ficam ao lado de cada time.  
        * O WinStreakCounter.js mostra as vitórias seguidas do time.  
        * O admin clica nos botões de gol, que chamam POST /api/match/:id/goal.  
        * O Socket.io (live\_score\_update) atualiza o placar para todos os usuários logados.  
     6. **Alarme:** Ao atingir 10 min corridos no cronômetro, o evento timer\_alarm do Socket.io dispara, mas o relógio segue andando. O frontend reage tocando um som de alarme e usando navigator.vibrate(\[500, 100, 500\]) (se disponível no smartphone).  
     7. **Fim:** O admin (após a bola sair) clica em "Finalizar Partida".  
     8. **Reinício:** O sistema chama POST /api/match/:id/end. O MatchControl.js é "desmontado" e o SundayPanel.js volta ao passo 2 (Presença/Sorteio), mostrando o time perdedor e a lista de espera para selecionar os próximos 5\. A lógica da "saída obrigatória" (3ª partida) é aplicada aqui pelo admin.

### **3.3. UI/UX (Design)**

* **Cores:** Paleta principal (Preto e Laranja) com cores de destaque vívidas (ex: Azul Elétrico, Verde Limão) para botões e alertas.  
* **Fontes:** Grandes e legíveis (ex: Inter, Poppins, Montserrat).  
* **Botões:** Grandes, com padding generoso (fácil de tocar), e micro-interações (hover/press via framer-motion ou CSS transitions).  
* **Fluidez:** Transições de página e de estado (ex: Sorteio \-\> Jogo) devem ser animadas (fade, slide).