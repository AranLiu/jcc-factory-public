const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { validateDatabaseEnv } = require('../config/env');

async function runMigration() {
    const connection = await mysql.createConnection(validateDatabaseEnv(process.env));

    try {
        console.log('🔧 开始运行数据库迁移...');
        
        // 读取迁移SQL文件
        const migrationFile = path.join(__dirname, 'migration-add-last-modified-at.sql');
        const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
        
        // 执行迁移SQL（分割多个语句）
        const statements = migrationSQL
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
        
        for (const statement of statements) {
            if (statement.trim()) {
                console.log('执行SQL:', statement.substring(0, 100) + '...');
                await connection.execute(statement);
            }
        }
        
        console.log('✅ 数据库迁移完成！');
        console.log('📋 已为 knowledge_base 表添加 last_modified_at 字段');
        
    } catch (error) {
        console.error('❌ 迁移失败:', error.message);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    runMigration().catch(console.error);
}

module.exports = runMigration;
