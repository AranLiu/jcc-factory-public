import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProjectEmptyState.jsx', import.meta.url), 'utf8')

describe('ProjectEmptyState', () => {
  it('explains the first desktop action and exposes a create-project callback', () => {
    expect(source).toContain('还没有短剧项目')
    expect(source).toContain('创建短剧项目')
    expect(source).toContain('onCreate')
  })
})
