const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SetupCleanupError,
  SetupValidationError,
  createSetupHandler,
  createSetupStatusHandler,
  createInitialAdmin,
  getSetupStatus,
  validateInitialAdmin,
} = require('../services/firstRunSetup');

const LOCK_NAME = 'jcc_factory_first_admin_setup';

function createStatefulPool(options = {}) {
  const {
    users = [],
    lockHeld = false,
    insertError,
    beginError,
    commitError,
    lockError,
    rollbackError,
    connectionReleaseError,
    releaseError,
  } = options;
  const hasLockResult = Object.hasOwn(options, 'lockResult');
  const hasReleaseResult = Object.hasOwn(options, 'releaseResult');
  const state = {
    users: users.map(user => ({ ...user })),
    lockHeld,
    nextId: users.length + 1,
    connections: [],
  };

  return {
    state,
    async getConnection() {
      const calls = [];
      const connection = {
        calls,
        pendingUser: null,
        transactionActive: false,
        ownsLock: false,
        async execute(sql, params = []) {
          calls.push({ type: 'execute', sql, params });

          if (sql === `SELECT GET_LOCK('${LOCK_NAME}', 10) AS acquired`) {
            if (lockError) {
              if (options.lockMayHaveBeenAcquired) {
                state.lockHeld = true;
                connection.ownsLock = true;
              }
              throw lockError;
            }
            if (hasLockResult) {
              if (Number(options.lockResult) === 1) {
                state.lockHeld = true;
                connection.ownsLock = true;
              }
              return [[{ acquired: options.lockResult }]];
            }
            if (state.lockHeld) return [[{ acquired: 0 }]];
            state.lockHeld = true;
            connection.ownsLock = true;
            return [[{ acquired: 1 }]];
          }

          if (sql === `SELECT RELEASE_LOCK('${LOCK_NAME}') AS released`) {
            if (releaseError) throw releaseError;
            if (hasReleaseResult) {
              return [[{ released: options.releaseResult }]];
            }
            if (connection.ownsLock) {
              state.lockHeld = false;
              connection.ownsLock = false;
              return [[{ released: 1 }]];
            }
            return [[{ released: 0 }]];
          }

          if (sql === 'SELECT id FROM users LIMIT 1') {
            return [state.users.length > 0 ? [{ id: state.users[0].id }] : []];
          }

          if (/^INSERT INTO users/.test(sql)) {
            if (insertError) throw insertError;
            const [username, email, passwordHash] = params;
            connection.pendingUser = {
              id: state.nextId++,
              username,
              email,
              password_hash: passwordHash,
              role: 'admin',
              permission: 'global',
              status: 'active',
            };
            return [{ affectedRows: 1, insertId: connection.pendingUser.id }];
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async beginTransaction() {
          assert.equal(connection.transactionActive, false);
          calls.push({ type: 'begin' });
          if (beginError) {
            if (options.beginMayHaveStarted) connection.transactionActive = true;
            throw beginError;
          }
          connection.transactionActive = true;
        },
        async commit() {
          assert.equal(connection.transactionActive, true);
          calls.push({ type: 'commit' });
          if (commitError && !options.commitMayHaveApplied) throw commitError;
          if (connection.pendingUser) state.users.push(connection.pendingUser);
          connection.pendingUser = null;
          connection.transactionActive = false;
          if (commitError) throw commitError;
        },
        async rollback() {
          calls.push({ type: 'rollback' });
          if (rollbackError) throw rollbackError;
          if (!connection.transactionActive && !options.allowRollbackWhenInactive) {
            throw new Error('No active transaction');
          }
          connection.pendingUser = null;
          connection.transactionActive = false;
        },
        release() {
          calls.push({ type: 'release-connection' });
          if (connectionReleaseError) throw connectionReleaseError;
        },
        destroy() {
          calls.push({ type: 'destroy-connection' });
          connection.pendingUser = null;
          connection.transactionActive = false;
          if (connection.ownsLock) {
            state.lockHeld = false;
            connection.ownsLock = false;
          }
        },
      };

      state.connections.push(connection);
      return connection;
    },
  };
}

function validInput(overrides = {}) {
  return {
    username: 'first-admin',
    email: 'first@example.com',
    password: 'correct horse battery staple',
    ...overrides,
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    headers: {},
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('setup status handler issues a fresh CSRF cookie only while setup is available', async () => {
  const calls = [];
  const availableResponse = responseRecorder();
  const handler = createSetupStatusHandler({
    connectionLike: { name: 'pool' },
    getStatus: async connectionLike => {
      calls.push(connectionLike);
      return { initialized: false };
    },
    generateCsrfToken: () => 'random-csrf-token',
  });

  await handler({}, availableResponse);

  assert.deepEqual(calls, [{ name: 'pool' }]);
  assert.deepEqual(availableResponse.body, { initialized: false });
  assert.equal(availableResponse.cookies.length, 1);
  assert.equal(availableResponse.cookies[0].name, 'jcc_csrf');
  assert.equal(availableResponse.cookies[0].value, 'random-csrf-token');
  assert.equal(availableResponse.cookies[0].options.httpOnly, false);

  const initializedResponse = responseRecorder();
  await createSetupStatusHandler({
    connectionLike: {},
    getStatus: async () => ({ initialized: true }),
  })({}, initializedResponse);
  assert.deepEqual(initializedResponse.body, { initialized: true });
  assert.deepEqual(initializedResponse.cookies, []);
});

test('setup handler returns 201 without echoing the submitted password or password hash', async () => {
  const password = 'correct horse battery staple';
  const passwordHash = 'sensitive-password-hash';
  const input = validInput({ password });
  const response = responseRecorder();
  const calls = [];
  const handler = createSetupHandler({
    pool: { name: 'pool' },
    hashPassword: async () => passwordHash,
    createAdmin: async options => {
      calls.push(options);
      return {
        created: true,
        user: {
          id: 7,
          username: input.username,
          email: input.email,
          role: 'admin',
          permission: 'global',
          password,
          password_hash: passwordHash,
        },
      };
    },
  });

  await handler({ body: input }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, input);
  assert.equal(JSON.stringify(response.body).includes(password), false);
  assert.equal(JSON.stringify(response.body).includes(passwordHash), false);
  assert.deepEqual(response.body.user, {
    id: 7,
    username: input.username,
    email: input.email,
    role: 'admin',
    permission: 'global',
  });
});

test('setup handler maps initialized, busy, and validation outcomes to safe HTTP responses', async () => {
  const initializedResponse = responseRecorder();
  await createSetupHandler({
    createAdmin: async () => ({ created: false, reason: 'already_initialized' }),
  })({ body: validInput() }, initializedResponse);
  assert.equal(initializedResponse.statusCode, 409);
  assert.equal(initializedResponse.body.code, 'already_initialized');

  const busyResponse = responseRecorder();
  await createSetupHandler({
    createAdmin: async () => ({ created: false, reason: 'setup_busy' }),
  })({ body: validInput() }, busyResponse);
  assert.equal(busyResponse.statusCode, 503);
  assert.equal(busyResponse.headers['Retry-After'], '1');
  assert.equal(busyResponse.body.code, 'setup_busy');

  const secret = 'secret-value-that-must-not-leak';
  const invalidResponse = responseRecorder();
  await createSetupHandler({
    createAdmin: async () => { throw new SetupValidationError('password', `Invalid password: ${secret}`); },
  })({ body: validInput({ password: secret }) }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.body.field, 'password');
  assert.equal(JSON.stringify(invalidResponse.body).includes(secret), false);
});

test('setup handlers return generic server errors and never log secret values', async () => {
  const secret = 'database-error-secret';
  const logs = [];
  const logger = { error(...args) { logs.push(args); } };
  const unsafeError = new Error(secret);
  unsafeError.name = `Error-${secret}`;
  unsafeError.code = `CODE-${secret}`;

  for (const handler of [
    createSetupStatusHandler({ getStatus: async () => { throw unsafeError; }, logger }),
    createSetupHandler({ createAdmin: async () => { throw unsafeError; }, logger }),
  ]) {
    const response = responseRecorder();
    await handler({ body: validInput({ password: secret }) }, response);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
  }
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test('validateInitialAdmin trims the username, ignores email, and does not trim the password', () => {
  assert.deepEqual(validateInitialAdmin({
    username: '  管理员  ',
    email: '  Admin@Example.COM  ',
    password: '  twelve chars  ',
  }), {
    username: '管理员',
    email: null,
    password: '  twelve chars  ',
  });
});

test('validateInitialAdmin allows setup without an email address', () => {
  assert.deepEqual(validateInitialAdmin({
    username: 'first-admin',
    password: '12345678',
  }), {
    username: 'first-admin',
    email: null,
    password: '12345678',
  });
});

test('validateInitialAdmin rejects invalid username lengths and control characters', () => {
  for (const username of ['ab', 'x'.repeat(51), 'abc\u0000def', 'abc\u0085def']) {
    assert.throws(
      () => validateInitialAdmin(validInput({ username })),
      error => error instanceof SetupValidationError && error.field === 'username' && !error.message.includes(username)
    );
  }
});

test('validateInitialAdmin ignores every submitted email value', () => {
  for (const email of ['missing-at.example.com', 'a@b', `${'x'.repeat(94)}@a.test`]) {
    assert.equal(validateInitialAdmin(validInput({ email })).email, null);
  }
});

test('validateInitialAdmin rejects invalid password lengths without exposing the password', () => {
  for (const password of ['1234567', 'x'.repeat(129)]) {
    assert.throws(
      () => validateInitialAdmin(validInput({ password })),
      error => error instanceof SetupValidationError && error.field === 'password' && !error.message.includes(password)
    );
  }
});

test('validateInitialAdmin accepts all inclusive length boundaries', () => {
  assert.equal(validateInitialAdmin(validInput({ username: 'abc' })).username.length, 3);
  assert.equal(validateInitialAdmin(validInput({ username: 'x'.repeat(50) })).username.length, 50);
  assert.equal(validateInitialAdmin(validInput({ password: 'x'.repeat(8) })).password.length, 8);
  assert.equal(validateInitialAdmin(validInput({ password: 'x'.repeat(128) })).password.length, 128);
});

test('getSetupStatus reports empty and initialized user tables', async () => {
  const emptyConnection = {
    async execute(sql) {
      assert.equal(sql, 'SELECT id FROM users LIMIT 1');
      return [[]];
    },
  };
  const populatedConnection = {
    async execute(sql) {
      assert.equal(sql, 'SELECT id FROM users LIMIT 1');
      return [[{ id: 42 }]];
    },
  };

  assert.deepEqual(await getSetupStatus(emptyConnection), { initialized: false });
  assert.deepEqual(await getSetupStatus(populatedConnection), { initialized: true });
});

test('createInitialAdmin commits an explicit active global administrator', async () => {
  const pool = createStatefulPool();
  const hashCalls = [];

  const result = await createInitialAdmin({
    pool,
    input: validInput({ username: '  first-admin  ', email: '  First@Example.COM ' }),
    hashPassword: async password => {
      hashCalls.push(password);
      return 'hashed-password';
    },
  });

  assert.deepEqual(result, {
    created: true,
    user: {
      id: 1,
      username: 'first-admin',
      email: null,
      role: 'admin',
      permission: 'global',
    },
  });
  assert.deepEqual(hashCalls, ['correct horse battery staple']);
  assert.deepEqual(pool.state.users, [{
    id: 1,
    username: 'first-admin',
    email: null,
    password_hash: 'hashed-password',
    role: 'admin',
    permission: 'global',
    status: 'active',
  }]);

  const connection = pool.state.connections[0];
  const insert = connection.calls.find(call => call.type === 'execute' && /^INSERT INTO users/.test(call.sql));
  assert.match(insert.sql, /\(username, email, password_hash, role, permission, status\)/);
  assert.match(insert.sql, /VALUES \(\?, \?, \?, 'admin', 'global', 'active'\)/);
  assert.deepEqual(connection.calls.map(call => call.type), [
    'execute', 'begin', 'execute', 'execute', 'commit', 'execute', 'release-connection',
  ]);
  assert.equal(pool.state.lockHeld, false);
});

test('createInitialAdmin reports setup_busy when the advisory lock times out', async () => {
  const pool = createStatefulPool({ lockHeld: true });
  let hashCalls = 0;

  const result = await createInitialAdmin({
    pool,
    input: validInput(),
    hashPassword: async () => { hashCalls += 1; return 'unused'; },
  });

  assert.deepEqual(result, { created: false, reason: 'setup_busy' });
  assert.equal(hashCalls, 0);
  assert.deepEqual(pool.state.connections[0].calls.map(call => call.type), [
    'execute', 'release-connection',
  ]);
});

test('createInitialAdmin treats a null lock result as an internal error and safely releases', async () => {
  const nullPool = createStatefulPool({ lockResult: null });
  await assert.rejects(
    createInitialAdmin({ pool: nullPool, input: validInput(), hashPassword: async () => 'unused' }),
    error => error.message === 'Unable to acquire first-run setup lock'
  );
  assert.deepEqual(nullPool.state.connections[0].calls.map(call => call.type), [
    'execute', 'release-connection',
  ]);
});

test('createInitialAdmin preserves a rejected lock query and destroys its uncertain connection', async () => {
  const lockError = new Error('database lock query failed');
  const errorPool = createStatefulPool({ lockError, lockMayHaveBeenAcquired: true });
  await assert.rejects(
    createInitialAdmin({ pool: errorPool, input: validInput(), hashPassword: async () => 'unused' }),
    lockError
  );
  assert.deepEqual(errorPool.state.connections[0].calls.map(call => call.type), [
    'execute', 'destroy-connection',
  ]);
  assert.equal(errorPool.state.lockHeld, false);
});

test('createInitialAdmin preserves a begin error, attempts rollback, and destroys when begin may have started server-side', async () => {
  const beginError = new Error('begin response was lost');
  const pool = createStatefulPool({ beginError, beginMayHaveStarted: true });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'unused' }),
    beginError
  );

  const calls = pool.state.connections[0].calls;
  assert.deepEqual(calls.map(call => call.type), [
    'execute', 'begin', 'rollback', 'execute', 'destroy-connection',
  ]);
  assert.equal(calls.some(call => call.type === 'release-connection'), false);
  assert.equal(pool.state.lockHeld, false);
});

test('createInitialAdmin preserves an uncertain commit error and never returns the connection to the pool', async () => {
  const commitError = new Error('commit response was lost');
  const pool = createStatefulPool({
    commitError,
    commitMayHaveApplied: true,
    allowRollbackWhenInactive: true,
  });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
    commitError
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.filter(call => call.type === 'rollback').length, 1);
  assert.equal(calls.some(call => /RELEASE_LOCK/.test(call.sql || '')), true);
  assert.equal(calls.at(-1).type, 'destroy-connection');
  assert.equal(calls.some(call => call.type === 'release-connection'), false);
  assert.equal(pool.state.users.length, 1);
});

test('createInitialAdmin rejects a concurrent second caller while the first holds the lock', async () => {
  const pool = createStatefulPool();
  let allowHash;
  let hashingStarted;
  const hashing = new Promise(resolve => { hashingStarted = resolve; });
  const waitForHash = new Promise(resolve => { allowHash = resolve; });

  const firstCall = createInitialAdmin({
    pool,
    input: validInput(),
    hashPassword: async () => {
      hashingStarted();
      await waitForHash;
      return 'hashed-password';
    },
  });
  await hashing;

  const secondResult = await createInitialAdmin({
    pool,
    input: validInput({ username: 'second-admin', email: 'second@example.com' }),
    hashPassword: async () => 'second-hash',
  });
  assert.deepEqual(secondResult, { created: false, reason: 'setup_busy' });

  allowHash();
  const firstResult = await firstCall;
  assert.equal(firstResult.created, true);
  assert.equal(pool.state.users.length, 1);
  assert.equal(pool.state.users[0].username, 'first-admin');
  assert.equal(pool.state.connections.every(connection =>
    connection.calls.some(call => call.type === 'release-connection')), true);
});

test('createInitialAdmin rejects a later caller after the first transaction commits', async () => {
  const pool = createStatefulPool();
  const hashPassword = async () => 'hashed-password';

  assert.equal((await createInitialAdmin({ pool, input: validInput(), hashPassword })).created, true);
  assert.deepEqual(await createInitialAdmin({
    pool,
    input: validInput({ username: 'second-admin', email: 'second@example.com' }),
    hashPassword,
  }), { created: false, reason: 'already_initialized' });
  assert.equal(pool.state.users.length, 1);

  const secondConnection = pool.state.connections[1];
  assert.equal(secondConnection.calls.some(call => call.type === 'commit'), true);
  assert.equal(secondConnection.calls.some(call => call.type === 'rollback'), false);
  assert.equal(secondConnection.calls.some(call => /^INSERT INTO users/.test(call.sql || '')), false);
});

test('createInitialAdmin rolls back an active transaction and always releases lock and connection', async () => {
  const insertError = new Error('database write failed');
  const pool = createStatefulPool({ insertError });

  await assert.rejects(
    createInitialAdmin({
      pool,
      input: validInput(),
      hashPassword: async () => 'hashed-password',
    }),
    insertError
  );

  const connection = pool.state.connections[0];
  assert.equal(connection.calls.filter(call => call.type === 'rollback').length, 1);
  assert.equal(connection.calls.filter(call => call.type === 'commit').length, 0);
  assert.deepEqual(connection.calls.slice(-3).map(call => call.type), [
    'rollback', 'execute', 'release-connection',
  ]);
  assert.match(connection.calls.at(-2).sql, /RELEASE_LOCK/);
  assert.equal(pool.state.lockHeld, false);
  assert.equal(pool.state.users.length, 0);
});

test('createInitialAdmin preserves the primary error and destroys the connection when rollback rejects', async () => {
  const insertError = new Error('database write failed');
  const rollbackError = new Error('rollback failed with sensitive details');
  const pool = createStatefulPool({ insertError, rollbackError });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
    insertError
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.filter(call => call.type === 'rollback').length, 1);
  assert.equal(calls.some(call => /RELEASE_LOCK/.test(call.sql || '')), true);
  assert.equal(calls.at(-1).type, 'destroy-connection');
  assert.equal(calls.some(call => call.type === 'release-connection'), false);
});

test('createInitialAdmin preserves the primary error and destroys the connection when unlock rejects', async () => {
  const insertError = new Error('database write failed');
  const releaseError = new Error('unlock failed with sensitive details');
  const pool = createStatefulPool({ insertError, releaseError });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
    insertError
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.filter(call => call.type === 'rollback').length, 1);
  assert.equal(calls.at(-1).type, 'destroy-connection');
  assert.equal(calls.some(call => call.type === 'release-connection'), false);
});

test('createInitialAdmin throws a safe cleanup error and destroys after a committed unlock query rejects', async () => {
  const releaseError = new Error('unlock failed with sensitive details');
  const pool = createStatefulPool({ releaseError });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
    error => error instanceof SetupCleanupError &&
      error.message === 'First-run setup cleanup failed' &&
      !error.message.includes(releaseError.message)
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.some(call => call.type === 'commit'), true);
  assert.equal(calls.at(-1).type, 'destroy-connection');
  assert.equal(calls.some(call => call.type === 'release-connection'), false);
});

test('createInitialAdmin rejects released 0 and NULL as unsafe cleanup failures', async () => {
  for (const releaseResult of [0, null]) {
    const pool = createStatefulPool({ releaseResult });

    await assert.rejects(
      createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
      error => error instanceof SetupCleanupError && error.message === 'First-run setup cleanup failed'
    );

    const calls = pool.state.connections[0].calls;
    assert.equal(calls.at(-1).type, 'destroy-connection');
    assert.equal(calls.some(call => call.type === 'release-connection'), false);
  }
});

test('createInitialAdmin destroys and throws a safe cleanup error when connection release throws', async () => {
  const connectionReleaseError = new Error('pool release failed with sensitive details');
  const pool = createStatefulPool({ connectionReleaseError });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'hashed-password' }),
    error => error instanceof SetupCleanupError &&
      error.message === 'First-run setup cleanup failed' &&
      !error.message.includes(connectionReleaseError.message)
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.some(call => call.type === 'release-connection'), true);
  assert.equal(calls.at(-1).type, 'destroy-connection');
});

test('createInitialAdmin preserves a primary error when connection release also throws', async () => {
  const connectionReleaseError = new Error('pool release failed with sensitive details');
  const pool = createStatefulPool({ lockResult: null, connectionReleaseError });

  await assert.rejects(
    createInitialAdmin({ pool, input: validInput(), hashPassword: async () => 'unused' }),
    error => error.message === 'Unable to acquire first-run setup lock'
  );

  const calls = pool.state.connections[0].calls;
  assert.equal(calls.some(call => call.type === 'release-connection'), true);
  assert.equal(calls.at(-1).type, 'destroy-connection');
});
