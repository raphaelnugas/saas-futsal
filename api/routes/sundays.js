const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar todos os domingos
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        gs.*,
        (
          SELECT COUNT(*) 
          FROM attendances a 
          WHERE a.sunday_id = gs.sunday_id AND a.is_present = true
        ) as total_attendees,
        (
          SELECT COUNT(*) 
          FROM matches m 
          WHERE m.sunday_id = gs.sunday_id
        ) as total_matches,
        (
          SELECT COUNT(*) 
          FROM matches m 
          WHERE m.sunday_id = gs.sunday_id AND m.status = 'finished'
        ) as finished_matches
      FROM game_sundays gs
      ORDER BY gs.date DESC
    `);

    res.json({
      sundays: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar domingos:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar domingos',
      message: 'Não foi possível recuperar a lista de domingos'
    });
  }
});

// Obter domingo específico com participantes e partidas
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar domingo
    const sundayResult = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [id]);
    
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${id} não existe`
      });
    }

    const sunday = sundayResult.rows[0];

    // Buscar participantes
    const attendeesResult = await query(`
      SELECT 
        a.*,
        p.name,
        p.photo_url,
        p.is_goalkeeper,
        p.total_games_played,
        p.total_goals_scored
      FROM attendances a
      LEFT JOIN players p ON a.player_id = p.player_id
      WHERE a.sunday_id = $1 AND a.is_present = true
      ORDER BY a.arrival_order ASC
    `, [id]);

    // Buscar partidas
    const matchesResult = await query(`
      SELECT 
        m.*,
        (
          SELECT COUNT(*) 
          FROM match_participants mp 
          WHERE mp.match_id = m.match_id
        ) as total_participants
      FROM matches m
      WHERE m.sunday_id = $1
      ORDER BY m.match_number ASC
    `, [id]);

    sunday.attendees = attendeesResult.rows;
    sunday.matches = matchesResult.rows;

    res.json({
      sunday
    });

  } catch (error) {
    console.error('Erro ao buscar domingo:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar domingo',
      message: 'Não foi possível recuperar os dados do domingo'
    });
  }
});

// Criar novo domingo
router.post('/', [
  body('date').isDate().withMessage('Data é obrigatória e deve ser válida'),
  body('master_password').optional().isLength({ min: 6 }).withMessage('Senha mestra deve ter pelo menos 6 caracteres')
], async (req, res) => {
  try {
    // Validar entrada
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Erro de validação', 
        details: errors.array() 
      });
    }

    const { date, master_password } = req.body;

    // Verificar se já existe domingo nesta data
    const existingResult = await query('SELECT * FROM game_sundays WHERE date = $1', [date]);
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Domingo já existe',
        message: `Já existe um domingo cadastrado para a data ${date}`
      });
    }

    // Hash da senha mestra (se fornecida)
    let masterPasswordHash = null;
    if (master_password) {
      const bcrypt = require('bcryptjs');
      masterPasswordHash = await bcrypt.hash(master_password, 10);
    }

    const result = await query(`
      INSERT INTO game_sundays (date, master_password_hash)
      VALUES ($1, $2)
      RETURNING *
    `, [date, masterPasswordHash]);

    res.status(201).json({
      message: 'Domingo criado com sucesso',
      sunday: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar domingo:', error);
    res.status(500).json({ 
      error: 'Erro ao criar domingo',
      message: 'Não foi possível criar o domingo'
    });
  }
});

// Registrar presença de jogador
router.post('/:id/attendance', [
  body('player_id').isInt({ min: 1 }).withMessage('ID do jogador é obrigatório'),
  body('is_present').isBoolean().withMessage('Presença deve ser verdadeiro ou falso'),
  body('arrival_order').optional().isInt({ min: 1 }).withMessage('Ordem de chegada deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    // Validar entrada
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Erro de validação', 
        details: errors.array() 
      });
    }

    const { id } = req.params;
    const { player_id, is_present, arrival_order } = req.body;

    // Verificar se o domingo existe
    const sundayResult = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${id} não existe`
      });
    }

    // Verificar se o jogador existe
    const playerResult = await query('SELECT * FROM players WHERE player_id = $1', [player_id]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Jogador não encontrado',
        message: `Jogador com ID ${player_id} não existe`
      });
    }

    // Inserir ou atualizar presença
    const result = await query(`
      INSERT INTO attendances (sunday_id, player_id, is_present, arrival_order)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sunday_id, player_id)
      DO UPDATE SET 
        is_present = EXCLUDED.is_present,
        arrival_order = EXCLUDED.arrival_order,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [id, player_id, is_present, arrival_order || null]);

    res.json({
      message: 'Presença registrada com sucesso',
      attendance: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao registrar presença:', error);
    res.status(500).json({ 
      error: 'Erro ao registrar presença',
      message: 'Não foi possível registrar a presença'
    });
  }
});

// Registrar presenças em lote
router.post('/:id/attendances', [
  body('attendance').isArray({ min: 1 }).withMessage('Lista de presenças é obrigatória'),
  body('attendance.*.player_id').isInt({ min: 1 }).withMessage('ID do jogador é obrigatório'),
  body('attendance.*.is_present').isBoolean().withMessage('Presença deve ser verdadeiro ou falso'),
  body('attendance.*.arrival_order').optional().isInt({ min: 1 }).withMessage('Ordem de chegada deve ser um número inteiro positivo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Erro de validação', 
        details: errors.array() 
      });
    }
    const { id } = req.params;
    const { attendance } = req.body;
    const sundayResult = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${id} não existe`
      });
    }
    const playerIds = Array.from(new Set(attendance.map(a => a.player_id)));
    const playersResult = await query(`
      SELECT player_id FROM players WHERE player_id = ANY($1)
    `, [playerIds]);
    const validIds = new Set(playersResult.rows.map(r => r.player_id));
    for (const pid of playerIds) {
      if (!validIds.has(pid)) {
        return res.status(400).json({ 
          error: 'Jogador inexistente',
          message: `Jogador com ID ${pid} não existe`
        });
      }
    }
    await transaction(async (client) => {
      for (const a of attendance) {
        await client.query(`
          INSERT INTO attendances (sunday_id, player_id, is_present, arrival_order)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (sunday_id, player_id)
          DO UPDATE SET 
            is_present = EXCLUDED.is_present,
            arrival_order = EXCLUDED.arrival_order,
            created_at = CURRENT_TIMESTAMP
        `, [id, a.player_id, a.is_present, a.arrival_order || null]);
      }
    });
    res.json({
      message: 'Presenças atualizadas com sucesso',
      updated: attendance.length
    });
  } catch (error) {
    console.error('Erro ao registrar presenças em lote:', error);
    res.status(500).json({ 
      error: 'Erro ao registrar presenças',
      message: 'Não foi possível registrar as presenças'
    });
  }
});

// Obter presenças de um domingo
router.get('/:id/attendances', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        a.*,
        p.name,
        p.photo_url,
        p.is_goalkeeper,
        p.total_games_played,
        p.total_goals_scored
      FROM attendances a
      LEFT JOIN players p ON a.player_id = p.player_id
      WHERE a.sunday_id = $1
      ORDER BY a.arrival_order ASC, p.name ASC
    `, [id]);

    res.json({
      attendances: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar presenças:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar presenças',
      message: 'Não foi possível recuperar as presenças'
    });
  }
});

// Obter partidas de um domingo
router.get('/:id/matches', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        m.*,
        (
          SELECT COUNT(*) 
          FROM match_participants mp 
          WHERE mp.match_id = m.match_id
        ) as total_participants
      FROM matches m
      WHERE m.sunday_id = $1
      ORDER BY m.match_number ASC
    `, [id]);

    res.json({
      matches: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar partidas:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar partidas',
      message: 'Não foi possível recuperar as partidas do domingo'
    });
  }
});

// Obter próximo domingo disponível
router.get('/next/available', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        gs.*,
        (
          SELECT COUNT(*) 
          FROM attendances a 
          WHERE a.sunday_id = gs.sunday_id AND a.is_present = true
        ) as total_attendees
      FROM game_sundays gs
      WHERE gs.date >= CURRENT_DATE
      ORDER BY gs.date ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Nenhum domingo disponível',
        message: 'Não há domingos futuros cadastrados'
      });
    }

    res.json({
      sunday: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao buscar próximo domingo:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar próximo domingo',
      message: 'Não foi possível recuperar o próximo domingo'
    });
  }
});

// Purga dados anteriores a uma data (limpar partidas e domingos passados)
router.post('/purge', [
  body('cutoff_date').optional().isDate().withMessage('Data de corte inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Erro de validação',
        details: errors.array()
      });
    }
    const cutoff = req.body.cutoff_date || '2026-01-01';
    const result = await transaction(async (client) => {
      const sundaysToDelete = await client.query(
        `SELECT sunday_id FROM game_sundays WHERE date < $1`,
        [cutoff]
      );
      const deletedCount = sundaysToDelete.rows.length;
      // Deletar domingos antigos (cascade remove matches, attendances, participants, stats_log)
      await client.query(`DELETE FROM game_sundays WHERE date < $1`, [cutoff]);
      // Resetar estatísticas acumuladas dos jogadores para começar do zero
      await client.query(`
        UPDATE players 
        SET 
          total_games_played = 0,
          total_goals_scored = 0,
          total_assists = 0,
          total_goals_conceded = 0,
          updated_at = CURRENT_TIMESTAMP
      `);
      return { deletedCount };
    });
    res.json({
      message: 'Dados anteriores removidos com sucesso',
      cutoff_date: cutoff,
      deleted_sundays: result.deletedCount
    });
  } catch (error) {
    console.error('Erro ao purgar dados anteriores:', error);
    res.status(500).json({
      error: 'Erro ao limpar dados',
      message: 'Não foi possível remover os domingos e partidas anteriores'
    });
  }
});

// Deletar um domingo específico (reverte estatísticas e remove dados relacionados)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sundayResult = await query('SELECT sunday_id FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${id} não existe`
      });
    }
    await transaction(async (client) => {
      const matchesRes = await client.query(`
        SELECT match_id, team_orange_score, team_black_score
        FROM matches
        WHERE sunday_id = $1
      `, [id]);
      const matchIds = matchesRes.rows.map(r => r.match_id);
      for (const matchId of matchIds) {
        const participantsResult = await client.query(`
          SELECT 
            mp.player_id,
            mp.team,
            mp.is_goalkeeper,
            m.team_orange_score,
            m.team_black_score
          FROM match_participants mp
          JOIN matches m ON mp.match_id = m.match_id
          WHERE mp.match_id = $1 AND mp.player_id IS NOT NULL
        `, [matchId]);
        const goalsResult = await client.query(`
          SELECT 
            player_scorer_id,
            player_assist_id
          FROM stats_log
          WHERE match_id = $1 AND (player_scorer_id IS NOT NULL OR player_assist_id IS NOT NULL)
        `, [matchId]);
        const participants = participantsResult.rows;
        const goals = goalsResult.rows;
        for (const participant of participants) {
          const playerGoals = goals.filter(g => g.player_scorer_id === participant.player_id).length;
          const playerAssists = goals.filter(g => g.player_assist_id === participant.player_id).length;
          const goalsConceded = (participant.team === 'orange' ? participant.team_black_score : participant.team_orange_score);
          await client.query(`
            UPDATE players 
            SET 
              total_games_played = GREATEST(total_games_played - 1, 0),
              total_goals_scored = GREATEST(total_goals_scored - $1, 0),
              total_assists = GREATEST(total_assists - $2, 0),
              total_goals_conceded = GREATEST(total_goals_conceded - $3, 0),
              updated_at = CURRENT_TIMESTAMP
            WHERE player_id = $4
          `, [playerGoals, playerAssists, goalsConceded, participant.player_id]);
        }
        await client.query('DELETE FROM stats_log WHERE match_id = $1', [matchId]);
        await client.query('DELETE FROM match_participants WHERE match_id = $1', [matchId]);
        await client.query('DELETE FROM matches WHERE match_id = $1', [matchId]);
      }
      await client.query('DELETE FROM attendances WHERE sunday_id = $1', [id]);
      await client.query('DELETE FROM game_sundays WHERE sunday_id = $1', [id]);
    });
    res.json({
      message: 'Domingo deletado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar domingo:', error);
    res.status(500).json({
      error: 'Erro ao deletar domingo',
      message: 'Não foi possível deletar o domingo'
    });
  }
});

module.exports = router;
