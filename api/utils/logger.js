const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
}

function format(level, message, context = {}) {
  const ts = new Date().toISOString();
  return `${ts} ${level.toUpperCase()} ${message} ${JSON.stringify(context)}`;
}

function write(line) {
  ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', { encoding: 'utf8' });
  } catch {}
}

const logger = {
  info(message, context) {
    const line = format('info', message, context);
    console.log(line);
    write(line);
  },
  warn(message, context) {
    const line = format('warn', message, context);
    console.warn(line);
    write(line);
  },
  error(message, context) {
    const line = format('error', message, context);
    console.error(line);
    write(line);
  },
};

module.exports = logger;