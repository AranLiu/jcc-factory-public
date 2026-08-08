// 服务实例管理器
// 确保各个路由使用相同的服务实例，方便统一管理和更新配置

const PythonGeminiService = require('./pythonGeminiService');

class ServiceManager {
    constructor() {
        this.geminiService = null;
        this.initialized = false;
    }

    /**
     * 初始化服务
     */
    init() {
        if (!this.initialized) {
            console.log('🚀 初始化服务管理器');
            this.geminiService = new PythonGeminiService();
            this.initialized = true;
        }
        return this;
    }

    /**
     * 获取Gemini服务实例
     */
    getGeminiService() {
        if (!this.initialized) {
            this.init();
        }
        return this.geminiService;
    }

    /**
     * 重新加载Gemini服务的模型配置
     */
    async reloadGeminiModelConfig() {
        try {
            if (this.geminiService) {
                await this.geminiService.loadModelConfig();
                console.log('✅ Gemini服务模型配置已重新加载');
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ 重新加载Gemini模型配置失败:', error);
            return false;
        }
    }

    /**
     * 重新加载所有AI服务，以应用新的配置（如代理切换）
     */
    reloadAIServices() {
        console.log('🔄 正在重新加载AI服务...');
        // 重新实例化服务，以加载最新的配置
        this.geminiService = new PythonGeminiService();
        console.log('✅ AI服务已重新加载');
    }
}

// 创建单例实例
const serviceManager = new ServiceManager();

module.exports = serviceManager; 