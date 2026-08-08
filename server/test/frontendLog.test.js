const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFrontendLog } = require('../utils/frontendLog');

test('normalizeFrontendLog accepts a bounded structured entry', () => {
  assert.deepEqual(normalizeFrontendLog({ level: 'warn', module: 'EDITOR', message: 'Save failed', data: { id: 1 } }), {
    level: 'WARN', module: 'EDITOR', message: 'Save failed', data: { id: 1 },
  });
});

test('normalizeFrontendLog rejects forged levels and oversized messages', () => {
  assert.throws(() => normalizeFrontendLog({ level: 'audit', module: 'AUTH', message: 'forged' }), /invalid log level/i);
  assert.throws(() => normalizeFrontendLog({ level: 'info', module: 'APP', message: 'x'.repeat(2001) }), /message/i);
});
