const express = require('express')
const { authenticateToken } = require('../middleware/auth')
const { canReadResource } = require('../utils/authorization')
const { getCharacterRegistryService } = require('../services/characterRegistryService')

function createCharactersRouter({
  authenticate = authenticateToken,
  databasePool,
  registryService,
} = {}) {
  const router = express.Router()
  const resolvePool = () => databasePool || require('../config/database').pool
  const resolveRegistry = () => registryService || getCharacterRegistryService()

  router.use(authenticate)

  router.get('/project/:projectId', async (req, res) => {
    const projectId = Number(req.params.projectId)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: '项目编号无效' })
    }

    try {
      const [projects] = await resolvePool().execute(
        'SELECT id, user_id FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      )
      const project = projects[0]
      if (!project) return res.status(404).json({ success: false, message: '项目不存在' })
      if (!canReadResource(req.user, project.user_id)) {
        return res.status(403).json({ success: false, message: '无权查看该项目的角色档案' })
      }

      const data = await resolveRegistry().getProjectRegistry(projectId)
      return res.json({ success: true, data })
    } catch (error) {
      console.error('Character registry query failed')
      return res.status(500).json({ success: false, message: '角色档案暂时无法加载' })
    }
  })

  return router
}

const router = createCharactersRouter()
module.exports = router
module.exports.createCharactersRouter = createCharactersRouter
