function isOwner(user, project) {
  return Boolean(user && project && Number(project.user_id) === Number(user.id))
}

export function canEditProject(user, project) {
  if (!user) return false
  if (user.role === 'admin' || user.permission === 'global') return true
  if (!project) return ['personal', 'readonly_global'].includes(user.permission || 'personal')
  return isOwner(user, project)
}

export function canDownloadProject(user, project) {
  if (!user) return false
  if (user.role === 'admin' || ['global', 'readonly_global'].includes(user.permission)) return true
  if (!project) return true
  return isOwner(user, project)
}

export function isProjectReadOnly(user, project) {
  return Boolean(user?.permission === 'readonly_global' && project && !isOwner(user, project))
}
