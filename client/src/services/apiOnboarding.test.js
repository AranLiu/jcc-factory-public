import { describe, expect, it } from 'vitest'
import {
  completeApiOnboarding,
  fetchApiOnboardingStatus,
  onboardingDestination,
  retryApiOnboardingTest,
  saveAndTestApiOnboarding,
} from './apiOnboarding'

describe('API onboarding service', () => {
  it('routes only an administrator requiring onboarding to the API step', () => {
    expect(onboardingDestination({ role: 'admin', apiOnboardingRequired: true })).toBe('/setup/api')
    expect(onboardingDestination({ role: 'user', apiOnboardingRequired: true })).toBe('/workspace')
    expect(onboardingDestination({ role: 'admin', apiOnboardingRequired: 'true' }, '/workspace')).toBe('/workspace')
  })

  it('accepts only complete, secret-free onboarding status responses', async () => {
    await expect(fetchApiOnboardingStatus({
      get: async () => ({ data: {
        success: true,
        data: {
          required: true,
          completed: false,
          apiKeyConfigured: false,
          managedByEnvironment: false,
          defaultModel: 'gemini-3.6-flash',
        },
      } }),
    })).resolves.toEqual({
      required: true,
      completed: false,
      apiKeyConfigured: false,
      managedByEnvironment: false,
      defaultModel: 'gemini-3.6-flash',
    })
  })

  it('rejects malformed onboarding status responses', async () => {
    await expect(fetchApiOnboardingStatus({ get: async () => ({ data: {} }) })).rejects.toThrow('Invalid API onboarding status response')
    await expect(fetchApiOnboardingStatus({
      get: async () => ({ data: { success: true, data: { required: true } } }),
    })).rejects.toThrow('Invalid API onboarding status response')
  })

  it('saves an optional key and model before testing server-side connectivity', async () => {
    const calls = []
    const systemConfig = {
      updateGeminiKey: async (apiKey) => { calls.push(['key', apiKey]) },
      updateModels: async (model, models) => { calls.push(['model', model, models]) },
      testGemini: async () => { calls.push(['test']); return { success: true, data: { success: true } } },
    }

    await saveAndTestApiOnboarding({ apiKey: 'key-is-only-sent-to-the-server', defaultModel: 'gemini-3.6-flash' }, systemConfig)

    expect(calls).toEqual([
      ['key', 'key-is-only-sent-to-the-server'],
      ['model', 'gemini-3.6-flash', ['gemini-3.6-flash']],
      ['test'],
    ])
  })

  it('normalizes a default model once before persisting and testing it', async () => {
    const calls = []
    const systemConfig = {
      updateGeminiKey: async () => {},
      updateModels: async (model, models) => { calls.push(['model', model, models]) },
      testGemini: async () => { calls.push(['test']); return { success: true, data: { success: true } } },
    }

    await saveAndTestApiOnboarding({ apiKey: '', defaultModel: '  gemini-3.6-flash  ' }, systemConfig)

    expect(calls).toEqual([
      ['model', 'gemini-3.6-flash', ['gemini-3.6-flash']],
      ['test'],
    ])
  })

  it('does not send a blank optional key and rejects malformed test results', async () => {
    const calls = []
    const systemConfig = {
      updateGeminiKey: async () => { calls.push(['key']) },
      updateModels: async (model, models) => { calls.push(['model', model, models]) },
      testGemini: async () => ({ success: true, data: {} }),
    }

    await expect(saveAndTestApiOnboarding({ apiKey: '  ', defaultModel: 'gemini-3.6-flash' }, systemConfig))
      .rejects.toThrow('Invalid Gemini test response')
    expect(calls).toEqual([['model', 'gemini-3.6-flash', ['gemini-3.6-flash']]])
  })

  it('does not complete a failed server-side connection test', async () => {
    const systemConfig = {
      updateGeminiKey: async () => {},
      updateModels: async () => {},
      testGemini: async () => ({ success: true, data: { success: false } }),
    }

    await expect(saveAndTestApiOnboarding({ apiKey: '', defaultModel: 'gemini-3.6-flash' }, systemConfig))
      .rejects.toThrow('Gemini connection test failed')
  })

  it('retries only the server-side connectivity test', async () => {
    const testGemini = async () => ({ success: true, data: { success: true } })
    await expect(retryApiOnboardingTest({ testGemini })).resolves.toEqual({ success: true })
  })

  it('completes onboarding only from a strict server confirmation', async () => {
    const calls = []
    const http = {
      put: async (...args) => {
        calls.push(args)
        return { data: { success: true, data: { completed: true, skipped: true } } }
      },
    }

    await expect(completeApiOnboarding(true, http)).resolves.toEqual({ completed: true, skipped: true })
    expect(calls).toEqual([['/api/system-config/onboarding', { skipped: true }]])
  })
})
