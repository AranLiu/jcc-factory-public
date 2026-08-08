const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  extractSessionToken,
  resolveWithinRoot,
  createOpaqueTempPath,
  sanitizeDisplayName,
  redactSecrets,
  maskSecretConfigs,
  validateIdempotencyKey,
} = require('../utils/security');
const { validateDatabaseEnv, validateMinioEnv, validateRuntimeEnv } = require('../config/env');
const {
  clearSessionCookieOptions,
  isCsrfRequestAllowed,
  SESSION_TTL_SECONDS,
  sessionCookieOptions
} = require('../utils/sessionSecurity');

test('extractSessionToken accepts only the HttpOnly session cookie', () => {
  assert.equal(extractSessionToken({ headers: { cookie: 'jcc_session=cookie-token; theme=dark' }, query: {} }), 'cookie-token');
  assert.equal(extractSessionToken({ headers: { authorization: 'Bearer leaked-token' }, query: {} }), null);
  assert.equal(extractSessionToken({ headers: {}, query: { token: 'url-token' } }), null);
});

test('resolveWithinRoot rejects traversal, absolute paths, and double encoding', () => {
  const root = path.resolve('sandbox-root');
  assert.equal(resolveWithinRoot(root, 'documents', 'safe.json'), path.join(root, 'documents', 'safe.json'));
  for (const candidate of ['../secret', '..\\secret', 'C:\\secret', '%252e%252e%252fsecret']) {
    assert.throws(() => resolveWithinRoot(root, candidate), /unsafe path/i);
  }
});

test('createOpaqueTempPath never includes the user supplied file name', () => {
  const root = path.resolve('temp-root');
  const result = createOpaqueTempPath(root, '../../server.js', '.mp4');
  assert.equal(path.dirname(result), root);
  assert.equal(path.extname(result), '.mp4');
  assert.equal(result.includes('server.js'), false);
});

test('sanitizeDisplayName preserves Chinese text and removes path syntax', () => {
  assert.equal(sanitizeDisplayName('  第一集.mp4  '), '第一集.mp4');
  assert.throws(() => sanitizeDisplayName('../第一集.mp4'), /invalid file name/i);
  assert.throws(() => sanitizeDisplayName('folder\\第一集.mp4'), /invalid file name/i);
});

test('redactSecrets recursively masks secret-like fields', () => {
  const value = redactSecrets({ apiKey: 'abc', nested: { password: 'p', harmless: 'ok' }, token: 'jwt' });
  assert.deepEqual(value, { apiKey: '[REDACTED]', nested: { password: '[REDACTED]', harmless: 'ok' }, token: '[REDACTED]' });
});

test('maskSecretConfigs makes secret configuration values write-only', () => {
  assert.deepEqual(maskSecretConfigs({
    gemini_api_key: { value: 'secret', description: 'key' },
    gemini_default_model: { value: 'model-1' },
  }), {
    gemini_api_key: { value: '[REDACTED]', description: 'key', configured: true },
    gemini_default_model: { value: 'model-1' },
  });
});

test('validateIdempotencyKey accepts bounded opaque values only', () => {
  assert.equal(validateIdempotencyKey('task_123-abc'), 'task_123-abc');
  assert.equal(validateIdempotencyKey(undefined), null);
  assert.throws(() => validateIdempotencyKey('../bad'), /idempotency/i);
  assert.throws(() => validateIdempotencyKey('x'.repeat(129)), /idempotency/i);
});

test('validateRuntimeEnv rejects missing or placeholder credentials', () => {
  const valid = {
    NODE_ENV: 'test',
    JWT_SECRET: 'a-secure-random-secret-with-at-least-32-characters',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'app',
    DB_PASSWORD: 'database-secret',
    DB_NAME: 'jcc_factory',
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_PORT: '9000',
    MINIO_USE_SSL: 'false',
    MINIO_ACCESS_KEY: 'minio-user',
    MINIO_SECRET_KEY: 'minio-secret',
    MINIO_BUCKET: 'jcc-factory',
  };

  assert.equal(validateRuntimeEnv(valid).db.port, 3306);
  assert.equal(validateDatabaseEnv(valid).database, 'jcc_factory');
  assert.equal(validateMinioEnv(valid).bucket, 'jcc-factory');
  assert.throws(() => validateRuntimeEnv({ ...valid, JWT_SECRET: '' }), /JWT_SECRET/);
  assert.throws(() => validateRuntimeEnv({ ...valid, DB_PASSWORD: 'changeme' }), /DB_PASSWORD/);
  assert.throws(() => validateRuntimeEnv({ ...valid, MINIO_SECRET_KEY: 'your_secret_here' }), /MINIO_SECRET_KEY/);
  assert.throws(() => validateRuntimeEnv({ ...valid, NODE_ENV: 'production', ALLOWED_ORIGINS: '' }), /ALLOWED_ORIGINS/);
  assert.equal(validateRuntimeEnv({
    ...valid,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://app.example.com',
  }).allowedOrigins[0], 'https://app.example.com');
  assert.throws(() => validateRuntimeEnv({
    ...valid,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'http://app.example.com',
  }), /HTTPS|ALLOWED_ORIGINS/);
  assert.throws(() => validateRuntimeEnv({
    ...valid,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://app.example.com',
    SESSION_COOKIE_SECURE: 'false',
  }), /SESSION_COOKIE_SECURE/);
  assert.equal(validateRuntimeEnv({
    ...valid,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'http://127.0.0.1:8080',
    SESSION_COOKIE_SECURE: 'false',
  }).cookieSecure, false);
});

test('isCsrfRequestAllowed requires matching cookie/header and an allowed origin for mutations', () => {
  const allowedOrigins = new Set(['https://app.example.com']);
  assert.equal(isCsrfRequestAllowed({ method: 'GET', headers: {} }, allowedOrigins), true);
  assert.equal(isCsrfRequestAllowed({
    method: 'POST',
    headers: { origin: 'https://app.example.com', cookie: 'jcc_csrf=abc', 'x-csrf-token': 'abc' },
  }, allowedOrigins), true);
  assert.equal(isCsrfRequestAllowed({
    method: 'POST',
    headers: { origin: 'https://evil.example', cookie: 'jcc_csrf=abc', 'x-csrf-token': 'abc' },
  }, allowedOrigins), false);
  assert.equal(isCsrfRequestAllowed({
    method: 'DELETE',
    headers: { origin: 'https://app.example.com', cookie: 'jcc_csrf=abc', 'x-csrf-token': 'different' },
  }, allowedOrigins), false);
});

test('session lifetime covers a full desktop workday and cookie security stays strict', () => {
  assert.equal(SESSION_TTL_SECONDS, 12 * 60 * 60);
  assert.deepEqual(sessionCookieOptions('production'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
  assert.equal(sessionCookieOptions('development').secure, false);
  assert.equal(sessionCookieOptions('production', 'false').secure, false);
  assert.equal(sessionCookieOptions('production', 'true').secure, true);
  assert.throws(() => sessionCookieOptions('production', 'sometimes'), /SESSION_COOKIE_SECURE/);
});

test('clearSessionCookieOptions omits maxAge while preserving cookie scope', () => {
  const options = clearSessionCookieOptions('production');
  assert.equal(options.maxAge, undefined);
  assert.equal(options.secure, true);
  assert.equal(options.path, '/');
});
