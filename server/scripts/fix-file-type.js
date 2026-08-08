const { pool } = require('../config/database');

async function fixFileTypeColumn() {
    console.log('修复 file_type 字段长度...\n');
    
    try {
        // 检查当前file_type字段长度
        console.log('当前 file_type 字段信息:');
        const [columns] = await pool.execute("DESCRIBE knowledge_base");
        const fileTypeColumn = columns.find(col => col.Field === 'file_type');
        console.log(fileTypeColumn);
        
        // 修改字段长度
        console.log('\n正在修改 file_type 字段长度到 VARCHAR(255)...');
        await pool.execute('ALTER TABLE knowledge_base MODIFY COLUMN file_type VARCHAR(255)');
        console.log('✅ file_type 字段修改成功');
        
        // 验证修改结果
        console.log('\n修改后的 file_type 字段信息:');
        const [newColumns] = await pool.execute("DESCRIBE knowledge_base");
        const newFileTypeColumn = newColumns.find(col => col.Field === 'file_type');
        console.log(newFileTypeColumn);
        
        console.log('\n✅ file_type 字段长度修复完成！');
        
    } catch (error) {
        console.error('❌ 修复失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

fixFileTypeColumn(); 