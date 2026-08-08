const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

// 处理中文文件名编码的辅助函数
function fixChineseFilename(filename) {
    try {
        // 确保文件名是正确的UTF-8编码
        let cleanName = filename;
        
        // 检测更多种类的乱码模式
        const hasGarbled = filename.includes('Ã') || 
                          filename.includes('â') || 
                          filename.includes('é¿') || 
                          filename.includes('ã') ||
                          filename.includes('æ') ||
                          filename.includes('è') ||
                          filename.includes('ç') ||
                          filename.includes('å') ||
                          // 检测控制字符和特殊编码
                          filename.includes('\\u00') ||
                          /[\u0080-\u00FF]/.test(filename);
        
        if (hasGarbled) {
            console.log(`检测到可能的乱码文件名: ${filename}`);
            
            // 尝试多种编码修复方式
            let attempts = [
                // 方法1: Latin-1 to UTF-8
                () => Buffer.from(filename, 'latin1').toString('utf8'),
                // 方法2: 直接处理转义字符
                () => filename.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => 
                    String.fromCharCode(parseInt(code, 16))
                ),
                // 方法3: 处理常见的中文乱码
                () => filename
                    .replace(/æ/g, '我')
                    .replace(/è/g, '的')
                    .replace(/ç/g, '是')
                    .replace(/å/g, '和')
                    .replace(/é/g, '电')
                    .replace(/ã/g, '本')
            ];
            
            for (let i = 0; i < attempts.length; i++) {
                try {
                    let result = attempts[i]();
                    // 检查结果是否包含正常的中文字符
                    if (/[\u4e00-\u9fa5]/.test(result)) {
                        console.log(`方法 ${i + 1} 修复成功: ${result}`);
                        cleanName = result;
                        break;
                    }
                } catch (error) {
                    console.warn(`方法 ${i + 1} 修复失败:`, error.message);
                }
            }
            
            // 如果所有方法都失败，使用安全的替换方法
            if (cleanName === filename) {
                console.log('使用安全替换方法');
                cleanName = filename.replace(/[^\w\.\-\u4e00-\u9fa5]/g, '_');
            }
        }
        
        // 移除或替换不安全的文件系统字符
        cleanName = cleanName.replace(/[\/\\?%*:|"<>]/g, '-');
        
        // 确保文件名不会太长（大多数文件系统限制为255字符）
        if (cleanName.length > 200) {
            const ext = path.extname(cleanName);
            const nameWithoutExt = path.basename(cleanName, ext);
            cleanName = nameWithoutExt.substring(0, 200 - ext.length) + ext;
        }
        
        return cleanName;
    } catch (error) {
        console.warn('文件名编码处理失败，使用原始文件名:', error);
        return filename.replace(/[\/\\?%*:|"<>]/g, '-');
    }
}

// 修复知识库中的中文文件名
async function fixKnowledgeBaseFilenames() {
    let connection;
    try {
        console.log('开始修复知识库中的中文文件名乱码问题...');
        
        // 获取所有知识库文件记录
        const [rows] = await pool.execute('SELECT id, title, file_path FROM knowledge_base');
        console.log(`找到 ${rows.length} 个知识库文件记录`);
        
        let fixedCount = 0;
        
        for (const row of rows) {
            const { id, title, file_path } = row;
            const fixedTitle = fixChineseFilename(title);
            
            if (fixedTitle !== title) {
                console.log(`修复文件标题: ${title} -> ${fixedTitle}`);
                await pool.execute(
                    'UPDATE knowledge_base SET title = ? WHERE id = ?',
                    [fixedTitle, id]
                );
                fixedCount++;
            }
        }
        
        console.log(`知识库文件名修复完成，共修复 ${fixedCount} 个文件`);
        
    } catch (error) {
        console.error('修复知识库文件名失败:', error);
    }
}

// 修复项目文件中的中文文件名
async function fixProjectFilenames() {
    try {
        console.log('开始修复项目文件中的中文文件名乱码问题...');
        
        // 获取所有项目文件记录
        const [rows] = await pool.execute('SELECT id, original_name FROM files');
        console.log(`找到 ${rows.length} 个项目文件记录`);
        
        let fixedCount = 0;
        
        for (const row of rows) {
            const { id, original_name } = row;
            const fixedName = fixChineseFilename(original_name);
            
            if (fixedName !== original_name) {
                console.log(`修复文件名: ${original_name} -> ${fixedName}`);
                await pool.execute(
                    'UPDATE files SET original_name = ? WHERE id = ?',
                    [fixedName, id]
                );
                fixedCount++;
            }
        }
        
        console.log(`项目文件名修复完成，共修复 ${fixedCount} 个文件`);
        
    } catch (error) {
        console.error('修复项目文件名失败:', error);
    }
}

// 修复文件系统中的实际文件名
async function fixFileSystemNames() {
    try {
        console.log('开始修复文件系统中的中文文件名...');
        
        const knowledgeBaseDir = path.join(process.cwd(), 'server', 'knowledge_base_files');
        const uploadsDir = path.join(process.cwd(), 'uploads');
        
        console.log(`检查知识库目录: ${knowledgeBaseDir}`);
        console.log(`检查上传目录: ${uploadsDir}`);
        
        await fixDirectoryFilenames(knowledgeBaseDir);
        await fixDirectoryFilenames(uploadsDir);
        
        console.log('文件系统文件名修复完成');
        
    } catch (error) {
        console.error('修复文件系统文件名失败:', error);
    }
}

// 递归修复目录中的文件名
async function fixDirectoryFilenames(dirPath) {
    if (!fs.existsSync(dirPath)) {
        console.log(`目录不存在: ${dirPath}`);
        return;
    }
    
    try {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                await fixDirectoryFilenames(itemPath);
            } else {
                const fixedName = fixChineseFilename(item);
                if (fixedName !== item) {
                    const newPath = path.join(dirPath, fixedName);
                    
                    // 检查新文件名是否已存在
                    if (!fs.existsSync(newPath)) {
                        console.log(`重命名文件: ${itemPath} -> ${newPath}`);
                        fs.renameSync(itemPath, newPath);
                    } else {
                        console.warn(`文件已存在，跳过重命名: ${newPath}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`处理目录失败: ${dirPath}`, error);
    }
}

// 主函数
async function main() {
    try {
        console.log('开始修复中文文件名乱码问题...');
        console.log('==========================================');
        
        await fixKnowledgeBaseFilenames();
        console.log('------------------------------------------');
        
        await fixProjectFilenames();
        console.log('------------------------------------------');
        
        await fixFileSystemNames();
        console.log('------------------------------------------');
        
        console.log('所有修复任务完成！');
        
    } catch (error) {
        console.error('修复过程中发生错误:', error);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

// 运行脚本
if (require.main === module) {
    main();
}

module.exports = {
    fixChineseFilename,
    fixKnowledgeBaseFilenames,
    fixProjectFilenames,
    fixFileSystemNames
}; 