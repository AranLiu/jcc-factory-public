const fs = require('node:fs');
const path = require('node:path');

function resolvePythonCommand({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
  servicesDir = path.join(__dirname, '../python_services'),
} = {}) {
  if (env.PYTHON_COMMAND?.trim()) return env.PYTHON_COMMAND.trim();

  const candidates = platform === 'win32'
    ? [path.join(servicesDir, '.venv', 'Scripts', 'python.exe')]
    : [path.join(servicesDir, '.venv', 'bin', 'python')];
  const discovered = candidates.find(candidate => existsSync(candidate));
  if (discovered) return discovered;
  return platform === 'win32' ? 'python' : 'python3';
}

module.exports = { resolvePythonCommand };
