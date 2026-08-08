const { pool } = require('../config/database');

async function upgradeDatabase() {
    console.log('开始单元剧本三步工作流数据库升级...\n');
    
    try {
        // 为script_units表添加三步工作流字段 - 分别添加每个字段
        console.log('正在为script_units表添加三步工作流字段...');
        
        const fields = [
            {
                name: 'step1_completed',
                sql: "ADD COLUMN step1_completed BOOLEAN DEFAULT FALSE COMMENT '第一步（选择素材）完成状态'"
            },
            {
                name: 'step2_completed',
                sql: "ADD COLUMN step2_completed BOOLEAN DEFAULT FALSE COMMENT '第二步（内容整合）完成状态'"
            },
            {
                name: 'step3_completed',
                sql: "ADD COLUMN step3_completed BOOLEAN DEFAULT FALSE COMMENT '第三步（角色整合）完成状态'"
            },
            {
                name: 'selected_materials',
                sql: "ADD COLUMN selected_materials JSON COMMENT '选择的素材信息'"
            },
            {
                name: 'content_integration_result',
                sql: "ADD COLUMN content_integration_result TEXT COMMENT '内容整合结果'"
            },
            {
                name: 'character_integration_result',
                sql: "ADD COLUMN character_integration_result TEXT COMMENT '角色整合结果'"
            },
            {
                name: 'content_integration_prompt',
                sql: "ADD COLUMN content_integration_prompt TEXT COMMENT '内容整合Prompt'"
            },
            {
                name: 'character_integration_prompt',
                sql: "ADD COLUMN character_integration_prompt TEXT COMMENT '角色整合Prompt'"
            }
        ];
        
        for (const field of fields) {
            try {
                await pool.execute(`ALTER TABLE script_units ${field.sql}`);
                console.log(`✅ 字段 ${field.name} 添加成功`);
            } catch (error) {
                if (error.code === 'ER_DUP_FIELDNAME') {
                    console.log(`✅ 字段 ${field.name} 已存在`);
                } else {
                    throw error;
                }
            }
        }

        // 为现有数据设置默认值
        console.log('\n正在为现有数据设置默认值...');
        
        // 如果已有draft_content，则认为第一步已完成
        const updateStep1Sql = `
            UPDATE script_units 
            SET step1_completed = TRUE, 
                selected_materials = JSON_OBJECT(
                    'selectedFileIds', IFNULL(selected_file_ids, '[]'),
                    'selectedEpisodes', IFNULL(selected_episodes, '[]'),
                    'includeCharacterGraph', FALSE
                )
            WHERE (draft_content IS NOT NULL AND draft_content != '') 
              AND step1_completed = FALSE
        `;
        
        const [result1] = await pool.execute(updateStep1Sql);
        console.log(`✅ ${result1.affectedRows} 个单元的第一步状态已更新`);

        // 如果已有integration_result，则认为第二步已完成，并将原结果迁移到content_integration_result
        const updateStep2Sql = `
            UPDATE script_units 
            SET step2_completed = TRUE,
                content_integration_result = integration_result,
                content_integration_prompt = IFNULL(integration_prompt, '')
            WHERE (integration_result IS NOT NULL AND integration_result != '') 
              AND step2_completed = FALSE
        `;
        
        const [result2] = await pool.execute(updateStep2Sql);
        console.log(`✅ ${result2.affectedRows} 个单元的第二步状态已更新`);

        // 添加索引以提高查询性能
        console.log('\n正在添加索引...');
        try {
            const createIndexSql = `
                CREATE INDEX idx_step_status 
                ON script_units(step1_completed, step2_completed, step3_completed)
            `;
            await pool.execute(createIndexSql);
            console.log('✅ 索引添加成功');
        } catch (error) {
            if (error.code === 'ER_DUP_KEYNAME') {
                console.log('✅ 索引已存在');
            } else {
                throw error;
            }
        }

        console.log('\n🎉 单元剧本三步工作流数据库升级完成！');
        
    } catch (error) {
        console.error('❌ 数据库升级失败:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 运行升级
upgradeDatabase(); 