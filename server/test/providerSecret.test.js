const assert = require('node:assert/strict')
const test = require('node:test')

const { openProviderSecret, sealProviderSecret } = require('../services/providerSecret')

const masterSecret = 'a-strong-test-secret-that-is-long-enough-for-hkdf'

test('provider secrets round-trip through authenticated encryption', () => {
  const sealed = sealProviderSecret('sk-provider-secret', masterSecret)
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(openProviderSecret(sealed, masterSecret), 'sk-provider-secret')
  assert.ok(!sealed.includes('sk-provider-secret'))
})

test('provider secret ciphertext is non-deterministic and rejects tampering', () => {
  const first = sealProviderSecret('same-secret', masterSecret)
  const second = sealProviderSecret('same-secret', masterSecret)
  assert.notEqual(first, second)

  const parts = first.split('.')
  parts[3] = `${parts[3].startsWith('A') ? 'B' : 'A'}${parts[3].slice(1)}`
  assert.throws(() => openProviderSecret(parts.join('.'), masterSecret), /provider credential/i)
})

test('provider secret operations reject missing or unsafe inputs', () => {
  assert.throws(() => sealProviderSecret('', masterSecret), /provider credential/i)
  assert.throws(() => sealProviderSecret('secret', 'short'), /encryption key/i)
  assert.throws(() => openProviderSecret('not-a-ciphertext', masterSecret), /provider credential/i)
})
