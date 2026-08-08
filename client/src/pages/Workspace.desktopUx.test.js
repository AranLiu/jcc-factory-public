import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Workspace.jsx', import.meta.url), 'utf8')

describe('Workspace desktop UX', () => {
  it('uses short-drama copy, an explicit empty state, and no redundant homepage action', () => {
    expect(source).toContain('短剧项目工作台')
    expect(source).toContain('ProjectEmptyState')
    expect(source).toContain('locale={{')
    expect(source).toContain('由 ${record.last_operator_name}')
    expect(source).not.toContain('返回主页')
    expect(source).not.toContain(' by ')
  })
})
