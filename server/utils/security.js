const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SECRET_KEY_PATTERN = /(password|passphrase|token|secret|api[_-]?key|access[_-]?key|authorization|credential|cookie)/i;

function decodeRepeatedly(value) {
  let decoded = String(value);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error('Unsafe path: invalid encoding');
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function resolveWithinRoot(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const cleaned = segments.map((segment) => {
    const decoded = decodeRepeatedly(segment);
    if (decoded.includes('\0') || path.isAbsolute(decoded) || /^[a-zA-Z]:[\\/]/.test(decoded)) {
      throw new Error('Unsafe path: absolute paths are not allowed');
    }

    const normalized = decoded.replace(/\\/g, '/');
    if (normalized.split('/').some((part) => part === '..')) {
      throw new Error('Unsafe path: traversal is not allowed');
    }
    return normalized;
  });

  const resolved = path.resolve(absoluteRoot, ...cleaned);
  if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error('Unsafe path: target escapes storage root');
  }
  return resolved;
}

function sanitizeDisplayName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.length > 255 || value === '.' || value === '..' || /[\\/\0\r\n]/.test(value)) {
    throw new Error('Invalid file name');
  }
  return value;
}

function createOpaqueTempPath(root, _originalName, extension = '') {
  const safeExtension = /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : '';
  return resolveWithinRoot(root, `${randomUUID()}${safeExtension}`);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 1) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function extractSessionToken(req) {
  const cookies = parseCookies(req?.headers?.cookie);
  return cookies.jcc_session || null;
}

function redactSecrets(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(item, seen),
  ]));
}

function maskSecretConfigs(configs) {
  return Object.fromEntries(Object.entries(configs).map(([key, config]) => {
    if (!SECRET_KEY_PATTERN.test(key)) return [key, config];
    const configured = Boolean(config?.value);
    return [key, { ...config, value: configured ? '[REDACTED]' : '', configured }];
  }));
}

function validateIdempotencyKey(value) {
  if (value == null || value === '') return null;
  const key = String(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('Invalid idempotency key');
  return key;
}

module.exports = {
  createOpaqueTempPath,
  extractSessionToken,
  maskSecretConfigs,
  parseCookies,
  redactSecrets,
  resolveWithinRoot,
  sanitizeDisplayName,
  validateIdempotencyKey,
};
