import { describe, expect, it, vi } from 'vitest'
import {
  applyFetchSecurity,
  applySessionSecurity,
  createAuthResponseErrorHandler,
  getCookie,
  isMutationMethod,
  secureFetch,
  shouldRedirectToLogin,
} from './httpSecurity'

describe('HTTP session security helpers', () => {
  it('reads the CSRF cookie without exposing the HttpOnly session cookie', () => {
    expect(getCookie('jcc_csrf', 'theme=dark; jcc_csrf=abc%20123')).toBe('abc 123')
    expect(getCookie('missing', 'jcc_csrf=abc')).toBeNull()
  })

  it('identifies only state-changing HTTP methods', () => {
    expect(isMutationMethod('get')).toBe(false)
    expect(isMutationMethod('HEAD')).toBe(false)
    expect(isMutationMethod('post')).toBe(true)
    expect(isMutationMethod('DELETE')).toBe(true)
  })

  it('adds credentials and the CSRF header to mutations', () => {
    const headers = new Map()
    headers.set = headers.set.bind(headers)
    const config = applySessionSecurity({ method: 'post', headers }, 'jcc_csrf=csrf-value')
    expect(config.withCredentials).toBe(true)
    expect(headers.get('X-CSRF-Token')).toBe('csrf-value')
  })

  it('builds secure fetch options without an Authorization header', () => {
    const options = applyFetchSecurity({ method: 'DELETE', headers: { Accept: 'application/json' } }, 'jcc_csrf=csrf')
    expect(options.credentials).toBe('include')
    expect(options.headers['X-CSRF-Token']).toBe('csrf')
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('secureFetch delegates with protected options', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    await secureFetch('/api/example', { method: 'POST' }, fetchImpl, 'jcc_csrf=csrf')
    expect(fetchImpl).toHaveBeenCalledWith('/api/example', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
    }))
  })

  it('redirects only for expired sessions, not authorization or CSRF failures', () => {
    expect(shouldRedirectToLogin(401, '/api/projects')).toBe(true)
    expect(shouldRedirectToLogin(401, '/api/auth/login')).toBe(false)
    expect(shouldRedirectToLogin(403, '/api/projects')).toBe(false)
  })

  it('never redirects verification failures because route guards own unauthenticated navigation', () => {
    expect(shouldRedirectToLogin(401, '/api/auth/verify', '/login')).toBe(false)
    expect(shouldRedirectToLogin(401, '/api/auth/verify', '/setup')).toBe(false)
  })

  it('keeps setup navigation after a verify 401 and the old 100ms redirect window', async () => {
    vi.useFakeTimers()
    const location = { pathname: '/login', href: '/login' }
    const handler = createAuthResponseErrorHandler({
      getLocation: () => location,
      schedule: setTimeout,
    })
    const verifyError = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
      config: { url: '/api/auth/verify' },
    })

    await expect(handler(verifyError)).rejects.toBe(verifyError)
    location.pathname = '/setup'
    location.href = '/setup'
    await vi.advanceTimersByTimeAsync(100)

    expect(location.href).toBe('/setup')
    vi.useRealTimers()
  })
})
