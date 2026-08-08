// =============================
// Gemini代理服务包装器：通过代理服务器调用Gemini API
// =============================
const { spawn } = require('child_process');
const path = require('path');
const systemConfigService = require('./systemConfigService');
const { resolvePythonCommand } = require('../utils/pythonCommand');
const {
    RelayConfigStorageError,
    RelayConfigValidationError,
    loadValidatedRelayConfig
} = require('../utils/relayConfig');
const {
    DEFAULT_STDERR_BYTES,
    DEFAULT_STDOUT_BYTES,
    collectBoundedProcess,
    parseFinalJsonLine,
    serializeAiPayload
} = require('../utils/boundedChildProcess');
require('dotenv').config();

class ProxyGeminiService {
    constructor() {
        this.pythonServicePath = path.join(__dirname, '../python_services/gemini_proxy_service.py');
        this.systemConfigService = systemConfigService;
        
        // 优先使用虚拟环境中的Python
        this.pythonCommand = resolvePythonCommand();
        this.spawnProcess = spawn;
        this.processTimeoutMs = 5 * 60 * 1000;
        this.maxStdoutBytes = DEFAULT_STDOUT_BYTES;
        this.maxStderrBytes = DEFAULT_STDERR_BYTES;
        
    }

    /**
     * 检查代理服务是否启用
     */
    async isProxyEnabled() {
        const config = await loadValidatedRelayConfig(this.systemConfigService);
        return config.enabled;
    }



    /**
     * 设置代理环境变量
     */
    async setProxyEnvironment() {
        try {
            const { url, authToken } = await loadValidatedRelayConfig(
                this.systemConfigService,
                { requireEnabled: true }
            );
            const defaultModel = await this.systemConfigService.getConfig('gemini_default_model');
            const selectedDefaultModel = this.systemConfigService.selectGeminiRuntimeConfigValue(
                'GEMINI_DEFAULT_MODEL',
                defaultModel
            );
            
            return { url, authToken, defaultModel: selectedDefaultModel };
        } catch (error) {
            console.error('设置代理环境变量失败');
            if (error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError) {
                throw error;
            }
            throw new RelayConfigStorageError();
        }
    }

    /**
     * 调用Python代理服务
     */
    async callPythonProxyService(command, args = [], stdinData = null) {
        const config = await this.setProxyEnvironment();
        const env = {
            ...process.env,
            PROXY_SERVICE_URL: config.url || '',
            PROXY_SERVICE_AUTH_TOKEN: config.authToken,
            GEMINI_DEFAULT_MODEL: config.defaultModel || 'gemini-3.6-flash',
            GEMINI_DEBUG: 'true'
        };
        const stdinPresent = stdinData !== null && stdinData !== undefined;
        const fullArgs = stdinPresent
            ? [this.pythonServicePath, command, '--stdin']
            : [this.pythonServicePath, command, ...args];
        const safeCommand = /^[a-z0-9_-]{1,32}$/i.test(command) ? command : 'unknown';
        const stdinBytes = stdinPresent ? Buffer.byteLength(stdinData, 'utf8') : 0;
        console.log(
            `AI proxy invocation command=${safeCommand} argumentCount=${args.length} ` +
            `stdinPresent=${stdinPresent} stdinBytes=${stdinBytes}`
        );

        const pythonProcess = this.spawnProcess(this.pythonCommand, fullArgs, {
            env,
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

    /**
     * 测试代理连接
     */
    async testConnection() {
        try {
            const result = await this.callPythonProxyService('test', []);
            
            if (result.success) {
                return {
                    success: true,
                    message: '代理服务连接正常',
                    responseTime: result.responseTime || 'N/A'
                };
            } else {
                throw new Error(result.error || '代理连接失败');
            }
            
        } catch (error) {
            console.error('代理连接测试失败');
            return {
                success: false,
                message: '代理连接测试失败'
            };
        }
    }

    /**
     * 通过代理生成文本内容
     */
    async generateText(content, modelConfig = {}) {
        try {
            const stdinData = serializeAiPayload({ prompt: content, modelConfig });
            const result = await this.callPythonProxyService('text', [], stdinData);
            
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
                throw new Error(result.error || '代理文本生成失败');
            }
            
        } catch (error) {
            console.error('代理文本生成失败');
            if (error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError) throw error;
            if (error.code) throw error;
            const safeError = new Error('代理AI分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    /**
     * 通过代理分析视频内容
     */
    async analyzeVideo(videoPath, prompt, modelConfig = {}) {
        try {
            const stdinData = serializeAiPayload({ videoPath, prompt, modelConfig });
            const result = await this.callPythonProxyService('video', [], stdinData);
            
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
                throw new Error(result.error || '代理视频分析失败');
            }
            
        } catch (error) {
            console.error('代理视频分析失败');
            if (error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError) throw error;
            if (error.code) throw error;
            const safeError = new Error('代理视频分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    /**
     * 通过代理分析内容（通用方法）
     */
    async analyzeContent(prompt, content, modelConfig = {}) {
        try {
            const fullPrompt = `${prompt}\n\n内容：${content}`;
            
            const result = await this.generateText(fullPrompt, modelConfig);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    usage: {
                        promptTokens: result.usage?.promptTokens || 0,
                        completionTokens: result.usage?.completionTokens || 0,
                        totalTokens: result.usage?.totalTokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '代理内容分析失败');
            }
            
        } catch (error) {
            console.error('代理内容分析失败');
            if (error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError) throw error;
            if (error.code) throw error;
            const safeError = new Error('代理AI分析失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }

    /**
     * 通过代理整合剧本
     */
    async integrateScript(integrationPrompt, draftContent, modelConfig = {}) {
        try {
            const fullPrompt = `**任务：剧本整合**

**整合要求 (用户指令):**
${integrationPrompt}

---

**待整合的剧本草稿内容:**
${draftContent}

---

请严格按照用户的整合要求，对以上草稿内容进行处理。`;
            
            // 构建要通过stdin传递的数据
            const stdinData = serializeAiPayload({
                prompt: fullPrompt,
                modelConfig: modelConfig
            });
            const result = await this.callPythonProxyService('text', [], stdinData);
            
            if (result.success) {
                return {
                    success: true,
                    text: result.text,
                    usage: {
                        promptTokens: result.usage?.promptTokens || 0,
                        completionTokens: result.usage?.completionTokens || 0,
                        totalTokens: result.usage?.totalTokens || 0
                    }
                };
            } else {
                throw new Error(result.error || '代理剧本整合失败');
            }
            
        } catch (error) {
            console.error('代理剧本整合失败');
            if (error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError) throw error;
            if (error.code) throw error;
            const safeError = new Error('代理剧本整合失败');
            safeError.code = 'AI_PROVIDER_ERROR';
            throw safeError;
        }
    }


}

module.exports = ProxyGeminiService;
