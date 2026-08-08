const { pool } = require('../config/database');
const logger = require('../utils/logger');
const eventBus = require('./eventBus');
const path = require('node:path');
const { createOpaqueTempPath } = require('../utils/security');
const {
    claimNextTask,
    completeClaimedTask,
    failClaimedTask,
    rescheduleClaimedTask
} = require('./taskClaimer');
const { taskControlAction } = require('./taskControl');
const { buildCharacterAwarePrompt, parseCharacterAwareResult } = require('./characterSnapshot');
const { getCharacterRegistryService } = require('./characterRegistryService');

// 导入现有的服务
// const processAITask = require('./aiTaskProcessor'); // 这个模块不存在，我们直接实现逻辑

class UnifiedTaskProcessor {
    constructor() {
        this.isRunning = false;
        this.isPaused = false; // 暂停状态
        this.maxConcurrent = 2; // 最大并发任务数
        this.activeWorkers = new Map(); // 活跃的工作进程
        this.pollInterval = 5000; // 轮询间隔：5秒
        this.processingTimeout = 30 * 60 * 1000; // 处理超时：30分钟
    }

    /**
     * 启动统一任务处理器
     */
    async start() {
        if (this.isRunning) {
            logger.warn('TASK_PROCESSOR', '任务处理器已在运行中');
            return;
        }

        this.isRunning = true;
        logger.success('TASK_PROCESSOR', '统一任务处理器启动', {
            maxConcurrent: this.maxConcurrent,
            pollInterval: this.pollInterval
        });

        // 启动时恢复可能的僵死任务
        await this.recoverStuckTasks();

        // 开始主处理循环
        this.processLoop();
    }

    /**
     * 停止任务处理器
     */
    async stop() {
        this.isRunning = false;
        
        // 等待所有活跃任务完成
        const activeCount = this.activeWorkers.size;
        if (activeCount > 0) {
            logger.info('TASK_PROCESSOR', `等待 ${activeCount} 个活跃任务完成...`);
            
            // 最多等待5分钟
            const timeout = setTimeout(() => {
                logger.warn('TASK_PROCESSOR', '强制停止任务处理器');
                this.activeWorkers.clear();
            }, 5 * 60 * 1000);

            while (this.activeWorkers.size > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            clearTimeout(timeout);
        }

        logger.success('TASK_PROCESSOR', '统一任务处理器已停止');
    }

    /**
     * 主处理循环
     */
    async processLoop() {
        while (this.isRunning) {
            try {
                await this.processTasks();
            } catch (error) {
                logger.error('TASK_PROCESSOR', '处理循环出错', { error: error.message });
            }

            // 等待下次轮询
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
    }

    /**
     * 处理任务
     */
    async processTasks() {
        // 检查是否暂停
        if (this.isPaused) {
            return;
        }

        // 检查是否达到最大并发数
        if (this.activeWorkers.size >= this.maxConcurrent) {
            return;
        }

        const workerId = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const task = await this.getNextTask(workerId);
        
        if (task) {
            this.processTask(workerId, task);
        }
    }

    /**
     * 获取下一个待处理任务
     */
    async getNextTask(workerId) {
        try {
            const task = await claimNextTask(pool, { workerId, leaseSeconds: Math.floor(this.processingTimeout / 1000) });
            if (task) {
                logger.info('TASK_PROCESSOR', '获取到待处理任务', {
                    taskId: task.id,
                    fileName: task.original_name,
                    taskSource: task.task_source,
                    priority: task.priority
                });

                return task;
            }

            return null;
        } catch (error) {
            logger.error('TASK_PROCESSOR', '获取任务失败', { error: error.message });
            return null;
        }
    }

    /**
     * 处理单个任务
     */
    async processTask(workerId, task) {
        this.activeWorkers.set(workerId, {
            taskId: task.id,
            startTime: Date.now(),
            fileName: task.original_name
        });

        logger.info('TASK_PROCESSOR', '开始处理任务', {
            workerId,
            taskId: task.id,
            fileName: task.original_name,
            taskSource: task.task_source
        });

        const leaseHeartbeat = setInterval(() => {
            pool.execute(
                `UPDATE ai_tasks SET lease_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
                 WHERE id = ? AND status = 'processing' AND worker_id = ?`,
                [Math.floor(this.processingTimeout / 1000), task.id, workerId]
            ).catch(error => logger.warn('TASK_PROCESSOR', '续租失败', { taskId: task.id, error: error.message }));
        }, 60_000);
        leaseHeartbeat.unref?.();

        try {
            // 任务启动前再读一次状态，若被暂停则放回队列
            const initialControl = await this.applyTaskControl(task.id, workerId);
            if (initialControl !== 'run') {
                logger.info('TASK_PROCESSOR', '任务已被暂停或取消，跳过处理', { taskId: task.id, action: initialControl });
                return;
            }

            // 构造项目和文件信息对象（兼容现有processAITask函数）
            const project = {
                id: task.project_id,
                name: task.project_name,
                type: task.project_type,
                user_id: task.user_id
            };

            const fileInfo = {
                id: task.file_id,
                original_name: task.original_name,
                file_path: task.file_path,
                file_type: task.file_type,
                storage_type: task.storage_type,
                minio_bucket: task.minio_bucket,
                minio_object_name: task.minio_object_name,
                project_type: task.project_type
            };

            let modelConfig = {};
            try {
                if (task.model_config && typeof task.model_config === 'string') {
                    modelConfig = JSON.parse(task.model_config.trim());
                } else if (task.model_config && typeof task.model_config === 'object') {
                    modelConfig = task.model_config;
                }
            } catch (parseError) {
                logger.error('TASK_PROCESSOR', 'JSON解析失败', {
                    taskId: task.id,
                    modelConfig: task.model_config,
                    error: parseError.message
                });
                modelConfig = {}; // 使用默认配置
            }

            // 调用现有的AI任务处理逻辑（每个关键阶段前检查暂停）
            const preProcessControl = await this.applyTaskControl(task.id, workerId);
            if (preProcessControl !== 'run') {
                logger.info('TASK_PROCESSOR', '任务在处理前被暂停或取消', { taskId: task.id, action: preProcessControl });
                return;
            }
            const outcome = await this.callExistingProcessor(task.id, project, fileInfo, task.prompt, modelConfig, workerId);
            if (outcome !== 'completed') return;

            logger.success('TASK_PROCESSOR', '任务处理完成', {
                workerId,
                taskId: task.id,
                fileName: task.original_name,
                duration: Date.now() - this.activeWorkers.get(workerId).startTime
            });

        } catch (error) {
            logger.error('TASK_PROCESSOR', '任务处理失败', {
                workerId,
                taskId: task.id,
                fileName: task.original_name,
                error: error.message
            });

            const failurePersisted = await this.handleTaskFailure(task, error, workerId);
            // 任务失败事件
            try {
                if (failurePersisted) eventBus.broadcast('task-failed', { taskId: task.id, projectId: task.project_id, fileId: task.file_id, userId: task.user_id });
            } catch (_) {}
        } finally {
            clearInterval(leaseHeartbeat);
            this.activeWorkers.delete(workerId);
            
            // 处理完成或被暂停后，立即检查是否有新任务
            setTimeout(() => {
                if (this.isRunning && this.activeWorkers.size < this.maxConcurrent) {
                    this.processTasks();
                }
            }, 100);
        }
    }

    /**
     * 调用现有的AI处理器
     */
    async callExistingProcessor(taskId, project, fileInfo, prompt, modelConfig, workerId) {
        try {
            return await this.processAITaskLogic(taskId, project, fileInfo, prompt, modelConfig, workerId);
            
        } catch (error) {
            throw new Error(`AI处理失败: ${error.message}`);
        }
    }

    async applyTaskControl(taskId, workerId) {
        const [rows] = await pool.execute(
            `SELECT status, cancel_requested, pause_requested FROM ai_tasks
             WHERE id = ? AND status = 'processing' AND worker_id = ?`,
            [taskId, workerId]
        );
        if (rows.length === 0) return 'lease-lost';
        const action = taskControlAction(rows[0]);
        if (action === 'cancel') {
            await pool.execute(
                `UPDATE ai_tasks SET status = 'canceled', canceled_at = CURRENT_TIMESTAMP,
                 started_at = NULL, worker_id = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'processing' AND worker_id = ?`,
                [taskId, workerId]
            );
        } else if (action === 'pause') {
            await pool.execute(
                `UPDATE ai_tasks SET status = 'paused', paused_at = COALESCE(paused_at, CURRENT_TIMESTAMP),
                 started_at = NULL, worker_id = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'processing' AND worker_id = ?`,
                [taskId, workerId]
            );
        }
        return action;
    }

    /**
     * AI任务处理逻辑（从ai.js复制）
     */
    async processAITaskLogic(taskId, project, fileInfo, prompt, modelConfig, workerId) {
        const PythonGeminiService = require('./pythonGeminiService');
        const geminiService = new PythonGeminiService();
        const fs = require('fs').promises;
        const path = require('path');
        const minioService = require('./minioService');

        try {
            let result;
            let characterSnapshot = null;
            let episodeNumber = null;

            if (fileInfo) {
                if (project.type === 'video') {
                    // 视频分析逻辑
                    let videoPath;
                    
                    if (fileInfo.storage_type === 'minio' && fileInfo.minio_bucket && fileInfo.minio_object_name) {
                        // 从 MinIO 获取文件
                        const tempDir = path.join(__dirname, '../temp');
                        await fs.mkdir(tempDir, { recursive: true });
                        const tempFilePath = createOpaqueTempPath(tempDir, fileInfo.original_name, path.extname(fileInfo.original_name));
                        
                        await minioService.downloadFile(fileInfo.minio_bucket, fileInfo.minio_object_name, tempFilePath);
                        videoPath = tempFilePath;
                        
                        logger.info('TASK_PROCESSOR', 'MinIO视频文件下载成功', { tempPath: tempFilePath });
                    } else {
                        // 本地文件存储
                        videoPath = path.resolve(fileInfo.file_path);
                        
                        // 检查文件是否存在
                        try {
                            await fs.access(videoPath);
                        } catch (error) {
                            throw new Error(`本地视频文件不存在: ${videoPath}`);
                        }
                    }
                    
                    // 在耗时调用前应用暂停/取消语义
                    const beforeCall = await this.applyTaskControl(taskId, workerId);
                    if (beforeCall !== 'run') return beforeCall === 'pause' ? 'paused' : 'canceled';

                    // 复用本次视频解析请求生成角色快照，不额外发起模型调用。
                    let compactRegistry = [];
                    try {
                        compactRegistry = await getCharacterRegistryService().getCompactRegistry(project.id);
                    } catch (error) {
                        logger.warn('TASK_PROCESSOR', '角色档案上下文加载失败，继续执行视频解析', {
                            projectId: project.id,
                            error: error.message
                        });
                    }
                    const characterAwarePrompt = buildCharacterAwarePrompt(prompt, compactRegistry);
                    result = await geminiService.analyzeVideo(videoPath, characterAwarePrompt, modelConfig);

                    if (result && result.success && result.text) {
                        const parsedResult = parseCharacterAwareResult(result.text);
                        result.text = parsedResult.scriptText;
                        characterSnapshot = parsedResult.snapshot;
                        if (parsedResult.warning) {
                            logger.warn('TASK_PROCESSOR', '角色快照格式无效，已保留原始脚本结果', {
                                taskId,
                                warning: parsedResult.warning
                            });
                        }
                    }
                    
                    // 清理临时文件
                    if (fileInfo.storage_type === 'minio' && videoPath) {
                        try {
                            await fs.unlink(videoPath);
                        } catch (error) {
                            logger.warn('TASK_PROCESSOR', '清理临时文件失败', { error: error.message });
                        }
                    }
                    
                    // 添加集数标题前缀
                    if (result && result.text && fileInfo.original_name) {
                        episodeNumber = this.extractEpisodeNumber(fileInfo.original_name);
                        if (episodeNumber) {
                            logger.info('TASK_PROCESSOR', '为后台解析结果添加集数前缀', {
                                filename: fileInfo.original_name,
                                episodeNumber: episodeNumber,
                                prefix: `第${episodeNumber}集`
                            });
                            result.text = `第${episodeNumber}集\n\n${result.text}`;
                        } else {
                            logger.warn('TASK_PROCESSOR', '未能从文件名提取集数', {
                                filename: fileInfo.original_name
                            });
                        }
                    }
                } else {
                    throw new Error(`不支持的项目类型: ${project.type}`);
                }
            } else {
                throw new Error('缺少文件信息');
            }

            if (!result || !result.success) {
                throw new Error(result?.error || '分析失败，未返回有效结果');
            }

            // 完成前再次检查暂停/取消，受控中止时不覆盖状态和结果
            const beforePersist = await this.applyTaskControl(taskId, workerId);
            if (beforePersist !== 'run') return beforePersist === 'pause' ? 'paused' : 'canceled';

            // 更新任务状态为完成
            const completed = await completeClaimedTask(pool, { taskId, workerId, result: result.text });
            if (!completed) {
                const terminalControl = await this.applyTaskControl(taskId, workerId);
                if (terminalControl !== 'run' && terminalControl !== 'lease-lost') {
                    return terminalControl === 'pause' ? 'paused' : 'canceled';
                }
                logger.warn('TASK_PROCESSOR', 'Lease ownership changed; discarded stale worker result', { taskId, workerId });
                return 'lease-lost';
            }

            if (characterSnapshot) {
                try {
                    await getCharacterRegistryService().ingestSnapshot({
                        projectId: project.id,
                        fileId: fileInfo.id,
                        episodeNumber,
                        snapshot: characterSnapshot
                    });
                } catch (error) {
                    logger.warn('TASK_PROCESSOR', '角色档案写入失败，不影响脚本解析结果', {
                        taskId,
                        projectId: project.id,
                        error: error.message
                    });
                }
            }

            logger.success('TASK_PROCESSOR', 'AI任务处理成功', {
                taskId,
                resultLength: result.text?.length || 0
            });
            // 任务完成事件
            try {
                eventBus.broadcast('task-completed', { taskId, projectId: project.id, fileId: fileInfo.id, userId: project.user_id });
            } catch (_) {}

            return 'completed';

        } catch (error) {
            logger.error('TASK_PROCESSOR', 'AI任务处理失败', {
                taskId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * 处理任务失败
     */
    async handleTaskFailure(task, error, workerId) {
        try {
            const newRetryCount = Number(task.retry_count || 0) + 1;
            
            if (newRetryCount <= Number(task.max_retries || 0)) {
                // 重试任务 - 使用指数退避策略
                const delayMinutes = Math.pow(2, newRetryCount); // 2, 4, 8 分钟
                
                const persisted = await rescheduleClaimedTask(pool, {
                    taskId: task.id,
                    workerId,
                    retryCount: newRetryCount,
                    errorMessage: error.message,
                    delayMinutes
                });
                if (!persisted) {
                    await this.applyTaskControl(task.id, workerId);
                    return false;
                }
                
                logger.info('TASK_PROCESSOR', '任务将重试', {
                    taskId: task.id,
                    retryCount: newRetryCount,
                    maxRetries: task.max_retries,
                    delayMinutes
                });
            } else {
                // 标记为最终失败
                const persisted = await failClaimedTask(pool, {
                    taskId: task.id,
                    workerId,
                    errorMessage: error.message
                });
                if (!persisted) {
                    await this.applyTaskControl(task.id, workerId);
                    return false;
                }
                
                logger.error('TASK_PROCESSOR', '任务最终失败', {
                    taskId: task.id,
                    fileName: task.original_name,
                    retryCount: newRetryCount,
                    error: error.message
                });
            }
            return true;
        } catch (dbError) {
            logger.error('TASK_PROCESSOR', '更新任务失败状态时出错', {
                taskId: task.id,
                error: dbError.message
            });
            return false;
        }
    }

    /**
     * 恢复可能的僵死任务
     */
    async recoverStuckTasks() {
        try {
            const stuckTimeout = this.processingTimeout; // 30分钟
            
            const [result] = await pool.execute(`
                UPDATE ai_tasks 
                SET status = 'pending', started_at = NULL, worker_id = NULL, lease_until = NULL
                WHERE status = 'processing' 
                AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP)
            `);
            
            if (result.affectedRows > 0) {
                logger.info('TASK_PROCESSOR', '恢复僵死任务', {
                    count: result.affectedRows,
                    timeoutMinutes: stuckTimeout / (1000 * 60)
                });
            }
        } catch (error) {
            logger.error('TASK_PROCESSOR', '恢复僵死任务失败', { error: error.message });
        }
    }



    /**
     * 暂停队列处理
     */
    pause() {
        this.isPaused = true;
        logger.info('TASK_PROCESSOR', '队列处理已暂停');
    }

    /**
     * 恢复队列处理
     */
    resume() {
        this.isPaused = false;
        logger.info('TASK_PROCESSOR', '队列处理已恢复');
        
        // 立即检查是否有待处理任务
        if (this.isRunning) {
            setTimeout(() => this.processTasks(), 100);
        }
    }

    /**
     * 获取处理器状态
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            activeWorkers: this.activeWorkers.size,
            maxConcurrent: this.maxConcurrent,
            workers: Array.from(this.activeWorkers.entries()).map(([workerId, info]) => ({
                workerId,
                taskId: info.taskId,
                fileName: info.fileName,
                duration: Date.now() - info.startTime
            }))
        };
    }

    /**
     * 从文件名中提取集数
     * 支持多种格式：第1集、01、1、ep01、episode1等
     */
    extractEpisodeNumber(filename) {
        if (!filename) return null;
        
        // 移除文件扩展名
        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
        
        // 匹配各种集数格式的正则表达式
        const patterns = [
            /第(\d+)集/,           // 第1集
            /第(\d+)话/,           // 第1话
            /ep(?:isode)?[\s_-]*(\d+)/i,  // ep01, episode01, ep 01, ep_01
            /(?:^|\D)(\d{1,3})(?:\D|$)/,  // 纯数字（1-3位）
        ];
        
        for (const pattern of patterns) {
            const match = nameWithoutExt.match(pattern);
            if (match) {
                const episodeNum = parseInt(match[1], 10);
                if (episodeNum > 0 && episodeNum <= 999) {  // 合理的集数范围
                    return episodeNum;
                }
            }
        }
        
        return null;
    }
}

module.exports = UnifiedTaskProcessor;
