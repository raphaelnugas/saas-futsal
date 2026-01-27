const express = require('express');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Asset: CARD_GOLD png servido do banco (insere automaticamente se não existir)
router.get('/card-gold', async (req, res) => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS system_assets (
        asset_key VARCHAR(100) PRIMARY KEY,
        asset_mime VARCHAR(100) NOT NULL,
        asset_data BYTEA NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const existing = await query('SELECT asset_mime, asset_data FROM system_assets WHERE asset_key = $1', ['CARD_GOLD']);
    let row = existing.rows[0];
    if (!row) {
      const filePath = 'c:\\Futsal\\FutsalNautico\\database\\CARD_GOLD.png';
      const buffer = fs.readFileSync(filePath);
      await query('INSERT INTO system_assets (asset_key, asset_mime, asset_data) VALUES ($1, $2, $3)', ['CARD_GOLD', 'image/png', buffer]);
      const reloaded = await query('SELECT asset_mime, asset_data FROM system_assets WHERE asset_key = $1', ['CARD_GOLD']);
      row = reloaded.rows[0];
    }
    if (!row) {
      return res.status(404).json({ error: 'Asset não disponível' });
    }
    res.set('Content-Type', row.asset_mime || 'image/png');
    res.send(row.asset_data);
  } catch (error) {
    logger.error('Erro ao servir CARD_GOLD', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao obter template da carta' });
  }
});

// Cache simples em memória (TTL: 60 segundos)
const CACHE_TTL = 60 * 1000;
let DASHBOARD_CACHE = {
  data: null,
  timestamp: 0
};

// Estatísticas gerais do sistema
router.get('/dashboard', async (req, res) => {
  const now = Date.now();
  // Se o cache for válido e não houver query params que mudem o contexto (dashboard é global), retorna cache
  if (DASHBOARD_CACHE.data && (now - DASHBOARD_CACHE.timestamp < CACHE_TTL)) {
    return res.json(DASHBOARD_CACHE.data);
  }

  try {
    const result = await query(`
      SELECT 
        (SELECT COUNT(*) FROM players) as total_players,
        (SELECT COUNT(*) FROM players WHERE is_goalkeeper = true) as total_goalkeepers,
        (SELECT COUNT(*) FROM game_sundays) as total_sundays,
        (SELECT COUNT(*) FROM matches) as total_matches,
        (SELECT COUNT(*) FROM matches WHERE status = 'finished') as finished_matches,
        (SELECT COUNT(*) FROM attendances WHERE is_present = true) as total_attendances,
        (SELECT COUNT(*) FROM stats_log) as total_goals,
        (SELECT COUNT(DISTINCT player_scorer_id) FROM stats_log WHERE player_scorer_id IS NOT NULL) as players_with_goals,
        (SELECT COUNT(DISTINCT player_assist_id) FROM stats_log WHERE player_assist_id IS NOT NULL) as players_with_assists,
        (SELECT AVG(team_orange_score + team_black_score) FROM matches WHERE status = 'finished') as avg_goals_per_match
    `);

    const stats = result.rows[0];

    const teamStatsResult = await query(`
      SELECT 
        team_scored,
        COUNT(*) as total_goals
      FROM stats_log
      WHERE COALESCE(event_type, 'goal') = 'goal'
      GROUP BY team_scored
      ORDER BY total_goals DESC
    `);

    const recentMatchesResult = await query(`
      SELECT 
        m.match_id,
        m.match_number,
        m.team_orange_score,
        m.team_black_score,
        m.winner_team,
        (
          SELECT sl.team_scored
          FROM stats_log sl
          WHERE sl.match_id = m.match_id AND COALESCE(sl.event_type, 'goal') = 'tie_decider'
          ORDER BY sl.stat_id DESC
          LIMIT 1
        ) AS tie_decider_winner,
        m.status,
        gs.date as sunday_date,
        (
          SELECT COUNT(*) 
          FROM match_participants mp 
          WHERE mp.match_id = m.match_id
        ) as total_participants
      FROM matches m
      JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
      WHERE m.status = 'finished'
      ORDER BY gs.date DESC, m.match_number DESC
      LIMIT 5
    `);

    const topScorersResult = await query(`
      SELECT 
        player_id,
        name,
        photo_url,
        total_goals_scored
      FROM players
      ORDER BY total_goals_scored DESC, total_assists DESC, total_games_played DESC
      LIMIT 3
    `);
    const topAssistersResult = await query(`
      SELECT 
        player_id,
        name,
        photo_url,
        total_assists
      FROM players
      ORDER BY total_assists DESC, total_goals_scored DESC, total_games_played DESC
      LIMIT 3
    `);
    const topGoalkeepersResult = await query(`
      WITH year_sundays AS (
        SELECT sunday_id
        FROM game_sundays
        WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
      ),
      total_year AS (
        SELECT COUNT(*)::int AS total FROM year_sundays
      )
      SELECT 
        p.player_id,
        p.name,
        p.photo_url,
        ROUND(AVG(CASE WHEN mp.team = 'orange' THEN m.team_black_score ELSE m.team_orange_score END)::numeric, 2) AS avg_goals_conceded,
        COUNT(DISTINCT gs.sunday_id) AS gk_sundays,
        (SELECT total FROM total_year) AS total_sundays_year
      FROM players p
      JOIN match_participants mp ON mp.player_id = p.player_id
      JOIN matches m ON mp.match_id = m.match_id
      JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
      WHERE p.is_goalkeeper = true
        AND mp.is_goalkeeper = true
        AND m.status = 'finished'
        AND EXTRACT(YEAR FROM gs.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      GROUP BY p.player_id, p.name, p.photo_url
      HAVING COUNT(DISTINCT gs.sunday_id) >= CEIL(0.6 * (SELECT total FROM total_year))
      ORDER BY avg_goals_conceded ASC, gk_sundays DESC
      LIMIT 3
    `);

    const responseData = {
      general: stats,
      teamGoals: teamStatsResult.rows,
      recentMatches: recentMatchesResult.rows,
      topScorers: topScorersResult.rows,
      topAssisters: topAssistersResult.rows,
      topGoalkeepers: topGoalkeepersResult.rows
    };

    // Atualiza cache
    DASHBOARD_CACHE = {
      data: responseData,
      timestamp: Date.now()
    };

    res.json(responseData);

  } catch (error) {
    logger.error('Erro ao buscar estatísticas do dashboard', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas do dashboard'
    });
  }
});

// Estatísticas detalhadas de jogadores
router.get('/players/detailed', async (req, res) => {
  try {
    const { player_id } = req.query;
    
    let whereClause = '';
    let params = [];
    
    if (player_id) {
      whereClause = 'WHERE p.player_id = $1';
      params.push(player_id);
    }

    const result = await query(`
      SELECT 
        p.player_id,
        p.name,
        p.photo_url,
        p.is_goalkeeper,
        (
          SELECT 
            COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
          FROM match_participants mp
          JOIN matches m ON mp.match_id = m.match_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished'
        ) AS total_games_played,
        p.total_goals_scored,
        p.total_assists,
        p.total_goals_conceded,
        ROUND(
          CASE 
            WHEN (
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ) > 0 
            THEN p.total_goals_scored::numeric / NULLIF((
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ), 0)::numeric 
            ELSE 0::numeric 
          END, 2
        ) as goals_per_game,
        ROUND(
          CASE 
            WHEN (
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ) > 0 
            THEN p.total_assists::numeric / NULLIF((
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ), 0)::numeric 
            ELSE 0::numeric 
          END, 2
        ) as assists_per_game,
        ROUND(
          CASE 
            WHEN (
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ) > 0 
            THEN p.total_goals_conceded::numeric / NULLIF((
              SELECT 
                COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
              FROM match_participants mp
              JOIN matches m ON mp.match_id = m.match_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ), 0)::numeric 
            ELSE 0::numeric 
          END, 2
        ) as goals_conceded_per_game,
        (
          SELECT COUNT(DISTINCT m.match_id)
          FROM matches m
          JOIN match_participants mp ON m.match_id = mp.match_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished'
        ) as games_finished,
        (
          SELECT COUNT(DISTINCT m.match_id)
          FROM matches m
          JOIN match_participants mp ON m.match_id = mp.match_id
          WHERE mp.player_id = p.player_id AND m.winner_team = mp.team AND m.status = 'finished'
        ) as games_won,
        (
          SELECT COUNT(DISTINCT m.match_id)
          FROM matches m
          JOIN match_participants mp ON m.match_id = mp.match_id
          WHERE mp.player_id = p.player_id AND m.winner_team != mp.team AND m.status = 'finished' AND m.winner_team != 'draw'
        ) as games_lost,
        (
          SELECT COUNT(DISTINCT m.match_id)
          FROM matches m
          JOIN match_participants mp ON m.match_id = mp.match_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished' AND m.winner_team = 'draw'
        ) as games_drawn,
        (
          SELECT COUNT(DISTINCT gs.sunday_id)
          FROM matches m
          JOIN match_participants mp ON m.match_id = mp.match_id
          JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished'
        ) as sundays_played,
        ROUND(
          CASE 
            WHEN (
              SELECT COUNT(DISTINCT gs.sunday_id)
              FROM matches m
              JOIN match_participants mp ON m.match_id = mp.match_id
              JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ) > 0 
            THEN p.total_goals_scored::numeric / NULLIF((
              SELECT COUNT(DISTINCT gs.sunday_id)
              FROM matches m
              JOIN match_participants mp ON m.match_id = mp.match_id
              JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
              WHERE mp.player_id = p.player_id AND m.status = 'finished'
            ), 0)::numeric
            ELSE 0::numeric 
          END, 2
        ) as goals_per_sunday
        ,
        ROUND(
          COALESCE((
            SELECT AVG(CASE WHEN mp2.team = 'orange' THEN m2.team_black_score ELSE m2.team_orange_score END)::numeric
            FROM match_participants mp2
            JOIN matches m2 ON mp2.match_id = m2.match_id
            JOIN game_sundays gs2 ON m2.sunday_id = gs2.sunday_id
            WHERE mp2.player_id = p.player_id
              AND mp2.is_goalkeeper = true
              AND m2.status = 'finished'
              AND EXTRACT(YEAR FROM gs2.date) = EXTRACT(YEAR FROM CURRENT_DATE)
          ), 0), 2
        ) as gk_avg_conceded_year,
        (
          SELECT COUNT(DISTINCT gs2.sunday_id)
          FROM match_participants mp2
          JOIN matches m2 ON mp2.match_id = m2.match_id
          JOIN game_sundays gs2 ON m2.sunday_id = gs2.sunday_id
          WHERE mp2.player_id = p.player_id
            AND mp2.is_goalkeeper = true
            AND m2.status = 'finished'
            AND EXTRACT(YEAR FROM gs2.date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) as gk_sundays_year,
        (
          SELECT COUNT(*) FROM game_sundays gs2 WHERE EXTRACT(YEAR FROM gs2.date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) as total_sundays_year,
        COALESCE((
          (
            SELECT COUNT(DISTINCT gs2.sunday_id)
            FROM match_participants mp2
            JOIN matches m2 ON mp2.match_id = m2.match_id
            JOIN game_sundays gs2 ON m2.sunday_id = gs2.sunday_id
            WHERE mp2.player_id = p.player_id
              AND mp2.is_goalkeeper = true
              AND m2.status = 'finished'
              AND EXTRACT(YEAR FROM gs2.date) = EXTRACT(YEAR FROM CURRENT_DATE)
          ) * 100.0 /
          NULLIF((
            SELECT COUNT(*) FROM game_sundays gs2 WHERE EXTRACT(YEAR FROM gs2.date) = EXTRACT(YEAR FROM CURRENT_DATE)
          ), 0)
        ), 0)::float8 as gk_sunday_participation_pct_year
      FROM players p
      ${whereClause}
      ORDER BY p.total_goals_scored DESC, p.total_assists DESC
    `, params);

    res.json({
      players: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas detalhadas', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas detalhadas'
    });
  }
});

// Estatísticas por time (Orange vs Black)
router.get('/teams', async (req, res) => {
  try {
    const teamStatsResult = await query(`
      SELECT 
        team,
        COUNT(*) as total_games,
        COUNT(CASE WHEN m.winner_team = team THEN 1 END) as wins,
        COUNT(CASE WHEN m.winner_team != team AND m.winner_team != 'draw' THEN 1 END) as losses,
        COUNT(CASE WHEN m.winner_team = 'draw' THEN 1 END) as draws,
        SUM(CASE WHEN team = 'orange' THEN m.team_orange_score ELSE m.team_black_score END) as total_goals_scored,
        SUM(CASE WHEN team = 'orange' THEN m.team_black_score ELSE m.team_orange_score END) as total_goals_conceded,
        ROUND(
          COUNT(CASE WHEN m.winner_team = team THEN 1 END)::float / COUNT(*) * 100, 2
        ) as win_percentage
      FROM match_participants mp
      JOIN matches m ON mp.match_id = m.match_id
      WHERE m.status = 'finished'
      GROUP BY team
      ORDER BY team
    `);

    // Estatísticas de jogadores por time
    const playerStatsByTeamResult = await query(`
      SELECT 
        mp.team,
        COUNT(DISTINCT mp.player_id) as total_players,
        COUNT(*) as total_participations,
        SUM(p.total_goals_scored) as total_player_goals,
        SUM(p.total_assists) as total_player_assists,
        AVG(p.total_games_played) as avg_games_per_player
      FROM match_participants mp
      JOIN players p ON mp.player_id = p.player_id
      JOIN matches m ON mp.match_id = m.match_id
      WHERE m.status = 'finished'
      GROUP BY mp.team
      ORDER BY mp.team
    `);

    res.json({
      teamStats: teamStatsResult.rows,
      playerStatsByTeam: playerStatsByTeamResult.rows
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas por time', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas por time'
    });
  }
});

// Estatísticas de gols por período
router.get('/goals-by-period', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        CASE 
          WHEN goal_minute BETWEEN 0 AND 2 THEN '0-2 min'
          WHEN goal_minute BETWEEN 3 AND 5 THEN '3-5 min'
          WHEN goal_minute BETWEEN 6 AND 8 THEN '6-8 min'
          WHEN goal_minute BETWEEN 9 AND 10 THEN '9-10 min'
          ELSE 'Outros'
        END as period,
        COUNT(*) as total_goals,
        team_scored
      FROM stats_log
      WHERE goal_minute IS NOT NULL
      GROUP BY period, team_scored
      ORDER BY period, team_scored
    `);

    res.json({
      goalsByPeriod: result.rows
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas de gols por período', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas de gols por período'
    });
  }
});

// Estatísticas de sequência de vitórias
router.get('/win-streaks', async (req, res) => {
  try {
    // Maiores sequências de vitórias
    const winStreaksResult = await query(`
      SELECT 
        sunday_id,
        match_number,
        team_orange_win_streak,
        team_black_win_streak,
        winner_team
      FROM matches
      WHERE status = 'finished' AND (team_orange_win_streak > 0 OR team_black_win_streak > 0)
      ORDER BY GREATEST(team_orange_win_streak, team_black_win_streak) DESC
      LIMIT 10
    `);

    // Estatísticas gerais de sequências
    const streakStatsResult = await query(`
      SELECT 
        COUNT(CASE WHEN team_orange_win_streak >= 3 THEN 1 END) as orange_long_streaks,
        COUNT(CASE WHEN team_black_win_streak >= 3 THEN 1 END) as black_long_streaks,
        AVG(team_orange_win_streak) as avg_orange_streak,
        AVG(team_black_win_streak) as avg_black_streak,
        MAX(team_orange_win_streak) as max_orange_streak,
        MAX(team_black_win_streak) as max_black_streak
      FROM matches
      WHERE status = 'finished'
    `);

    res.json({
      winStreaks: winStreaksResult.rows,
      streakStats: streakStatsResult.rows[0]
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas de sequência de vitórias', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas de sequência de vitórias'
    });
  }
});

// Estatísticas de presenças
router.get('/attendance', async (req, res) => {
  try {
    // Jogadores mais presentes
    const mostPresentResult = await query(`
      SELECT 
        p.player_id,
        p.name,
        p.photo_url,
        COUNT(*) as total_presences,
        COUNT(*) * 100.0 / (SELECT COUNT(*) FROM game_sundays) as attendance_percentage
      FROM attendances a
      JOIN players p ON a.player_id = p.player_id
      WHERE a.is_present = true
      GROUP BY p.player_id, p.name, p.photo_url
      ORDER BY total_presences DESC
      LIMIT 10
    `);

    // Presenças por domingo
    const attendanceBySundayResult = await query(`
      SELECT 
        gs.date,
        COUNT(*) as total_attendees,
        COUNT(CASE WHEN p.is_goalkeeper = true THEN 1 END) as goalkeepers_present,
        COUNT(CASE WHEN p.is_goalkeeper = false THEN 1 END) as field_players_present
      FROM attendances a
      JOIN players p ON a.player_id = p.player_id
      JOIN game_sundays gs ON a.sunday_id = gs.sunday_id
      WHERE a.is_present = true
      GROUP BY gs.date, gs.sunday_id
      ORDER BY gs.date DESC
      LIMIT 10
    `);

    res.json({
      mostPresentPlayers: mostPresentResult.rows,
      attendanceBySunday: attendanceBySundayResult.rows
    });

  } catch (error) {
    logger.error('Erro ao buscar estatísticas de presenças', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar estatísticas',
      message: 'Não foi possível recuperar as estatísticas de presenças'
    });
  }
});

router.post('/audit-sunday', requireAdmin, async (req, res) => {
  try {
    const { sunday_id } = req.body;
    if (!/^\d+$/.test(String(sunday_id))) {
      return res.status(400).json({ error: 'ID do domingo inválido' });
    }
    const sundayRes = await query('SELECT sunday_id FROM game_sundays WHERE sunday_id = $1', [sunday_id]);
    if (sundayRes.rows.length === 0) {
      return res.status(404).json({ error: 'Domingo não encontrado' });
    }
    const statsColsRes = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'stats_log'
    `);
    const sCols = statsColsRes.rows.map(r => r.column_name);
    const hasTeamScored = sCols.includes('team_scored');
    const hasEventType = sCols.includes('event_type');
    const hasPlayerId = sCols.includes('player_id');
    const hasActionType = sCols.includes('action_type');
    const matchesRes = await query(`
      SELECT match_id, team_orange_score, team_black_score, status
      FROM matches
      WHERE sunday_id = $1
      ORDER BY match_number ASC
    `, [sunday_id]);
    if (matchesRes.rows.length === 0) {
      return res.json({ audited: 0, corrected: 0, matches: [] });
    }
    const summary = [];
    await transaction(async (client) => {
      for (const m of matchesRes.rows) {
        let countsRes;
        if (hasTeamScored) {
          countsRes = await client.query(`
            SELECT team_scored, COUNT(*) AS c
            FROM stats_log
            WHERE match_id = $1 AND COALESCE(event_type, 'goal') = 'goal'
            GROUP BY team_scored
          `, [m.match_id]);
        } else if (hasPlayerId && hasActionType) {
          countsRes = await client.query(`
            SELECT mp.team AS team_scored, COUNT(*) AS c
            FROM stats_log sl
            JOIN match_participants mp ON mp.match_id = sl.match_id AND mp.player_id = sl.player_id
            WHERE sl.match_id = $1 AND sl.action_type = 'goal'
            GROUP BY mp.team
          `, [m.match_id]);
        } else {
          countsRes = { rows: [] };
        }
        let orangeGoals = 0;
        let blackGoals = 0;
        for (const r of countsRes.rows) {
          if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
          if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
        }
        const beforeOrange = Number(m.team_orange_score || 0);
        const beforeBlack = Number(m.team_black_score || 0);
        const needsUpdate = (orangeGoals !== beforeOrange) || (blackGoals !== beforeBlack);
        if (needsUpdate) {
          const winner =
            orangeGoals > blackGoals ? 'orange' :
            blackGoals > orangeGoals ? 'black' : 'draw';
          await client.query(`
            UPDATE matches
            SET
              team_orange_score = $1,
              team_black_score = $2,
              winner_team = $3,
              updated_at = CURRENT_TIMESTAMP
            WHERE match_id = $4
          `, [orangeGoals, blackGoals, winner, m.match_id]);
        }
        summary.push({
          match_id: m.match_id,
          before: { orange: beforeOrange, black: beforeBlack },
          after: { orange: orangeGoals, black: blackGoals },
          corrected: needsUpdate
        });
      }
    });
    const corrected = summary.filter(s => s.corrected).length;
    res.json({ audited: matchesRes.rows.length, corrected, matches: summary });
  } catch (error) {
    logger.error('Erro na auditoria de domingo', { error: error.message, requestId: req.id });
    res.status(500).json({
      error: 'Erro na auditoria',
      message: 'Não foi possível executar a auditoria do domingo'
    });
  }
});

// Recalcular estatísticas agregadas dos jogadores (admin)
router.post('/recalculate', requireAdmin, async (req, res) => {
  try {
    await query(`
      UPDATE players p
      SET
        total_games_played = COALESCE((
          SELECT COUNT(DISTINCT m.match_id)
          FROM match_participants mp
          JOIN matches m ON mp.match_id = m.match_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished'
        ), 0),
        total_goals_scored = COALESCE((
          SELECT COUNT(*)
          FROM stats_log s
          WHERE s.player_scorer_id = p.player_id
            AND COALESCE(s.event_type, 'goal') IN ('goal','summary_goal')
            AND EXISTS (
              SELECT 1 FROM matches m WHERE m.match_id = s.match_id AND m.status = 'finished'
            )
        ), 0),
        total_assists = COALESCE((
          SELECT COUNT(*)
          FROM stats_log s
          WHERE s.player_assist_id = p.player_id
            AND COALESCE(s.event_type, 'goal') IN ('goal','summary_goal')
            AND EXISTS (
              SELECT 1 FROM matches m WHERE m.match_id = s.match_id AND m.status = 'finished'
            )
        ), 0),
        total_goals_conceded = COALESCE((
          SELECT SUM(CASE WHEN mp.team = 'orange' THEN m.team_black_score ELSE m.team_orange_score END)
          FROM match_participants mp
          JOIN matches m ON mp.match_id = m.match_id
          WHERE mp.player_id = p.player_id AND m.status = 'finished'
        ), 0),
        updated_at = CURRENT_TIMESTAMP
    `);
    const confirm = await query(`
      SELECT player_id, name, total_games_played, total_goals_scored, total_assists, total_goals_conceded
      FROM players
      ORDER BY name ASC
    `);
    res.json({
      message: 'Estatísticas recalculadas com sucesso',
      players: confirm.rows,
      total: confirm.rows.length
    });
  } catch (error) {
    logger.error('Falha ao recalcular estatísticas', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao recalcular estatísticas dos jogadores' });
  }
});

module.exports = router;
// Top jogadores
router.get('/top-players', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        p.name,
        p.total_goals_scored,
        p.total_games_played as total_matches_played,
        COALESCE(
          (
            SELECT COUNT(DISTINCT m.match_id)
            FROM matches m
            JOIN match_participants mp ON m.match_id = mp.match_id
            WHERE mp.player_id = p.player_id AND m.winner_team = mp.team AND m.status = 'finished'
          ) * 100.0 /
          NULLIF((
            SELECT COUNT(DISTINCT m.match_id)
            FROM matches m
            JOIN match_participants mp ON m.match_id = mp.match_id
            WHERE mp.player_id = p.player_id AND m.status = 'finished'
          ), 0), 0
        )::float8 as win_rate
      FROM players p
      ORDER BY p.total_goals_scored DESC, p.total_assists DESC
      LIMIT 10
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Erro ao buscar top players', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar top jogadores'
    });
  }
});
