const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOptionalEmail,
  validateAccountPassword,
} = require('../utils/accountPolicy');

test('normalizeOptionalEmail treats missing and blank email as null', () => {
  assert.equal(normalizeOptionalEmail(), null);
  assert.equal(normalizeOptionalEmail('   '), null);
});

test('normalizeOptionalEmail normalizes a supplied address and rejects invalid values', () => {
  assert.equal(normalizeOptionalEmail('  Admin@Example.COM '), 'admin@example.com');
  for (const email of ['missing-at.example.com', 'a@b', `${'x'.repeat(94)}@a.test`]) {
    assert.throws(() => normalizeOptionalEmail(email), { code: 'INVALID_EMAIL' });
  }
});

test('validateAccountPassword accepts 8 to 128 characters and rejects other lengths', () => {
  assert.equal(validateAccountPassword('12345678'), '12345678');
  assert.equal(validateAccountPassword('x'.repeat(128)).length, 128);
  assert.throws(() => validateAccountPassword('1234567'), { code: 'INVALID_PASSWORD' });
  assert.throws(() => validateAccountPassword('x'.repeat(129)), { code: 'INVALID_PASSWORD' });
});
