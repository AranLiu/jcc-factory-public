const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    canMutateAllResources,
    canMutateResource,
    canReadAllResources
} = require('../utils/authorization');
const { insertQueuedTask } = require('../services/taskQueue');

// 批量添加视频到解析队列
router.post('/add-batch', authenticateToken, async (req, res) => {
    try {
        const { projectId, fileIds, prompt, modelConfig } = req.body;
        const userId = req.user.id;

        // 验证参数
        if (!projectId || !fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ message: '参数无效：需要项目ID和文件ID列表' });
        }

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ message: '参数无效：需要分析提示词' });
        }

        // 验证项目权限
        const [projects] = await pool.execute('SELECT * FROM projects WHERE id = ?', [projectId]);

        if (projects.length === 0 || !canMutateResource(req.user, projects[0].user_id)) {
            return res.status(403).json({ message: '无权限访问该项目' });
        }

        // 获取当前队列最大位置（包含 pending 与 paused）
        const [maxPos] = await pool.execute(
            'SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM ai_tasks WHERE task_source = "queue" AND status IN ("pending", "paused")'
        );
        
        let currentPosition = maxPos[0].max_pos;
        const addedTasks = [];

        // 批量添加任务到队列
        for (const fileId of fileIds) {
            try {
                // 验证文件存在且属于该项目
                const [files] = await pool.execute(
                    'SELECT * FROM files WHERE id = ? AND project_id = ?',
                    [fileId, projectId]
                );

                if (files.length === 0) {
                    console.warn(`文件 ${fileId} 不存在或不属于项目 ${projectId}`);
                    continue;
                }

                const file = files[0];

                // 检查是否为视频文件
                if (!file.mime_type || !file.mime_type.startsWith('video/')) {
                    console.warn(`文件 ${fileId} 不是视频文件: ${file.mime_type}`);
                    continue;
                }

                // 检查是否已经在队列中
                const [existingTasks] = await pool.execute(
                    'SELECT * FROM ai_tasks WHERE file_id = ? AND task_source = "queue" AND status IN ("pending", "processing", "paused")',
                    [fileId]
                );

                if (existingTasks.length > 0) {
                    console.warn(`文件 ${fileId} 已在解析队列中`);
                    continue;
                }

                currentPosition++;

                // 创建队列任务
                const result = await insertQueuedTask(pool, {
                    projectId,
                    fileId,
                    prompt,
                    modelConfig: modelConfig || {}
                });
                currentPosition = result.queuePosition;

                addedTasks.push({
                    id: result.insertId,
                    fileName: file.original_name,
                    position: currentPosition,
                    fileId: fileId
                });

                console.log(`✅ 已将文件 ${file.original_name} 添加到解析队列，位置: ${currentPosition}`);

            } catch (error) {
                console.error(`处理文件 ${fileId} 时出错:`, error);
                continue;
            }
        }

        if (addedTasks.length === 0) {
            return res.status(400).json({ message: '没有有效的视频文件被添加到队列' });
        }

        res.json({
            success: true,
            message: `已添加 ${addedTasks.length} 个视频到解析队列`,
            tasks: addedTasks,
            totalInQueue: currentPosition
        });

    } catch (error) {
        console.error('批量添加队列任务失败:', error);
        res.status(500).json({ message: '添加任务失败' });
    }
});

// 获取队列状态
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = canReadAllResources(req.user);

        // 构建权限过滤条件
        let projectFilter = '';
        let projectParams = [];
        
        if (!isAdmin) {
            projectFilter = 'AND p.user_id = ?';
            projectParams = [userId];
        }

        // 获取统计信息（原始按状态分组）
        const [stats] = await pool.execute(`
            SELECT 
                at.status,
                COUNT(*) as count
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' ${projectFilter}
            GROUP BY at.status
        `, projectParams);

        const statistics = {};
        stats.forEach(stat => {
            statistics[stat.status] = stat.count;
        });

        // 精确计数（避免JOIN/分页导致的显示不一致）
        const [[{ pendingCount }]] = await pool.execute(`
            SELECT COUNT(*) AS pendingCount
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status = 'pending' ${projectFilter}
        `, projectParams);
        const [[{ processingCount }]] = await pool.execute(`
            SELECT COUNT(*) AS processingCount
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status = 'processing' ${projectFilter}
        `, projectParams);
        const [[{ pausedCount }]] = await pool.execute(`
            SELECT COUNT(*) AS pausedCount
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status = 'paused' ${projectFilter}
        `, projectParams);
        const counts = { pending: pendingCount || 0, processing: processingCount || 0, paused: pausedCount || 0 };
        const totalActive = counts.pending + counts.processing + counts.paused;

        // 统一获取进行中队列：processing + paused + pending
        const [activeTasks] = await pool.execute(`
            SELECT at.*, f.original_name as fileName, p.name as projectName
            FROM ai_tasks at
            LEFT JOIN files f ON at.file_id = f.id
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status IN ('processing', 'paused', 'pending') ${projectFilter}
            ORDER BY CASE at.status WHEN 'processing' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                     at.queue_position ASC, at.created_at ASC
            LIMIT 500
        `, projectParams);

        // 获取失败任务
        const [failedTasks] = await pool.execute(`
            SELECT at.*, f.original_name as fileName, p.name as projectName
            FROM ai_tasks at
            LEFT JOIN files f ON at.file_id = f.id
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status = 'failed' ${projectFilter}
            ORDER BY at.updated_at DESC
        `, projectParams);

        // 获取已完成任务 - 移除LIMIT限制，显示所有已完成任务
        const [completedTasks] = await pool.execute(`
            SELECT at.*, f.original_name as fileName, p.name as projectName
            FROM ai_tasks at
            LEFT JOIN files f ON at.file_id = f.id
            JOIN projects p ON at.project_id = p.id
            WHERE at.task_source = 'queue' AND at.status = 'completed' ${projectFilter}
            ORDER BY at.completed_at DESC, at.updated_at DESC
        `, projectParams);

        // 调试日志保留统计汇总（避免引用未定义变量）
        console.log('🔍 调试队列状态:', {
            totalPending: counts.pending,
            totalProcessing: counts.processing,
            totalPaused: counts.paused
        });

        res.json({
            statistics,
            counts,
            totalActive,
            activeTasks,
            failedTasks,
            completedTasks
        });

    } catch (error) {
        console.error('获取队列状态失败:', error);
        res.status(500).json({ message: '获取队列状态失败' });
    }
});

// 从队列中移除任务（仅限pending状态）
router.delete('/:taskId(\\d+)', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user.id;
        const isAdmin = canMutateAllResources(req.user);

        // 验证任务存在且有权限操作
        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id as project_owner
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.id = ? AND at.task_source = 'queue'
        `, [taskId]);

        if (tasks.length === 0) {
            return res.status(404).json({ message: '任务不存在' });
        }

        const task = tasks[0];

        // 权限检查
        if (!isAdmin && task.project_owner !== userId) {
            return res.status(403).json({ message: '无权限操作该任务' });
        }

        // 不能移除正在处理的任务
        if (task.status === 'processing') {
            return res.status(400).json({ message: '正在处理的任务无法删除，请等待处理完成' });
        }

        // 删除任务
        await pool.execute('DELETE FROM ai_tasks WHERE id = ?', [taskId]);

        // 如果删除的是待处理或暂停任务，重新整理队列位置（pending + paused 一起排序）
        if (task.status === 'pending' || task.status === 'paused') {
            await pool.execute(`
                UPDATE ai_tasks 
                SET queue_position = (
                    SELECT new_position FROM (
                        SELECT id, ROW_NUMBER() OVER (ORDER BY queue_position ASC, created_at ASC) as new_position
                        FROM ai_tasks 
                        WHERE task_source = 'queue' AND status IN ('pending', 'paused')
                    ) as ranked
                    WHERE ranked.id = ai_tasks.id
                )
                WHERE task_source = 'queue' AND status IN ('pending', 'paused')
            `);
        }

        console.log(`✅ 已删除任务 ID: ${taskId}, 状态: ${task.status}`);

        res.json({ message: '任务已删除' });

    } catch (error) {
        console.error('移除队列任务失败:', error);
        res.status(500).json({ message: '移除任务失败' });
    }
});

// 重新加入队列（失败任务）
router.post('/:taskId(\\d+)/retry', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user.id;
        const isAdmin = canMutateAllResources(req.user);

        // 验证任务存在且有权限操作
        const [tasks] = await pool.execute(`
            SELECT at.*, p.user_id as project_owner
            FROM ai_tasks at
            JOIN projects p ON at.project_id = p.id
            WHERE at.id = ? AND at.task_source = 'queue'
        `, [taskId]);

        if (tasks.length === 0) {
            return res.status(404).json({ message: '任务不存在' });
        }

        const task = tasks[0];

        // 权限检查
        if (!isAdmin && task.project_owner !== userId) {
            return res.status(403).json({ message: '无权限操作该任务' });
        }

        // 只能重试失败的任务
        if (task.status !== 'failed') {
            return res.status(400).json({ message: '只能重试失败状态的任务' });
        }

        // 获取新的队列位置（包含 pending 与 paused）
        const [maxPos] = await pool.execute(
            'SELECT COALESCE(MAX(queue_position), 0) as max_pos FROM ai_tasks WHERE task_source = "queue" AND status IN ("pending", "paused")'
        );
        const newPosition = maxPos[0].max_pos + 1;

        // 重置任务状态
        await pool.execute(`
            UPDATE ai_tasks 
            SET status = 'pending', 
                queue_position = ?,
                retry_count = 0,
                error_message = NULL,
                started_at = NULL,
                completed_at = NULL
            WHERE id = ?
        `, [newPosition, taskId]);

        console.log(`✅ 已将失败任务重新加入队列 ID: ${taskId}, 新位置: ${newPosition}`);

        res.json({ 
            message: '已重新加入队列', 
            newPosition: newPosition 
        });

    } catch (error) {
        console.error('重新加入队列失败:', error);
        res.status(500).json({ message: '重新加入队列失败' });
    }
});

// 暂停/恢复队列处理（管理员功能）
router.post('/global/pause', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { pause } = req.body; // true: 暂停, false: 恢复
        if (typeof pause !== 'boolean') {
            return res.status(400).json({ message: 'pause must be a boolean' });
        }

        // 获取任务处理器实例
        const taskProcessor = req.app.get('taskProcessor');
        
        if (!taskProcessor) {
            return res.status(500).json({ message: '任务处理器不可用' });
        }

        await pool.execute(
            `INSERT INTO system_config (config_key, config_value, config_type, description)
             VALUES ('queue_paused', ?, 'boolean', 'Global task intake pause flag')
             ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
            [pause ? 'true' : 'false']
        );

        if (pause) {
            // 暂停处理器
            taskProcessor.pause();
            console.log('✅ 全局任务领取已暂停');
        } else {
            // 恢复处理器
            taskProcessor.resume();
        }
        
        res.json({ 
            message: pause ? '队列已暂停' : '队列已恢复',
            paused: pause
        });

    } catch (error) {
        console.error('队列暂停/恢复失败:', error);
        res.status(500).json({ message: '操作失败' });
    }
});

// 批量恢复当前用户的已暂停任务（不需要管理员权限）
router.post('/bulk/resume', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = canMutateAllResources(req.user);

        let result;
        if (isAdmin) {
            // 管理员：恢复全部暂停任务
            [result] = await pool.execute(`
                UPDATE ai_tasks 
                SET status = 'pending' 
                WHERE task_source = 'queue' AND status = 'paused'
            `);
        } else {
            // 普通用户：仅恢复自己项目下的暂停任务
            [result] = await pool.execute(`
                UPDATE ai_tasks at
                JOIN projects p ON at.project_id = p.id
                SET at.status = 'pending'
                WHERE at.task_source = 'queue' AND at.status = 'paused' AND p.user_id = ?
            `, [userId]);
        }

        res.json({
            success: true,
            message: `已恢复 ${result.affectedRows || 0} 个暂停任务到待处理`,
            resumedCount: result.affectedRows || 0
        });

    } catch (error) {
        console.error('批量恢复暂停任务失败:', error);
        res.status(500).json({ message: '批量恢复失败' });
    }
});

// 清空队列（管理员功能）
async function handleClearQueue(req, res) {
    try {
        const isAdmin = canMutateAllResources(req.user);
        let result;

        if (isAdmin) {
            // 管理员：清空所有 pending + paused
            [result] = await pool.execute(
                'DELETE FROM ai_tasks WHERE task_source = "queue" AND status IN ("pending", "paused")'
            );
        } else {
            // 普通用户：仅清空自己项目下的 pending + paused
            [result] = await pool.execute(`
                DELETE at FROM ai_tasks at
                JOIN projects p ON at.project_id = p.id
                WHERE at.task_source = 'queue' AND at.status IN ('pending','paused') AND p.user_id = ?
            `, [req.user.id]);
        }

        console.log(`✅ 已清空队列，删除了 ${result.affectedRows} 个待处理任务`);

        // 清空后为健壮性：重排一次剩余的 pending + paused（全局重排）
        await pool.execute(`
            UPDATE ai_tasks 
            SET queue_position = (
                SELECT new_position FROM (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY queue_position ASC, created_at ASC) as new_position
                    FROM ai_tasks 
                    WHERE task_source = 'queue' AND status IN ('pending', 'paused')
                ) as ranked
                WHERE ranked.id = ai_tasks.id
            )
            WHERE task_source = 'queue' AND status IN ('pending', 'paused')
        `);

        res.json({ 
            message: `已清空队列，删除了 ${result.affectedRows} 个待处理/暂停任务`,
            deletedCount: result.affectedRows
        });

    } catch (error) {
        console.error('清空队列失败:', error);
        res.status(500).json({ message: '清空队列失败' });
    }
}

// 标准路径
router.delete('/clear', authenticateToken, handleClearQueue);
// 兼容前端代理对 DELETE 的限制：提供 POST 版本的清空接口
router.post('/clear-all', authenticateToken, handleClearQueue);

// 清空所有“已完成”记录（管理员为全部，普通用户为自己项目）
router.delete('/clear/completed', authenticateToken, async (req, res) => {
    try {
        const isAdmin = canMutateAllResources(req.user);
        let result;
        if (isAdmin) {
            [result] = await pool.execute(
                "DELETE FROM ai_tasks WHERE task_source = 'queue' AND status = 'completed'"
            );
        } else {
            [result] = await pool.execute(`
                DELETE at FROM ai_tasks at
                JOIN projects p ON at.project_id = p.id
                WHERE at.task_source = 'queue' AND at.status = 'completed' AND p.user_id = ?
            `, [req.user.id]);
        }
        res.json({ message: `已清除 ${result.affectedRows} 条已完成记录`, deletedCount: result.affectedRows });
    } catch (error) {
        console.error('清空已完成记录失败:', error);
        res.status(500).json({ message: '清空已完成记录失败' });
    }
});

// POST 版本（兼容代理问题）
router.post('/clear-completed', authenticateToken, async (req, res) => {
    try {
        const isAdmin = canMutateAllResources(req.user);
        let result;
        if (isAdmin) {
            [result] = await pool.execute(
                "DELETE FROM ai_tasks WHERE task_source = 'queue' AND status = 'completed'"
            );
        } else {
            [result] = await pool.execute(`
                DELETE at FROM ai_tasks at
                JOIN projects p ON at.project_id = p.id
                WHERE at.task_source = 'queue' AND at.status = 'completed' AND p.user_id = ?
            `, [req.user.id]);
        }
        res.json({ message: `已清除 ${result.affectedRows} 条已完成记录`, deletedCount: result.affectedRows });
    } catch (error) {
        console.error('清空已完成记录失败:', error);
        res.status(500).json({ message: '清空已完成记录失败' });
    }
});

// 清空所有“失败”记录（管理员为全部，普通用户为自己项目）
router.delete('/clear/failed', authenticateToken, async (req, res) => {
    try {
        const isAdmin = canMutateAllResources(req.user);
        let result;
        if (isAdmin) {
            [result] = await pool.execute(
                "DELETE FROM ai_tasks WHERE task_source = 'queue' AND status = 'failed'"
            );
        } else {
            [result] = await pool.execute(`
                DELETE at FROM ai_tasks at
                JOIN projects p ON at.project_id = p.id
                WHERE at.task_source = 'queue' AND at.status = 'failed' AND p.user_id = ?
            `, [req.user.id]);
        }
        res.json({ message: `已清除 ${result.affectedRows} 条失败记录`, deletedCount: result.affectedRows });
    } catch (error) {
        console.error('清空失败记录失败:', error);
        res.status(500).json({ message: '清空失败记录失败' });
    }
});

// POST 版本（兼容代理问题）
router.post('/clear-failed', authenticateToken, async (req, res) => {
    try {
        const isAdmin = canMutateAllResources(req.user);
        let result;
        if (isAdmin) {
            [result] = await pool.execute(
                "DELETE FROM ai_tasks WHERE task_source = 'queue' AND status = 'failed'"
            );
        } else {
            [result] = await pool.execute(`
                DELETE at FROM ai_tasks at
                JOIN projects p ON at.project_id = p.id
                WHERE at.task_source = 'queue' AND at.status = 'failed' AND p.user_id = ?
            `, [req.user.id]);
        }
        res.json({ message: `已清除 ${result.affectedRows} 条失败记录`, deletedCount: result.affectedRows });
    } catch (error) {
        console.error('清空失败记录失败:', error);
        res.status(500).json({ message: '清空失败记录失败' });
    }
});

// 暂停单个任务
router.post('/:taskId(\\d+)/pause', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user.id;

        // 验证任务存在且用户有权限
        const [tasks] = await pool.execute(`
            SELECT t.*, p.user_id 
            FROM ai_tasks t
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?
        `, [taskId]);

        if (tasks.length === 0 || !canMutateResource(req.user, tasks[0].user_id)) {
            return res.status(404).json({ message: '任务不存在或无权限' });
        }

        const task = tasks[0];
        if (task.status !== 'pending' && task.status !== 'processing') {
            return res.status(400).json({ message: '只能暂停待处理或处理中任务' });
        }

        // 更新任务状态为暂停；如果是处理中，清空 started_at 方便重排与可视化
        if (task.status === 'processing') {
            await pool.execute(
                `UPDATE ai_tasks SET pause_requested = 1
                 WHERE id = ? AND status = 'processing' AND worker_id = ?`,
                [taskId, task.worker_id]
            );
        } else {
            await pool.execute(
                `UPDATE ai_tasks SET status = 'paused', paused_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'pending'`,
                [taskId]
            );
        }

        console.log(`✅ 任务已暂停: ${taskId}`);
        res.json({ message: '任务已暂停' });

    } catch (error) {
        console.error('暂停任务失败:', error);
        res.status(500).json({ message: '暂停任务失败' });
    }
});

// 恢复单个任务
router.post('/:taskId(\\d+)/resume', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user.id;

        // 验证任务存在且用户有权限
        const [tasks] = await pool.execute(`
            SELECT t.*, p.user_id 
            FROM ai_tasks t
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?
        `, [taskId]);

        if (tasks.length === 0 || !canMutateResource(req.user, tasks[0].user_id)) {
            return res.status(404).json({ message: '任务不存在或无权限' });
        }

        const task = tasks[0];
        if (task.status !== 'paused' && !(task.status === 'processing' && task.pause_requested)) {
            return res.status(400).json({ message: '只能恢复已暂停的任务' });
        }

        // 更新任务状态为待处理
        if (task.status === 'processing') {
            await pool.execute(
                `UPDATE ai_tasks SET pause_requested = 0
                 WHERE id = ? AND status = 'processing' AND worker_id = ?`,
                [taskId, task.worker_id]
            );
        } else {
            await pool.execute(
                `UPDATE ai_tasks SET status = 'pending', pause_requested = 0, paused_at = NULL,
                 available_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'paused'`,
                [taskId]
            );
        }

        console.log(`✅ 任务已恢复: ${taskId}`);
        res.json({ message: '任务已恢复' });

    } catch (error) {
        console.error('恢复任务失败:', error);
        res.status(500).json({ message: '恢复任务失败' });
    }
});

module.exports = router;
