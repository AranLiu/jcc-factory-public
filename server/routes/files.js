const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { pool, quotaPool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const minioService = require('../services/minioService');
const { deleteStoredObjects } = require('../services/objectDeletionService');
const { BUCKETS } = require('../config/minio');
const { sanitizeDisplayName } = require('../utils/security');
const { isAllowedProjectFile, projectFileFilter } = require('../utils/fileSignatures');
const { canMutateResource, canReadResource } = require('../utils/authorization');
const { probeVideoDuration } = require('../utils/videoProbe');
const { generateVideoThumbnail } = require('../utils/videoThumbnail');
const { createUploadGuard } = require('../middleware/uploadGuard');
const { withAdvisoryLock } = require('../utils/advisoryLock');

// 从文件名中提取集数
function extractEpisodeNumber(filename) {
    console.log('📱 开始提取集数:', filename);
    
    // 移除文件扩展名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    console.log('📱 去除扩展名后:', nameWithoutExt);
    
    // 尝试匹配各种格式的数字
    const patterns = [
        /第(\d+)集/,           // 第X集
        /第(\d+)话/,           // 第X话
        /(\d+)集/,             // X集
        /(\d+)话/,             // X话
        /ep(\d+)/i,            // epX
        /episode(\d+)/i,       // episodeX
        /(\d+)/,               // 纯数字（作为后备选项）
    ];
    
    for (const pattern of patterns) {
        const match = nameWithoutExt.match(pattern);
        if (match && match[1]) {
            const episodeNum = parseInt(match[1]);
            console.log('📱 提取到集数:', episodeNum, '匹配模式:', pattern);
            return episodeNum;
        }
    }
    
    console.log('📱 未找到集数');
    return null;
}

const router = express.Router();

// 辅助函数：为相对路径生成完整的URL，并处理Windows路径
const getFullUrl = (req, filePath) => {
  if (!filePath) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return filePath.startsWith('http') ? filePath : `${baseUrl}/${filePath}`;
};

// 辅助函数：为视频流生成带token的专用URL
const getVideoStreamUrl = (req, fileId) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/api/files/stream/${fileId}`;
};

// 辅助函数：获取视频时长
const getVideoDuration = (filePath) => {
    return probeVideoDuration(filePath, { ffprobePath });
};

// 辅助函数：更新项目最后操作时间和操作人
const updateProjectLastOperation = async (projectId, userId, executor = pool) => {
    try {
        await executor.execute(
            'UPDATE projects SET last_operation_at = NOW(), last_operator_id = ? WHERE id = ?',
            [userId, projectId]
        );
    } catch (error) {
        console.warn('更新项目最后操作时间失败:', error);
    }
};

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

// 所有路由都需要认证
router.use(authenticateToken);

// 配置multer存储 - 使用临时目录
const uploadDir = path.join(process.cwd(), 'temp_uploads');

// 确保临时上传目录存在
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置multer存储 - 临时存储到本地，然后上传到 MinIO
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 基于用户ID创建临时子目录
        const userDir = path.join(uploadDir, String(req.user.id));
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const sanitizedOriginalName = sanitizeChineseFilename(file.originalname);
        const ext = path.extname(sanitizedOriginalName);
        cb(null, `${uuidv4()}${ext.toLowerCase()}`);
    }
});

// 文件过滤器
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB文件大小限制
        fieldSize: 10 * 1024 * 1024,  // 10MB字段大小限制
    },
    fileFilter: projectFileFilter
});

const maxUserStorageBytes = Number(process.env.MAX_USER_STORAGE_BYTES || 5 * 1024 * 1024 * 1024);
const projectUploadGuard = createUploadGuard({
    maxConcurrent: Number(process.env.MAX_CONCURRENT_UPLOADS_PER_USER || 2),
    maxBytes: maxUserStorageBytes
});

// 文件上传 - 使用 MinIO 存储
router.post('/upload', authenticateToken, projectUploadGuard, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '没有上传文件' });
    }

    // 获取用户权限
    const userPermission = req.user.permission || 'personal';

    const { projectId } = req.body;
    const { id: userId } = req.user;
    const { originalname, mimetype, size, path: filePath, filename } = req.file;

    const fileDescriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(512);
    const bytesRead = fs.readSync(fileDescriptor, header, 0, header.length, 0);
    fs.closeSync(fileDescriptor);
    // 验证项目权限
    if (!projectId) {
        // 清理已上传的文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return res.status(400).json({ message: '项目ID不能为空' });
    }

    let quotaOwnerId;
    let authoritativeProjectType;
    try {
        // 检查项目是否存在及权限
        let sql, params;
        if (userPermission === 'global' || req.user.role === 'admin') {
            // 全局权限或管理员：可以向任何项目上传文件
            sql = 'SELECT id, user_id, type FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // 个人权限：只能向自己的项目上传文件
            sql = 'SELECT id, user_id, type FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, userId];
        }

        const [projects] = await pool.execute(sql, params);
        if (projects.length === 0) {
            // 清理已上传的文件
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return res.status(404).json({ message: '项目不存在或无权访问' });
        }
        quotaOwnerId = projects[0].user_id;
        authoritativeProjectType = projects[0].type;
    } catch (error) {
        // 清理已上传的文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        console.error('项目权限验证失败:', error);
        return res.status(500).json({ message: '项目权限验证失败' });
    }

    if (!isAllowedProjectFile(authoritativeProjectType, originalname, mimetype, header.subarray(0, bytesRead))) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ message: 'File content, extension, or project type does not match' });
    }
    
    // 修复文件名编码问题
    let correctedOriginalName = originalname;
    try {
        // 检查是否存在编码问题
        if (originalname && (originalname.includes('Ã') || originalname.includes('â') || originalname.includes('æ') || originalname.includes('è'))) {
            console.log(`检测到乱码文件名: ${originalname}`);
            const buffer = Buffer.from(originalname, 'latin1');
            correctedOriginalName = buffer.toString('utf8');
            console.log(`修复后文件名: ${correctedOriginalName}`);
        }
    } catch (error) {
        console.warn('文件名编码修复失败:', error);
    }

    let duration = null;
    let thumbnailObjectName = null;
    let minioUploadResult = null;
    let thumbnailUploadResult = null;

    try {
        await withAdvisoryLock(quotaPool, `project-quota:${quotaOwnerId}`, async (connection) => {
        const [[usage]] = await connection.execute(`
            SELECT COALESCE(SUM(f.file_size), 0) AS used_bytes
            FROM files f JOIN projects p ON p.id = f.project_id
            WHERE p.user_id = ?
        `, [quotaOwnerId]);
        if (Number(usage.used_bytes || 0) + size > maxUserStorageBytes) {
            const quotaError = new Error('User project storage quota exceeded');
            quotaError.status = 413;
            throw quotaError;
        }
        // 上传主文件到 MinIO
        console.log('📤 开始上传文件到 MinIO...');
        if (mimetype.startsWith('video/')) {
            minioUploadResult = await minioService.uploadVideo(quotaOwnerId, filePath, correctedOriginalName, mimetype);
        } else {
            // 对于非视频文件，使用通用上传方法
            const objectName = minioService.generateObjectName(quotaOwnerId, correctedOriginalName, 'file');
            const metadata = {
                'Content-Type': mimetype,
                'x-amz-meta-original-name': Buffer.from(correctedOriginalName, 'utf8').toString('base64'),
                'x-amz-meta-user-id': quotaOwnerId.toString()
            };
            minioUploadResult = await minioService.uploadFile(
                mimetype.startsWith('video/') ? BUCKETS.VIDEOS : BUCKETS.DOCUMENTS,
                objectName,
                filePath,
                metadata
            );
        }

        // 如果是视频文件，提取时长和缩略图
        if (mimetype.startsWith('video/')) {
            try {
                // 设置较短的超时时间获取视频时长
                duration = await Promise.race([
                    getVideoDuration(filePath),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('获取视频时长超时')), 10000)
                    )
                ]);
            } catch (error) {
                console.warn('获取视频时长失败:', error.message);
                duration = null;
            }

            // 生成缩略图
            const thumbnailFilename = `thumb-${path.basename(filePath, path.extname(filePath))}.png`;
            const thumbnailPath = path.join(path.dirname(filePath), thumbnailFilename);
            
            try {
                await generateVideoThumbnail(filePath, thumbnailPath);
                if (fs.existsSync(thumbnailPath)) {
                    console.log('📤 开始上传缩略图到 MinIO...');
                    thumbnailUploadResult = await minioService.uploadThumbnail(quotaOwnerId, thumbnailPath, thumbnailFilename);
                    thumbnailObjectName = thumbnailUploadResult.objectName;
                    
                    // 删除本地缩略图文件
                    fs.unlinkSync(thumbnailPath);
                }
            } catch (error) {
                console.warn('缩略图生成失败，将跳过:', error.message);
                thumbnailObjectName = null; // 如果缩略图生成失败，继续上传流程
            }
        }

        // 将文件信息存入数据库 - 使用 MinIO 对象名称而不是本地路径
        const [result] = await connection.execute(
            'INSERT INTO files (project_id, original_name, filename, mime_type, file_size, file_path, duration, thumbnail_path, minio_bucket, minio_object_name, minio_thumbnail_bucket, minio_thumbnail_object, storage_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                projectId, 
                correctedOriginalName, 
                filename, 
                mimetype, 
                size, 
                minioUploadResult.objectName, // 使用 MinIO 对象名称
                duration, 
                thumbnailObjectName, // 缩略图对象名称
                minioUploadResult.bucketName, // MinIO 存储桶
                minioUploadResult.objectName, // MinIO 对象名称
                thumbnailUploadResult ? thumbnailUploadResult.bucketName : null, // 缩略图存储桶
                thumbnailObjectName, // 缩略图对象名称
                'minio' // 存储类型
            ]
        );

        // 清理临时文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // 更新项目最后操作时间和操作人
        await updateProjectLastOperation(projectId, userId, connection);

        res.status(201).json({ 
            message: '文件上传成功', 
            fileId: result.insertId,
            file: {
                id: result.insertId,
                project_id: projectId,
                user_id: quotaOwnerId,
                original_name: correctedOriginalName,
                mime_type: mimetype,
                file_size: size,
                file_path: minioUploadResult.objectName,
                stream_url: mimetype.startsWith('video/') ? `/api/files/${result.insertId}/stream` : null,
                duration: duration,
                thumbnail_path: thumbnailObjectName,
                uploaded_at: new Date().toISOString(),
                task_status: 'pending', // Add initial status
                minio_bucket: minioUploadResult.bucketName,
                minio_object_name: minioUploadResult.objectName
            }
        });
        });

    } catch (error) {
        console.error('文件上传处理失败:', error);
        
        // 如果发生错误，清理已上传的文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        // 如果已经上传到 MinIO，尝试删除
        if (minioUploadResult) {
            try {
                await minioService.deleteFile(minioUploadResult.bucketName, minioUploadResult.objectName);
            } catch (deleteError) {
                console.warn('清理 MinIO 文件失败:', deleteError.message);
            }
        }
        
        if (thumbnailUploadResult) {
            try {
                await minioService.deleteFile(thumbnailUploadResult.bucketName, thumbnailUploadResult.objectName);
            } catch (deleteError) {
                console.warn('清理 MinIO 缩略图失败:', deleteError.message);
            }
        }
        
        res.status(error.status || 500).json({ message: '文件上传失败' });
    }
});

// 重命名文件
router.put('/:id/rename', async (req, res) => {
    const { id: fileId } = req.params;
    const { name } = req.body;
    const { id: userId } = req.user;

    let safeName;
    try {
        safeName = sanitizeDisplayName(name);
    } catch {
        return res.status(400).json({ message: '文件名无效，不能包含路径或控制字符' });
    }

    try {
        // 验证所有权
        const [files] = await pool.execute(
            `SELECT f.project_id, p.user_id 
             FROM files f
             JOIN projects p ON f.project_id = p.id
             WHERE f.id = ?`,
            [fileId]
        );
        if (files.length === 0) return res.status(404).json({ message: '文件不存在' });
        // 允许admin全局修改
        if (!canMutateResource(req.user, files[0].user_id)) {
            return res.status(403).json({ message: '无权修改此文件' });
        }

        // 更新文件名
        await pool.execute(
            'UPDATE files SET original_name = ? WHERE id = ?',
            [safeName, fileId]
        );

        // 更新项目最后操作时间和操作人
        await updateProjectLastOperation(files[0].project_id, userId);

        res.json({ message: '文件名更新成功' });
    } catch (error) {
        console.error('重命名文件失败:', error);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

// 切换文件处理完成标记
router.put('/:id/mark-done', async (req, res) => {
    const { id: fileId } = req.params;
    const { done } = req.body;
    const { id: userId } = req.user;

    if (typeof done !== 'boolean') {
        return res.status(400).json({ message: '参数 done 需要为布尔值' });
    }

    try {
        // 验证所有权
        const [files] = await pool.execute(
            `SELECT f.project_id, p.user_id 
             FROM files f
             JOIN projects p ON f.project_id = p.id
             WHERE f.id = ?`,
            [fileId]
        );
        if (files.length === 0) return res.status(404).json({ message: '文件不存在' });
        // 允许admin全局修改
        if (!canMutateResource(req.user, files[0].user_id)) {
            return res.status(403).json({ message: '无权修改此文件' });
        }

        // 更新标记
        if (done) {
            await pool.execute(
                'UPDATE files SET mark_done = 1, mark_done_by = ?, mark_done_at = NOW() WHERE id = ?',
                [userId, fileId]
            );
        } else {
            await pool.execute(
                'UPDATE files SET mark_done = 0, mark_done_by = NULL, mark_done_at = NULL WHERE id = ?',
                [fileId]
            );
        }

        // 更新项目最后操作时间和操作人
        await updateProjectLastOperation(files[0].project_id, userId);

        // 返回最新状态
        const [updated] = await pool.execute('SELECT id, mark_done, mark_done_by, mark_done_at FROM files WHERE id = ?', [fileId]);
        res.json({ 
            success: true,
            file: updated[0]
        });
    } catch (error) {
        console.error('更新处理完成标记失败:', error);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

// 删除文件
router.delete('/:id', async (req, res) => {
    const { id: fileId } = req.params;
    const { id: userId } = req.user;

    try {
        // 验证所有权并获取文件路径
        const [files] = await pool.execute(
            `SELECT f.file_path, f.thumbnail_path, f.project_id, p.user_id, 
                    f.storage_type, f.minio_bucket, f.minio_object_name, 
                    f.minio_thumbnail_bucket, f.minio_thumbnail_object 
             FROM files f
             JOIN projects p ON f.project_id = p.id
             WHERE f.id = ?`,
            [fileId]
        );

        if (files.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }
        // 允许admin全局删除
        if (!canMutateResource(req.user, files[0].user_id)) {
            return res.status(403).json({ message: '无权操作此文件' });
        }

        const { 
            file_path, 
            thumbnail_path, 
            project_id, 
            storage_type, 
            minio_bucket, 
            minio_object_name, 
            minio_thumbnail_bucket, 
            minio_thumbnail_object 
        } = files[0];

        if (storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local file must be migrated before deletion' });
        }

        if (!minio_bucket || !minio_object_name) {
            return res.status(409).json({ message: 'Object storage metadata is incomplete' });
        }
        if (Boolean(minio_thumbnail_bucket) !== Boolean(minio_thumbnail_object)) {
            return res.status(409).json({ message: 'Thumbnail storage metadata is incomplete' });
        }

        await deleteStoredObjects(minioService, [
            { bucket: minio_bucket, object: minio_object_name },
            { bucket: minio_thumbnail_bucket, object: minio_thumbnail_object }
        ]);
        
        // 从数据库删除记录
        await pool.execute('DELETE FROM files WHERE id = ?', [fileId]);
        
        // 更新项目最后操作时间和操作人
        await updateProjectLastOperation(project_id, userId);

        res.status(200).json({ message: '文件删除成功' });
    } catch (error) {
        console.error('删除文件失败:', error);
        const status = error.code === 'OBJECT_STORAGE_DELETE_FAILED' ? 502 : 500;
        res.status(status).json({ message: '服务器内部错误' });
    }
});

// 获取文件列表
router.get('/project/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        // 验证项目权限（NULL视为personal权限）
        const userPermission = req.user.permission || 'personal';
        let sql, params;
        
        if (userPermission === 'global' || userPermission === 'readonly_global') {
            // 全局权限：可以访问任何项目的文件
            sql = 'SELECT id FROM projects WHERE id = ?';
            params = [projectId];
        } else {
            // 个人权限：只能访问自己的项目文件
            sql = 'SELECT id FROM projects WHERE id = ? AND user_id = ?';
            params = [projectId, req.user.id];
        }

        const [projects] = await pool.execute(sql, params);

        if (projects.length === 0) {
            return res.status(404).json({ message: '项目不存在或无权访问' });
        }

        const [files] = await pool.execute(
            'SELECT * FROM files WHERE project_id = ? ORDER BY uploaded_at DESC',
            [projectId]
        );

        const processedFiles = files.map(file => ({
            ...file,
            file_path: file.file_path,
            stream_url: file.mime_type.startsWith('video/') ? `/api/files/${file.id}/stream` : null,
            thumbnail_path: file.thumbnail_path
        }));

        res.json({ files: processedFiles });
    } catch (error) {
        console.error('获取文件列表错误:', error);
        res.status(500).json({ message: '获取文件列表失败' });
    }
});

// 文件下载/预览
router.get('/:fileId/download', async (req, res) => {
    try {
        const { fileId } = req.params;

        // 获取文件信息并验证权限
        const [files] = await pool.execute(`
            SELECT f.*, p.user_id 
            FROM files f 
            JOIN projects p ON f.project_id = p.id 
            WHERE f.id = ?
        `, [fileId]);

        if (files.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        const file = files[0];
        
        // 权限检查：允许文件所有者、管理员和全局权限用户访问
        const isFileOwner = file.user_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const hasGlobalPermission = ['global', 'readonly_global'].includes(req.user.permission);
        const hasPermission = canReadResource(req.user, file.user_id);
        
        if (!hasPermission) {
            console.log('❌ 文件下载权限不足:', {
                file_user_id: file.user_id,
                current_user_id: req.user.id,
                user_role: req.user.role,
                user_permission: req.user.permission
            });
            return res.status(403).json({ message: '没有权限访问此文件' });
        }

        // 设置响应头
        if (file.storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local file must be migrated before download' });
        }
        res.setHeader('Content-Type', file.mime_type);
        res.setHeader('Content-Length', file.file_size);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);

        // 根据存储类型获取文件流
        if (file.storage_type === 'minio') {
            if (!file.minio_bucket || !file.minio_object_name) {
                return res.status(404).json({ message: '文件信息不完整' });
            }
            
            try {
                // 从 MinIO 获取文件流
                const fileStream = await minioService.downloadFile(file.minio_bucket, file.minio_object_name);
                fileStream.pipe(res);
            } catch (error) {
                console.error('从 MinIO 下载文件失败:', error);
                return res.status(500).json({ message: '文件下载失败' });
            }
        } else {
            // 本地文件系统
            if (!fs.existsSync(file.file_path)) {
                return res.status(404).json({ message: '文件不存在' });
            }
            
            // 流式传输文件
            const fileStream = fs.createReadStream(file.file_path);
            fileStream.pipe(res);
        }
    } catch (error) {
        console.error('文件下载错误:', error);
        res.status(500).json({ message: '文件下载失败' });
    }
});

// 更新文件的解析结果
router.put('/:id/analysis-result', authenticateToken, async (req, res) => {
    const { id: fileId } = req.params;
    const { result } = req.body;
    
    // 验证用户信息
    if (!req.user || !req.user.id) {
        console.error('🔐 用户身份验证信息缺失:', req.user);
        return res.status(401).json({ message: '用户身份验证失败' });
    }
    
    const { id: userId, role: userRole } = req.user;

    console.log('📝 开始更新解析结果:', { 
        fileId, 
        userId, 
        userRole,
        resultLength: result ? result.length : 0 
    });

    if (!result) {
        return res.status(400).json({ message: '解析结果不能为空' });
    }

    try {
        // 验证文件所有权
        const [files] = await pool.execute(
            `SELECT f.id, f.original_name, p.user_id, p.name as project_name
             FROM files f
             JOIN projects p ON f.project_id = p.id
             WHERE f.id = ?`,
            [fileId]
        );

        if (files.length === 0) {
            console.log('❌ 文件不存在:', fileId);
            return res.status(404).json({ message: '文件不存在' });
        }

        const file = files[0];
        console.log('📋 文件信息:', {
            fileId: file.id,
            fileName: file.original_name,
            projectName: file.project_name,
            fileOwnerId: file.user_id,
            currentUserId: userId,
            isAdmin: userRole === 'admin'
        });

        // 权限检查：文件所有者或管理员可以修改
        const hasPermission = canMutateResource(req.user, file.user_id);
        if (!hasPermission) {
            console.log('❌ 权限不足:', {
                fileOwnerId: file.user_id,
                currentUserId: userId,
                userRole: userRole
            });
            return res.status(403).json({ message: '无权修改此文件' });
        }

        // 手动编辑时保持用户输入的内容，不自动添加集数前缀
        let processedResult = result;

        // 查找该文件的视频解析任务记录（只更新视频解析结果）
        const [tasks] = await pool.execute(
            'SELECT id, task_type FROM ai_tasks WHERE file_id = ? AND task_type = ? ORDER BY created_at DESC LIMIT 1',
            [fileId, 'video_analysis']
        );

        if (tasks.length > 0) {
            // 更新现有的视频解析任务结果
            console.log('🔄 更新现有视频解析任务记录:', tasks[0].id, '类型:', tasks[0].task_type);
            await pool.execute(
                'UPDATE ai_tasks SET result = ?, status = "completed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                [processedResult, tasks[0].id]
            );
        } else {
            // 如果没有任务记录，创建一个新的
            console.log('➕ 创建新的任务记录');
            const [projects] = await pool.execute(
                'SELECT id FROM projects WHERE id = (SELECT project_id FROM files WHERE id = ?)',
                [fileId]
            );
            
            if (projects.length > 0) {
                await pool.execute(
                    'INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, completed_at) VALUES (?, ?, ?, ?, "completed", "video_analysis", CURRENT_TIMESTAMP)',
                    [projects[0].id, fileId, '手动编辑', processedResult]
                );
                console.log('✅ 新任务记录创建成功');
            } else {
                console.error('❌ 找不到对应的项目:', fileId);
                return res.status(404).json({ message: '找不到对应的项目' });
            }
        }

        console.log('✅ 解析结果更新成功:', {
            fileId,
            fileName: file.original_name,
            userId
        });

        res.json({ 
            success: true,
            message: '解析结果更新成功' 
        });
    } catch (error) {
        console.error('❌ 更新解析结果失败:', {
            fileId,
            userId,
            errorCode: error.code || error.name,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false,
            message: '服务器内部错误'
        });
    }
});

// 处理视频流的OPTIONS预检请求
router.options('/:fileId/stream', (req, res) => {
    console.log('🔧 处理OPTIONS预检请求');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24小时
    res.status(204).end();
});

// 视频流服务 - 会话认证由路由中间件统一处理。
router.get('/:fileId/stream', async (req, res) => {
    try {
        const { fileId } = req.params;
        const range = req.headers.range;
        
        console.log('🎬 视频流请求:', {
            fileId,
            method: req.method,
            userAgent: req.headers['user-agent']?.substring(0, 50),
            hasRange: !!range
        });

        // 获取文件信息并验证权限
        const [files] = await pool.execute(`
            SELECT f.*, p.user_id 
            FROM files f 
            JOIN projects p ON f.project_id = p.id 
            WHERE f.id = ?
        `, [fileId]);

        if (files.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        const file = files[0];
        
        const currentUser = req.user;
        
        // 验证权限 - 允许以下用户访问：
        // 1. 文件所有者
        // 2. 管理员 (role = 'admin')
        // 3. 全局权限用户 (permission = 'global' 或 'readonly_global')
        const isFileOwner = file.user_id === currentUser.id;
        const isAdmin = currentUser.role === 'admin';
        const hasGlobalPermission = ['global', 'readonly_global'].includes(currentUser.permission);
        const hasPermission = canReadResource(currentUser, file.user_id);
        
        if (!hasPermission) {
            console.log('❌ 权限不足:', {
                required_user_id: file.user_id,
                current_user_id: currentUser.id,
                current_username: currentUser.username,
                current_role: currentUser.role,
                current_permission: currentUser.permission,
                is_file_owner: isFileOwner,
                is_admin: isAdmin,
                has_global_permission: hasGlobalPermission
            });
            return res.status(403).json({ message: '没有权限访问此文件' });
        }
        
        let accessReason = 'unknown';
        if (isFileOwner) accessReason = '文件所有者';
        else if (isAdmin) accessReason = '管理员';
        else if (hasGlobalPermission) accessReason = '全局权限用户';
        
        console.log('✅ 权限验证通过:', { hasPermission, reason: accessReason });

        // 只处理视频文件
        if (!file.mime_type.startsWith('video/')) {
            return res.status(400).json({ message: '此接口仅支持视频文件' });
        }

        const fileSize = file.file_size;
        if (file.storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local file must be migrated before streaming' });
        }

        // 根据存储类型处理文件流
        if (file.storage_type === 'minio') {
            // MinIO 存储的文件
            if (!file.minio_bucket || !file.minio_object_name) {
                return res.status(404).json({ message: '文件信息不完整' });
            }

            try {
                // 使用服务器代理而不是重定向，避免 CSP 问题
                console.log('📹 通过服务器代理 MinIO 视频流');
                
                // 设置正确的响应头
                res.setHeader('Content-Type', file.mime_type);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Cache-Control', 'private, no-store');
                
                if (range) {
                    // 处理 Range 请求
                    console.log('📹 处理 Range 请求:', range);
                    
                    // 解析 Range 头部
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    
                    // 验证范围
                    if (start >= fileSize || end >= fileSize || start > end) {
                        res.status(416).send('Requested range not satisfiable');
                        return;
                    }
                    
                    const chunkSize = (end - start) + 1;
                    
                    // 从 MinIO 获取部分内容
                    const partialStream = await minioService.getPartialObject(file.minio_bucket, file.minio_object_name, start, end);
                    
                    // 设置 206 Partial Content 响应头
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                    res.setHeader('Content-Length', chunkSize);
                    res.status(206);
                    
                    // 转发部分内容流
                    partialStream.pipe(res);
                } else {
                    // 完整文件响应
                    const fileStream = await minioService.downloadFile(file.minio_bucket, file.minio_object_name);
                    res.setHeader('Content-Length', fileSize);
                    res.status(200);
                    
                    // 转发完整文件流
                    fileStream.pipe(res);
                }
                
            } catch (error) {
                console.error('❌ MinIO 视频流代理失败:', error);
                return res.status(500).json({ message: '视频流服务失败' });
            }
        } else {
            // 本地文件系统
            if (!fs.existsSync(file.file_path)) {
                return res.status(404).json({ message: '文件不存在' });
            }

            if (range) {
                // 处理Range请求，支持视频的seeking
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                    res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
                    return;
                }

                const chunksize = (end - start) + 1;
                const fileStream = fs.createReadStream(file.file_path, {start, end});
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': file.mime_type,
                    'Cache-Control': 'private, no-store',
                };

                res.writeHead(206, head);
                fileStream.pipe(res);
            } else {
                // 完整文件响应
                const head = {
                    'Content-Length': fileSize,
                    'Content-Type': file.mime_type,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'private, no-store',
                };
                res.writeHead(200, head);
                fs.createReadStream(file.file_path).pipe(res);
            }
        }
    } catch (error) {
        console.error('视频流服务错误:', error);
        res.status(500).json({ message: '视频流服务失败' });
    }
});

// 缩略图访问服务 - 提供认证后的缩略图访问
router.get('/:fileId/thumbnail', async (req, res) => {
    try {
        const { fileId } = req.params;
        

        // 获取文件信息并验证权限
        const [files] = await pool.execute(`
            SELECT f.thumbnail_path, f.minio_thumbnail_bucket, f.minio_thumbnail_object, f.storage_type, p.user_id 
            FROM files f 
            JOIN projects p ON f.project_id = p.id 
            WHERE f.id = ?
        `, [fileId]);

        if (files.length === 0) {
            return res.status(404).json({ message: '文件不存在' });
        }

        const file = files[0];
        
        const currentUser = req.user;
        
        // 验证权限 - 允许以下用户访问：
        // 1. 文件所有者
        // 2. 管理员 (role = 'admin')
        // 3. 全局权限用户 (permission = 'global' 或 'readonly_global')
        const isFileOwner = file.user_id === currentUser.id;
        const isAdmin = currentUser.role === 'admin';
        const hasGlobalPermission = ['global', 'readonly_global'].includes(currentUser.permission);
        const hasPermission = canReadResource(currentUser, file.user_id);
        
        if (!hasPermission) {
            console.log('❌ 缩略图访问权限不足:', {
                file_user_id: file.user_id,
                current_user_id: currentUser.id,
                user_role: currentUser.role,
                user_permission: currentUser.permission
            });
            return res.status(403).json({ message: '没有权限访问此文件' });
        }

        // 检查是否有缩略图
        if (!file.thumbnail_path && !file.minio_thumbnail_object) {
            return res.status(404).json({ message: '缩略图不存在' });
        }

        // 设置响应头
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'private, no-store');
        if (file.storage_type !== 'minio') {
            return res.status(409).json({ message: 'Legacy local thumbnail must be migrated before access' });
        }

        // 根据存储类型获取缩略图
        if (file.storage_type === 'minio' && file.minio_thumbnail_bucket && file.minio_thumbnail_object) {
            try {
                console.log('📥 从 MinIO 获取缩略图:', file.minio_thumbnail_bucket, file.minio_thumbnail_object);
                const thumbnailStream = await minioService.downloadFile(file.minio_thumbnail_bucket, file.minio_thumbnail_object);
                thumbnailStream.pipe(res);
            } catch (error) {
                console.error('❌ 从 MinIO 获取缩略图失败:', error);
                return res.status(500).json({ message: '缩略图获取失败' });
            }
        } else if (file.thumbnail_path && fs.existsSync(file.thumbnail_path)) {
            // 本地文件系统
            console.log('📥 从本地获取缩略图:', file.thumbnail_path);
            const thumbnailStream = fs.createReadStream(file.thumbnail_path);
            thumbnailStream.pipe(res);
        } else {
            return res.status(404).json({ message: '缩略图文件不存在' });
        }
    } catch (error) {
        console.error('缩略图服务错误:', error);
        res.status(500).json({ message: '缩略图服务失败' });
    }
});

module.exports = router;
