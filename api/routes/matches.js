const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

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

const sseClients = new Map();
const tickerClients = new Set();
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
async function broadcastGoal(matchId, stat) {
  const list = sseClients.get(Number(matchId));
  if (!list || !list.size) return;
  const countsRes = await query(
    `SELECT team_scored, COUNT(*) AS c FROM stats_log WHERE match_id = $1 AND event_type = 'goal' GROUP BY team_scored`,
    [matchId]
  );
  let blackGoals = 0;
  let orangeGoals = 0;
  for (const r of countsRes.rows) {
    if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
    if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
  }
  for (const res of list) {
    sseWrite(res, 'goal', { stat, blackGoals, orangeGoals, server_now: new Date().toISOString() });
  }
  if (tickerClients.size) {
    const startRes = await query(`SELECT start_time FROM matches WHERE match_id = $1`, [matchId]);
    const start_time = startRes.rows[0]?.start_time || null;
    for (const res of tickerClients) {
      sseWrite(res, 'goal', { match_id: Number(matchId), start_time, blackGoals, orangeGoals, server_now: new Date().toISOString() });
    }
  }
}
async function broadcastTicker(matchId) {
  if (!tickerClients.size) return;
  if (!matchId) {
    for (const res of tickerClients) {
      sseWrite(res, 'inactive', { ts: Date.now() });
    }
    return;
  }
  const startRes = await query(`SELECT start_time, team_black_score, team_orange_score FROM matches WHERE match_id = $1`, [matchId]);
  const row = startRes.rows[0] || {};
  const countsRes = await query(
    `SELECT team_scored, COUNT(*) AS c FROM stats_log WHERE match_id = $1 AND event_type = 'goal' GROUP BY team_scored`,
    [matchId]
  );
  let blackGoals = 0;
  let orangeGoals = 0;
  for (const r of countsRes.rows) {
    if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
    if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
  }
  for (const res of tickerClients) {
    sseWrite(res, 'init', { match_id: Number(matchId), start_time: row.start_time, blackGoals, orangeGoals, server_now: new Date().toISOString() });
  }
}
async function broadcastFinish(matchId) {
  const list = sseClients.get(Number(matchId));
  if (!list || !list.size) return;
  const finRes = await query(`SELECT team_black_score, team_orange_score, status FROM matches WHERE match_id = $1`, [matchId]);
  const row = finRes.rows[0] || {};
  for (const res of list) {
    sseWrite(res, 'finish', { match_id: Number(matchId), status: row.status || 'finished', blackScore: Number(row.team_black_score || 0), orangeScore: Number(row.team_orange_score || 0) });
  }
}
// Ticker stream DEVE vir antes de '/:id/stream' para não colidir com 'ticker'
router.get('/ticker/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);
  tickerClients.add(res);
  try {
    const activeRes = await query(`SELECT match_id, start_time FROM matches WHERE status = 'in_progress' ORDER BY sunday_id DESC, match_number ASC LIMIT 1`);
    if (activeRes.rows.length) {
      const mid = activeRes.rows[0].match_id;
      await broadcastTicker(mid);
    } else {
      sseWrite(res, 'inactive', { ts: Date.now() });
    }
  } catch (e) {
    sseWrite(res, 'inactive', { ts: Date.now() });
  }
  const ping = setInterval(() => {
    sseWrite(res, 'ping', { ts: Date.now() });
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    tickerClients.delete(res);
    res.end();
  });
});
router.get('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const matchRes = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (matchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 3000\n\n`);
    let list = sseClients.get(Number(id));
    if (!list) {
      list = new Set();
      sseClients.set(Number(id), list);
    }
    list.add(res);
    const statsRes = await query(
      `SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, COALESCE(event_type, 'goal') AS event_type, created_at
       FROM stats_log WHERE match_id = $1 ORDER BY stat_id ASC`,
      [id]
    );
    let blackGoals = 0;
    let orangeGoals = 0;
    for (const ev of statsRes.rows) {
      if (ev.event_type === 'goal' && ev.team_scored === 'black') blackGoals++;
      if (ev.event_type === 'goal' && ev.team_scored === 'orange') orangeGoals++;
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
          SELECT team_scored
          FROM stats_log sl
          WHERE sl.match_id = m.match_id AND COALESCE(sl.event_type, 'goal') = 'tie_decider'
          ORDER BY sl.stat_id DESC
          LIMIT 1
        ) AS tie_decider_winner,
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
        gs.date as sunday_date,
        (
          SELECT team_scored
          FROM stats_log sl
          WHERE sl.match_id = m.match_id AND COALESCE(sl.event_type, 'goal') = 'tie_decider'
          ORDER BY sl.stat_id DESC
          LIMIT 1
        ) AS tie_decider_winner
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

    // Criar partida
    const result = await query(`
      INSERT INTO matches (
        sunday_id, 
        match_number, 
        team_orange_win_streak, 
        team_black_win_streak,
        status
      ) VALUES ($1, $2, 0, 0, 'scheduled')
      RETURNING *
    `, [sunday_id, match_number]);

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

  // Não resetar contadores aqui; a lógica de rotação/saída será aplicada abaixo com base no histórico

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

    // Determinar se o time vencedor anterior deve "sair" quando há muitos jogadores
    let selectedPlayers = players.slice();
    try {
      const winnersRes = await query(`
        SELECT match_id, winner_team
        FROM matches
        WHERE sunday_id = $1 AND match_number < $2 AND status = 'finished'
        ORDER BY match_number DESC
        LIMIT 3
      `, [match.sunday_id, match.match_number]);
      const winners = winnersRes.rows.map(r => r.winner_team).filter(w => w === 'black' || w === 'orange');
      const threeInRow =
        winners.length >= 3 && winners[0] === winners[1] && winners[1] === winners[2]
          ? winners[0]
          : null;
      const presentCount = players.length;
      if (threeInRow) {
        const lastMatchId = winnersRes.rows[0]?.match_id;
        if (lastMatchId) {
          const prevParts = await query(`
            SELECT player_id 
            FROM match_participants 
            WHERE match_id = $1 AND player_id IS NOT NULL
          `, [lastMatchId]);
          const benchIds = new Set(prevParts.rows.map(r => Number(r.player_id)));
          const filtered = selectedPlayers.filter(p => !benchIds.has(Number(p.player_id)));
          const needed = Math.min(selectedPlayers.length, maxPlayersPerTeam * 2);
          if (filtered.length >= needed) {
            selectedPlayers = filtered;
          }
        }
      }
    } catch {}
    // Aplicar embaralhamento leve considerando possíveis ajustes
    selectedPlayers = applyWinStreakRule(selectedPlayers, match.team_orange_win_streak);

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
    try { await broadcastTicker(id); } catch {}

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
  body('orange_team.*').isInt({ min: 1 }).withMessage('IDs do time laranja devem ser inteiros válidos'),
  body('prev_stay_team').optional().isIn(['black', 'orange']).withMessage('Time que permanece deve ser black ou orange')
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
    const { black_team, orange_team, prev_stay_team } = req.body;

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

    const winStreakRule = parseInt(process.env.WIN_STREAK_RULE) || 3;
    const mres = await query('SELECT team_orange_win_streak, team_black_win_streak, status FROM matches WHERE match_id = $1', [id]);
    const mrow = mres.rows[0] || {};
    if ((Number(mrow.team_orange_win_streak || 0) >= winStreakRule) || (Number(mrow.team_black_win_streak || 0) >= winStreakRule)) {
      await query(`UPDATE matches SET team_orange_win_streak = 0, team_black_win_streak = 0 WHERE match_id = $1`, [id]);
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

    try {
      const matchRow = matchResult.rows[0] || {};
      const prevRes = await query(`
        SELECT match_id, winner_team, team_black_win_streak, team_orange_win_streak
        FROM matches
        WHERE sunday_id = $1 AND match_number < $2 AND status = 'finished'
        ORDER BY match_number DESC
        LIMIT 1
      `, [matchRow.sunday_id, matchRow.match_number]);
      let nextBlackCounter = 0;
      let nextOrangeCounter = 0;
      if (prevRes.rows.length > 0) {
        const prev = prevRes.rows[0];
        
        // Buscar configuração do sistema para saber se a regra "sair os dois" está ativa
        const configRes = await query('SELECT many_present_rule_enabled FROM system_config ORDER BY config_id DESC LIMIT 1');
        const manyPresentRuleEnabled = configRes.rows.length > 0 ? configRes.rows[0].many_present_rule_enabled : false;

        const winnersRes = await query(`
          SELECT winner_team
          FROM matches
          WHERE sunday_id = $1 AND match_number < $2 AND status = 'finished'
          ORDER BY match_number DESC
          LIMIT 3
        `, [matchRow.sunday_id, matchRow.match_number]);
        const winners = winnersRes.rows.map(r => r.winner_team).filter(w => w === 'black' || w === 'orange');
        const threeInRow = winners.length >= 3 && winners[0] === winners[1] && winners[1] === winners[2] ? winners[0] : null;
        const blackPrevCounter = Number(prev.team_black_win_streak || 0);
        const orangePrevCounter = Number(prev.team_orange_win_streak || 0);
        
        let tieWinner = null;
        try {
          const tieRes = await query(`
            SELECT team_scored
            FROM stats_log
            WHERE match_id = $1 AND COALESCE(event_type, 'goal') = 'tie_decider'
            ORDER BY stat_id DESC
            LIMIT 1
          `, [prev.match_id]);
          if (tieRes.rows[0]?.team_scored) {
          const tw = tieRes.rows[0].team_scored;
          if (tw === 'black' || tw === 'orange') tieWinner = tw;
        }
      } catch {}
        
      const isDrawPrev = prev.winner_team === 'draw';
        if (isDrawPrev) {
          // Se manyPresentRuleEnabled for true, ambos saem independentemente do número de jogadores.
          // Se for false, respeita o vencedor do desempate (tieWinner).
          const ruleEnforcesBothLeave = manyPresentRuleEnabled;
          const tieWinnerCandidate = !ruleEnforcesBothLeave && (tieWinner === 'black' || tieWinner === 'orange') ? tieWinner : null;
          
          if (tieWinnerCandidate === 'black') {
            nextBlackCounter = (blackPrevCounter + 1 >= 3) ? 0 : (blackPrevCounter + 1);
            nextOrangeCounter = 0;
          } else if (tieWinnerCandidate === 'orange') {
            nextOrangeCounter = (orangePrevCounter + 1 >= 3) ? 0 : (orangePrevCounter + 1);
            nextBlackCounter = 0;
          } else {
            nextBlackCounter = 0;
            nextOrangeCounter = 0;
          }
        } else if (prev.winner_team === 'black' || prev.winner_team === 'orange') {
          // Se o time já tinha 2 vitórias (visual: 3 dots) e ganhou a terceira, zera (saiu).
          // Se não, incrementa (max 2 visualmente, mas backend armazena até resetar).
          if (prev.winner_team === 'black') {
            nextBlackCounter = (blackPrevCounter + 1 >= 3) ? 0 : (blackPrevCounter + 1);
            nextOrangeCounter = 0;
          } else {
            nextOrangeCounter = (orangePrevCounter + 1 >= 3) ? 0 : (orangePrevCounter + 1);
            nextBlackCounter = 0;
          }
        }
      }
      await query(`UPDATE matches SET team_black_win_streak = $1, team_orange_win_streak = $2 WHERE match_id = $3`, [nextBlackCounter, nextOrangeCounter, id]);
      try { await broadcastTicker(id); } catch {}
    } catch (e) {
      console.error('Erro ao calcular contadores de permanência:', e);
    }

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
  body('black_score').isInt({ min: 0 }).withMessage('Placar do time preto deve ser um número inteiro positivo'),
  body('played_ids').optional().isArray().withMessage('Lista de jogadores deve ser um array'),
  body('played_ids.*').optional().isInt({ min: 1 }).withMessage('IDs de jogadores devem ser inteiros válidos')
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
    const { orange_score, black_score, played_ids } = req.body;

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

    // Determinar vencedor
    let winner_team;
    if (orange_score > black_score) {
      winner_team = 'orange';
    } else if (black_score > orange_score) {
      winner_team = 'black';
    } else {
      winner_team = 'draw';
    }

    // Atualizar partida com placar informado
    await query(`
      UPDATE matches 
      SET 
        team_orange_score = $1,
        team_black_score = $2,
        winner_team = $3,
        status = 'finished',
        end_time = CURRENT_TIMESTAMP
      WHERE match_id = $4
    `, [orange_score, black_score, winner_team, id]);

    // Correção: sincronizar placar com eventos registrados (se houver divergência)
    try {
      const countsRes = await query(
        `SELECT team_scored, COUNT(*) AS c 
         FROM stats_log 
         WHERE match_id = $1 AND COALESCE(event_type, 'goal') = 'goal' 
         GROUP BY team_scored`,
        [id]
      );
      let blackGoals = 0;
      let orangeGoals = 0;
      for (const r of countsRes.rows) {
        if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
        if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
      }
      if (blackGoals !== Number(black_score) || orangeGoals !== Number(orange_score)) {
        const w =
          orangeGoals > blackGoals ? 'orange' :
          blackGoals > orangeGoals ? 'black' : 'draw';
        await query(`
          UPDATE matches 
          SET 
            team_orange_score = $1,
            team_black_score = $2,
            winner_team = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE match_id = $4
        `, [orangeGoals, blackGoals, w, id]);
      }
    } catch {}

    // Atualizar estatísticas dos jogadores
    await updatePlayerStats(id, Array.isArray(played_ids) ? Array.from(new Set(played_ids.map(Number).filter(n => Number.isFinite(n) && n > 0))) : undefined);

    res.json({
      message: 'Partida finalizada com sucesso',
      result: {
        winner: winner_team,
        orange_score,
        black_score,
        orange_win_streak: 0,
        black_win_streak: 0
      }
    });
    try { await broadcastTicker(null); } catch {}
    try { await broadcastFinish(id); } catch {}
    try {
      const row = matchResult.rows[0] || {};
      const sundayId = row.sunday_id;
      const sundayRes = await query('SELECT * FROM game_sundays WHERE sunday_id = $1', [sundayId]);
      const sunday = sundayRes.rows[0] || {};
      const attendancesRes = await query('SELECT * FROM attendances WHERE sunday_id = $1 ORDER BY arrival_order ASC, player_id ASC', [sundayId]);
      const matchesRes = await query('SELECT * FROM matches WHERE sunday_id = $1 ORDER BY match_number ASC', [sundayId]);
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
      const file = path.join(dir, `sunday_${sundayId}.json`);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(backup, null, 2), 'utf8');
    } catch {}

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
        INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, event_type)
        VALUES ($1, $2, $3, $4, $5, $6, 'goal')
        RETURNING *
      `, [id, scorer_id || null, assist_id || null, team_scored, goal_minute || null, !!is_own_goal]);
      inserted = ins.rows[0];
      const scoreCol = team_scored === 'orange' ? 'team_orange_score' : 'team_black_score';
      await client.query(`UPDATE matches SET ${scoreCol} = ${scoreCol} + 1, updated_at = CURRENT_TIMESTAMP WHERE match_id = $1`, [id]);
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

// Registrar substituição na partida
router.post('/:id/stats-substitution', [
  body('team').isIn(['orange', 'black']).withMessage('Time deve ser orange ou black'),
  body('out_id').isInt({ min: 1 }).withMessage('ID do jogador que sai inválido'),
  body('in_id').isInt({ min: 1 }).withMessage('ID do jogador que entra inválido'),
  body('minute').optional().isInt({ min: 0, max: 120 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Erro de validação', details: errors.array() });
    }
    const { id } = req.params;
    const { team, out_id, in_id, minute } = req.body;
    const matchResult = await query('SELECT * FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const teamParticipantsRes = await query(`
      SELECT player_id 
      FROM match_participants 
      WHERE match_id = $1 AND team = $2 AND player_id IS NOT NULL
    `, [id, team]);
    const teamIds = new Set(teamParticipantsRes.rows.map(r => r.player_id));
    if (!teamIds.has(Number(out_id))) {
      return res.status(400).json({ error: 'Jogador que sai não pertence ao time da partida' });
    }
    const playerExistsRes = await query(`SELECT player_id FROM players WHERE player_id = $1`, [in_id]);
    if (playerExistsRes.rows.length === 0) {
      return res.status(400).json({ error: 'Jogador que entra não existe' });
    }
    let inserted;
    await transaction(async (client) => {
      const ins = await client.query(`
        INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, event_type)
        VALUES ($1, $2, $3, $4, $5, $6, 'substitution')
        RETURNING *
      `, [id, in_id, out_id, team, minute || null, false]);
      inserted = ins.rows[0];
    });
    try {
      await broadcastGoal(id, inserted);
    } catch {}
    res.status(201).json({ message: 'Substituição registrada', stat: inserted });
  } catch (error) {
    console.error('Erro ao registrar substituição:', error);
    res.status(500).json({ error: 'Erro ao registrar substituição' });
  }
});

// Remover registro de gol/assistência (admin)
router.delete('/stats/:stat_id', async (req, res) => {
  try {
    const { stat_id } = req.params;
    const existing = await query(`
      SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, is_own_goal, COALESCE(event_type, 'goal') AS event_type
      FROM stats_log 
      WHERE stat_id = $1
    `, [stat_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    const row = existing.rows[0];
    await transaction(async (client) => {
      if (row.event_type === 'goal') {
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
        const scoreCol = row.team_scored === 'orange' ? 'team_orange_score' : 'team_black_score';
        await client.query(`UPDATE matches SET ${scoreCol} = GREATEST(${scoreCol} - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE match_id = $1`, [row.match_id]);
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
      SELECT stat_id, match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, COALESCE(event_type, 'goal') AS event_type, created_at
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

// Registrar vencedor do desempate (par/ímpar) para partidas empatadas
router.post('/:id/tie-decider', [
  body('winner').isIn(['orange', 'black']).withMessage('Vencedor deve ser orange ou black')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Erro de validação', details: errors.array() });
    }
    const { id } = req.params;
    const { winner } = req.body;
    const matchResult = await query('SELECT status, winner_team FROM matches WHERE match_id = $1', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const row = matchResult.rows[0];
    if (row.status !== 'finished') {
      return res.status(400).json({ error: 'Partida não está finalizada' });
    }
    if (row.winner_team !== 'draw') {
      // Permitir registrar apenas para partidas empatadas
      return res.status(400).json({ error: 'Desempate só é aplicável em partidas empatadas' });
    }
    await transaction(async (client) => {
      await client.query(`DELETE FROM stats_log WHERE match_id = $1 AND COALESCE(event_type, 'goal') = 'tie_decider'`, [id]);
      await client.query(`
        INSERT INTO stats_log (match_id, player_scorer_id, player_assist_id, team_scored, goal_minute, is_own_goal, event_type)
        VALUES ($1, NULL, NULL, $2, NULL, FALSE, 'tie_decider')
      `, [id, winner]);
    });
    res.status(201).json({ message: 'Vencedor do desempate registrado', winner });
  } catch (error) {
    console.error('Erro ao registrar vencedor do desempate:', error);
    res.status(500).json({ error: 'Erro ao registrar vencedor do desempate' });
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
async function updatePlayerStats(matchId, playedIds) {
  let ids = Array.isArray(playedIds) ? playedIds.filter(n => Number.isFinite(n) && n > 0) : undefined;
  if (!ids || ids.length === 0) {
    const participantsResult = await query(`
      SELECT 
        mp.player_id
      FROM match_participants mp
      WHERE mp.match_id = $1 AND mp.player_id IS NOT NULL
    `, [matchId]);
    ids = Array.from(new Set(participantsResult.rows.map(r => Number(r.player_id))));
  }
  const uniqueIds = Array.from(new Set((ids || []).map(Number).filter(n => Number.isFinite(n) && n > 0)));
  for (const pid of uniqueIds) {
    await query(`
      UPDATE players 
      SET 
        total_games_played = total_games_played + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE player_id = $1
    `, [pid]);
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
    console.error('Erro ao finalizar partida:', error);
    res.status(500).json({ 
      error: 'Erro ao finalizar partida',
      message: 'Não foi possível finalizar a partida'
    });
  }
});

// Ajustar placar de partida (admin) - histórico
router.post('/:id/adjust-score', requireAdmin, [
  body('orange_score').isInt({ min: 0 }).withMessage('Placar do time laranja deve ser inteiro >= 0'),
  body('black_score').isInt({ min: 0 }).withMessage('Placar do time preto deve ser inteiro >= 0')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Erro de validação', details: errors.array() });
    }
    const { id } = req.params;
    const { orange_score, black_score } = req.body;
    const matchRes = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (matchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const winner =
      Number(orange_score) > Number(black_score) ? 'orange' :
      Number(black_score) > Number(orange_score) ? 'black' : 'draw';
    await query(`
      UPDATE matches
      SET 
        team_orange_score = $1,
        team_black_score = $2,
        winner_team = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE match_id = $4
    `, [Number(orange_score), Number(black_score), winner, id]);
    try { await broadcastFinish(id); } catch {}
    res.json({ message: 'Placar ajustado com sucesso', match_id: Number(id), orange_score: Number(orange_score), black_score: Number(black_score), winner });
  } catch (error) {
    console.error('Erro ao ajustar placar:', error);
    res.status(500).json({ error: 'Erro ao ajustar placar' });
  }
});

// Sincronizar placar com eventos de gols (admin) - correção
router.post('/:id/sync-score', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const matchRes = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (matchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    const countsRes = await query(
      `SELECT team_scored, COUNT(*) AS c 
       FROM stats_log 
       WHERE match_id = $1 AND COALESCE(event_type, 'goal') = 'goal' 
       GROUP BY team_scored`,
      [id]
    );
    let blackGoals = 0;
    let orangeGoals = 0;
    for (const r of countsRes.rows) {
      if (r.team_scored === 'black') blackGoals = Number(r.c || 0);
      if (r.team_scored === 'orange') orangeGoals = Number(r.c || 0);
    }
    const winner =
      orangeGoals > blackGoals ? 'orange' :
      blackGoals > orangeGoals ? 'black' : 'draw';
    await query(`
      UPDATE matches
      SET 
        team_orange_score = $1,
        team_black_score = $2,
        winner_team = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE match_id = $4
    `, [orangeGoals, blackGoals, winner, id]);
    try { await broadcastFinish(id); } catch {}
    res.json({ message: 'Placar sincronizado com eventos', match_id: Number(id), orange_score: orangeGoals, black_score: blackGoals, winner });
  } catch (error) {
    console.error('Erro ao sincronizar placar:', error);
    res.status(500).json({ error: 'Erro ao sincronizar placar' });
  }
});

// Ajuste manual das sequências de vitórias (streaks)
router.post('/:id/win-streak', [
  // requireAdmin removido para permitir que usuários autenticados (mesmo não-admins) ajustem a sequência
  body('black').isInt({ min: 0 }).withMessage('Sequência do preto deve ser inteira e >= 0'),
  body('orange').isInt({ min: 0 }).withMessage('Sequência do laranja deve ser inteira e >= 0')
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
    const black = parseInt(req.body.black, 10);
    const orange = parseInt(req.body.orange, 10);
    const mres = await query('SELECT match_id FROM matches WHERE match_id = $1', [id]);
    if (mres.rows.length === 0) {
      return res.status(404).json({ error: 'Partida não encontrada' });
    }
    await query(`
      UPDATE matches
      SET 
        team_black_win_streak = $1,
        team_orange_win_streak = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE match_id = $3
    `, [black, orange, id]);
    try { await broadcastTicker(id); } catch {}
    return res.json({ message: 'Sequências atualizadas', streak: { black, orange }, match_id: Number(id) });
  } catch (error) {
    console.error('Erro ao atualizar sequências:', error);
    return res.status(500).json({ error: 'Erro ao atualizar sequências' });
  }
});

module.exports = router;
