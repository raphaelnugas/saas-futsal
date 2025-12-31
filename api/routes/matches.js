const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

const sseClients = new Map();
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
async function broadcastGoal(matchId, stat) {
  const list = sseClients.get(Number(matchId));
  if (!list || !list.size) return;
  const countsRes = await query(
    `SELECT team_scored, COUNT(*) AS c FROM stats_log WHERE match_id = $1 GROUP BY team_scored`,
    [matchId]
  );
  let blackGoals = 0;
  let orangeGoals = 0;
  for (const r of countsRes.rows) {
    if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
    if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
  }
  for (const res of list) {
    sseWrite(res, 'goal', { stat, blackGoals, orangeGoals });
  }
}
router.get('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const matchRes = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (matchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    let list = sseClients.get(Number(id));
    if (!list) {
      list = new Set();
      sseClients.set(Number(id), list);
    }
    list.add(res);
    const statsRes = await query(
      `SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, created_at
       FROM stats_log WHERE match_id = $1 ORDER BY stat_id ASC`,
      [id]
    );
    let blackGoals = 0;
    let orangeGoals = 0;
    for (const ev of statsRes.rows) {
      if (ev.team_scored === 'black') blackGoals++;
      if (ev.team_scored === 'orange') orangeGoals++;
    }
    sseWrite(res, 'init', { stats: statsRes.rows, blackGoals, orangeGoals });
    const ping = setInterval(() => {
      sseWrite(res, 'ping', { ts: Date.now() });
    }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      const ll = sseClients.get(Number(id));
      if (ll) {
        ll.delete(res);
        if (ll.size === 0) sseClients.delete(Number(id));
      }
      res.end();
    });
  } catch {
    res.status(500).json({ error: 'Falha no stream' });
  }
});
// Listar todas as partidas
router.get('/', async (req, res) => {
  try {
    const { sunday_id, status } = req.query;
    let whereClause = '';
    let params = [];
    let paramCount = 1;

    if (sunday_id) {
      whereClause += `WHERE m.sunday_id = $${paramCount}`;
      params.push(sunday_id);
      paramCount++;
    }

    if (status) {
      whereClause += whereClause ? ' AND ' : 'WHERE ';
      whereClause += `m.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    const result = await query(`
      SELECT 
        m.*,
        gs.date as sunday_date,
        (
          SELECT COUNT(*) 
          FROM match_participants mp 
          WHERE mp.match_id = m.match_id
        ) as total_participants
      FROM matches m
      JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
      ${whereClause}
      ORDER BY m.sunday_id DESC, m.match_number ASC
    `, params);

    res.json({
      matches: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Erro ao buscar partidas:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar partidas',
      message: 'Não foi possível recuperar a lista de partidas'
    });
  }
});

// Obter partida específica com participantes
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar partida
    const matchResult = await query(`
      SELECT 
        m.*,
        gs.date as sunday_date
      FROM matches m
      JOIN game_sundays gs ON m.sunday_id = gs.sunday_id
      WHERE m.match_id = $1
    `, [id]);

    if (matchResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Partida não encontrada',
        message: `Partida com ID ${id} não existe`
      });
    }

    // Buscar participantes
    const participantsResult = await query(`
      SELECT 
        mp.*,
        p.name,
        p.photo_url,
        p.is_goalkeeper
      FROM match_participants mp
      LEFT JOIN players p ON mp.player_id = p.player_id
      WHERE mp.match_id = $1
      ORDER BY mp.team, p.name ASC
    `, [id]);

    const match = matchResult.rows[0];
    match.participants = participantsResult.rows;

    res.json({
      match
    });

  } catch (error) {
    console.error('Erro ao buscar partida:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar partida',
      message: 'Não foi possível recuperar os dados da partida'
    });
  }
});

// Criar nova partida (com sorteio automático de times)
router.post('/', [
  body('sunday_id').isInt({ min: 1 }).withMessage('ID do domingo é obrigatório'),
  body('match_number').isInt({ min: 1 }).withMessage('Número da partida é obrigatório')
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

    const { sunday_id, match_number } = req.body;

    // Verificar se o domingo existe
    const sundayResult = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [sunday_id]);
    if (sundayResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Domingo não encontrado',
        message: `Domingo com ID ${sunday_id} não existe`
      });
    }

    // Verificar se já existe partida com este número neste domingo
    const existingResult = await query(
      'SELECT * FROM matches WHERE sunday_id = $1 AND match_number = $2',
      [sunday_id, match_number]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Partida já existe',
        message: `Já existe uma partida número ${match_number} neste domingo`
      });
    }

    // Obter sequência de vitórias do time laranja
    const lastMatchResult = await query(`
      SELECT team_orange_win_streak 
      FROM matches 
      WHERE sunday_id = $1 
      ORDER BY match_number DESC 
      LIMIT 1
    `, [sunday_id]);

    const orangeWinStreak = lastMatchResult.rows.length > 0 
      ? lastMatchResult.rows[0].team_orange_win_streak 
      : 0;

    // Criar partida
    const result = await query(`
      INSERT INTO matches (
        sunday_id, 
        match_number, 
        team_orange_win_streak, 
        team_black_win_streak,
        status
      ) VALUES ($1, $2, $3, 0, 'scheduled')
      RETURNING *
    `, [sunday_id, match_number, orangeWinStreak]);

    res.status(201).json({
      message: 'Partida criada com sucesso',
      match: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar partida:', error);
    res.status(500).json({ 
      error: 'Erro ao criar partida',
      message: 'Não foi possível criar a partida'
    });
  }
});

// Sortear times para uma partida
router.post('/:id/teams', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar partida e verificar status
    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Partida não encontrada',
        message: `Partida com ID ${id} não existe`
      });
    }

    const match = matchResult.rows[0];
    if (match.status !== 'scheduled') {
      return res.status(400).json({ 
        error: 'Partida não pode ser sorteada',
        message: 'Apenas partidas agendadas podem ter times sorteados'
      });
    }

    // Buscar jogadores presentes neste domingo
    const playersResult = await query(`
      SELECT 
        p.player_id,
        p.name,
        p.photo_url,
        p.is_goalkeeper,
        p.total_games_played,
        p.total_goals_scored,
        p.total_goals_conceded,
        a.arrival_order
      FROM attendances a
      JOIN players p ON a.player_id = p.player_id
      WHERE a.sunday_id = $1 AND a.is_present = true
      ORDER BY a.arrival_order ASC
    `, [match.sunday_id]);

    if (playersResult.rows.length < 6) {
      return res.status(400).json({ 
        error: 'Jogadores insuficientes',
        message: `São necessários pelo menos 6 jogadores para sortear times. Atualmente há ${playersResult.rows.length} jogadores presentes.`
      });
    }

    const players = playersResult.rows;
    const maxPlayersPerTeam = parseInt(process.env.MAX_PLAYERS_PER_TEAM) || 5;
    const totalPlayers = Math.min(players.length, maxPlayersPerTeam * 2);

    // Aplicar regra de sequência de vitórias
    const selectedPlayers = applyWinStreakRule(players, match.team_orange_win_streak);

    // Sortear times
    const { orangeTeam, blackTeam } = sortTeams(selectedPlayers);

    // Iniciar transação para salvar times
    await transaction(async (client) => {
      // Limpar participantes existentes (se houver)
      await client.query('DELETE FROM match_participants WHERE match_id = $1', [id]);

      // Inserir participantes do time laranja
      for (const player of orangeTeam) {
        await client.query(`
          INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper)
          VALUES ($1, $2, 'orange', $3)
        `, [id, player.player_id, player.is_goalkeeper]);
      }

      // Inserir participantes do time preto
      for (const player of blackTeam) {
        await client.query(`
          INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper)
          VALUES ($1, $2, 'black', $3)
        `, [id, player.player_id, player.is_goalkeeper]);
      }

      // Atualizar status da partida
      await client.query(`
        UPDATE matches 
        SET status = 'in_progress', start_time = CURRENT_TIMESTAMP
        WHERE match_id = $1
      `, [id]);
    });

    res.json({
      message: 'Times sorteados com sucesso',
      orangeTeam,
      blackTeam,
      ruleApplied: match.team_orange_win_streak >= parseInt(process.env.WIN_STREAK_RULE)
    });

  } catch (error) {
    console.error('Erro ao sortear times:', error);
    res.status(500).json({ 
      error: 'Erro ao sortear times',
      message: 'Não foi possível sortear os times para esta partida'
    });
  }
});

// Sortear times a partir de uma lista de jogadores (sem partida)
router.post('/sort-teams', [
  body('player_ids').isArray({ min: 6 }).withMessage('Forneça pelo menos 6 jogadores'),
  body('player_ids.*').isInt({ min: 1 }).withMessage('IDs de jogadores devem ser inteiros válidos')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Erro de validação',
        details: errors.array()
      });
    }
    const { player_ids } = req.body;
    const playersResult = await query(`
      SELECT 
        player_id,
        name,
        photo_url,
        is_goalkeeper
      FROM players
      WHERE player_id = ANY($1)
      ORDER BY name ASC
    `, [player_ids]);
    const players = playersResult.rows;
    if (players.length < 6) {
      return res.status(400).json({
        error: 'Jogadores insuficientes',
        message: `São necessários pelo menos 6 jogadores. Recebidos ${players.length}.`
      });
    }
    const { orangeTeam, blackTeam } = sortTeams(players);
    res.json({
      black_team: blackTeam.map(p => p.player_id),
      orange_team: orangeTeam.map(p => p.player_id),
      orange_win_streak: 0
    });
  } catch (error) {
    console.error('Erro ao sortear times (lista):', error);
    res.status(500).json({
      error: 'Erro ao sortear times',
      message: 'Não foi possível realizar o sorteio a partir da lista fornecida'
    });
  }
});

// Definir participantes de uma partida a partir de listas de IDs
router.post('/:id/participants', [
  body('black_team').isArray({ min: 1 }).withMessage('Time preto deve conter pelo menos 1 jogador'),
  body('orange_team').isArray({ min: 1 }).withMessage('Time laranja deve conter pelo menos 1 jogador'),
  body('black_team.*').isInt({ min: 1 }).withMessage('IDs do time preto devem ser inteiros válidos'),
  body('orange_team.*').isInt({ min: 1 }).withMessage('IDs do time laranja devem ser inteiros válidos')
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
    const { black_team, orange_team } = req.body;

    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Partida não encontrada',
        message: `Partida com ID ${id} não existe`
      });
    }

    const allIds = Array.from(new Set([...(black_team || []), ...(orange_team || [])]));
    if (allIds.length < 2) {
      return res.status(400).json({ 
        error: 'Jogadores insuficientes',
        message: 'Forneça pelo menos 2 jogadores para definir os times'
      });
    }

    const playersResult = await query(`
      SELECT player_id, is_goalkeeper
      FROM players
      WHERE player_id = ANY($1)
    `, [allIds]);

    const playersById = new Map(playersResult.rows.map(p => [p.player_id, p]));

    // Verificar se todos IDs existem
    for (const pid of allIds) {
      if (!playersById.has(pid)) {
        return res.status(400).json({
          error: 'Jogador inexistente',
          message: `Jogador com ID ${pid} não existe`
        });
      }
    }

    await transaction(async (client) => {
      await client.query('DELETE FROM match_participants WHERE match_id = $1', [id]);

      for (const pid of orange_team) {
        const isGk = !!playersById.get(pid).is_goalkeeper;
        await client.query(`
          INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper)
          VALUES ($1, $2, 'orange', $3)
        `, [id, pid, isGk]);
      }

      for (const pid of black_team) {
        const isGk = !!playersById.get(pid).is_goalkeeper;
        await client.query(`
          INSERT INTO match_participants (match_id, player_id, team, is_goalkeeper)
          VALUES ($1, $2, 'black', $3)
        `, [id, pid, isGk]);
      }

      await client.query(`
        UPDATE matches
        SET status = 'in_progress', start_time = COALESCE(start_time, CURRENT_TIMESTAMP)
        WHERE match_id = $1
      `, [id]);
    });

    res.json({
      message: 'Participantes definidos com sucesso',
      black_team,
      orange_team
    });

  } catch (error) {
    console.error('Erro ao definir participantes:', error);
    res.status(500).json({ 
      error: 'Erro ao definir participantes',
      message: 'Não foi possível salvar os participantes da partida'
    });
  }
});

// Finalizar partida e atualizar estatísticas
router.post('/:id/finish', [
  body('orange_score').isInt({ min: 0 }).withMessage('Placar do time laranja deve ser um número inteiro positivo'),
  body('black_score').isInt({ min: 0 }).withMessage('Placar do time preto deve ser um número inteiro positivo')
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
    const { orange_score, black_score } = req.body;

    // Buscar partida
    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Partida não encontrada',
        message: `Partida com ID ${id} não existe`
      });
    }

    const match = matchResult.rows[0];
    if (match.status !== 'in_progress') {
      return res.status(400).json({ 
        error: 'Partida não pode ser finalizada',
        message: 'Apenas partidas em andamento podem ser finalizadas'
      });
    }

    // Determinar vencedor e atualizar sequência de vitórias
    let winner_team;
    let orange_win_streak = match.team_orange_win_streak;
    let black_win_streak = 0;

    if (orange_score > black_score) {
      winner_team = 'orange';
      orange_win_streak++;
      black_win_streak = 0;
    } else if (black_score > orange_score) {
      winner_team = 'black';
      orange_win_streak = 0;
      black_win_streak = 1;
    } else {
      winner_team = 'draw';
      orange_win_streak = 0;
      black_win_streak = 0;
    }

    // Atualizar partida
    await query(`
      UPDATE matches 
      SET 
        team_orange_score = $1,
        team_black_score = $2,
        winner_team = $3,
        team_orange_win_streak = $4,
        team_black_win_streak = $5,
        status = 'finished',
        end_time = CURRENT_TIMESTAMP
      WHERE match_id = $6
    `, [orange_score, black_score, winner_team, orange_win_streak, black_win_streak, id]);

    // Atualizar estatísticas dos jogadores
    await updatePlayerStats(id);

    res.json({
      message: 'Partida finalizada com sucesso',
      result: {
        winner: winner_team,
        orange_score,
        black_score,
        orange_win_streak,
        black_win_streak
      }
    });

  } catch (error) {
    console.error('Erro ao finalizar partida:', error);
    res.status(500).json({ 
      error: 'Erro ao finalizar partida',
      message: 'Não foi possível finalizar a partida'
    });
  }
});

// Adicionar gol/assistência na partida (admin)
router.post('/:id/stats-goal', [
  body('scorer_id').optional().isInt({ min: 1 }).withMessage('ID do autor do gol inválido'),
  body('assist_id').optional().isInt({ min: 1 }),
  body('team_scored').isIn(['orange', 'black']).withMessage('Time deve ser orange ou black'),
  body('goal_minute').optional().isInt({ min: 0, max: 120 }),
  body('is_own_goal').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Erro de validação', details: errors.array() });
    }
    const { id } = req.params;
    const { scorer_id, assist_id, team_scored, goal_minute, is_own_goal } = req.body;
    if (!is_own_goal && !scorer_id) {
      return res.status(400).json({ error: 'ID do autor do gol é obrigatório' });
    }
    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    if (!is_own_goal) {
      const teamParticipantsRes = await query(`
        SELECT player_id 
        FROM match_participants 
        WHERE match_id = $1 AND team = $2 AND player_id IS NOT NULL
      `, [id, team_scored]);
      const teamIds = new Set(teamParticipantsRes.rows.map(r => r.player_id));
      if (scorer_id && !teamIds.has(Number(scorer_id))) {
        return res.status(400).json({ error: 'Autor do gol não pertence ao time da partida' });
      }
      if (assist_id && !teamIds.has(Number(assist_id))) {
        return res.status(400).json({ error: 'Assistente não pertence ao time da partida' });
      }
    }
    let inserted;
    await transaction(async (client) => {
      const ins = await client.query(`
        INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [id, scorer_id || null, assist_id || null, team_scored, goal_minute || null, !!is_own_goal]);
      inserted = ins.rows[0];
      if (!is_own_goal && scorer_id) {
        await client.query(`
          UPDATE players 
          SET total_goals_scored = total_goals_scored + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = $1
        `, [scorer_id]);
      }
      if (assist_id) {
        await client.query(`
          UPDATE players 
          SET total_assists = total_assists + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = $1
        `, [assist_id]);
      }
      const concededTeam = team_scored === 'orange' ? 'black' : 'orange';
      const partRes = await client.query(`
        SELECT player_id 
        FROM match_participants 
        WHERE match_id = $1 AND team = $2 AND player_id IS NOT NULL
      `, [id, concededTeam]);
      const concededIds = partRes.rows.map(r => r.player_id);
      if (concededIds.length) {
        await client.query(`
          UPDATE players
          SET total_goals_conceded = total_goals_conceded + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = ANY($1)
        `, [concededIds]);
      }
    });
    try {
      await broadcastGoal(id, inserted);
    } catch {}
    res.status(201).json({ message: 'Gol/assistência registrada', stat: inserted });
  } catch (error) {
    console.error('Erro ao adicionar gol/assistência:', error);
    res.status(500).json({ error: 'Erro ao adicionar gol/assistência' });
  }
});

// Remover registro de gol/assistência (admin)
router.delete('/stats/:stat_id', requireAdmin, async (req, res) => {
  try {
    const { stat_id } = req.params;
    const existing = await query(`
      SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, is_own_goal
      FROM stats_log 
      WHERE stat_id = $1
    `, [stat_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    const row = existing.rows[0];
    await transaction(async (client) => {
      const concededTeam = row.team_scored === 'orange' ? 'black' : 'orange';
      const partRes = await client.query(`
        SELECT player_id 
        FROM match_participants 
        WHERE match_id = $1 AND team = $2 AND player_id IS NOT NULL
      `, [row.match_id, concededTeam]);
      const concededIds = partRes.rows.map(r => r.player_id);
      if (concededIds.length) {
        await client.query(`
          UPDATE players
          SET total_goals_conceded = GREATEST(total_goals_conceded - 1, 0),
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = ANY($1)
        `, [concededIds]);
      }
      if (!row.is_own_goal && row.player_scorer_id) {
        await client.query(`
          UPDATE players
          SET total_goals_scored = GREATEST(total_goals_scored - 1, 0),
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = $1
        `, [row.player_scorer_id]);
      }
      if (row.player_assist_id) {
        await client.query(`
          UPDATE players
          SET total_assists = GREATEST(total_assists - 1, 0),
              updated_at = CURRENT_TIMESTAMP
          WHERE player_id = $1
        `, [row.player_assist_id]);
      }
      await client.query('DELETE FROM stats_log WHERE stat_id = $1', [stat_id]);
    });
    res.json({ message: 'Registro removido e estatísticas revertidas' });
  } catch (error) {
    console.error('Erro ao remover registro de gol/assistência:', error);
    res.status(500).json({ error: 'Erro ao remover registro' });
  }
});

// Listar registros de gols/assistências de uma partida (admin)
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const matchResult = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const stats = await query(`
      SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, created_at
      FROM stats_log
      WHERE match_id = $1
      ORDER BY stat_id ASC
    `, [id]);
    res.json({ stats: stats.rows });
  } catch (error) {
    console.error('Erro ao listar registros da partida:', error);
    res.status(500).json({ error: 'Erro ao listar registros' });
  }
});

// Função auxiliar para aplicar regra de sequência de vitórias
function applyWinStreakRule(players, orangeWinStreak) {
  const winStreakRule = parseInt(process.env.WIN_STREAK_RULE) || 3;
  
  if (orangeWinStreak >= winStreakRule) {
    // Time laranja venceu muito, misturar jogadores mais fortes
    return players.sort(() => Math.random() - 0.5);
  }
  
  return players;
}

// Função auxiliar para sortear times
function sortTeams(players) {
  const maxPlayersPerTeam = parseInt(process.env.MAX_PLAYERS_PER_TEAM) || 5;
  const shuffled = players.slice().sort(() => Math.random() - 0.5);
  
  // Separar goleiros
  const goalkeepers = shuffled.filter(p => p.is_goalkeeper);
  const fieldPlayers = shuffled.filter(p => !p.is_goalkeeper);
  
  // Distribuir goleiros (1 por time se houver)
  const orangeTeam = [];
  const blackTeam = [];
  
  if (goalkeepers.length >= 1) {
    orangeTeam.push(goalkeepers[0]);
    if (goalkeepers.length >= 2) {
      blackTeam.push(goalkeepers[1]);
    }
  }
  
  // Completar com jogadores de linha
  const remainingPlayers = fieldPlayers.slice(0, (maxPlayersPerTeam * 2) - orangeTeam.length - blackTeam.length);
  
  for (let i = 0; i < remainingPlayers.length; i++) {
    if (i % 2 === 0 && orangeTeam.length < maxPlayersPerTeam) {
      orangeTeam.push(remainingPlayers[i]);
    } else if (blackTeam.length < maxPlayersPerTeam) {
      blackTeam.push(remainingPlayers[i]);
    } else {
      orangeTeam.push(remainingPlayers[i]);
    }
  }
  
  return { orangeTeam, blackTeam };
}

// Função auxiliar para atualizar estatísticas dos jogadores
async function updatePlayerStats(matchId) {
  // Buscar participantes da partida
  const participantsResult = await query(`
    SELECT 
      mp.player_id,
      mp.team,
      mp.is_goalkeeper,
      m.team_orange_score,
      m.team_black_score,
      m.winner_team
    FROM match_participants mp
    JOIN matches m ON mp.match_id = m.match_id
    WHERE mp.match_id = $1 AND mp.player_id IS NOT NULL
  `, [matchId]);
  
  const participants = participantsResult.rows;
 
  // Atualizar estatísticas de cada jogador (apenas jogos; gols/assistências/sofridos já atualizados ao vivo)
  for (const participant of participants) {
    await query(`
      UPDATE players 
      SET 
        total_games_played = total_games_played + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE player_id = $1
    `, [participant.player_id]);
  }
}

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Partida não encontrada',
        message: `Partida com ID ${id} não existe`
      });
    }
    await transaction(async (client) => {
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
      `, [id]);
      const goalsResult = await client.query(`
        SELECT 
          player_scorer_id,
          player_assist_id
        FROM stats_log
        WHERE match_id = $1 AND player_scorer_id IS NOT NULL
      `, [id]);
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
      await client.query('DELETE FROM stats_log WHERE match_id = $1', [id]);
      await client.query('DELETE FROM match_participants WHERE match_id = $1', [id]);
      await client.query('DELETE FROM matches WHERE match_id = $1', [id]);
    });
    res.json({
      message: 'Partida deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar partida:', error);
    res.status(500).json({
      error: 'Erro ao deletar partida',
      message: 'Não foi possível deletar a partida'
    });
  }
});

module.exports = router;
