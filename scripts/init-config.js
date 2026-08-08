const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function buildLocalConfig(options = {}) {
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const randomBase64Url = (byteLength) => randomBytes(byteLength).toString('base64url');
  const databaseName = 'jcc_factory';
  const databaseUser = `jcc_${randomBytes(10).toString('hex')}`;
  const databasePassword = randomBase64Url(24);
  const databaseRootPassword = randomBase64Url(24);
  const objectStorageUser = `jcc${randomBytes(7).toString('hex')}`;
  const objectStoragePassword = randomBase64Url(24);
  const jwtSecret = randomBase64Url(32);

  const rootEnv = [
    '# Local Docker Compose configuration. Do not commit this file.',
    `MYSQL_DATABASE=${databaseName}`,
    `MYSQL_USER=${databaseUser}`,
    `MYSQL_PASSWORD=${databasePassword}`,
    `MYSQL_ROOT_PASSWORD=${databaseRootPassword}`,
    `OBJECT_STORAGE_ACCESS_KEY=${objectStorageUser}`,
    `OBJECT_STORAGE_SECRET_KEY=${objectStoragePassword}`,
    'OBJECT_STORAGE_BUCKET=jcc-factory',
    `JWT_SECRET=${jwtSecret}`,
    'AUTO_PROVISION_ADMIN=false',
    'ADMIN_USERNAME=',
    'ADMIN_PASSWORD=',
    'GEMINI_API_KEY=',
    'GEMINI_DEFAULT_MODEL=',
    'AI_PROVIDER_TIMEOUT_MS=180000',
    'SESSION_COOKIE_SECURE=false',
    '',
  ].join('\n');

  const serverEnv = [
    '# Local host development configuration. Do not commit this file.',
    'DB_HOST=127.0.0.1',
    'DB_PORT=3306',
    `DB_USER=${databaseUser}`,
    `DB_PASSWORD=${databasePassword}`,
    `DB_NAME=${databaseName}`,
    'MINIO_ENDPOINT=127.0.0.1',
    'MINIO_PORT=8333',
    'MINIO_USE_SSL=false',
    `MINIO_ACCESS_KEY=${objectStorageUser}`,
    `MINIO_SECRET_KEY=${objectStoragePassword}`,
    'MINIO_BUCKET=jcc-factory',
    `JWT_SECRET=${jwtSecret}`,
    'AUTO_PROVISION_ADMIN=false',
    'ADMIN_USERNAME=',
    'ADMIN_PASSWORD=',
    'GEMINI_API_KEY=',
    'GEMINI_DEFAULT_MODEL=',
    'AI_PROVIDER_TIMEOUT_MS=180000',
    'SESSION_COOKIE_SECURE=false',
    'PORT=8080',
    'NODE_ENV=development',
    'ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080',
    '',
  ].join('\n');

  return { rootEnv, serverEnv };
}

function writeLocalConfig({ rootDir = path.resolve(__dirname, '..'), force = false } = {}) {
  const rootEnvPath = path.join(rootDir, '.env');
  const serverEnvPath = path.join(rootDir, 'server', '.env');
  const secretFiles = [rootEnvPath, serverEnvPath];

  if (force !== true) {
    const existingFile = secretFiles.find((filePath) => fs.existsSync(filePath));
    if (existingFile) {
      throw new Error(`Secret file already exists: ${existingFile}. Re-run with force: true.`);
    }
  }

  const { rootEnv, serverEnv } = buildLocalConfig();
  fs.mkdirSync(path.dirname(serverEnvPath), { recursive: true });
  fs.writeFileSync(rootEnvPath, rootEnv, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(serverEnvPath, serverEnv, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(rootEnvPath, 0o600);
  fs.chmodSync(serverEnvPath, 0o600);

  return { created: secretFiles };
}

function ensureLocalConfigPair({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const rootEnvPath = path.join(rootDir, '.env');
  const serverEnvPath = path.join(rootDir, 'server', '.env');
  const secretFiles = [rootEnvPath, serverEnvPath];
  const existingFiles = secretFiles.filter((filePath) => fs.existsSync(filePath));

  if (existingFiles.length === secretFiles.length) {
    const rootConfig = fs.readFileSync(rootEnvPath, 'utf8');
    const configured = new Map(
      rootConfig.split(/\r?\n/).flatMap((line) => {
        if (!line || line.startsWith('#')) return [];
        const separator = line.indexOf('=');
        if (separator <= 0) return [];
        return [[line.slice(0, separator), line.slice(separator + 1)]];
      })
    );
    if (configured.has('MINIO_ROOT_USER') && !configured.has('OBJECT_STORAGE_ACCESS_KEY')) {
      throw new Error(
        'Legacy MinIO configuration detected. Export existing objects and follow docs/DEPLOYMENT.md before replacing the local configuration.'
      );
    }
    const requiredRootKeys = [
      'MYSQL_DATABASE',
      'MYSQL_USER',
      'MYSQL_PASSWORD',
      'MYSQL_ROOT_PASSWORD',
      'OBJECT_STORAGE_ACCESS_KEY',
      'OBJECT_STORAGE_SECRET_KEY',
      'OBJECT_STORAGE_BUCKET',
      'JWT_SECRET',
    ];
    const missing = requiredRootKeys.filter((key) => !String(configured.get(key) || '').trim());
    if (missing.length > 0) {
      throw new Error(`Local configuration is missing required values: ${missing.join(', ')}. Regenerate it explicitly with npm run init:config -- --force.`);
    }
    return { created: [], reused: secretFiles };
  }
  if (existingFiles.length !== 0) {
    throw new Error('Incomplete local configuration: expected both .env and server/.env; refusing to overwrite or continue.');
  }

  return { ...writeLocalConfig({ rootDir }), reused: [] };
}

if (require.main === module) {
  const force = process.argv.slice(2).includes('--force');
  const { created, reused = [] } = force ? writeLocalConfig({ force: true }) : ensureLocalConfigPair();
  for (const filePath of created) {
    console.log(`Created ${path.relative(process.cwd(), filePath) || path.basename(filePath)}`);
  }
  for (const filePath of reused) {
    console.log(`Reusing ${path.relative(process.cwd(), filePath) || path.basename(filePath)}`);
  }
  console.log('Next: review the local files, start local services, and open /setup in your browser.');
}

module.exports = { buildLocalConfig, ensureLocalConfigPair, writeLocalConfig };
