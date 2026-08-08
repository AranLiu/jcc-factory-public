const {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} = require('node:crypto')

const VERSION = 'v1'
const CONTEXT = Buffer.from('jcc-factory/ai-provider-credentials/v1', 'utf8')

class ProviderCredentialError extends Error {
  constructor(message = 'Provider credential is invalid') {
    super(message)
    this.name = 'ProviderCredentialError'
  }
}

function deriveKey(masterSecret) {
  if (typeof masterSecret !== 'string' || masterSecret.length < 32) {
    throw new ProviderCredentialError('Provider encryption key is unavailable')
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(masterSecret, 'utf8'), Buffer.alloc(0), CONTEXT, 32))
}

function sealProviderSecret(secret, masterSecret = process.env.JWT_SECRET) {
  if (typeof secret !== 'string' || secret.trim() === '' || secret.length > 4096) {
    throw new ProviderCredentialError()
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(masterSecret), iv)
  cipher.setAAD(CONTEXT)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

function openProviderSecret(sealed, masterSecret = process.env.JWT_SECRET) {
  try {
    if (typeof sealed !== 'string') throw new Error()
    const [version, ivPart, tagPart, ciphertextPart, extra] = sealed.split('.')
    if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart || extra) throw new Error()

    const iv = Buffer.from(ivPart, 'base64url')
    const tag = Buffer.from(tagPart, 'base64url')
    const ciphertext = Buffer.from(ciphertextPart, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error()

    const decipher = createDecipheriv('aes-256-gcm', deriveKey(masterSecret), iv)
    decipher.setAAD(CONTEXT)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (error) {
    if (error instanceof ProviderCredentialError && /encryption key/i.test(error.message)) throw error
    throw new ProviderCredentialError()
  }
}

module.exports = {
  ProviderCredentialError,
  openProviderSecret,
  sealProviderSecret,
}
