const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'runtime-config-test',
  DB_PASSWORD: 'runtime-config-test-password',
  DB_NAME: 'runtime_config_test',
});

const PythonGeminiService = require('../services/pythonGeminiService');
const ProxyGeminiService = require('../services/proxyGeminiService');
const systemConfigService = require('../services/systemConfigService');
const { getApiOnboardingStatus } = require('../services/apiOnboarding');
const { SystemConfigService, captureGeminiEnvironment } = systemConfigService;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const SAFE_CONNECTION_FAILURE = {
  success: false,
  message: 'Unable to verify Gemini API connection',
};

test('immutable non-empty boot Gemini environment values override stored rotations', async () => {
  assert.equal(typeof SystemConfigService, 'function', 'constructible config service must be exported');
  assert.equal(typeof captureGeminiEnvironment, 'function', 'boot environment capture must be exported');
  const runtimeEnvironment = {};
  const bootEnvironment = captureGeminiEnvironment({
    GEMINI_API_KEY: 'explicit-api-key',
    GEMINI_DEFAULT_MODEL: 'explicit-model',
    GEMINI_AVAILABLE_MODELS: 'explicit-model,explicit-model-pro',
  });
  const service = new SystemConfigService({ bootEnvironment, runtimeEnvironment });
  let storedVersion = 1;
  service.getAllConfigs = async () => ({
    gemini_api_key: { value: `stored-api-key-v${storedVersion}` },
    gemini_default_model: { value: `stored-model-v${storedVersion}` },
    gemini_available_models: { value: [`stored-model-v${storedVersion}`] },
  });

  assert.equal(Object.isFrozen(bootEnvironment), true);
  assert.equal(await service.applyConfigs(), true);
  storedVersion = 2;
  assert.equal(await service.applyConfigs(), true);
  assert.deepEqual(runtimeEnvironment, {
    GEMINI_API_KEY: 'explicit-api-key',
    GEMINI_DEFAULT_MODEL: 'explicit-model',
    GEMINI_AVAILABLE_MODELS: 'explicit-model,explicit-model-pro',
  });
});

test('blank boot Gemini environment accepts DB startup load and immediate v2 rotation without changing provenance', async () => {
  assert.equal(typeof SystemConfigService, 'function', 'constructible config service must be exported');
  assert.equal(typeof captureGeminiEnvironment, 'function', 'boot environment capture must be exported');
  const runtimeEnvironment = {};
  const bootEnvironment = captureGeminiEnvironment({
    GEMINI_API_KEY: '',
    GEMINI_DEFAULT_MODEL: '   ',
  });
  const service = new SystemConfigService({ bootEnvironment, runtimeEnvironment });
  let storedVersion = 1;
  const storedRows = () => [
    { config_key: 'api_onboarding_completed', config_value: 'false' },
    { config_key: 'gemini_api_key', config_value: `stored-api-key-v${storedVersion}` },
    { config_key: 'gemini_default_model', config_value: `stored-model-v${storedVersion}` },
  ];
  service.getAllConfigs = async () => ({
    gemini_api_key: { value: `stored-api-key-v${storedVersion}` },
    gemini_default_model: { value: `stored-model-v${storedVersion}` },
    gemini_available_models: { value: [`stored-model-v${storedVersion}`, `stored-model-pro-v${storedVersion}`] },
  });

  assert.equal(await service.applyConfigs(), true);
  assert.equal(runtimeEnvironment.GEMINI_API_KEY, 'stored-api-key-v1');
  assert.equal(runtimeEnvironment.GEMINI_DEFAULT_MODEL, 'stored-model-v1');
  assert.equal((await getApiOnboardingStatus({
    connectionLike: { async execute() { return [storedRows()]; } },
    env: service.bootEnvironment,
  })).managedByEnvironment, false);

  storedVersion = 2;
  assert.equal(await service.applyConfigs(), true);
  assert.deepEqual(runtimeEnvironment, {
    GEMINI_API_KEY: 'stored-api-key-v2',
    GEMINI_DEFAULT_MODEL: 'stored-model-v2',
    GEMINI_AVAILABLE_MODELS: 'stored-model-v2,stored-model-pro-v2',
  });
  assert.deepEqual(await getApiOnboardingStatus({
    connectionLike: { async execute() { return [storedRows()]; } },
    env: service.bootEnvironment,
  }), {
    required: false,
    completed: false,
    apiKeyConfigured: true,
    managedByEnvironment: false,
    defaultModel: 'stored-model-v2',
  });
});

test('relay model selection uses immutable boot provenance instead of a mutable runtime DB copy', async () => {
  const originalRuntimeModel = process.env.GEMINI_DEFAULT_MODEL;
  try {
    process.env.GEMINI_DEFAULT_MODEL = 'stored-model-v1';
    const configService = new SystemConfigService({
      bootEnvironment: captureGeminiEnvironment({}),
      runtimeEnvironment: process.env,
    });
    configService.getRelayConfigSnapshot = async () => ({
      proxy_service_enabled: true,
      proxy_service_url: 'https://relay.example.com',
      proxy_service_auth_token: 'relay-secret',
    });
    configService.getConfig = async (key) => {
      assert.equal(key, 'gemini_default_model');
      return 'stored-model-v2';
    };
    const service = new ProxyGeminiService();
    service.systemConfigService = configService;

    const selected = await service.setProxyEnvironment();

    assert.equal(selected.defaultModel, 'stored-model-v2');
    assert.equal(process.env.GEMINI_DEFAULT_MODEL, 'stored-model-v1');
  } finally {
    restoreEnv('GEMINI_DEFAULT_MODEL', originalRuntimeModel);
  }
});

test('enabled relay with invalid or unreadable configuration fails closed', async () => {
  const service = new PythonGeminiService();
  const stored = {
    proxy_service_enabled: true,
    proxy_service_url: 'http://relay.example.com',
    proxy_service_auth_token: 'runtime-secret',
  };
  service.systemConfigService = {
    async getRelayConfigSnapshot() { return { ...stored }; },
  };

  await assert.rejects(service.shouldUseProxy(), (error) => {
    assert.match(error.message, /API relay configuration is invalid/);
    assert.equal(error.message.includes(stored.proxy_service_auth_token), false);
    return true;
  });

  service.systemConfigService = {
    async getRelayConfigSnapshot() { throw new Error('database details'); },
  };
  await assert.rejects(service.shouldUseProxy(), /API relay configuration is unavailable/);
});

test('AI operations never call direct Gemini when an enabled relay is incomplete', async () => {
  const stored = {
    proxy_service_enabled: true,
    proxy_service_url: 'https://relay.example.com',
    proxy_service_auth_token: '',
  };
  const service = new PythonGeminiService();
  let directCalls = 0;
  service.systemConfigService = {
    async getRelayConfigSnapshot() { return { ...stored }; },
  };
  service.callPythonService = async () => {
    directCalls += 1;
    return { success: true, text: 'direct' };
  };

  const results = await Promise.allSettled([
    service.analyzeContent('prompt', 'content'),
    service.analyzeNovel('prompt', 'content'),
  ]);

  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(directCalls, 0);
});

test('invalid stored relay values never invoke a proxy subprocess from business or test calls', async () => {
  const invalidSnapshots = [
    { url: 'http://relay.example.com', token: 'stored-secret' },
    { url: 'https://user:pass@relay.example.com', token: 'stored-secret' },
    { url: 'https://relay.example.com', token: '[REDACTED]' },
    { url: 'https://relay.example.com', token: '' },
  ];

  for (const snapshot of invalidSnapshots) {
    let spawnCalls = 0;
    const service = new ProxyGeminiService();
    service.systemConfigService = {
      selectGeminiRuntimeConfigValue: systemConfigService.selectGeminiRuntimeConfigValue.bind(systemConfigService),
      async getRelayConfigSnapshot() {
        return {
          proxy_service_enabled: true,
          proxy_service_url: snapshot.url,
          proxy_service_auth_token: snapshot.token,
        };
      },
      async getConfig(key) {
        if (key === 'gemini_default_model') return 'stored-model';
        throw new Error('relay state must not use per-key cache reads');
      },
    };
    service.spawnProcess = () => {
      spawnCalls += 1;
      throw new Error('subprocess must not be invoked');
    };

    await assert.rejects(service.generateText('content'), /relay configuration/i);
    const connectionResult = await service.testConnection();
    assert.equal(connectionResult.success, false);
    assert.equal(spawnCalls, 0);
  }
});

test('system relay connection test rejects invalid stored values before proxy service execution', async () => {
  const originalGetRelayConfigSnapshot = systemConfigService.getRelayConfigSnapshot;
  try {
    const stored = {
      proxy_service_enabled: true,
      proxy_service_url: 'http://relay.example.com',
      proxy_service_auth_token: 'stored-secret',
    };
    systemConfigService.getRelayConfigSnapshot = async () => ({ ...stored });
    const result = await systemConfigService.testProxyConnection();
    assert.equal(result.success, false);
    assert.match(`${result.message} ${result.details}`, /relay configuration/i);
    assert.equal(`${result.message} ${result.details}`.includes(stored.proxy_service_auth_token), false);
  } finally {
    systemConfigService.getRelayConfigSnapshot = originalGetRelayConfigSnapshot;
  }
});

function successfulProxyChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from('{"success":true}'));
    child.emit('close', 0);
  });
  return child;
}

function createConnectionTestService({
  apiKey = 'gemini-test-secret',
  spawnProcess,
  // Real child-process fixtures run alongside the full parallel suite on CI and
  // slower Windows hosts; keep this well above process startup jitter. Tests of
  // timeout behavior pass an explicit short value below.
  timeoutMs = 2_000,
  maxOutputBytes = 64 * 1024,
  pythonCommand = process.execPath,
  pythonServicePath = 'unused-test-child.js',
} = {}) {
  const service = Object.create(systemConfigService);
  service.getConfig = async (key) => key === 'gemini_api_key' ? apiKey : null;
  service.spawnProcess = spawnProcess;
  service.geminiTestTimeoutMs = timeoutMs;
  service.geminiTestMaxOutputBytes = maxOutputBytes;
  service.pythonCommand = pythonCommand;
  service.pythonServicePath = pythonServicePath;
  return service;
}

function createInjectedChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = { end() {} };
  child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); return true; };
  return child;
}

function createNodeFixture(source) {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, '.jcc-gemini-connection-'));
  const fixturePath = path.join(fixtureDir, 'child.js');
  fs.writeFileSync(fixturePath, source, 'utf8');
  return { fixtureDir, fixturePath };
}

async function captureConsole(action) {
  const records = [];
  const originalError = console.error;
  console.error = (...values) => records.push(values.join(' '));
  try {
    return { result: await action(), output: records.join('\n') };
  } finally {
    console.error = originalError;
  }
}

async function runConnectionTest(service) {
  const pythonCommand = require('../utils/pythonCommand');
  const originalResolvePythonCommand = pythonCommand.resolvePythonCommand;
  pythonCommand.resolvePythonCommand = () => process.execPath;
  try {
    return await service.testGeminiConnection();
  } finally {
    pythonCommand.resolvePythonCommand = originalResolvePythonCommand;
  }
}

test('Gemini connection accepts one validated final JSON line from a real diagnostic subprocess', async () => {
  const { fixtureDir, fixturePath } = createNodeFixture(`
process.stdout.write('[DEBUG] child initialized\\n');
process.stderr.write('diagnostic only\\n');
process.stdout.write(JSON.stringify({ success: true, message: 'raw provider success', responseTime: 7 }) + '\\n');
`);
  try {
    const service = createConnectionTestService({ spawnProcess: spawn, pythonServicePath: fixturePath });
    assert.deepEqual(await runConnectionTest(service), {
      success: true,
      message: 'Gemini API connection is available',
      responseTime: 7,
    });
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('Gemini connection rejects malformed real subprocess output without returning diagnostics', async () => {
  const secret = 'malformed-provider-secret';
  const { fixtureDir, fixturePath } = createNodeFixture(`
process.stdout.write('[DEBUG] not a result\\nnot-json\\n');
process.stderr.write('${secret}\\n');
`);
  try {
    const service = createConnectionTestService({ apiKey: secret, spawnProcess: spawn, pythonServicePath: fixturePath });
    const captured = await captureConsole(() => runConnectionTest(service));
    assert.deepEqual(captured.result, SAFE_CONNECTION_FAILURE);
    assert.equal(JSON.stringify(captured).includes(secret), false);
    assert.equal('details' in captured.result, false);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('Gemini connection redacts a real provider failure payload and stderr', async () => {
  const secret = 'upstream-provider-error-secret';
  const { fixtureDir, fixturePath } = createNodeFixture(`
process.stderr.write(process.env.GEMINI_API_KEY + '\\n');
process.stdout.write(JSON.stringify({ success: false, error: process.env.GEMINI_API_KEY, message: process.env.GEMINI_API_KEY }) + '\\n');
`);
  try {
    const service = createConnectionTestService({ apiKey: secret, spawnProcess: spawn, pythonServicePath: fixturePath });
    const captured = await captureConsole(() => runConnectionTest(service));
    assert.deepEqual(captured.result, SAFE_CONNECTION_FAILURE);
    assert.equal(JSON.stringify(captured).includes(secret), false);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('Gemini connection timeout kills the child and ignores a late successful close', async () => {
  const child = createInjectedChild();
  const service = createConnectionTestService({ spawnProcess: () => child, timeoutMs: 10 });

  const pending = runConnectionTest(service);
  const result = await pending;
  child.stdout.emit('data', '{"success":true}\n');
  child.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(result, SAFE_CONNECTION_FAILURE);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('Gemini connection bounds subprocess output and kills an overflowing child', async () => {
  const secret = 'overflow-secret';
  const child = createInjectedChild();
  const service = createConnectionTestService({
    apiKey: secret,
    spawnProcess: () => {
      queueMicrotask(() => child.stdout.emit('data', `${secret}-${'x'.repeat(64)}`));
      return child;
    },
    maxOutputBytes: 32,
  });

  const captured = await captureConsole(() => runConnectionTest(service));

  assert.deepEqual(captured.result, SAFE_CONNECTION_FAILURE);
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.equal(JSON.stringify(captured).includes(secret), false);
});

test('relay reader cannot combine an enabled snapshot with a replacement destination', async () => {
  const firstSnapshotCaptured = {};
  firstSnapshotCaptured.promise = new Promise(resolve => { firstSnapshotCaptured.resolve = resolve; });
  const allowFirstSnapshot = {};
  allowFirstSnapshot.promise = new Promise(resolve => { allowFirstSnapshot.resolve = resolve; });
  const state = {
    proxy_service_enabled: true,
    proxy_service_url: 'https://old-relay.example.com',
    proxy_service_auth_token: 'old-secret',
  };
  let snapshotReads = 0;
  const spawnedEnvironments = [];
  const service = new ProxyGeminiService();
  service.systemConfigService = {
    selectGeminiRuntimeConfigValue: systemConfigService.selectGeminiRuntimeConfigValue.bind(systemConfigService),
    async getRelayConfigSnapshot() {
      snapshotReads += 1;
      const captured = { ...state };
      if (snapshotReads === 1) {
        firstSnapshotCaptured.resolve();
        await allowFirstSnapshot.promise;
      }
      return captured;
    },
    async getConfig(key) {
      if (key === 'gemini_default_model') return 'stored-model';
      throw new Error('relay state must not use per-key cache reads');
    },
  };
  service.spawnProcess = (command, args, options) => {
    spawnedEnvironments.push(options.env);
    return successfulProxyChild();
  };

  const inFlightOldCall = service.callPythonProxyService('test');
  await firstSnapshotCaptured.promise;
  Object.assign(state, {
    proxy_service_enabled: false,
    proxy_service_url: 'https://replacement.example.com',
    proxy_service_auth_token: 'replacement-secret',
  });
  allowFirstSnapshot.resolve();
  await inFlightOldCall;

  assert.equal(spawnedEnvironments.length, 1);
  assert.equal(spawnedEnvironments[0].PROXY_SERVICE_URL, 'https://old-relay.example.com');
  assert.equal(spawnedEnvironments[0].PROXY_SERVICE_AUTH_TOKEN, 'old-secret');

  await assert.rejects(service.callPythonProxyService('test'), /relay configuration/i);
  assert.equal(spawnedEnvironments.length, 1);

  state.proxy_service_enabled = true;
  await service.callPythonProxyService('test');
  assert.equal(spawnedEnvironments.length, 2);
  assert.equal(spawnedEnvironments[1].PROXY_SERVICE_URL, 'https://replacement.example.com');
  assert.equal(spawnedEnvironments[1].PROXY_SERVICE_AUTH_TOKEN, 'replacement-secret');
});
