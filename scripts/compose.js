const { spawnSync } = require('node:child_process');

function resolveComposeCommand({ spawn = spawnSync, platform = process.platform } = {}) {
  const docker = platform === 'win32' ? 'docker.exe' : 'docker';
  const standalone = platform === 'win32' ? 'docker-compose.exe' : 'docker-compose';
  const candidates = [
    { command: docker, prefix: ['compose'] },
    { command: standalone, prefix: [] },
  ];
  let unsupportedVersionFound = false;

  for (const candidate of candidates) {
    const probe = spawn(candidate.command, [...candidate.prefix, 'version', '--short'], {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (probe.error || probe.status !== 0) continue;
    const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
    const version = output.match(/(?:^|\s)v?(\d+)\.\d+/i);
    if (version && Number(version[1]) >= 2) return candidate;
    unsupportedVersionFound = true;
  }

  if (unsupportedVersionFound) {
    throw new Error('Docker Compose v2 or newer is required because this project uses up --wait.');
  }
  throw new Error('Docker Compose is not available. Install Docker Desktop or Docker Compose v2.');
}

function runCompose(args, options = {}) {
  const spawn = options.spawn || spawnSync;
  const { command, prefix } = resolveComposeCommand({
    spawn,
    platform: options.platform || process.platform,
  });
  const result = spawn(command, [...prefix, ...args], {
    shell: false,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runCompose(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveComposeCommand, runCompose };
