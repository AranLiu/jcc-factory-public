import { describe, expect, it } from 'vitest'
import { sanitizeMarkdownUrl, sanitizeRenderedHtml } from './htmlSecurity'

describe('sanitizeMarkdownUrl', () => {
  it('allows web, mail, and relative links', () => {
    expect(sanitizeMarkdownUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeMarkdownUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(sanitizeMarkdownUrl('/documents/1')).toBe('/documents/1')
  })

  it('rejects executable and malformed schemes', () => {
    expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBe('#')
    expect(sanitizeMarkdownUrl('data:text/html,boom')).toBe('#')
    expect(sanitizeMarkdownUrl('java\nscript:alert(1)')).toBe('#')
  })
})

describe('sanitizeRenderedHtml', () => {
  it('delegates to the configured HTML sanitizer with a restricted policy', () => {
    const purifier = { sanitize: (html, options) => `${html}|${options.USE_PROFILES.html}` }
    expect(sanitizeRenderedHtml('<b>safe</b>', purifier)).toBe('<b>safe</b>|true')
  })
})
