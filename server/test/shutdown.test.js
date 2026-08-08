const test = require('node:test');
const assert = require('node:assert/strict');
const { shutdownResources } = require('../utils/shutdown');

test('shutdownResources stops task intake, HTTP, and the database pool', async () => {
  const calls = [];
  await shutdownResources({
    taskProcessor: { stop: async () => calls.push('tasks') },
    httpServer: { close: (callback) => { calls.push('http'); callback(); } },
    pool: { end: async () => calls.push('db') },
    pools: [{ end: async () => calls.push('quota-db') }],
  });
  assert.deepEqual(calls, ['tasks', 'http', 'db', 'quota-db']);
});
