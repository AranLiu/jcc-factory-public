import api, { systemConfigAPI } from './api'

const responseEnvelope = (response) => response?.success === true
  ? response
  : response?.data?.success === true ? response.data : response
const isBoolean = (value) => typeof value === 'boolean'

function statusFromResponse(response) {
  const envelope = responseEnvelope(response)
  const status = envelope?.success === true ? envelope.data : null

  if (
    !status
    || !isBoolean(status.required)
    || !isBoolean(status.completed)
    || !isBoolean(status.apiKeyConfigured)
    || !isBoolean(status.managedByEnvironment)
    || typeof status.defaultModel !== 'string'
    || status.defaultModel.trim() === ''
  ) {
    throw new Error('Invalid API onboarding status response')
  }

  return {
    required: status.required,
    completed: status.completed,
    apiKeyConfigured: status.apiKeyConfigured,
    managedByEnvironment: status.managedByEnvironment,
    defaultModel: status.defaultModel,
  }
}

function completionFromResponse(response) {
  const envelope = responseEnvelope(response)
  const completion = envelope?.success === true ? envelope.data : null

  if (!completion || completion.completed !== true || !isBoolean(completion.skipped)) {
    throw new Error('Invalid API onboarding completion response')
  }

  return { completed: true, skipped: completion.skipped }
}

function testResultFromResponse(response) {
  const envelope = responseEnvelope(response)
  if (envelope?.success !== true || !isBoolean(envelope.data?.success)) {
    throw new Error('Invalid Gemini test response')
  }
  if (!envelope.data.success) throw new Error('Gemini connection test failed')
  return envelope.data
}

export const onboardingDestination = (user, fallback = '/workspace') =>
  user?.role === 'admin' && user?.apiOnboardingRequired === true ? '/setup/api' : fallback

export async function fetchApiOnboardingStatus(http = api) {
  return statusFromResponse(await http.get('/api/system-config/onboarding'))
}

export async function completeApiOnboarding(skipped, http = api) {
  if (!isBoolean(skipped)) throw new Error('skipped must be a boolean')
  return completionFromResponse(await http.put('/api/system-config/onboarding', { skipped }))
}

export async function saveAndTestApiOnboarding({ apiKey, defaultModel }, systemConfig = systemConfigAPI) {
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  const trimmedDefaultModel = typeof defaultModel === 'string' ? defaultModel.trim() : ''
  if (!trimmedDefaultModel) {
    throw new Error('A default model is required')
  }

  if (trimmedKey) await systemConfig.updateGeminiKey(trimmedKey)
  await systemConfig.updateModels(trimmedDefaultModel, [trimmedDefaultModel])
  return testResultFromResponse(await systemConfig.testGemini())
}

export async function retryApiOnboardingTest(systemConfig = systemConfigAPI) {
  return testResultFromResponse(await systemConfig.testGemini())
}
