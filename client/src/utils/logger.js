import { secureFetch } from '../services/httpSecurity'

class FrontendLogger {
    constructor() {
        this.apiEndpoint = '/api/logs';
        this.logQueue = [];
        this.maxQueueSize = 50;
        this.flushInterval = 60000; // 60秒自动发送
        this.enabledLevels = ['ERROR', 'WARN', 'SUCCESS']; // 只记录重要日志到服务器
        this.verboseMode = false; // 详细模式开关，生产环境建议关闭
        this.startAutoFlush();
        
        // 前端控制台图标
        this.levelIcons = {
            'INFO': '✅',
            'ERROR': '❌',
            'WARN': '⚠️',
            'DEBUG': '🔧',
            'SUCCESS': '🎉'
        };
        
        this.moduleIcons = {
            'API': '🌐',
            'USER_ACTION': '👤',
            'ROUTER': '🛣️',
            'COMPONENT': '🧩',
            'STORAGE': '💾',
            'FORM': '📝',
            'AUTH': '🔐',
            'PROJECT': '📋',
            'FILE': '📁',
            'SCRIPT': '📄',
            'VIDEO': '🎬',
            'KNOWLEDGE_BASE': '📚',
            'AI_SERVICE': '🤖'
        };
    }

    formatTimestamp(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    getIcon(type, key) {
        const icons = type === 'level' ? this.levelIcons : this.moduleIcons;
        return icons[key] || (type === 'level' ? '📄' : '🔹');
    }

    startAutoFlush() {
        setInterval(() => {
            if (this.logQueue.length > 0) {
                this.flushQueue();
            }
        }, this.flushInterval);
    }

    async sendToServer(logData) {
        try {
            const response = await secureFetch(this.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(logData)
            });
            if (!response.ok) throw new Error(`Log endpoint returned ${response.status}`)
        } catch (error) {
            // 前端日志发送失败时，只在控制台记录，不再重试
            console.error('❌ [FRONTEND] 📤 [LOG_SEND] 日志发送失败:', error);
        }
    }

    addToQueue(logData) {
        // 只有启用的日志级别才发送到服务器
        if (this.enabledLevels.includes(logData.level)) {
            this.logQueue.push(logData);
            if (this.logQueue.length >= this.maxQueueSize) {
                this.flushQueue();
            }
        }
    }

    async flushQueue() {
        if (this.logQueue.length > 0) {
            await this.sendToServer({ logs: [...this.logQueue] });
            this.logQueue = [];
        }
    }

    info(module, message, data = null) {
        const levelIcon = this.getIcon('level', 'INFO');
        const moduleIcon = this.getIcon('module', module);
        const now = new Date();
        const logData = {
            level: 'INFO',
            module,
            message,
            data,
            timestamp: this.formatTimestamp(now),
            url: window.location.href
        };
        
        console.log(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [${module}] ${message}`, data);
        this.addToQueue(logData);
    }

    error(module, message, error = null) {
        const levelIcon = this.getIcon('level', 'ERROR');
        const moduleIcon = this.getIcon('module', module);
        const now = new Date();
        const errorData = error ? (error.stack || error.message || error) : null;
        const logData = {
            level: 'ERROR',
            module,
            message,
            data: errorData,
            timestamp: this.formatTimestamp(now),
            url: window.location.href
        };
        
        console.error(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [${module}] ${message}`, errorData);
        this.addToQueue(logData);
    }

    warn(module, message, data = null) {
        const levelIcon = this.getIcon('level', 'WARN');
        const moduleIcon = this.getIcon('module', module);
        const now = new Date();
        const logData = {
            level: 'WARN',
            module,
            message,
            data,
            timestamp: this.formatTimestamp(now),
            url: window.location.href
        };
        
        console.warn(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [${module}] ${message}`, data);
        this.addToQueue(logData);
    }

    // 🎉 成功操作日志
    success(module, message, data = null) {
        const levelIcon = this.getIcon('level', 'SUCCESS');
        const moduleIcon = this.getIcon('module', module);
        const now = new Date();
        const logData = {
            level: 'SUCCESS',
            module,
            message,
            data,
            timestamp: this.formatTimestamp(now),
            url: window.location.href
        };
        
        console.log(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [${module}] ${message}`, data);
        this.addToQueue(logData);
    }

    // 🔧 调试日志
    debug(module, message, data = null) {
        const levelIcon = this.getIcon('level', 'DEBUG');
        const moduleIcon = this.getIcon('module', module);
        const now = new Date();
        const logData = {
            level: 'DEBUG',
            module,
            message,
            data,
            timestamp: this.formatTimestamp(now),
            url: window.location.href
        };
        
        console.log(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [${module}] ${message}`, data);
        this.addToQueue(logData);
    }

    // 👤 用户行为追踪
    userAction(action, details = null) {
        this.info('USER_ACTION', `用户操作: ${action}`, details);
    }

    // 🚀 页面导航日志
    pageView(pageName, route = null) {
        this.info('ROUTER', `页面访问: ${pageName}`, { route: route || window.location.pathname });
    }

    // 🌐 API调用日志 - 简化版，只记录失败和重要成功
    apiCall(method, endpoint, status = null, responseTime = null) {
        const data = { method, endpoint, status, responseTime };
        if (status >= 400) {
            this.error('API', `API调用失败: ${method} ${endpoint}`, data);
        } else if (status >= 200 && status < 300) {
            // 只在控制台显示成功请求，不发送到服务器
            const levelIcon = this.getIcon('level', 'SUCCESS');
            const moduleIcon = this.getIcon('module', 'API');
            const now = new Date();
            console.log(`[${this.formatTimestamp(now)}] ${levelIcon} [FRONTEND] ${moduleIcon} [API] API调用成功: ${method} ${endpoint}`, data);
        }
    }

    // 📝 表单操作日志
    formSubmit(formName, success = true, data = null) {
        if (success) {
            this.success('FORM', `表单提交成功: ${formName}`, data);
        } else {
            this.error('FORM', `表单提交失败: ${formName}`, data);
        }
    }

    // 📁 文件操作日志
    fileOperation(operation, filename, success = true, data = null) {
        if (success) {
            this.success('FILE', `文件${operation}成功: ${filename}`, data);
        } else {
            this.error('FILE', `文件${operation}失败: ${filename}`, data);
        }
    }
}

export default new FrontendLogger();
