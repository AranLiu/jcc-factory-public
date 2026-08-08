import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

describe('authenticated desktop home route', () => {
  it('uses the workspace as the authenticated home without loading the retired homepage', () => {
    expect(appSource).not.toContain("lazy(() => import('./pages/Homepage'))")
    expect(appSource).toContain('<Navigate to="/workspace" replace />')
    expect(appSource).toContain("onboardingDestination(user, '/workspace')")
  })
})
