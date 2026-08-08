import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve('src/services/api.js'), 'utf8')

describe('business API session handling', () => {
  it('routes 401 failures through the shared login redirect handler', () => {
    expect(source).toContain('createAuthResponseErrorHandler')
    expect(source).toMatch(/const handleAuthResponseError = createAuthResponseErrorHandler\(\)/)
    expect(source).toMatch(/return handleAuthResponseError\(error\)/)
  })
})
