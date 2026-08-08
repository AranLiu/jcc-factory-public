const test = require('node:test');
const assert = require('node:assert/strict');

const {
  provisionInitialAdmin,
  readAdminConfig,
  runSetupAdminCli,
  setupAdmin,
} = require('../../scripts/setup-admin');

const LOCK_NAME = 'jcc_factory_first_admin_setup';

function validEnv(overrides = {}) {
  return {
    DB_HOST: 'mysql',
    DB_PORT: '3306',
    DB_USER: 'service-user',
    DB_PASSWORD: 'service-password',
    DB_NAME: 'jcc_factory',
    ADMIN_USERNAME: 'first-admin',
    ADMIN_PASSWORD: 'initial-password',
    ...overrides,
  };
}

function createStatefulPool(users = []) {
  const state = {
    users: users.map(user => ({ ...user })),
    lockHeld: false,
    statements: [],
    nextId: users.length + 1,
  };

  return {
    state,
    async getConnection() {
      const connection = {
        ownsLock: false,
        pendingUser: null,
        async execute(sql, params = []) {
          state.statements.push({ sql, params });
          if (sql === `SELECT GET_LOCK('${LOCK_NAME}', 10) AS acquired`) {
            if (state.lockHeld) return [[{ acquired: 0 }]];
            state.lockHeld = true;
            connection.ownsLock = true;
            return [[{ acquired: 1 }]];
          }
          if (sql === `SELECT RELEASE_LOCK('${LOCK_NAME}') AS released`) {
            state.lockHeld = false;
            connection.ownsLock = false;
            return [[{ released: 1 }]];
          }
          if (sql === 'SELECT id FROM users LIMIT 1') {
            return [state.users.length ? [{ id: state.users[0].id }] : []];
          }
          if (/^INSERT INTO users/.test(sql)) {
            const [username, email, passwordHash] = params;
            connection.pendingUser = {
              id: state.nextId++,
              username,
              email,
              password_hash: passwordHash,
            };
            return [{ affectedRows: 1, insertId: connection.pendingUser.id }];
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async beginTransaction() {},
        async commit() {
          if (connection.pendingUser) state.users.push(connection.pendingUser);
          connection.pendingUser = null;
        },
        async rollback() {
          connection.pendingUser = null;
        },
        release() {},
        destroy() {
          state.lockHeld = false;
          connection.pendingUser = null;
        },
      };
      return connection;
    },
  };
}

test('headless setup treats any existing user as initialized even when configured credentials differ', async () => {
  const pool = createStatefulPool([{ id: 7, username: 'someone-else' }]);
  let hashCalls = 0;

  const result = await provisionInitialAdmin({
    pool,
    input: {
      username: 'configured-admin',
      email: 'configured@example.com',
      password: 'initial-password',
    },
    hashPassword: async () => { hashCalls += 1; return 'unused'; },
    logger: { log() {} },
  });

  assert.deepEqual(result, { created: false, reason: 'already_initialized' });
  assert.equal(hashCalls, 0);
  assert.equal(pool.state.users.length, 1);
  assert.equal(pool.state.statements.some(({ sql }) => /^INSERT INTO users/.test(sql)), false);
});

test('headless setup uses shared bounds and ignores a legacy ADMIN_EMAIL value', () => {
  const { admin } = readAdminConfig(validEnv({
    ADMIN_USERNAME: '  first-admin  ',
    ADMIN_EMAIL: '  Admin@Example.COM  ',
  }));
  assert.deepEqual(admin, {
    username: 'first-admin',
    email: null,
    password: 'initial-password',
  });

  assert.deepEqual(readAdminConfig(validEnv({ ADMIN_PASSWORD: '12345678' })).admin, {
    username: 'first-admin',
    email: null,
    password: '12345678',
  });

  for (const overrides of [
    { ADMIN_USERNAME: 'ab' },
    { ADMIN_USERNAME: 'x'.repeat(51) },
    { ADMIN_PASSWORD: 'short' },
    { ADMIN_PASSWORD: 'x'.repeat(129) },
  ]) {
    assert.throws(() => readAdminConfig(validEnv(overrides)));
  }
});

test('different concurrent headless configurations cannot create multiple administrators', async () => {
  const pool = createStatefulPool();
  let releaseHash;
  let hashingStarted;
  const hashStarted = new Promise(resolve => { hashingStarted = resolve; });
  const waitForHash = new Promise(resolve => { releaseHash = resolve; });

  const first = provisionInitialAdmin({
    pool,
    input: {
      username: 'first-admin',
      email: 'first@example.com',
      password: 'first-password',
    },
    hashPassword: async () => {
      hashingStarted();
      await waitForHash;
      return 'first-hash';
    },
    logger: { log() {} },
  });
  await hashStarted;

  const second = await provisionInitialAdmin({
    pool,
    input: {
      username: 'second-admin',
      email: 'second@example.com',
      password: 'second-password',
    },
    hashPassword: async () => 'second-hash',
    logger: { log() {} },
  });
  assert.deepEqual(second, { created: false, reason: 'setup_busy' });

  releaseHash();
  assert.equal((await first).created, true);
  assert.equal(pool.state.users.length, 1);
  assert.equal(pool.state.users[0].username, 'first-admin');
});

test('setupAdmin delegates to the shared primitive and always closes its pool', async () => {
  const pool = { endCalls: 0, async end() { this.endCalls += 1; } };
  const calls = [];

  const result = await setupAdmin({
    env: validEnv(),
    createPool: config => {
      calls.push({ type: 'pool', config });
      return pool;
    },
    createAdmin: async options => {
      calls.push({ type: 'create', options });
      return { created: false, reason: 'already_initialized' };
    },
    hashPassword: async () => 'hash',
    logger: { log() {} },
  });

  assert.deepEqual(result, { created: false, reason: 'already_initialized' });
  assert.equal(calls[1].options.pool, pool);
  assert.deepEqual(calls[1].options.input, {
    username: 'first-admin',
    email: null,
    password: 'initial-password',
  });
  assert.equal(pool.endCalls, 1);
});

test('setupAdmin retries setup_busy and succeeds only after an administrator is created', async () => {
  const pool = { endCalls: 0, async end() { this.endCalls += 1; } };
  const results = [
    { created: false, reason: 'setup_busy' },
    { created: true },
  ];
  const waits = [];
  let calls = 0;

  const result = await setupAdmin({
    env: validEnv(),
    createPool: () => pool,
    createAdmin: async () => results[calls++],
    sleep: async delay => { waits.push(delay); },
    busyRetryDelayMs: 25,
    logger: { log() {} },
  });

  assert.equal(result.created, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [25]);
  assert.equal(pool.endCalls, 1);
});

test('setupAdmin retries setup_busy and accepts a definitive already_initialized result', async () => {
  const pool = { endCalls: 0, async end() { this.endCalls += 1; } };
  const results = [
    { created: false, reason: 'setup_busy' },
    { created: false, reason: 'already_initialized' },
  ];
  let calls = 0;

  const result = await setupAdmin({
    env: validEnv(),
    createPool: () => pool,
    createAdmin: async () => results[calls++],
    sleep: async () => {},
    logger: { log() {} },
  });

  assert.deepEqual(result, { created: false, reason: 'already_initialized' });
  assert.equal(calls, 2);
  assert.equal(pool.endCalls, 1);
});

test('setupAdmin rejects persistent setup_busy with a safe error and still closes its pool', async () => {
  const pool = { endCalls: 0, async end() { this.endCalls += 1; } };
  const logs = [];
  let calls = 0;

  await assert.rejects(
    setupAdmin({
      env: validEnv({ ADMIN_PASSWORD: 'do-not-log-this-password' }),
      createPool: () => pool,
      createAdmin: async () => {
        calls += 1;
        return { created: false, reason: 'setup_busy' };
      },
      maxBusyRetries: 2,
      busyRetryDelayMs: 0,
      sleep: async () => {},
      logger: { log: (...values) => logs.push(values.join(' ')) },
    }),
    error => error.code === 'SETUP_ADMIN_BUSY' &&
      error.message === 'Initial administrator setup remained busy after retries'
  );

  assert.equal(calls, 3);
  assert.equal(pool.endCalls, 1);
  assert.equal(logs.join('\n').includes('do-not-log-this-password'), false);
});

test('CLI reports a generic failure and sets a non-zero exit code without logging secrets', async () => {
  const processLike = { exitCode: 0 };
  const errors = [];
  const secret = 'database-password=do-not-log';

  await runSetupAdminCli({
    run: async () => { throw new Error(secret); },
    processLike,
    logger: { error: (...values) => errors.push(values.join(' ')) },
  });

  assert.equal(processLike.exitCode, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors.join('\n').includes(secret), false);
});
