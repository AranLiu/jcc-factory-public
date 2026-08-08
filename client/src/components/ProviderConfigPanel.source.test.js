import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProviderConfigPanel.jsx', import.meta.url), 'utf8')

describe('desktop AI provider center', () => {
  it('supports real provider types with write-only secrets and honest capabilities', () => {
    expect(source).toContain('PROVIDER_PRESET_OPTIONS')
    expect(source).toContain('inferProviderPreset')
    expect(source).toContain('常用国内外厂商')
    expect(source).toContain('autoComplete="new-password"')
    expect(source).toContain("setFieldValue('apiKey', '')")
    expect(source).toContain('文本生成任务路由')
    expect(source).toContain('当前剧本整合路由不可用')
    expect(source).not.toContain('[REDACTED]')
  })
})
