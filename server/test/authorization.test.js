const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canReadAllResources,
  canReadResource,
  canMutateAllResources,
  canMutateResource
} = require('../utils/authorization');

test('authorization matrix distinguishes owner, global, readonly, and admin access', () => {
  const ownerId = 10;
  assert.equal(canReadResource({ id: 20, role: 'user', permission: 'readonly_global' }, ownerId), true);
  assert.equal(canMutateResource({ id: 20, role: 'user', permission: 'readonly_global' }, ownerId), false);
  assert.equal(canMutateResource({ id: 20, role: 'user', permission: 'global' }, ownerId), true);
  assert.equal(canMutateResource({ id: 20, role: 'admin', permission: 'personal' }, ownerId), true);
  assert.equal(canReadResource({ id: ownerId, role: 'user', permission: 'personal' }, ownerId), true);
  assert.equal(canReadResource({ id: 20, role: 'user', permission: 'personal' }, ownerId), false);
});

test('global scope helpers keep readonly and write access distinct', () => {
  assert.equal(canReadAllResources({ role: 'user', permission: 'readonly_global' }), true);
  assert.equal(canMutateAllResources({ role: 'user', permission: 'readonly_global' }), false);
  assert.equal(canMutateAllResources({ role: 'user', permission: 'global' }), true);
  assert.equal(canReadAllResources({ role: 'admin', permission: 'personal' }), true);
});
