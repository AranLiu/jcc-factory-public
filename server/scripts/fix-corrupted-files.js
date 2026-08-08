const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { pool } = require('../config/database');

async function checkAndFixCorruptedFiles() {
    console.log('开始检查知识库中的损坏文件...');
    
    try {
        // 获取所有知识库条目
        const [entries] = await pool.execute(
            'SELECT id, title, file_path, file_type, content FROM knowledge_base WHERE file_path IS NOT NULL'
        );

        console.log(`共找到 ${entries.length} 个文件需要检查`);

        for (const entry of entries) {
            const { id, title, file_path, file_type, content } = entry;
            console.log(`\n检查文件: ${title} (ID: ${id})`);
            
            const absolutePath = path.join(process.cwd(), file_path);
            
            // 检查文件是否存在
            if (!fs.existsSync(absolutePath)) {
                console.log(`❌ 文件不存在: ${absolutePath}`);
                continue;
            }

            // 检查DOCX文件的完整性
            if (file_type && (file_type.includes('wordprocessingml') || file_type.includes('msword'))) {
                try {
                    await mammoth.extractRawText({ path: absolutePath });
                    console.log(`✅ 文件完整: ${title}`);
                } catch (error) {
                    console.log(`❌ 文件损坏: ${title} - ${error.message}`);
                    
                    // 尝试修复文件
                    await fixCorruptedFile(id, title, absolutePath, file_type, content);
                }
            } else if (file_type === 'text/plain') {
                try {
                    fs.readFileSync(absolutePath, 'utf8');
                    console.log(`✅ 文件完整: ${title}`);
                } catch (error) {
                    console.log(`❌ 文件损坏: ${title} - ${error.message}`);
                    
                    // 尝试修复文件
                    await fixCorruptedFile(id, title, absolutePath, file_type, content);
                }
            }
        }

        console.log('\n文件检查完成！');
        
    } catch (error) {
        console.error('检查过程中发生错误:', error);
    }
}

async function fixCorruptedFile(id, title, filePath, fileType, content) {
    console.log(`尝试修复文件: ${title}`);
    
    try {
        const dirPath = path.dirname(filePath);
        
        // 创建备份
        const backupPath = filePath + '.backup.' + Date.now();
        if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, backupPath);
            console.log(`创建备份: ${backupPath}`);
        }

        // 根据文件类型创建新文件
        if (fileType === 'text/plain') {
            const newContent = content || `${title}\n\n此文件已由系统自动修复。\n原文件内容可能已丢失，请重新编辑。`;
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`✅ 文本文件修复成功: ${title}`);
        } else if (fileType && (fileType.includes('wordprocessingml') || fileType.includes('msword'))) {
            const docContent = content || `${title}\n\n此文件已由系统自动修复。\n原文件内容可能已丢失，请重新编辑。`;
            
            // 创建新的DOCX文件
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: docContent.split('\n').map(textLine =>
                        new Paragraph({
                            children: [new TextRun(textLine)],
                        })
                    ),
                }],
            });

            const buffer = await Packer.toBuffer(doc);
            fs.writeFileSync(filePath, buffer);
            
            console.log(`✅ DOCX文件修复成功: ${title}`);
            
            // 验证修复结果
            try {
                await mammoth.extractRawText({ path: filePath });
                console.log(`✅ 修复文件验证通过: ${title}`);
            } catch (error) {
                console.log(`❌ 修复文件验证失败: ${title} - ${error.message}`);
            }
        }

        // 更新数据库记录
        const stats = fs.statSync(filePath);
        await pool.execute(
            'UPDATE knowledge_base SET file_size = ? WHERE id = ?',
            [stats.size, id]
        );

    } catch (error) {
        console.error(`修复文件失败: ${title} - ${error.message}`);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    checkAndFixCorruptedFiles()
        .then(() => {
            console.log('修复脚本执行完成');
            process.exit(0);
        })
        .catch((error) => {
            console.error('修复脚本执行失败:', error);
            process.exit(1);
        });
}

module.exports = { checkAndFixCorruptedFiles, fixCorruptedFile }; 