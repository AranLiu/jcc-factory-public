const test = require('node:test');
const assert = require('node:assert/strict');

const composeModulePath = '../../scripts/compose';

test('Compose adapter prefers the v2 plugin and falls back to a supported standalone binary', () => {
  const { resolveComposeCommand } = require(composeModulePath);
  const v2Calls = [];
  const v2 = resolveComposeCommand({
    platform: 'linux',
    spawn: (command, args) => {
      v2Calls.push([command, args]);
      return { status: 0, stdout: '2.40.0\n', stderr: '' };
    },
  });
  assert.deepEqual(v2, { command: 'docker', prefix: ['compose'] });
  assert.deepEqual(v2Calls, [['docker', ['compose', 'version', '--short']]]);

  const fallbackCalls = [];
  const fallback = resolveComposeCommand({
    platform: 'win32',
    spawn: (command, args) => {
      fallbackCalls.push([command, args]);
      return command === 'docker-compose.exe'
        ? { status: 0, stdout: '5.3.1\n', stderr: '' }
        : { status: 1, stdout: '', stderr: 'unknown command' };
    },
  });
  assert.deepEqual(fallback, { command: 'docker-compose.exe', prefix: [] });
  assert.deepEqual(fallbackCalls, [
    ['docker.exe', ['compose', 'version', '--short']],
    ['docker-compose.exe', ['version', '--short']],
  ]);
});

test('Compose adapter rejects v1 and a host without either supported command', () => {
  const { resolveComposeCommand } = require(composeModulePath);
  assert.throws(
    () => resolveComposeCommand({
      spawn: () => ({ status: 0, stdout: '1.29.2\n', stderr: '' }),
      platform: 'linux',
    }),
    /Compose v2 or newer is required/
  );
  assert.throws(
    () => resolveComposeCommand({ spawn: () => ({ status: 1 }), platform: 'linux' }),
    /Docker Compose is not available/
  );
});

test('Compose adapter forwards arguments without a shell and returns the child status', () => {
  const { runCompose } = require(composeModulePath);
  const calls = [];
  const status = runCompose(['up', '-d', '--wait'], {
    platform: 'linux',
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('version')) return { status: 0, stdout: '2.40.0\n', stderr: '' };
      return { status: 7 };
    },
  });

  assert.equal(status, 7);
  assert.deepEqual(calls[1].args, ['compose', 'up', '-d', '--wait']);
  assert.equal(calls[1].options.shell, false);
});
