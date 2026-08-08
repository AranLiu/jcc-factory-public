import DOMPurify from 'dompurify'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export const sanitizeMarkdownUrl = (input) => {
  const value = String(input || '').replace(/[\u0000-\u0020\u007f]+/g, '').trim()
  if (!value) return '#'
  if (value.startsWith('/') || value.startsWith('#')) return value
  try {
    const url = new URL(value)
    return ALLOWED_PROTOCOLS.has(url.protocol) ? value : '#'
  } catch {
    return '#'
  }
}

export const sanitizeRenderedHtml = (html, purifier = DOMPurify) => purifier.sanitize(html, {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['srcdoc'],
})
