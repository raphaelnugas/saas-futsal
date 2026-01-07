const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const logger = require('./utils/logger');
const requestId = require('./middleware/requestId');
const { query } = require('./config/database');
const { authenticateToken } = require('./middleware/auth');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const playersRoutes = require('./routes/players');
const matchesRoutes = require('./routes/matches');
const sundaysRoutes = require('./routes/sundays');
const statsRoutes = require('./routes/stats');
const logsRoutes = require('./routes/logs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Reconhecer IP real por trás de proxy reverso (Nginx/Apache)
app.set('trust proxy', 1);

// Fallback para JWT_SECRET em ambientes de desenvolvimento
if (!process.env.JWT_SECRET || typeof process.env.JWT_SECRET !== 'string' || !process.env.JWT_SECRET.trim()) {
  process.env.JWT_SECRET = 'nautico-dev-local-secret';
  logger.warn('JWT_SECRET ausente; aplicando fallback de desenvolvimento');
}

// Configuração de CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

// Rate limiting
const isProd = (process.env.NODE_ENV === 'production');
const limiter = rateLimit({
  windowMs: isProd ? (15 * 60 * 1000) : (60 * 60 * 1000),
  max: isProd ? 100 : 1000,
  message: 'Muitas requisições deste IP, tente novamente mais tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use((req, res, next) => {
  const p = req.path || '';
  if (/^\/api\/matches\/\d+\/stream$/.test(p)) return next();
  if (p === '/api/matches/ticker/stream') return next();
  if (/^\/api\/matches\/\d+\/stats$/.test(p)) return next();
  if (p === '/api/matches' && (req.query?.status === 'in_progress')) return next();
  if (p.startsWith('/assets/')) return next();
  if (p.startsWith('/players/') && (p.endsWith('/photo') || p.endsWith('/photo2'))) return next();
  if (p.startsWith('/logs')) return next();
  if (p.startsWith('/api/auth/login') || p.startsWith('/api/auth/verify') || p.startsWith('/api/auth/config')) return next();
  return limiter(req, res, next);
});

// Middlewares
app.use(requestId());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    requestId: req.id
  });
});

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/sundays', sundaysRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/logs', logsRoutes);

// Cache em memória para assets
let CARD_GOLD_CACHE = { mime: null, data: null };
async function ensureCardGoldInDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS system_assets (
      asset_key VARCHAR(100) PRIMARY KEY,
      asset_mime VARCHAR(100) NOT NULL,
      asset_data BYTEA NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const existing = await query('SELECT asset_mime, asset_data FROM system_assets WHERE asset_key = $1', ['CARD_GOLD']);
  if (existing.rows.length === 0) {
    const buffer = fs.readFileSync('c:\\Futsal\\FutsalNautico\\database\\CARD_GOLD.png');
    await query('INSERT INTO system_assets (asset_key, asset_mime, asset_data) VALUES ($1, $2, $3)', ['CARD_GOLD', 'image/png', buffer]);
    return { mime: 'image/png', data: buffer };
  }
  return { mime: existing.rows[0].asset_mime, data: existing.rows[0].asset_data };
}

// Endpoint estável para servir o template da carta com cache
app.get('/api/assets/card-gold', authenticateToken, async (req, res) => {
  try {
    if (!CARD_GOLD_CACHE.mime || !CARD_GOLD_CACHE.data) {
      const loaded = await ensureCardGoldInDb();
      CARD_GOLD_CACHE = loaded;
    }
    res.set('Content-Type', CARD_GOLD_CACHE.mime || 'image/png');
    res.send(CARD_GOLD_CACHE.data);
  } catch (error) {
    logger.error('Erro ao servir /api/assets/card-gold', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao obter template da carta' });
  }
});

let RULES_PDF_CACHE = { mime: 'application/pdf', data: null };
app.get('/api/assets/rules', authenticateToken, async (req, res) => {
  try {
    if (!RULES_PDF_CACHE.data) {
      const explicit = process.env.RULES_PDF_PATH;
      const defaultPath = path.resolve(__dirname, '..', 'Pelada de Domingo no Náutico.pdf');
      const filePath = explicit && explicit.trim() ? explicit.trim() : defaultPath;
      const data = await fs.promises.readFile(filePath);
      RULES_PDF_CACHE = { mime: 'application/pdf', data };
    }
    res.set('Content-Type', RULES_PDF_CACHE.mime || 'application/pdf');
    res.send(RULES_PDF_CACHE.data);
  } catch (error) {
    logger.error('Erro ao servir /api/assets/rules', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Erro ao obter documento de regras' });
  }
});

// Endpoints de texto/HTML removidos para manter apenas a leitura do PDF original

// Rota 404
app.use('*', (req, res) => {
  logger.warn('Rota 404', { path: req.originalUrl, method: req.method, requestId: req.id });
  res.status(404).json({ 
    error: 'Rota não encontrada',
    path: req.originalUrl,
    method: req.method,
    requestId: req.id
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Erro middleware', { message: err.message, stack: err.stack, path: req.originalUrl, method: req.method, requestId: req.id });
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      error: 'Erro de validação',
      details: err.message
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ 
      error: 'Não autorizado',
      details: 'Token inválido ou expirado'
    });
  }
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Erro ao processar requisição',
    requestId: req.id
  });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Servidor iniciado', { port: PORT, env: process.env.NODE_ENV || 'development', db: process.env.DB_NAME });
  
  (async () => {
    try {
      const res = await query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'players'
      `);
      const cols = res.rows.map(r => r.column_name);
      const adds = [];
      if (!cols.includes('photo_data')) adds.push(`ADD COLUMN photo_data BYTEA NULL`);
      if (!cols.includes('photo_mime')) adds.push(`ADD COLUMN photo_mime VARCHAR(100) NULL`);
      if (!cols.includes('photo2_data')) adds.push(`ADD COLUMN photo2_data BYTEA NULL`);
      if (!cols.includes('photo2_mime')) adds.push(`ADD COLUMN photo2_mime VARCHAR(100) NULL`);
      if (!cols.includes('dominant_foot')) adds.push(`ADD COLUMN dominant_foot VARCHAR(10) NULL`);
      if (!cols.includes('height_cm')) adds.push(`ADD COLUMN height_cm INTEGER NULL`);
      if (!cols.includes('birthdate')) adds.push(`ADD COLUMN birthdate DATE NULL`);
      if (!cols.includes('attr_ofe')) adds.push(`ADD COLUMN attr_ofe INTEGER DEFAULT 50`);
      if (!cols.includes('attr_def')) adds.push(`ADD COLUMN attr_def INTEGER DEFAULT 50`);
      if (!cols.includes('attr_vel')) adds.push(`ADD COLUMN attr_vel INTEGER DEFAULT 50`);
      if (!cols.includes('attr_tec')) adds.push(`ADD COLUMN attr_tec INTEGER DEFAULT 50`);
      if (!cols.includes('attr_for')) adds.push(`ADD COLUMN attr_for INTEGER DEFAULT 50`);
      if (!cols.includes('attr_pot')) adds.push(`ADD COLUMN attr_pot INTEGER DEFAULT 50`);
      if (adds.length) {
        await query(`ALTER TABLE players ${adds.join(', ')}`);
      }
      logger.info('Verificação de colunas players concluída', { added: adds.length });

      try {
        const statsColsRes = await query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'stats_log'
        `);
        const sCols = statsColsRes.rows.map(r => r.column_name);
        const sAdds = [];
        if (!sCols.includes('event_type')) {
          sAdds.push(`ADD COLUMN event_type VARCHAR(20) DEFAULT 'goal'`);
        }
        if (sAdds.length) {
          await query(`ALTER TABLE stats_log ${sAdds.join(', ')}`);
          logger.info('Coluna event_type adicionada em stats_log');
        } else {
          logger.info('Coluna event_type já existe em stats_log');
        }
      } catch (err) {
        logger.error('Falha ao verificar/adicionar colunas em stats_log', { error: err.message });
      }

      try {
        const cfg = await query(`SELECT config_id, master_password_hash FROM system_config ORDER BY config_id DESC LIMIT 1`);
        const desired = 'MASTERNAUTICO';
        if (cfg.rows.length === 0) {
          const hash = await bcrypt.hash(desired, 10);
          await query(
            `INSERT INTO system_config (master_password_hash, session_duration_minutes, match_duration_minutes, max_players_per_team) 
             VALUES ($1, $2, $3, $4)`,
            [hash, 120, 10, 5]
          );
          logger.info('Senha mestra inicial definida', { value: 'MASTERNAUTICO' });
        } else {
          const current = cfg.rows[0].master_password_hash;
          const ok = await bcrypt.compare(desired, current);
          if (!ok) {
            const hash = await bcrypt.hash(desired, 10);
            await query(`UPDATE system_config SET master_password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE config_id = $2`, [hash, cfg.rows[0].config_id]);
            logger.info('Senha mestra atualizada', { value: 'MASTERNAUTICO' });
          } else {
            logger.info('Senha mestra já está configurada', { value: 'MASTERNAUTICO' });
          }
        }
      } catch (err) {
        logger.error('Falha ao garantir senha mestra', { error: err.message });
      }
    } catch (err) {
      logger.error('Falha ao verificar/adicionar colunas players', { error: err.message });
    }
  })();
});

module.exports = app;
