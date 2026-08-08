const mysql = require('mysql2/promise');
require('dotenv').config();
const { validateDatabaseEnv } = require('../config/env');

const pool = mysql.createPool({
    ...validateDatabaseEnv(process.env),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function upgradeDatabase() {
    try {
        console.log('🚀 开始执行角色知识图谱整合数据库升级...');

        // 1. 添加角色知识图谱整合Prompt到系统配置
        await pool.execute(`
            INSERT INTO system_config (config_key, config_value, config_type, description) 
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            config_value = VALUES(config_value),
            description = VALUES(description)
        `, [
            'character_integration_prompt',
            '请根据以下分集角色知识图谱，整合生成一个完整、连贯的全局角色关系图谱。要求：\n1. 合并相同角色在不同分集中的信息\n2. 理清角色之间的关系网络\n3. 分析角色发展轨迹\n4. 生成结构化的角色档案',
            'string',
            '角色知识图谱整合提示词'
        ]);
        console.log('✅ character_integration_prompt 系统配置添加完成');

        // 2. 为projects表添加character_integration_prompt字段
        try {
            await pool.execute(`
                ALTER TABLE projects ADD COLUMN character_integration_prompt TEXT COMMENT '项目级别的角色知识图谱整合提示词'
            `);
            console.log('✅ projects表character_integration_prompt字段添加完成');
        } catch (error) {
            if (error.code === 'ER_DUP_FIELDNAME') {
                console.log('⚠️  projects表character_integration_prompt字段已存在，跳过');
            } else {
                throw error;
            }
        }

        // 3. 检查ai_tasks表的task_type字段是否支持新类型
        const [rows] = await pool.execute(`
            SHOW COLUMNS FROM ai_tasks LIKE 'task_type'
        `);
        
        if (rows.length > 0) {
            const columnInfo = rows[0];
            console.log('📋 ai_tasks表task_type字段信息:', columnInfo.Type);
            
            // 如果是ENUM类型，检查是否包含character_integration
            if (columnInfo.Type.includes('enum') && !columnInfo.Type.includes('character_integration')) {
                console.log('🔧 更新ai_tasks表task_type字段以支持character_integration...');
                await pool.execute(`
                    ALTER TABLE ai_tasks MODIFY COLUMN task_type 
                    ENUM('video_analysis', 'character_graph', 'script_integration', 'character_integration') 
                    DEFAULT 'video_analysis' 
                    COMMENT 'AI任务类型'
                `);
                console.log('✅ ai_tasks表task_type字段更新完成');
            } else {
                console.log('✅ ai_tasks表task_type字段已支持character_integration');
            }
        }

        console.log('🎉 角色知识图谱整合数据库升级完成！');
    } catch (error) {
        console.error('❌ 数据库升级失败:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

upgradeDatabase();
