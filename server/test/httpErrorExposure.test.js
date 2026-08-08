const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

test('route responses never serialize raw exception messages or subprocess diagnostics', () => {
  const routeDir = path.join(rootDir, 'server', 'routes');
  const findings = [];
  for (const name of fs.readdirSync(routeDir).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(routeDir, name), 'utf8');
    for (const pattern of [
      /\b(?:error|original_error):\s*error\.message/g,
      /\bdetails:\s*process\.env\.NODE_ENV\s*===\s*['"]development['"]\s*\?\s*error\.message/g,
      /\b(?:message|error):\s*`[^`]*\$\{error\.message\}[^`]*`/g,
      /\b(?:message|error):\s*error\.message\s*\|\|/g,
      /\b(?:message|error):\s*[^\n,}]*\b[A-Za-z_$][\w$]*Error\.message/gi,
      /\b(?:message|error):\s*[^\n,}]*\b[A-Za-z_$][\w$]*Error\.response\?\.data/gi,
    ]) {
      for (const match of source.matchAll(pattern)) findings.push(`${name}:${match[0]}`);
    }
  }

  assert.deepEqual(findings, []);
});

test('global 500 handler never exposes raw exception messages in any environment', () => {
  const source = fs.readFileSync(path.join(rootDir, 'server', 'index.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /message:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\?[^:]+:\s*error\.message/
  );
  assert.match(source, /res\.status\(500\)\.json\(\{[\s\S]{0,120}message:\s*'内部服务器错误'/);
});
