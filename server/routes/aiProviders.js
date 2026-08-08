const express = require('express')
const { authenticateToken, requireAdmin } = require('../middleware/auth')
const {
  AiProviderService,
  ProviderRequestError,
  ProviderValidationError,
  serializeProvider,
} = require('../services/aiProviderService')

let defaultService

function getDefaultService() {
  if (!defaultService) {
    const { pool } = require('../config/database')
    defaultService = new AiProviderService({ pool })
  }
  return defaultService
}

function serializeTaskRoute(route) {
  if (!route) return null
  return {
    taskType: route.taskType,
    model: route.model,
    provider: serializeProvider(route.provider),
  }
}

function sendProviderError(res, error) {
  if (error instanceof ProviderValidationError) {
    return res.status(400).json({ success: false, message: 'AI 服务配置无效' })
  }
  if (error instanceof ProviderRequestError) {
    return res.status(502).json({ success: false, message: 'AI 服务连接测试失败' })
  }
  console.error('AI provider operation failed')
  return res.status(500).json({ success: false, message: 'AI 服务配置暂时不可用' })
}

function createAiProvidersRouter({
  authenticateToken: authenticate = authenticateToken,
  requireAdmin: requireAdministrator = requireAdmin,
  service,
} = {}) {
  const router = express.Router()
  const resolveService = () => service || getDefaultService()

  router.use(authenticate, requireAdministrator)

  router.get('/', async (_req, res) => {
    try {
      const activeService = resolveService()
      const [providers, scriptRoute] = await Promise.all([
        activeService.listProviders(),
        activeService.getTaskRoute('script_integration', { allowInvalid: true }),
      ])
      res.json({
        success: true,
        data: { providers, routes: { scriptIntegration: serializeTaskRoute(scriptRoute) } },
      })
    } catch (error) {
      sendProviderError(res, error)
    }
  })

  router.post('/', async (req, res) => {
    try {
      const provider = await resolveService().createProvider(req.body, req.user.id)
      res.status(201).json({ success: true, data: provider })
    } catch (error) {
      sendProviderError(res, error)
    }
  })

  router.put('/routes/:taskType', async (req, res) => {
    try {
      const route = await resolveService().setTaskRoute(
        req.params.taskType,
        req.body?.providerId,
        req.body?.model,
        req.user.id
      )
      res.json({ success: true, data: route })
    } catch (error) {
      sendProviderError(res, error)
    }
  })

  router.post('/:id/test', async (req, res) => {
    try {
      const result = await resolveService().testProvider(req.params.id)
      res.json({ success: true, data: result })
    } catch (error) {
      sendProviderError(res, error)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const provider = await resolveService().updateProvider(req.params.id, req.body, req.user.id)
      res.json({ success: true, data: provider })
    } catch (error) {
      sendProviderError(res, error)
    }
  })

  return router
}

const router = createAiProvidersRouter()
router.createAiProvidersRouter = createAiProvidersRouter
router.sendProviderError = sendProviderError

module.exports = router
