const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'invocation-log-test',
  DB_PASSWORD: 'invocation-log-test-password',
  DB_NAME: 'invocation_log_test',
});

const PythonGeminiService = require('../services/pythonGeminiService');
const ProxyGeminiService = require('../services/proxyGeminiService');
const { resolvePythonCommand } = require('../utils/pythonCommand');

const sentinels = Object.freeze({
  prompt: 'SENTINEL_PROMPT_4c68c9',
  content: 'SENTINEL_CONTENT_7e3d21',
  filePath: 'C:\\private\\SENTINEL_VIDEO_PATH_8a512f.mp4',
  systemInstruction: 'SENTINEL_SYSTEM_INSTRUCTION_a17f42',
  config: 'SENTINEL_MODEL_CONFIG_c3f815',
  token: 'SENTINEL_AUTH_TOKEN_f8bd90',
});

function createFixtureScript() {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, '.jcc-gemini-log-'));
  const fixturePath = path.join(fixtureDir, 'echo-invocation.js');
  fs.writeFileSync(fixturePath, `
const emit = (stdin = '') => process.stdout.write(JSON.stringify({
  success: true,
  text: 'ok',
  args: process.argv.slice(2),
  stdin,
}));
if (process.argv.includes('--stdin')) {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => emit(Buffer.concat(chunks).toString('utf8')));
} else {
  emit();
}
`, 'utf8');
  return { fixtureDir, fixturePath };
}

async function captureConsole(action) {
  const records = [];
  const originals = {};
  for (const method of ['log', 'warn', 'error']) {
    originals[method] = console[method];
    console[method] = (...args) => records.push(args.map((value) => (
      typeof value === 'string' ? value : JSON.stringify(value)
    )).join(' '));
  }

  try {
    const result = await action();
    return { result, output: records.join('\n') };
  } finally {
    Object.assign(console, originals);
  }
}

function assertRedacted(output) {
  for (const sentinel of Object.values(sentinels)) {
    assert.ok(!output.includes(sentinel), `console output leaked ${sentinel}`);
  }
  assert.match(output, /command=video/);
  assert.match(output, /argumentCount=/);
  assert.match(output, /stdinPresent=(?:true|false)/);
  assert.match(output, /stdinBytes=\d+/);
}

test('direct Gemini invocation sends video payloads through stdin and logs only safe metadata', async () => {
  const { fixtureDir, fixturePath } = createFixtureScript();
  try {
    const capturedInvocations = [];
    const { output } = await captureConsole(async () => {
      const service = new PythonGeminiService();
      service.pythonCommand = process.execPath;
      service.pythonServicePath = fixturePath;
      service.shouldUseProxy = async () => false;
      const callPythonService = service.callPythonService.bind(service);
      service.callPythonService = async (...args) => {
        capturedInvocations.push(args);
        return callPythonService(...args);
      };

      const modelConfig = {
        model: sentinels.config,
        systemInstruction: sentinels.systemInstruction,
        authToken: sentinels.token,
      };
      const result = await service.analyzeVideo(sentinels.filePath, sentinels.prompt, modelConfig);
      const defaultResult = await service.analyzeVideo(sentinels.filePath, sentinels.prompt);
      assert.equal(result.success, true);
      assert.equal(defaultResult.success, true);
      assert.deepEqual(capturedInvocations, [
        [
          'video',
          [],
          JSON.stringify({
            videoPath: sentinels.filePath,
            prompt: sentinels.prompt,
            modelConfig,
          }),
        ],
        [
          'video',
          [],
          JSON.stringify({
            videoPath: sentinels.filePath,
            prompt: sentinels.prompt,
            modelConfig: {},
          }),
        ],
      ]);
    });

    assertRedacted(output);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('real Python video CLI parser selects model and temperature without echoing user input', () => {
  const helperPath = path.resolve(__dirname, '../python_services/gemini_cli_args.py');
  const defaultModel = 'fallback-video-model';
  const modelConfig = {
    model: sentinels.config,
    temperature: 0.23,
    systemInstruction: sentinels.systemInstruction,
    authToken: sentinels.token,
  };

  const configured = spawnSync(resolvePythonCommand(), [
    helperPath,
    defaultModel,
    sentinels.filePath,
    sentinels.prompt,
    JSON.stringify(modelConfig),
  ], { encoding: 'utf8' });

  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  assert.deepEqual(JSON.parse(configured.stdout), {
    model: sentinels.config,
    temperature: 0.23,
    configKeys: ['authToken', 'model', 'systemInstruction', 'temperature'],
  });
  for (const sensitiveValue of [
    sentinels.filePath,
    sentinels.prompt,
    sentinels.systemInstruction,
    sentinels.token,
  ]) {
    assert.ok(!`${configured.stdout}\n${configured.stderr}`.includes(sensitiveValue));
  }

  const defaulted = spawnSync(resolvePythonCommand(), [
    helperPath,
    defaultModel,
    sentinels.filePath,
    sentinels.prompt,
  ], { encoding: 'utf8' });

  assert.equal(defaulted.status, 0, defaulted.stderr || defaulted.stdout);
  assert.deepEqual(JSON.parse(defaulted.stdout), {
    model: defaultModel,
    temperature: 0.7,
    configKeys: [],
  });
});

test('real Gemini test entrypoint keeps debug diagnostics off the stdout JSON channel', () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, '.jcc-gemini-python-'));
  const googleDir = path.join(fixtureDir, 'google');
  fs.mkdirSync(googleDir);
  fs.writeFileSync(path.join(googleDir, '__init__.py'), 'from . import genai\n', 'utf8');
  fs.writeFileSync(path.join(googleDir, 'genai.py'), `
class _Response:
    text = 'ok'
class _Models:
    def generate_content(self, **kwargs):
        return _Response()
class Client:
    def __init__(self, api_key):
        self.models = _Models()
class _Types:
    class GenerateContentConfig:
        def __init__(self, **kwargs):
            pass
types = _Types()
`, 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'sitecustomize.py'), `
import sys
import types as python_types
genai = python_types.ModuleType('google.genai')
class _Response:
    text = 'ok'
class _Models:
    def generate_content(self, **kwargs):
        return _Response()
class Client:
    def __init__(self, api_key):
        self.models = _Models()
class _Types:
    class GenerateContentConfig:
        def __init__(self, **kwargs):
            pass
genai.Client = Client
genai.types = _Types()
google = python_types.ModuleType('google')
google.genai = genai
sys.modules['google'] = google
sys.modules['google.genai'] = genai
`, 'utf8');

  try {
    const result = spawnSync(resolvePythonCommand(), [
      path.resolve(__dirname, '../python_services/gemini_service_simple.py'),
      'test',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GEMINI_API_KEY: 'python-contract-secret',
        GEMINI_DEBUG: 'true',
        PYTHONPATH: fixtureDir,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    const safeDiagnostic = `${result.stderr}\n${parsed.error || ''}`.replaceAll('python-contract-secret', '[REDACTED]');
    assert.equal(parsed.success, true, safeDiagnostic);
    assert.match(result.stderr, /DEBUG/);
    assert.equal(result.stdout.includes('python-contract-secret'), false);
    assert.equal(result.stderr.includes('python-contract-secret'), false);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('proxy Gemini invocation redacts prompts, paths, config, and auth tokens while using stdin', async () => {
  const { fixtureDir, fixturePath } = createFixtureScript();
  try {
    const capturedInvocations = [];
    const { output } = await captureConsole(async () => {
      const service = new ProxyGeminiService();
      service.pythonCommand = process.execPath;
      service.pythonServicePath = fixturePath;
      service.setProxyEnvironment = async () => ({
        url: 'https://proxy.invalid',
        authToken: sentinels.token,
        defaultModel: 'stored-model',
      });
      const callPythonProxyService = service.callPythonProxyService.bind(service);
      service.callPythonProxyService = async (...args) => {
        capturedInvocations.push(args);
        return callPythonProxyService(...args);
      };

      const videoResult = await service.analyzeVideo(
        sentinels.filePath,
        sentinels.prompt,
        { model: sentinels.config, authToken: sentinels.token }
      );
      const contentResult = await service.analyzeContent(
        sentinels.prompt,
        sentinels.content,
        { model: sentinels.config, authToken: sentinels.token }
      );
      assert.equal(videoResult.success, true);
      assert.equal(contentResult.success, true);
    });

    assert.deepEqual(capturedInvocations, [
      [
        'video',
        [],
        JSON.stringify({
          videoPath: sentinels.filePath,
          prompt: sentinels.prompt,
          modelConfig: { model: sentinels.config, authToken: sentinels.token },
        }),
      ],
      [
        'text',
        [],
        JSON.stringify({
          prompt: `${sentinels.prompt}\n\n内容：${sentinels.content}`,
          modelConfig: { model: sentinels.config, authToken: sentinels.token },
        }),
      ],
    ]);
    assertRedacted(output);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('direct text and novel analysis use the supported text command with stdin payloads', async () => {
  const service = new PythonGeminiService();
  service.shouldUseProxy = async () => false;
  const calls = [];
  service.callPythonService = async (...args) => {
    calls.push(args);
    return { success: true, text: 'ok' };
  };

  const modelConfig = { model: sentinels.config };
  await service.analyzeContent(sentinels.prompt, sentinels.content, modelConfig);
  await service.analyzeNovel(sentinels.prompt, sentinels.content, modelConfig);

  assert.deepEqual(calls, [
    [
      'text',
      [],
      JSON.stringify({
        prompt: `${sentinels.prompt}\n\n内容：${sentinels.content}`,
        systemInstruction: null,
        modelConfig,
      }),
    ],
    [
      'text',
      [],
      JSON.stringify({
        prompt: `${sentinels.prompt}\n\n内容：${sentinels.content}`,
        systemInstruction: null,
        modelConfig,
      }),
    ],
  ]);
});

test('a Windows-sized 40000-character prompt succeeds because content is not placed in argv', async () => {
  const { fixtureDir, fixturePath } = createFixtureScript();
  try {
    const service = new PythonGeminiService();
    service.pythonCommand = process.execPath;
    service.pythonServicePath = fixturePath;
    service.shouldUseProxy = async () => false;

    const result = await service.analyzeContent('p'.repeat(40_000), 'content');

    assert.equal(result.success, true);
    assert.equal(result.text, 'ok');
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('direct Gemini connection test invokes the real service test command', async () => {
  const service = new PythonGeminiService();
  const calls = [];
  service.callPythonService = async (...args) => {
    calls.push(args);
    return { success: true, message: 'ok' };
  };

  assert.deepEqual(await service.testConnection(), {
    success: true,
    message: 'ok',
    details: { success: true, message: 'ok' },
  });
  assert.deepEqual(calls, [['test', []]]);
});
