-- Dados de teste para o sistema de futsal - CORRIGIDO
-- Inserir jogadores regulares
INSERT INTO players (name, photo_url, is_goalkeeper, total_games_played, total_goals_scored, total_assists, total_goals_conceded) VALUES
('João Silva', 'https://via.placeholder.com/150?text=João', false, 15, 12, 8, 0),
('Pedro Santos', 'https://via.placeholder.com/150?text=Pedro', false, 18, 15, 10, 0),
('Lucas Oliveira', 'https://via.placeholder.com/150?text=Lucas', false, 12, 8, 5, 0),
('Marcos Souza', 'https://via.placeholder.com/150?text=Marcos', false, 20, 18, 12, 0),
('Rafael Costa', 'https://via.placeholder.com/150?text=Rafael', false, 16, 10, 7, 0),
('Gabriel Lima', 'https://via.placeholder.com/150?text=Gabriel', false, 14, 14, 9, 0),
('Fernando Almeida', 'https://via.placeholder.com/150?text=Fernando', true, 10, 0, 3, 25),
('Diego Ferreira', 'https://via.placeholder.com/150?text=Diego', false, 17, 16, 11, 0),
('Thiago Rodrigues', 'https://via.placeholder.com/150?text=Thiago', false, 13, 11, 6, 0),
('André Mendes', 'https://via.placeholder.com/150?text=André', true, 8, 1, 2, 20);

-- Inserir domingos de jogo
INSERT INTO game_sundays (date) VALUES
('2025-11-10'),
('2025-11-17'),
('2025-11-24');

-- Inserir partidas do dia 10/11
INSERT INTO matches (sunday_id, match_number, team_orange_score, team_black_score, winner_team, status) VALUES
(1, 1, 5, 3, 'orange', 'finished'),
(1, 2, 4, 6, 'black', 'finished'),
(1, 3, 7, 2, 'orange', 'finished'),
(1, 4, 3, 5, 'black', 'finished');

-- Inserir participantes das partidas
-- Partida 1: Orange vs Black (5-3)
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(1, 1, 'orange', false),
(1, 2, 'orange', false),
(1, 3, 'orange', false),
(1, 4, 'orange', false),
(1, 7, 'orange', true),
(1, 6, 'black', false),
(1, 5, 'black', false),
(1, 8, 'black', false),
(1, 9, 'black', false),
(1, 10, 'black', true);

-- Partida 2: Orange vs Black (4-6)
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(2, 6, 'orange', false),
(2, 5, 'orange', false),
(2, 8, 'orange', false),
(2, 9, 'orange', false),
(2, 10, 'orange', true),
(2, 1, 'black', false),
(2, 2, 'black', false),
(2, 3, 'black', false),
(2, 4, 'black', false),
(2, 7, 'black', true);

-- Partida 3: Orange vs Black (7-2)
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(3, 1, 'orange', false),
(3, 2, 'orange', false),
(3, 3, 'orange', false),
(3, 4, 'orange', false),
(3, 7, 'orange', true),
(3, 6, 'black', false),
(3, 5, 'black', false),
(3, 10, 'black', true),
(3, 8, 'black', false),
(3, 9, 'black', false);

-- Partida 4: Orange vs Black (3-5)
INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper) VALUES
(4, 6, 'orange', false),
(4, 5, 'orange', false),
(4, 8, 'orange', false),
(4, 10, 'orange', true),
(4, 9, 'orange', false),
(4, 1, 'black', false),
(4, 2, 'black', false),
(4, 3, 'black', false),
(4, 4, 'black', false),
(4, 7, 'black', true);

-- Inserir presenças do domingo
INSERT INTO attendances (sunday_id, player_id, is_present, arrival_order) VALUES
(1, 1, true, 1),
(1, 2, true, 3),
(1, 3, true, 5),
(1, 4, true, 4),
(1, 5, true, 6),
(1, 6, true, 2),
(1, 7, true, 7),
(1, 8, true, 8),
(1, 9, true, 9),
(1, 10, true, 10);

-- Inserir estatísticas detalhadas (gols e assistências)
INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal) VALUES
(1, 1, 2, 'orange', 10, false),
(1, 1, 4, 'orange', 15, false),
(1, 2, 1, 'orange', 22, false),
(1, 3, 2, 'orange', 28, false),
(1, 4, 3, 'orange', 35, false),
(1, 6, 7, 'black', 12, false),
(1, 8, 9, 'black', 18, false),
(1, 5, 6, 'black', 25, false),
(2, 6, 5, 'orange', 8, false),
(2, 6, 8, 'orange', 16, false),
(2, 5, 9, 'orange', 24, false),
(2, 8, 6, 'orange', 32, false),
(2, 1, 3, 'black', 5, false),
(2, 2, 4, 'black', 14, false),
(2, 3, 1, 'black', 21, false),
(2, 4, 2, 'black', 28, false),
(2, 1, 2, 'black', 34, false),
(2, 2, 1, 'black', 38, false),
(3, 1, 2, 'orange', 3, false),
(3, 1, 4, 'orange', 9, false),
(3, 2, 1, 'orange', 15, false),
(3, 3, 2, 'orange', 21, false),
(3, 4, 3, 'orange', 27, false),
(3, 1, 2, 'orange', 33, false),
(3, 2, 1, 'orange', 39, false),
(3, 6, 5, 'black', 18, false),
(3, 5, 6, 'black', 36, false),
(4, 6, 5, 'orange', 7, false),
(4, 8, 6, 'orange', 19, false),
(4, 5, 9, 'orange', 31, false),
(4, 1, 3, 'black', 2, false),
(4, 2, 4, 'black', 11, false),
(4, 3, 1, 'black', 17, false),
(4, 4, 2, 'black', 23, false),
(4, 1, 2, 'black', 29, false);

-- Configuração do sistema
INSERT INTO system_config (master_password_hash, session_duration_minutes, match_duration_minutes, max_players_per_team) VALUES
('$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 120, 10, 5); -- senha: password