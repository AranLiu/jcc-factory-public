const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');

// 安全的JSON解析函数
function safeJsonParse(jsonString, defaultValue = []) {
    // 处理null、undefined、非字符串类型
    if (!jsonString || typeof jsonString !== 'string' || jsonString.trim() === '') {
        return defaultValue;
    }
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.warn('JSON解析失败:', error.message, '原始值:', jsonString);
        return defaultValue;
    }
}

// 获取项目的完整剧本
router.get('/:projectId', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { id: userId, role, permission } = req.user;

        // 权限检查
        if (!['global', 'readonly_global'].includes(permission) && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 获取完整剧本
        const [fullScripts] = await pool.execute(
            'SELECT * FROM full_scripts WHERE project_id = ? ORDER BY created_at DESC',
            [projectId]
        );

        // 解析JSON字段
        const formattedScripts = fullScripts.map(script => ({
            ...script,
            selected_unit_ids: safeJsonParse(script.selected_unit_ids, [])
        }));

        res.json(formattedScripts);
    } catch (error) {
        console.error('获取完整剧本列表错误:', error);
        res.status(500).json({ error: '获取完整剧本失败' });
    }
});

// 创建新的完整剧本工作流
router.post('/:projectId', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { scriptName = '完整剧本' } = req.body;
        const { id: userId, role, permission } = req.user;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 检查是否已存在未完成的完整剧本
        const [existingScripts] = await pool.execute(
            'SELECT * FROM full_scripts WHERE project_id = ? AND step_3_completed = 0',
            [projectId]
        );

        if (existingScripts.length > 0) {
            return res.status(400).json({ error: '项目中已存在未完成的完整剧本，请先完成或删除现有的完整剧本' });
        }

        // 创建新的完整剧本
        const [result] = await pool.execute(
            'INSERT INTO full_scripts (project_id, script_name, current_step, step_1_completed, step_2_completed, step_3_completed) VALUES (?, ?, 1, 0, 0, 0)',
            [projectId, scriptName]
        );

        // 获取创建的完整剧本
        const [newScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [result.insertId]
        );

        const formattedScript = {
            ...newScript[0],
            selected_unit_ids: safeJsonParse(newScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('创建完整剧本错误:', error);
        res.status(500).json({ error: '创建完整剧本失败' });
    }
});

// 步骤1：单元剧本拼接
router.put('/:scriptId/step1', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { selectedUnitIds } = req.body;
        const { id: userId, role, permission } = req.user;

        if (!selectedUnitIds || !Array.isArray(selectedUnitIds) || selectedUnitIds.length === 0) {
            return res.status(400).json({ error: '请选择要拼接的单元剧本' });
        }

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 获取选中的单元剧本内容，按unit_order排序
        const [units] = await pool.execute(
            `SELECT id, unit_name, unit_order, 
                    character_integration_result, 
                    content_integration_result, 
                    integration_result 
             FROM script_units 
             WHERE project_id = ? AND id IN (${selectedUnitIds.map(() => '?').join(',')}) 
             ORDER BY unit_order ASC`,
            [projectId, ...selectedUnitIds]
        );

        if (units.length === 0) {
            return res.status(400).json({ error: '未找到有效的单元剧本' });
        }

        // 检查是否所有单元都有剧本内容，并获取最佳内容
        const unitsWithoutContent = [];
        const unitsWithContent = units.map(unit => {
            // 优先级：character_integration_result > content_integration_result > integration_result
            let finalContent = '';
            let contentType = '';
            
            if (unit.character_integration_result && unit.character_integration_result.trim()) {
                finalContent = unit.character_integration_result;
                contentType = '角色整合结果';
            } else if (unit.content_integration_result && unit.content_integration_result.trim()) {
                finalContent = unit.content_integration_result;
                contentType = '内容整合结果';
            } else if (unit.integration_result && unit.integration_result.trim()) {
                finalContent = unit.integration_result;
                contentType = '剧本整合结果';
            } else {
                unitsWithoutContent.push(unit);
                return null;
            }
            
            return {
                ...unit,
                final_content: finalContent,
                content_type: contentType
            };
        }).filter(Boolean);

        if (unitsWithoutContent.length > 0) {
            return res.status(400).json({ 
                error: `以下单元尚未生成剧本内容：${unitsWithoutContent.map(u => u.unit_name).join(', ')}` 
            });
        }

        // 拼接单元剧本内容（直接拼接内容，不添加格式化抬头）
        const concatenatedContent = unitsWithContent.map(unit => {
            return unit.final_content;
        }).join('\n\n');

        // 更新完整剧本
        await pool.execute(
            `UPDATE full_scripts 
             SET selected_unit_ids = ?, 
                 concatenated_content = ?, 
                 current_step = 2, 
                 step_1_completed = 1 
             WHERE id = ?`,
            [JSON.stringify(selectedUnitIds), concatenatedContent, scriptId]
        );

        // 返回更新后的完整剧本
        const [updatedScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [scriptId]
        );

        const formattedScript = {
            ...updatedScript[0],
            selected_unit_ids: safeJsonParse(updatedScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('单元剧本拼接错误:', error);
        res.status(500).json({ error: '单元剧本拼接失败' });
    }
});

// 一键拼接：直接持久化拼接结果并进入步骤2
router.put('/:scriptId/quick-concat', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { content } = req.body;
        const { id: userId, role, permission } = req.user;

        if (!content || typeof content !== 'string' || content.trim() === '') {
            return res.status(400).json({ error: '拼接内容不能为空' });
        }

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 更新拼接结果并推进到步骤2
        await pool.execute(
            `UPDATE full_scripts 
             SET concatenated_content = ?, 
                 current_step = 2, 
                 step_1_completed = 1 
             WHERE id = ?`,
            [content, scriptId]
        );

        // 返回更新后的完整剧本
        const [updatedScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [scriptId]
        );

        const formattedScript = {
            ...updatedScript[0],
            selected_unit_ids: safeJsonParse(updatedScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('一键拼接持久化错误:', error);
        res.status(500).json({ error: '一键拼接持久化失败' });
    }
});

// 步骤2：全剧本审核
router.put('/:scriptId/step2', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { reviewedContent, reviewNotes = '' } = req.body;
        const { id: userId, role, permission } = req.user;

        if (!reviewedContent || reviewedContent.trim() === '') {
            return res.status(400).json({ error: '审核后的剧本内容不能为空' });
        }

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 检查步骤1是否已完成
        if (!script.step_1_completed) {
            return res.status(400).json({ error: '请先完成单元剧本拼接' });
        }

        // 更新完整剧本 - 确认审核时重置知识库存档状态
        await pool.execute(
            `UPDATE full_scripts 
             SET reviewed_content = ?, 
                 review_notes = ?, 
                 current_step = 3, 
                 step_2_completed = 1,
                 step_3_completed = 0,
                 archive_title = NULL
             WHERE id = ?`,
            [reviewedContent, reviewNotes, scriptId]
        );

        // 返回更新后的完整剧本
        const [updatedScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [scriptId]
        );

        const formattedScript = {
            ...updatedScript[0],
            selected_unit_ids: safeJsonParse(updatedScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('全剧本审核错误:', error);
        res.status(500).json({ error: '全剧本审核失败' });
    }
});

// 保存步骤2审核内容草稿（不推进步骤，允许内容为空）
router.put('/:scriptId/reviewed-draft', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { reviewedContent = '' } = req.body;
        const { id: userId, role, permission } = req.user;

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 保存审核内容草稿（不改变任何步骤状态）
        await pool.execute(
            `UPDATE full_scripts 
             SET reviewed_content = ?
             WHERE id = ?`,
            [reviewedContent, scriptId]
        );

        // 返回更新后的完整剧本
        const [updatedScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [scriptId]
        );

        const formattedScript = {
            ...updatedScript[0],
            selected_unit_ids: safeJsonParse(updatedScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('保存审核草稿错误:', error);
        res.status(500).json({ error: '保存审核草稿失败' });
    }
});

// 步骤3：知识库存档
router.put('/:scriptId/step3', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { archiveTitle } = req.body; // 获取前端传递的存档标题
        const { id: userId, role, permission } = req.user;

        // 验证存档标题
        if (!archiveTitle || !archiveTitle.trim()) {
            return res.status(400).json({ error: '存档文档名称不能为空' });
        }

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id, p.name as project_name FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;
        const projectName = script.project_name;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 检查步骤2是否已完成
        if (!script.step_2_completed) {
            return res.status(400).json({ error: '请先完成全剧本审核' });
        }

        // 使用用户提供的存档标题，确保以.docx结尾
        const finalArchiveTitle = archiveTitle.trim().endsWith('.docx') ? 
            archiveTitle.trim() : `${archiveTitle.trim()}.docx`;
        
        const knowledgeContent = script.reviewed_content || script.concatenated_content || '暂无内容';

        // 验证必要参数
        if (!projectId || !userId) {
            return res.status(400).json({ error: '项目ID或用户ID无效' });
        }

        console.log('存档参数验证:', {
            projectId,
            userId, 
            knowledgeTitle: finalArchiveTitle,
            contentLength: knowledgeContent ? knowledgeContent.length : 0
        });

        // 调用知识库存档API，生成真正的DOCX文件
        try {
            const internalPort = Number(process.env.PORT || 8080);
            const archiveResponse = await axios.post(`http://127.0.0.1:${internalPort}/api/knowledge-base/archive`, {
                title: finalArchiveTitle.replace('.docx', ''), // 知识库API会自动添加.docx
                content: knowledgeContent,
                projectId: projectId
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': req.headers.cookie,
                    'Origin': req.headers.origin,
                    'X-CSRF-Token': req.headers['x-csrf-token']
                },
                timeout: 30_000,
                maxBodyLength: 10 * 1024 * 1024,
                maxContentLength: 2 * 1024 * 1024
            });

            console.log('✅ 知识库存档API调用成功');
        } catch (archiveError) {
            console.error('调用知识库存档API失败:', archiveError.response?.data || archiveError.message);
            return res.status(500).json({ 
                error: '存档到知识库失败'
            });
        }

        // 更新完整剧本状态，同时保存存档标题
        await pool.execute(
            `UPDATE full_scripts 
             SET current_step = 3, 
                 step_3_completed = 1,
                 archive_title = ?
             WHERE id = ?`,
            [archiveTitle.trim(), scriptId]
        );

        // 返回更新后的完整剧本
        const [updatedScript] = await pool.execute(
            'SELECT * FROM full_scripts WHERE id = ?',
            [scriptId]
        );

        const formattedScript = {
            ...updatedScript[0],
            selected_unit_ids: safeJsonParse(updatedScript[0].selected_unit_ids, [])
        };

        res.json(formattedScript);
    } catch (error) {
        console.error('知识库存档错误:', error);
        res.status(500).json({ error: '知识库存档失败' });
    }
});

// 删除完整剧本
router.delete('/:scriptId', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { id: userId, role, permission } = req.user;

        // 获取完整剧本信息并检查权限
        const [scripts] = await pool.execute(
            'SELECT fs.*, p.id as project_id FROM full_scripts fs JOIN projects p ON fs.project_id = p.id WHERE fs.id = ?',
            [scriptId]
        );

        if (scripts.length === 0) {
            return res.status(404).json({ error: '完整剧本不存在' });
        }

        const script = scripts[0];
        const projectId = script.project_id;

        // 权限检查
        if (permission !== 'global' && role !== 'admin') {
            const [projectAccess] = await pool.execute(
                'SELECT id FROM projects WHERE id = ? AND user_id = ?',
                [projectId, userId]
            );
            if (projectAccess.length === 0) {
                return res.status(403).json({ error: '没有访问该项目的权限' });
            }
        }

        // 删除完整剧本
        await pool.execute('DELETE FROM full_scripts WHERE id = ?', [scriptId]);

        res.json({ message: '完整剧本删除成功' });
    } catch (error) {
        console.error('删除完整剧本错误:', error);
        res.status(500).json({ error: '删除完整剧本失败' });
    }
});

module.exports = router;
