const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const getCookie = (name, cookieHeader = (typeof document === 'undefined' ? '' : document.cookie)) => {
  const prefix = `${name}=`
  const item = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))
  if (!item) return null
  try {
    return decodeURIComponent(item.slice(prefix.length))
  } catch {
    return null
  }
}

export const isMutationMethod = (method = 'GET') => !SAFE_METHODS.has(String(method).toUpperCase())

export const shouldRedirectToLogin = (
  status,
  url,
) => (
  status === 401 &&
  url !== '/api/auth/login' &&
  url !== '/api/auth/verify'
)

export const createAuthResponseErrorHandler = ({
  getLocation = () => window.location,
  schedule = setTimeout,
} = {}) => {
  let isRedirecting = false

  return (error) => {
    if (shouldRedirectToLogin(error.response?.status, error.config?.url) && !isRedirecting) {
      isRedirecting = true
      schedule(() => {
        const location = getLocation()
        if (location.pathname !== '/login') location.href = '/login'
        isRedirecting = false
      }, 100)
    }
    return Promise.reject(error)
  }
}

export const applySessionSecurity = (config, cookieHeader) => {
  config.withCredentials = true
  if (!isMutationMethod(config.method)) return config

  const csrfToken = getCookie('jcc_csrf', cookieHeader)
  if (!csrfToken) return config
  if (typeof config.headers?.set === 'function') config.headers.set('X-CSRF-Token', csrfToken)
  else config.headers = { ...config.headers, 'X-CSRF-Token': csrfToken }
  return config
}

export const applyFetchSecurity = (options = {}, cookieHeader) => {
  const secured = {
    ...options,
    credentials: 'include',
    headers: { ...(options.headers || {}) },
  }
  delete secured.headers.Authorization
  if (isMutationMethod(secured.method)) {
    const csrfToken = getCookie('jcc_csrf', cookieHeader)
    if (csrfToken) secured.headers['X-CSRF-Token'] = csrfToken
  }
  return secured
}

export const secureFetch = (input, options = {}, fetchImpl = fetch, cookieHeader) => (
  fetchImpl(input, applyFetchSecurity(options, cookieHeader))
)
