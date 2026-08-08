const path = require('path');
const { AsyncLogWriter } = require('./asyncLogWriter');
const { redactSecrets } = require('./security');

class UnifiedLogger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.writer = new AsyncLogWriter({ logDir: this.logDir, maxBytes: 10 * 1024 * 1024 });
        
        // 日志级别图标映射
        this.levelIcons = {
            'INFO': '✅',
            'ERROR': '❌', 
            'WARN': '⚠️',
            'AUDIT': '📝',
            'DEBUG': '🔧',
            'SUCCESS': '🎉'
        };
        
        // 模块图标映射
        this.moduleIcons = {
            'AUTH': '🔐',
            'AI_SERVICE': '🤖',
            'DATABASE': '💾',
            'FILE_SYSTEM': '📁',
            'API': '🌐',
            'USER_ACTION': '👤',
            'SYSTEM': '⚙️',
            'PAYMENT': '💰',
            'EMAIL': '📧',
            'UPLOAD': '📤',
            'DOWNLOAD': '📥',
            'PROJECT': '📋',
            'KNOWLEDGE_BASE': '📚',
            'CONFIG': '⚙️',
            'SCRIPT': '📄',
            'VIDEO': '🎬',
            'DOCUMENT': '📄'
        };
    }

    getIcon(type, key) {
        const icons = type === 'level' ? this.levelIcons : this.moduleIcons;
        return icons[key] || (type === 'level' ? '📄' : '🔹');
    }

    formatMessage(level, source, module, message, data = null) {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            source,
            module,
            message: String(message).replace(/[\r\n]/g, ' '),
            data: data == null ? undefined : redactSecrets(data)
        });
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

    writeToFile(level, logMessage) {
        this.writer.write(logMessage).catch(error => {
            console.error('Failed to write application log:', error.message);
        });
    }

    // 后端日志方法
    info(module, message, data = null) {
        const logMessage = this.formatMessage('INFO', 'BACKEND', module, message, data);
        console.log(logMessage);
        this.writeToFile('INFO', logMessage);
    }

    error(module, message, error = null) {
        const errorData = error instanceof Error ? { name: error.name, message: error.message } : error;
        const logMessage = this.formatMessage('ERROR', 'BACKEND', module, message, errorData);
        console.error(logMessage);
        this.writeToFile('ERROR', logMessage);
    }

    warn(module, message, data = null) {
        const logMessage = this.formatMessage('WARN', 'BACKEND', module, message, data);
        console.warn(logMessage);
        this.writeToFile('WARN', logMessage);
    }

    success(module, message, data = null) {
        const logMessage = this.formatMessage('SUCCESS', 'BACKEND', module, message, data);
        console.log(logMessage);
        this.writeToFile('SUCCESS', logMessage);
    }

    debug(module, message, data = null) {
        const logMessage = this.formatMessage('DEBUG', 'BACKEND', module, message, data);
        console.log(logMessage);
        this.writeToFile('DEBUG', logMessage);
    }

    // 前端日志接收方法
    logFromFrontend(level, module, message, data = null) {
        const logMessage = this.formatMessage(level, 'FRONTEND', module, message, data);
        console.log(logMessage);
        this.writeToFile(level, logMessage);
    }

    // 用户操作审计（前后端通用）
    audit(userId, action, source = 'BACKEND', details = null) {
        const auditMessage = this.formatMessage('AUDIT', source, 'USER_ACTION', 
            `用户 ${userId} 执行操作: ${action}`, this.sanitize(details));
        console.log(auditMessage);
        this.writeToFile('AUDIT', auditMessage);
    }

    // 敏感信息过滤
    sanitize(data) {
        return redactSecrets(data);
    }
}

module.exports = new UnifiedLogger();
