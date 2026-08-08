import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const homepageSource = readFileSync(new URL('./Homepage.jsx', import.meta.url), 'utf8')

describe('Homepage short-drama entry', () => {
  it('presents short-drama creation as the only project entry', () => {
    expect(homepageSource).toContain('拆短剧')
    expect(homepageSource).not.toContain('拆小说')
    expect(homepageSource).not.toContain("handleFeatureSelect('novel')")
  })
})
