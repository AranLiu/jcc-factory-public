const test = require('node:test');
const assert = require('node:assert/strict');
const { withAdvisoryLock } = require('../utils/advisoryLock');

test('advisory lock is held around a storage mutation and always released', async () => {
  const calls = [];
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      return sql.includes('GET_LOCK') ? [[{ acquired: 1 }]] : [[{ released: 1 }]];
    },
    release: () => calls.push('release'),
  };
  const result = await withAdvisoryLock({ getConnection: async () => connection }, 'quota:1', async () => {
    calls.push('mutation');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(calls, [
    'SELECT GET_LOCK(?, ?) AS acquired',
    'mutation',
    'SELECT RELEASE_LOCK(?)',
    'release',
  ]);
});

test('connectionLimit distinct lock keys do not need a nested pool connection', async () => {
  const connectionLimit = 10;
  let available = connectionLimit;
  let maxBorrowed = 0;
  const waiters = [];
  const borrow = async () => {
    if (available === 0) await new Promise(resolve => waiters.push(resolve));
    available -= 1;
    maxBorrowed = Math.max(maxBorrowed, connectionLimit - available);
    return {
      query: async (sql) => sql.includes('GET_LOCK') ? [[{ acquired: 1 }]] : [[{ released: 1 }]],
      execute: async () => [[{ used_bytes: 0 }]],
      release: () => {
        available += 1;
        waiters.shift()?.();
      },
    };
  };
  const pool = {
    getConnection: borrow,
    execute: async () => { throw new Error('quota callback attempted a nested pool checkout'); },
  };

  const results = await Promise.all(Array.from({ length: connectionLimit }, (_, index) => (
    withAdvisoryLock(pool, `quota:${index}`, async (connection) => {
      const [[row]] = await connection.execute('SELECT 0 AS used_bytes');
      await new Promise(resolve => setImmediate(resolve));
      return row.used_bytes;
    })
  )));

  assert.deepEqual(results, Array(connectionLimit).fill(0));
  assert.equal(maxBorrowed, connectionLimit);
  assert.equal(available, connectionLimit);
});
