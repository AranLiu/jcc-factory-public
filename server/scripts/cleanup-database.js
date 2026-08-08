const { pool } = require('../config/database');

async function cleanupDatabase() {
    console.log('清理数据库多余字段...\n');
    
    try {
        // 检查是否存在多余的tags字段
        console.log('检查 knowledge_base 表中的 tags 字段...');
        const [columns] = await pool.execute("SHOW COLUMNS FROM knowledge_base LIKE 'tags'");
        
        if (columns.length > 0) {
            console.log('发现多余的 tags 字段，正在删除...');
            await pool.execute('ALTER TABLE knowledge_base DROP COLUMN tags');
            console.log('✅ 已删除多余的 tags 字段');
        } else {
            console.log('✅ 没有发现多余的 tags 字段');
        }
        
        // 检查user_id字段是否为NULL
        console.log('\n检查 user_id 字段约束...');
        const [kbColumns] = await pool.execute("DESCRIBE knowledge_base");
        const userIdColumn = kbColumns.find(col => col.Field === 'user_id');
        
        if (userIdColumn && userIdColumn.Null === 'YES') {
            console.log('user_id 字段允许NULL，正在修改为NOT NULL...');
            // 先更新现有的NULL值为默认用户ID 1
            await pool.execute('UPDATE knowledge_base SET user_id = 1 WHERE user_id IS NULL');
            // 然后修改字段约束
            await pool.execute('ALTER TABLE knowledge_base MODIFY COLUMN user_id INT NOT NULL');
            console.log('✅ user_id 字段约束已修改');
        } else {
            console.log('✅ user_id 字段约束正确');
        }
        
        console.log('\n✅ 数据库清理完成！');
        
    } catch (error) {
        console.error('❌ 清理失败:', error.message);
    } finally {
        await pool.end();
    }
}

cleanupDatabase(); 