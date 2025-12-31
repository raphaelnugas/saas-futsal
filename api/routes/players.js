const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

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
        is_goalkeeper,
        attr_ofe,
        attr_def,
        attr_vel,
        attr_tec,
        attr_for,
        attr_pot,
        total_games_played,
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
        matches: Number(stats.matches_played || 0),
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
    res.set('Cache-Control', 'public, max-age=604800, must-revalidate');
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
    res.set('Cache-Control', 'public, max-age=604800, must-revalidate');
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

module.exports = router;
