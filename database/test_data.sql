-- Dados de Teste - Futsal D'Domingo
-- Inserts iniciais para testar o sistema

-- Configuração do sistema (será criada pelo script setup.js)
-- Senha mestra padrão: 'futsal2024'

-- Jogadores iniciais
INSERT INTO players (name, photo_url, is_goalkeeper, total_games_played, total_goals_scored, total_assists, total_goals_conceded) VALUES
('João Silva', 'https://via.placeholder.com/150/FF6B35/FFFFFF?text=João', false, 15, 12, 8, 0),
('Maria Santos', 'https://via.placeholder.com/150/000000/FFFFFF?text=Maria', true, 12, 0, 2, 25),
('Pedro Oliveira', 'https://via.placeholder.com/150/FF6B35/FFFFFF?text=Pedro', false, 18, 20, 15, 0),
('Ana Costa', 'https://via.placeholder.com/150/000000/FFFFFF?text=Ana', false, 14, 8, 10, 0),
('Carlos Souza', 'https://via.placeholder.com/150/FF6B35/FFFFFF?text=Carlos', true, 16, 1, 5, 30),
('Julia Lima', 'https://via.placeholder.com/150/000000/FFFFFF?text=Julia', false, 13, 15, 7, 0),
('Roberto Almeida', 'https://via.placeholder.com/150/FF6B35/FFFFFF?text=Roberto', false, 17, 18, 12, 0),
('Fernanda Rocha', 'https://via.placeholder.com/150/000000/FFFFFF?text=Fernanda', false, 11, 6, 4, 0),
('Lucas Ferreira', 'https://via.placeholder.com/150/FF6B35/FFFFFF?text=Lucas', true, 10, 0, 1, 20),
('Patricia Gomes', 'https://via.placeholder.com/150/000000/FFFFFF?text=Patricia', false, 19, 22, 18, 0);

-- Domingos de jogo (últimos 4 domingos)
INSERT INTO game_sundays (date) VALUES
(CURRENT_DATE - INTERVAL '7 days'),
(CURRENT_DATE - INTERVAL '14 days'),
(CURRENT_DATE - INTERVAL '21 days'),
(CURRENT_DATE - INTERVAL '28 days');

-- Presenças dos jogadores nos domingos
-- Domingo 1 (todos presentes)
INSERT INTO attendances (sunday_id, player_id, arrival_order) 
SELECT 1, player_id, row_number() OVER (ORDER BY player_id)
FROM players;

-- Domingo 2 (8 jogadores presentes)
INSERT INTO attendances (sunday_id, player_id, arrival_order) 
SELECT 2, player_id, row_number() OVER (ORDER BY player_id)
FROM players 
WHERE player_id <= 8;

-- Domingo 3 (10 jogadores presentes, com convidado)
INSERT INTO attendances (sunday_id, player_id, arrival_order) 
SELECT 3, player_id, row_number() OVER (ORDER BY player_id)
FROM players 
WHERE player_id <= 9;

INSERT INTO attendances (sunday_id, guest_name, guest_photo_url, arrival_order) 
VALUES (3, 'Rafael Convidado', 'https://via.placeholder.com/150/808080/FFFFFF?text=Rafael', 10);

-- Domingo 4 (todos presentes)
INSERT INTO attendances (sunday_id, player_id, arrival_order) 
SELECT 4, player_id, row_number() OVER (ORDER BY player_id)
FROM players;

-- Partidas do domingo 1
INSERT INTO matches (sunday_id, match_number, start_time, end_time, team_orange_score, team_black_score, team_orange_win_streak, team_black_win_streak, winner_team, status) VALUES
(1, 1, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:00', CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:15', 3, 2, 1, 0, 'orange', 'finished'),
(1, 2, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:20', CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:35', 1, 4, 0, 1, 'black', 'finished'),
(1, 3, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:40', CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:55', 2, 2, 0, 0, 'draw', 'finished'),
(1, 4, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '09:00', CURRENT_DATE - INTERVAL '7 days' + INTERVAL '09:15', 5, 3, 1, 0, 'orange', 'finished');

-- Participantes das partidas do domingo 1
-- Partida 1: Orange (João, Pedro, Ana, Julia, Maria G) vs Black (Carlos G, Roberto, Fernanda, Lucas, Patricia)
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(1, 1, 'orange', false), -- João
(1, 3, 'orange', false), -- Pedro
(1, 4, 'orange', false), -- Ana
(1, 6, 'orange', false), -- Julia
(1, 2, 'orange', true),  -- Maria (G)
(1, 5, 'black', true),   -- Carlos (G)
(1, 7, 'black', false),  -- Roberto
(1, 8, 'black', false),  -- Fernanda
(1, 9, 'black', false),  -- Lucas
(1, 10, 'black', false); -- Patricia

-- Partida 2: Times diferentes
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(2, 3, 'orange', false), -- Pedro
(2, 4, 'orange', false), -- Ana
(2, 6, 'orange', false), -- Julia
(2, 7, 'orange', false), -- Roberto
(2, 9, 'orange', true),  -- Lucas (G)
(2, 1, 'black', false),  -- João
(2, 2, 'black', true),   -- Maria (G)
(2, 5, 'black', false),  -- Carlos
(2, 8, 'black', false),  -- Fernanda
(2, 10, 'black', false); -- Patricia

-- Gols das partidas do domingo 1
-- Partida 1: Orange 3x2 Black
INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, created_at) VALUES
(1, 1, 3, 'orange', 5, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:05'),   -- João (Pedro)
(1, 3, 6, 'orange', 8, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:08'),   -- Pedro (Julia)
(1, 6, 4, 'orange', 12, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:12'),   -- Julia (Ana)
(1, 10, 7, 'black', 3, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:03'),   -- Patricia (Roberto)
(1, 7, 10, 'black', 14, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:14');   -- Roberto (Patricia)

-- Partida 2: Orange 1x4 Black
INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, created_at) VALUES
(2, 3, 6, 'orange', 7, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:27'),   -- Pedro (Julia)
(2, 1, 2, 'black', 2, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:22'),    -- João (Maria)
(2, 5, 8, 'black', 6, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:26'),    -- Carlos (Fernanda)
(2, 8, 5, 'black', 10, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:30'),   -- Fernanda (Carlos)
(2, 10, 1, 'black', 13, CURRENT_DATE - INTERVAL '7 days' + INTERVAL '08:33');   -- Patricia (João)

-- Atualizar estatísticas dos jogadores
SELECT update_player_stats(1);
SELECT update_player_stats(2);
SELECT update_player_stats(3);
SELECT update_player_stats(4);
SELECT update_player_stats(5);
SELECT update_player_stats(6);
SELECT update_player_stats(7);
SELECT update_player_stats(8);
SELECT update_player_stats(9);
SELECT update_player_stats(10);

-- Queries de teste para verificar os dados

-- Ranking de jogadores
SELECT * FROM player_ranking;

-- Estatísticas de goleiros
SELECT * FROM goalkeeper_stats;

-- Partidas do dia mais recente
SELECT * FROM daily_matches LIMIT 5;

-- Total de gols por time no domingo 1
SELECT 
    m.match_id,
    m.team_orange_score,
    m.team_black_score,
    m.winner_team,
    COUNT(CASE WHEN sl.team_scored = 'orange' THEN 1 END) as orange_goals_count,
    COUNT(CASE WHEN sl.team_scored = 'black' THEN 1 END) as black_goals_count
FROM matches m
LEFT JOIN stats_log sl ON m.match_id = sl.match_id
WHERE m.sunday_id = 1
GROUP BY m.match_id, m.team_orange_score, m.team_black_score, m.winner_team
ORDER BY m.match_id;

-- Jogadores que participaram de cada partida
SELECT 
    m.match_id,
    m.match_number,
    mp.team,
    p.name,
    mp.is_goalkeeper
FROM matches m
JOIN match_participants mp ON m.match_id = mp.match_id
LEFT JOIN players p ON mp.player_id = p.player_id
WHERE m.sunday_id = 1
ORDER BY m.match_id, mp.team, p.name;