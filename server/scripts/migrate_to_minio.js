// 直接设置数据库密码

const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('🔄 开始数据库迁移...');
        
        // 读取迁移SQL文件
        const migrationPath = path.join(__dirname, '../database/migrate_to_minio_safe.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        // 使用多语句查询执行整个SQL文件
        console.log(`📄 执行安全迁移脚本...`);
        
        try {
            // 创建一个支持多语句的连接
            const connection = await pool.getConnection();
            
            // 启用多语句执行
            await connection.query('SET SESSION sql_mode = ""');
            
            // 执行完整的SQL脚本
            const results = await connection.query(migrationSQL);
            
            console.log(`✅ 迁移脚本执行成功`);
            
            // 释放连接
            connection.release();
            
        } catch (error) {
            console.error(`❌ 迁移脚本执行失败:`, error.message);
            throw error;
        }
        
        console.log('✅ 数据库迁移完成！');
        
        // 验证迁移结果
        console.log('🔍 验证迁移结果...');
        
        // 检查 files 表的新字段
        const [filesColumns] = await pool.execute("SHOW COLUMNS FROM files LIKE 'minio_%'");
        console.log(`📁 files 表新增字段数量: ${filesColumns.length}`);
        
        // 检查 knowledge_base 表的新字段
        const [kbColumns] = await pool.execute("SHOW COLUMNS FROM knowledge_base LIKE 'minio_%'");
        console.log(`📚 knowledge_base 表新增字段数量: ${kbColumns.length}`);
        
        console.log('🎉 迁移验证完成！');
        
    } catch (error) {
        console.error('❌ 数据库迁移失败:', error);
        process.exit(1);
    } finally {
        // 关闭数据库连接
        await pool.end();
        console.log('🔌 数据库连接已关闭');
        process.exit(0);
    }
}

// 运行迁移
runMigration();
