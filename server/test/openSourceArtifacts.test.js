const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const readRoot = (...parts) => fs.readFileSync(path.join(rootDir, ...parts), 'utf8');

function toShellPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function findPosixShell() {
  const candidates = [process.env.JCC_TEST_POSIX_SH, process.env.POSIX_SH, process.env.SHELL];

  if (process.platform === 'win32') {
    const gitRoots = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git'),
      'C:\\Program Files\\Git',
      'D:\\Program Files\\Git',
    ].filter(Boolean);
    const gitLookup = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8' });
    if (gitLookup.status === 0) {
      for (const gitPath of gitLookup.stdout.split(/\r?\n/).filter(Boolean)) {
        gitRoots.push(path.dirname(path.dirname(gitPath.trim())));
      }
    }
    for (const gitRoot of gitRoots) {
      candidates.push(path.join(gitRoot, 'bin', 'sh.exe'), path.join(gitRoot, 'usr', 'bin', 'sh.exe'));
    }
  } else {
    candidates.push('sh');
  }

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const probe = spawnSync(candidate, ['-c', 'exit 0'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('A working POSIX sh is required to execute docker/entrypoint.sh tests');
}

function runEntrypoint(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcc-entrypoint-'));
  const binDir = path.join(tempDir, 'bin');
  const callLogPath = path.join(tempDir, 'calls.log');
  const entrypointPath = path.join(rootDir, 'docker', 'entrypoint.sh');
  fs.mkdirSync(binDir);

  const stubs = {
    node: `#!/bin/sh
case "$1" in
  server/database/runMigrations.js) call=migrate ;;
  scripts/setup-admin.js) call=setup ;;
  server/index.js) call=server ;;
  *) call="node:$1" ;;
esac
printf "%s\\n" "$call" >> "$CALL_LOG"
if [ "$call" = "setup" ]; then
  exit "\${SETUP_EXIT_CODE:-0}"
fi
`,
  };
  for (const [name, contents] of Object.entries(stubs)) {
    const stubPath = path.join(binDir, name);
    fs.writeFileSync(stubPath, contents, 'utf8');
    fs.chmodSync(stubPath, 0o755);
  }

  const env = { ...process.env, CALL_LOG: 'calls.log' };
  for (const key of ['AUTO_PROVISION_ADMIN', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    delete env[key];
  }
  Object.assign(env, overrides);

  try {
    const result = spawnSync(
      findPosixShell(),
      [
        '-c',
        'PATH="$1:$PATH"; export PATH; exec "$2"',
        'entrypoint-test',
        toShellPath(binDir),
        toShellPath(entrypointPath),
      ],
      { cwd: tempDir, env, encoding: 'utf8' }
    );
    const calls = fs.existsSync(callLogPath)
      ? fs.readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
      : [];
    return { ...result, calls };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('compose exposes only loopback ports with health-gated pinned services', () => {
  const compose = readRoot('compose.yaml');

  assert.match(compose, /mysql:[\s\S]*build:[\s\S]*docker\/mysql\/Dockerfile/);
  assert.match(compose, /command:\s*\["--pid-file=\/run\/jcc-mysql\/mysqld\.pid"\]/);
  assert.match(compose, /image:\s*chrislusf\/seaweedfs:4\.41/);
  assert.ok(compose.includes('127.0.0.1:${APP_PORT:-8080}:8080'));
  assert.ok(compose.includes('127.0.0.1:${MYSQL_PORT:-3306}:3306'));
  assert.ok(compose.includes('127.0.0.1:${OBJECT_STORAGE_PORT:-8333}:8333'));
  assert.doesNotMatch(compose, /9001:9001/);
  assert.ok(compose.includes('SESSION_COOKIE_SECURE: "${SESSION_COOKIE_SECURE:-false}"'));
  assert.equal((compose.match(/condition:\s*service_healthy/g) || []).length, 2);
  assert.equal((compose.match(/healthcheck:/g) || []).length, 3);
  assert.ok(compose.includes('http://127.0.0.1:8080/api/health'));
  assert.match(compose, /server\/database\/init\.sql:.*\/docker-entrypoint-initdb\.d\/init\.sql:ro/);
  assert.match(compose, /DB_HOST:\s*mysql/);
  assert.match(compose, /DB_PORT:\s*3306/);
  assert.match(compose, /MINIO_ENDPOINT:\s*object-storage/);
  assert.match(compose, /MINIO_PORT:\s*8333/);
  assert.match(compose, /AWS_ACCESS_KEY_ID:\s*"\$\{OBJECT_STORAGE_ACCESS_KEY:\?/);
  assert.match(compose, /AWS_SECRET_ACCESS_KEY:\s*"\$\{OBJECT_STORAGE_SECRET_KEY:\?/);
  assert.match(compose, /S3_BUCKET:\s*"\$\{OBJECT_STORAGE_BUCKET:-jcc-factory\}"/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /NODE_ENV:\s*"\$\{NODE_ENV:-production\}"/);
  assert.match(compose, /GEMINI_API_KEY:\s*"\$\{GEMINI_API_KEY:-\}"/);
  assert.match(compose, /GEMINI_DEFAULT_MODEL:\s*"\$\{GEMINI_DEFAULT_MODEL:-\}"/);
  assert.match(compose, /AI_PROVIDER_TIMEOUT_MS:\s*"\$\{AI_PROVIDER_TIMEOUT_MS:-180000\}"/);
  assert.match(compose, /documents_data:\/app\/server\/uploads\/documents/);
  assert.match(compose, /volumes:[\s\S]*mysql_data:[\s\S]*object_storage_data:[\s\S]*documents_data:/);
});

test('runtime image pins Node and Python, uses locked installs and an unprivileged user', () => {
  const dockerfile = readRoot('Dockerfile');

  assert.match(dockerfile, /FROM node:22\.16\.0/);
  assert.match(dockerfile, /FROM python:3\.12/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /pip install[^\n]*-r \/tmp\/requirements\.txt/);
  assert.match(dockerfile, /COPY --from=node-runtime \/usr\/local\/bin\/node \/usr\/local\/bin\/node/);
  assert.doesNotMatch(dockerfile, /COPY --from=node-runtime \/usr\/local\/ \/usr\/local\//);
  assert.match(dockerfile, /apt-get install[^\n]*ffmpeg[^\n]*curl[^\n]*ca-certificates/);
  assert.match(dockerfile, /ENV PYTHON_COMMAND=\/opt\/venv\/bin\/python/);
  for (const runtimeDirectory of [
    '/app/uploads',
    '/app/temp_uploads',
    '/app/server/uploads',
    '/app/server/uploads/documents',
    '/app/server/knowledge_base_files',
    '/app/server/temp',
    '/app/server/logs',
  ]) {
    assert.ok(dockerfile.includes(runtimeDirectory), `runtime image must prepare ${runtimeDirectory}`);
  }
  assert.match(dockerfile, /chown -R app:app \/app\/uploads/);
  assert.match(dockerfile, /USER app/);
  assert.doesNotMatch(dockerfile, /^COPY\s+[^\n]*\.env/m);
});

test('entrypoint retains migration, setup helper, browser guidance, and server launch artifacts', () => {
  const entrypoint = readRoot('docker', 'entrypoint.sh');

  assert.match(entrypoint, /node server\/database\/runMigrations\.js/);
  assert.doesNotMatch(entrypoint, /npm /);
  assert.match(entrypoint, /node scripts\/setup-admin\.js/);
  assert.match(entrypoint, /\/setup/);
  assert.match(entrypoint, /exec node server\/index\.js/);
});

test('entrypoint defaults missing or false auto-provision flags to browser setup', () => {
  for (const overrides of [{}, { AUTO_PROVISION_ADMIN: 'false' }]) {
    const result = runEntrypoint(overrides);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, ['migrate', 'server']);
    assert.match(result.stdout, /\/setup/);
  }
});

test('entrypoint fails closed when headless provisioning fields are incomplete', () => {
  const result = runEntrypoint({
    AUTO_PROVISION_ADMIN: 'true',
    ADMIN_PASSWORD: '12345678',
  });

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, ['migrate']);
});

test('entrypoint fails closed when the headless administrator password is too short', () => {
  const result = runEntrypoint({
    AUTO_PROVISION_ADMIN: 'true',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: '1234567',
  });

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, ['migrate']);
});

test('entrypoint runs migrate, setup once, then server for a complete exact opt-in', () => {
  const result = runEntrypoint({
    AUTO_PROVISION_ADMIN: 'true',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: '12345678',
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['migrate', 'setup', 'server']);
  assert.equal(result.calls.filter((call) => call === 'setup').length, 1);
});

test('entrypoint does not start the server when setup-admin exits non-zero', () => {
  const result = runEntrypoint({
    AUTO_PROVISION_ADMIN: 'true',
    ADMIN_USERNAME: 'admin',
    ADMIN_EMAIL: 'admin@example.test',
    ADMIN_PASSWORD: 'long-enough-password',
    SETUP_EXIT_CODE: '23',
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.calls, ['migrate', 'setup']);
});

test('compose passes safe empty admin defaults while preserving the explicit headless path', () => {
  const compose = readRoot('compose.yaml');
  const dockerfile = readRoot('Dockerfile');
  const packageJson = JSON.parse(readRoot('package.json'));

  assert.match(compose, /AUTO_PROVISION_ADMIN:\s*"\$\{AUTO_PROVISION_ADMIN:-false\}"/);
  assert.match(compose, /ADMIN_USERNAME:\s*"\$\{ADMIN_USERNAME:-\}"/);
  assert.doesNotMatch(compose, /ADMIN_EMAIL/);
  assert.match(compose, /ADMIN_PASSWORD:\s*"\$\{ADMIN_PASSWORD:-\}"/);
  assert.equal(packageJson.scripts['setup:admin'], 'node scripts/setup-admin.js');
  assert.match(dockerfile, /COPY --chown=app:app scripts\/setup-admin\.js \.\/scripts\/setup-admin\.js/);
});

test('Linux shell entrypoints are normalized to LF for Windows checkouts', () => {
  const attributes = readRoot('.gitattributes');
  const entrypoint = fs.readFileSync(path.join(rootDir, 'docker', 'entrypoint.sh'));
  const migration = fs.readFileSync(
    path.join(rootDir, 'server', 'database', 'migrations', '001_security_and_workflows.sql')
  );

  assert.match(attributes, /^\*\.sh\s+text\s+eol=lf$/m);
  assert.match(attributes, /^\*\.sql\s+text\s+eol=lf$/m);
  assert.equal(entrypoint.includes(Buffer.from('\r\n')), false);
  assert.equal(migration.includes(Buffer.from('\r\n')), false);
});

test('wrapper and root scripts route through the supported compose workflow', () => {
  const packageJson = JSON.parse(readRoot('package.json'));
  const setupSh = readRoot('setup.sh');
  const setupBat = readRoot('setup.bat');
  const startBat = readRoot('start.bat');

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.scripts.compose, 'node scripts/compose.js');
  assert.equal(packageJson.scripts.quickstart, 'npm run init:config && npm run compose -- up --build -d --wait');
  assert.equal(packageJson.scripts['docker:up'], 'npm run compose -- up -d --wait');
  assert.equal(packageJson.scripts['docker:down'], 'npm run compose -- down');
  assert.equal(packageJson.scripts['docker:logs'], 'npm run compose -- logs -f');
  assert.equal(packageJson.scripts['docker:reset'], 'npm run compose -- down -v');
  assert.ok(packageJson.scripts.verify);
  assert.ok(packageJson.scripts['audit:all']);
  for (const wrapper of [setupSh, setupBat]) {
    assert.match(wrapper, /npm run quickstart/);
    assert.doesNotMatch(wrapper, /docker compose/);
    assert.doesNotMatch(wrapper, /Node\.js 16|MySQL 5\.7|MariaDB|gendrama\.com/i);
  }
  assert.match(startBat, /npm run docker:up/);
  assert.doesNotMatch(startBat, /docker compose/);
  assert.doesNotMatch(startBat, /npm run dev|gendrama\.com/i);
});

test('docker build context excludes local secrets and user data directories', () => {
  const dockerignore = readRoot('.dockerignore');

  for (const ignored of [
    '.git', '.worktrees', 'node_modules', '.env', 'dist', 'build',
    'uploads', 'server/uploads', 'server/knowledge_base_files', 'temp_uploads', '**/temp_uploads',
    'server/temp', 'logs', 'tmp', '.venv', 'venv',
  ]) {
    assert.ok(dockerignore.includes(ignored), `expected .dockerignore to include ${ignored}`);
  }
});

test('database image removes unused administration tools and runs as the mysql user', () => {
  const dockerfile = readRoot('docker', 'mysql', 'Dockerfile');

  assert.match(dockerfile, /FROM mysql:8\.4\.10/);
  assert.match(dockerfile, /microdnf remove -y mysql-shell/);
  assert.match(dockerfile, /rm -f \/usr\/local\/bin\/gosu/);
  assert.match(dockerfile, /install -d -o mysql -g mysql -m 0700 \/run\/jcc-mysql/);
  assert.match(dockerfile, /USER mysql/);
  assert.doesNotMatch(dockerfile, /golang:|go install|COPY --from=gosu/);
});

test('CI shares database configuration across migration and test steps', () => {
  const workflow = readRoot('.github', 'workflows', 'ci.yml');
  const verifyJob = workflow.match(/  verify:\r?\n([\s\S]*?)(?=\r?\n  secrets:)/)?.[1] || '';

  assert.match(verifyJob, /^    env:\r?\n(?:      .+\r?\n)+/m);
  for (const name of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    assert.match(verifyJob, new RegExp(`^      ${name}:`, 'm'));
  }
});

test('CI actions use current supported runtimes and make full history available to secret scanning', () => {
  const workflow = readRoot('.github', 'workflows', 'ci.yml');
  const secretsJob = workflow.match(/  secrets:\r?\n([\s\S]*)$/)?.[1] || '';

  assert.equal((workflow.match(/actions\/checkout@v7/g) || []).length, 2);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /actions\/setup-python@v7/);
  assert.match(workflow, /gitleaks\/gitleaks-action@v3/);
  assert.match(workflow, /permissions:[\s\S]*contents:\s*read[\s\S]*pull-requests:\s*read/);
  assert.match(secretsJob, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(secretsJob, /GITLEAKS_ENABLE_COMMENTS:\s*"false"/);
  assert.doesNotMatch(
    workflow,
    /actions\/checkout@v[4-6]|actions\/setup-node@v[4-6]|actions\/setup-python@v[5-6]|gitleaks\/gitleaks-action@v2/
  );
  assert.match(secretsJob, /fetch-depth:\s*0/);
});

test('public repository automation covers every dependency manifest and contribution path', () => {
  const dependabot = readRoot('.github', 'dependabot.yml');
  const pullRequestTemplate = readRoot('.github', 'pull_request_template.md');
  const issueConfig = readRoot('.github', 'ISSUE_TEMPLATE', 'config.yml');
  const bugForm = readRoot('.github', 'ISSUE_TEMPLATE', 'bug_report.yml');
  const featureForm = readRoot('.github', 'ISSUE_TEMPLATE', 'feature_request.yml');

  for (const ecosystem of ['npm', 'pip', 'docker', 'docker-compose', 'github-actions']) {
    assert.match(dependabot, new RegExp(`package-ecosystem: ["']${ecosystem}["']`));
  }
  for (const directory of ['/', '/client', '/server', '/server/python_services', '/docker/mysql']) {
    assert.ok(dependabot.includes(`- "${directory}"`) || dependabot.includes(`directory: "${directory}"`));
  }
  assert.match(dependabot, /interval: "weekly"/);
  assert.match(pullRequestTemplate, /验证/);
  assert.match(pullRequestTemplate, /安全/);
  assert.match(issueConfig, /blank_issues_enabled: false/);
  assert.match(issueConfig, /security\/advisories\/new/);
  assert.match(bugForm, /type: textarea/);
  assert.match(featureForm, /type: textarea/);
});
