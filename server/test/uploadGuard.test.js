const test = require('node:test');
const assert = require('node:assert/strict');
const { createUploadGuard } = require('../middleware/uploadGuard');

function responseHarness() {
  const listeners = {};
  return {
    statusCode: 200,
    body: null,
    once(event, handler) { listeners[event] = handler; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    finish() { listeners.finish?.(); },
  };
}

test('upload guard enforces per-user concurrency and storage quota', async () => {
  const guard = createUploadGuard({
    maxConcurrent: 1,
    maxBytes: 100,
    usageProvider: async () => 60,
  });
  const firstRes = responseHarness();
  let firstNext = false;
  await guard({ user: { id: 7 }, headers: { 'content-length': '20' } }, firstRes, () => { firstNext = true; });
  assert.equal(firstNext, true);

  const concurrentRes = responseHarness();
  await guard({ user: { id: 7 }, headers: { 'content-length': '20' } }, concurrentRes, () => {});
  assert.equal(concurrentRes.statusCode, 429);
  firstRes.finish();

  const quotaRes = responseHarness();
  await guard({ user: { id: 7 }, headers: { 'content-length': '50' } }, quotaRes, () => {});
  assert.equal(quotaRes.statusCode, 413);
});
