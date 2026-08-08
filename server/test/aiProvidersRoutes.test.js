const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const express = require('express')

const { createAiProvidersRouter } = require('../routes/aiProviders')
const { ProviderRequestError, ProviderValidationError } = require('../services/aiProviderService')

async function withServer(router, callback) {
  const app = express()
  app.use(express.json())
  app.use('/api/ai-providers', router)
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function adminChain(req, _res, next) {
  req.user = { id: 4, role: 'admin' }
  next()
}

test('provider routes enforce the injected auth and administrator chain', async () => {
  const router = createAiProvidersRouter({
    authenticateToken: (_req, res) => res.status(401).json({ message: '未认证' }),
    requireAdmin: adminChain,
    service: {},
  })
  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/ai-providers`)
    assert.equal(response.status, 401)
  })
})

test('provider CRUD sends the authenticated actor and never returns a submitted key', async () => {
  const calls = []
  const publicProvider = {
    id: 12,
    name: 'OpenAI',
    providerType: 'openai',
    apiKeyConfigured: true,
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5-mini'],
    capabilities: ['script_integration'],
    enabled: true,
  }
  const service = {
    listProviders: async () => [publicProvider],
    createProvider: async (body, actorId) => { calls.push(['create', body, actorId]); return publicProvider },
    updateProvider: async (id, body, actorId) => { calls.push(['update', id, body, actorId]); return publicProvider },
    getTaskRoute: async () => null,
  }
  const router = createAiProvidersRouter({ authenticateToken: adminChain, requireAdmin: adminChain, service })

  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/ai-providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'OpenAI', providerType: 'openai', apiKey: 'sk-never-return-me',
        defaultModel: 'gpt-5-mini', models: ['gpt-5-mini'],
      }),
    })
    assert.equal(response.status, 201)
    const text = await response.text()
    assert.ok(!text.includes('sk-never-return-me'))
    assert.equal(JSON.parse(text).data.apiKeyConfigured, true)
    assert.equal(calls[0][2], 4)
  })
})

test('provider management can inspect an invalid route so an administrator can repair it', async () => {
  const routeCalls = []
  const service = {
    listProviders: async () => [],
    getTaskRoute: async (...args) => {
      routeCalls.push(args)
      return null
    },
  }
  const router = createAiProvidersRouter({ authenticateToken: adminChain, requireAdmin: adminChain, service })

  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/ai-providers`)
    assert.equal(response.status, 200)
    assert.deepEqual(routeCalls, [['script_integration', { allowInvalid: true }]])
  })
})

test('provider connection tests and text routes return bounded generic failures', async () => {
  const service = {
    testProvider: async () => { throw new ProviderRequestError() },
    setTaskRoute: async () => { throw new ProviderValidationError() },
  }
  const router = createAiProvidersRouter({ authenticateToken: adminChain, requireAdmin: adminChain, service })

  await withServer(router, async baseUrl => {
    const testResponse = await fetch(`${baseUrl}/api/ai-providers/9/test`, { method: 'POST' })
    assert.equal(testResponse.status, 502)
    assert.deepEqual(await testResponse.json(), { success: false, message: 'AI 服务连接测试失败' })

    const routeResponse = await fetch(`${baseUrl}/api/ai-providers/routes/script_integration`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 9, model: 'bad-model' }),
    })
    assert.equal(routeResponse.status, 400)
    assert.deepEqual(await routeResponse.json(), { success: false, message: 'AI 服务配置无效' })
  })
})
