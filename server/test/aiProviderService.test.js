const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AiProviderService,
  ProviderRequestError,
  ProviderValidationError,
  normalizeProviderInput,
  serializeProvider,
} = require('../services/aiProviderService')
const { sealProviderSecret } = require('../services/providerSecret')

const masterSecret = 'a-strong-test-secret-that-is-long-enough-for-hkdf'

test('normalizes supported providers and assigns honest capabilities', () => {
  const openai = normalizeProviderInput({
    name: 'OpenAI 主账号',
    providerType: 'openai',
    apiKey: 'sk-test',
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5-mini'],
  })
  assert.equal(openai.baseUrl, 'https://api.openai.com/v1')
  assert.deepEqual(openai.capabilities, ['script_integration'])

  const compatible = normalizeProviderInput({
    name: '本地兼容服务',
    providerType: 'openai_compatible',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    apiKey: 'local-test-key',
    defaultModel: 'local-model',
    models: ['local-model'],
  })
  assert.equal(compatible.baseUrl, 'http://127.0.0.1:11434/v1')
})

test('rejects unsafe endpoints, masked keys, and unsupported provider values', () => {
  const base = {
    name: 'Unsafe',
    providerType: 'openai_compatible',
    apiKey: 'key',
    defaultModel: 'model',
    models: ['model'],
  }
  assert.throws(() => normalizeProviderInput({ ...base, baseUrl: 'http://api.example.com/v1' }), ProviderValidationError)
  assert.throws(() => normalizeProviderInput({ ...base, baseUrl: 'https://user:pass@example.com/v1' }), ProviderValidationError)
  assert.throws(() => normalizeProviderInput({ ...base, baseUrl: 'https://example.com/v1', apiKey: '[REDACTED]' }), ProviderValidationError)
  assert.throws(() => normalizeProviderInput({ ...base, providerType: 'anthropic' }), ProviderValidationError)
})

test('serialized providers expose configuration state but never ciphertext', () => {
  const publicProvider = serializeProvider({
    id: 7,
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_ciphertext: 'v1.secret.material',
    default_model: 'gpt-5-mini',
    models_json: JSON.stringify(['gpt-5-mini']),
    capabilities_json: JSON.stringify(['script_integration']),
    enabled: 1,
  })
  assert.equal(publicProvider.apiKeyConfigured, true)
  assert.equal(publicProvider.apiKey, undefined)
  assert.equal(publicProvider.api_key_ciphertext, undefined)
})

test('generates text through native OpenAI Responses API without leaking the key', async () => {
  const calls = []
  const service = new AiProviderService({
    pool: {},
    masterSecret,
    httpClient: {
      post: async (...args) => {
        calls.push(args)
        return { data: { output_text: '整合后的剧本' } }
      },
    },
  })
  const provider = {
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_ciphertext: sealProviderSecret('sk-native-secret', masterSecret),
    default_model: 'gpt-5-mini',
  }

  const result = await service.generateText(provider, '系统要求', '待整合内容')
  assert.equal(result.text, '整合后的剧本')
  assert.equal(calls[0][0], 'https://api.openai.com/v1/responses')
  assert.equal(calls[0][1].model, 'gpt-5-mini')
  assert.equal(calls[0][1].store, false)
  assert.equal(calls[0][2].headers.Authorization, 'Bearer sk-native-secret')
  assert.equal(calls[0][2].timeout, 180_000)
})

test('uses a configurable long-form request timeout while keeping connection tests bounded', async () => {
  const timeouts = []
  const service = new AiProviderService({
    pool: {
      execute: async sql => {
        if (/SELECT \*/.test(sql)) return [[{
          id: 3,
          provider_type: 'openai',
          base_url: 'https://api.openai.com/v1',
          api_key_ciphertext: sealProviderSecret('sk-timeout-test', masterSecret),
          default_model: 'gpt-5-mini',
        }]]
        return [[]]
      },
    },
    masterSecret,
    requestTimeoutMs: 240_000,
    httpClient: {
      post: async (_url, _body, options) => {
        timeouts.push(options.timeout)
        return { data: { output_text: 'OK' } }
      },
    },
  })

  await service.generateText(await service.getProviderRecord(3), 'system', 'long input')
  await service.testProvider(3)

  assert.deepEqual(timeouts, [240_000, 30_000])
})

test('reports upstream timeouts without exposing provider response details', async () => {
  const service = new AiProviderService({
    pool: {},
    masterSecret,
    httpClient: {
      post: async () => {
        const error = new Error('request contained secret upstream detail')
        error.code = 'ECONNABORTED'
        throw error
      },
    },
  })
  const provider = {
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_ciphertext: sealProviderSecret('sk-timeout-secret', masterSecret),
    default_model: 'gpt-5-mini',
  }

  await assert.rejects(
    service.generateText(provider, 'system', 'input'),
    error => error instanceof ProviderRequestError
      && error.code === 'provider_timeout'
      && error.message === 'AI provider request timed out'
      && !error.message.includes('secret')
  )
})

test('generates text through an OpenAI-compatible chat completions endpoint', async () => {
  const calls = []
  const service = new AiProviderService({
    pool: {},
    masterSecret,
    httpClient: {
      post: async (...args) => {
        calls.push(args)
        return { data: { choices: [{ message: { content: '兼容结果' } }] } }
      },
    },
  })
  const provider = {
    provider_type: 'openai_compatible',
    base_url: 'https://models.example.com/v1',
    api_key_ciphertext: sealProviderSecret('compatible-secret', masterSecret),
    default_model: 'vendor-model',
  }

  const result = await service.generateText(provider, '系统要求', '待整合内容')
  assert.equal(result.text, '兼容结果')
  assert.equal(calls[0][0], 'https://models.example.com/v1/chat/completions')
  assert.equal(calls[0][1].messages.length, 2)
})

test('provider failures are fail-closed and secret-free', async () => {
  const service = new AiProviderService({
    pool: {},
    masterSecret,
    httpClient: { post: async () => { throw new Error('upstream included sk-private-value') } },
  })
  const provider = {
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key_ciphertext: sealProviderSecret('sk-private-value', masterSecret),
    default_model: 'gpt-5-mini',
  }
  await assert.rejects(
    service.generateText(provider, 'system', 'input'),
    error => error.message === 'AI provider request failed' && !error.message.includes('sk-private-value')
  )
})

test('an explicitly routed but disabled provider fails closed instead of appearing unconfigured', async () => {
  const disabledProviderRoute = {
    task_type: 'script_integration',
    route_model: 'gpt-5.6-terra',
    id: 5,
    enabled: 0,
    capabilities_json: JSON.stringify(['script_integration']),
    models_json: JSON.stringify(['gpt-5.6-terra']),
  }
  const service = new AiProviderService({
    masterSecret,
    pool: {
      execute: async () => [[disabledProviderRoute]],
    },
  })

  await assert.rejects(service.getTaskRoute('script_integration'), ProviderValidationError)

  const managementRoute = await service.getTaskRoute('script_integration', { allowInvalid: true })
  assert.equal(managementRoute.provider.id, 5)
})

test('a routed model removed from the provider allow-list fails closed', async () => {
  const service = new AiProviderService({
    masterSecret,
    pool: {
      execute: async () => [[{
        task_type: 'script_integration',
        route_model: 'retired-model',
        id: 8,
        enabled: 1,
        capabilities_json: JSON.stringify(['script_integration']),
        models_json: JSON.stringify(['current-model']),
      }]],
    },
  })

  await assert.rejects(service.getTaskRoute('script_integration'), ProviderValidationError)
})
