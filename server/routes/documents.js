const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const mammoth = require('mammoth');
const { htmlToSafeDocx } = require('../utils/docxExporter');
const sanitizeHtml = require('sanitize-html');
const { randomUUID } = require('node:crypto');
const { authenticateToken } = require('../middleware/auth');
const { resolveWithinRoot, sanitizeDisplayName } = require('../utils/security');
const { isAllowedProjectFile } = require('../utils/fileSignatures');
const { assertSafeZipBuffer } = require('../utils/archiveSafety');
const { createUploadGuard } = require('../middleware/uploadGuard');
const { quotaPool } = require('../config/database');
const { withAdvisoryLock } = require('../utils/advisoryLock');
const router = express.Router();
router.use(authenticateToken);

const DOCUMENTS_ROOT = path.resolve(__dirname, '../uploads/documents');
const ALLOWED_SAVE_FORMATS = new Set(['json', 'txt', 'html']);

function getDocumentsDir(req) {
  return resolveWithinRoot(DOCUMENTS_ROOT, String(req.user.id));
}

function getDocumentPath(req, filename) {
  const safeName = sanitizeDisplayName(filename);
  return resolveWithinRoot(getDocumentsDir(req), safeName);
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

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const destination = getDocumentsDir(req);
    require('fs').mkdir(destination, { recursive: true }, error => cb(error, destination));
  },
  filename: (req, file, cb) => {
    const sanitizedOriginalName = sanitizeChineseFilename(file.originalname);
    const ext = path.extname(sanitizedOriginalName);
    cb(null, `${randomUUID()}${ext.toLowerCase()}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB限制
  }
});
async function getDocumentUsageBytes(userId) {
  const directory = resolveWithinRoot(DOCUMENTS_ROOT, String(userId));
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const sizes = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
      const stats = await fs.stat(resolveWithinRoot(directory, entry.name));
      return stats.size;
    }));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

const maxDocumentStorageBytes = Number(process.env.MAX_DOCUMENT_STORAGE_BYTES || 512 * 1024 * 1024);
const documentUploadGuard = createUploadGuard({
  maxConcurrent: 1,
  maxBytes: maxDocumentStorageBytes,
  usageProvider: getDocumentUsageBytes
});

// 确保上传目录存在
const ensureUploadDir = async (req) => {
  const uploadDir = getDocumentsDir(req);
  try {
    await fs.access(uploadDir);
  } catch (error) {
    await fs.mkdir(uploadDir, { recursive: true });
  }
};

// 保存文档内容
router.post('/save', documentUploadGuard, async (req, res) => {
  try {
    const { title, content, format = 'json' } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容不能为空' });
    }

    if (!ALLOWED_SAVE_FORMATS.has(format)) {
      return res.status(400).json({ error: '不支持的文档格式' });
    }
    const safeTitle = sanitizeDisplayName(title);
    await ensureUploadDir(req);
    
    const filename = `${randomUUID()}.${format}`;
    const filepath = getDocumentPath(req, filename);
    
    // 根据格式保存文件
    let fileContent;
    if (format === 'json') {
      fileContent = JSON.stringify({ title: safeTitle, content, createdAt: new Date() }, null, 2);
    } else if (format === 'html') {
      const safeContent = sanitizeHtml(content);
      const safeHtmlTitle = sanitizeHtml(safeTitle, { allowedTags: [], allowedAttributes: {} });
      fileContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${safeHtmlTitle}</title>
            <meta charset="utf-8">
          </head>
          <body>
            ${safeContent}
          </body>
        </html>
      `;
    } else {
      fileContent = content;
    }
    
    await withAdvisoryLock(quotaPool, `document-quota:${req.user.id}`, async () => {
      const usedBytes = await getDocumentUsageBytes(req.user.id);
      const newBytes = Buffer.byteLength(fileContent, 'utf8');
      if (usedBytes + newBytes > maxDocumentStorageBytes) {
        const error = new Error('User document storage quota exceeded');
        error.status = 413;
        throw error;
      }
      await fs.writeFile(filepath, fileContent, 'utf8');
    });
    
    res.json({
      message: '文档保存成功',
      filename,
      filepath: `/api/documents/download/${filename}`
    });
  } catch (error) {
    console.error('保存文档失败:', error);
    res.status(error.status || 500).json({ error: '保存文档失败' });
  }
});

// 获取文档列表
router.get('/list', async (req, res) => {
  try {
    await ensureUploadDir(req);
    const documentsDir = getDocumentsDir(req);
    const files = await fs.readdir(documentsDir);
    
    const documents = await Promise.all(
      files.map(async (file) => {
        const filepath = getDocumentPath(req, file);
        const stats = await fs.stat(filepath);
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          downloadUrl: `/api/documents/download/${file}`
        };
      })
    );
    
    res.json(documents.sort((a, b) => b.modifiedAt - a.modifiedAt));
  } catch (error) {
    console.error('获取文档列表失败:', error);
    res.status(500).json({ error: '获取文档列表失败' });
  }
});

// 获取单个文档内容
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = getDocumentPath(req, filename);
    
    // 检查文件是否存在
    try {
      await fs.access(filepath);
    } catch (error) {
      return res.status(404).json({ error: '文档不存在' });
    }
    
    const ext = path.extname(filename).toLowerCase();
    const content = await fs.readFile(filepath, 'utf8');
    
    // 根据文件类型返回不同格式的内容
    if (ext === '.json') {
      const data = JSON.parse(content);
      res.json(data);
    } else {
      res.json({ content, filename });
    }
  } catch (error) {
    console.error('获取文档失败:', error);
    res.status(500).json({ error: '获取文档失败' });
  }
});

// 下载文档
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = getDocumentPath(req, filename);
    
    // 检查文件是否存在
    try {
      await fs.access(filepath);
    } catch (error) {
      return res.status(404).json({ error: '文档不存在' });
    }
    
    res.download(filepath, filename);
  } catch (error) {
    console.error('下载文档失败:', error);
    res.status(500).json({ error: '下载文档失败' });
  }
});

// 上传文档
router.post('/upload', documentUploadGuard, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }
    
    const { filename, originalname, mimetype, size } = req.file;
    const filepath = req.file.path;
    const fileHandle = await fs.open(filepath, 'r');
    const header = Buffer.alloc(512);
    const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
    await fileHandle.close();
    if (!isAllowedProjectFile('novel', originalname, mimetype, header.subarray(0, bytesRead))) {
      await fs.unlink(filepath);
      return res.status(400).json({ error: '文件内容与扩展名或MIME类型不匹配' });
    }
    const withinQuota = await withAdvisoryLock(quotaPool, `document-quota:${req.user.id}`, async () => (
      (await getDocumentUsageBytes(req.user.id)) <= maxDocumentStorageBytes
    ));
    if (!withinQuota) {
      await fs.unlink(filepath);
      return res.status(413).json({ error: 'User document storage quota exceeded' });
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
    
    // 处理不同格式的文件
    let content = '';
    const ext = path.extname(correctedOriginalName).toLowerCase();
    
    if (ext === '.docx') {
      assertSafeZipBuffer(await fs.readFile(filepath));
      // 使用mammoth处理docx文件
      const result = await mammoth.extractRawText({ path: filepath });
      content = result.value;
    } else if (ext === '.txt' || ext === '.html') {
      content = await fs.readFile(filepath, 'utf8');
    }
    
    res.json({
      message: '文档上传成功',
      filename: correctedOriginalName,
      content,
      uploadedFile: filename,
      downloadUrl: `/api/documents/download/${filename}`
    });
  } catch (error) {
    console.error('上传文档失败:', error);
    res.status(500).json({ error: '上传文档失败' });
  }
});

// 将HTML内容转换为DOCX
router.post('/convert/html-to-docx', documentUploadGuard, async (req, res) => {
  try {
    const { htmlContent, title = 'document' } = req.body;
    
    if (!htmlContent) {
      return res.status(400).json({ error: 'HTML内容不能为空' });
    }
    
    // 转换HTML为DOCX
    const safeTitle = sanitizeDisplayName(title);
    const docxBuffer = await htmlToSafeDocx(sanitizeHtml(htmlContent));
    
    const filename = `${randomUUID()}.docx`;
    await ensureUploadDir(req);
    const filepath = getDocumentPath(req, filename);
    
    await withAdvisoryLock(quotaPool, `document-quota:${req.user.id}`, async () => {
      const usedBytes = await getDocumentUsageBytes(req.user.id);
      if (usedBytes + docxBuffer.length > maxDocumentStorageBytes) {
        const error = new Error('User document storage quota exceeded');
        error.status = 413;
        throw error;
      }
      await fs.writeFile(filepath, docxBuffer);
    });
    
    res.json({
      message: '转换成功',
      filename,
      downloadUrl: `/api/documents/download/${filename}`
    });
  } catch (error) {
    console.error('HTML转DOCX失败:', error);
    res.status(error.status || 500).json({ error: 'HTML转DOCX失败' });
  }
});

// 删除文档
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = getDocumentPath(req, filename);
    
    try {
      await fs.access(filepath);
      await fs.unlink(filepath);
      res.json({ message: '文档删除成功' });
    } catch (error) {
      res.status(404).json({ error: '文档不存在' });
    }
  } catch (error) {
    console.error('删除文档失败:', error);
    res.status(500).json({ error: '删除文档失败' });
  }
});

// 搜索文档
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const documentsDir = getDocumentsDir(req);
    
    await ensureUploadDir(req);
    const files = await fs.readdir(documentsDir);
    
    const matchedDocuments = [];
    
    for (const file of files) {
      const filepath = getDocumentPath(req, file);
      const stats = await fs.stat(filepath);
      
      // 检查文件名是否匹配
      if (file.toLowerCase().includes(query.toLowerCase())) {
        matchedDocuments.push({
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          downloadUrl: `/api/documents/download/${file}`,
          matchType: 'filename'
        });
        continue;
      }
      
      // 检查文件内容是否匹配（仅限文本文件）
      const ext = path.extname(file).toLowerCase();
      if (['.txt', '.json', '.html'].includes(ext)) {
        try {
          const content = await fs.readFile(filepath, 'utf8');
          if (content.toLowerCase().includes(query.toLowerCase())) {
            matchedDocuments.push({
              filename: file,
              size: stats.size,
              createdAt: stats.birthtime,
              modifiedAt: stats.mtime,
              downloadUrl: `/api/documents/download/${file}`,
              matchType: 'content'
            });
          }
        } catch (error) {
          // 忽略读取错误
        }
      }
    }
    
    res.json(matchedDocuments.sort((a, b) => b.modifiedAt - a.modifiedAt));
  } catch (error) {
    console.error('搜索文档失败:', error);
    res.status(500).json({ error: '搜索文档失败' });
  }
});

module.exports = router;
