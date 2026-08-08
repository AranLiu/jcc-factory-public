const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const { buildLocalConfig, ensureLocalConfigPair, writeLocalConfig } = require('../../scripts/init-config');

const rootDir = path.resolve(__dirname, '../..');

function parseEnv(contents) {
  return Object.fromEntries(
    contents.trim().split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
  );
}

test('generated local config uses random service credentials but leaves browser-first admin setup disabled', () => {
  const requestedByteLengths = [];
  const deterministicBytes = (byteLength) => {
    requestedByteLengths.push(byteLength);
    return Buffer.alloc(byteLength, byteLength);
  };
  const { rootEnv, serverEnv } = buildLocalConfig({ randomBytes: deterministicBytes });
  const root = parseEnv(rootEnv);
  const server = parseEnv(serverEnv);

  assert.deepEqual(requestedByteLengths, [10, 24, 24, 7, 24, 32]);
  assert.equal(server.DB_HOST, '127.0.0.1');
  assert.equal(server.DB_USER, root.MYSQL_USER);
  assert.equal(server.DB_PASSWORD, root.MYSQL_PASSWORD);
  assert.equal(server.DB_NAME, root.MYSQL_DATABASE);
  assert.equal(server.MINIO_ACCESS_KEY, root.OBJECT_STORAGE_ACCESS_KEY);
  assert.equal(server.MINIO_SECRET_KEY, root.OBJECT_STORAGE_SECRET_KEY);
  assert.equal(server.MINIO_PORT, '8333');
  assert.equal(server.MINIO_BUCKET, root.OBJECT_STORAGE_BUCKET);
  assert.equal(server.JWT_SECRET, root.JWT_SECRET);
  assert.equal(root.GEMINI_API_KEY, '');
  assert.equal(root.GEMINI_DEFAULT_MODEL, '');
  assert.equal(server.GEMINI_API_KEY, '');
  assert.equal(server.GEMINI_DEFAULT_MODEL, '');
  assert.equal(root.AI_PROVIDER_TIMEOUT_MS, '180000');
  assert.equal(server.AI_PROVIDER_TIMEOUT_MS, '180000');
  assert.equal(root.SESSION_COOKIE_SECURE, 'false');
  assert.equal(server.SESSION_COOKIE_SECURE, 'false');
  assert.match(server.JWT_SECRET, /^[A-Za-z0-9_-]{43}$/);
  assert.match(root.MYSQL_ROOT_PASSWORD, /^[A-Za-z0-9_-]+$/);
  assert.equal(root.AUTO_PROVISION_ADMIN, 'false');
  assert.equal(server.AUTO_PROVISION_ADMIN, 'false');
  for (const adminKey of ['ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    assert.equal(root[adminKey], '');
    assert.equal(server[adminKey], '');
  }
  assert.equal(Object.hasOwn(root, 'ADMIN_EMAIL'), false);
  assert.equal(Object.hasOwn(server, 'ADMIN_EMAIL'), false);
  assert.doesNotMatch(`${rootEnv}\n${serverEnv}`, /replace_|changeme|your[_-]/i);
});

test('checked-in examples keep browser setup as the safe default and optional Gemini overrides blank', () => {
  const rootExample = parseEnv(fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8'));
  const serverExample = parseEnv(fs.readFileSync(path.join(rootDir, 'server', 'env.example'), 'utf8'));
  const initSql = fs.readFileSync(path.join(rootDir, 'server', 'database', 'init.sql'), 'utf8');

  assert.equal(rootExample.GEMINI_API_KEY, '');
  assert.equal(rootExample.GEMINI_DEFAULT_MODEL, '');
  assert.equal(rootExample.OBJECT_STORAGE_ACCESS_KEY, '');
  assert.equal(rootExample.OBJECT_STORAGE_SECRET_KEY, '');
  assert.equal(rootExample.OBJECT_STORAGE_BUCKET, 'jcc-factory');
  for (const example of [rootExample, serverExample]) {
    assert.equal(example.AUTO_PROVISION_ADMIN, 'false');
    assert.equal(example.ADMIN_USERNAME, '');
    assert.equal(example.ADMIN_PASSWORD, '');
    assert.equal(Object.hasOwn(example, 'ADMIN_EMAIL'), false);
    assert.equal(example.AI_PROVIDER_TIMEOUT_MS, '180000');
    assert.equal(example.SESSION_COOKIE_SECURE, 'false');
  }
  assert.doesNotMatch(
    `${rootExample.GEMINI_API_KEY}\n${rootExample.GEMINI_DEFAULT_MODEL}`,
    /replace_|changeme|your[_-]|example|placeholder/i
  );
  assert.match(initSql, /\('gemini_default_model', 'gemini-3\.6-flash'/);
  assert.match(initSql, /\('gemini_available_models', '\["gemini-3\.6-flash"\]'/);
});

test('direct Python requirements stay synchronized with the audited lock file', () => {
  const direct = parseEnv(
    fs.readFileSync(path.join(rootDir, 'server', 'python_services', 'requirements.in'), 'utf8')
      .replaceAll('==', '=')
  );
  const locked = parseEnv(
    fs.readFileSync(path.join(rootDir, 'server', 'python_services', 'requirements.txt'), 'utf8')
      .replaceAll('==', '=')
  );

  for (const [dependency, version] of Object.entries(direct)) {
    assert.equal(locked[dependency], version, `${dependency} must match requirements.txt`);
  }
});

test('user email is optional for fresh and migrated databases', () => {
  const initSql = fs.readFileSync(path.join(rootDir, 'server', 'database', 'init.sql'), 'utf8');
  const migrationSql = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'migrations', '004_optional_user_email.sql'),
    'utf8'
  );

  assert.match(initSql, /email VARCHAR\(100\) NULL UNIQUE/i);
  assert.match(migrationSql, /ALTER TABLE users[\s\S]*MODIFY COLUMN email VARCHAR\(100\) NULL/i);
});

test('host development uses the documented Vite origin', () => {
  const viteConfig = fs.readFileSync(path.join(rootDir, 'client', 'vite.config.js'), 'utf8');
  const serverExample = parseEnv(fs.readFileSync(path.join(rootDir, 'server', 'env.example'), 'utf8'));

  assert.match(viteConfig, /port:\s*5173\b/);
  assert.match(viteConfig, /strictPort:\s*true\b/);
  assert.match(serverExample.ALLOWED_ORIGINS, /http:\/\/127\.0\.0\.1:5173/);
});

test('queue uniqueness stays compatible with nullable file foreign keys on MySQL 8.4', () => {
  const initSql = fs.readFileSync(path.join(rootDir, 'server', 'database', 'init.sql'), 'utf8');
  const baselineMigrationSql = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'migrations', '001_security_and_workflows.sql'),
    'utf8'
  );
  const compatibilityMigrationSql = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'migrations', '002_virtual_queue_file_key.sql'),
    'utf8'
  );

  for (const sql of [initSql, compatibilityMigrationSql]) {
    assert.match(sql, /active_queue_file_id[\s\S]*?\)\s+VIRTUAL/i);
    assert.doesNotMatch(sql, /active_queue_file_id[\s\S]*?\)\s+STORED/i);
  }
  const dropIndexAt = compatibilityMigrationSql.indexOf('DROP INDEX uq_ai_tasks_active_queue_file');
  const dropColumnAt = compatibilityMigrationSql.indexOf('DROP COLUMN active_queue_file_id');
  const addColumnAt = compatibilityMigrationSql.indexOf('ADD COLUMN active_queue_file_id');
  const createIndexAt = compatibilityMigrationSql.indexOf('CREATE UNIQUE INDEX uq_ai_tasks_active_queue_file');
  assert.ok(dropIndexAt >= 0 && dropIndexAt < dropColumnAt);
  assert.ok(dropColumnAt < addColumnAt);
  assert.ok(addColumnAt < createIndexAt);
  assert.doesNotMatch(compatibilityMigrationSql, /MODIFY COLUMN active_queue_file_id/i);
  assert.match(baselineMigrationSql, /active_queue_file_id[\s\S]*?\)\s+STORED/i);
  assert.equal(
    createHash('sha256').update(baselineMigrationSql.replace(/\r\n/g, '\n')).digest('hex'),
    '701a0fe741a6d2fdd839144c1f1ee3069e253fa1d60b48053daf1f62222cc55a'
  );
  assert.match(initSql, /FOREIGN KEY \(file_id\) REFERENCES files\(id\) ON DELETE SET NULL/);
});

test('never overwrites existing secret files unless force is explicit', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcc-config-'));
  const rootEnvPath = path.join(rootDir, '.env');
  const serverDir = path.join(rootDir, 'server');
  const serverEnvPath = path.join(serverDir, '.env');

  try {
    fs.mkdirSync(serverDir);
    for (const existingPath of [rootEnvPath, serverEnvPath]) {
      fs.writeFileSync(existingPath, 'DB_PASSWORD=existing-secret\n');

      assert.throws(() => writeLocalConfig({ rootDir, force: false }), /already exists/i);
      assert.equal(fs.readFileSync(existingPath, 'utf8'), 'DB_PASSWORD=existing-secret\n');
      fs.unlinkSync(existingPath);
    }

    fs.writeFileSync(rootEnvPath, 'DB_PASSWORD=existing-root-secret\n');
    fs.writeFileSync(serverEnvPath, 'DB_PASSWORD=existing-server-secret\n');
    const result = writeLocalConfig({ rootDir, force: true });
    assert.deepEqual(result.created.sort(), [rootEnvPath, serverEnvPath].sort());
    assert.match(fs.readFileSync(rootEnvPath, 'utf8'), /MYSQL_PASSWORD=/);
    assert.match(fs.readFileSync(serverEnvPath, 'utf8'), /DB_PASSWORD=/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(rootEnvPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(serverEnvPath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('explicitly hardens both secret files after overwriting existing config', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcc-config-mode-'));
  const rootEnvPath = path.join(rootDir, '.env');
  const serverDir = path.join(rootDir, 'server');
  const serverEnvPath = path.join(serverDir, '.env');
  const originalChmodSync = fs.chmodSync;
  const chmodCalls = [];

  try {
    fs.mkdirSync(serverDir);
    fs.writeFileSync(rootEnvPath, 'MYSQL_PASSWORD=existing-root-secret\n');
    fs.writeFileSync(serverEnvPath, 'DB_PASSWORD=existing-server-secret\n');
    fs.chmodSync = (filePath, mode) => chmodCalls.push([filePath, mode]);

    writeLocalConfig({ rootDir, force: true });

    assert.deepEqual(chmodCalls, [
      [rootEnvPath, 0o600],
      [serverEnvPath, 0o600],
    ]);
  } finally {
    fs.chmodSync = originalChmodSync;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('reuses a complete config pair but rejects a partial quickstart state', () => {
  assert.equal(typeof ensureLocalConfigPair, 'function');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcc-config-pair-'));
  const rootEnvPath = path.join(rootDir, '.env');
  const serverDir = path.join(rootDir, 'server');
  const serverEnvPath = path.join(serverDir, '.env');

  try {
    fs.mkdirSync(serverDir);
    const generated = buildLocalConfig({ randomBytes: (length) => Buffer.alloc(length, 9) });
    fs.writeFileSync(rootEnvPath, generated.rootEnv);
    fs.writeFileSync(serverEnvPath, generated.serverEnv);

    const reused = ensureLocalConfigPair({ rootDir });
    assert.deepEqual(reused.created, []);
    assert.deepEqual(reused.reused.sort(), [rootEnvPath, serverEnvPath].sort());
    assert.equal(fs.readFileSync(rootEnvPath, 'utf8'), generated.rootEnv);
    assert.equal(fs.readFileSync(serverEnvPath, 'utf8'), generated.serverEnv);

    fs.unlinkSync(serverEnvPath);
    assert.throws(
      () => ensureLocalConfigPair({ rootDir }),
      /incomplete local configuration.*both \.env and server[\\/]\.env/i
    );
    assert.equal(fs.readFileSync(rootEnvPath, 'utf8'), generated.rootEnv);

    fs.unlinkSync(rootEnvPath);
    fs.writeFileSync(serverEnvPath, 'DB_PASSWORD=existing-server-secret\n');
    assert.throws(
      () => ensureLocalConfigPair({ rootDir }),
      /incomplete local configuration.*both \.env and server[\\/]\.env/i
    );
    assert.equal(fs.readFileSync(serverEnvPath, 'utf8'), 'DB_PASSWORD=existing-server-secret\n');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects a legacy MinIO quickstart pair before starting with empty SeaweedFS credentials', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcc-config-legacy-'));
  const serverDir = path.join(rootDir, 'server');

  try {
    fs.mkdirSync(serverDir);
    fs.writeFileSync(path.join(rootDir, '.env'), 'MINIO_ROOT_USER=legacy-user\nMINIO_ROOT_PASSWORD=legacy-secret\n');
    fs.writeFileSync(path.join(serverDir, '.env'), 'MINIO_ACCESS_KEY=legacy-user\n');

    assert.throws(
      () => ensureLocalConfigPair({ rootDir }),
      /legacy MinIO configuration.*DEPLOYMENT\.md/i
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
