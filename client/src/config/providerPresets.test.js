import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS, getProviderPreset } from './providerPresets'

describe('AI provider presets', () => {
  it('covers common native, domestic, international, local, and custom services', () => {
    expect(PROVIDER_PRESETS.map(preset => preset.id)).toEqual(expect.arrayContaining([
      'gemini',
      'openai',
      'deepseek',
      'qwen_bailian',
      'zhipu_glm',
      'volcengine_ark',
      'mistral',
      'ollama',
      'custom',
    ]))
  })

  it('maps compatible vendors to the supported backend protocol', () => {
    expect(getProviderPreset('deepseek')).toMatchObject({
      providerType: 'openai_compatible',
      baseUrl: 'https://api.deepseek.com',
    })
    expect(getProviderPreset('zhipu_glm')).toMatchObject({
      providerType: 'openai_compatible',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    })
    expect(getProviderPreset('ollama')).toMatchObject({
      providerType: 'openai_compatible',
      baseUrl: 'http://localhost:11434/v1',
    })
  })

  it('keeps multiple OpenAI model roles available', () => {
    expect(getProviderPreset('openai').models).toEqual(expect.arrayContaining([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]))
  })
})
