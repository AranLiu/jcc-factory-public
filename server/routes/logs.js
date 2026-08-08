const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { normalizeFrontendLog } = require('../utils/frontendLog');

router.use(authenticateToken);
const logIngestLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

// 接收前端日志
router.post('/', logIngestLimiter, (req, res) => {
    try {
        const { logs } = req.body;
        if (Array.isArray(logs) && logs.length > 100) {
            return res.status(413).json({ error: 'Too many log entries' });
        }

        const entries = Array.isArray(logs) ? logs : [req.body];
        entries.forEach(entry => {
            const { level, module, message, data } = normalizeFrontendLog(entry);
            logger.logFromFrontend(level, module, message, { userId: req.user.id, clientData: data });
        });
        
        if (Array.isArray(logs)) {
            // 批量处理前端日志
            logger.info('LOG_API', `批量接收前端日志 ${logs.length} 条`);
        }
        
        res.json({ success: true });
    } catch (error) {
        logger.error('LOG_API', '前端日志接收失败', error);
        res.status(400).json({ error: 'Log validation failed' });
    }
});

// 获取日志文件列表（可选功能）
router.get('/files', requireAdmin, (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const logDir = path.join(__dirname, '../logs');
        
        if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir)
                .filter(file => file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    size: fs.statSync(path.join(logDir, file)).size,
                    modified: fs.statSync(path.join(logDir, file)).mtime
                }))
                .sort((a, b) => b.modified - a.modified);
            
            logger.info('LOG_API', '获取日志文件列表', { count: files.length });
            res.json({ success: true, files });
        } else {
            res.json({ success: true, files: [] });
        }
    } catch (error) {
        logger.error('LOG_API', '获取日志文件列表失败', error);
        res.status(500).json({ error: 'Failed to get log files' });
    }
});

module.exports = router;
