import { describe, expect, it } from 'vitest'
import { matchRoutePath, normalizeInternalPath } from './router'

describe('internal router security', () => {
  it('matches exact, parameterized, and wildcard application routes', () => {
    expect(matchRoutePath('/project/:id', '/project/42')).toEqual({ id: '42' })
    expect(matchRoutePath('/workspace', '/workspace')).toEqual({})
    expect(matchRoutePath('/workspace', '/workspace/extra')).toBeNull()
    expect(matchRoutePath('*', '/unknown')).toEqual({})
  })

  it('accepts only same-origin absolute paths', () => {
    expect(normalizeInternalPath('/workspace?owner=2')).toBe('/workspace?owner=2')
    expect(normalizeInternalPath('//evil.example/path')).toBe('/')
    expect(normalizeInternalPath('https://evil.example/path')).toBe('/')
    expect(normalizeInternalPath('javascript:alert(1)')).toBe('/')
  })
})
