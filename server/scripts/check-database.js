const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function checkDatabase() {
    console.log('🔍 检查知识库数据库状态...\n');
    
    try {
        // 1. 检查数据库连接
        console.log('1️⃣ 测试数据库连接...');
        await pool.execute('SELECT 1');
        console.log('✅ 数据库连接正常\n');

        // 2. 检查知识库表是否存在
        console.log('2️⃣ 检查知识库表结构...');
        const [tables] = await pool.execute("SHOW TABLES LIKE 'knowledge_base'");
        
        if (tables.length === 0) {
            console.log('❌ knowledge_base 表不存在');
            console.log('💡 请运行: mysql -u root -h 127.0.0.1 < server/database/init.sql');
            return;
        }
        
        console.log('✅ knowledge_base 表存在');

        // 3. 检查表结构
        const [columns] = await pool.execute('DESCRIBE knowledge_base');
        const requiredColumns = ['id', 'title', 'file_path', 'file_type', 'file_size', 'content', 'user_id'];
        const existingColumns = columns.map(col => col.Field);
        
        console.log('📋 现有字段:', existingColumns.join(', '));
        
        const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
        if (missingColumns.length > 0) {
            console.log('❌ 缺少字段:', missingColumns.join(', '));
        } else {
            console.log('✅ 表结构完整');
        }

        // 4. 检查数据统计
        console.log('\n3️⃣ 检查数据统计...');
        const [totalCount] = await pool.execute('SELECT COUNT(*) as total FROM knowledge_base');
        const [withFiles] = await pool.execute('SELECT COUNT(*) as count FROM knowledge_base WHERE file_path IS NOT NULL');
        const [withContent] = await pool.execute('SELECT COUNT(*) as count FROM knowledge_base WHERE content IS NOT NULL');
        const [orphaned] = await pool.execute('SELECT COUNT(*) as count FROM knowledge_base WHERE file_path IS NULL AND content IS NULL');
        
        console.log(`📊 数据统计:`);
        console.log(`- 总条目数: ${totalCount[0].total}`);
        console.log(`- 有文件路径: ${withFiles[0].count}`);
        console.log(`- 有内容: ${withContent[0].count}`);
        console.log(`- 孤儿条目 (无文件无内容): ${orphaned[0].count}`);

        // 5. 检查文件路径完整性
        console.log('\n4️⃣ 检查文件路径完整性...');
        const [fileEntries] = await pool.execute(
            'SELECT id, title, file_path FROM knowledge_base WHERE file_path IS NOT NULL'
        );
        
        let existingFiles = 0;
        let missingFiles = 0;
        const missingFilesList = [];
        
        for (const entry of fileEntries) {
            const absolutePath = path.join(process.cwd(), entry.file_path);
            if (fs.existsSync(absolutePath)) {
                existingFiles++;
            } else {
                missingFiles++;
                missingFilesList.push({ id: entry.id, title: entry.title, path: entry.file_path });
            }
        }
        
        console.log(`📁 文件检查结果:`);
        console.log(`- 存在的文件: ${existingFiles}`);
        console.log(`- 丢失的文件: ${missingFiles}`);
        
        if (missingFilesList.length > 0) {
            console.log('\n❌ 丢失的文件列表:');
            missingFilesList.forEach(({ id, title, path }) => {
                console.log(`  - ID ${id}: ${title} (${path})`);
            });
        }

        // 6. 检查用户权限
        console.log('\n5️⃣ 检查用户数据...');
        const [userStats] = await pool.execute(`
            SELECT 
                user_id,
                COUNT(*) as file_count
            FROM knowledge_base 
            GROUP BY user_id
            ORDER BY file_count DESC
        `);
        
        console.log('👥 用户文件统计:');
        userStats.forEach(({ user_id, file_count }) => {
            console.log(`  - 用户 ${user_id}: ${file_count} 个文件`);
        });

        console.log('\n✅ 数据库检查完成');
        
        if (missingFiles > 0 || orphaned[0].count > 0) {
            console.log('\n💡 建议操作:');
            if (missingFiles > 0) {
                console.log('1. 运行诊断脚本: node scripts/diagnose-knowledge-base.js');
                console.log('2. 运行修复脚本: node scripts/fix-corrupted-files.js');
            }
            if (orphaned[0].count > 0) {
                console.log('3. 清理孤儿条目: DELETE FROM knowledge_base WHERE file_path IS NULL AND content IS NULL');
            }
        }

    } catch (error) {
        console.error('❌ 数据库检查失败:', error);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    checkDatabase()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 检查失败:', error);
            process.exit(1);
        });
}

module.exports = { checkDatabase }; 