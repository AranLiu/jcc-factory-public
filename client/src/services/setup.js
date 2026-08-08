import api from './api'

const responseData = (response) => response?.data ?? response

export async function fetchSetupStatus(http = api) {
  const status = responseData(await http.get('/api/auth/setup-status'))
  if (typeof status?.initialized !== 'boolean') {
    throw new Error('Invalid setup status response')
  }
  return { initialized: status.initialized }
}

export function submitInitialAdmin({ username, password }, http = api) {
  return http.post('/api/auth/setup', { username, password })
}

export const shouldRedirectToSetup = (status) => status?.initialized === false

export function createSubmissionLock() {
  let acquired = false

  return {
    tryAcquire() {
      if (acquired) return false
      acquired = true
      return true
    },
    release() {
      acquired = false
    },
  }
}

export function setupErrorAction(error) {
  switch (error.response?.status) {
    case 409:
      return { message: '系统已完成初始化，请使用管理员账号登录', redirectToLogin: true }
    case 503:
      return { message: '系统正在初始化，请稍后重试', redirectToLogin: false }
    case 403:
      return { message: '安全校验已过期，请重试', redirectToLogin: false, refreshStatus: true }
    default:
      return { message: '初始化失败，请稍后重试', redirectToLogin: false }
  }
}
