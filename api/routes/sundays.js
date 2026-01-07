const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function resolveBackupDir() {
  const envDir = (process.env.BACKUP_DIR || '').trim();
  if (envDir) return path.resolve(envDir);
  const candidates = [
    path.resolve(__dirname, '..', '..'),
    process.cwd(),
    path.resolve(__dirname, '..')
  ];
  for (const root of candidates) {
    try {
      if (fs.existsSync(root)) {
        return path.join(root, 'backups');
      }
    } catch {}
  }
  return path.join(process.cwd(), 'backups');
}

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

    const created = result.rows[0];
    try {
      const prevRes = await query(`
        SELECT sunday_id FROM game_sundays 
        WHERE sunday_id <> $1 
        ORDER BY date DESC, sunday_id DESC 
        LIMIT 1
      `, [created.sunday_id]);
      if (prevRes.rows.length > 0) {
        const prevId = prevRes.rows[0].sunday_id;
        const sundayRes = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [prevId]);
        const sunday = sundayRes.rows[0] || {};
        const attendancesRes = await query('SELECT * FROM attendances WHERE sunday_id = $1 ORDER BY arrival_order ASC, player_id ASC', [prevId]);
        const matchesRes = await query('SELECT * FROM matches WHERE sunday_id = $1 ORDER BY match_number ASC', [prevId]);
        const matchIds = matchesRes.rows.map(r => r.match_id);
        let participants = [];
        let stats = [];
        if (matchIds.length) {
          const partsRes = await query('SELECT * FROM match_participants WHERE match_id = ANY($1) ORDER BY match_id ASC, team ASC, player_id ASC', [matchIds]);
          const statsRes = await query('SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, COALESCE(event_type, \'goal\') AS event_type, created_at FROM stats_log WHERE match_id = ANY($1) ORDER BY match_id ASC, stat_id ASC', [matchIds]);
          participants = partsRes.rows;
          stats = statsRes.rows;
        }
        const backup = { sunday, attendances: attendancesRes.rows, matches: matchesRes.rows, participants, stats_log: stats };
        const dir = resolveBackupDir();
        const file = path.join(dir, `sunday_${prevId}.json`);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(file, JSON.stringify(backup, null, 2), 'utf8');
      }
    } catch {}

    res.status(201).json({
      message: 'Domingo criado com sucesso',
      sunday: created
    });

  } catch (error) {
    console.error('Erro ao criar domingo:', error);
    res.status(500).json({ 
      error: 'Erro ao criar domingo',
      message: 'Não foi possível criar o domingo'
    });
  }
});

// Ajustar data de um domingo (admin)
router.put('/:id/date', requireAdmin, [
  body('date').isDate().withMessage('Data é obrigatória e deve ser válida')
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
    const { date } = req.body;

    const sundayResult = await query('SELECT sunday_id FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${id} não existe`
      });
    }

    const conflict = await query('SELECT sunday_id FROM game_sundays WHERE date = $1 AND sunday_id <> $2', [date, id]);
    if (conflict.rows.length > 0) {
      return res.status(409).json({
        error: 'Data já utilizada',
        message: `Já existe um domingo cadastrado para a data ${date}`
      });
    }

    const result = await query('UPDATE game_sundays SET date = $1 WHERE sunday_id = $2 RETURNING *', [date, id]);
    res.json({
      message: 'Data do domingo atualizada com sucesso',
      sunday: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao ajustar data do domingo:', error);
    res.status(500).json({
      error: 'Erro ao ajustar data do domingo',
      message: 'Não foi possível ajustar a data do domingo'
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

router.get('/:id/backup', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const sundayRes = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayRes.rows.length === 0) {
      return res.status(404).json({ error: 'Domingo não encontrado' });
    }
    const sunday = sundayRes.rows[0];
    const attendancesRes = await query('SELECT * FROM attendances WHERE sunday_id = $1 ORDER BY arrival_order ASC, player_id ASC', [id]);
    const matchesRes = await query('SELECT * FROM matches WHERE sunday_id = $1 ORDER BY match_number ASC', [id]);
    const matchIds = matchesRes.rows.map(r => r.match_id);
    let participants = [];
    let stats = [];
    if (matchIds.length) {
      const partsRes = await query('SELECT * FROM match_participants WHERE match_id = ANY($1) ORDER BY match_id ASC, team ASC, player_id ASC', [matchIds]);
      const statsRes = await query('SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, COALESCE(event_type, \'goal\') AS event_type, created_at FROM stats_log WHERE match_id = ANY($1) ORDER BY match_id ASC, stat_id ASC', [matchIds]);
      participants = partsRes.rows;
      stats = statsRes.rows;
    }
    const backup = { sunday, attendances: attendancesRes.rows, matches: matchesRes.rows, participants, stats_log: stats };
    res.json({ backup });
  } catch (error) {
    console.error('Erro ao gerar backup do domingo:', error);
    res.status(500).json({ error: 'Erro ao gerar backup do domingo' });
  }
});

router.post('/:id/backup/save', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const sundayRes = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [id]);
    if (sundayRes.rows.length === 0) {
      return res.status(404).json({ error: 'Domingo não encontrado' });
    }
    const sunday = sundayRes.rows[0];
    const attendancesRes = await query('SELECT * FROM attendances WHERE sunday_id = $1 ORDER BY arrival_order ASC, player_id ASC', [id]);
    const matchesRes = await query('SELECT * FROM matches WHERE sunday_id = $1 ORDER BY match_number ASC', [id]);
    const matchIds = matchesRes.rows.map(r => r.match_id);
    let participants = [];
    let stats = [];
    if (matchIds.length) {
      const partsRes = await query('SELECT * FROM match_participants WHERE match_id = ANY($1) ORDER BY match_id ASC, team ASC, player_id ASC', [matchIds]);
      const statsRes = await query('SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, COALESCE(event_type, \'goal\') AS event_type, created_at FROM stats_log WHERE match_id = ANY($1) ORDER BY match_id ASC, stat_id ASC', [matchIds]);
      participants = partsRes.rows;
      stats = statsRes.rows;
    }
    const backup = { sunday, attendances: attendancesRes.rows, matches: matchesRes.rows, participants, stats_log: stats };
    const dir = resolveBackupDir();
    const file = path.join(dir, `sunday_${id}.json`);
    await fs.promises.mkdir(dir, { recursive: true });
    const content = JSON.stringify(backup, null, 2);
    await fs.promises.writeFile(file, content, 'utf8');
    res.json({ message: 'Backup salvo com sucesso', file, bytes: Buffer.byteLength(content, 'utf8') });
  } catch (error) {
    console.error('Erro ao salvar backup do domingo:', error);
    res.status(500).json({ error: 'Erro ao salvar backup do domingo' });
  }
});

router.post('/backup/restore', requireAdmin, async (req, res) => {
  try {
    const payload = req.body && req.body.backup ? req.body.backup : req.body;
    if (!payload || !payload.sunday || !Array.isArray(payload.matches) || !Array.isArray(payload.participants) || !Array.isArray(payload.stats_log)) {
      return res.status(400).json({ error: 'Backup inválido' });
    }
    const sundayDate = payload.sunday.date;
    if (!sundayDate) {
      return res.status(400).json({ error: 'Data do domingo ausente no backup' });
    }
    const playersInBackup = new Set([
      ...payload.participants.map(p => Number(p.player_id)).filter(n => Number.isFinite(n) && n > 0),
      ...payload.stats_log.map(s => Number(s.player_scorer_id)).filter(n => Number.isFinite(n) && n > 0),
      ...payload.stats_log.map(s => Number(s.player_assist_id)).filter(n => Number.isFinite(n) && n > 0),
    ]);
    if (playersInBackup.size) {
      const playersRes = await query('SELECT player_id FROM players WHERE player_id = ANY($1)', [Array.from(playersInBackup)]);
      const valid = new Set(playersRes.rows.map(r => Number(r.player_id)));
      for (const pid of playersInBackup) {
        if (!valid.has(pid)) {
          return res.status(400).json({ error: `Jogador ${pid} não existe para restaurar` });
        }
      }
    }
    const result = await transaction(async (client) => {
      const existing = await client.query('SELECT sunday_id FROM game_sundays WHERE date = $1', [sundayDate]);
      let sundayId;
      if (existing.rows.length > 0) {
        sundayId = existing.rows[0].sunday_id;
        const matchesRes = await client.query('SELECT match_id FROM matches WHERE sunday_id = $1', [sundayId]);
        const matchIds = matchesRes.rows.map(r => r.match_id);
        if (matchIds.length) {
          await client.query('DELETE FROM stats_log WHERE match_id = ANY($1)', [matchIds]);
          await client.query('DELETE FROM match_participants WHERE match_id = ANY($1)', [matchIds]);
          await client.query('DELETE FROM matches WHERE match_id = ANY($1)', [matchIds]);
        }
        await client.query('DELETE FROM attendances WHERE sunday_id = $1', [sundayId]);
        const pw = payload.sunday.master_password_hash || null;
        await client.query('UPDATE game_sundays SET master_password_hash = $1 WHERE sunday_id = $2', [pw, sundayId]);
      } else {
        const pw = payload.sunday.master_password_hash || null;
        const ins = await client.query('INSERT INTO game_sundays (date, master_password_hash) VALUES ($1, $2) RETURNING sunday_id', [sundayDate, pw]);
        sundayId = ins.rows[0].sunday_id;
      }
      if (Array.isArray(payload.attendances)) {
        for (const a of payload.attendances) {
          await client.query(
            `INSERT INTO attendances (sunday_id, player_id, is_present, arrival_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (sunday_id, player_id)
             DO UPDATE SET is_present = EXCLUDED.is_present, arrival_order = EXCLUDED.arrival_order, created_at = CURRENT_TIMESTAMP`,
            [sundayId, a.player_id, !!a.is_present, a.arrival_order || null]
          );
        }
      }
      const idMap = new Map();
      for (const m of payload.matches) {
        const ins = await client.query(
          `INSERT INTO matches (
             sunday_id, match_number, team_orange_win_streak, team_black_win_streak,
             status, start_time, end_time, team_orange_score, team_black_score, winner_team
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0), COALESCE($9, 0), $10)
           RETURNING match_id`,
          [
            sundayId,
            m.match_number,
            m.team_orange_win_streak || 0,
            m.team_black_win_streak || 0,
            m.status || 'finished',
            m.start_time || null,
            m.end_time || null,
            m.team_orange_score,
            m.team_black_score,
            m.winner_team || null
          ]
        );
        idMap.set(Number(m.match_id), ins.rows[0].match_id);
      }
      for (const p of payload.participants) {
        const newMid = idMap.get(Number(p.match_id));
        if (!newMid) continue;
        await client.query(
          `INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper)
           VALUES ($1, $2, $3, $4)`,
          [newMid, p.player_id || null, p.team, !!p.is_goalkeeper]
        );
      }
      for (const s of payload.stats_log) {
        const newMid = idMap.get(Number(s.match_id));
        if (!newMid) continue;
        await client.query(
          `INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, event_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newMid, s.player_scorer_id || null, s.player_assist_id || null, s.team_scored, s.goal_minute || null, !!s.is_own_goal, s.event_type || 'goal']
        );
      }
      await client.query(`
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
              AND COALESCE(s.event_type, 'goal') = 'goal'
              AND EXISTS (
                SELECT 1 FROM matches m WHERE m.match_id = s.match_id AND m.status = 'finished'
              )
          ), 0),
          total_assists = COALESCE((
            SELECT COUNT(*)
            FROM stats_log s
            WHERE s.player_assist_id = p.player_id
              AND COALESCE(s.event_type, 'goal') = 'goal'
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
      return { sunday_id: sundayId, matches_inserted: payload.matches.length, participants_inserted: payload.participants.length, stats_inserted: payload.stats_log.length, attendances_inserted: (payload.attendances || []).length };
    });
    res.json({ message: 'Backup restaurado com sucesso', result: result });
  } catch (error) {
    console.error('Erro ao restaurar backup do domingo:', error);
    res.status(500).json({ error: 'Erro ao restaurar backup do domingo' });
  }
});

module.exports = router;
