import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const systemConfig = readFileSync(new URL('./SystemConfig.jsx', import.meta.url), 'utf8')
const onboarding = readFileSync(new URL('./ApiOnboarding.jsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../services/api.js', import.meta.url), 'utf8')

describe('provider configuration entry points', () => {
  it('mounts the provider center and exposes CRUD, test, and routing APIs', () => {
    expect(systemConfig).toContain('<ProviderConfigPanel />')
    expect(api).toContain('export const aiProviderAPI')
    expect(api).toContain('/api/ai-providers')
    expect(api).toContain('/routes/script_integration')
  })

  it('offers provider selection during first-run setup', () => {
    expect(onboarding).toContain('OpenAI-compatible')
    expect(onboarding).toContain('providerType')
    expect(onboarding).toContain('createProvider')
    expect(onboarding).toContain('视频解析目前仍需 Gemini')
  })
})
