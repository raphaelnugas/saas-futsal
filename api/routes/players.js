const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');
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

async function buildPlayersBackupPayload() {
  const result = await query(`
    SELECT 
      player_id,
      name,
      is_goalkeeper,
      photo_url,
      dominant_foot,
      height_cm,
      birthdate,
      attr_ofe,
      attr_def,
      attr_vel,
      attr_tec,
      attr_for,
      attr_pot
    FROM players
    ORDER BY player_id ASC
  `);
  return { players: result.rows };
}

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar todos os jogadores
router.get('/', async (req, res) => {
  try {
    logger.info('players_route_v2', { requestId: req.id });
    const result = await query(`
      SELECT 
        player_id,
        name,
        photo_url,
        photo_mime,
        CASE WHEN photo_data IS NOT NULL THEN true ELSE false END AS has_photo,
        is_goalkeeper,
        attr_ofe,
        attr_def,
        attr_vel,
        attr_tec,
        attr_for,
        attr_pot,
        (
          SELECT 
            COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0)
          FROM match_participants mp
          JOIN matches m ON mp.match_id = m.match_id
          WHERE mp.player_id = players.player_id AND m.status = 'finished'
        ) AS total_games_played,
        total_goals_scored,
        total_assists,
        total_goals_conceded,
        created_at
      FROM players 
      ORDER BY name ASC
    `);

    res.json({
      players: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Erro ao buscar jogadores', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar jogadores',
      message: 'Não foi possível recuperar a lista de jogadores',
      requestId: req.id
    });
  }
});

// Obter ranking de jogadores
router.get('/ranking', async (req, res) => {
  try {
    const result = await query('SELECT * FROM player_ranking ORDER BY total_goals_scored DESC LIMIT 10');
    
    res.json({
      ranking: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Erro ao buscar ranking', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar ranking',
      message: 'Não foi possível recuperar o ranking de jogadores',
      requestId: req.id
    });
  }
});

// Obter estatísticas de goleiros
router.get('/goalkeepers', async (req, res) => {
  try {
    const result = await query('SELECT * FROM goalkeeper_stats ORDER BY total_goals_conceded ASC');
    
    res.json({
      goalkeepers: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Erro ao buscar goleiros', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar goleiros',
      message: 'Não foi possível recuperar as estatísticas de goleiros',
      requestId: req.id
    });
  }
});

router.get('/waiting', async (req, res) => {
  try {
    const sundayRes = await query(`
      SELECT sunday_id 
      FROM game_sundays 
      ORDER BY date DESC, sunday_id DESC 
      LIMIT 1
    `);
    
    if (sundayRes.rows.length === 0) {
      return res.json({ players: [], total: 0 });
    }
    
    const sundayId = sundayRes.rows[0].sunday_id;
    
    const latestMatchRes = await query(`
      SELECT match_id 
      FROM matches 
      WHERE sunday_id = $1 
      ORDER BY match_number DESC 
      LIMIT 1
    `, [sundayId]);
    
    const matchId = latestMatchRes.rows.length ? latestMatchRes.rows[0].match_id : null;
    
    if (matchId) {
      const waitingRes = await query(`
        SELECT 
          p.player_id,
          p.name,
          p.photo_url,
          p.is_goalkeeper,
          p.total_games_played,
          p.total_goals_scored,
          p.total_assists,
          p.total_goals_conceded
        FROM attendances a
        JOIN players p ON a.player_id = p.player_id
        WHERE a.sunday_id = $1 
          AND a.is_present = true
          AND p.player_id NOT IN (
            SELECT mp.player_id 
            FROM match_participants mp 
            WHERE mp.match_id = $2 AND mp.player_id IS NOT NULL
          )
        ORDER BY a.arrival_order ASC
      `, [sundayId, matchId]);
      
      return res.json({ players: waitingRes.rows, total: waitingRes.rows.length });
    }
    
    const attendeesRes = await query(`
      SELECT 
        p.player_id,
        p.name,
        p.photo_url,
        p.is_goalkeeper,
        p.total_games_played,
        p.total_goals_scored,
        p.total_assists,
        p.total_goals_conceded
      FROM attendances a
      JOIN players p ON a.player_id = p.player_id
      WHERE a.sunday_id = $1 AND a.is_present = true
      ORDER BY a.arrival_order ASC
    `, [sundayId]);
    
    res.json({ players: attendeesRes.rows, total: attendeesRes.rows.length });
    
  } catch (error) {
    logger.error('Erro ao buscar jogadores aguardando', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar jogadores aguardando',
      message: 'Não foi possível recuperar a lista de jogadores aguardando',
      requestId: req.id
    });
  }
});

// Obter jogador específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      SELECT 
        p.*,
        pr.total_goals_scored,
        pr.total_assists,
        pr.total_games_played,
        pr.goals_per_game
      FROM players p
      LEFT JOIN player_ranking pr ON p.player_id = pr.player_id
      WHERE p.player_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Jogador não encontrado',
        message: `Jogador com ID ${id} não existe`
      });
    }

    const player = result.rows[0];
    const agg = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN m.winner_team = mp.team THEN 1 ELSE 0 END), 0) as wins,
        COALESCE(SUM(CASE WHEN m.winner_team = 'draw' THEN 1 ELSE 0 END), 0) as draws,
        COALESCE(SUM(CASE WHEN m.winner_team != 'draw' AND m.winner_team != mp.team THEN 1 ELSE 0 END), 0) as losses,
        COUNT(DISTINCT m.match_id) as matches_played,
        COUNT(DISTINCT gs.sunday_id) as sundays_played
      FROM match_participants mp
      JOIN matches m ON mp.match_id = m.match_id
      JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
      WHERE mp.player_id = $1 AND m.status = 'finished'
    `, [id]);
    const stats = agg.rows[0];

    res.json({
      player,
      stats: {
        goals_scored: Number(player.total_goals_scored || 0),
        goals_conceded: Number(player.total_goals_conceded || 0),
        wins: Number(stats.wins || 0),
        draws: Number(stats.draws || 0),
        losses: Number(stats.losses || 0),
        matches: Number(stats.wins || 0) + Number(stats.draws || 0) + Number(stats.losses || 0),
        sundays: Number(stats.sundays_played || 0)
      }
    });

  } catch (error) {
    logger.error('Erro ao buscar jogador', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao buscar jogador',
      message: 'Não foi possível recuperar os dados do jogador',
      requestId: req.id
    });
  }
});

router.get('/:id/photo', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT photo_data, photo_mime FROM players WHERE player_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Jogador não encontrado' });
    }
    const row = result.rows[0];
    if (!row.photo_data || !row.photo_mime) {
      return res.status(404).json({ error: 'Foto não encontrada' });
    }
    const etag = `"${crypto.createHash('sha1').update(row.photo_data).digest('hex')}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.set('Content-Type', row.photo_mime);
    res.send(row.photo_data);
  } catch (error) {
    logger.error('Erro ao obter foto', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao obter foto do jogador' });
  }
});

router.get('/:id/photo2', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT photo2_data, photo2_mime FROM players WHERE player_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Jogador não encontrado' });
    }
    const row = result.rows[0];
    if (!row.photo2_data || !row.photo2_mime) {
      return res.status(404).json({ error: 'Foto não encontrada' });
    }
    const etag = `"${crypto.createHash('sha1').update(row.photo2_data).digest('hex')}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.set('Content-Type', row.photo2_mime);
    res.send(row.photo2_data);
  } catch (error) {
    logger.error('Erro ao obter foto detalhada', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao obter foto detalhada do jogador' });
  }
});

// Criar novo jogador
router.post('/', [
  body('name').notEmpty().trim().isLength({ min: 2, max: 100 }).withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('photo_url').optional().isURL().withMessage('URL da foto deve ser válida'),
  body('is_goalkeeper').optional().isBoolean().withMessage('Goleiro deve ser verdadeiro ou falso'),
  body('photo_base64').optional().isString().withMessage('Foto deve ser base64'),
  body('photo_mime').optional().isString().withMessage('MIME type da foto inválido'),
  body('photo2_base64').optional().isString(),
  body('photo2_mime').optional().isString(),
  body('dominant_foot').optional().isString(),
  body('height_cm').optional().isInt({ min: 100, max: 250 }),
  body('birthdate').optional().isISO8601(),
  body('attr_ofe').optional().isInt({ min: 1, max: 99 }),
  body('attr_def').optional().isInt({ min: 1, max: 99 }),
  body('attr_vel').optional().isInt({ min: 1, max: 99 }),
  body('attr_tec').optional().isInt({ min: 1, max: 99 }),
  body('attr_for').optional().isInt({ min: 1, max: 99 }),
  body('attr_pot').optional().isInt({ min: 1, max: 99 })
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

    const { name, photo_url, is_goalkeeper = false, photo_base64, photo_mime, photo2_base64, photo2_mime, dominant_foot, height_cm, birthdate, attr_ofe, attr_def, attr_vel, attr_tec, attr_for, attr_pot } = req.body;
    let photoBuffer = null;
    if (photo_base64 && typeof photo_base64 === 'string') {
      try {
        photoBuffer = Buffer.from(photo_base64, 'base64');
      } catch (e) {
        return res.status(400).json({ 
          error: 'Foto inválida',
          message: 'Não foi possível processar a imagem enviada'
        });
      }
    }
    let photo2Buffer = null;
    if (photo2_base64 && typeof photo2_base64 === 'string') {
      try {
        photo2Buffer = Buffer.from(photo2_base64, 'base64');
      } catch (e) {
        return res.status(400).json({ 
          error: 'Foto inválida',
          message: 'Não foi possível processar a imagem detalhada enviada'
        });
      }
    }

    const result = await query(`
      INSERT INTO players (name, photo_url, photo_data, photo_mime, photo2_data, photo2_mime, dominant_foot, height_cm, birthdate, attr_ofe, attr_def, attr_vel, attr_tec, attr_for, attr_pot, is_goalkeeper)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [name, photo_url || null, photoBuffer, photo_mime || null, photo2Buffer, photo2_mime || null, dominant_foot || null, height_cm || null, birthdate || null, attr_ofe || 50, attr_def || 50, attr_vel || 50, attr_tec || 50, attr_for || 50, attr_pot || 50, is_goalkeeper]);

    res.status(201).json({
      message: 'Jogador criado com sucesso',
      player: result.rows[0]
    });

  } catch (error) {
    logger.error('Erro ao criar jogador', { error: error.message, requestId: req.id });
    
    if (error.code === '23505') {
      return res.status(409).json({ 
        error: 'Jogador já existe',
        message: 'Já existe um jogador com este nome'
      });
    }
    
    res.status(500).json({ 
      error: 'Erro ao criar jogador',
      message: 'Não foi possível criar o jogador',
      requestId: req.id
    });
  }
});

// Atualizar jogador
router.put('/:id', [
  body('name').optional().notEmpty().trim().isLength({ min: 2, max: 100 }).withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('photo_url').optional().isURL().withMessage('URL da foto deve ser válida'),
  body('is_goalkeeper').optional().isBoolean().withMessage('Goleiro deve ser verdadeiro ou falso'),
  body('photo_base64').optional().isString().withMessage('Foto deve ser base64'),
  body('photo_mime').optional().isString().withMessage('MIME type da foto inválido'),
  body('photo2_base64').optional().isString(),
  body('photo2_mime').optional().isString(),
  body('remove_photo').optional().isBoolean(),
  body('remove_photo2').optional().isBoolean(),
  body('dominant_foot').optional().isString(),
  body('height_cm').optional().isInt({ min: 100, max: 250 }),
  body('birthdate').optional().isISO8601(),
  body('attr_ofe').optional().isInt({ min: 1, max: 99 }),
  body('attr_def').optional().isInt({ min: 1, max: 99 }),
  body('attr_vel').optional().isInt({ min: 1, max: 99 }),
  body('attr_tec').optional().isInt({ min: 1, max: 99 }),
  body('attr_for').optional().isInt({ min: 1, max: 99 }),
  body('attr_pot').optional().isInt({ min: 1, max: 99 })
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
    const { name, photo_url, is_goalkeeper, photo_base64, photo_mime, photo2_base64, photo2_mime, remove_photo, remove_photo2, dominant_foot, height_cm, birthdate, attr_ofe, attr_def, attr_vel, attr_tec, attr_for, attr_pot } = req.body;
    let photoBuffer = null;
    if (photo_base64 && typeof photo_base64 === 'string') {
      try {
        photoBuffer = Buffer.from(photo_base64, 'base64');
      } catch (e) {
        return res.status(400).json({ 
          error: 'Foto inválida',
          message: 'Não foi possível processar a imagem enviada'
        });
      }
    }
    let photo2Buffer = null;
    if (photo2_base64 && typeof photo2_base64 === 'string') {
      try {
        photo2Buffer = Buffer.from(photo2_base64, 'base64');
      } catch (e) {
        return res.status(400).json({ 
          error: 'Foto inválida',
          message: 'Não foi possível processar a imagem detalhada enviada'
        });
      }
    }

    // Construir query dinamicamente
    let updateFields = [];
    let values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (photo_url !== undefined) {
      updateFields.push(`photo_url = $${paramCount}`);
      values.push(photo_url);
      paramCount++;
    }
    
    if (remove_photo === true) {
      updateFields.push(`photo_data = NULL`);
      updateFields.push(`photo_mime = NULL`);
    } else if (photoBuffer !== null) {
      updateFields.push(`photo_data = $${paramCount}`);
      values.push(photoBuffer);
      paramCount++;
      if (photo_mime !== undefined && typeof photo_mime === 'string' && photo_mime.trim() !== '') {
        updateFields.push(`photo_mime = $${paramCount}`);
        values.push(photo_mime);
        paramCount++;
      }
    }
    if (remove_photo2 === true) {
      updateFields.push(`photo2_data = NULL`);
      updateFields.push(`photo2_mime = NULL`);
    } else if (photo2Buffer !== null) {
      updateFields.push(`photo2_data = $${paramCount}`);
      values.push(photo2Buffer);
      paramCount++;
      if (photo2_mime !== undefined && typeof photo2_mime === 'string' && photo2_mime.trim() !== '') {
        updateFields.push(`photo2_mime = $${paramCount}`);
        values.push(photo2_mime);
        paramCount++;
      }
    }
    
    if (dominant_foot !== undefined) {
      updateFields.push(`dominant_foot = $${paramCount}`);
      values.push(dominant_foot || null);
      paramCount++;
    }
    if (height_cm !== undefined) {
      updateFields.push(`height_cm = $${paramCount}`);
      values.push(height_cm || null);
      paramCount++;
    }
    if (birthdate !== undefined) {
      updateFields.push(`birthdate = $${paramCount}`);
      values.push(birthdate || null);
      paramCount++;
    }
    if (attr_ofe !== undefined) {
      updateFields.push(`attr_ofe = $${paramCount}`);
      values.push(attr_ofe);
      paramCount++;
    }
    if (attr_def !== undefined) {
      updateFields.push(`attr_def = $${paramCount}`);
      values.push(attr_def);
      paramCount++;
    }
    if (attr_vel !== undefined) {
      updateFields.push(`attr_vel = $${paramCount}`);
      values.push(attr_vel);
      paramCount++;
    }
    if (attr_tec !== undefined) {
      updateFields.push(`attr_tec = $${paramCount}`);
      values.push(attr_tec);
      paramCount++;
    }
    if (attr_for !== undefined) {
      updateFields.push(`attr_for = $${paramCount}`);
      values.push(attr_for);
      paramCount++;
    }
    if (attr_pot !== undefined) {
      updateFields.push(`attr_pot = $${paramCount}`);
      values.push(attr_pot);
      paramCount++;
    }

    if (is_goalkeeper !== undefined) {
      updateFields.push(`is_goalkeeper = $${paramCount}`);
      values.push(is_goalkeeper);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        error: 'Nenhum campo para atualizar',
        message: 'Forneça pelo menos um campo para atualizar'
      });
    }

    values.push(id);

    const result = await query(`
      UPDATE players 
      SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE player_id = $${paramCount}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Jogador não encontrado',
        message: `Jogador com ID ${id} não existe`
      });
    }

    res.json({
      message: 'Jogador atualizado com sucesso',
      player: result.rows[0]
    });

  } catch (error) {
    logger.error('Erro ao atualizar jogador', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao atualizar jogador',
      message: 'Não foi possível atualizar o jogador',
      requestId: req.id
    });
  }
});

// Deletar jogador
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await transaction(async (client) => {
      await client.query(`UPDATE stats_log SET player_scorer_id = NULL WHERE player_scorer_id = $1`, [id]);
      await client.query(`UPDATE stats_log SET player_assist_id = NULL WHERE player_assist_id = $1`, [id]);
      await client.query(`UPDATE match_participants SET player_id = NULL WHERE player_id = $1`, [id]);
      await client.query(`UPDATE attendances SET player_id = NULL WHERE player_id = $1`, [id]);
      const del = await client.query(`
        DELETE FROM players 
        WHERE player_id = $1
        RETURNING *
      `, [id]);
      return del;
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Jogador não encontrado',
        message: `Jogador com ID ${id} não existe`
      });
    }

    res.json({
      message: 'Jogador deletado com sucesso',
      player: result.rows[0]
    });
  } catch (error) {
    logger.error('Erro ao deletar jogador', { error: error.message, requestId: req.id });
    
    if (error.code === '23503') {
      return res.status(409).json({ 
        error: 'Jogador em uso',
        message: 'Este jogador não pode ser deletado pois possui registros associados'
      });
    }
    
    res.status(500).json({ 
      error: 'Erro ao deletar jogador',
      message: 'Não foi possível deletar o jogador',
      requestId: req.id
    });
  }
});

// Zerar estatísticas do jogador (admin)
router.post('/:id/reset-stats', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const resetConceded = Boolean(req.body?.reset_conceded);
    const existing = await query('SELECT player_id, name FROM players WHERE player_id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Jogador não encontrado',
        message: `Jogador com ID ${id} não existe`,
        requestId: req.id
      });
    }
    const sql = resetConceded ? `
      UPDATE players 
      SET 
        total_games_played = 0,
        total_goals_scored = 0,
        total_assists = 0,
        total_goals_conceded = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE player_id = $1
      RETURNING player_id, name, total_games_played, total_goals_scored, total_assists, total_goals_conceded
    ` : `
      UPDATE players 
      SET 
        total_games_played = 0,
        total_goals_scored = 0,
        total_assists = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE player_id = $1
      RETURNING player_id, name, total_games_played, total_goals_scored, total_assists, total_goals_conceded
    `;
    const result = await query(sql, [id]);
    logger.info('player_stats_reset', { player_id: id, by: req.user?.username || 'admin', reset_conceded: resetConceded, requestId: req.id });
    res.json({ 
      message: 'Estatísticas zeradas com sucesso',
      player: result.rows[0]
    });
  } catch (error) {
    logger.error('Erro ao zerar estatísticas do jogador', { error: error.message, requestId: req.id });
    res.status(500).json({ 
      error: 'Erro ao zerar estatísticas',
      message: 'Não foi possível zerar as estatísticas do jogador',
      requestId: req.id
    });
  }
});

router.get('/backup', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        player_id,
        name,
        is_goalkeeper,
        photo_url,
        dominant_foot,
        height_cm,
        birthdate,
        attr_ofe,
        attr_def,
        attr_vel,
        attr_tec,
        attr_for,
        attr_pot
      FROM players
      ORDER BY player_id ASC
    `);
    res.json({ backup: { players: result.rows } });
  } catch (error) {
    logger.error('Erro ao gerar backup de jogadores', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao gerar backup de jogadores' });
  }
});

router.post('/backup/restore', requireAdmin, async (req, res) => {
  try {
    const payload = req.body && req.body.backup ? req.body.backup : req.body;
    const list = Array.isArray(payload?.players) ? payload.players : null;
    if (!list) {
      return res.status(400).json({ error: 'Backup inválido' });
    }
    const normalized = list
      .map((p) => ({
        player_id: Number(p?.player_id),
        name: typeof p?.name === 'string' ? p.name.trim() : '',
        is_goalkeeper: Boolean(p?.is_goalkeeper),
        photo_url: typeof p?.photo_url === 'string' && p.photo_url.trim().length > 0 ? p.photo_url.trim() : null,
        dominant_foot: typeof p?.dominant_foot === 'string' && p.dominant_foot.trim().length > 0 ? p.dominant_foot.trim() : null,
        height_cm: Number.isFinite(Number(p?.height_cm)) ? Number(p.height_cm) : null,
        birthdate: typeof p?.birthdate === 'string' && p.birthdate.trim().length > 0 ? p.birthdate.trim() : null,
        attr_ofe: Number.isFinite(Number(p?.attr_ofe)) ? Math.max(1, Math.min(99, Number(p.attr_ofe))) : 50,
        attr_def: Number.isFinite(Number(p?.attr_def)) ? Math.max(1, Math.min(99, Number(p.attr_def))) : 50,
        attr_vel: Number.isFinite(Number(p?.attr_vel)) ? Math.max(1, Math.min(99, Number(p.attr_vel))) : 50,
        attr_tec: Number.isFinite(Number(p?.attr_tec)) ? Math.max(1, Math.min(99, Number(p.attr_tec))) : 50,
        attr_for: Number.isFinite(Number(p?.attr_for)) ? Math.max(1, Math.min(99, Number(p.attr_for))) : 50,
        attr_pot: Number.isFinite(Number(p?.attr_pot)) ? Math.max(1, Math.min(99, Number(p.attr_pot))) : 50
      }))
      .filter((p) => Number.isFinite(p.player_id) && p.player_id > 0 && p.name.length > 0);
    if (!normalized.length) {
      return res.status(400).json({ error: 'Nenhum jogador válido no backup' });
    }
    const result = await transaction(async (client) => {
      let inserted = 0;
      let updated = 0;
      for (const p of normalized) {
        const existing = await client.query('SELECT player_id FROM players WHERE player_id = $1', [p.player_id]);
        if (existing.rows.length > 0) {
          await client.query(
            `
              UPDATE players
              SET 
                name = $2,
                is_goalkeeper = $3,
                photo_url = $4,
                dominant_foot = $5,
                height_cm = $6,
                birthdate = $7,
                attr_ofe = $8,
                attr_def = $9,
                attr_vel = $10,
                attr_tec = $11,
                attr_for = $12,
                attr_pot = $13,
                updated_at = CURRENT_TIMESTAMP
              WHERE player_id = $1
            `,
            [
              p.player_id,
              p.name,
              p.is_goalkeeper,
              p.photo_url,
              p.dominant_foot,
              p.height_cm,
              p.birthdate,
              p.attr_ofe,
              p.attr_def,
              p.attr_vel,
              p.attr_tec,
              p.attr_for,
              p.attr_pot
            ]
          );
          updated++;
        } else {
          await client.query(
            `
              INSERT INTO players (
                player_id, name, is_goalkeeper, photo_url, dominant_foot, height_cm, birthdate,
                attr_ofe, attr_def, attr_vel, attr_tec, attr_for, attr_pot
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `,
            [
              p.player_id,
              p.name,
              p.is_goalkeeper,
              p.photo_url,
              p.dominant_foot,
              p.height_cm,
              p.birthdate,
              p.attr_ofe,
              p.attr_def,
              p.attr_vel,
              p.attr_tec,
              p.attr_for,
              p.attr_pot
            ]
          );
          inserted++;
        }
      }
      return { inserted, updated, total: normalized.length };
    });
    res.json({ message: 'Jogadores restaurados', result });
  } catch (error) {
    logger.error('Erro ao restaurar backup de jogadores', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao restaurar backup de jogadores' });
  }
});

router.post('/backup/save', requireAdmin, async (req, res) => {
  try {
    const dir = resolveBackupDir();
    const dateStr = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `jogadores_${dateStr}.json`);
    await fs.promises.mkdir(dir, { recursive: true });
    const payload = await buildPlayersBackupPayload();
    const content = JSON.stringify(payload, null, 2);
    await fs.promises.writeFile(file, content, 'utf8');
    res.json({ message: 'Backup de jogadores salvo', file, bytes: Buffer.byteLength(content, 'utf8') });
  } catch (error) {
    logger.error('Erro ao salvar backup de jogadores', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao salvar backup de jogadores' });
  }
});

module.exports = router;
