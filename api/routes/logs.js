const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/', (req, res) => {
  const { level = 'error', message = 'client_log', context = {} } = req.body || {};
  const payload = { ...context, requestId: req.id };
  if (level === 'info') logger.info(message, payload);
  else if (level === 'warn') logger.warn(message, payload);
  else logger.error(message, payload);
  res.json({ status: 'logged', requestId: req.id });
});

module.exports = router;