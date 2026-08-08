const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getTextGenerationService } = require('../services/textGenerationService');
const { getStep3CharacterSources } = require('../services/characterGraphSelection');

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

// 数字转中文函数
function numberToChinese(num) {
    if (num <= 0) return '';
    
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千'];
    
    if (num < 10) {
        return digits[num];
    } else if (num < 20) {
        return '十' + (num === 10 ? '' : digits[num - 10]);
    } else if (num < 100) {
        const tens = Math.floor(num / 10);
        const ones = num % 10;
        return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
    } else if (num < 1000) {
        const hundreds = Math.floor(num / 100);
        const remainder = num % 100;
        let result = digits[hundreds] + '百';
        
        if (remainder === 0) {
            return result;
        } else if (remainder < 10) {
            return result + '零' + digits[remainder];
        } else {
            return result + numberToChinese(remainder);
        }
    } else {
        // 处理千位及以上（一般不会用到，但保持完整性）
        const thousands = Math.floor(num / 1000);
        const remainder = num % 1000;
        let result = digits[thousands] + '千';
        
        if (remainder === 0) {
            return result;
        } else if (remainder < 100) {
            return result + '零' + numberToChinese(remainder);
        } else {
            return result + numberToChinese(remainder);
        }
    }
}

// 生成单元名称的函数（与前端保持一致）
function getUnitName(unitNumber, selectedEpisodes) {
    const unitName = numberToChinese(unitNumber);
    
    if (!selectedEpisodes || selectedEpisodes.length === 0) {
        return `${unitName}单元`;
    } else if (selectedEpisodes.length === 1) {
        return `${unitName}单元（${selectedEpisodes[0]}集）`;
    } else {
        const minEpisode = Math.min(...selectedEpisodes);
        const maxEpisode = Math.max(...selectedEpisodes);
        return `${unitName}单元（${minEpisode}-${maxEpisode}集）`;
    }
}

// 获取项目的所有单元
router.get('/:projectId', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userPermission = req.user.permission || 'personal';

        // 权限检查
        let sql, params;
        if (['global', 'readonly_global'].includes(userPermission) || req.user.role === 'admin') {
            sql = 'SELECT id FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);
        if (projects.length === 0) {
            return res.status(403).json({ message: '无权访问此项目' });
        }

        // 获取所有单元，按unit_order排序
        const [units] = await pool.execute(
            'SELECT * FROM script_units WHERE project_id = ? ORDER BY unit_order ASC',
            [projectId]
        );

        // 解析JSON字段
        const formattedUnits = units.map(unit => ({
            ...unit,
            selected_episodes: safeJsonParse(unit.selected_episodes, []),
            selected_file_ids: safeJsonParse(unit.selected_file_ids, []),
            selected_materials: safeJsonParse(unit.selected_materials, {})
        }));

        res.json({
            success: true,
            units: formattedUnits
        });

    } catch (error) {
        console.error('获取单元列表错误:', error);
        res.status(500).json({ success: false, message: '获取单元列表失败' });
    }
});

// 创建新单元
router.post('/:projectId', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { unitName, selectedEpisodes, selectedFileIds, draftContent, integrationPrompt } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = 'SELECT id FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);
        if (projects.length === 0) {
            return res.status(403).json({ message: '无权访问此项目' });
        }

        // 获取下一个单元序号
        const [maxOrder] = await pool.execute(
            'SELECT COALESCE(MAX(unit_order), 0) as max_order FROM script_units WHERE project_id = ?',
            [projectId]
        );
        const nextOrder = maxOrder[0].max_order + 1;

        // 创建新单元
        const [result] = await pool.execute(
            `INSERT INTO script_units 
             (project_id, unit_name, unit_order, selected_episodes, selected_file_ids, draft_content, integration_prompt) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                projectId,
                unitName,
                nextOrder,
                JSON.stringify(selectedEpisodes || []),
                JSON.stringify(selectedFileIds || []),
                draftContent || '',
                integrationPrompt || ''
            ]
        );

        // 返回创建的单元信息
        const [newUnit] = await pool.execute(
            'SELECT * FROM script_units WHERE id = ?',
            [result.insertId]
        );

        const formattedUnit = {
            ...newUnit[0],
            selected_episodes: safeJsonParse(newUnit[0].selected_episodes, []),
            selected_file_ids: safeJsonParse(newUnit[0].selected_file_ids, []),
            selected_materials: safeJsonParse(newUnit[0].selected_materials, {})
        };

        res.json({
            success: true,
            unit: formattedUnit,
            message: '单元创建成功'
        });

    } catch (error) {
        console.error('创建单元错误:', error);
        res.status(500).json({ success: false, message: '创建单元失败' });
    }
});

// 更新单元
router.put('/:unitId', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { 
            unitName, 
            selectedEpisodes, 
            selectedFileIds, 
            draftContent, 
            integrationResult, 
            integrationPrompt,
            // 新增：三步工作流字段
            contentIntegrationResult,
            characterIntegrationResult,
            enhancedContentIntegrationResult,
            characterGraphContent
        } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查 - 通过单元查找项目
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        // 更新单元
        const updateFields = [];
        const updateValues = [];

        if (unitName !== undefined) {
            updateFields.push('unit_name = ?');
            updateValues.push(unitName);
        }
        if (selectedEpisodes !== undefined) {
            updateFields.push('selected_episodes = ?');
            updateValues.push(JSON.stringify(selectedEpisodes));
        }
        if (selectedFileIds !== undefined) {
            updateFields.push('selected_file_ids = ?');
            updateValues.push(JSON.stringify(selectedFileIds));
        }
        
        // 如果同时更新了selectedEpisodes和selectedFileIds，也更新selected_materials字段以保持一致性
        if (selectedEpisodes !== undefined && selectedFileIds !== undefined) {
            const selectedMaterials = {
                selectedFileIds: selectedFileIds || [],
                selectedEpisodes: selectedEpisodes || [],
                includeCharacterGraph: false // 默认值
            };
            updateFields.push('selected_materials = ?');
            updateValues.push(JSON.stringify(selectedMaterials));
        }
        if (draftContent !== undefined) {
            updateFields.push('draft_content = ?');
            updateValues.push(draftContent);
        }
        if (integrationResult !== undefined) {
            updateFields.push('integration_result = ?');
            updateValues.push(integrationResult);
        }
        if (integrationPrompt !== undefined) {
            updateFields.push('integration_prompt = ?');
            updateValues.push(integrationPrompt);
        }
        // 新增：三步工作流字段
        if (contentIntegrationResult !== undefined) {
            updateFields.push('content_integration_result = ?');
            updateValues.push(contentIntegrationResult);
        }
        if (characterIntegrationResult !== undefined) {
            updateFields.push('character_integration_result = ?');
            updateValues.push(characterIntegrationResult);
        }
        if (enhancedContentIntegrationResult !== undefined) {
            updateFields.push('enhanced_content_integration_result = ?');
            updateValues.push(enhancedContentIntegrationResult);
        }
        if (characterGraphContent !== undefined) {
            updateFields.push('character_graph_content = ?');
            updateValues.push(characterGraphContent);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ message: '没有提供要更新的字段' });
        }

        updateValues.push(unitId);

        await pool.execute(
            `UPDATE script_units SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            updateValues
        );

        res.json({
            success: true,
            message: '单元更新成功'
        });

    } catch (error) {
        console.error('更新单元错误:', error);
        res.status(500).json({ success: false, message: '更新单元失败' });
    }
});

// 删除单元
router.delete('/:unitId', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const userPermission = req.user.permission || 'personal';

        // 权限检查 - 通过单元查找项目
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];

        // 删除单元
        await pool.execute('DELETE FROM script_units WHERE id = ?', [unitId]);

        // 重新排序剩余单元
        await pool.execute(`
            UPDATE script_units 
            SET unit_order = unit_order - 1 
            WHERE project_id = ? AND unit_order > ?
        `, [unit.project_id, unit.unit_order]);

        res.json({
            success: true,
            message: '单元删除成功'
        });

    } catch (error) {
        console.error('删除单元错误:', error);
        res.status(500).json({ success: false, message: '删除单元失败' });
    }
});

// 单元剧本整合接口
router.post('/:unitId/integrate', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { integrationPrompt, draftContent, modelConfig } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查，同时获取项目配置
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id, p.integration_prompt as project_integration_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id, p.integration_prompt as project_integration_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];

        // 使用单元草稿内容作为正文输入
        const contentToIntegrate = unit.draft_content || draftContent;
        if (!contentToIntegrate || !contentToIntegrate.trim()) {
            return res.status(400).json({ message: '素材区内容不能为空' });
        }

        // 获取剧本整合prompt，优先使用项目配置，如果没有则使用前端传入的，最后使用系统默认
        let finalIntegrationPrompt = integrationPrompt;
        
        if (unit.project_integration_prompt && unit.project_integration_prompt.trim()) {
            finalIntegrationPrompt = unit.project_integration_prompt;
            console.log('🎯 使用项目配置的剧本整合Prompt');
        } else if (integrationPrompt && integrationPrompt.trim()) {
            finalIntegrationPrompt = integrationPrompt;
            console.log('🎯 使用前端传入的剧本整合Prompt');
        } else {
            // 获取系统默认prompt
            const systemConfigService = require('../services/systemConfigService');
            const systemPrompt = await systemConfigService.getConfig('script_integration_prompt');
            if (systemPrompt) {
                finalIntegrationPrompt = systemPrompt;
                console.log('🎯 使用系统默认的剧本整合Prompt');
            } else {
                return res.status(400).json({ message: '找不到剧本整合提示词，请配置项目或系统默认Prompt' });
            }
        }

        console.log('📝 单元剧本整合配置:');
        console.log('   - 单元ID:', unitId);
        console.log('   - 模型配置:', modelConfig);
        console.log('   - 素材内容长度:', contentToIntegrate.length, '字符');
        console.log('   - Prompt长度:', finalIntegrationPrompt.length, '字符');

        // 调用AI服务进行整合
        const result = await getTextGenerationService().integrateScript(finalIntegrationPrompt, contentToIntegrate, modelConfig || {});

        // 更新单元的整合结果和使用的prompt
        await pool.execute(
            'UPDATE script_units SET integration_result = ?, integration_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [result.text, finalIntegrationPrompt, unitId]
        );

        res.json({
            success: true,
            integrationResult: result.text,
            message: '单元剧本整合成功'
        });

    } catch (error) {
        console.error('单元剧本整合错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '单元剧本整合失败'
        });
    }
});

// 添加新的三步工作流API接口

// 重置单元工作流
router.post('/:unitId/reset-workflow', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const userPermission = req.user.permission || 'personal';

        // 权限检查
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        // 重置工作流状态
        await pool.execute(`
            UPDATE script_units 
            SET step1_completed = FALSE,
                step2_completed = FALSE,
                step3_character_graph_completed = FALSE,
                step4_completed = FALSE,
                selected_materials = NULL,
                selected_character_graphs = NULL,
                draft_content = '',
                content_integration_result = NULL,
                character_graph_content = NULL,
                enhanced_content_integration_result = NULL,
                character_integration_result = NULL,
                content_integration_prompt = NULL,
                character_integration_prompt = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [unitId]);

        res.json({
            success: true,
            message: '单元工作流重置成功'
        });

    } catch (error) {
        console.error('重置单元工作流错误:', error);
        res.status(500).json({ success: false, message: '重置单元工作流失败' });
    }
});

// 步骤1：更新选择的素材
router.post('/:unitId/step1', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { selectedFileIds, selectedEpisodes, includeCharacterGraph, draftContent } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];
        
        // 生成新的单元名称（基于选择的集数）
        let newUnitName = unit.unit_name; // 默认保持原名称
        if (selectedEpisodes && selectedEpisodes.length > 0) {
            // 根据单元在项目中的序号生成名称
            const unitNumber = unit.unit_order || 1;
            newUnitName = getUnitName(unitNumber, selectedEpisodes);
        }

        // 更新素材信息和第一步完成状态
        const selectedMaterials = {
            selectedFileIds: selectedFileIds || [],
            selectedEpisodes: selectedEpisodes || [],
            includeCharacterGraph: includeCharacterGraph || false
        };

        await pool.execute(`
            UPDATE script_units 
            SET selected_materials = ?,
                draft_content = ?,
                unit_name = ?,
                step1_completed = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [JSON.stringify(selectedMaterials), draftContent || '', newUnitName, unitId]);

        res.json({
            success: true,
            message: '第一步（选择素材）完成'
        });

    } catch (error) {
        console.error('更新第一步错误:', error);
        res.status(500).json({ success: false, message: '更新第一步失败' });
    }
});

// 步骤2：内容整合
router.post('/:unitId/step2', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { contentIntegrationPrompt, modelConfig } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查，同时获取项目配置
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id, p.integration_prompt as project_integration_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id, p.integration_prompt as project_integration_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];

        // 检查第一步是否完成
        if (!unit.step1_completed) {
            return res.status(400).json({ message: '请先完成第一步（选择素材）' });
        }

        // 使用单元草稿内容作为输入
        const contentToIntegrate = unit.draft_content;
        if (!contentToIntegrate || !contentToIntegrate.trim()) {
            return res.status(400).json({ message: '素材区内容不能为空' });
        }

        // 获取内容整合prompt
        let finalPrompt = contentIntegrationPrompt;
        if (unit.project_integration_prompt && unit.project_integration_prompt.trim()) {
            finalPrompt = unit.project_integration_prompt;
        } else if (!finalPrompt || !finalPrompt.trim()) {
            const systemConfigService = require('../services/systemConfigService');
            const systemPrompt = await systemConfigService.getConfig('script_integration_prompt');
            if (systemPrompt) {
                finalPrompt = systemPrompt;
            } else {
                return res.status(400).json({ message: '找不到内容整合提示词' });
            }
        }

        // 调用AI服务进行内容整合
        const result = await getTextGenerationService().integrateScript(finalPrompt, contentToIntegrate, modelConfig || {});

        // 更新第二步结果和状态
        await pool.execute(`
            UPDATE script_units 
            SET content_integration_result = ?,
                content_integration_prompt = ?,
                step2_completed = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [result.text, finalPrompt, unitId]);

        res.json({
            success: true,
            result: result.text,
            message: '第二步（内容整合）完成'
        });

    } catch (error) {
        console.error('内容整合错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '内容整合失败'
        });
    }
});

// 步骤3：添加角色图谱
router.post('/:unitId/step3-character-graph', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { selectedEpisodeContent, selectedSegments } = req.body;
        const userPermission = req.user.permission || 'personal';

        console.log('🔧 [后端] 步骤3接收数据:', {
            unitId,
            selectedEpisodeContentLength: selectedEpisodeContent ? selectedEpisodeContent.length : 0,
            selectedSegments,
            requestBody: req.body
        });

        // 权限检查
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];

        // 检查第二步是否完成
        if (!unit.step2_completed) {
            return res.status(400).json({ message: '请先完成第二步（内容整合）' });
        }

        // 检查是否选择了集数片段
        if (!selectedEpisodeContent || !selectedEpisodeContent.trim()) {
            return res.status(400).json({ message: '请至少选择一个集数片段' });
        }

        // 直接使用选中的集数片段内容作为角色图谱内容
        const characterGraphContent = selectedEpisodeContent;

        // 将角色图谱内容添加到步骤2的结果后面
        const originalContent = unit.content_integration_result || '';
        const enhancedContent = originalContent + '\n\n---角色图谱---\n\n' + characterGraphContent;

        // 更新数据库
        await pool.execute(`
            UPDATE script_units 
            SET selected_character_graphs = ?,
                character_graph_content = ?,
                enhanced_content_integration_result = ?,
                step3_character_graph_completed = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            JSON.stringify(selectedSegments || []),
            characterGraphContent,
            enhancedContent,
            unitId
        ]);

        res.json({
            success: true,
            result: enhancedContent,
            message: '步骤3（添加角色图谱）完成'
        });

    } catch (error) {
        console.error('添加角色图谱错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '添加角色图谱失败'
        });
    }
});

// 获取项目的角色整合结果列表
router.get('/:unitId/character-integrations', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const userPermission = req.user.permission || 'personal';

        // 权限检查并获取项目ID
        let sql, params;
        if (['global', 'readonly_global'].includes(userPermission) || req.user.role === 'admin') {
            sql = `SELECT p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT p.id as project_id 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const projectId = units[0].project_id;

        const sources = await getStep3CharacterSources(pool, projectId);
        const results = sources.integrations;

        res.json({
            success: true,
            data: results,
            segments: sources.segments,
            message: sources.segments.length > 0 || results.length > 0
                ? '获取角色图谱候选成功'
                : '暂无角色图谱候选'
        });

    } catch (error) {
        console.error('获取角色整合结果错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取角色整合结果失败'
        });
    }
});

// 步骤4：角色整合
router.post('/:unitId/step4', authenticateToken, async (req, res) => {
    try {
        const { unitId } = req.params;
        const { characterPrompt, modelConfig } = req.body;
        const userPermission = req.user.permission || 'personal';

        // 权限检查，同时获取项目配置
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            sql = `SELECT su.*, p.id as project_id, p.character_prompt as project_character_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ?`;
            params = [unitId];
        } else {
            sql = `SELECT su.*, p.id as project_id, p.character_prompt as project_character_prompt 
                   FROM script_units su 
                   JOIN projects p ON su.project_id = p.id 
                   WHERE su.id = ? AND p.user_id = ?`;
            params = [unitId, req.user.id];
        }

        const [units] = await pool.execute(sql, params);
        if (units.length === 0) {
            return res.status(403).json({ message: '无权访问此单元' });
        }

        const unit = units[0];

        // 检查第二步是否完成
        if (!unit.step2_completed) {
            return res.status(400).json({ message: '请先完成第二步（内容整合）' });
        }

        // 优先使用增强后的内容整合结果（如果添加了角色图谱），否则使用原始的内容整合结果
        const contentToIntegrate = unit.enhanced_content_integration_result || unit.content_integration_result;
        if (!contentToIntegrate || !contentToIntegrate.trim()) {
            return res.status(400).json({ message: '内容整合结果不能为空' });
        }

        // 获取角色整合prompt
        let finalPrompt = characterPrompt;
        if (unit.project_character_prompt && unit.project_character_prompt.trim()) {
            finalPrompt = unit.project_character_prompt;
        } else if (!finalPrompt || !finalPrompt.trim()) {
            const systemConfigService = require('../services/systemConfigService');
            const systemPrompt = await systemConfigService.getConfig('character_prompt');
            if (systemPrompt) {
                finalPrompt = systemPrompt;
            } else {
                return res.status(400).json({ message: '找不到角色整合提示词' });
            }
        }

        // 调用AI服务进行角色整合 - 这里我们使用与角色图谱整合相同的接口
        const result = await getTextGenerationService().integrateScript(finalPrompt, contentToIntegrate, modelConfig || {});

        // 更新第三步结果和状态
        await pool.execute(`
            UPDATE script_units 
            SET character_integration_result = ?,
                character_integration_prompt = ?,
                step4_completed = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [result.text, finalPrompt, unitId]);

        res.json({
            success: true,
            result: result.text,
            message: '第三步（角色整合）完成'
        });

    } catch (error) {
        console.error('角色整合错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '角色整合失败'
        });
    }
});

module.exports = router;
