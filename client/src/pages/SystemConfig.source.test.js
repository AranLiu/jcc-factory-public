import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./SystemConfig.jsx', import.meta.url), 'utf8')

describe('system configuration desktop workflow', () => {
  it('organizes configuration around the real short-drama pipeline', () => {
    expect(source).toContain('AI 与工作流配置')
    expect(source).toContain('拉片流水线')
    expect(source).toContain('AI 服务')
    expect(source).toContain('提示词工作流')
    expect(source).toContain('高级设置')
    expect(source).toContain('Step 1.1')
    expect(source).toContain('Step 1.2')
    expect(source).toContain('Step 2')
    expect(source).toContain('Step 3.1')
    expect(source).toContain('Step 3.2')
  })

  it('names the legacy Gemini card by its task instead of calling it generic model configuration', () => {
    expect(source).toContain('Gemini 视频解析服务')
    expect(source).not.toContain('<span>AI模型配置</span>')
  })

  it('only tests paid provider connections after an explicit user action', () => {
    const initialLoad = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('const geminiModels'))

    expect(initialLoad).toContain('loadConfigs()')
    expect(initialLoad).not.toContain('loadStatus()')
    expect(source).toContain("onClick={() => testConnection('gemini')}")
  })
})
