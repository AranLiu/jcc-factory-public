const { pool } = require('../config/database');

async function addArchiveTitleField() {
    console.log('开始为full_scripts表添加archive_title字段...\n');
    
    try {
        // 检查是否已存在 archive_title 字段
        console.log('1️⃣ 检查archive_title字段是否已存在...');
        const [columns] = await pool.execute("SHOW COLUMNS FROM full_scripts LIKE 'archive_title'");
        
        if (columns.length > 0) {
            console.log('✅ archive_title字段已存在，无需添加');
            return;
        }

        // 添加 archive_title 字段
        console.log('2️⃣ 正在添加archive_title字段...');
        await pool.execute(`
            ALTER TABLE full_scripts 
            ADD COLUMN archive_title VARCHAR(255) DEFAULT NULL COMMENT '存档文档名称'
            AFTER review_notes
        `);
        console.log('✅ archive_title字段添加成功');

        // 添加索引
        console.log('3️⃣ 正在添加索引...');
        try {
            await pool.execute('CREATE INDEX idx_archive_title ON full_scripts(archive_title)');
            console.log('✅ 索引添加成功');
        } catch (error) {
            if (error.code === 'ER_DUP_KEYNAME') {
                console.log('✅ 索引已存在');
            } else {
                throw error;
            }
        }
        
        console.log('\n🎉 archive_title字段添加完成！');
        console.log('现在完整剧本可以保存用户自定义的存档文档名称了。');
        
    } catch (error) {
        console.error('❌ 迁移失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 运行迁移
addArchiveTitleField(); 