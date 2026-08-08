import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const onboarding = readFileSync(new URL('./ApiOnboarding.jsx', import.meta.url), 'utf8')
const systemConfig = readFileSync(new URL('./SystemConfig.jsx', import.meta.url), 'utf8')

describe('desktop user-facing copy', () => {
  it('uses Chinese setup actions and Chinese audit attribution', () => {
    expect(onboarding).toContain('第 2 步，共 2 步')
    expect(onboarding).toContain('保存并测试')
    expect(onboarding).toContain("navigate('/workspace', { replace: true })")
    expect(onboarding).not.toContain('Configure later')
    expect(systemConfig).not.toContain(' by ${')
    expect(systemConfig).toContain('由 ${')
  })
})
