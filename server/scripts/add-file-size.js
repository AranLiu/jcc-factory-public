const { pool } = require('../config/database');

async function addFileSizeColumn() {
    console.log('添加 file_size 字段到 knowledge_base 表...\n');
    
    try {
        // 检查是否已存在 file_size 字段
        console.log('检查 file_size 字段是否已存在...');
        const [columns] = await pool.execute("SHOW COLUMNS FROM knowledge_base LIKE 'file_size'");
        
        if (columns.length > 0) {
            console.log('✅ file_size 字段已存在');
            return;
        }

        // 添加 file_size 字段
        console.log('正在添加 file_size 字段...');
        await pool.execute('ALTER TABLE knowledge_base ADD COLUMN file_size BIGINT DEFAULT 0 AFTER file_type');
        console.log('✅ file_size 字段添加成功');
        
        console.log('\n✅ 文件大小字段添加完成！');
        
    } catch (error) {
        console.error('❌ 添加失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

addFileSizeColumn(); 