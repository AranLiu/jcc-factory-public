import { describe, expect, it } from 'vitest'
import { canDownloadProject, canEditProject, isProjectReadOnly } from './projectPermissions'

describe('project permission matrix', () => {
  const project = { user_id: 10 }

  it('allows readonly_global users to read but not edit another project', () => {
    const user = { id: 20, role: 'user', permission: 'readonly_global' }
    expect(canDownloadProject(user, project)).toBe(true)
    expect(canEditProject(user, project)).toBe(false)
    expect(isProjectReadOnly(user, project)).toBe(true)
  })

  it('allows owners, global users, and administrators to edit as defined', () => {
    expect(canEditProject({ id: 10, role: 'user', permission: 'personal' }, project)).toBe(true)
    expect(canEditProject({ id: 20, role: 'user', permission: 'global' }, project)).toBe(true)
    expect(canEditProject({ id: 20, role: 'admin', permission: 'personal' }, project)).toBe(true)
  })
})
