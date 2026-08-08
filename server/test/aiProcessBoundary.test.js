const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'ai-process-boundary-test',
  DB_PASSWORD: 'ai-process-boundary-test-password',
  DB_NAME: 'ai_process_boundary_test',
});

const PythonGeminiService = require('../services/pythonGeminiService');
const ProxyGeminiService = require('../services/proxyGeminiService');

function createOverflowFixture(secret) {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, '.jcc-ai-process-'));
  const fixturePath = path.join(fixtureDir, 'overflow.js');
  fs.writeFileSync(
    fixturePath,
    `process.stdout.write(${JSON.stringify(secret)} + '-'.repeat(256));\n`,
    'utf8'
  );
  return { fixtureDir, fixturePath };
}

function assertSafeLimitError(error, secret) {
  assert.equal(error.code, 'AI_PROCESS_OUTPUT_LIMIT');
  assert.equal(error.message.includes(secret), false);
  return true;
}

test('direct Gemini subprocess rejects bounded stdout overflow without exposing output', async () => {
  const secret = 'DIRECT_OVERFLOW_SECRET_3a7419';
  const { fixtureDir, fixturePath } = createOverflowFixture(secret);
  try {
    const service = new PythonGeminiService();
    service.pythonCommand = process.execPath;
    service.pythonServicePath = fixturePath;
    service.maxStdoutBytes = 32;
    service.maxStderrBytes = 32;
    service.processTimeoutMs = 2_000;

    await assert.rejects(
      service.callPythonService('test'),
      error => assertSafeLimitError(error, secret)
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('relay Gemini subprocess rejects bounded stdout overflow without exposing output', async () => {
  const secret = 'RELAY_OVERFLOW_SECRET_96b752';
  const { fixtureDir, fixturePath } = createOverflowFixture(secret);
  try {
    const service = new ProxyGeminiService();
    service.pythonCommand = process.execPath;
    service.pythonServicePath = fixturePath;
    service.maxStdoutBytes = 32;
    service.maxStderrBytes = 32;
    service.processTimeoutMs = 2_000;
    service.setProxyEnvironment = async () => ({
      url: 'https://relay.invalid',
      authToken: 'relay-test-token',
      defaultModel: 'test-model',
    });

    await assert.rejects(
      service.callPythonProxyService('test'),
      error => assertSafeLimitError(error, secret)
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('oversized direct AI input is rejected before a subprocess call', async () => {
  const service = new PythonGeminiService();
  service.shouldUseProxy = async () => false;
  let subprocessCalls = 0;
  service.callPythonService = async () => {
    subprocessCalls += 1;
    return { success: true, text: 'unexpected' };
  };

  await assert.rejects(
    service.analyzeContent('prompt', 'x'.repeat((8 * 1024 * 1024) + 1)),
    error => {
      assert.equal(error.code, 'AI_INPUT_TOO_LARGE');
      return true;
    }
  );
  assert.equal(subprocessCalls, 0);
});
