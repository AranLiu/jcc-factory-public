const test = require('node:test');
const assert = require('node:assert/strict');

const { isPublicApiRequest } = require('../utils/publicApi');

function request(method, path) {
  return { method, path };
}

test('public API allow-list is method-sensitive', () => {
  for (const [method, path] of [
    ['GET', '/health'],
    ['POST', '/auth/login'],
    ['GET', '/auth/setup-status'],
    ['POST', '/auth/setup'],
  ]) {
    assert.equal(isPublicApiRequest(request(method, path)), true, `${method} ${path}`);
  }

  for (const [method, path] of [
    ['POST', '/health'],
    ['GET', '/auth/login'],
    ['POST', '/auth/setup-status'],
    ['GET', '/auth/setup'],
    ['GET', '/auth/verify'],
    ['POST', '/auth/create-user'],
  ]) {
    assert.equal(isPublicApiRequest(request(method, path)), false, `${method} ${path}`);
  }
});

test('public API allow-list ignores query strings but rejects lookalike paths', () => {
  assert.equal(isPublicApiRequest({ method: 'GET', url: '/auth/setup-status?fresh=1' }), true);
  assert.equal(isPublicApiRequest(request('GET', '/auth/setup-status/extra')), false);
  assert.equal(isPublicApiRequest(request('POST', '/auth/setup-anything')), false);
});
