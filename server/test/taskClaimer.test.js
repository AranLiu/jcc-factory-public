const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claimNextTask,
  completeClaimedTask,
  failClaimedTask,
  rescheduleClaimedTask,
} = require('../services/taskClaimer');

function fakePool(taskRows) {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    execute: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes("config_key = 'queue_paused'")) return [[{ config_value: 'false' }]];
      if (sql.includes('SELECT at.*')) return [taskRows];
      return [{ affectedRows: 1 }];
    },
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };
  return { pool: { getConnection: async () => connection }, calls };
}

test('claimNextTask atomically locks and leases one pending task', async () => {
  const { pool, calls } = fakePool([{ id: 7, status: 'pending' }]);
  const task = await claimNextTask(pool, { workerId: 'worker-1', leaseSeconds: 120 });
  assert.equal(task.id, 7);
  assert.equal(calls[0], 'begin');
  assert.equal(calls.some(call => call.sql?.includes('FOR UPDATE SKIP LOCKED')), true);
  assert.equal(calls.some(call => call.sql?.includes('lease_until = DATE_ADD')), true);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('claimNextTask rolls back and releases on a claim failure', async () => {
  const { pool, calls } = fakePool([{ id: 7 }]);
  const original = pool.getConnection;
  pool.getConnection = async () => {
    const connection = await original();
    const execute = connection.execute;
    connection.execute = async (sql, params) => {
      if (sql.includes('UPDATE ai_tasks')) throw new Error('claim failed');
      return execute(sql, params);
    };
    return connection;
  };
  await assert.rejects(() => claimNextTask(pool, { workerId: 'worker-1' }), /claim failed/);
  assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
});

test('claimNextTask honors the database-backed global pause flag', async () => {
  const { pool, calls } = fakePool([{ id: 7 }]);
  const original = pool.getConnection;
  pool.getConnection = async () => {
    const connection = await original();
    const execute = connection.execute;
    connection.execute = async (sql, params) => {
      if (sql.includes("config_key = 'queue_paused'")) return [[{ config_value: 'true' }]];
      return execute(sql, params);
    };
    return connection;
  };
  assert.equal(await claimNextTask(pool, { workerId: 'worker-1' }), null);
  assert.equal(calls.some(call => call.sql?.includes('SELECT at.*')), false);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('terminal task writes compare and swap against the active lease owner', async () => {
  const calls = [];
  const pool = {
    execute: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: 1 }];
    },
  };

  assert.equal(await completeClaimedTask(pool, {
    taskId: 7,
    workerId: 'worker-1',
    result: 'done',
  }), true);
  assert.equal(await rescheduleClaimedTask(pool, {
    taskId: 8,
    workerId: 'worker-2',
    retryCount: 1,
    errorMessage: 'retry',
    delayMinutes: 2,
  }), true);
  assert.equal(await failClaimedTask(pool, {
    taskId: 9,
    workerId: 'worker-3',
    errorMessage: 'failed',
  }), true);

  for (const call of calls) {
    assert.match(call.sql, /WHERE id = \? AND status = 'processing' AND worker_id = \?/);
    assert.match(call.sql, /cancel_requested = 0 AND pause_requested = 0/);
    assert.equal(call.params.at(-1).startsWith('worker-'), true);
  }
});

test('lease writes report false when ownership has moved to another worker', async () => {
  const pool = { execute: async () => [{ affectedRows: 0 }] };
  assert.equal(await completeClaimedTask(pool, {
    taskId: 7,
    workerId: 'stale-worker',
    result: 'stale',
  }), false);
});
