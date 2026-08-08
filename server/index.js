const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
require('dotenv').config();
const { validateRuntimeEnv } = require('./config/env');
const runtimeConfig = validateRuntimeEnv(process.env);
const { buildCspDirectives } = require('./config/securityHeaders');
const { authenticateToken } = require('./middleware/auth');
const { createCsrfProtection, createOriginProtection } = require('./middleware/csrf');
const { isPublicApiRequest } = require('./utils/publicApi');

const { pool, quotaPool, testConnection } = require('./config/database');
const { runMigrations } = require('./database/migrationRunner');
const { testConnectionAndCreateBuckets } = require('./config/minio');
const { requireStorageReady } = require('./config/startupChecks');
const UnifiedTaskProcessor = require('./services/UnifiedTaskProcessor');
const eventBus = require('./services/eventBus');
const { shutdownResources } = require('./utils/shutdown');

const app = express();
const PORT = Number(process.env.PORT) || 8080;
let httpServer;
let taskProcessor;
let shuttingDown = false;
const allowedOrigins = new Set(runtimeConfig.allowedOrigins);

// 设置服务器超时时间，适应大文件上传和处理
app.timeout = 600000; // 10分钟

// 创建上传目录
const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    logger.success('FILE_SYSTEM', '创建上传目录', { path: uploadDir });
}

// 中间件配置
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: buildCspDirectives({ allowedOrigins: [...allowedOrigins] }),
    },
    hsts: runtimeConfig.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(cors({
    origin: [...allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'Range', 'Accept', 'Accept-Ranges'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
}));

// 限流配置 - 更宽松的限制，避免正常使用受到影响
// express-rate-limit v7 使用 `limit` 而不是 `max`
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    limit: 1000,
    message: { message: '请求过于频繁，请稍后再试' },
    standardHeaders: true, // 返回限制信息在 `RateLimit-*` headers
    legacyHeaders: false, // 禁用 `X-RateLimit-*` headers
    skip: (req) => {
        // 跳过静态文件请求的限制
        return req.path.startsWith('/uploads/') || 
               req.path.startsWith('/static/') ||
               req.path.endsWith('.js') ||
               req.path.endsWith('.css') ||
               req.path.endsWith('.png') ||
               req.path.endsWith('.jpg') ||
               req.path.endsWith('.gif') ||
               req.path.endsWith('.ico');
    }
});

// 为登录接口设置更严格的限制，防止暴力破解
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    limit: 10, // 每个IP最多10次登录尝试
    message: { message: '登录尝试次数过多，请15分钟后再试' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // 成功的请求不计入限制
});

const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Too many setup attempts; please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/login', createOriginProtection(allowedOrigins));
app.post('/api/auth/setup', setupLimiter, createOriginProtection(allowedOrigins));

// 设置正确的字符编码支持 - 明确指定类型，避免干扰multipart数据
app.use(express.json({ 
    limit: '10mb',
    type: ['application/json', 'text/plain']
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '2mb',
    parameterLimit: 1000,
    type: 'application/x-www-form-urlencoded'  // 明确指定类型
}));

// 托管前端静态文件
app.use(express.static(path.join(__dirname, '../client/dist'), {
    setHeaders: (res, filePath) => {
        // 设置前端资源文件的正确MIME类型
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        } else if (filePath.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        } else if (filePath.endsWith('.gif')) {
            res.setHeader('Content-Type', 'image/gif');
        } else if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
        }
        
        // 设置缓存策略
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

// 除登录和健康检查外，所有 API 均要求服务器会话和 CSRF 防护。
app.use('/api', (req, res, next) => {
    if (req.path !== '/health') res.setHeader('Cache-Control', 'private, no-store');
    if (isPublicApiRequest(req)) return next();
    return authenticateToken(req, res, next);
});
const csrfProtection = createCsrfProtection(allowedOrigins);
app.use('/api', (req, res, next) => {
    if (req.path === '/auth/login' && req.method === 'POST') return next();
    return csrfProtection(req, res, next);
});

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/files', require('./routes/files'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/queue', require('./routes/queue'));  // 新增：队列管理路由
app.use('/api/script-units', require('./routes/scriptUnits'));
app.use('/api/full-scripts', require('./routes/fullScripts'));
app.use('/api/knowledge-base', require('./routes/knowledgeBase'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/system-config', require('./routes/systemConfig'));
app.use('/api/ai-providers', require('./routes/aiProviders'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/logs', require('./routes/logs'));

    // SSE: 实时任务事件推送
    app.get('/api/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        let id;
        try {
            id = eventBus.addClient(res, { userId: req.user.id, role: req.user.role });
        } catch (error) {
            res.end();
            return;
        }

        req.on('close', () => {
            if (id) eventBus.removeClient(id);
        });
    });

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '2.1.0'
    });
});

// SPA路由回退 - 所有非API路由都返回前端页面
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next(); // API路由继续处理
    }
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// 404处理
app.use('/api', (req, res) => {
    res.status(404).json({ message: 'API路由不存在' });
});

// 错误处理中间件
app.use((error, req, res, next) => {
    logger.error('SYSTEM', '服务器错误', error);
    res.status(500).json({ 
        message: '内部服务器错误'
    });
});

// 启动服务器
async function startServer() {
    try {
        // 测试数据库连接
        await testConnection();
        logger.success('DATABASE', '数据库连接测试成功');

        const migrations = await runMigrations(pool);
        logger.success('DATABASE', '数据库迁移检查完成', { count: migrations.length });
        
        // 测试 MinIO 连接并创建存储桶；失败时由外层启动错误处理终止进程
        requireStorageReady(await testConnectionAndCreateBuckets());
        logger.success('MINIO', 'MinIO 连接测试成功并创建存储桶');
        
        // 加载系统配置
        try {
            const systemConfigService = require('./services/systemConfigService');
            await systemConfigService.applyConfigs();
            logger.success('CONFIG', '系统配置加载完成');
        } catch (error) {
            logger.warn('CONFIG', '系统配置加载失败，使用环境变量默认值', { error: error.message });
        }
        
        // 启动统一任务处理器
        try {
            taskProcessor = new UnifiedTaskProcessor();
            await taskProcessor.start();
            
            // 将处理器实例存储到app中，供路由使用
            app.set('taskProcessor', taskProcessor);
            
            logger.success('TASK_PROCESSOR', '统一任务处理器启动成功');
        } catch (error) {
            logger.error('TASK_PROCESSOR', '任务处理器启动失败', { error: error.message });
            throw error;
        }
        
        httpServer = app.listen(PORT, '0.0.0.0', () => {
            logger.success('SYSTEM', '服务器启动成功', { 
                url: `http://0.0.0.0:${PORT}`,
                health: `http://0.0.0.0:${PORT}/api/health`,
                uploadDir: path.resolve(uploadDir)
            });
        });
    } catch (error) {
        logger.error('SYSTEM', '服务器启动失败', error);
        process.exit(1);
    }
}

async function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('SYSTEM', '开始优雅关闭', { signal });
    const forceExitTimer = setTimeout(() => process.exit(1), 15_000);
    forceExitTimer.unref();
    try {
        await shutdownResources({ taskProcessor, httpServer, pool, pools: [quotaPool] });
        clearTimeout(forceExitTimer);
        process.exit(0);
    } catch (error) {
        logger.error('SYSTEM', '优雅关闭失败', { error: error.message });
        process.exit(1);
    }
}

process.once('SIGTERM', () => handleShutdown('SIGTERM'));
process.once('SIGINT', () => handleShutdown('SIGINT'));

startServer();
