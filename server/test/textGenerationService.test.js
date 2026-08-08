const assert = require('node:assert/strict')
const test = require('node:test')

const { TextGenerationService } = require('../services/textGenerationService')

test('configured script route dispatches to its exact provider and model', async () => {
  const calls = []
  const provider = { id: 9, provider_type: 'openai' }
  const service = new TextGenerationService({
    providerService: {
      getTaskRoute: async () => ({ taskType: 'script_integration', model: 'gpt-5-mini', provider }),
      generateText: async (...args) => { calls.push(args); return { success: true, text: 'provider result' } },
    },
    legacyGeminiFactory: () => ({ integrateScript: async () => { throw new Error('must not fallback') } }),
  })

  const result = await service.integrateScript('整合要求', '草稿内容', { model: 'ignored-client-model' })
  assert.equal(result.text, 'provider result')
  assert.equal(calls[0][0], provider)
  assert.equal(calls[0][3], 'gpt-5-mini')
  assert.match(calls[0][2], /草稿内容/)
})

test('a configured provider failure never falls back to legacy Gemini', async () => {
  let legacyCalled = false
  const service = new TextGenerationService({
    providerService: {
      getTaskRoute: async () => ({ model: 'configured-model', provider: { provider_type: 'openai' } }),
      generateText: async () => { throw new Error('provider failed') },
    },
    legacyGeminiFactory: () => ({ integrateScript: async () => { legacyCalled = true } }),
  })

  await assert.rejects(service.integrateScript('prompt', 'draft'), /provider failed/)
  assert.equal(legacyCalled, false)
})

test('installations without a provider route retain the existing Gemini integration path', async () => {
  const service = new TextGenerationService({
    providerService: { getTaskRoute: async () => null },
    legacyGeminiFactory: () => ({
      integrateScript: async (prompt, draft, modelConfig) => ({ text: `${prompt}:${draft}:${modelConfig.model}` }),
    }),
  })

  const result = await service.integrateScript('prompt', 'draft', { model: 'gemini-legacy' })
  assert.equal(result.text, 'prompt:draft:gemini-legacy')
})
