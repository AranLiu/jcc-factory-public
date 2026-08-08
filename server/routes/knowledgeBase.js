const express = require('express');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const mammoth = require('mammoth');
const multer = require('multer');
const { htmlToSafeDocx } = require('../utils/docxExporter');
const sanitizeHtml = require('sanitize-html');
const { pool, quotaPool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const minioService = require('../services/minioService');
const { deleteStoredObjects } = require('../services/objectDeletionService');
const { minioClient, BUCKETS } = require('../config/minio');
const { createUploadGuard } = require('../middleware/uploadGuard');
const { isAllowedProjectFile } = require('../utils/fileSignatures');
const { assertSafeZipBuffer } = require('../utils/archiveSafety');
const { canMutateResource } = require('../utils/authorization');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const { sanitizeDisplayName } = require('../utils/security');

const router = express.Router();

// 服务端内容缓存（5分钟过期）
const serverCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 缓存清理函数
const clearExpiredCache = () => {
  const now = Date.now();
  for (const [key, value] of serverCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      serverCache.delete(key);
    }
  }
};

// 定期清理过期缓存
setInterval(clearExpiredCache, 60000); // 每分钟清理一次

// 将Markdown内容转换为HTML（与前端格式化函数保持一致）
function convertMarkdownToEnhancedHtml(content) {
    if (!content) return '<div style="font-family: SimSun, serif; font-size: 14pt;"><p>暂无内容</p></div>';

    // 转义HTML特殊字符
    const escapeHtml = (text) => {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    // 处理列表状态
    let inUnorderedList = false;
    let inOrderedList = false;
    
    const lines = content.split('\n');
    const htmlLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        const nextTrimmed = nextLine.trim();

        // 检查是否需要关闭列表
        const isCurrentLineListItem = trimmedLine.startsWith('- ') || 
                                     trimmedLine.startsWith('* ') || 
                                     /^\d+\.\s/.test(trimmedLine);
        const isNextLineListItem = nextTrimmed.startsWith('- ') || 
                                  nextTrimmed.startsWith('* ') || 
                                  /^\d+\.\s/.test(nextTrimmed);

        // 处理标题
        if (trimmedLine.startsWith('# ')) {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            const text = escapeHtml(trimmedLine.substring(2));
            htmlLines.push(`<h1>${text}</h1>`);
            
        } else if (trimmedLine.startsWith('## ')) {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            const text = escapeHtml(trimmedLine.substring(3));
            htmlLines.push(`<h2>${text}</h2>`);
            
        } else if (trimmedLine.startsWith('### ')) {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            const text = escapeHtml(trimmedLine.substring(4));
            htmlLines.push(`<h3>${text}</h3>`);
            
        } else if (trimmedLine.startsWith('#### ')) {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            const text = escapeHtml(trimmedLine.substring(5));
            htmlLines.push(`<h4>${text}</h4>`);
            
        } 
        // 处理无序列表
        else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            if (!inUnorderedList) {
                htmlLines.push('<ul>');
                inUnorderedList = true;
            }
            const text = escapeHtml(trimmedLine.substring(2));
            htmlLines.push(`<li>${text}</li>`);
            
            // 检查是否需要关闭列表
            if (!isNextLineListItem && nextTrimmed !== '') {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            
        } 
        // 处理有序列表
        else if (/^\d+\.\s/.test(trimmedLine)) {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (!inOrderedList) {
                htmlLines.push('<ol>');
                inOrderedList = true;
            }
            const match = trimmedLine.match(/^\d+\.\s(.*)$/);
            const text = escapeHtml(match[1]);
            htmlLines.push(`<li>${text}</li>`);
            
            // 检查是否需要关闭列表
            if (!isNextLineListItem && nextTrimmed !== '') {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            
        } 
        // 处理空行
        else if (trimmedLine === '') {
            // 如果在列表中且下一行不是列表项，关闭列表
            if (inUnorderedList && !isNextLineListItem) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList && !isNextLineListItem) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            
            // 只有当下一行不是空行时才添加换行
            if (nextTrimmed !== '') {
                htmlLines.push('<br/>');
            }
            
        }
        // 处理普通段落
        else {
            if (inUnorderedList) {
                htmlLines.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            
            // 处理内联格式
            let processedLine = escapeHtml(line);
            
            // 粗体文本 **text** 或 __text__
            processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            processedLine = processedLine.replace(/__(.*?)__/g, '<strong>$1</strong>');
            
            // 斜体文本 *text* 或 _text_
            processedLine = processedLine.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
            processedLine = processedLine.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
            
            htmlLines.push(`<p>${processedLine}</p>`);
        }
    }

    // 确保最后关闭所有列表
    if (inUnorderedList) {
        htmlLines.push('</ul>');
    }
    if (inOrderedList) {
        htmlLines.push('</ol>');
    }

    // 将内容包装在带有宋体样式的div中
    const htmlContent = htmlLines.join('');
    return `<div style="font-family: SimSun, serif; font-size: 14pt; line-height: 1.5;">${htmlContent}</div>`;
}

// 处理中文文件名编码的辅助函数
function sanitizeChineseFilename(filename) {
    try {
        // 确保文件名是正确的UTF-8编码
        let cleanName = filename;
        
        console.log(`原始文件名: ${filename}`);
        
        // 检测更多种类的乱码模式
        const hasGarbled = filename.includes('Ã') || 
                          filename.includes('â') || 
                          filename.includes('é¿') || 
                          filename.includes('ã') ||
                          filename.includes('æ') ||
                          filename.includes('è') ||
                          filename.includes('ç') ||
                          filename.includes('å') ||
                          filename.includes('§') ||
                          filename.includes('¨') ||
                          filename.includes('©') ||
                          filename.includes('¬') ||
                          filename.includes('®') ||
                          filename.includes('¯') ||
                          // 检测控制字符和特殊编码
                          filename.includes('\\u00') ||
                          /[\u0080-\u00FF]/.test(filename);
        
        if (hasGarbled) {
            console.log(`检测到可能的乱码文件名: ${filename}`);
            
            // 尝试多种编码修复方式
            let attempts = [
                // 方法1: Latin-1 to UTF-8 (最常见)
                () => {
                    const buffer = Buffer.from(filename, 'latin1');
                    return buffer.toString('utf8');
                },
                
                // 方法2: Windows-1252 to UTF-8
                () => {
                    // 先尝试转换为 Buffer 然后解码
                    const buffer = Buffer.from(filename, 'binary');
                    return buffer.toString('utf8');
                },
                
                // 方法3: 直接处理转义字符
                () => {
                    return filename.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => 
                        String.fromCharCode(parseInt(code, 16))
                    );
                },
                
                // 方法4: 处理常见的URL编码
                () => {
                    try {
                        return decodeURIComponent(filename);
                    } catch {
                        return filename;
                    }
                },
                
                // 方法5: 特定乱码字符映射修复
                () => {
                    return filename
                        .replace(/Ã¦/g, '我')
                        .replace(/Ã¨/g, '的')
                        .replace(/Ã§/g, '是')
                        .replace(/Ã¥/g, '和')
                        .replace(/Ã©/g, '电')
                        .replace(/Ã£/g, '本')
                        .replace(/æ/g, '文')
                        .replace(/è/g, '档')
                        .replace(/ç/g, '案')
                        .replace(/å/g, '件')
                        .replace(/é/g, '题')
                        .replace(/ã/g, '容')
                        .replace(/§/g, '剧')
                        .replace(/¨/g, '本')
                        .replace(/©/g, '故')
                        .replace(/¬/g, '事')
                        .replace(/®/g, '人')
                        .replace(/¯/g, '物');
                },
                
                // 方法6: 基于字节重新解释
                () => {
                    // 尝试将字符串作为Latin-1字节序列重新解释为UTF-8
                    const bytes = [];
                    for (let i = 0; i < filename.length; i++) {
                        bytes.push(filename.charCodeAt(i) & 0xFF);
                    }
                    return Buffer.from(bytes).toString('utf8');
                }
            ];
            
            for (let i = 0; i < attempts.length; i++) {
                try {
                    let result = attempts[i]();
                    console.log(`方法 ${i + 1} 尝试结果: ${result}`);
                    
                    // 检查结果是否包含正常的中文字符或者明显改善了
                    if (/[\u4e00-\u9fa5]/.test(result) || 
                        (result.length > 0 && !hasGarbledPattern(result))) {
                        console.log(`方法 ${i + 1} 修复成功: ${result}`);
                        cleanName = result;
                        break;
                    }
                } catch (error) {
                    console.warn(`方法 ${i + 1} 修复失败:`, error.message);
                }
            }
            
            // 如果所有方法都失败，使用安全的替换方法
            if (cleanName === filename || hasGarbledPattern(cleanName)) {
                console.log('使用安全替换方法');
                const ext = path.extname(filename);
                const timestamp = Date.now();
                cleanName = `文档_${timestamp}${ext}`;
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
        
        console.log(`最终文件名: ${cleanName}`);
        return cleanName;
    } catch (error) {
        console.warn('文件名编码处理失败，使用时间戳文件名:', error);
        const ext = path.extname(filename) || '.txt';
        return `文档_${Date.now()}${ext}`;
    }
}

// 检测是否仍然包含乱码模式
function hasGarbledPattern(text) {
    return text.includes('Ã') || 
           text.includes('â') || 
           text.includes('é¿') || 
           /[\u0080-\u00FF]/.test(text) ||
           text.includes('§') ||
           text.includes('¨') ||
           text.includes('©');
}

// --- Multer Configuration for File Uploads ---
const tempUploadDir = path.join(process.cwd(), 'temp_uploads', 'knowledge_base');

// 确保临时上传目录存在
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Files will be stored in a temporary directory first
        const userTempDir = path.join(tempUploadDir, String(req.user.id));
        if (!fs.existsSync(userTempDir)) {
            fs.mkdirSync(userTempDir, { recursive: true });
        }
        cb(null, userTempDir);
    },
    filename: (req, file, cb) => {
        // 修复文件名编码问题
        try {
            // 尝试修复被误解的UTF-8编码
            let originalName = file.originalname;
            console.log(`原始文件名（修复前）: ${originalName}`);
            
            // 检测并修复常见的UTF-8编码被误解为Latin-1的问题
            if (originalName.includes('å') || originalName.includes('é') || originalName.includes('ã')) {
                try {
                    // 将Latin-1编码重新解释为UTF-8
                    const buffer = Buffer.from(originalName, 'latin1');
                    originalName = buffer.toString('utf8');
                    console.log(`文件名编码修复后: ${originalName}`);
                } catch (error) {
                    console.warn('文件名编码修复失败:', error.message);
                }
            }
            
            // 使用时间戳+原始扩展名的方式存储，避免文件系统问题
            const ext = path.extname(originalName) || '.txt';
            const filename = `${randomUUID()}${ext.toLowerCase()}`;
            console.log(`临时存储文件名: ${filename}`);
            
            // 将修复后的原始文件名存储在req对象中，供后续使用
            req.fixedOriginalName = originalName;
            
            cb(null, filename);
        } catch (error) {
            console.error('文件名处理出错:', error);
            const ext = path.extname(file.originalname) || '.txt';
            cb(null, `${randomUUID()}${ext.toLowerCase()}`);
        }
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB限制
    },
    fileFilter: (req, file, cb) => {
        console.log(`文件类型检查: ${file.mimetype}, 原始名称: ${file.originalname}`);
        
        if (
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.mimetype === 'text/plain'
        ) {
            cb(null, true);
        } else {
            const err = new Error('只允许上传 .docx, .txt 文件!');
            err.status = 400;
            return cb(err);
        }
    }
});
const maxKnowledgeStorageBytes = Number(process.env.MAX_KNOWLEDGE_STORAGE_BYTES || 5 * 1024 * 1024 * 1024);
const knowledgeUploadGuard = createUploadGuard({
    maxConcurrent: Number(process.env.MAX_CONCURRENT_UPLOADS_PER_USER || 2),
    maxBytes: maxKnowledgeStorageBytes,
    usageProvider: async (userId) => {
        const [[row]] = await pool.execute(
            'SELECT COALESCE(SUM(file_size), 0) AS used_bytes FROM knowledge_base WHERE user_id = ?',
            [userId]
        );
        return Number(row.used_bytes || 0);
    }
});

// All routes require authentication
router.use(authenticateToken);

// POST /api/knowledge-base/upload - Upload a new file
router.post('/upload', knowledgeUploadGuard, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    const { id: userId } = req.user;
    const { originalname, path: filePath, mimetype, size } = req.file;

    const descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(512);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    fs.closeSync(descriptor);
    if (!isAllowedProjectFile('novel', originalname, mimetype, header.subarray(0, bytesRead))) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ message: '文件内容与扩展名或MIME类型不匹配' });
    }

    console.log(`文件上传详情:`);
    console.log(`- 原始文件名: ${originalname}`);
    console.log(`- 临时存储路径: ${filePath}`);
    console.log(`- 文件类型: ${mimetype}`);
    console.log(`- 文件大小: ${size} bytes`);

    let integrityWarning = null;
    let minioUploadResult = null;
    
    try {
        console.log(`验证上传文件完整性: ${originalname}`);
        const integrityResult = await checkFileIntegrity(filePath, mimetype);
        
        if (!integrityResult.isValid) {
            console.warn(`拒绝不安全或损坏的上传文件: ${originalname} - ${integrityResult.message}`);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({
                message: 'Unsafe or corrupted document was rejected',
                error: integrityResult.error
            });
        } else {
            console.log(`文件完整性验证通过: ${originalname}`);
        }

        // 上传文件到 MinIO
        const displayName = req.fixedOriginalName || originalname;
        console.log(`开始上传文件到 MinIO: ${displayName}`);
        
        let result;
        await withAdvisoryLock(quotaPool, `knowledge-quota:${userId}`, async (connection) => {
            const [[usage]] = await connection.execute(
                'SELECT COALESCE(SUM(file_size), 0) AS used_bytes FROM knowledge_base WHERE user_id = ?',
                [userId]
            );
            if (Number(usage.used_bytes || 0) + size > maxKnowledgeStorageBytes) {
                const quotaError = new Error('User knowledge-base storage quota exceeded');
                quotaError.status = 413;
                throw quotaError;
            }
            minioUploadResult = await minioService.uploadDocument(userId, filePath, displayName, mimetype);
        
        console.log(`文件上传到 MinIO 成功: ${minioUploadResult.bucketName}/${minioUploadResult.objectName}`);

        // 将文件信息保存到数据库（使用 MinIO 对象名称）
        [result] = await connection.execute(
            'INSERT INTO knowledge_base (user_id, title, file_path, file_type, file_size, minio_bucket, minio_object_name, storage_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, displayName, minioUploadResult.objectName, mimetype, size, minioUploadResult.bucketName, minioUploadResult.objectName, 'minio']
        );
        });
        
        const insertedId = result.insertId;
        
        // 清理临时文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`已清理临时文件: ${filePath}`);
        }
        
        const response = {
            message: 'File uploaded successfully.',
            fileId: insertedId,
            filePath: minioUploadResult.objectName,
            originalName: displayName,
            minio_bucket: minioUploadResult.bucketName,
            minio_object_name: minioUploadResult.objectName,
            storage_type: 'minio'
        };
        
        // 如果有完整性警告，包含在响应中
        if (integrityWarning) {
            response.warning = integrityWarning;
            response.message = 'File uploaded with warnings. Please check the file integrity.';
        }
        
        console.log(`知识库文件上传成功: ID=${insertedId}, MinIO路径=${minioUploadResult.bucketName}/${minioUploadResult.objectName}`);
        res.status(201).json(response);
        
    } catch (error) {
        console.error('Failed to save file info to database:', error);
        
        // 如果数据库插入失败，删除上传的文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        // 如果已经上传到 MinIO，尝试删除
        if (minioUploadResult) {
            try {
                await minioService.deleteFile(minioUploadResult.bucketName, minioUploadResult.objectName);
                console.log(`已清理 MinIO 文件: ${minioUploadResult.bucketName}/${minioUploadResult.objectName}`);
            } catch (deleteError) {
                console.warn('清理 MinIO 文件失败:', deleteError.message);
            }
        }
        
        res.status(error.status || 500).json({ message: 'Internal server error while saving file information.' });
    }
});

// DELETE /api/knowledge-base/:id - Delete a file
router.delete('/:id', async (req, res) => {
    const { id: entryId } = req.params;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    try {
        // 1. Get file path from DB to verify ownership and for deletion
        const [entries] = await pool.execute(
            'SELECT file_path, user_id, storage_type, minio_bucket, minio_object_name FROM knowledge_base WHERE id = ?',
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: 'File not found.' });
        }
        
        // 权限检查：admin和global权限用户可以删除所有文件，readonly_global用户只能删除自己的文件
        if (entries[0].user_id !== userId && userPermission !== 'global' && userRole !== 'admin') {
            return res.status(403).json({ message: 'You do not have permission to delete this file.' });
        }

        const { file_path, storage_type, minio_bucket, minio_object_name } = entries[0];

        if (storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local document must be migrated before deletion' });
        }

        if (!minio_bucket || !minio_object_name) {
            return res.status(409).json({ message: 'Object storage metadata is incomplete' });
        }

        await deleteStoredObjects(minioService, [
            { bucket: minio_bucket, object: minio_object_name }
        ]);

        // 3. Delete from database (tags are handled by ON DELETE CASCADE)
        await pool.execute('DELETE FROM knowledge_base WHERE id = ?', [entryId]);

        res.status(200).json({ message: 'File deleted successfully.' });

    } catch (error) {
        console.error(`Failed to delete file entry ${entryId}:`, error);
        const status = error.code === 'OBJECT_STORAGE_DELETE_FAILED' ? 502 : 500;
        res.status(status).json({ message: 'Internal server error.' });
    }
});

// 存档（创建DOCX文件并上传到MinIO）
router.post('/archive', knowledgeUploadGuard, async (req, res) => {
    const { title, content, projectId } = req.body;
    const { id: userId } = req.user;

    try {
        if (
            typeof title !== 'string' ||
            typeof content !== 'string' ||
            !title.trim() ||
            !content ||
            !projectId
        ) {
            return res.status(400).json({ message: '标题、内容和项目ID均不能为空' });
        }

        let finalTitle;
        try {
            const trimmedTitle = title.trim();
            finalTitle = sanitizeDisplayName(
                /\.docx$/i.test(trimmedTitle) ? trimmedTitle : `${trimmedTitle}.docx`
            );
        } catch {
            return res.status(400).json({ message: '存档文档名称无效' });
        }

    // 1. 定义临时文件存储目录
    const [projects] = await pool.execute('SELECT user_id FROM projects WHERE id = ?', [projectId]);
    if (projects.length === 0) return res.status(404).json({ message: 'Project not found' });
    if (!canMutateResource(req.user, projects[0].user_id)) {
        return res.status(403).json({ message: 'No write access to this project' });
    }

    const tempDir = path.join(process.cwd(), 'temp_uploads', 'knowledge_base', String(userId));
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // 2. 创建 DOCX 文档，专门针对剧本格式进行优化
    const doc = new Document({
        creator: "JCC Factory",
        title: finalTitle,
        description: "剧本整合存档",
        sections: [{
            properties: {},
            children: [
                // 添加文档标题
                new Paragraph({
                    children: [new TextRun({
                        text: finalTitle,
                        bold: true,
                        size: 32 // 16pt
                    })],
                    heading: HeadingLevel.TITLE,
                    alignment: AlignmentType.CENTER,
                    spacing: {
                        after: 400,
                        before: 200
                    }
                }),
                // 添加内容
                ...content.split('\n').map((textLine, index) => {
                    // 如果是空行，创建空段落
                    if (textLine.trim() === '') {
                        return new Paragraph({
                            children: [new TextRun('')],
                        });
                    }
                    
                    // 检查是否是标题行（通常剧本标题会包含特定格式）
                    if (textLine.includes('第') && textLine.includes('集') || 
                        textLine.includes('场景') || 
                        textLine.includes('SCENE') ||
                        textLine.startsWith('=') ||
                        textLine.startsWith('#')) {
                        return new Paragraph({
                            children: [new TextRun({
                                text: textLine,
                                bold: true,
                                size: 28 // 14pt
                            })],
                            heading: HeadingLevel.HEADING_1,
                            spacing: {
                                after: 200, // 段后间距
                                before: 200 // 段前间距
                            }
                        });
                    }
                    
                    // 检查是否是角色名称（通常全大写或以冒号结尾）
                    if (textLine.match(/^[A-Z\u4e00-\u9fa5]+[:：]/) || 
                        textLine.match(/^[A-Z\u4e00-\u9fa5]+\s*\(/) ||
                        (textLine === textLine.toUpperCase() && textLine.length < 20 && textLine.length > 1)) {
                        return new Paragraph({
                            children: [new TextRun({
                                text: textLine,
                                bold: true,
                                color: '0066CC'
                            })],
                            spacing: {
                                after: 100,
                                before: 100
                            }
                        });
                    }
                    
                    // 检查是否是舞台指示（通常包含在括号中）
                    if (textLine.match(/^\s*[（(].*[）)]\s*$/)) {
                        return new Paragraph({
                            children: [new TextRun({
                                text: textLine,
                                italics: true,
                                color: '666666'
                            })],
                            spacing: {
                                after: 100
                            }
                        });
                    }
                    
                    // 普通文本段落
                    return new Paragraph({
                        children: [new TextRun(textLine)],
                        spacing: {
                            after: 100
                        }
                    });
                })
            ],
        }],
    });

    // 3. 生成临时文件名
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const tempFilename = `temp_archive_${timestamp}_${randomString}.docx`;
    const tempFilePath = path.join(tempDir, tempFilename);

    // 4. 处理显示标题，生成唯一标题
    // 检查是否存在同名文件
    const [existingFiles] = await pool.execute(
        'SELECT COUNT(*) as count FROM knowledge_base WHERE user_id = ? AND title LIKE ?',
        [userId, `${finalTitle.replace(/\.docx$/i, '')}%`]
    );
    
    if (existingFiles[0].count > 0) {
        // 如果存在同名文件，添加时间戳
        const timestampSuffix = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const baseName = finalTitle.replace(/\.docx$/i, '').slice(0, 230);
        finalTitle = sanitizeDisplayName(`${baseName}_${timestampSuffix}.docx`);
    }

    let minioUploadResult = null;

    try {
        // 5. 生成DOCX buffer并写入临时文件
        let buffer;
        await withAdvisoryLock(quotaPool, `knowledge-quota:${userId}`, async (connection) => {
        buffer = await Packer.toBuffer(doc);
        const [[usage]] = await connection.execute(
            'SELECT COALESCE(SUM(file_size), 0) AS used_bytes FROM knowledge_base WHERE user_id = ?',
            [userId]
        );
        if (Number(usage.used_bytes || 0) + buffer.length > maxKnowledgeStorageBytes) {
            const quotaError = new Error('User knowledge-base storage quota exceeded');
            quotaError.status = 413;
            throw quotaError;
        }
        fs.writeFileSync(tempFilePath, buffer);
        console.log(`✅ 临时DOCX文件已生成: ${tempFilePath}`);

        // 6. 上传文件到 MinIO
        console.log(`📤 开始上传知识库存档到 MinIO: ${finalTitle}`);
        minioUploadResult = await minioService.uploadDocument(userId, tempFilePath, finalTitle, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        console.log(`✅ 知识库存档上传到 MinIO 成功: ${minioUploadResult.bucketName}/${minioUploadResult.objectName}`);

        // 7. 将文件元信息存入数据库（使用MinIO信息）
        const fileSize = buffer.length;
        await connection.execute(
            'INSERT INTO knowledge_base (project_id, user_id, title, file_path, file_type, file_size, last_modified_by, minio_bucket, minio_object_name, storage_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [projectId, userId, finalTitle, minioUploadResult.objectName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize, userId, minioUploadResult.bucketName, minioUploadResult.objectName, 'minio']
        );
        });

        // 8. 清理临时文件
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`✅ 已清理临时文件: ${tempFilePath}`);
        }

        console.log(`🎉 知识库存档完成: ${finalTitle}`);
        res.status(201).json({ 
            message: '成功存档为DOCX文件并上传到MinIO',
            title: finalTitle,
            minio_bucket: minioUploadResult.bucketName,
            minio_object_name: minioUploadResult.objectName
        });

    } catch (error) {
        console.error('存档为DOCX失败:', error);
        
        // 清理临时文件
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
                console.log(`✅ 已清理临时文件: ${tempFilePath}`);
            } catch (cleanupError) {
                console.warn('清理临时文件失败:', cleanupError.message);
            }
        }
        
        // 如果MinIO上传成功但数据库操作失败，清理MinIO文件
        if (minioUploadResult) {
            try {
                await minioService.deleteFile(minioUploadResult.bucketName, minioUploadResult.objectName);
                console.log(`✅ 已清理 MinIO 文件: ${minioUploadResult.bucketName}/${minioUploadResult.objectName}`);
            } catch (deleteError) {
                console.warn('清理 MinIO 文件失败:', deleteError.message);
            }
        }
        
        res.status(error.status || 500).json({ message: '服务器内部错误，存档失败' });
    }
    } catch (error) {
        console.error('知识库存档预处理失败:', error);
        res.status(500).json({ message: '服务器内部错误，存档失败' });
    }
});

// GET /api/knowledge-base/ - Get knowledge base list, with tag filtering
router.get('/', async (req, res) => {
    const { id: userId, permission: userPermission, role: userRole } = req.user;
    const { tagIds } = req.query; // e.g., ?tagIds=1,2,3

    try {
        let query = `
            SELECT kb.*, u.username as owner_name, lm.username as last_modified_by_name, 
                   GROUP_CONCAT(t.id) as tag_ids, GROUP_CONCAT(t.name) as tag_names, GROUP_CONCAT(t.color) as tag_colors
            FROM knowledge_base kb
            LEFT JOIN users u ON kb.user_id = u.id
            LEFT JOIN users lm ON kb.last_modified_by = lm.id
            LEFT JOIN knowledge_base_tags kbt ON kb.id = kbt.knowledge_base_id
            LEFT JOIN tags t ON kbt.tag_id = t.id
        `;
        
        let params = [];
        
        // 权限检查：admin、global和readonly_global权限用户可以看到所有文件
        if (['global', 'readonly_global'].includes(userPermission) || userRole === 'admin') {
            // 全局权限：显示所有用户的知识库文件
            query += ' WHERE 1=1';
        } else {
            // 个人权限：只显示自己的文件
            query += ' WHERE kb.user_id = ?';
            params.push(userId);
        }

        if (tagIds) {
            const tagIdArray = tagIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
            if(tagIdArray.length > 0) {
                // 为 IN 子句创建占位符
                const placeholders = tagIdArray.map(() => '?').join(',');
                query += `
                   AND kb.id IN (
                        SELECT knowledge_base_id
                        FROM knowledge_base_tags
                        WHERE tag_id IN (${placeholders})
                        GROUP BY knowledge_base_id
                        HAVING COUNT(DISTINCT tag_id) = ?
                    )
                `;
                // 添加每个标签ID到参数数组
                params.push(...tagIdArray);
                params.push(tagIdArray.length);
            }
        }

        query += ' GROUP BY kb.id ORDER BY kb.created_at DESC';

        const [items] = await pool.execute(query, params);

        const processedItems = items.map(item => ({
            ...item,
            tags: item.tag_ids ? item.tag_ids.split(',').map((id, index) => ({
                id: parseInt(id),
                name: item.tag_names.split(',')[index],
                color: item.tag_colors.split(',')[index]
            })) : [],
            tag_ids: undefined, // remove redundant fields
            tag_names: undefined,
            tag_colors: undefined
        }));

        res.json({ items: processedItems });

    } catch (error) {
        console.error('Failed to get knowledge base list:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/knowledge-base/:id/content - 获取文件内容（用于预览和编辑）
router.get('/:id/content', async (req, res) => {
    const { id: entryId } = req.params;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    console.log(`📖 用户 ${userId} 请求访问文档内容，ID: ${entryId}`);

    try {
        // 1. 从数据库获取文件信息
        const [entries] = await pool.execute(
            'SELECT file_path, user_id, file_type, title, storage_type, minio_bucket, minio_object_name FROM knowledge_base WHERE id = ?',
            [entryId]
        );

        if (entries.length === 0) {
            console.log(`❌ 文档不存在，ID: ${entryId}`);
            return res.status(404).json({ 
                message: '文件不存在',
                error_type: 'ENTRY_NOT_FOUND'
            });
        }

        const entry = entries[0];
        console.log(`📄 找到文档: ${entry.title}, 文件路径: ${entry.file_path}`);

        // 2. 权限检查：admin、global和readonly_global权限用户可以访问所有文件
        if (entry.user_id !== userId && !['global', 'readonly_global'].includes(userPermission) && userRole !== 'admin') {
            console.log(`🚫 权限不足，用户 ${userId} 尝试访问用户 ${entry.user_id} 的文档`);
            return res.status(403).json({ 
                message: '无权访问此文件',
                error_type: 'PERMISSION_DENIED'
            });
        }

        // 3. 检查服务端缓存
        const cacheKey = `content_${entryId}_${entry.user_id}`;
        const cachedContent = serverCache.get(cacheKey);
        
        if (cachedContent && (Date.now() - cachedContent.timestamp < CACHE_TTL)) {
            console.log('✅ 从服务端缓存获取内容');
            return res.json({ content: cachedContent.content });
        }

        // 4. 从文件读取内容
        let content = '';

        if (entry.file_path) {
            if (entry.storage_type !== 'minio') {
                return res.status(409).json({ message: 'Legacy local document must be migrated before reading content' });
            }
            // 如果数据库中没有内容，尝试从存储获取
            try {
                if (entry.storage_type === 'minio') {
                    // 从 MinIO 读取文件
                    if (!entry.minio_bucket || !entry.minio_object_name) {
                        return res.status(404).json({ 
                            message: 'MinIO 文件信息不完整',
                            error_type: 'MINIO_INFO_INCOMPLETE'
                        });
                    }
                    
                    console.log(`从 MinIO 获取文件: ${entry.minio_bucket}/${entry.minio_object_name}`);
                    
                    const objectBuffer = await minioService.getFileBuffer(
                        entry.minio_bucket,
                        entry.minio_object_name
                    );
                    if (entry.file_type === 'text/plain') {
                        content = objectBuffer.toString('utf8');
                    } else if (entry.file_type?.includes('wordprocessingml')) {
                        assertSafeZipBuffer(objectBuffer);
                        const result = await mammoth.extractRawText({ buffer: objectBuffer });
                        content = result.value;
                    } else {
                        return res.status(415).json({ message: 'Unsupported knowledge-base file type' });
                    }
                    
                    console.log('✅ 从 MinIO 获取内容');
                } else {
                    // 从本地文件系统读取（兼容性）
                    const absolutePath = path.join(process.cwd(), entry.file_path);

                    // 检查文件是否存在，如果不存在，尝试查找相似的文件
                    let targetPath = absolutePath;
                    if (!fs.existsSync(absolutePath)) {
                        console.log(`文件不存在: ${absolutePath}`);
                        
                        // 尝试在知识库目录中查找匹配的文件
                        const dir = path.dirname(absolutePath);
                        const filename = path.basename(absolutePath);
                        
                        try {
                            const files = fs.readdirSync(dir);
                            // 查找包含相同时间戳的文件
                            const timestamp = filename.split('-')[0];
                            const matchingFile = files.find(file => file.startsWith(timestamp));
                            
                            if (matchingFile) {
                                targetPath = path.join(dir, matchingFile);
                                console.log(`找到匹配文件: ${targetPath}`);
                            } else {
                                return res.status(404).json({ 
                                    message: '文件在服务器上不存在',
                                    error_type: 'FILE_NOT_FOUND'
                                });
                            }
                        } catch (error) {
                            return res.status(404).json({ 
                                message: '文件在服务器上不存在',
                                error_type: 'FILE_NOT_FOUND'
                            });
                        }
                    }

                    // 根据文件类型读取内容
                    if (entry.file_type === 'text/plain') {
                        content = fs.readFileSync(targetPath, 'utf8');
                    } else if (entry.file_type?.includes('wordprocessingml')) {
                        // 从DOCX文件提取纯文本
                        assertSafeZipBuffer(fs.readFileSync(targetPath));
                        const result = await mammoth.extractRawText({ path: targetPath });
                        content = result.value;
                    } else {
                        // 默认尝试提取文本内容
                        assertSafeZipBuffer(fs.readFileSync(targetPath));
                        const result = await mammoth.extractRawText({ path: targetPath });
                        content = result.value;
                    }
                    
                    console.log('✅ 从本地文件获取内容');
                }
                
            } catch (error) {
                console.error('读取文件内容失败:', error);
                
                // 检查是否是文件损坏的错误
                if (error.message && error.message.includes('Corrupted zip')) {
                    return res.status(422).json({ 
                        message: '文件已损坏，无法读取内容。请重新上传此文件。',
                        error_type: 'FILE_CORRUPTED'
                    });
                } else if (error.message && error.message.includes('missing')) {
                    return res.status(422).json({ 
                        message: '文件不完整或已损坏，无法读取内容。请重新上传此文件。',
                        error_type: 'FILE_INCOMPLETE'
                    });
                } else {
                    return res.status(500).json({ 
                        message: '无法读取文件内容',
                        error_type: 'READ_ERROR'
                    });
                }
            }
        } else {
            content = '开始编辑您的文档...';
        }

        // 缓存内容
        if (content) {
            serverCache.set(cacheKey, {
                content: content,
                timestamp: Date.now()
            });
            console.log('📝 内容已缓存到服务端');
        }

        res.json({ content });

    } catch (error) {
        console.error(`获取文件内容失败 ID ${entryId}:`, error);
        res.status(500).json({ 
            message: '获取文件内容失败',
            error_type: 'SYSTEM_ERROR'
        });
    }
});

// GET /api/knowledge-base/:id/preview - 预览DOCX文件内容
router.get('/:id/preview', async (req, res) => {
    const { id: entryId } = req.params;
    const { id: userId } = req.user;

    try {
        // 1. 从数据库获取文件路径
        const [entries] = await pool.execute(
            `SELECT file_path, user_id, file_type, storage_type, minio_bucket, minio_object_name
             FROM knowledge_base WHERE id = ?`,
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        // 2. 权限检查：admin、global和readonly_global权限用户可以访问所有文件
        const { permission: userPermission, role: userRole } = req.user;
        if (entries[0].user_id !== userId && !['global', 'readonly_global'].includes(userPermission) && userRole !== 'admin') {
            return res.status(403).json({ message: '无权访问此文件' });
        }

        const { file_path } = entries[0];
        
        // 检查是否有文件路径
        if (!file_path) {
            return res.status(400).json({ message: '此项目没有关联的文件，无法预览' });
        }
        
        if (entries[0].storage_type !== 'minio' || !entries[0].minio_bucket || !entries[0].minio_object_name) {
            return res.status(409).json({ message: 'Legacy local document must be migrated to object storage before preview' });
        }
        const previewBuffer = await minioService.getFileBuffer(
            entries[0].minio_bucket,
            entries[0].minio_object_name
        );
        assertSafeZipBuffer(previewBuffer);
        const preview = await mammoth.convertToHtml({ buffer: previewBuffer });
        return res.json({ html: sanitizeHtml(preview.value) });

        const absolutePath = path.join(process.cwd(), file_path);

        // 检查文件是否存在，如果不存在，尝试查找相似的文件
        let targetPath = absolutePath;
        if (!fs.existsSync(absolutePath)) {
            console.log(`预览文件不存在: ${absolutePath}`);
            
            // 尝试在知识库目录中查找匹配的文件
            const dir = path.dirname(absolutePath);
            const filename = path.basename(absolutePath);
            
            try {
                const files = fs.readdirSync(dir);
                // 查找包含相同时间戳的文件
                const timestamp = filename.split('-')[0];
                const matchingFile = files.find(file => file.startsWith(timestamp));
                
                if (matchingFile) {
                    targetPath = path.join(dir, matchingFile);
                    console.log(`找到预览匹配文件: ${targetPath}`);
                } else {
                    return res.status(404).json({ message: '文件在服务器上不存在' });
                }
            } catch (error) {
                return res.status(404).json({ message: '文件在服务器上不存在' });
            }
        }

        // 3. 使用 mammoth 将 .docx 转换为 HTML
        const result = await mammoth.convertToHtml({ path: targetPath });
        const html = result.value; // The generated HTML

        res.json({ html });

    } catch (error) {
        console.error(`预览文件ID ${entryId} 失败:`, error);
        res.status(500).json({ message: '无法生成文件预览' });
    }
});

// PUT /api/knowledge-base/:id/title - Update a knowledge item title
router.put('/:id/title', async (req, res) => {
    const { id: knowledgeBaseId } = req.params;
    const { title } = req.body;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    if (!title || !title.trim()) {
        return res.status(400).json({ message: 'Title is required.' });
    }

    try {
        // 权限检查：admin和global权限用户可以修改所有文件，readonly_global用户只能修改自己的文件
        const [kbItems] = await pool.execute('SELECT user_id FROM knowledge_base WHERE id = ?', [knowledgeBaseId]);
        if (kbItems.length === 0) {
            return res.status(404).json({ message: 'Knowledge base item not found.'});
        }
        // 权限检查：如果不是文件所有者，则必须是admin或global权限（readonly_global只能修改自己的文件）
        if (kbItems[0].user_id !== userId && !(userPermission === 'global' || userRole === 'admin')) {
            return res.status(403).json({ message: 'Permission denied.'});
        }

        await pool.execute(
            'UPDATE knowledge_base SET title = ?, last_modified_by = ? WHERE id = ?',
            [title.trim(), userId, knowledgeBaseId]
        );
        res.status(200).json({ message: 'Title updated successfully.' });
    } catch (error) {
        console.error('Failed to update knowledge base item title:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// POST /api/knowledge-base/:id/tags - Add a tag to a knowledge item
router.post('/:id/tags', async (req, res) => {
    const { id: knowledgeBaseId } = req.params;
    const { tagId } = req.body;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    if (!tagId) {
        return res.status(400).json({ message: 'Tag ID is required.' });
    }

    try {
        // 权限检查：admin和global权限用户可以修改所有文件，readonly_global用户只能修改自己的文件
        const [kbItems] = await pool.execute('SELECT user_id FROM knowledge_base WHERE id = ?', [knowledgeBaseId]);
        if (kbItems.length === 0) {
            return res.status(404).json({ message: 'Knowledge base item not found.'});
        }
        // 权限检查：如果不是文件所有者，则必须是admin或global权限（readonly_global只能修改自己的文件）
        if (kbItems[0].user_id !== userId && !(userPermission === 'global' || userRole === 'admin')) {
            return res.status(403).json({ message: 'Permission denied.'});
        }
        // 验证标签存在（现在标签是全局的，所有用户都可以使用）
        const [tags] = await pool.execute('SELECT id FROM tags WHERE id = ?', [tagId]);
        if (tags.length === 0) {
            return res.status(404).json({ message: 'Tag not found.'});
        }

        await pool.execute(
            'INSERT INTO knowledge_base_tags (knowledge_base_id, tag_id) VALUES (?, ?)',
            [knowledgeBaseId, tagId]
        );
        
        // 更新最后修改人
        await pool.execute(
            'UPDATE knowledge_base SET last_modified_by = ? WHERE id = ?',
            [userId, knowledgeBaseId]
        );
        
        res.status(201).json({ message: 'Tag added successfully.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'This tag has already been added to the item.' });
        }
        console.error('Failed to add tag to knowledge base item:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// DELETE /api/knowledge-base/:id/tags/:tagId - Remove a tag from an item
router.delete('/:id/tags/:tagId', async (req, res) => {
    const { id: knowledgeBaseId, tagId } = req.params;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    try {
        // Verify ownership by checking if the user owns the knowledge base item.
        // A more complex check could join all three tables, but this is sufficient.
        const [kbItems] = await pool.execute('SELECT user_id FROM knowledge_base WHERE id = ?', [knowledgeBaseId]);
        if (kbItems.length === 0) {
            return res.status(404).json({ message: 'Knowledge base item not found.'});
        }
        
        // 权限检查：如果不是文件所有者，则必须是admin或global权限（readonly_global只能修改自己的文件）
        if (kbItems[0].user_id !== userId && !(userPermission === 'global' || userRole === 'admin')) {
            return res.status(403).json({ message: 'Permission denied.'});
        }

        const [result] = await pool.execute(
            'DELETE FROM knowledge_base_tags WHERE knowledge_base_id = ? AND tag_id = ?',
            [knowledgeBaseId, tagId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Tag association not found.' });
        }
        
        // 更新最后修改人
        await pool.execute(
            'UPDATE knowledge_base SET last_modified_by = ? WHERE id = ?',
            [userId, knowledgeBaseId]
        );
        
        res.status(200).json({ message: 'Tag removed successfully.' });

    } catch (error) {
        console.error('Failed to remove tag from knowledge base item:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// 删除重复的路由定义 - 这个路由与上面的路由重复了，导致路由冲突
// 上面的路由已经处理了获取文件内容的逻辑，包括预览和编辑

// PUT /api/knowledge-base/:id/content - 更新文件内容
router.put('/:id/content', async (req, res) => {
    const { id: entryId } = req.params;
    const { content } = req.body;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    if (!content) {
        return res.status(400).json({ message: '文档内容不能为空' });
    }

    try {
        // 获取文件信息
        const [entries] = await pool.execute(
            `SELECT file_path, user_id, file_type, title, file_size, storage_type,
                    minio_bucket, minio_object_name
             FROM knowledge_base WHERE id = ?`,
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        // 权限检查：admin和global权限用户可以修改所有文件，readonly_global用户只能修改自己的文件
        if (entries[0].user_id !== userId && userPermission !== 'global' && userRole !== 'admin') {
            return res.status(403).json({ message: '无权修改此文件' });
        }

        const { file_path, file_type, title } = entries[0];
        if (entries[0].storage_type !== 'minio' || !entries[0].minio_bucket || !entries[0].minio_object_name) {
            return res.status(409).json({ message: 'Legacy local document must be migrated before editing' });
        }
        
        // 更新last_modified_by
        await pool.execute(
            'UPDATE knowledge_base SET last_modified_by = ?, updated_at = NOW() WHERE id = ?',
            [userId, entryId]
        );

        // 清除服务端缓存
        const cacheKey = `content_${entryId}_${entries[0].user_id}`;
        serverCache.delete(cacheKey);
        console.log('🗑️ 已清除服务端缓存');

        // 更新文件内容到MinIO
        if (file_path) {
            try {
                let buffer;
                let contentLength;

                // 根据文件类型保存内容
                if (file_type === 'text/plain') {
                    // 直接使用文本内容
                    buffer = Buffer.from(content, 'utf8');
                    contentLength = buffer.length;
                } else if (file_type?.includes('wordprocessingml')) {
                    // 将Markdown格式的内容转换为增强HTML，然后生成DOCX
                    const htmlContent = convertMarkdownToEnhancedHtml(content);

                    // 使用 html-to-docx 将HTML内容转换为DOCX buffer
                    buffer = await htmlToSafeDocx(htmlContent);
                    contentLength = buffer.length;
                } else {
                    throw new Error(`不支持的文件类型: ${file_type}`);
                }

                // 上传到MinIO
                const bucketName = entries[0].minio_bucket;
                const objectName = entries[0].minio_object_name;
                await withAdvisoryLock(quotaPool, `knowledge-quota:${entries[0].user_id}`, async (connection) => {
                const [[contentUsage]] = await connection.execute(
                    'SELECT COALESCE(SUM(file_size), 0) AS used_bytes FROM knowledge_base WHERE user_id = ?',
                    [entries[0].user_id]
                );
                const projectedUsage = Number(contentUsage.used_bytes || 0) - Number(entries[0].file_size || 0) + contentLength;
                if (projectedUsage > maxKnowledgeStorageBytes) {
                    const quotaError = new Error('User knowledge-base storage quota exceeded');
                    quotaError.status = 413;
                    throw quotaError;
                }
                
                await minioClient.putObject(bucketName, objectName, buffer, contentLength, {
                    'Content-Type': file_type || 'application/octet-stream'
                });
                
                console.log(`📁 文件已更新到MinIO: ${bucketName}/${objectName}`);
                
                // 更新文件大小
                await connection.execute(
                    'UPDATE knowledge_base SET file_size = ? WHERE id = ?',
                    [contentLength, entryId]
                );
                });

            } catch (uploadError) {
                console.error('上传到MinIO失败:', uploadError);
                throw uploadError;
            }
        }

        res.json({ 
            message: '文档更新成功',
            updatedAt: new Date()
        });

    } catch (error) {
        console.error(`更新文件内容失败 ID ${entryId}:`, error);
        res.status(error.status || 500).json({ message: '更新文件内容失败' });
    }
});

// GET /api/knowledge-base/:id/download - 下载文件（默认Word格式，使用数据库最新内容）
router.get('/:id/download', async (req, res) => {
    const { id: entryId } = req.params;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    try {
        // 获取文件信息
        const [entries] = await pool.execute(
            'SELECT file_path, user_id, title, file_type, storage_type, minio_bucket, minio_object_name FROM knowledge_base WHERE id = ?',
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        // 权限检查：admin、global和readonly_global权限用户可以访问所有文件
        if (entries[0].user_id !== userId && !['global', 'readonly_global'].includes(userPermission) && userRole !== 'admin') {
            return res.status(403).json({ message: '无权访问此文件' });
        }

        const { file_path, title, file_type, storage_type, minio_bucket, minio_object_name } = entries[0];
        if (storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local document must be migrated before download' });
        }
        
        console.log(`📥 用户 ${userId} 下载文档: ${title} (ID: ${entryId})`);

        // 默认生成Word格式文档
        try {
            // 从文件读取内容
            let documentContent = '';
            
            if (file_path) {
                if (storage_type === 'minio') {
                    // 从 MinIO 读取文件
                    if (minio_bucket && minio_object_name) {
                        const objectBuffer = await minioService.getFileBuffer(minio_bucket, minio_object_name);
                        if (file_type === 'text/plain') {
                            documentContent = objectBuffer.toString('utf8');
                        } else if (file_type?.includes('wordprocessingml')) {
                            assertSafeZipBuffer(objectBuffer);
                            const result = await mammoth.extractRawText({ buffer: objectBuffer });
                            documentContent = result.value;
                        } else {
                            return res.status(415).json({ message: 'Unsupported knowledge-base file type' });
                        }
                    }
                } else {
                    // 从本地文件系统读取
                    const absolutePath = path.join(process.cwd(), file_path);
                    if (fs.existsSync(absolutePath)) {
                        if (file_type === 'text/plain') {
                            documentContent = fs.readFileSync(absolutePath, 'utf8');
                        } else if (file_type?.includes('wordprocessingml')) {
                            assertSafeZipBuffer(fs.readFileSync(absolutePath));
                            const result = await mammoth.extractRawText({ path: absolutePath });
                            documentContent = result.value;
                        }
                    }
                }
            }
            
            // 如果仍然没有内容，使用默认内容
            if (!documentContent) {
                documentContent = '此文档暂无内容。';
            }

            console.log('✅ 生成Word格式下载文件，使用最新内容');
            
            // 确保文件名有.docx扩展名
            let downloadTitle = title;
            if (!downloadTitle.toLowerCase().endsWith('.docx')) {
                downloadTitle = `${title}.docx`;
            }

            // 将内容转换为增强HTML，然后生成DOCX
            const rawHtmlContent = convertMarkdownToEnhancedHtml(documentContent);
            
            // 添加完整的HTML结构和样式
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { 
                            font-family: 'SimSun', '宋体', serif; 
                            font-size: 14pt; 
                            line-height: 1.5; 
                            margin: 0; 
                            padding: 0; 
                        }
                        p { 
                            font-family: 'SimSun', '宋体', serif; 
                            font-size: 14pt; 
                            margin: 6pt 0; 
                        }
                        div { 
                            font-family: 'SimSun', '宋体', serif; 
                            font-size: 14pt; 
                        }
                        h1 { font-size: 18pt; font-weight: bold; font-family: 'SimSun', '宋体', serif; }
                        h2 { font-size: 16pt; font-weight: bold; font-family: 'SimSun', '宋体', serif; }
                        h3 { font-size: 15pt; font-weight: bold; font-family: 'SimSun', '宋体', serif; }
                        h4 { font-size: 14pt; font-weight: bold; font-family: 'SimSun', '宋体', serif; }
                        li { font-family: 'SimSun', '宋体', serif; font-size: 14pt; }
                        td, th { font-family: 'SimSun', '宋体', serif; font-size: 14pt; }
                    </style>
                </head>
                <body>
                    ${rawHtmlContent}
                </body>
                </html>
            `;

            // 使用 html-to-docx 将HTML内容转换为DOCX buffer
            const buffer = await htmlToSafeDocx(htmlContent);

            // 设置Word文档的响应头
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadTitle)}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Length', buffer.length);
            
            // 发送生成的DOCX文件
            res.send(buffer);
            console.log('✅ Word格式文档下载成功');

        } catch (conversionError) {
            console.error('Word格式转换失败:', conversionError);
            return res.status(500).json({ 
                message: '文档格式转换失败',
                error: 'CONVERSION_ERROR'
            });
        }

    } catch (error) {
        console.error(`下载文件失败 ID ${entryId}:`, error);
        res.status(500).json({ message: '文件下载失败' });
    }
});


// 文件完整性检查辅助函数
async function checkFileIntegrity(filePath, fileType) {
    try {
        if (!fs.existsSync(filePath)) {
            return { isValid: false, error: 'FILE_NOT_FOUND', message: '文件不存在' };
        }

        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            return { isValid: false, error: 'FILE_EMPTY', message: '文件为空' };
        }

        // 检查DOCX文件的完整性
        if (fileType?.includes('wordprocessingml')) {
            try {
                if (fileType.includes('wordprocessingml')) assertSafeZipBuffer(fs.readFileSync(filePath));
                await mammoth.extractRawText({ path: filePath });
                return { isValid: true, message: '文件完整' };
            } catch (error) {
                if (error.message.includes('Corrupted zip')) {
                    return { isValid: false, error: 'FILE_CORRUPTED', message: '文件损坏（ZIP结构错误）' };
                } else if (error.message.includes('missing')) {
                    return { isValid: false, error: 'FILE_INCOMPLETE', message: '文件不完整' };
                } else {
                    return { isValid: false, error: 'FILE_READ_ERROR', message: '文件读取错误' };
                }
            }
        }

        // 对于文本文件，尝试读取
        if (fileType === 'text/plain') {
            try {
                fs.readFileSync(filePath, 'utf8');
                return { isValid: true, message: '文件完整' };
            } catch (error) {
                return { isValid: false, error: 'FILE_READ_ERROR', message: '文件读取错误' };
            }
        }

        return { isValid: true, message: '文件存在' };
    } catch (error) {
        return { isValid: false, error: 'SYSTEM_ERROR', message: '系统错误' };
    }
}

// GET /api/knowledge-base/:id/check-integrity - 检查文件完整性
router.get('/:id/check-integrity', async (req, res) => {
    const { id: entryId } = req.params;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    try {
        // 获取文件信息
        const [entries] = await pool.execute(
            `SELECT file_path, user_id, file_type, title, storage_type, minio_bucket, minio_object_name
             FROM knowledge_base WHERE id = ?`,
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        // 权限检查：admin、global和readonly_global权限用户可以访问所有文件
        if (entries[0].user_id !== userId && !['global', 'readonly_global'].includes(userPermission) && userRole !== 'admin') {
            return res.status(403).json({ message: '无权访问此文件' });
        }

        const { file_path, file_type, title } = entries[0];
        
        if (!file_path) {
            return res.json({ 
                isValid: false, 
                error: 'NO_FILE_PATH', 
                message: '此项目没有关联的文件' 
            });
        }

        if (entries[0].storage_type !== 'minio' || !entries[0].minio_bucket || !entries[0].minio_object_name) {
            return res.status(409).json({ message: 'Legacy local document must be migrated to object storage before validation' });
        }
        const integrityBuffer = await minioService.getFileBuffer(
            entries[0].minio_bucket,
            entries[0].minio_object_name
        );
        if (file_type !== 'text/plain') assertSafeZipBuffer(integrityBuffer);
        let minioIntegrity;
        try {
            if (file_type === 'text/plain') integrityBuffer.toString('utf8');
            else await mammoth.extractRawText({ buffer: integrityBuffer });
            minioIntegrity = { isValid: true, message: 'File is readable' };
        } catch {
            minioIntegrity = { isValid: false, error: 'FILE_CORRUPTED', message: 'File cannot be parsed' };
        }
        return res.json({ title, file_path, file_type, ...minioIntegrity });

    } catch (error) {
        console.error(`检查文件完整性失败 ID ${entryId}:`, error);
        res.status(500).json({ 
            message: '检查文件完整性失败',
            error: 'SYSTEM_ERROR'
        });
    }
});

// POST /api/knowledge-base/:id/restore-from-content - 从数据库内容恢复文件
router.post('/:id/restore-from-content', async (req, res) => {
    const { id: entryId } = req.params;
    const { content } = req.body;
    const { id: userId, permission: userPermission, role: userRole } = req.user;

    try {
        // 获取文件信息
        const [entries] = await pool.execute(
            `SELECT file_path, user_id, file_type, title, file_size, storage_type,
                    minio_bucket, minio_object_name
             FROM knowledge_base WHERE id = ?`,
            [entryId]
        );

        if (entries.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        // 权限检查：admin和global权限用户可以修改所有文件，readonly_global用户只能修改自己的文件
        if (entries[0].user_id !== userId && userPermission !== 'global' && userRole !== 'admin') {
            return res.status(403).json({ message: '无权修改此文件' });
        }

        const { file_path, file_type, title } = entries[0];
        
        if (!file_path) {
            return res.status(400).json({ message: '此项目没有关联的文件路径' });
        }

        if (entries[0].storage_type !== 'minio' || !entries[0].minio_bucket || !entries[0].minio_object_name) {
            return res.status(409).json({ message: 'Legacy local document must be migrated to object storage before restore' });
        }
        let restoredBuffer;
        if (file_type === 'text/plain') {
            restoredBuffer = Buffer.from(content || '', 'utf8');
        } else if (file_type?.includes('wordprocessingml')) {
            restoredBuffer = await htmlToSafeDocx(convertMarkdownToEnhancedHtml(content || ''));
        } else {
            return res.status(400).json({ message: 'Unsupported file type' });
        }
        await withAdvisoryLock(quotaPool, `knowledge-quota:${entries[0].user_id}`, async (connection) => {
            const [[restoreUsage]] = await connection.execute(
                'SELECT COALESCE(SUM(file_size), 0) AS used_bytes FROM knowledge_base WHERE user_id = ?',
                [entries[0].user_id]
            );
            const projectedUsage = Number(restoreUsage.used_bytes || 0) - Number(entries[0].file_size || 0) + restoredBuffer.length;
            if (projectedUsage > maxKnowledgeStorageBytes) {
                const quotaError = new Error('User knowledge-base storage quota exceeded');
                quotaError.status = 413;
                throw quotaError;
            }
            await minioClient.putObject(
                entries[0].minio_bucket,
                entries[0].minio_object_name,
                restoredBuffer,
                restoredBuffer.length,
                { 'Content-Type': file_type }
            );
            await connection.execute(
                'UPDATE knowledge_base SET file_size = ?, last_modified_by = ? WHERE id = ?',
                [restoredBuffer.length, userId, entryId]
            );
        });
        serverCache.delete(`content_${entryId}_${entries[0].user_id}`);
        return res.json({ message: 'File restored successfully' });

    } catch (error) {
        console.error(`恢复文件失败 ID ${entryId}:`, error);
        res.status(error.status || 500).json({
            message: '恢复文件失败',
            error: 'SYSTEM_ERROR'
        });
    }
});

module.exports = router;
