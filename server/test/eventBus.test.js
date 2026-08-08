const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventBus } = require('../services/eventBus');

function recorder() {
  return {
    output: '',
    ended: false,
    write(chunk) { this.output += chunk; return true; },
    end() { this.ended = true; },
  };
}

test('event bus sends task data only to the owning user and administrators', () => {
  const bus = createEventBus({ heartbeatMs: 0 });
  const owner = recorder();
  const stranger = recorder();
  const admin = recorder();
  bus.addClient(owner, { userId: 10, role: 'user' });
  bus.addClient(stranger, { userId: 20, role: 'user' });
  bus.addClient(admin, { userId: 1, role: 'admin' });
  owner.output = stranger.output = admin.output = '';

  bus.broadcast('task-completed', { taskId: 7, userId: 10 });

  assert.match(owner.output, /task-completed/);
  assert.equal(stranger.output, '');
  assert.match(admin.output, /task-completed/);
  bus.close();
});

test('event bus enforces a per-user connection limit', () => {
  const bus = createEventBus({ heartbeatMs: 0, maxClientsPerUser: 1 });
  bus.addClient(recorder(), { userId: 10, role: 'user' });
  assert.throws(() => bus.addClient(recorder(), { userId: 10, role: 'user' }), /connection limit/i);
  bus.close();
});
