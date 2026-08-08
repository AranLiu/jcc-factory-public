const test = require('node:test');
const assert = require('node:assert/strict');
const { taskControlAction } = require('../services/taskControl');

test('taskControlAction gives cancellation precedence over pause', () => {
  assert.equal(taskControlAction({ status: 'processing', cancel_requested: 1 }), 'cancel');
  assert.equal(taskControlAction({ status: 'paused', cancel_requested: 0 }), 'pause');
  assert.equal(taskControlAction({ status: 'processing', cancel_requested: 0 }), 'run');
});
