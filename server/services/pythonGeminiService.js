// =============================
// Gemini服务唯一实现：所有AI相关业务均应通过本文件调用Python后端
// 支持自动检测代理配置并智能路由
// =============================
const { spawn } = require('child_process');
const path = require('path');
const systemConfigService = require('./systemConfigService');
const { resolvePythonCommand } = require('../utils/pythonCommand');
const { loadValidatedRelayConfig } = require('../utils/relayConfig');
const {
    DEFAULT_STDERR_BYTES,
    DEFAULT_STDOUT_BYTES,
    collectBoundedProcess,
    parseFinalJsonLine,
    serializeAiPayload
} = require('../utils/boundedChildProcess');
require('dotenv').config();

const FALLBACK_GEMINI_MODEL = 'gemini-3.6-flash';

function readGeminiRuntimeConfig(env = process.env) {
    const defaultModel = String(env.GEMINI_DEFAULT_MODEL || '').trim() || FALLBACK_GEMINI_MODEL;
    const availableModels = String(env.GEMINI_AVAILABLE_MODELS || '')
        .split(',')
        .map(model => model.trim())
        .filter(Boolean);
    return {
        defaultModel,
        availableModels: availableModels.length ? availableModels : [defaultModel]
    };
}

class PythonGeminiService {
    constructor() {
        this.pythonServicePath = path.join(__dirname, '../python_services/gemini_service_simple.py');
        this.systemConfigService = systemConfigService;
        
        // 优先使用虚拟环境中的Python
        this.pythonCommand = resolvePythonCommand();
        this.spawnProcess = spawn;
        this.processTimeoutMs = 15 * 60 * 1000;
        this.maxStdoutBytes = DEFAULT_STDOUT_BYTES;
        this.maxStderrBytes = DEFAULT_STDERR_BYTES;
        
        // 从环境变量读取模型配置
    }

    get defaultModel() {
        return readGeminiRuntimeConfig().defaultModel;
    }

    get availableModels() {
        return readGeminiRuntimeConfig().availableModels;
    }

    /**
     * 检查是否应该使用代理服务
     */
    async shouldUseProxy() {
        const config = await loadValidatedRelayConfig(this.systemConfigService);
        return config.enabled;
    }

    /**
     * 获取代理服务实例
     */
    getProxyService() {
        if (!this.proxyService) {
            const ProxyGeminiService = require('./proxyGeminiService');
            this.proxyService = new ProxyGeminiService();
        }
        return this.proxyService;
    }

    async callPythonService(command, args = [], stdinData = null) {
        const stdinPresent = stdinData !== null && stdinData !== undefined;
        const fullArgs = stdinPresent
            ? [this.pythonServicePath, command, '--stdin']
            : [this.pythonServicePath, command, ...args];
        const safeCommand = /^[a-z0-9_-]{1,32}$/i.test(command) ? command : 'unknown';
        const stdinBytes = stdinPresent ? Buffer.byteLength(stdinData, 'utf8') : 0;
        console.log(
            `AI invocation command=${safeCommand} argumentCount=${args.length} ` +
            `stdinPresent=${stdinPresent} stdinBytes=${stdinBytes}`
        );

        const pythonProcess = this.spawnProcess(this.pythonCommand, fullArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const { stdout } = await collectBoundedProcess(pythonProcess, {
            stdinData,
            timeoutMs: this.processTimeoutMs,
            maxStdoutBytes: this.maxStdoutBytes,
            maxStderrBytes: this.maxStderrBytes
        });
        return parseFinalJsonLine(stdout);
    }

    async analyzeVideo(videoPath, prompt, modelConfig = {}) {
        try {
            // 检查是否使用代理
            const useProxy = await this.shouldUseProxy();
            
            if (useProxy) {
                const proxyService = this.getProxyService();
                return await proxyService.analyzeVideo(videoPath, prompt, modelConfig);
            }
            
            // 使用直连服务
            const stdinData = serializeAiPayload({ videoPath, prompt, modelConfig });
            const result = await this.callPythonService('video', [], stdinData);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    fileId: result.file_id,
                    usage: {
                        promptTokens: result.usage?.prompt_tokens || 0,
                        completionTokens: result.usage?.completion_tokens || 0,
                        totalTokens: result.usage?.total_tokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '视频分析失败');
            }
            
        } catch (error) {
            console.error('Python视频分析失败');
            if (error.code) throw error;
            const safeError = new Error('AI视频分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    async analyzeContent(prompt, content, modelConfig = {}) {
        try {
            // 检查是否使用代理
            const useProxy = await this.shouldUseProxy();
            
            if (useProxy) {
                const proxyService = this.getProxyService();
                return await proxyService.analyzeContent(prompt, content, modelConfig);
            }
            
            // 使用直连服务
            const fullPrompt = `${prompt}\n\n内容：${content}`;
            const systemInstruction = modelConfig.systemInstruction || null;
            
            const stdinData = serializeAiPayload({
                prompt: fullPrompt,
                systemInstruction,
                modelConfig
            });
            const result = await this.callPythonService('text', [], stdinData);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    usage: {
                        promptTokens: result.usage?.prompt_tokens || 0,
                        completionTokens: result.usage?.completion_tokens || 0,
                        totalTokens: result.usage?.total_tokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '内容分析失败');
            }
            
        } catch (error) {
            console.error('Python内容分析失败');
            if (error.code) throw error;
            const safeError = new Error('AI分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }



    async analyzeNovel(prompt, textContent, modelConfig = {}) {
        try {
            const useProxy = await this.shouldUseProxy();
            if (useProxy) {
                const proxyService = this.getProxyService();
                return await proxyService.analyzeContent(prompt, textContent, modelConfig);
            }

            const fullPrompt = `${prompt}\n\n内容：${textContent}`;
            const stdinData = serializeAiPayload({
                prompt: fullPrompt,
                systemInstruction: modelConfig.systemInstruction || null,
                modelConfig
            });
            const result = await this.callPythonService('text', [], stdinData);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    usage: {
                        promptTokens: result.usage?.prompt_tokens || 0,
                        completionTokens: result.usage?.completion_tokens || 0,
                        totalTokens: result.usage?.total_tokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '小说分析失败');
            }
            
        } catch (error) {
            console.error('Python小说分析失败');
            if (error.code) throw error;
            const safeError = new Error('AI小说分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    async integrateScript(integrationPrompt, draftContent, modelConfig = {}) {
        try {
            // 检查是否使用代理
            const useProxy = await this.shouldUseProxy();
            
            if (useProxy) {
                const proxyService = this.getProxyService();
                return await proxyService.integrateScript(integrationPrompt, draftContent, modelConfig);
            }
            
            // 使用直连服务
            const fullPrompt = `**任务：剧本整合**

**整合要求 (用户指令):**
${integrationPrompt}

---

**待整合的剧本草稿内容:**
${draftContent}

---

请严格按照用户的整合要求，对以上草稿内容进行处理。`;
            
            const systemInstruction = modelConfig.systemInstruction || "You are a professional script writer and editor.";
            
            // 构建要通过stdin传递的数据
            const stdinData = serializeAiPayload({
                prompt: fullPrompt,
                systemInstruction: systemInstruction,
                modelConfig: modelConfig
            });
            const result = await this.callPythonService('text', [], stdinData);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    usage: {
                        promptTokens: result.usage?.prompt_tokens || 0,
                        completionTokens: result.usage?.completion_tokens || 0,
                        totalTokens: result.usage?.total_tokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '剧本整合失败');
            }
            
        } catch (error) {
            console.error('Python剧本整合失败');
            if (error.code) throw error;
            const safeError = new Error('剧本整合失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    async testConnection() {
        try {
            console.log('🔧 测试Python连接');
            const result = await this.callPythonService('test', []);
            if (!result.success) {
                return { success: false, message: 'Unable to verify Gemini API connection' };
            }
            return {
                success: true,
                message: result.message || 'Python连接成功',
                details: result
            };
        } catch {
            return {
                success: false,
                message: 'Unable to verify Gemini API connection'
            };
        }
    }

    // 兼容性方法
    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = PythonGeminiService;
