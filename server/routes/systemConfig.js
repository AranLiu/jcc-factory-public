const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { pool } = require('../config/database');
const systemConfigService = require('../services/systemConfigService');
const { maskSecretConfigs } = require('../utils/security');
const { createRelayConfigUpdateHandler } = require('../utils/relayConfig');
const { BOOT_GEMINI_ENVIRONMENT } = require('../config/geminiEnvironment');
const {
    completeApiOnboarding,
    getApiOnboardingStatus
} = require('../services/apiOnboarding');

const router = express.Router();
const MAX_GEMINI_API_KEY_LENGTH = 4096;

class GeminiKeyValidationError extends Error {}

function validateGeminiApiKey(value) {
    if (typeof value !== 'string') throw new GeminiKeyValidationError();
    const normalized = value.trim();
    if (
        normalized === ''
        || normalized.length > MAX_GEMINI_API_KEY_LENGTH
        || /^\[redacted\]$/i.test(normalized)
        || /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
        throw new GeminiKeyValidationError();
    }
    return normalized;
}

function createGeminiKeyUpdateHandler({ configService = systemConfigService } = {}) {
    return async function updateGeminiKey(req, res) {
        try {
            const apiKey = validateGeminiApiKey(req.body?.apiKey);
            await configService.updateConfig('gemini_api_key', apiKey, req.user.id);
            const applied = await configService.applyConfigs();
            if (applied !== true) throw new Error('Gemini runtime configuration unavailable');
            return res.json({ success: true, message: 'Gemini API key updated' });
        } catch (error) {
            if (error instanceof GeminiKeyValidationError) {
                return res.status(400).json({ success: false, message: 'Gemini API key is invalid' });
            }
            console.error('Failed to update Gemini API key');
            return res.status(500).json({ success: false, message: 'Unable to update Gemini API key' });
        }
    };
}

function createApiOnboardingRouter({
    authenticateToken: authenticate = authenticateToken,
    requireAdmin: requireAdministrator = requireAdmin,
    connectionLike,
    pool: onboardingPool,
    env = BOOT_GEMINI_ENVIRONMENT,
    getStatus = getApiOnboardingStatus,
    complete = completeApiOnboarding
}) {
    const onboardingRouter = express.Router();
    const statusConnection = connectionLike || onboardingPool;

    onboardingRouter.use(authenticate, requireAdministrator);

    onboardingRouter.get('/', async (req, res) => {
        try {
            const status = await getStatus({ connectionLike: statusConnection, env });
            res.json({ success: true, data: status });
        } catch (error) {
            console.error('Failed to get API onboarding status');
            res.status(500).json({ success: false, message: 'Unable to get API onboarding status' });
        }
    });

    onboardingRouter.put('/', async (req, res) => {
        if (!req.body || typeof req.body.skipped !== 'boolean') {
            return res.status(400).json({ success: false, message: 'skipped must be a boolean' });
        }

        try {
            const result = await complete({
                pool: onboardingPool,
                userId: req.user.id,
                skipped: req.body.skipped
            });
            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Failed to complete API onboarding');
            res.status(500).json({ success: false, message: 'Unable to complete API onboarding' });
        }
    });

    return onboardingRouter;
}

/**
 * 获取公开的配置 (修改后，包含模型)
 */
router.get('/public-configs', authenticateToken, async (req, res) => {
    try {
        const configs = await systemConfigService.getAllConfigs();
        
        // 只返回公开的配置
        const publicConfigs = {
            video_analysis_prompt: configs.video_analysis_prompt || null,
            script_integration_prompt: configs.script_integration_prompt || null,
            gemini_default_model: configs.gemini_default_model || null,
            gemini_available_models: configs.gemini_available_models || null
        };
        
        res.json({
            success: true,
            data: publicConfigs
        });
    } catch (error) {
        console.error('获取公开配置失败:', error);
        res.status(500).json({
            success: false,
            message: '获取公开配置失败'
        });
    }
});

// 之前的 public-prompts 路由是为了兼容旧版，可以考虑移除
router.get('/public-prompts', authenticateToken, async (req, res) => {
    try {
        const configs = await systemConfigService.getAllConfigs();
        const publicPrompts = {
            video_analysis_prompt: configs.video_analysis_prompt || null,
            script_integration_prompt: configs.script_integration_prompt || null,
            character_knowledge_graph_prompt: configs.character_knowledge_graph_prompt || null,
            character_integration_prompt: configs.character_integration_prompt || null,
            character_prompt: configs.character_prompt || null
        };
        res.json({
            success: true,
            data: publicPrompts
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '获取失败' });
    }
});

// 所有系统配置路由都需要管理员权限
router.use('/onboarding', createApiOnboardingRouter({ pool }));
router.use(authenticateToken, requireAdmin);

/**
 * 获取所有系统配置
 */
router.get('/', async (req, res) => {
    try {
        const configs = await systemConfigService.getAllConfigs();
        
        res.json({
            success: true,
            data: maskSecretConfigs(configs)
        });
    } catch (error) {
        console.error('获取系统配置失败:', error);
        res.status(500).json({
            success: false,
            message: '获取系统配置失败'
        });
    }
});

/**
 * 获取连接状态
 */
router.get('/status', async (req, res) => {
    try {
        const status = await systemConfigService.getConnectionStatus();
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('获取连接状态失败:', error);
        res.status(500).json({
            success: false,
            message: '获取连接状态失败'
        });
    }
});

/**
 * 更新Gemini API密钥
 */
router.put('/gemini-key', createGeminiKeyUpdateHandler());

/**
 * 更新模型配置
 */
router.put('/models', async (req, res) => {
    try {
        const { defaultModel, availableModels } = req.body;
        
        if (!defaultModel || !Array.isArray(availableModels) || availableModels.length === 0) {
            return res.status(400).json({
                success: false,
                message: '默认模型和可用模型列表不能为空'
            });
        }

        if (!availableModels.includes(defaultModel)) {
            return res.status(400).json({
                success: false,
                message: '默认模型必须在可用模型列表中'
            });
        }

        // 更新默认模型
        await systemConfigService.updateConfig('gemini_default_model', defaultModel, req.user.id);
        
        // 更新可用模型列表
        await systemConfigService.updateConfig('gemini_available_models', availableModels, req.user.id);
        
        await systemConfigService.applyConfigs();
        
        res.json({
            success: true,
            message: '模型配置更新成功'
        });
    } catch (error) {
        console.error('更新模型配置失败:', error);
        res.status(500).json({
            success: false,
            message: '更新模型配置失败'
        });
    }
});

/**
 * 测试Gemini API连接
 */
router.post('/test-gemini', async (req, res) => {
    try {
        const result = await systemConfigService.testGeminiConnection();
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('测试Gemini连接失败:', error);
        res.status(500).json({
            success: false,
            message: '测试连接失败'
        });
    }
});

/**
 * 测试 API 中继服务连接
 */
router.post('/test-proxy', async (req, res) => {
    try {
        const result = await systemConfigService.testProxyConnection();
        
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('测试 API 中继连接失败');
        res.status(500).json({
            success: false,
            message: '测试 API 中继连接失败'
        });
    }
});

/**
 * 应用配置到运行环境
 */
router.post('/apply', async (req, res) => {
    try {
        const success = await systemConfigService.applyConfigs();
        
        if (success) {
            res.json({
                success: true,
                message: '配置应用成功'
            });
        } else {
            res.status(500).json({
                success: false,
                message: '配置应用失败'
            });
        }
    } catch (error) {
        console.error('应用配置失败:', error);
        res.status(500).json({
            success: false,
            message: '应用配置失败'
        });
    }
});

/**
 * 清除配置缓存
 */
router.post('/clear-cache', async (req, res) => {
    try {
        systemConfigService.clearCache();
        
        res.json({
            success: true,
            message: '缓存清除成功'
        });
    } catch (error) {
        console.error('清除缓存失败:', error);
        res.status(500).json({
            success: false,
            message: '清除缓存失败'
        });
    }
});



/**
 * 获取单个配置
 */
router.get('/config/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const value = await systemConfigService.getConfig(key);
        const masked = maskSecretConfigs({ [key]: { value } })[key];
        
        res.json({
            success: true,
            data: masked.value,
            configured: masked.configured
        });
    } catch (error) {
        console.error(`获取配置 ${req.params.key} 失败:`, error);
        res.status(500).json({
            success: false,
            message: '获取配置失败'
        });
    }
});

/**
 * 设置单个配置
 */
router.put('/config/:key', createRelayConfigUpdateHandler({ configService: systemConfigService }));



/**
 * 更新视频解析Prompt
 */
router.put('/video-analysis-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                message: '视频解析Prompt不能为空'
            });
        }

        await systemConfigService.updateConfig('video_analysis_prompt', prompt, req.user.id);
        
        res.json({
            success: true,
            message: '视频解析Prompt更新成功'
        });
    } catch (error) {
        console.error('更新视频解析Prompt失败:', error);
        res.status(500).json({
            success: false,
            message: '更新视频解析Prompt失败'
        });
    }
});

/**
 * 更新单元剧本Prompt
 */
router.put('/script-integration-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                message: '单元剧本Prompt不能为空'
            });
        }

        await systemConfigService.updateConfig('script_integration_prompt', prompt, req.user.id);
        
        res.json({
            success: true,
            message: '单元剧本Prompt更新成功'
        });
    } catch (error) {
        console.error('更新单元剧本Prompt失败:', error);
        res.status(500).json({
            success: false,
            message: '更新单元剧本Prompt失败'
        });
    }
});

/**
 * 更新角色知识图谱Prompt
 */
router.put('/character-knowledge-graph-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                message: '角色知识图谱Prompt不能为空'
            });
        }

        await systemConfigService.updateConfig('character_knowledge_graph_prompt', prompt, req.user.id);
        
        res.json({
            success: true,
            message: '角色知识图谱Prompt更新成功'
        });
    } catch (error) {
        console.error('更新角色知识图谱Prompt失败:', error);
        res.status(500).json({
            success: false,
            message: '更新角色知识图谱Prompt失败'
        });
    }
});

/**
 * 更新角色知识图谱整合Prompt
 */
router.put('/character-integration-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                message: '角色知识图谱整合Prompt不能为空'
            });
        }

        await systemConfigService.updateConfig('character_integration_prompt', prompt, req.user.id);
        
        res.json({
            success: true,
            message: '角色知识图谱整合Prompt更新成功'
        });
    } catch (error) {
        console.error('更新角色知识图谱整合Prompt失败:', error);
        res.status(500).json({
            success: false,
            message: '更新角色知识图谱整合Prompt失败'
        });
    }
});

/**
 * 更新角色整合Prompt
 */
router.put('/character-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                message: '角色整合Prompt不能为空'
            });
        }

        await systemConfigService.updateConfig('character_prompt', prompt, req.user.id);
        
        res.json({
            success: true,
            message: '角色整合Prompt更新成功'
        });
    } catch (error) {
        console.error('更新角色整合Prompt失败:', error);
        res.status(500).json({
            success: false,
            message: '更新角色整合Prompt失败'
        });
    }
});

module.exports = router;
module.exports.createApiOnboardingRouter = createApiOnboardingRouter;
module.exports.createGeminiKeyUpdateHandler = createGeminiKeyUpdateHandler;
module.exports.validateGeminiApiKey = validateGeminiApiKey;
