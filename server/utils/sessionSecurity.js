const { timingSafeEqual } = require('node:crypto');
const { parseCookies } = require('./security');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isCsrfRequestAllowed(req, allowedOrigins) {
  if (SAFE_METHODS.has(String(req.method).toUpperCase())) return true;
  const origin = req.headers?.origin;
  if (!origin || !allowedOrigins.has(origin)) return false;
  const cookies = parseCookies(req.headers?.cookie);
  return safeEqual(cookies.jcc_csrf, req.headers?.['x-csrf-token']);
}

function resolveCookieSecure(
  nodeEnv = process.env.NODE_ENV,
  configured = process.env.SESSION_COOKIE_SECURE
) {
  if (configured == null || String(configured).trim() === '') return nodeEnv === 'production';
  if (configured === true || configured === 'true') return true;
  if (configured === false || configured === 'false') return false;
  throw new Error('SESSION_COOKIE_SECURE must be true or false');
}

function sessionCookieOptions(nodeEnv = process.env.NODE_ENV, configuredSecure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveCookieSecure(nodeEnv, configuredSecure),
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

function csrfCookieOptions(nodeEnv = process.env.NODE_ENV) {
  const { maxAge, path, sameSite, secure } = sessionCookieOptions(nodeEnv);
  return { httpOnly: false, maxAge, path, sameSite, secure };
}

function clearSessionCookieOptions(nodeEnv = process.env.NODE_ENV) {
  const { maxAge, ...options } = sessionCookieOptions(nodeEnv);
  return options;
}

function clearCsrfCookieOptions(nodeEnv = process.env.NODE_ENV) {
  const { maxAge, ...options } = csrfCookieOptions(nodeEnv);
  return options;
}

module.exports = {
  clearCsrfCookieOptions,
  clearSessionCookieOptions,
  csrfCookieOptions,
  isCsrfRequestAllowed,
  resolveCookieSecure,
  SESSION_TTL_SECONDS,
  sessionCookieOptions
};
