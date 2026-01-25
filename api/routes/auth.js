const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateMasterPassword, generateToken } = require('../middleware/auth');

const router = express.Router();

// Login com senha mestra
router.post('/login', [
  body('password').notEmpty().withMessage('Senha é obrigatória')
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

    const { password } = req.body;

    // Verificar senha com prioridade: MASTERNAUTICO (admin) > NAUTICO (usuário) > banco (admin)
    let role = 'user';
    let isValid = false;
    const norm = typeof password === 'string' ? password.trim().toUpperCase() : '';
    if (norm === 'MASTERNAUTICO') {
      isValid = true;
      role = 'admin';
    } else if (norm === 'NAUTICO') {
      isValid = true;
      role = 'user';
    } else {
      const isMaster = await authenticateMasterPassword(password);
      if (isMaster) {
        isValid = true;
        role = 'admin';
      }
    }

    if (!isValid) {
      console.error('Tentativa de login com senha inválida');
      return res.status(401).json({ 
        error: 'Senha inválida',
        message: 'A senha fornecida está incorreta'
      });
    }

    // Criar usuário de sessão
    const user = {
      id: 1,
      username: 'admin',
      role
    };

    // Gerar token JWT
    const token = generateToken(user);

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        username: user.username,
        role: user.role
      },
      expiresIn: `${process.env.SESSION_DURATION_MINUTES || 120}m`
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: 'Não foi possível processar o login'
    });
  }
});

// Verificar token (para validar sessão)
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        valid: false,
        error: 'Token não fornecido' 
      });
    }

    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.json({ 
          valid: false,
          error: 'Token inválido ou expirado' 
        });
      }
      
      res.json({ 
        valid: true,
        user: {
          username: user.username,
          role: user.role
        }
      });
    });

  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({ 
      valid: false,
      error: 'Erro ao verificar token' 
    });
  }
});

// Logout (opcional - no frontend, apenas remover o token)
router.post('/logout', (req, res) => {
  res.json({ 
    message: 'Logout realizado com sucesso',
    note: 'Remova o token do cliente'
  });
});

// Obter configurações do sistema
router.get('/config', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        match_duration_minutes,
        max_players_per_team,
        session_duration_minutes,
        many_present_rule_enabled
      FROM system_config 
      ORDER BY config_id DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Configurações do sistema não encontradas' 
      });
    }

    res.json({
      matchDuration: result.rows[0].match_duration_minutes,
      maxPlayersPerTeam: result.rows[0].max_players_per_team,
      sessionDuration: result.rows[0].session_duration_minutes,
      manyPresentRuleEnabled: result.rows[0].many_present_rule_enabled
    });

  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar configurações do sistema' 
    });
  }
});

// Atualizar configurações do sistema (Requer Admin)
router.put('/config', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });

    const jwt = require('jsonwebtoken');
    let userRole = 'user';
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userRole = decoded.role;
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Verificação de role removida para permitir que usuários autenticados (mesmo não-admins)
    // possam alterar a regra de "sair os dois", já que isso faz parte da dinâmica do jogo.
    /*
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    */

    const { many_present_rule_enabled } = req.body;

    // Se o valor foi fornecido, atualiza
    if (typeof many_present_rule_enabled !== 'undefined') {
      await query(`
        UPDATE system_config 
        SET many_present_rule_enabled = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE config_id = (SELECT config_id FROM system_config ORDER BY config_id DESC LIMIT 1)
      `, [!!many_present_rule_enabled]);
    }

    res.json({ message: 'Configuração atualizada com sucesso' });

  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

module.exports = router;
