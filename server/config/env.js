const PLACEHOLDER_PATTERN = /^(changeme|password|secret|your[_-].*|example|replace[_-].*)$/i;

function requireCredential(env, name, { minLength = 1 } = {}) {
  const value = String(env[name] ?? '').trim();
  if (!value || value.length < minLength || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`Missing or insecure required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in environment variable: ${name}`);
  }
  return port;
}

function parseBoolean(value, name) {
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Invalid boolean in environment variable: ${name}`);
  }
  return value === 'true';
}

function parseAllowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (env.NODE_ENV === 'production' && configured.length === 0) {
    throw new Error('Missing required environment variable: ALLOWED_ORIGINS');
  }
  for (const origin of configured) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Invalid origin in ALLOWED_ORIGINS: ${origin}`);
    }
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (env.NODE_ENV === 'production'
      && url.protocol !== 'https:'
      && !loopbackHosts.has(url.hostname.toLowerCase())) {
      throw new Error(`Production ALLOWED_ORIGINS must use HTTPS: ${origin}`);
    }
  }
  return configured;
}

function parseCookieSecure(env, allowedOrigins) {
  const configured = String(env.SESSION_COOKIE_SECURE ?? '').trim();
  const secure = configured === '' ? env.NODE_ENV === 'production' : parseBoolean(configured, 'SESSION_COOKIE_SECURE');
  if (env.NODE_ENV === 'production' && !secure) {
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const onlyLoopback = allowedOrigins.length > 0
      && allowedOrigins.every(origin => loopbackHosts.has(new URL(origin).hostname.toLowerCase()));
    if (!onlyLoopback) {
      throw new Error('SESSION_COOKIE_SECURE=false is allowed only for loopback origins');
    }
  }
  return secure;
}

function validateDatabaseEnv(env = process.env) {
  return {
      host: requireCredential(env, 'DB_HOST'),
      port: parsePort(env.DB_PORT || '3306', 'DB_PORT'),
      user: requireCredential(env, 'DB_USER'),
      password: requireCredential(env, 'DB_PASSWORD'),
      database: requireCredential(env, 'DB_NAME'),
  };
}

function validateMinioEnv(env = process.env) {
  return {
      endPoint: requireCredential(env, 'MINIO_ENDPOINT'),
      port: parsePort(env.MINIO_PORT || '9000', 'MINIO_PORT'),
      useSSL: parseBoolean(env.MINIO_USE_SSL, 'MINIO_USE_SSL'),
      accessKey: requireCredential(env, 'MINIO_ACCESS_KEY'),
      secretKey: requireCredential(env, 'MINIO_SECRET_KEY'),
      bucket: requireCredential(env, 'MINIO_BUCKET'),
      region: env.MINIO_REGION || 'us-east-1',
  };
}

function validateRuntimeEnv(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env);
  return {
    nodeEnv: env.NODE_ENV || 'development',
    allowedOrigins,
    cookieSecure: parseCookieSecure(env, allowedOrigins),
    jwtSecret: requireCredential(env, 'JWT_SECRET', { minLength: 32 }),
    db: validateDatabaseEnv(env),
    minio: validateMinioEnv(env),
  };
}

module.exports = { parseAllowedOrigins, validateDatabaseEnv, validateMinioEnv, validateRuntimeEnv };
