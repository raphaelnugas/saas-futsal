const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  if (!token && req.query && typeof req.query.token === 'string') {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
};

// Verificar senha mestra
const authenticateMasterPassword = async (password) => {
  try {
    const cfg = await query(
      'SELECT config_id, master_password_hash, updated_at FROM system_config ORDER BY updated_at DESC, config_id DESC LIMIT 1'
    );
    if (cfg.rows.length === 0) {
      logger.error('Senha mestra não encontrada em system_config', {});
      return false;
    }
    const { config_id, master_password_hash } = cfg.rows[0];
    const ok = await bcrypt.compare(password, master_password_hash);

    // Fallback: manter senha 'NAUTICO' sempre válida
    if (!ok && password === 'NAUTICO') {
      const hash = await bcrypt.hash('NAUTICO', 10);
      try {
        await query('UPDATE system_config SET master_password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE config_id = $2', [hash, config_id]);
        logger.info('Senha mestra ajustada para NAUTICO via login', { config_id });
        return true;
      } catch (e) {
        logger.error('Falha ao ajustar senha mestra via login', { error: e.message });
        return false;
      }
    }

    return ok;
  } catch (error) {
    logger.error('Erro ao verificar senha mestra', { error: error.message });
    return false;
  }
};

// Gerar token JWT
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username,
      role: user.role || 'user'
    },
    process.env.JWT_SECRET,
    { expiresIn: `${process.env.SESSION_DURATION_MINUTES || 120}m` }
  );
};

// Middleware para verificar se é administrador
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
  }
};

module.exports = {
  authenticateToken,
  authenticateMasterPassword,
  generateToken,
  requireAdmin
};
