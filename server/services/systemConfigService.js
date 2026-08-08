const { pool } = require('../config/database');
const { spawn } = require('child_process');
const path = require('path');
const { resolvePythonCommand } = require('../utils/pythonCommand');
const {
    BOOT_GEMINI_ENVIRONMENT,
    GEMINI_ENVIRONMENT_KEYS,
    captureGeminiEnvironment
} = require('../config/geminiEnvironment');
const {
    loadValidatedRelayConfig,
    readRelayConfigSnapshot,
    updateRelayConfigTransaction
} = require('../utils/relayConfig');

function selectRuntimeConfigValue(environmentValue, storedValue) {
    if (typeof environmentValue === 'string' && environmentValue.trim() !== '') {
        return environmentValue;
    }

    const normalizedStoredValue = Array.isArray(storedValue)
        ? storedValue.map(value => String(value).trim()).filter(Boolean).join(',')
        : typeof storedValue === 'string'
            ? storedValue.trim()
            : '';

    return normalizedStoredValue || environmentValue;
}

const GEMINI_TEST_TIMEOUT_MS = 30_000;
const GEMINI_TEST_MAX_OUTPUT_BYTES = 64 * 1024;
const GEMINI_TEST_FAILURE = Object.freeze({
    success: false,
    message: 'Unable to verify Gemini API connection'
});

function safeGeminiTestFailure() {
    return { ...GEMINI_TEST_FAILURE };
}

function parseGeminiTestOutput(stdout) {
    const finalLine = String(stdout)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .at(-1);
    if (!finalLine) throw new Error('Missing Gemini test result');

    const parsed = JSON.parse(finalLine);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || typeof parsed.success !== 'boolean') {
        throw new Error('Invalid Gemini test result');
    }
    return parsed;
}

function publicGeminiTestResult(parsed) {
    if (parsed.success !== true) return safeGeminiTestFailure();

    const result = {
        success: true,
        message: 'Gemini API connection is available'
    };
    if (
        typeof parsed.responseTime === 'number'
        && Number.isFinite(parsed.responseTime)
        && parsed.responseTime >= 0
        && parsed.responseTime <= 3_600_000
    ) {
        result.responseTime = parsed.responseTime;
    }
    return result;
}

function runGeminiTestProcess({
    spawnProcess,
    pythonCommand,
    pythonServicePath,
    env,
    timeoutMs = GEMINI_TEST_TIMEOUT_MS,
    maxOutputBytes = GEMINI_TEST_MAX_OUTPUT_BYTES
}) {
    return new Promise(resolve => {
        let child;
        let stdout = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let timeout;

        const finish = (result, { kill = false } = {}) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            if (kill && child) {
                try { child.kill('SIGTERM'); } catch { /* keep the public result generic */ }
            }
            resolve(result);
        };

        const collect = channel => data => {
            if (settled) return;
            const chunk = data.toString();
            const bytes = Buffer.byteLength(chunk, 'utf8');
            if (channel === 'stdout') stdoutBytes += bytes;
            else stderrBytes += bytes;
            if (stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes) {
                finish(safeGeminiTestFailure(), { kill: true });
                return;
            }
            if (channel === 'stdout') stdout += chunk;
        };

        try {
            child = spawnProcess(pythonCommand, [pythonServicePath, 'test'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env
            });
            child.stdout.setEncoding?.('utf8');
            child.stderr.setEncoding?.('utf8');
            child.stdout.on('data', collect('stdout'));
            child.stderr.on('data', collect('stderr'));
            child.on('error', () => finish(safeGeminiTestFailure()));
            child.on('close', code => {
                if (settled) return;
                if (code !== 0) {
                    finish(safeGeminiTestFailure());
                    return;
                }
                try {
                    finish(publicGeminiTestResult(parseGeminiTestOutput(stdout)));
                } catch {
                    finish(safeGeminiTestFailure());
                }
            });
            child.stdin?.end?.();
            if (!settled) {
                timeout = setTimeout(
                    () => finish(safeGeminiTestFailure(), { kill: true }),
                    timeoutMs
                );
            }
        } catch {
            finish(safeGeminiTestFailure(), { kill: true });
        }
    });
}

class SystemConfigService {
    constructor({
        bootEnvironment = BOOT_GEMINI_ENVIRONMENT,
        runtimeEnvironment = process.env,
        spawnProcess = spawn
    } = {}) {
        Object.defineProperty(this, 'bootEnvironment', {
            value: Object.freeze({ ...bootEnvironment }),
            enumerable: true,
            writable: false,
            configurable: false
        });
        this.runtimeEnvironment = runtimeEnvironment;
        this.spawnProcess = spawnProcess;
        this.configCache = new Map(); // 配置缓存
        this.lastCacheUpdate = 0;
        this.cacheExpiry = 30000; // 30秒缓存过期时间
    }

    /**
     * 获取所有系统配置
     */
    async getAllConfigs() {
        try {
            const [configs] = await pool.execute(`
                SELECT sc.config_key, sc.config_value, sc.config_type, sc.description, 
                       sc.updated_at, sc.updated_by, u.username as updated_by_name
                FROM system_config sc
                LEFT JOIN users u ON sc.updated_by = u.id
                ORDER BY sc.config_key
            `);

            const result = {};
            configs.forEach(config => {
                let value = config.config_value;
                
                // 根据配置类型转换值
                if (config.config_type === 'json') {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        console.warn(`配置 ${config.config_key} JSON解析失败:`, e);
                        value = [];
                    }
                } else if (config.config_type === 'boolean') {
                    value = value === 'true';
                }

                result[config.config_key] = {
                    value,
                    type: config.config_type,
                    description: config.description,
                    updated_at: config.updated_at,
                    updated_by: config.updated_by,
                    updated_by_name: config.updated_by_name
                };
            });

            return result;
        } catch (error) {
            console.error('获取系统配置失败:', error);
            throw new Error('获取系统配置失败');
        }
    }

    /**
     * 获取单个配置值
     */
    async getConfig(key) {
        try {
            // 检查缓存
            if (this.configCache.has(key) && 
                Date.now() - this.lastCacheUpdate < this.cacheExpiry) {
                return this.configCache.get(key);
            }

            const [configs] = await pool.execute(
                'SELECT config_value, config_type FROM system_config WHERE config_key = ?',
                [key]
            );

            if (configs.length === 0) {
                return null;
            }

            let value = configs[0].config_value;
            const type = configs[0].config_type;

            // 转换数据类型
            if (type === 'json') {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    value = [];
                }
            } else if (type === 'boolean') {
                value = value === 'true';
            }

            // 更新缓存
            this.configCache.set(key, value);
            this.lastCacheUpdate = Date.now();

            return value;
        } catch (error) {
            console.error(`获取配置 ${key} 失败:`, error);
            return null;
        }
    }

    /**
     * 更新配置
     */
    async updateConfig(key, value, userId) {
        try {
            let stringValue = value;
            let configType = 'string';

            // 根据值的类型确定存储方式
            if (typeof value === 'object') {
                stringValue = JSON.stringify(value);
                configType = 'json';
            } else if (typeof value === 'boolean') {
                stringValue = value.toString();
                configType = 'boolean';
            }

            await pool.execute(`
                INSERT INTO system_config
                    (config_key, config_value, config_type, description, updated_by)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    config_value = VALUES(config_value),
                    config_type = VALUES(config_type),
                    updated_by = VALUES(updated_by),
                    updated_at = CURRENT_TIMESTAMP
            `, [key, stringValue, configType, `System configuration: ${key}`, userId]);

            // 清除缓存
            this.configCache.delete(key);

            console.log(`✅ 配置 ${key} 更新成功`);
            return true;
        } catch (error) {
            console.error(`更新配置 ${key} 失败:`, error);
            throw new Error(`更新配置失败: ${error.message}`);
        }
    }

    async updateRelayConfig(key, value, userId) {
        const updated = await updateRelayConfigTransaction({ pool, key, value, userId });
        if (updated) {
            this.configCache.delete('proxy_service_enabled');
            this.configCache.delete('proxy_service_url');
            this.configCache.delete('proxy_service_auth_token');
        }
        return updated;
    }

    async getRelayConfigSnapshot() {
        return readRelayConfigSnapshot(pool);
    }

    selectGeminiRuntimeConfigValue(environmentKey, storedValue) {
        if (!GEMINI_ENVIRONMENT_KEYS.includes(environmentKey)) {
            throw new Error('Unknown Gemini environment key');
        }
        return selectRuntimeConfigValue(this.bootEnvironment[environmentKey], storedValue);
    }

    /**
     * 测试Gemini API连接
     */
    async testGeminiConnection() {
        try {
            const storedApiKey = await this.getConfig('gemini_api_key');
            const apiKey = this.selectGeminiRuntimeConfigValue('GEMINI_API_KEY', storedApiKey);

            if (!apiKey) {
                return {
                    success: false,
                    message: 'Gemini API key is not configured'
                };
            }

            return await runGeminiTestProcess({
                spawnProcess: this.spawnProcess,
                pythonCommand: this.pythonCommand || resolvePythonCommand(),
                pythonServicePath: this.pythonServicePath
                    || path.join(__dirname, '../python_services/gemini_service_simple.py'),
                env: { ...this.runtimeEnvironment, GEMINI_API_KEY: apiKey },
                timeoutMs: this.geminiTestTimeoutMs || GEMINI_TEST_TIMEOUT_MS,
                maxOutputBytes: this.geminiTestMaxOutputBytes || GEMINI_TEST_MAX_OUTPUT_BYTES
            });
        } catch {
            console.error('Gemini connection test failed');
            return safeGeminiTestFailure();
        }
    }

    /**
     * 测试代理服务连接
     */
    async testProxyConnection() {
        try {
            await loadValidatedRelayConfig(this, { requireEnabled: true });

            // 调用Python代理服务进行测试
            const ProxyGeminiService = require('./proxyGeminiService');
            const proxyService = new ProxyGeminiService();
            proxyService.systemConfigService = this;
            const result = await proxyService.testConnection();
            
            return {
                success: result.success,
                message: result.success ? '代理服务连接正常' : (result.message || '代理连接失败'),
                details: result.error || result.message,
                responseTime: result.responseTime
            };
        } catch (error) {
            console.error('测试代理连接失败:', error);
            return {
                success: false,
                message: '代理连接测试异常',
                details: error.message
            };
        }
    }

    /**
     * 获取当前连接状态
     */
    async getConnectionStatus() {
        try {
            const [geminiTest] = await Promise.all([
                this.testGeminiConnection()
            ]);

            return {
                gemini: geminiTest,
                overall: geminiTest.success
            };
        } catch (error) {
            console.error('获取连接状态失败:', error);
            return {
                gemini: { success: false, message: '状态检查失败' },
                overall: false
            };
        }
    }

    /**
     * 应用配置到运行环境
     */
    async applyConfigs() {
        try {
            const configs = await this.getAllConfigs();
            
            const runtimeMappings = [
                ['GEMINI_API_KEY', configs.gemini_api_key?.value],
                ['GEMINI_DEFAULT_MODEL', configs.gemini_default_model?.value],
                ['GEMINI_AVAILABLE_MODELS', configs.gemini_available_models?.value],
            ];

            for (const [environmentKey, storedValue] of runtimeMappings) {
                const selectedValue = this.selectGeminiRuntimeConfigValue(environmentKey, storedValue);
                if (typeof selectedValue === 'string' && selectedValue.trim() !== '') {
                    this.runtimeEnvironment[environmentKey] = selectedValue;
                } else {
                    delete this.runtimeEnvironment[environmentKey];
                }
            }

            console.log('✅ 系统配置已应用到运行环境');
            return true;
        } catch (error) {
            console.error('应用配置失败:', error);
            return false;
        }
    }

    /**
     * 清除配置缓存
     */
    clearCache() {
        this.configCache.clear();
        this.lastCacheUpdate = 0;
    }


}

const systemConfigService = new SystemConfigService();
systemConfigService.selectRuntimeConfigValue = selectRuntimeConfigValue;
systemConfigService.parseGeminiTestOutput = parseGeminiTestOutput;
systemConfigService.runGeminiTestProcess = runGeminiTestProcess;
systemConfigService.SystemConfigService = SystemConfigService;
systemConfigService.captureGeminiEnvironment = captureGeminiEnvironment;

module.exports = systemConfigService;
