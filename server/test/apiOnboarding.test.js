const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'api-onboarding-test',
  DB_PASSWORD: 'api-onboarding-test-password',
  DB_NAME: 'api_onboarding_test',
  JWT_SECRET: 'api-onboarding-test-secret-that-is-long-enough',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'api-onboarding-test',
  MINIO_SECRET_KEY: 'api-onboarding-test-secret',
  MINIO_BUCKET: 'api-onboarding-test',
});

const {
  completeApiOnboarding,
  getApiOnboardingStatus,
} = require('../services/apiOnboarding');

function connectionWith(rows) {
  return {
    calls: [],
    async execute(sql, params) {
      this.calls.push({ sql, params });
      return [rows];
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function requestRouter(router, mountPath, { method = 'GET', path = '/', body, headers = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const payload = body === undefined ? null : JSON.stringify(body);
    const requestPath = path === '/' ? mountPath : `${mountPath}${path}`;
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        method,
        path: requestPath,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, result => {
        let output = '';
        result.setEncoding('utf8');
        result.on('data', chunk => { output += chunk; });
        result.on('end', () => {
          try {
            resolve({ statusCode: result.statusCode, body: output ? JSON.parse(output) : null });
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(payload || undefined);
    });
    return response;
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function loadAuthRouter({ getStatus, logs }) {
  const authRoutePath = require.resolve('../routes/auth');
  const dependencies = {
    [require.resolve('../config/database')]: {
      pool: {
        async execute(sql, params) {
          if (/^SELECT id, username, email, password_hash, role, permission, status FROM users/.test(sql)) {
            const username = params[0];
            const isAdmin = username === 'admin';
            const bcrypt = require('bcryptjs');
            return [[{
              id: isAdmin ? 41 : 42,
              username,
              email: `${username}@example.test`,
              password_hash: bcrypt.hashSync('valid-password', 10),
              role: isAdmin ? 'admin' : 'user',
              permission: isAdmin ? 'global' : 'personal',
              status: 'active',
            }]];
          }
          if (/^INSERT INTO auth_sessions/.test(sql)) return [{ affectedRows: 1 }];
          throw new Error(`Unexpected database call: ${sql}`);
        },
      },
    },
    [require.resolve('../middleware/auth')]: {
      authenticateToken(req, res, next) {
        const kind = req.headers['x-test-user'];
        if (!kind) return res.status(401).json({ message: 'unauthenticated' });
        req.user = kind === 'admin'
          ? { id: 41, username: 'admin', email: 'admin@example.test', role: 'admin', permission: 'global' }
          : { id: 42, username: 'member', email: 'member@example.test', role: 'user', permission: 'personal' };
        req.sessionId = 'test-session';
        next();
      },
      requireAdmin(req, res, next) {
        if (req.user?.role !== 'admin') return res.status(403).json({ message: 'administrator required' });
        next();
      },
    },
    [require.resolve('../utils/logger')]: {
      warn() {},
      success() {},
      error(...values) { logs.push(values); },
    },
    [require.resolve('../services/apiOnboarding')]: { getApiOnboardingStatus: getStatus },
  };
  const saved = new Map(Object.keys(dependencies).map(path => [path, require.cache[path]]));
  const savedAuthRoute = require.cache[authRoutePath];

  delete require.cache[authRoutePath];
  for (const [path, exports] of Object.entries(dependencies)) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  }

  try {
    return require(authRoutePath);
  } finally {
    for (const [path, cached] of saved) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
    if (savedAuthRoute) require.cache[authRoutePath] = savedAuthRoute;
    else delete require.cache[authRoutePath];
  }
}

test('requires onboarding when neither a key nor a completion record exists', async () => {
  const connectionLike = connectionWith([]);

  const status = await getApiOnboardingStatus({ connectionLike, env: {} });

  assert.equal(status.required, true);
  assert.equal(status.apiKeyConfigured, false);
  assert.equal(status.completed, false);
  assert.equal(status.managedByEnvironment, false);
  assert.equal(status.defaultModel, 'gemini-3.6-flash');
  assert.deepEqual(connectionLike.calls[0], {
    sql: 'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)',
    params: ['api_onboarding_completed', 'gemini_api_key', 'gemini_default_model'],
  });
});

test('environment configuration satisfies provider setup without exposing its value', async () => {
  const status = await getApiOnboardingStatus({
    connectionLike: connectionWith([]),
    env: { GEMINI_API_KEY: 'secret' },
  });

  assert.deepEqual(status, {
    required: false,
    completed: false,
    apiKeyConfigured: true,
    managedByEnvironment: true,
    defaultModel: 'gemini-3.6-flash',
  });
  assert.equal(JSON.stringify(status).includes('secret'), false);
});

test('stored configuration counts only non-empty values and preserves the explicit completion marker', async () => {
  const status = await getApiOnboardingStatus({
    connectionLike: connectionWith([
      { config_key: 'api_onboarding_completed', config_value: 'true' },
      { config_key: 'gemini_api_key', config_value: '  stored-key  ' },
      { config_key: 'gemini_default_model', config_value: 'stored-model' },
    ]),
    env: { GEMINI_API_KEY: '   ', GEMINI_DEFAULT_MODEL: 'environment-model' },
  });

  assert.deepEqual(status, {
    required: false,
    completed: true,
    apiKeyConfigured: true,
    managedByEnvironment: false,
    defaultModel: 'environment-model',
  });
  assert.equal(JSON.stringify(status).includes('stored-key'), false);
});

test('blank stored default model falls back to the default model', async () => {
  const status = await getApiOnboardingStatus({
    connectionLike: connectionWith([
      { config_key: 'gemini_default_model', config_value: '   ' },
    ]),
    env: {},
  });

  assert.equal(status.defaultModel, 'gemini-3.6-flash');
});

test('onboarding status defaults to immutable boot provenance instead of mutable runtime values', async () => {
  const apiOnboarding = require('../services/apiOnboarding');
  assert.equal(typeof apiOnboarding.getBootGeminiEnvironment, 'function');
  const bootEnvironment = apiOnboarding.getBootGeminiEnvironment();
  assert.equal(Object.isFrozen(bootEnvironment), true);
  assert.notEqual(bootEnvironment, process.env);

  const originalRuntimeKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = 'runtime-db-copy-must-not-change-provenance';
    const status = await apiOnboarding.getApiOnboardingStatus({
      connectionLike: connectionWith([
        { config_key: 'gemini_api_key', config_value: 'stored-key' },
        { config_key: 'gemini_default_model', config_value: 'stored-model' },
      ]),
    });
    assert.equal(status.managedByEnvironment, typeof bootEnvironment.GEMINI_API_KEY === 'string'
      && bootEnvironment.GEMINI_API_KEY.trim() !== '');
  } finally {
    restoreEnv('GEMINI_API_KEY', originalRuntimeKey);
  }
});

test('completion persists the explicit marker and acting administrator without storing a secret', async () => {
  const pool = {
    calls: [],
    async execute(sql, params) {
      this.calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };

  assert.deepEqual(await completeApiOnboarding({ pool, userId: 42, skipped: true }), {
    completed: true,
    skipped: true,
  });
  assert.match(pool.calls[0].sql, /^INSERT INTO system_config/);
  assert.match(pool.calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(pool.calls[0].params, [
    'api_onboarding_completed', 'true', 'boolean', 'API onboarding completion marker', 42,
  ]);
});

test('onboarding route factory returns a secret-free status and permits only boolean skipped values', async () => {
  const { createApiOnboardingRouter } = require('../routes/systemConfig');
  const { requireAdmin } = require('../middleware/auth');
  const router = createApiOnboardingRouter({
    authenticateToken: (req, res, next) => { req.user = { id: 7, role: 'admin' }; next(); },
    requireAdmin,
    connectionLike: connectionWith([]),
    pool: { async execute() { return [{ affectedRows: 1 }]; } },
    env: { GEMINI_API_KEY: 'router-secret' },
  });
  const getLayer = router.stack.find(layer => layer.route?.path === '/');
  const putLayer = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.put);
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  const getResponse = response();
  await getLayer.route.stack.at(-1).handle({ user: { id: 7, role: 'admin' } }, getResponse);
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body.success, true);
  assert.equal(JSON.stringify(getResponse.body).includes('router-secret'), false);

  const invalidResponse = response();
  await putLayer.route.stack.at(-1).handle({ body: { skipped: 'true' }, user: { id: 7, role: 'admin' } }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);

  const nonAdminResponse = response();
  let nextCalled = false;
  const adminLayer = router.stack.find(layer => layer.handle === requireAdmin);
  adminLayer.handle({ user: { id: 8, role: 'user' } }, nonAdminResponse, () => { nextCalled = true; });
  assert.equal(nonAdminResponse.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('onboarding endpoint enforces the HTTP authentication chain and records the authenticated completion actor', async () => {
  const { createApiOnboardingRouter } = require('../routes/systemConfig');
  const { requireAdmin } = require('../middleware/auth');
  const connectionLike = connectionWith([]);
  const pool = { name: 'onboarding-pool' };
  const completionCalls = [];
  const router = createApiOnboardingRouter({
    authenticateToken(req, res, next) {
      const kind = req.headers['x-test-user'];
      if (!kind) return res.status(401).json({ message: 'unauthenticated' });
      req.user = kind === 'admin' ? { id: 73, role: 'admin' } : { id: 74, role: 'user' };
      next();
    },
    requireAdmin,
    connectionLike,
    pool,
    env: { GEMINI_API_KEY: 'system-config-secret' },
    async complete(options) {
      completionCalls.push(options);
      return { completed: true, skipped: options.skipped };
    },
  });
  const mountPath = '/api/system-config/onboarding';

  assert.equal((await requestRouter(router, mountPath)).statusCode, 401);
  assert.equal((await requestRouter(router, mountPath, { headers: { 'x-test-user': 'user' } })).statusCode, 403);

  const statusResponse = await requestRouter(router, mountPath, { headers: { 'x-test-user': 'admin' } });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusResponse.body, {
    success: true,
    data: {
      required: false,
      completed: false,
      apiKeyConfigured: true,
      managedByEnvironment: true,
      defaultModel: 'gemini-3.6-flash',
    },
  });
  assert.equal(JSON.stringify(statusResponse.body).includes('system-config-secret'), false);

  const invalidResponse = await requestRouter(router, mountPath, {
    method: 'PUT', headers: { 'x-test-user': 'admin' }, body: { skipped: 'true' },
  });
  assert.equal(invalidResponse.statusCode, 400);

  const completionResponse = await requestRouter(router, mountPath, {
    method: 'PUT', headers: { 'x-test-user': 'admin' }, body: { skipped: true },
  });
  assert.deepEqual(completionResponse, { statusCode: 200, body: { success: true, data: { completed: true, skipped: true } } });
  assert.deepEqual(completionCalls, [{ pool, userId: 73, skipped: true }]);
});

test('administrator auth responses include only the boolean onboarding requirement and fail safely', async () => {
  const { withApiOnboardingRequirement } = require('../routes/auth');
  const admin = { id: 1, username: 'admin', role: 'admin', permission: 'global' };
  const user = { id: 2, username: 'user', role: 'user', permission: 'personal' };
  let calls = 0;

  assert.deepEqual(await withApiOnboardingRequirement(admin, {
    connectionLike: {},
    getStatus: async () => { calls += 1; return { required: false, apiKeyConfigured: true, completed: false }; },
    logger: { error() {} },
  }), { ...admin, apiOnboardingRequired: false });
  assert.deepEqual(await withApiOnboardingRequirement(user, {
    connectionLike: {},
    getStatus: async () => { calls += 1; return { required: false }; },
    logger: { error() {} },
  }), user);
  assert.equal(calls, 1);

  assert.deepEqual(await withApiOnboardingRequirement(admin, {
    connectionLike: {},
    getStatus: async () => { throw new Error('database-secret'); },
    logger: { error() {} },
  }), { ...admin, apiOnboardingRequired: true });
});

test('auth login and verify endpoints return only the administrator onboarding boolean', async () => {
  const logs = [];
  let statusCalls = 0;
  const router = loadAuthRouter({
    logs,
    async getStatus() {
      statusCalls += 1;
      return { required: false, completed: false, apiKeyConfigured: true, managedByEnvironment: true };
    },
  });
  const mountPath = '/api/auth';
  const adminUser = {
    id: 41, username: 'admin', email: 'admin@example.test', role: 'admin', permission: 'global', apiOnboardingRequired: false,
  };
  const memberUser = {
    id: 42, username: 'member', email: 'member@example.test', role: 'user', permission: 'personal',
  };

  const adminLogin = await requestRouter(router, mountPath, {
    method: 'POST', path: '/login', body: { username: 'admin', password: 'valid-password' },
  });
  assert.equal(adminLogin.statusCode, 200);
  assert.deepEqual(adminLogin.body.user, adminUser);
  assert.equal('apiKeyConfigured' in adminLogin.body.user, false);

  const memberLogin = await requestRouter(router, mountPath, {
    method: 'POST', path: '/login', body: { username: 'member', password: 'valid-password' },
  });
  assert.equal(memberLogin.statusCode, 200);
  assert.deepEqual(memberLogin.body.user, memberUser);
  assert.equal('apiOnboardingRequired' in memberLogin.body.user, false);

  const adminVerify = await requestRouter(router, mountPath, { path: '/verify', headers: { 'x-test-user': 'admin' } });
  assert.equal(adminVerify.statusCode, 200);
  assert.deepEqual(adminVerify.body.user, adminUser);

  const memberVerify = await requestRouter(router, mountPath, { path: '/verify', headers: { 'x-test-user': 'member' } });
  assert.equal(memberVerify.statusCode, 200);
  assert.deepEqual(memberVerify.body.user, memberUser);
  assert.equal(statusCalls, 2);
  assert.equal(logs.length, 0);
});

test('auth login and verify fail safely when the onboarding status service fails', async () => {
  const secret = 'database-error-secret';
  const logs = [];
  const router = loadAuthRouter({
    logs,
    async getStatus() { throw new Error(secret); },
  });
  const mountPath = '/api/auth';

  const login = await requestRouter(router, mountPath, {
    method: 'POST', path: '/login', body: { username: 'admin', password: 'valid-password' },
  });
  const verify = await requestRouter(router, mountPath, { path: '/verify', headers: { 'x-test-user': 'admin' } });

  for (const response of [login, verify]) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.apiOnboardingRequired, true);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
  }
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

function handlerResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('Gemini key handler rejects redaction sentinels case-insensitively before persistence', async () => {
  const { createGeminiKeyUpdateHandler } = require('../routes/systemConfig');
  assert.equal(typeof createGeminiKeyUpdateHandler, 'function');
  const calls = [];
  const handler = createGeminiKeyUpdateHandler({
    configService: {
      async updateConfig(...args) { calls.push(['update', ...args]); },
      async applyConfigs() { calls.push(['apply']); },
    },
  });

  for (const apiKey of ['[REDACTED]', '[redacted]', '  [ReDaCtEd]  ']) {
    const response = handlerResponse();
    await handler({ body: { apiKey }, user: { id: 42 } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.stringify(response.body).toLowerCase().includes('redacted'), false);
  }
  assert.deepEqual(calls, []);
});

test('Gemini key handler persists a real replacement and returns generic storage failures', async () => {
  const { createGeminiKeyUpdateHandler } = require('../routes/systemConfig');
  assert.equal(typeof createGeminiKeyUpdateHandler, 'function');
  const secret = 'real-gemini-key-secret';
  const calls = [];
  const successHandler = createGeminiKeyUpdateHandler({
    configService: {
      async updateConfig(...args) { calls.push(['update', ...args]); },
      async applyConfigs() { calls.push(['apply']); return true; },
    },
  });
  const successResponse = handlerResponse();
  await successHandler({ body: { apiKey: `  ${secret}  ` }, user: { id: 42 } }, successResponse);
  assert.equal(successResponse.statusCode, 200);
  assert.deepEqual(calls, [
    ['update', 'gemini_api_key', secret, 42],
    ['apply'],
  ]);

  const records = [];
  const originalError = console.error;
  console.error = (...values) => records.push(values.join(' '));
  try {
    const failureHandler = createGeminiKeyUpdateHandler({
      configService: {
        async updateConfig() { throw new Error(secret); },
        async applyConfigs() { throw new Error(secret); },
      },
    });
    const failureResponse = handlerResponse();
    await failureHandler({ body: { apiKey: secret }, user: { id: 42 } }, failureResponse);
    assert.equal(failureResponse.statusCode, 500);
    assert.equal(`${JSON.stringify(failureResponse.body)}\n${records.join('\n')}`.includes(secret), false);
  } finally {
    console.error = originalError;
  }
});
