const { pool } = require('../config/database');

async function upgradeDatabase() {
    console.log('开始单元剧本添加角色图谱步骤数据库升级...\n');
    
    try {
        // 为script_units表添加角色图谱步骤相关字段
        console.log('正在为script_units表添加角色图谱步骤字段...');
        
        const fields = [
            {
                name: 'step2_character_graph_completed',
                sql: "ADD COLUMN step2_character_graph_completed BOOLEAN DEFAULT FALSE COMMENT '步骤2.5（添加角色图谱）完成状态'"
            },
            {
                name: 'selected_character_graphs',
                sql: "ADD COLUMN selected_character_graphs JSON COMMENT '选择的角色图谱信息'"
            },
            {
                name: 'character_graph_content',
                sql: "ADD COLUMN character_graph_content TEXT COMMENT '添加的角色图谱内容'"
            },
            {
                name: 'enhanced_content_integration_result',
                sql: "ADD COLUMN enhanced_content_integration_result TEXT COMMENT '添加角色图谱后的增强内容整合结果'"
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

        // 添加索引以提高查询性能
        console.log('\n正在添加索引...');
        try {
            const createIndexSql = `
                CREATE INDEX idx_character_graph_step 
                ON script_units(step2_character_graph_completed)
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

        console.log('\n🎉 单元剧本添加角色图谱步骤数据库升级完成！');
        
    } catch (error) {
        console.error('❌ 数据库升级失败:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 运行升级
upgradeDatabase(); 