const { redactSecrets } = require('./security');

const ALLOWED_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'SUCCESS']);

function normalizeFrontendLog(input) {
  const level = String(input?.level || '').toUpperCase();
  if (!ALLOWED_LEVELS.has(level)) throw new Error('Invalid log level');

  const module = String(input?.module || '').toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(module)) throw new Error('Invalid log module');

  const message = String(input?.message || '').replace(/[\r\n]/g, ' ');
  if (!message || message.length > 2000) throw new Error('Invalid log message');

  const data = redactSecrets(input?.data ?? null);
  if (Buffer.byteLength(JSON.stringify(data)) > 8192) throw new Error('Log data is too large');
  return { level, module, message, data };
}

module.exports = { normalizeFrontendLog };
