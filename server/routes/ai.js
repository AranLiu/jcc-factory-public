const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const PythonGeminiService = require('../services/pythonGeminiService');
const logger = require('../utils/logger');
const minioService = require('../services/minioService');
const { validateIdempotencyKey } = require('../utils/security');
const { getTextGenerationService } = require('../services/textGenerationService');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticateToken);

// 从文件名中提取集数
function extractEpisodeNumber(filename) {
    console.log('📱 开始提取集数:', filename);
    
    // 移除文件扩展名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    console.log('📱 去除扩展名后:', nameWithoutExt);
    
    // 尝试匹配各种格式的数字
    const patterns = [
        /第(\d+)集/,           // 第X集
        /第(\d+)话/,           // 第X话
        /(\d+)集/,             // X集
        /(\d+)话/,             // X话
        /ep(\d+)/i,            // epX
        /episode(\d+)/i,       // episodeX
        /(\d+)/,               // 纯数字（作为后备选项）
    ];
    
    for (const pattern of patterns) {
        const match = nameWithoutExt.match(pattern);
        if (match && match[1]) {
            const episodeNum = parseInt(match[1]);
            console.log('📱 提取到集数:', episodeNum, '匹配模式:', pattern);
            return episodeNum;
        }
    }
    
    console.log('📱 未找到集数');
    return null;
}

// 初始化Gemini服务
let geminiService;
try {
    geminiService = new PythonGeminiService();
    logger.success('AI_SERVICE', 'Python Gemini服务初始化成功');
} catch (error) {
    logger.error('AI_SERVICE', 'Python Gemini服务初始化失败', error);
}

// 辅助函数：更新项目最后操作时间和操作人
const updateProjectLastOperation = async (projectId, userId) => {
    try {
        await pool.execute(
            'UPDATE projects SET last_operation_at = NOW(), last_operator_id = ? WHERE id = ?',
            [userId, projectId]
        );
    } catch (error) {
        console.warn('更新项目最后操作时间失败:', error);
    }
};

// 获取模型配置
router.get('/models', async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const config = {
            defaultModel: geminiService.defaultModel,
            availableModels: geminiService.availableModels
        };
        
        res.json(config);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: '获取模型配置失败'
        });
    }
});

// 测试AI连接
router.get('/test', async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const result = await geminiService.testConnection();
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: '连接测试失败'
        });
    }
});

// 创建AI分析任务
router.post('/analyze', async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const { projectId, fileId, prompt, modelConfig = {}, priority } = req.body;

        if (!projectId || !fileId || !prompt) {
            return res.status(400).json({ message: '项目ID和提示词不能为空' });
        }

        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 验证项目权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员或全局权限：可以对任何项目创建任务
            sql = 'SELECT id, type FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // personal和readonly_global权限：只能对自己的项目创建任务
            sql = 'SELECT id, type FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);

        if (projects.length === 0) {
            return res.status(404).json({ message: '项目不存在或无权访问' });
        }

        const project = projects[0];

        // 如果指定了文件ID，验证文件
        let fileInfo = null;
        if (fileId) {
            const [files] = await pool.execute(
                'SELECT * FROM files WHERE id = ? AND project_id = ?',
                [fileId, projectId]
            );

            if (files.length === 0) {
                return res.status(404).json({ message: '文件不存在' });
            }
            fileInfo = files[0];
        }

        let idempotencyKey;
        try {
            idempotencyKey = validateIdempotencyKey(req.get('Idempotency-Key'));
        } catch {
            return res.status(400).json({ message: 'Idempotency-Key 格式无效' });
        }

        let taskResult;
        try {
            [taskResult] = await pool.execute(
                `INSERT INTO ai_tasks
                 (project_id, file_id, prompt, model_config, status, task_type, priority, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [projectId, fileId || null, prompt, JSON.stringify(modelConfig), 'pending', 'video_analysis', priority ? 10 : 0, idempotencyKey]
            );
        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY' || !idempotencyKey) throw error;
            const [existing] = await pool.execute(
                'SELECT id FROM ai_tasks WHERE project_id = ? AND idempotency_key = ?',
                [projectId, idempotencyKey]
            );
            return res.json({ message: 'AI分析任务已存在', taskId: existing[0].id, reused: true });
        }

        const taskId = taskResult.insertId;

        // 更新项目最后操作时间和操作人
        await updateProjectLastOperation(projectId, req.user.id);

        res.json({
            message: 'AI分析任务已创建',
            taskId: taskId
        });
    } catch (error) {
        console.error('创建AI任务错误:', error);
        res.status(500).json({ message: '创建AI任务失败' });
    }
});

// 处理AI任务
// 读取文本文件内容
async function readTextFile(filePath, mimeType) {
    try {
        if (mimeType === 'text/plain') {
            return await fs.readFile(filePath, 'utf8');
        } else {
            return await fs.readFile(filePath, 'utf8');
        }
    } catch (error) {
        throw new Error('文件读取失败');
    }
}

// 获取项目所有内容
async function getProjectContent(projectId) {
    try {
        const [files] = await pool.execute(
            'SELECT * FROM files WHERE project_id = ?',
            [projectId]
        );

        const contents = [];
        for (const file of files) {
            try {
                if (file.mime_type.startsWith('text/')) {
                    let content;
                    
                    if (file.storage_type === 'minio' && file.minio_bucket && file.minio_object_name) {
                        // 从 MinIO 获取文本文件内容
                        console.log('📚 从 MinIO 获取项目文本文件:', file.minio_bucket, file.minio_object_name);
                        const fileBuffer = await minioService.getFileBuffer(file.minio_bucket, file.minio_object_name);
                        content = fileBuffer.toString('utf8');
                    } else {
                        // 从本地文件系统获取内容
                        const absolutePath = path.isAbsolute(file.file_path) 
                            ? file.file_path 
                            : path.resolve(file.file_path);
                        content = await readTextFile(absolutePath, file.mime_type);
                    }
                    
                    contents.push(`文件：${file.original_name}\n${content}`);
                } else {
                    contents.push(`文件：${file.original_name}（${file.mime_type}，无法提取文本内容）`);
                }
            } catch (error) {
                contents.push(`文件：${file.original_name}（读取失败）`);
            }
        }

        return contents.join('\n\n---\n\n');
    } catch (error) {
        throw new Error('获取项目内容失败');
    }
}

// 获取AI任务状态
router.get('/task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;

        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id 
            FROM ai_tasks at 
            JOIN projects p ON at.project_id = p.id 
            WHERE at.id = ?
        `, [taskId]);

        if (tasks.length === 0) {
            return res.status(404).json({ message: '任务不存在' });
        }

        const task = tasks[0];
        const userPermission = req.user.permission || 'personal';
        
        // 权限检查：管理员、全局权限用户或项目所有者可以访问
        if (task.user_id !== req.user.id && req.user.role !== 'admin' && !['global', 'readonly_global'].includes(userPermission)) {
            console.warn(`[AI任务权限拒绝] user_id=${req.user.id}, taskId=${taskId}, task_owner=${task.user_id}, role=${req.user.role}, permission=${userPermission}`);
            return res.status(403).json({ message: '没有权限访问此任务' });
        }

        res.json({ task });
    } catch (error) {
        console.error('获取任务状态错误:', error);
        res.status(500).json({ message: '获取任务状态失败' });
    }
});

// 取消AI任务（pending 直接取消；processing 标记取消请求）
router.post('/task/:taskId/cancel', async (req, res) => {
    try {
        const { taskId } = req.params;

        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id 
            FROM ai_tasks at 
            JOIN projects p ON at.project_id = p.id 
            WHERE at.id = ?
        `, [taskId]);

        if (tasks.length === 0) {
            return res.status(404).json({ message: '任务不存在' });
        }

        const task = tasks[0];
        const userPermission = req.user.permission || 'personal';
        const isAllowed = task.user_id === req.user.id || req.user.role === 'admin' || userPermission === 'global';
        if (!isAllowed) return res.status(403).json({ message: '没有权限取消此任务' });

        if (task.status === 'pending') {
            await pool.execute('UPDATE ai_tasks SET status = "canceled", canceled_at = CURRENT_TIMESTAMP WHERE id = ?', [taskId]);
            return res.json({ success: true, canceled: true });
        } else if (task.status === 'processing') {
            await pool.execute('UPDATE ai_tasks SET cancel_requested = 1 WHERE id = ?', [taskId]);
            return res.json({ success: true, cancelRequested: true });
        } else {
            return res.json({ success: false, message: '任务非待处理/处理中，无法取消' });
        }
    } catch (error) {
        console.error('取消任务失败:', error);
        res.status(500).json({ message: '取消任务失败' });
    }
});

// 暂停任务
router.post('/task/:taskId/pause', async (req, res) => {
    try {
        const { taskId } = req.params;
        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id 
            FROM ai_tasks at 
            JOIN projects p ON at.project_id = p.id 
            WHERE at.id = ?
        `, [taskId]);
        if (tasks.length === 0) return res.status(404).json({ message: '任务不存在' });
        const task = tasks[0];
        const userPermission = req.user.permission || 'personal';
        const isAllowed = task.user_id === req.user.id || req.user.role === 'admin' || userPermission === 'global';
        if (!isAllowed) return res.status(403).json({ message: '没有权限暂停此任务' });

        if (task.status === 'pending') {
            await pool.execute('UPDATE ai_tasks SET status = "paused", paused_at = CURRENT_TIMESTAMP WHERE id = ?', [taskId]);
            return res.json({ success: true, paused: true });
        } else if (task.status === 'processing') {
            await pool.execute('UPDATE ai_tasks SET pause_requested = 1 WHERE id = ?', [taskId]);
            return res.json({ success: true, pauseRequested: true });
        }
        return res.json({ success: false, message: '仅待处理/处理中任务可暂停' });
    } catch (error) {
        console.error('暂停任务失败:', error);
        res.status(500).json({ message: '暂停任务失败' });
    }
});

// 恢复任务
router.post('/task/:taskId/resume', async (req, res) => {
    try {
        const { taskId } = req.params;
        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id 
            FROM ai_tasks at 
            JOIN projects p ON at.project_id = p.id 
            WHERE at.id = ?
        `, [taskId]);
        if (tasks.length === 0) return res.status(404).json({ message: '任务不存在' });
        const task = tasks[0];
        const userPermission = req.user.permission || 'personal';
        const isAllowed = task.user_id === req.user.id || req.user.role === 'admin' || userPermission === 'global';
        if (!isAllowed) return res.status(403).json({ message: '没有权限恢复此任务' });

        if (task.status === 'paused') {
            await pool.execute('UPDATE ai_tasks SET status = "pending", pause_requested = 0, paused_at = NULL WHERE id = ?', [taskId]);
            return res.json({ success: true, resumed: true });
        }
        return res.json({ success: false, message: '仅已暂停任务可恢复' });
    } catch (error) {
        console.error('恢复任务失败:', error);
        res.status(500).json({ message: '恢复任务失败' });
    }
});

// 新增：剧本整合接口
router.post('/integrate-script', authenticateToken, async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const { integrationPrompt, draftContent, projectId, modelConfig } = req.body;

        if (!integrationPrompt || !draftContent || !projectId) {
            return res.status(400).json({ message: '项目ID、整合提示词和草稿内容不能为空' });
        }

        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 验证项目权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员或全局权限：可以对任何项目进行整合
            sql = 'SELECT id FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // personal和readonly_global权限：只能对自己的项目进行整合
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);

        if (projects.length === 0) {
            return res.status(403).json({ message: '无权访问此项目' });
        }

        // 调用AI服务进行整合
        const result = await getTextGenerationService().integrateScript(integrationPrompt, draftContent, modelConfig);

        // 将剧本整合结果存储到 ai_tasks 表
        const [taskResult] = await pool.execute(
            'INSERT INTO ai_tasks (project_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [projectId, integrationPrompt, result.text, 'completed', 'script_integration']
        );

        res.json({
            success: true,
            integratedScript: result.text,
            taskId: taskResult.insertId
        });

    } catch (error) {
        console.error('剧本整合错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '剧本整合失败'
        });
    }
});

// 新增：角色知识图谱生成接口
router.post('/generate-character-graph', authenticateToken, async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const { projectId, fileId, prompt, modelConfig } = req.body;

        if (!projectId || !fileId || !prompt) {
            return res.status(400).json({ message: '项目ID、文件ID和提示词不能为空' });
        }

        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 验证项目和文件权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员或全局权限：可以对任何项目的文件进行角色图谱生成
            sql = `SELECT f.*, p.type as project_type 
                   FROM files f 
                   JOIN projects p ON f.project_id = p.id 
                   WHERE f.id = ? AND f.project_id = ?`;
            params = [fileId, projectId];
        } else {
            // personal和readonly_global权限：只能对自己的项目进行角色图谱生成
            sql = `SELECT f.*, p.type as project_type 
                   FROM files f 
                   JOIN projects p ON f.project_id = p.id 
                   WHERE f.id = ? AND f.project_id = ? AND p.user_id = ?`;
            params = [fileId, projectId, req.user.id];
        }

        const [files] = await pool.execute(sql, params);

        if (files.length === 0) {
            return res.status(403).json({ message: '无权访问此文件或文件不存在' });
        }

        const fileInfo = files[0];

        // 生成角色知识图谱
        let result;
        if (fileInfo.project_type === 'video') {
            // 对于视频项目，先获取视频解析结果，然后基于文本内容生成角色知识图谱
            console.log('📹 开始基于视频解析结果生成角色知识图谱');
            
            // 查询该文件的视频解析结果
            const [videoAnalysisTasks] = await pool.execute(
                'SELECT result FROM ai_tasks WHERE file_id = ? AND task_type = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
                [fileId, 'video_analysis', 'completed']
            );
            
            if (videoAnalysisTasks.length === 0) {
                throw new Error('请先完成视频内容解析，再生成角色知识图谱');
            }
            
            const videoAnalysisResult = videoAnalysisTasks[0].result;
            console.log('✅ 找到视频解析结果，文本长度:', videoAnalysisResult.length);
            
            // 使用视频解析结果和角色图谱prompt调用文本分析接口
            result = await geminiService.analyzeContent(prompt, videoAnalysisResult, modelConfig);
        } else if (fileInfo.project_type === 'novel') {
            // 读取文本文件内容 - 处理 MinIO 存储
            let fileContent;
            
            if (fileInfo.storage_type === 'minio' && fileInfo.minio_bucket && fileInfo.minio_object_name) {
                // 从 MinIO 获取文本文件内容
                console.log('📚 从 MinIO 获取文本文件:', fileInfo.minio_bucket, fileInfo.minio_object_name);
                const fileBuffer = await minioService.getFileBuffer(fileInfo.minio_bucket, fileInfo.minio_object_name);
                fileContent = fileBuffer.toString('utf8');
            } else {
                // 从本地文件系统获取内容
                const absolutePath = path.isAbsolute(fileInfo.file_path) 
                    ? fileInfo.file_path 
                    : path.resolve(fileInfo.file_path);
                fileContent = await readTextFile(absolutePath, fileInfo.mime_type);
            }
            
            result = await geminiService.analyzeNovel(prompt, fileContent, modelConfig);
        }

        // 将角色知识图谱结果存储到 ai_tasks 表
        await pool.execute(
            'INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [projectId, fileId, prompt, result.text, 'completed', 'character_graph']
        );

        // 更新项目最后操作时间
        await updateProjectLastOperation(projectId, req.user.id);

        res.json({
            success: true,
            result: result.text
        });

    } catch (error) {
        console.error('角色知识图谱生成错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '角色知识图谱生成失败'
        });
    }
});

// 新增：角色知识图谱整合接口
router.post('/integrate-character-graph', authenticateToken, async (req, res) => {
    try {
        if (!geminiService) {
            return res.status(500).json({ message: 'Gemini服务未初始化，请检查API密钥配置' });
        }

        const { projectId, prompt, characterGraphs, modelConfig } = req.body;

        if (!projectId || !prompt || !characterGraphs) {
            return res.status(400).json({ message: '项目ID、提示词和角色图谱内容不能为空' });
        }

        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 验证项目权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员或全局权限：可以对任何项目进行角色图谱整合
            sql = 'SELECT id, type FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // personal和readonly_global权限：只能对自己的项目进行角色图谱整合
            sql = 'SELECT id, type FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);

        if (projects.length === 0) {
            return res.status(403).json({ message: '无权访问此项目或项目不存在' });
        }

        const project = projects[0];

        console.log('🧩 开始角色知识图谱直接拼接整合');
        console.log('📊 角色图谱数据数量:', Array.isArray(characterGraphs) ? characterGraphs.length : 1);

        let result;
        if (Array.isArray(characterGraphs) && characterGraphs.length > 1) {
            // 直接拼接整合逻辑：将所有分集图谱上下拼接后一次性整合
            console.log('🔗 开始直接拼接整合，共', characterGraphs.length, '个分集图谱');
            
            // 移除每个图谱内容中的"第X集"前缀，但保留集数信息用于拼接
            const processedGraphs = characterGraphs.map((graph, index) => {
                // 提取集数信息
                const episodeMatch = graph.match(/^(第\d+集)/);
                const episodeTitle = episodeMatch ? episodeMatch[1] : `第${index + 1}集`;
                
                // 移除开头的"第X集："或"第X集 "等形式的前缀，获取纯内容
                const cleanContent = graph.replace(/^第\d+集[：:\s]+/g, '').trim();
                
                // 返回带集数标题的格式化内容
                return `=== ${episodeTitle} ===\n\n${cleanContent}`;
            });
            
            // 将所有图谱内容直接拼接
            const integrateContent = processedGraphs.join('\n\n---分集分隔符---\n\n');
            
            console.log('📝 拼接后内容长度:', integrateContent.length);
            console.log('🚀 开始一次性整合所有分集图谱');
            
            result = await geminiService.analyzeContent(prompt, integrateContent, modelConfig);
            
            console.log('✅ 直接拼接整合完成');
        } else {
            // 单个图谱或空数组的处理
            const integrateContent = Array.isArray(characterGraphs) ? 
                characterGraphs[0]?.replace(/^第\d+集[：:\s]+/g, '').trim() || '' : 
                characterGraphs.replace(/^第\d+集[：:\s]+/g, '').trim();
            result = await geminiService.analyzeContent(prompt, integrateContent, modelConfig);
        }

        // 将角色图谱整合结果存储到 ai_tasks 表
        await pool.execute(
            'INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [projectId, null, prompt, result.text, 'completed', 'character_integration']
        );

        // 更新项目最后操作时间
        await updateProjectLastOperation(projectId, req.user.id);

        res.json({
            success: true,
            result: result.text
        });

    } catch (error) {
        console.error('角色知识图谱整合错误:', error);
        
        try {
            // 保存失败状态的记录到数据库
            await pool.execute(
                'INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [projectId, null, prompt, '整合失败', 'failed', 'character_integration']
            );
            
            console.log('✅ 角色图谱整合失败状态已保存到数据库');
        } catch (saveError) {
            console.error('❌ 保存失败状态时出错:', saveError);
        }
        
        res.status(500).json({ 
            success: false, 
            message: '角色知识图谱整合失败'
        });
    }
});

// 新增：获取项目的所有AI任务
router.get('/project/:projectId/tasks', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        
        console.log('📋 获取项目任务:', {
            projectId,
            userId: req.user.id,
            userRole: req.user.role,
            permission: req.user.permission
        });

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限：可以访问任何项目的任务
            sql = `SELECT at.*, f.original_name as file_name 
                   FROM ai_tasks at 
                   LEFT JOIN files f ON at.file_id = f.id 
                   WHERE at.project_id = ?
                   ORDER BY at.created_at DESC`;
            params = [projectId];
        } else {
            // 个人权限：只能访问自己的项目任务
            sql = `SELECT at.*, f.original_name as file_name 
                   FROM ai_tasks at 
                   LEFT JOIN files f ON at.file_id = f.id 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC`;
            params = [projectId, req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        console.log('✅ 项目任务查询成功:', {
            projectId,
            taskCount: tasks.length,
            userId: req.user.id
        });
        
        res.json({
            success: true,
            tasks: tasks,
            count: tasks.length
        });

    } catch (error) {
        console.error('❌ 获取项目任务列表错误:', {
            projectId: req.params.projectId,
            userId: req.user.id,
            errorCode: error.code || error.name,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false, 
            message: '获取项目任务列表失败'
        });
    }
});

// 新增：根据任务类型获取AI任务结果
router.get('/tasks/:projectId/:taskType', authenticateToken, async (req, res) => {
    try {
        const { projectId, taskType } = req.params;
        
        // 验证任务类型
        const validTaskTypes = ['video_analysis', 'character_graph', 'script_integration', 'character_integration'];
        if (!validTaskTypes.includes(taskType)) {
            return res.status(400).json({ message: '无效的任务类型' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限：可以访问任何项目的任务
            sql = `SELECT at.*, f.original_name as file_name 
                   FROM ai_tasks at 
                   LEFT JOIN files f ON at.file_id = f.id 
                   WHERE at.project_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC`;
            params = [projectId, taskType];
        } else {
            // 个人权限：只能访问自己的项目任务
            sql = `SELECT at.*, f.original_name as file_name 
                   FROM ai_tasks at 
                   LEFT JOIN files f ON at.file_id = f.id 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC`;
            params = [projectId, taskType, req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        res.json({
            success: true,
            tasks: tasks,
            count: tasks.length
        });

    } catch (error) {
        console.error('获取AI任务列表错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取AI任务列表失败' 
        });
    }
});

// 新增：根据任务类型删除AI任务
router.delete('/tasks/:projectId/:taskType', authenticateToken, async (req, res) => {
    try {
        const { projectId, taskType } = req.params;
        
        console.log('🗑️ 删除任务请求:', {
            projectId,
            taskType,
            userId: req.user.id,
            userRole: req.user.role,
            permission: req.user.permission
        });
        
        // 验证任务类型
        const validTaskTypes = ['video_analysis', 'character_graph', 'script_integration', 'character_integration', 'global_character_content'];
        if (!validTaskTypes.includes(taskType)) {
            return res.status(400).json({ message: '无效的任务类型' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员和全局权限：可以删除任何项目的任务
            sql = `DELETE at FROM ai_tasks at 
                   WHERE at.project_id = ? AND at.task_type = ?`;
            params = [projectId, taskType];
        } else {
            // 个人权限：只能删除自己的项目任务
            sql = `DELETE at FROM ai_tasks at 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND at.task_type = ? AND p.user_id = ?`;
            params = [projectId, taskType, req.user.id];
        }

        const [result] = await pool.execute(sql, params);
        
        console.log('✅ 任务删除完成:', {
            projectId,
            taskType,
            deletedCount: result.affectedRows,
            userId: req.user.id
        });
        
        res.json({
            success: true,
            message: `成功删除 ${result.affectedRows} 个 ${taskType} 类型的任务`,
            deletedCount: result.affectedRows
        });

    } catch (error) {
        console.error('❌ 删除AI任务错误:', {
            projectId: req.params.projectId,
            taskType: req.params.taskType,
            userId: req.user.id,
            errorCode: error.code || error.name,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false, 
            message: '删除AI任务失败'
        });
    }
});

// 新增：获取文件的特定类型分析结果
router.get('/file/:fileId/result/:taskType', authenticateToken, async (req, res) => {
    try {
        const { fileId, taskType } = req.params;
        
        // 验证任务类型
        const validTaskTypes = ['video_analysis', 'character_graph', 'character_integration'];
        if (!validTaskTypes.includes(taskType)) {
            return res.status(400).json({ message: '无效的任务类型' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限：可以访问任何文件的分析结果
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   WHERE at.file_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [fileId, taskType];
        } else {
            // 个人权限：只能访问自己的文件分析结果
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   JOIN files f ON at.file_id = f.id
                   JOIN projects p ON f.project_id = p.id
                   WHERE at.file_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [fileId, taskType, req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        if (tasks.length === 0) {
            return res.json({
                success: true,
                result: null,
                message: '暂无分析结果'
            });
        }

        res.json({
            success: true,
            result: tasks[0].result,
            status: tasks[0].status,
            task: tasks[0]
        });

    } catch (error) {
        console.error('获取文件分析结果错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取文件分析结果失败' 
        });
    }
});

// 新增：获取项目的角色知识图谱整合结果
router.get('/project/:projectId/character-integration', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限：可以访问任何项目的图谱整合结果
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   WHERE at.project_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'character_integration'];
        } else {
            // 个人权限：只能访问自己的项目图谱整合结果
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'character_integration', req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        if (tasks.length === 0) {
            return res.json({
                success: true,
                result: null,
                message: '暂无图谱整合结果'
            });
        }

        res.json({
            success: true,
            result: tasks[0].result,
            status: tasks[0].status,
            task: tasks[0]
        });

    } catch (error) {
        console.error('获取项目图谱整合结果错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取项目图谱整合结果失败' 
        });
    }
});

// 新增：更新项目的角色知识图谱整合结果
router.put('/project/:projectId/character-integration', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { result } = req.body;
        
        if (!result) {
            return res.status(400).json({ message: '图谱整合结果不能为空' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        // 首先查找对应的任务
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员和全局权限：可以更新任何项目的图谱整合结果
            sql = `SELECT at.id 
                   FROM ai_tasks at 
                   WHERE at.project_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'character_integration'];
        } else {
            // 个人权限：只能更新自己的项目图谱整合结果
            sql = `SELECT at.id 
                   FROM ai_tasks at 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'character_integration', req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: '未找到对应的图谱整合任务'
            });
        }

        // 更新结果
        await pool.execute(
            'UPDATE ai_tasks SET result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [result, tasks[0].id]
        );

        res.json({
            success: true,
            message: '图谱整合结果更新成功'
        });

    } catch (error) {
        console.error('更新项目图谱整合结果错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '更新项目图谱整合结果失败' 
        });
    }
});

// 新增：更新文件的特定类型分析结果
router.put('/file/:fileId/result/:taskType', authenticateToken, async (req, res) => {
    try {
        const { fileId, taskType } = req.params;
        const { result } = req.body;
        
        // 验证任务类型
        const validTaskTypes = ['video_analysis', 'character_graph', 'character_integration'];
        if (!validTaskTypes.includes(taskType)) {
            return res.status(400).json({ message: '无效的任务类型' });
        }

        if (!result) {
            return res.status(400).json({ message: '分析结果不能为空' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        // 首先查找对应的任务
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员和全局权限：可以更新任何文件的分析结果
            sql = `SELECT at.id 
                   FROM ai_tasks at 
                   WHERE at.file_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [fileId, taskType];
        } else {
            // 个人权限：只能更新自己的文件分析结果
            sql = `SELECT at.id 
                   FROM ai_tasks at 
                   JOIN files f ON at.file_id = f.id
                   JOIN projects p ON f.project_id = p.id
                   WHERE at.file_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [fileId, taskType, req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: '未找到对应的分析任务'
            });
        }

        // 更新结果
        await pool.execute(
            'UPDATE ai_tasks SET result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [result, tasks[0].id]
        );

        res.json({
            success: true,
            message: '分析结果更新成功'
        });

    } catch (error) {
        console.error('更新文件分析结果错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '更新文件分析结果失败' 
        });
    }
});

// 新增：保存全局角色图谱
router.put('/project/:projectId/global-character-content', authenticateToken, async (req, res) => {
    try {
        console.log('🚀 [后端API] 接收到保存全局角色图谱请求');
        const { projectId } = req.params;
        const { content } = req.body;
        
        console.log('📊 [后端API] 项目ID:', projectId);
        console.log('📝 [后端API] 内容长度:', content ? content.length : 0);
        console.log('👤 [后端API] 用户ID:', req.user.id);
        console.log('🔐 [后端API] 用户权限:', req.user.permission);
        
        if (content === undefined || content === null) {
            console.log('❌ [后端API] 内容为空，返回400错误');
            return res.status(400).json({ message: '全局角色图谱内容不能为空' });
        }

        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 管理员和全局权限：可以保存任何项目的全局角色图谱
            sql = 'SELECT id FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // 个人权限：只能保存自己的项目全局角色图谱
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        console.log('🔍 [后端API] 检查项目权限...');
        const [projects] = await pool.execute(sql, params);
        console.log('📋 [后端API] 项目查询结果:', projects);
        
        if (projects.length === 0) {
            console.log('❌ [后端API] 无权访问项目或项目不存在');
            return res.status(403).json({ message: '无权访问此项目或项目不存在' });
        }

        // 查找是否已有手动录入的角色图谱记录
        console.log('🔍 [后端API] 查找现有的手动录入角色图谱记录...');
        const [existingTasks] = await pool.execute(
            'SELECT id FROM ai_tasks WHERE project_id = ? AND task_type = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1',
            [projectId, 'global_character_content', '手动录入全局角色图谱']
        );
        console.log('📋 [后端API] 现有记录查询结果:', existingTasks);

        if (existingTasks.length > 0) {
            // 更新现有记录
            console.log('🔄 [后端API] 更新现有记录, ID:', existingTasks[0].id);
            await pool.execute(
                'UPDATE ai_tasks SET result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [content, existingTasks[0].id]
            );
            console.log('✅ [后端API] 记录更新成功');
        } else {
            // 创建新记录
            console.log('➕ [后端API] 创建新记录...');
            const [insertResult] = await pool.execute(
                'INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [projectId, null, '手动录入全局角色图谱', content, 'completed', 'global_character_content']
            );
            console.log('✅ [后端API] 新记录创建成功, ID:', insertResult.insertId);
        }

        // 更新项目最后操作时间
        console.log('🔄 [后端API] 更新项目最后操作时间...');
        await updateProjectLastOperation(projectId, req.user.id);

        console.log('🎉 [后端API] 全局角色图谱保存完成');
        res.json({
            success: true,
            message: '全局角色图谱保存成功'
        });

    } catch (error) {
        console.error('保存全局角色图谱错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '保存全局角色图谱失败' 
        });
    }
});

// 新增：获取全局角色图谱
router.get('/project/:projectId/global-character-content', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // 权限检查
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限：可以访问任何项目的全局角色图谱
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   WHERE at.project_id = ? AND at.task_type = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'global_character_content'];
        } else {
            // 个人权限：只能访问自己的项目全局角色图谱
            sql = `SELECT at.* 
                   FROM ai_tasks at 
                   JOIN projects p ON at.project_id = p.id
                   WHERE at.project_id = ? AND at.task_type = ? AND p.user_id = ?
                   ORDER BY at.created_at DESC 
                   LIMIT 1`;
            params = [projectId, 'global_character_content', req.user.id];
        }

        const [tasks] = await pool.execute(sql, params);
        
        if (tasks.length === 0) {
            return res.json({
                success: true,
                content: null,
                message: '暂无全局角色图谱内容'
            });
        }

        res.json({
            success: true,
            content: tasks[0].result,
            status: tasks[0].status,
            task: tasks[0]
        });

    } catch (error) {
        console.error('获取全局角色图谱错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取全局角色图谱失败' 
        });
    }
});

// 导出重新加载服务的函数，供系统配置更新时调用
router.reloadGeminiService = function() {
    const serviceManager = require('../services/serviceManager');
    return serviceManager.reloadAIServices();
};

module.exports = router;
