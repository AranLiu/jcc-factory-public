const test = require('node:test');
const assert = require('node:assert/strict');
const { createCsrfProtection, createOriginProtection } = require('../middleware/csrf');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('CSRF middleware rejects a mutation without a matching token', () => {
  const middleware = createCsrfProtection(new Set(['https://app.example.com']));
  const res = responseRecorder();
  let called = false;
  middleware({ method: 'POST', headers: { origin: 'https://app.example.com' } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});

test('CSRF middleware allows safe methods and valid mutation tokens', () => {
  const middleware = createCsrfProtection(new Set(['https://app.example.com']));
  let safeCalled = false;
  middleware({ method: 'GET', headers: {} }, responseRecorder(), () => { safeCalled = true; });
  assert.equal(safeCalled, true);

  let mutationCalled = false;
  middleware({
    method: 'DELETE',
    headers: { origin: 'https://app.example.com', cookie: 'jcc_csrf=abc', 'x-csrf-token': 'abc' },
  }, responseRecorder(), () => { mutationCalled = true; });
  assert.equal(mutationCalled, true);
});

test('login origin protection rejects cross-site and originless submissions', () => {
  const middleware = createOriginProtection(new Set(['https://app.example.com']));
  for (const headers of [{}, { origin: 'https://evil.example' }]) {
    const res = responseRecorder();
    let called = false;
    middleware({ headers }, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  }

  let called = false;
  middleware({ headers: { origin: 'https://app.example.com' } }, responseRecorder(), () => { called = true; });
  assert.equal(called, true);
});
