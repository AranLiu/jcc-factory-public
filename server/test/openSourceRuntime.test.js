const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildCspDirectives } = require('../config/securityHeaders');

const serverRoot = path.join(__dirname, '..');

const TRACKED_RUNTIME_FILES = Object.freeze([
  'index.js',
  'database/init.sql',
  'env.example',
  'python_services/gemini_proxy_service.py',
  'python_services/gemini_cli_args.py',
  'python_services/gemini_service.py',
  'python_services/gemini_service_clean.py',
  'python_services/gemini_service_simple.py',
  'services/proxyGeminiService.js',
  'services/pythonGeminiService.js',
  'scripts/init-proxy-config.js',
  '../scripts/init-config.js',
  '../.env.example',
  '../client/.env.production',
  '../client/index.html',
  '../client/src/pages/KnowledgeBase.jsx',
  '../client/src/pages/SystemConfig.jsx',
  '../client/src/pages/ProjectDetail.jsx',
]);

function readRuntimeFile(relativePath) {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

test('CSP is derived from one explicitly configured HTTP origin', () => {
  const directives = buildCspDirectives({ allowedOrigins: ['https://example.org'] });

  assert.deepEqual(directives.connectSrc, [
    "'self'",
    'https://example.org',
    'wss://example.org',
  ]);
  assert.doesNotMatch(JSON.stringify(directives), /gendrama|sendman/i);
});

test('CSP is derived from normalized origins and ignores invalid sources', () => {
  const directives = buildCspDirectives({
    allowedOrigins: [
      ' https://EXAMPLE.org:443/ ',
      'https://example.org',
      'http://Example.net:80',
      'ftp://example.com',
      'https://user:password@example.com',
      'https://example.com/path?leak=yes',
      'javascript:alert(1)',
      'not a URL',
    ],
  });

  assert.deepEqual(directives.connectSrc, [
    "'self'",
    'https://example.org',
    'wss://example.org',
    'http://example.net',
    'ws://example.net',
  ]);

  const serialized = JSON.stringify(directives);
  assert.doesNotMatch(serialized, /password|leak=yes|ftp:|javascript:|unsafe-eval|\*/i);
});

test('legacy runtime defaults are absent and Gemini remains configurable', () => {
  const runtime = TRACKED_RUNTIME_FILES.map(readRuntimeFile).join('\n');
  const envExample = readRuntimeFile('env.example');
  const runtimeEnvValidator = readRuntimeFile('config/env.js');

  assert.doesNotMatch(runtime, /gendrama|sendman/i);
  assert.doesNotMatch(runtime, /gemini-1\.5/i);
  assert.match(runtime, /gemini-3\.6-flash/);
  assert.match(envExample, /^GEMINI_DEFAULT_MODEL=gemini-3\.6-flash$/m);
  assert.match(runtime, /(?:process\.env\.GEMINI_DEFAULT_MODEL|os\.getenv\(['"]GEMINI_DEFAULT_MODEL['"])/);
  assert.doesNotMatch(runtimeEnvValidator, /GEMINI_API_KEY/);
});

test('production API runtime is same-origin when no URL is configured', () => {
  const productionEnv = readRuntimeFile('../client/.env.production');
  assert.match(productionEnv, /^VITE_API_URL=\s*$/m);
  assert.doesNotMatch(productionEnv, /https?:\/\//i);

  for (const relativePath of [
    '../client/src/pages/KnowledgeBase.jsx',
    '../client/src/pages/ProjectDetail.jsx',
  ]) {
    const source = readRuntimeFile(relativePath);
    assert.match(
      source,
      /import\.meta\.env\.VITE_API_URL \|\| \(import\.meta\.env\.DEV \? 'http:\/\/localhost:8080' : ''\)/,
      `${relativePath} must fall back to same-origin in production`
    );
  }
});

const pythonDefaultContracts = {
  'python_services/gemini_proxy_service.py': [
    /self\.current_model = DEFAULT_MODEL/,
    /target_model = model or self\.current_model/,
  ],
  'python_services/gemini_service.py': [
    /def analyze_video\([^\n]*model=None/,
    /def generate_text\([^\n]*model=None/,
  ],
  'python_services/gemini_service_clean.py': [
    /def process_text\([^\n]*model=None/,
    /model = model or DEFAULT_MODEL/,
  ],
  'python_services/gemini_service_simple.py': [
    /def analyze_video\([^\n]*model=None/,
    /def generate_text\([^\n]*model=None/,
    /service\.generate_text\(test_content, None, DEFAULT_MODEL, 0\.7\)/,
  ],
};

for (const [relativePath, contractPatterns] of Object.entries(pythonDefaultContracts)) {
  test(`Python entrypoint ${relativePath} inherits the configured default model`, () => {
    const source = readRuntimeFile(relativePath);

    assert.match(
      source,
      /DEFAULT_MODEL\s*=\s*os\.getenv\(['"]GEMINI_DEFAULT_MODEL['"]\)\s*or\s*['"]gemini-3\.6-flash['"]/,
      `${relativePath} must prefer inherited GEMINI_DEFAULT_MODEL`
    );
    assert.doesNotMatch(source, /model\s*=\s*['"]gemini-3\.6-flash['"]/);
    for (const pattern of contractPatterns) {
      assert.match(source, pattern, `${relativePath} is missing ${pattern}`);
    }

    if (relativePath.endsWith('gemini_service.py') || relativePath.endsWith('gemini_service_simple.py')) {
      assert.ok(
        (source.match(/model = model or DEFAULT_MODEL/g) || []).length >= 2,
        `${relativePath} must resolve the inherited default in both text and video paths`
      );
    }
    if (relativePath.endsWith('gemini_service_simple.py')) {
      assert.equal(
        (source.match(/model_config\.get\('model'\) or DEFAULT_MODEL/g) || []).length,
        2,
        `${relativePath} stdin text and video paths must inherit the configured default`
      );
    }
  });
}
