const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const relayModulePath = path.join(__dirname, '../utils/relayConfig.js');
const relayModule = fs.existsSync(relayModulePath) ? require(relayModulePath) : {};
const {
  MAX_RELAY_TOKEN_LENGTH,
  RelayConfigValidationError,
  createRelayConfigUpdateHandler,
  loadValidatedRelayConfig,
  readRelayConfigSnapshot,
  updateRelayConfigTransaction,
  validateRelayConfigUpdate,
} = relayModule;

function assertValidatorAvailable() {
  assert.equal(typeof validateRelayConfigUpdate, 'function', 'relay config validator must exist');
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('accepts HTTPS relay URLs and loopback HTTP development URLs', () => {
  assertValidatorAvailable();
  assert.equal(validateRelayConfigUpdate('proxy_service_url', 'https://relay.example.com'), 'https://relay.example.com');
  assert.equal(validateRelayConfigUpdate('proxy_service_url', 'http://127.0.0.1:9001'), 'http://127.0.0.1:9001');
  assert.equal(validateRelayConfigUpdate('proxy_service_url', 'http://localhost:9001'), 'http://localhost:9001');
  assert.equal(validateRelayConfigUpdate('proxy_service_url', 'http://[::1]:9001'), 'http://[::1]:9001');
  assert.equal(validateRelayConfigUpdate('proxy_service_url', ''), '');
});

test('rejects embedded credentials and non-loopback plaintext relay URLs', () => {
  assertValidatorAvailable();
  assert.throws(() => validateRelayConfigUpdate('proxy_service_url', 'https://user:pass@example.com'));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_url', 'http://relay.example.com'));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_url', 'ftp://127.0.0.1:9001'));
});

test('allows only the existing relay keys and validates booleans and bounded tokens', () => {
  assertValidatorAvailable();
  assert.equal(validateRelayConfigUpdate('proxy_service_enabled', true), true);
  assert.equal(validateRelayConfigUpdate('proxy_service_enabled', false), false);
  assert.equal(validateRelayConfigUpdate('proxy_service_auth_token', 'opaque-token'), 'opaque-token');
  assert.equal(validateRelayConfigUpdate('proxy_service_auth_token', ''), '');
  assert.throws(() => validateRelayConfigUpdate('proxy_service_enabled', 'true'));
  assert.throws(() => validateRelayConfigUpdate('gemini_api_key', 'not-allowed'));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_auth_token', 'line\nbreak'));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_auth_token', '[REDACTED]'));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_auth_token', '  [redacted]  '));
  assert.throws(() => validateRelayConfigUpdate('proxy_service_auth_token', 'x'.repeat(4097)));
  assert.equal(MAX_RELAY_TOKEN_LENGTH, 4096);
});

test('one stored relay loader validates every enabled snapshot and strips disabled secrets', async () => {
  assert.equal(typeof loadValidatedRelayConfig, 'function', 'stored relay loader must exist');
  const values = {
    proxy_service_enabled: true,
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  };
  let snapshotReads = 0;
  const configService = {
    async getRelayConfigSnapshot() {
      snapshotReads += 1;
      return { ...values };
    },
    async getConfig() {
      throw new Error('security-sensitive relay state must bypass the per-key cache');
    },
  };

  assert.deepEqual(await loadValidatedRelayConfig(configService), {
    enabled: true,
    url: 'https://relay.example.com',
    authToken: 'stored-secret',
  });

  for (const invalid of [
    { proxy_service_url: 'http://relay.example.com' },
    { proxy_service_url: 'https://user:pass@relay.example.com' },
    { proxy_service_auth_token: '[REDACTED]' },
    { proxy_service_auth_token: '' },
    { proxy_service_url: null },
  ]) {
    Object.assign(values, {
      proxy_service_enabled: true,
      proxy_service_url: 'https://relay.example.com',
      proxy_service_auth_token: 'stored-secret',
    }, invalid);
    await assert.rejects(loadValidatedRelayConfig(configService), RelayConfigValidationError);
  }

  Object.assign(values, {
    proxy_service_enabled: false,
    proxy_service_url: 'http://legacy.invalid',
    proxy_service_auth_token: 'legacy-secret',
  });
  assert.deepEqual(await loadValidatedRelayConfig(configService), {
    enabled: false,
    url: '',
    authToken: '',
  });
  await assert.rejects(
    loadValidatedRelayConfig(configService, { requireEnabled: true }),
    RelayConfigValidationError
  );
  assert.equal(snapshotReads, 8);
});

test('relay snapshot reader uses one uncached SELECT for all three rows', async () => {
  assert.equal(typeof readRelayConfigSnapshot, 'function', 'relay snapshot reader must exist');
  const calls = [];
  const connectionLike = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[
        { config_key: 'proxy_service_enabled', config_value: 'true', config_type: 'boolean' },
        { config_key: 'proxy_service_url', config_value: 'https://relay.example.com', config_type: 'string' },
        { config_key: 'proxy_service_auth_token', config_value: 'stored-secret', config_type: 'string' },
      ]];
    },
  };

  assert.deepEqual(await readRelayConfigSnapshot(connectionLike), {
    proxy_service_enabled: true,
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /proxy_service_enabled[\s\S]*proxy_service_url[\s\S]*proxy_service_auth_token/);
  assert.equal(calls[0].sql.includes('FOR UPDATE'), false);
  assert.deepEqual(calls[0].params, []);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createRelayTransactionPool(initial, hooks = {}) {
  const state = { ...initial };
  const calls = [];
  let lockTail = Promise.resolve();

  return {
    state,
    calls,
    async getConnection() {
      let unlock;
      let transactionActive = false;
      return {
        async beginTransaction() {
          calls.push('begin');
          transactionActive = true;
        },
        async execute(sql, params = []) {
          if (/FOR UPDATE/i.test(sql)) {
            calls.push('select-for-update');
            if (hooks.onSelectForUpdate) {
              await hooks.onSelectForUpdate(calls.filter(call => call === 'select-for-update').length);
            }
            const previous = lockTail;
            lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
            return [[
              { config_key: 'proxy_service_enabled', config_value: state.proxy_service_enabled, config_type: 'boolean' },
              { config_key: 'proxy_service_url', config_value: state.proxy_service_url, config_type: 'string' },
              { config_key: 'proxy_service_auth_token', config_value: state.proxy_service_auth_token, config_type: 'string' },
            ]];
          }
          if (/^\s*UPDATE system_config/i.test(sql)) {
            const [configValue, configType, userId, key] = params;
            calls.push({ type: 'update', key, configValue, configType, userId });
            if (hooks.beforeUpdate) await hooks.beforeUpdate(key);
            if (hooks.updateError) throw hooks.updateError;
            state[key] = configValue;
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async commit() {
          calls.push('commit');
          transactionActive = false;
          if (unlock) unlock();
        },
        async rollback() {
          calls.push('rollback');
          transactionActive = false;
          if (unlock) unlock();
        },
        release() { calls.push('release'); },
        destroy() { calls.push('destroy'); if (transactionActive && unlock) unlock(); },
      };
    },
  };
}

test('relay mutation locks all three rows, commits one actor-attributed update, and releases', async () => {
  assert.equal(typeof updateRelayConfigTransaction, 'function', 'atomic relay update must exist');
  const pool = createRelayTransactionPool({
    proxy_service_enabled: 'false',
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  });

  assert.equal(await updateRelayConfigTransaction({
    pool,
    key: 'proxy_service_enabled',
    value: true,
    userId: 42,
  }), true);

  assert.deepEqual(pool.calls, [
    'begin',
    'select-for-update',
    { type: 'update', key: 'proxy_service_enabled', configValue: 'true', configType: 'boolean', userId: 42 },
    'commit',
    'release',
  ]);
  assert.equal(pool.state.proxy_service_enabled, 'true');
});

test('relay mutation rolls back and releases on a storage failure without exposing details', async () => {
  assert.equal(typeof updateRelayConfigTransaction, 'function', 'atomic relay update must exist');
  const secret = 'storage-secret-details';
  const pool = createRelayTransactionPool({
    proxy_service_enabled: 'false',
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  }, { updateError: new Error(secret) });

  await assert.rejects(
    updateRelayConfigTransaction({
      pool,
      key: 'proxy_service_url',
      value: 'https://replacement.example.com',
      userId: 7,
    }),
    error => !error.message.includes(secret)
  );
  assert.deepEqual(pool.calls.slice(-2), ['rollback', 'release']);
});

test('concurrent enable and destination mutation serialize to a safe enabled snapshot', async () => {
  assert.equal(typeof updateRelayConfigTransaction, 'function', 'atomic relay update must exist');
  const enableAtUpdate = deferred();
  const mutationAtLock = deferred();
  const allowEnableCommit = deferred();
  const pool = createRelayTransactionPool({
    proxy_service_enabled: 'false',
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  }, {
    async onSelectForUpdate(sequence) {
      if (sequence === 2) mutationAtLock.resolve();
    },
    async beforeUpdate(key) {
      if (key === 'proxy_service_enabled') {
        enableAtUpdate.resolve();
        await allowEnableCommit.promise;
      }
    },
  });

  const enable = updateRelayConfigTransaction({
    pool,
    key: 'proxy_service_enabled',
    value: true,
    userId: 1,
  });
  await enableAtUpdate.promise;
  const mutate = updateRelayConfigTransaction({
    pool,
    key: 'proxy_service_url',
    value: '',
    userId: 2,
  });
  await mutationAtLock.promise;
  allowEnableCommit.resolve();

  const [enableResult, mutateResult] = await Promise.allSettled([enable, mutate]);
  assert.equal(enableResult.status, 'fulfilled');
  assert.equal(mutateResult.status, 'rejected');
  assert.equal(mutateResult.reason instanceof RelayConfigValidationError, true);
  assert.deepEqual(pool.state, {
    proxy_service_enabled: 'true',
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: 'stored-secret',
  });
});

test('generic relay update handler rejects URL and token mutations while relay is enabled', async () => {
  assert.equal(typeof createRelayConfigUpdateHandler, 'function', 'relay update handler must exist');
  const secret = 'replacement-secret';
  const calls = [];
  const handler = createRelayConfigUpdateHandler({
    configService: {
      async updateRelayConfig(...args) {
        calls.push(args);
        throw new RelayConfigValidationError();
      },
    },
  });

  for (const [key, value] of [
    ['proxy_service_url', 'https://replacement.example.com'],
    ['proxy_service_url', ''],
    ['proxy_service_auth_token', secret],
    ['proxy_service_auth_token', ''],
  ]) {
    const res = response();
    await handler({ params: { key }, body: { value }, user: { id: 7 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.stringify(res.body).includes(secret), false);
  }

  assert.deepEqual(calls, [
    ['proxy_service_url', 'https://replacement.example.com', 7],
    ['proxy_service_url', '', 7],
    ['proxy_service_auth_token', secret, 7],
    ['proxy_service_auth_token', '', 7],
  ]);
});

test('validation failures never echo relay tokens', () => {
  assertValidatorAvailable();
  const secret = `secret-${'x'.repeat(4097)}`;
  assert.throws(
    () => validateRelayConfigUpdate('proxy_service_auth_token', secret),
    (error) => !error.message.includes(secret)
  );
});

test('generic relay update handler rejects other keys and requires valid saved configuration before enabling', async () => {
  assert.equal(typeof createRelayConfigUpdateHandler, 'function', 'relay update handler must exist');
  const secret = 'saved-relay-secret';
  const calls = [];
  const configService = {
    async updateRelayConfig(...args) {
      calls.push(args);
      throw new RelayConfigValidationError();
    },
  };
  const handler = createRelayConfigUpdateHandler({ configService });

  const unrelated = response();
  await handler({ params: { key: 'gemini_api_key' }, body: { value: 'x' }, user: { id: 7 } }, unrelated);
  assert.equal(unrelated.statusCode, 400);

  const enabled = response();
  await handler({ params: { key: 'proxy_service_enabled' }, body: { value: true }, user: { id: 7 } }, enabled);
  assert.equal(enabled.statusCode, 400);
  assert.equal(JSON.stringify(enabled.body).includes(secret), false);
  assert.deepEqual(calls, [['proxy_service_enabled', true, 7]]);
});

test('generic relay update handler uses the authenticated actor and accepts a valid enablement', async () => {
  assert.equal(typeof createRelayConfigUpdateHandler, 'function', 'relay update handler must exist');
  const calls = [];
  const handler = createRelayConfigUpdateHandler({
    configService: {
      async updateRelayConfig(...args) { calls.push(args); return true; },
    },
  });
  const res = response();

  await handler({
    params: { key: 'proxy_service_enabled' },
    body: { value: true, userId: 999 },
    user: { id: 42 },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [['proxy_service_enabled', true, 42]]);
});

test('system configuration UI uses accurate API relay wording and explicit enablement confirmation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SystemConfig.jsx'), 'utf8');
  const routeSource = fs.readFileSync(path.join(__dirname, '../routes/systemConfig.js'), 'utf8');

  assert.match(source, /API 中继服务/);
  assert.match(source, /OPTIONAL/);
  assert.match(source, /不是 VPN/);
  assert.match(source, /Gemini 视频数据会发送到你配置的中继地址/);
  assert.match(source, /确认启用 API 中继/);
  assert.match(source, /隐私政策、数据跨境与内容合规要求/);
  assert.match(source, /Modal\.confirm/);
  assert.doesNotMatch(source, /代理/);
  assert.doesNotMatch(routeSource, /代理/);
});

test('system configuration UI treats relay auth tokens as write-only replacements', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SystemConfig.jsx'), 'utf8');

  assert.match(source, /configs\.proxy_service_auth_token\?\.configured/);
  assert.match(source, /已配置；输入新密钥可替换/);
  assert.match(source, /relayDraft\.token/);
  assert.match(source, /disabled=\{relayEnabled \|\| !relayDraft\.token\.trim\(\)\}/);
  assert.match(source, /setRelayDraft\(current => \(\{ \.\.\.current, token: '' \}\)\)/);
  assert.doesNotMatch(source, /configs\.proxy_service_auth_token\?\.value/);
});

test('system configuration UI treats the Gemini API key as a write-only replacement', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SystemConfig.jsx'), 'utf8');

  assert.match(source, /configs\.gemini_api_key\?\.configured/);
  assert.match(source, /setGeminiKeyOpen\(true\)/);
  assert.match(source, /disabled: !geminiKeyDraft\.trim\(\)/);
  assert.match(source, /setGeminiKeyDraft\(''\)/);
  assert.doesNotMatch(source, /configs\.gemini_api_key\?\.value/);
});

test('system configuration UI closes and disables URL and token editors whenever relay is enabled', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SystemConfig.jsx'), 'utf8');

  assert.match(source, /const relayEnabled = configs\.proxy_service_enabled\?\.value === true/);
  assert.match(source, /value=\{relayDraft\.url\} disabled=\{relayEnabled\}/);
  assert.match(source, /value=\{relayDraft\.token\} disabled=\{relayEnabled\}/);
  assert.match(source, /if \(isSecret\) setRelayDraft\(current => \(\{ \.\.\.current, token: '' \}\)\)/);
});

test('system configuration reload clears stale relay drafts on an observed enable transition', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SystemConfig.jsx'), 'utf8');

  assert.match(source, /setRelayDraft\(current => \(\{[\s\S]*url: data\.proxy_service_url\?\.value \|\| '',[\s\S]*token: '',[\s\S]*\}\)\)/);
  assert.match(source, /await loadConfigs\(\)/);
});
