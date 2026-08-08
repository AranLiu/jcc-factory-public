const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../services/credentialService.js');

function createPool({ failDelete = false } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (failDelete && sql.includes('DELETE FROM auth_sessions')) {
        throw new Error('session delete failed');
      }
    },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
  };
  return {
    calls,
    pool: {
      async getConnection() {
        calls.push('getConnection');
        return connection;
      },
    },
  };
}

test('credential service exists before transaction behavior checks', () => {
  assert.equal(fs.existsSync(servicePath), true, 'missing credentialService.js');
});

test('password update and session revocation commit on one connection', async () => {
  const { updatePasswordAndRevokeSessions } = require(servicePath);
  const { pool, calls } = createPool();

  await updatePasswordAndRevokeSessions(pool, 7, 'new-hash');

  assert.deepEqual(calls, [
    'getConnection',
    'begin',
    {
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      params: ['new-hash', 7],
    },
    {
      sql: 'DELETE FROM auth_sessions WHERE user_id = ?',
      params: [7],
    },
    'commit',
    'release',
  ]);
});

test('password update rolls back and releases when session revocation fails', async () => {
  const { updatePasswordAndRevokeSessions } = require(servicePath);
  const { pool, calls } = createPool({ failDelete: true });

  await assert.rejects(updatePasswordAndRevokeSessions(pool, 8, 'new-hash'));

  assert.deepEqual(calls.at(-2), 'rollback');
  assert.deepEqual(calls.at(-1), 'release');
  assert.equal(calls.includes('commit'), false);
});

test('deactivating a user and revoking sessions commit atomically', async () => {
  const { updateUserStatusAndSessions } = require(servicePath);
  const { pool, calls } = createPool();

  await updateUserStatusAndSessions(pool, 9, 'inactive');

  assert.deepEqual(calls, [
    'getConnection',
    'begin',
    {
      sql: 'UPDATE users SET status = ? WHERE id = ?',
      params: ['inactive', 9],
    },
    {
      sql: 'DELETE FROM auth_sessions WHERE user_id = ?',
      params: [9],
    },
    'commit',
    'release',
  ]);
});

test('activating a user does not revoke sessions and deactivation failures roll back', async () => {
  const { updateUserStatusAndSessions } = require(servicePath);
  const active = createPool();
  await updateUserStatusAndSessions(active.pool, 10, 'active');
  assert.equal(
    active.calls.some(call => typeof call === 'object' && call.sql.includes('DELETE FROM auth_sessions')),
    false
  );
  assert.equal(active.calls.includes('commit'), true);

  const failing = createPool({ failDelete: true });
  await assert.rejects(updateUserStatusAndSessions(failing.pool, 11, 'inactive'));
  assert.equal(failing.calls.at(-2), 'rollback');
  assert.equal(failing.calls.at(-1), 'release');
  assert.equal(failing.calls.includes('commit'), false);
});
