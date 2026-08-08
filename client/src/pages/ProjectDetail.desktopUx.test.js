import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProjectDetail.jsx', import.meta.url), 'utf8')

describe('ProjectDetail desktop hierarchy', () => {
  it('keeps upload primary and advanced analysis settings collapsed', () => {
    expect(source).toContain('上传短剧视频')
    expect(source).toContain('高级分析设置')
    expect(source).toContain('模型、Temperature 与 Prompt')
    expect(source).toContain('<Collapse')
    expect(source).not.toContain("height: '110vh'")
  })
})
