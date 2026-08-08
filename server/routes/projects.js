const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const minioService = require('../services/minioService');
const { deleteStoredObjects } = require('../services/objectDeletionService');

const router = express.Router();

// 状态映射：DB ↔ UI
function mapDbToUiStatus(dbStatus) {
    const map = {
        created: 'not_started',
        processing: 'in_progress',
        completed: 'completed',
        failed: 'not_started',
        '': 'not_started',
        null: 'not_started',
        undefined: 'not_started'
    };
    return map.hasOwnProperty(dbStatus) ? map[dbStatus] : 'not_started';
}

function mapUiToDbStatus(uiStatus) {
    const map = {
        not_started: 'created',
        in_progress: 'processing',
        completed: 'completed'
    };
    return map[uiStatus] || 'created';
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

// 辅助函数：为相对路径生成完整的URL，并处理Windows路径
const getFullUrl = (req, filePath) => {
  if (!filePath) return null;
  // 如果路径已经是完整的URL，则直接返回
  if (filePath.startsWith('http')) return filePath;
  // 将所有反斜杠（Windows）替换为正斜杠（URL）
  const normalizedPath = filePath.replace(/\\/g, '/');
  return `${req.protocol}://${req.get('host')}/${normalizedPath}`;
};

// 所有路由都需要认证
router.use(authenticateToken);

// 获取项目列表
router.get('/', async (req, res) => {
    try {
        let sql, params;
        const { ownerId, status } = req.query;
        const allowedStatus = new Set(['not_started', 'in_progress', 'completed']);
        
        // 调试日志
        console.log('用户权限信息:', {
            id: req.user.id,
            username: req.user.username,
            permission: req.user.permission,
            role: req.user.role
        });
        
        // 根据用户权限决定查询范围（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限或管理员：查看所有项目，并显示项目所有者
            sql = `SELECT p.id, p.name, p.type, p.status, p.created_at, p.description, p.last_operation_at,
                          u.username as last_operator_name,
                          owner.username as owner_name,
                          p.user_id,
                          (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) as file_count 
                   FROM projects p 
                   LEFT JOIN users u ON p.last_operator_id = u.id
                   LEFT JOIN users owner ON p.user_id = owner.id
                   WHERE 1=1`;
            params = [];
            if (ownerId) {
                sql += ` AND p.user_id = ?`;
                params.push(ownerId);
            }
            if (status && allowedStatus.has(status)) {
                sql += ` AND p.status = ?`;
                params.push(mapUiToDbStatus(status));
            }
            sql += ' ORDER BY p.last_operation_at DESC';
        } else {
            // 个人权限：只查看自己的项目
            sql = `SELECT p.id, p.name, p.type, p.status, p.created_at, p.description, p.last_operation_at,
                          u.username as last_operator_name,
                          p.user_id,
                          (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) as file_count 
                   FROM projects p 
                   LEFT JOIN users u ON p.last_operator_id = u.id
                   WHERE p.user_id = ?`;
            params = [req.user.id];
            if (status && allowedStatus.has(status)) {
                sql += ` AND p.status = ?`;
                params.push(mapUiToDbStatus(status));
            }
            sql += ' ORDER BY p.last_operation_at DESC';
        }
        
        const [projects] = await pool.execute(sql, params);
        const projectsWithUiStatus = projects.map(p => ({
            ...p,
            status: mapDbToUiStatus(p.status)
        }));
        res.json({ projects: projectsWithUiStatus });
    } catch (error) {
        console.error('获取项目列表错误:', error);
        res.status(500).json({ message: '获取项目列表失败' });
    }
});

// 获取单个项目详情
router.get('/:id', async (req, res) => {
    try {
        const projectId = req.params.id;

        let sql, params;
        
        // 根据用户权限决定查询条件（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';
        
        if (userPermission === 'global' || userPermission === 'readonly_global' || req.user.role === 'admin') {
            // 全局权限或管理员：可以访问任何项目
            sql = 'SELECT * FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // 个人权限：只能访问自己的项目
            sql = 'SELECT * FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);

        if (projects.length === 0) {
            return res.status(404).json({ message: '项目不存在或无权访问' });
        }
        
        const projectData = projects[0];

        // 获取项目文件
        const [files] = await pool.execute(
            'SELECT * FROM files WHERE project_id = ? ORDER BY uploaded_at DESC',
            [projectId]
        );

        const filesWithFullUrl = files.map(file => ({
            ...file,
            file_path: getFullUrl(req, file.file_path),
            thumbnail_path: getFullUrl(req, file.thumbnail_path),
        }));

        // 获取AI任务
        const [tasks] = await pool.execute(
            'SELECT * FROM ai_tasks WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );

        res.json({
            project: projectData,
            files: filesWithFullUrl,
            tasks
        });
    } catch (error) {
        console.error('获取项目详情错误:', error);
        res.status(500).json({ message: '获取项目详情失败' });
    }
});

// 创建新项目
router.post('/', async (req, res) => {
    const { name, type, description, status } = req.body;
    if (!name || !type) {
        return res.status(400).json({ message: '项目名称和类型是必需的' });
    }
    const allowedStatus = new Set(['not_started', 'in_progress', 'completed']);
    const finalStatus = allowedStatus.has(status) ? status : 'not_started';
    const dbStatus = mapUiToDbStatus(finalStatus);
    
    try {
        const [result] = await pool.execute(
            'INSERT INTO projects (name, type, status, description, user_id) VALUES (?, ?, ?, ?, ?)',
            [name, type, dbStatus, description || null, req.user.id]
        );
        res.status(201).json({ id: result.insertId, name, type, status: finalStatus, description });
    } catch (error) {
        console.error('创建项目错误:', error);
        res.status(500).json({ message: '创建项目失败' });
    }
});

// 新增：更新项目配置（prompts）
router.put('/:id/prompts', async (req, res) => {
    const { id } = req.params;
    const { analysis_prompt, integration_prompt } = req.body;

    try {
        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';
        
        // 验证项目权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 全局权限或管理员：可以修改任何项目
            sql = 'SELECT id, user_id FROM projects WHERE id = ?';
            params = [id];
        } else {
            // personal和readonly_global权限：只能修改自己的项目
            sql = 'SELECT id, user_id FROM projects WHERE id = ? AND user_id = ?';
            params = [id, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);
        if (projects.length === 0) {
            return res.status(404).json({ message: '项目不存在或无权访问' });
        }

        await pool.execute(
            'UPDATE projects SET analysis_prompt = ?, integration_prompt = ? WHERE id = ?',
            [analysis_prompt, integration_prompt, id]
        );
        
        // 更新最后操作时间
        await updateProjectLastOperation(id, req.user.id);
        
        res.json({ message: '项目配置更新成功' });
    } catch (error) {
        console.error('更新项目配置错误:', error);
        res.status(500).json({ message: '更新项目配置失败' });
    }
});

// 更新项目
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, analysis_prompt, integration_prompt, character_knowledge_graph_prompt, character_integration_prompt, character_prompt, status } = req.body;

    try {
        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 更新前状态记录（便于排查）
        try {
            const [beforeRows] = await pool.execute('SELECT status FROM projects WHERE id = ?', [id]);
            console.log('项目状态更新请求:', { id, incomingStatus: status, beforeStatus: beforeRows?.[0]?.status || null });
        } catch (e) {
            console.warn('查询更新前状态失败:', e.message);
        }

        // 准备更新的字段和值
        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description);
        }
        if (analysis_prompt !== undefined) {
            updates.push('analysis_prompt = ?');
            values.push(analysis_prompt);
        }
        if (integration_prompt !== undefined) {
            updates.push('integration_prompt = ?');
            values.push(integration_prompt);
        }
        if (character_knowledge_graph_prompt !== undefined) {
            updates.push('character_knowledge_graph_prompt = ?');
            values.push(character_knowledge_graph_prompt);
        }
        if (character_integration_prompt !== undefined) {
            updates.push('character_integration_prompt = ?');
            values.push(character_integration_prompt);
        }
        if (character_prompt !== undefined) {
            updates.push('character_prompt = ?');
            values.push(character_prompt);
        }
        if (status !== undefined) {
            const allowedStatus = new Set(['not_started', 'in_progress', 'completed']);
            if (!allowedStatus.has(status)) {
                return res.status(400).json({ message: '无效的项目状态' });
            }
            updates.push('status = ?');
            values.push(mapUiToDbStatus(status));
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: '没有提供要更新的字段' });
        }

        // 根据权限设置WHERE条件
        let whereClause, whereParams;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 全局权限或管理员：可以修改任何项目
            whereClause = 'WHERE id = ?';
            whereParams = [id];
        } else {
            // personal和readonly_global权限：只能修改自己的项目
            whereClause = 'WHERE id = ? AND user_id = ?';
            whereParams = [id, req.user.id];
        }

        values.push(...whereParams);

        const sql = `UPDATE projects SET ${updates.join(', ')} ${whereClause}`;
        const [result] = await pool.execute(sql, values);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: '项目不存在或无权更新' });
        }

        // 更新最后操作时间
        await updateProjectLastOperation(id, req.user.id);

        // 读取更新后的状态，记录日志
        try {
            const [afterRows] = await pool.execute('SELECT status FROM projects WHERE id = ?', [id]);
            console.log('项目状态更新完成:', { id, afterStatus: afterRows?.[0]?.status || null });
        } catch (e) {
            console.warn('查询更新后状态失败:', e.message);
        }

        res.json({ message: '项目更新成功' });
    } catch (error) {
        console.error('更新项目错误:', error);
        res.status(500).json({ message: '更新项目失败' });
    }
});

// 删除项目
router.delete('/:id', async (req, res) => {
    let connection;
    let transactionActive = false;
    try {
        const projectId = req.params.id;
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionActive = true;

        // 权限检查（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';

        // 验证项目权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 全局权限或管理员：可以删除任何项目
            sql = 'SELECT id FROM projects WHERE id = ? FOR UPDATE';
            params = [projectId];
        } else {
            // personal和readonly_global权限：只能删除自己的项目
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE';
            params = [projectId, req.user.id];
        }

        const [projects] = await connection.execute(sql, params);

        if (projects.length === 0) {
            await connection.rollback();
            transactionActive = false;
            return res.status(404).json({ message: '项目不存在或无权删除' });
        }

        const [projectFiles] = await connection.execute(
            `SELECT storage_type, minio_bucket, minio_object_name,
                    minio_thumbnail_bucket, minio_thumbnail_object
             FROM files WHERE project_id = ? FOR UPDATE`,
            [projectId]
        );
        if (projectFiles.some(file => file.storage_type !== 'minio')) {
            await connection.rollback();
            transactionActive = false;
            return res.status(409).json({ message: 'Legacy local files must be migrated before project deletion' });
        }
        if (projectFiles.some(file => (
            !file.minio_bucket ||
            !file.minio_object_name ||
            Boolean(file.minio_thumbnail_bucket) !== Boolean(file.minio_thumbnail_object)
        ))) {
            await connection.rollback();
            transactionActive = false;
            return res.status(409).json({ message: 'Object storage metadata is incomplete' });
        }

        const objectTargets = projectFiles.flatMap(file => [
            { bucket: file.minio_bucket, object: file.minio_object_name },
            { bucket: file.minio_thumbnail_bucket, object: file.minio_thumbnail_object }
        ]);
        await deleteStoredObjects(minioService, objectTargets);

        // 删除项目（相关文件和任务会通过外键约束自动删除）
        await connection.execute('DELETE FROM projects WHERE id = ?', [projectId]);
        await connection.commit();
        transactionActive = false;

        res.json({ message: '项目删除成功' });
    } catch (error) {
        if (transactionActive && connection) {
            try {
                await connection.rollback();
            } catch {
                // Preserve the original deletion error.
            }
        }
        console.error('删除项目错误:', error);
        const status = error.code === 'OBJECT_STORAGE_DELETE_FAILED' ? 502 : 500;
        res.status(status).json({ message: '删除项目失败' });
    } finally {
        connection?.release();
    }
});

module.exports = router;
