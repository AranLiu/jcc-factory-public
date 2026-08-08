const test = require('node:test');
const assert = require('node:assert/strict');
const { insertQueuedTask } = require('../services/taskQueue');

test('new queue tasks become visible only after their stable position is written', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    execute: async (sql) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      return normalized.startsWith('INSERT') ? [{ insertId: 41 }] : [{ affectedRows: 1 }];
    },
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };

  const result = await insertQueuedTask(
    { getConnection: async () => connection },
    { projectId: 1, fileId: 2, prompt: 'p' }
  );

  assert.deepEqual(result, { insertId: 41, queuePosition: 41 });
  assert.equal(calls[0], 'begin');
  assert.match(calls[1], /queue_position/);
  assert.match(calls[2], /SET queue_position = \?/);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('queue insertion rolls back before releasing on failure', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    execute: async () => { throw new Error('insert failed'); },
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };
  await assert.rejects(
    () => insertQueuedTask({ getConnection: async () => connection }, { projectId: 1, fileId: 2, prompt: 'p' }),
    /insert failed/
  );
  assert.deepEqual(calls, ['begin', 'rollback', 'release']);
});
