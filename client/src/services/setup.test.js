import { describe, expect, it } from 'vitest'
import {
  createSubmissionLock,
  fetchSetupStatus,
  setupErrorAction,
  shouldRedirectToSetup,
  submitInitialAdmin,
} from './setup'

describe('first-run setup service', () => {
  it('accepts only strict boolean setup status responses', async () => {
    await expect(fetchSetupStatus({
      get: async () => ({ data: { initialized: false } }),
    })).resolves.toEqual({ initialized: false })
    await expect(fetchSetupStatus({
      get: async () => ({ data: { initialized: true } }),
    })).resolves.toEqual({ initialized: true })

    for (const initialized of [1, 0, 'true', null, undefined]) {
      await expect(fetchSetupStatus({
        get: async () => ({ data: { initialized } }),
      })).rejects.toThrow('Invalid setup status response')
    }
  })

  it('posts only the administrator fields', async () => {
    const calls = []
    const http = {
      post: async (...args) => {
        calls.push(args)
        return { created: true }
      },
    }

    await submitInitialAdmin({
      username: 'first-admin',
      email: 'admin@example.com',
      password: 'a secure password',
      confirmPassword: 'a secure password',
    }, http)

    expect(calls).toEqual([['/api/auth/setup', {
      username: 'first-admin',
      password: 'a secure password',
    }]])
  })

  it('propagates an already-initialized conflict', async () => {
    const conflict = Object.assign(new Error('Conflict'), {
      response: { status: 409, data: { code: 'already_initialized' } },
    })
    const http = {
      post: async () => { throw conflict },
    }

    await expect(submitInitialAdmin({}, http)).rejects.toBe(conflict)
  })

  it('redirects only uninitialized systems to setup', () => {
    expect(shouldRedirectToSetup({ initialized: false })).toBe(true)
    expect(shouldRedirectToSetup({ initialized: true })).toBe(false)
  })

  it('allows only one setup submission until released', () => {
    const lock = createSubmissionLock()

    expect(lock.tryAcquire()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    lock.release()
    expect(lock.tryAcquire()).toBe(true)
  })

  it('redirects to login for any setup conflict', () => {
    expect(setupErrorAction({ response: { status: 409 } })).toEqual({
      message: '系统已完成初始化，请使用管理员账号登录',
      redirectToLogin: true,
    })
  })

  it('keeps a busy setup request on the setup page', () => {
    expect(setupErrorAction({ response: { status: 503 } })).toEqual({
      message: '系统正在初始化，请稍后重试',
      redirectToLogin: false,
    })
  })

  it('refreshes setup status and CSRF after a forbidden setup submission', () => {
    expect(setupErrorAction({ response: { status: 403 } })).toEqual({
      message: '安全校验已过期，请重试',
      redirectToLogin: false,
      refreshStatus: true,
    })
  })

  it('uses a safe generic error action for other failures', () => {
    expect(setupErrorAction(new Error('offline'))).toEqual({
      message: '初始化失败，请稍后重试',
      redirectToLogin: false,
    })
  })
})
