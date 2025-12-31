-- Schema do Banco de Dados - Futsal D'Domingo
-- PostgreSQL Database Schema

-- Criar database (opcional, se precisar criar)
-- CREATE DATABASE futsal_domingo;

-- Conectar ao database
-- \c futsal_domingo;

-- Drop tables if exists (para recriar se necessário)
DROP TABLE IF EXISTS stats_log CASCADE;
DROP TABLE IF EXISTS match_participants CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS attendances CASCADE;
DROP TABLE IF EXISTS game_sundays CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS system_config CASCADE;

-- Tabela de configuração do sistema (senha mestra)
CREATE TABLE system_config (
    config_id SERIAL PRIMARY KEY,
    master_password_hash VARCHAR(255) NOT NULL,
    session_duration_minutes INTEGER DEFAULT 120,
    match_duration_minutes INTEGER DEFAULT 10,
    max_players_per_team INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela principal para os jogadores cadastrados
CREATE TABLE players (
    player_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    photo_url VARCHAR(255) NULL,
    photo_data BYTEA NULL,
    photo_mime VARCHAR(100) NULL,
    dominant_foot VARCHAR(10) NULL,
    height_cm INTEGER NULL,
    birthdate DATE NULL,
    attr_ofe INTEGER DEFAULT 50,
    attr_def INTEGER DEFAULT 50,
    attr_vel INTEGER DEFAULT 50,
    attr_tec INTEGER DEFAULT 50,
    attr_for INTEGER DEFAULT 50,
    attr_pot INTEGER DEFAULT 50,
    is_goalkeeper BOOLEAN NOT NULL DEFAULT FALSE,
    total_games_played INTEGER DEFAULT 0,
    total_goals_scored INTEGER DEFAULT 0,
    total_assists INTEGER DEFAULT 0,
    total_goals_conceded INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela para registrar os domingos em que houve jogos
CREATE TABLE game_sundays (
    sunday_id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    master_password_hash VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de presença (Quem compareceu em qual domingo)
CREATE TABLE attendances (
    attendance_id SERIAL PRIMARY KEY,
    sunday_id INT NOT NULL REFERENCES game_sundays(sunday_id) ON DELETE CASCADE,
    player_id INT REFERENCES players(player_id) ON DELETE SET NULL,
    guest_name VARCHAR(100) NULL,
    guest_photo_url VARCHAR(255) NULL,
    is_present BOOLEAN DEFAULT TRUE,
    arrival_order INTEGER NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sunday_id, player_id)
);

-- Tabela para cada partida individual
CREATE TABLE matches (
    match_id SERIAL PRIMARY KEY,
    sunday_id INT NOT NULL REFERENCES game_sundays(sunday_id) ON DELETE CASCADE,
    match_number INTEGER NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NULL,
    end_time TIMESTAMP WITH TIME ZONE NULL,
    team_orange_score INT NOT NULL DEFAULT 0,
    team_black_score INT NOT NULL DEFAULT 0,
    team_orange_win_streak INT NOT NULL DEFAULT 0,
    team_black_win_streak INT NOT NULL DEFAULT 0,
    winner_team VARCHAR(10) NULL CHECK (winner_team IN ('orange', 'black', 'draw')),
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'finished')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de "escalação" (Quais jogadores participaram de qual partida e em qual time)
CREATE TABLE match_participants (
    participant_id SERIAL PRIMARY KEY,
    match_id INT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_id INT REFERENCES players(player_id) ON DELETE SET NULL,
    guest_name_snapshot VARCHAR(100) NULL,
    team VARCHAR(10) NOT NULL CHECK (team IN ('orange', 'black')),
    is_goalkeeper BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Log de estatísticas (Gols e Assistências)
CREATE TABLE stats_log (
    stat_id SERIAL PRIMARY KEY,
    match_id INT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_scorer_id INT REFERENCES players(player_id),
    player_assist_id INT NULL REFERENCES players(player_id),
    team_scored VARCHAR(10) NOT NULL CHECK (team_scored IN ('orange', 'black')),
    goal_minute INTEGER NULL,
    is_own_goal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX idx_players_name ON players(name);
CREATE INDEX idx_players_goalkeeper ON players(is_goalkeeper);
CREATE INDEX idx_game_sundays_date ON game_sundays(date);
CREATE INDEX idx_attendances_sunday ON attendances(sunday_id);
CREATE INDEX idx_attendances_player ON attendances(player_id);
CREATE INDEX idx_matches_sunday ON matches(sunday_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_match_participants_match ON match_participants(match_id);
CREATE INDEX idx_match_participants_player ON match_participants(player_id);
CREATE INDEX idx_match_participants_team ON match_participants(team);
CREATE INDEX idx_stats_log_match ON stats_log(match_id);
CREATE INDEX idx_stats_log_scorer ON stats_log(player_scorer_id);
CREATE INDEX idx_stats_log_team ON stats_log(team_scored);

-- Função para atualizar o updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para atualizar updated_at
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Função para calcular estatísticas de um jogador
CREATE OR REPLACE FUNCTION update_player_stats(p_player_id INT)
RETURNS VOID AS $$
BEGIN
    UPDATE players 
    SET 
        total_games_played = (
            SELECT COUNT(DISTINCT m.match_id)
            FROM matches m
            JOIN match_participants mp ON m.match_id = mp.match_id
            WHERE mp.player_id = p_player_id AND m.status = 'finished'
        ),
        total_goals_scored = (
            SELECT COUNT(*)
            FROM stats_log sl
            JOIN matches m ON sl.match_id = m.match_id
            WHERE sl.player_scorer_id = p_player_id AND m.status = 'finished'
        ),
        total_assists = (
            SELECT COUNT(*)
            FROM stats_log sl
            JOIN matches m ON sl.match_id = m.match_id
            WHERE sl.player_assist_id = p_player_id AND m.status = 'finished'
        ),
        total_goals_conceded = (
            SELECT COUNT(*)
            FROM stats_log sl
            JOIN matches m ON sl.match_id = m.match_id
            JOIN match_participants mp ON m.match_id = mp.match_id
            WHERE mp.player_id = p_player_id 
            AND mp.is_goalkeeper = true
            AND sl.team_scored != mp.team
            AND m.status = 'finished'
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE player_id = p_player_id;
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar sequência de vitórias
CREATE OR REPLACE FUNCTION update_win_streaks(p_match_id INT)
RETURNS VOID AS $$
DECLARE
    v_orange_score INT;
    v_black_score INT;
    v_sunday_id INT;
    v_last_orange_streak INT;
    v_last_black_streak INT;
BEGIN
    -- Obter informações da partida
    SELECT team_orange_score, team_black_score, sunday_id 
    INTO v_orange_score, v_black_score, v_sunday_id
    FROM matches 
    WHERE match_id = p_match_id;

    -- Obter sequências da partida anterior
    SELECT COALESCE(MAX(team_orange_win_streak), 0), COALESCE(MAX(team_black_win_streak), 0)
    INTO v_last_orange_streak, v_last_black_streak
    FROM matches 
    WHERE sunday_id = v_sunday_id AND match_id < p_match_id;

    -- Atualizar sequências baseado no resultado
    IF v_orange_score > v_black_score THEN
        -- Orange venceu
        UPDATE matches 
        SET 
            team_orange_win_streak = v_last_orange_streak + 1,
            team_black_win_streak = 0,
            winner_team = 'orange',
            updated_at = CURRENT_TIMESTAMP
        WHERE match_id = p_match_id;
    ELSIF v_black_score > v_orange_score THEN
        -- Black venceu
        UPDATE matches 
        SET 
            team_black_win_streak = v_last_black_streak + 1,
            team_orange_win_streak = 0,
            winner_team = 'black',
            updated_at = CURRENT_TIMESTAMP
        WHERE match_id = p_match_id;
    ELSE
        -- Empate
        UPDATE matches 
        SET 
            team_orange_win_streak = 0,
            team_black_win_streak = 0,
            winner_team = 'draw',
            updated_at = CURRENT_TIMESTAMP
        WHERE match_id = p_match_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- View para ranking de jogadores
CREATE OR REPLACE VIEW player_ranking AS
SELECT 
    p.player_id,
    p.name,
    p.photo_url,
    p.is_goalkeeper,
    p.total_games_played,
    p.total_goals_scored,
    p.total_assists,
    p.total_goals_conceded,
    CASE 
        WHEN p.total_games_played > 0 THEN 
            ROUND(p.total_goals_scored::DECIMAL / p.total_games_played, 2)
        ELSE 0
    END as goals_per_game,
    p.created_at,
    p.updated_at
FROM players p
ORDER BY p.total_goals_scored DESC, p.total_assists DESC;

-- View para estatísticas de goleiros
CREATE OR REPLACE VIEW goalkeeper_stats AS
SELECT 
    p.player_id,
    p.name,
    p.photo_url,
    p.total_games_played,
    p.total_goals_conceded,
    CASE 
        WHEN p.total_games_played > 0 THEN 
            ROUND(p.total_goals_conceded::DECIMAL / p.total_games_played, 2)
        ELSE 0
    END as goals_conceded_per_game,
    p.updated_at
FROM players p
WHERE p.is_goalkeeper = TRUE
ORDER BY p.total_goals_conceded ASC;

-- View para partidas do dia
CREATE OR REPLACE VIEW daily_matches AS
SELECT 
    m.match_id,
    m.sunday_id,
    gs.date,
    m.match_number,
    m.start_time,
    m.end_time,
    m.team_orange_score,
    m.team_black_score,
    m.team_orange_win_streak,
    m.team_black_win_streak,
    m.winner_team,
    m.status,
    m.created_at,
    CASE 
        WHEN m.team_orange_score > m.team_black_score THEN 'orange'
        WHEN m.team_black_score > m.team_orange_score THEN 'black'
        ELSE 'draw'
    END as actual_winner,
    EXTRACT(EPOCH FROM (m.end_time - m.start_time))/60 as duration_minutes
FROM matches m
JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
ORDER BY gs.date DESC, m.match_number ASC;
