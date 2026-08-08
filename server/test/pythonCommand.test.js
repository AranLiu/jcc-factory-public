const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolvePythonCommand } = require('../utils/pythonCommand');

test('Python command honors explicit configuration first', () => {
  assert.equal(resolvePythonCommand({ env: { PYTHON_COMMAND: 'C:\\Python312\\python.exe' } }), 'C:\\Python312\\python.exe');
});

test('Python command discovers the documented virtual environment on each platform', () => {
  const servicesDir = path.resolve('python_services');
  assert.equal(resolvePythonCommand({
    env: {},
    platform: 'win32',
    servicesDir,
    existsSync: candidate => candidate.endsWith(path.join('.venv', 'Scripts', 'python.exe')),
  }), path.join(servicesDir, '.venv', 'Scripts', 'python.exe'));
  assert.equal(resolvePythonCommand({
    env: {},
    platform: 'linux',
    servicesDir,
    existsSync: candidate => candidate.endsWith(path.join('.venv', 'bin', 'python')),
  }), path.join(servicesDir, '.venv', 'bin', 'python'));
});
