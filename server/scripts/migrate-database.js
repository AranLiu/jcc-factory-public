const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('开始数据库迁移...');
    
    try {
        // 读取迁移SQL文件
        const migrationSQL = fs.readFileSync(path.join(__dirname, '../database/migrate.sql'), 'utf8');
        
        // 分割SQL语句（以分号分隔）
        const statements = migrationSQL
            .split(';')
            .map(statement => statement.trim())
            .filter(statement => statement.length > 0 && !statement.startsWith('--'));
        
        // 执行每个SQL语句
        for (const statement of statements) {
            if (statement.toLowerCase().includes('use ')) {
                // 跳过USE语句，因为我们已经连接到正确的数据库
                continue;
            }
            
            try {
                console.log('执行:', statement.substring(0, 50) + '...'); 
                await pool.execute(statement);
                console.log('✅ 成功');
            } catch (error) {
                // 忽略"已存在"的错误
                if (error.code === 'ER_DUP_KEYNAME' || 
                    error.code === 'ER_TABLE_EXISTS_ERROR' ||
                    error.code === 'ER_DUP_FIELDNAME') {
                    console.log('⚠️ 跳过（已存在）:', error.message);
                } else {
                    throw error;
                }
            }
        }
        
        console.log('✅ 数据库迁移完成！');
        
    } catch (error) {
        console.error('❌ 数据库迁移失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 运行迁移
runMigration(); 