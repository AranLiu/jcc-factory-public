import React, {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'

const RouterContext = createContext(null)
const ParamsContext = createContext({})

export function normalizeInternalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/'
  return value
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function matchRoutePath(pattern, pathname) {
  if (pattern === '*') return {}
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeSegment(actual)
    } else if (expected !== actual) {
      return null
    }
  }
  return params
}

function readLocation() {
  if (typeof window === 'undefined') return { pathname: '/', search: '', hash: '', state: null }
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
    hash: window.location.hash || '',
    state: window.history.state
  }
}

export function BrowserRouter({ children }) {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const handleNavigation = () => setLocation(readLocation())
    window.addEventListener('popstate', handleNavigation)
    return () => window.removeEventListener('popstate', handleNavigation)
  }, [])

  const navigate = useCallback((target, options = {}) => {
    if (typeof target === 'number') {
      window.history.go(target)
      return
    }
    const path = normalizeInternalPath(target)
    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method](options.state ?? null, '', path)
    setLocation(readLocation())
  }, [])

  const value = useMemo(() => ({ location, navigate }), [location, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function Route() {
  return null
}

export function Routes({ children }) {
  const location = useLocation()
  let selected = null
  let params = {}

  for (const child of Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== Route) continue
    const match = matchRoutePath(child.props.path, location.pathname)
    if (match !== null) {
      selected = child.props.element
      params = match
      break
    }
  }

  return <ParamsContext.Provider value={params}>{selected}</ParamsContext.Provider>
}

export function Navigate({ to, replace = false }) {
  const navigate = useNavigate()
  useEffect(() => navigate(to, { replace }), [navigate, replace, to])
  return null
}

export function useLocation() {
  const router = useContext(RouterContext)
  if (!router) throw new Error('useLocation must be used inside BrowserRouter')
  return router.location
}

export function useNavigate() {
  const router = useContext(RouterContext)
  if (!router) throw new Error('useNavigate must be used inside BrowserRouter')
  return router.navigate
}

export function useParams() {
  return useContext(ParamsContext)
}
