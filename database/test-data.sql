-- Dados de teste para o sistema de futsal
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
INSERT INTO game_sundays (date, max_players, status, notes) VALUES
('2025-11-10', 10, 'completed', 'Ótimo dia, todos presentes'),
('2025-11-17', 10, 'scheduled', 'Próximo jogo agendado'),
('2025-11-24', 10, 'scheduled', 'Confirmação pendente');

-- Inserir partidas do dia 10/11
INSERT INTO matches (sunday_id, match_number, team_orange_score, team_black_score, match_duration_minutes, status, notes) VALUES
(1, 1, 5, 3, 10, 'completed', 'Jogo equilibrado'),
(1, 2, 4, 6, 10, 'completed', 'Time preto venceu de virada'),
(1, 3, 7, 2, 10, 'completed', 'Time laranja dominou'),
(1, 4, 3, 5, 10, 'completed', 'Jogo muito disputado');

-- Inserir participantes das partidas
-- Partida 1: Orange vs Black (5-3)
INSERT INTO match_participants (match_id, player_id, team_color, goals_scored, assists, is_goalkeeper, goals_conceded) VALUES
(1, 1, 'orange', 2, 1, false, 0),
(1, 2, 'orange', 1, 2, false, 0),
(1, 3, 'orange', 1, 0, false, 0),
(1, 4, 'orange', 1, 1, false, 0),
(1, 5, 'orange', 0, 1, true, 3),
(1, 6, 'black', 1, 0, false, 0),
(1, 7, 'black', 1, 1, false, 0),
(1, 8, 'black', 1, 0, false, 0),
(1, 9, 'black', 0, 1, false, 0),
(1, 10, 'black', 0, 0, true, 5);

-- Partida 2: Orange vs Black (4-6)
INSERT INTO match_participants (match_id, player_id, team_color, goals_scored, assists, is_goalkeeper, goals_conceded) VALUES
(2, 6, 'orange', 2, 1, false, 0),
(2, 7, 'orange', 1, 0, false, 0),
(2, 8, 'orange', 1, 1, false, 0),
(2, 9, 'orange', 0, 1, true, 6),
(2, 10, 'orange', 0, 0, false, 0),
(2, 1, 'black', 2, 1, false, 0),
(2, 2, 'black', 2, 0, false, 0),
(2, 3, 'black', 1, 1, false, 0),
(2, 4, 'black', 1, 0, false, 0),
(2, 5, 'black', 0, 0, true, 4);

-- Partida 3: Orange vs Black (7-2)
INSERT INTO match_participants (match_id, player_id, team_color, goals_scored, assists, is_goalkeeper, goals_conceded) VALUES
(3, 1, 'orange', 3, 2, false, 0),
(3, 2, 'orange', 2, 1, false, 0),
(3, 3, 'orange', 1, 1, false, 0),
(3, 4, 'orange', 1, 0, false, 0),
(3, 5, 'orange', 0, 1, true, 2),
(3, 6, 'black', 1, 0, false, 0),
(3, 7, 'black', 1, 0, false, 0),
(3, 8, 'black', 0, 1, true, 7),
(3, 9, 'black', 0, 0, false, 0),
(3, 10, 'black', 0, 0, false, 0);

-- Partida 4: Orange vs Black (3-5)
INSERT INTO match_participants (match_id, player_id, team_color, goals_scored, assists, is_goalkeeper, goals_conceded) VALUES
(4, 6, 'orange', 1, 1, false, 0),
(4, 7, 'orange', 1, 0, false, 0),
(4, 8, 'orange', 1, 1, false, 0),
(4, 9, 'orange', 0, 1, true, 5),
(4, 10, 'orange', 0, 0, false, 0),
(4, 1, 'black', 2, 1, false, 0),
(4, 2, 'black', 1, 0, false, 0),
(4, 3, 'black', 1, 1, false, 0),
(4, 4, 'black', 1, 0, false, 0),
(4, 5, 'black', 0, 0, true, 3);

-- Inserir presenças do domingo
INSERT INTO attendances (sunday_id, player_id, status, arrival_time, notes) VALUES
(1, 1, 'present', '08:30:00', 'Chegou cedo'),
(1, 2, 'present', '08:45:00', 'Chegou no horário'),
(1, 3, 'present', '09:00:00', 'Chegou no horário'),
(1, 4, 'present', '08:50:00', 'Chegou no horário'),
(1, 5, 'present', '09:05:00', 'Chegou um pouco atrasado'),
(1, 6, 'present', '08:40:00', 'Chegou cedo'),
(1, 7, 'present', '08:55:00', 'Chegou no horário'),
(1, 8, 'present', '09:00:00', 'Chegou no horário'),
(1, 9, 'present', '08:45:00', 'Chegou no horário'),
(1, 10, 'present', '08:35:00', 'Chegou cedo');

-- Inserir estatísticas detalhadas
INSERT INTO stats_log (match_id, player_id, action_type, goals_scored, assists, goals_conceded, action_timestamp, notes) VALUES
(1, 1, 'goal', 1, 0, 0, '10:30:00', 'Gol de chute'),
(1, 1, 'goal', 1, 0, 0, '15:20:00', 'Gol de cabeça'),
(1, 2, 'goal', 1, 0, 0, '12:10:00', 'Gol de chute'),
(1, 2, 'assist', 0, 1, 0, '10:30:00', 'Bela assistência'),
(1, 3, 'goal', 1, 0, 0, '18:45:00', 'Gol de chute'),
(1, 4, 'goal', 1, 0, 0, '22:30:00', 'Gol de chute'),
(1, 5, 'goalkeeper_save', 0, 0, 0, '25:00:00', 'Grande defesa'),
(1, 6, 'goal', 1, 0, 0, '28:15:00', 'Gol de chute'),
(1, 7, 'goal', 1, 0, 0, '32:40:00', 'Gol de chute'),
(1, 7, 'assist', 0, 1, 0, '28:15:00', 'Boa assistência'),
(1, 8, 'goal', 1, 0, 0, '35:20:00', 'Gol de chute');

-- Configuração do sistema
INSERT INTO system_config (config_key, config_value, description) VALUES
('max_players_per_game', '10', 'Número máximo de jogadores por partida'),
('match_duration_minutes', '10', 'Duração de cada partida em minutos'),
('win_streak_rule', '3', 'Número de vitórias consecutivas para trocar time'),
('default_goalkeeper_rotation', 'true', 'Rotacionar goleiros automaticamente'),
('team_colors', 'orange,black', 'Cores dos times'),
('game_day', 'sunday', 'Dia da semana dos jogos'),
('game_time', '09:00', 'Horário dos jogos'),
('season_year', '2025', 'Ano da temporada atual');