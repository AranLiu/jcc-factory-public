const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { pool } = require('../config/database');

async function diagnoseKnowledgeBase() {
    console.log('🔍 开始诊断知识库文件问题...\n');
    
    try {
        // 1. 检查数据库连接
        console.log('1️⃣ 检查数据库连接...');
        await pool.execute('SELECT 1');
        console.log('✅ 数据库连接正常\n');

        // 2. 获取所有知识库条目
        console.log('2️⃣ 获取知识库条目...');
        const [entries] = await pool.execute(
            'SELECT id, title, file_path, file_type, file_size, content FROM knowledge_base ORDER BY id'
        );
        console.log(`📄 找到 ${entries.length} 个知识库条目\n`);

        // 3. 逐一检查每个条目
        let problemCount = 0;
        const problems = [];

        for (const entry of entries) {
            const { id, title, file_path, file_type, file_size, content } = entry;
            console.log(`🔍 检查条目 ${id}: ${title}`);
            
            const issue = await checkEntry(entry);
            if (issue) {
                problemCount++;
                problems.push({ id, title, issue });
                console.log(`❌ 发现问题: ${issue}`);
            } else {
                console.log(`✅ 正常`);
            }
            console.log('');
        }

        // 4. 报告总结
        console.log('📊 诊断总结:');
        console.log(`- 总条目数: ${entries.length}`);
        console.log(`- 有问题的条目: ${problemCount}`);
        console.log(`- 正常条目: ${entries.length - problemCount}`);

        if (problems.length > 0) {
            console.log('\n🚨 问题清单:');
            problems.forEach(({ id, title, issue }) => {
                console.log(`  - ID ${id} (${title}): ${issue}`);
            });
            
            console.log('\n💡 建议解决方案:');
            console.log('1. 运行修复脚本: node scripts/fix-corrupted-files.js');
            console.log('2. 手动重新上传有问题的文件');
            console.log('3. 检查文件系统权限');
        } else {
            console.log('\n🎉 所有文件都正常！');
        }

    } catch (error) {
        console.error('❌ 诊断过程中发生错误:', error);
    }
}

async function checkEntry(entry) {
    const { id, title, file_path, file_type, file_size, content } = entry;
    
    // 检查1: 文件路径
    if (!file_path) {
        if (!content) {
            return '没有文件路径且没有内容';
        }
        return null; // 有内容就是正常的
    }

    // 检查2: 文件是否存在
    const absolutePath = path.join(process.cwd(), file_path);
    if (!fs.existsSync(absolutePath)) {
        return '文件不存在于服务器';
    }

    // 检查3: 文件大小
    try {
        const stats = fs.statSync(absolutePath);
        if (stats.size === 0) {
            return '文件为空';
        }
        
        // 检查数据库记录的文件大小是否匹配
        if (file_size && Math.abs(stats.size - file_size) > 1000) {
            return `文件大小不匹配 (实际: ${stats.size}, 记录: ${file_size})`;
        }
    } catch (error) {
        return `无法获取文件信息: ${error.message}`;
    }

    // 检查4: 文件完整性
    try {
        if (file_type && (file_type.includes('wordprocessingml') || file_type.includes('msword'))) {
            // 检查DOCX文件
            await mammoth.extractRawText({ path: absolutePath });
        } else if (file_type === 'text/plain') {
            // 检查文本文件
            fs.readFileSync(absolutePath, 'utf8');
        }
    } catch (error) {
        if (error.message.includes('Corrupted zip')) {
            return '文件损坏 (ZIP结构错误)';
        } else if (error.message.includes('missing')) {
            return '文件不完整';
        } else {
            return `文件读取错误: ${error.message}`;
        }
    }

    return null; // 没有问题
}

// 如果直接运行此脚本
if (require.main === module) {
    diagnoseKnowledgeBase()
        .then(() => {
            console.log('\n✅ 诊断完成');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 诊断失败:', error);
            process.exit(1);
        });
}

module.exports = { diagnoseKnowledgeBase, checkEntry }; 