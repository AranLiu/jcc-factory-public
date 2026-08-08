const { minioClient, BUCKETS } = require('../config/minio');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class MinioService {
    constructor() {
        this.client = minioClient;
        this.buckets = BUCKETS;
    }

    /**
     * 上传文件到 MinIO
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称 (文件路径)
     * @param {string|Buffer|Stream} filePath - 文件路径或Buffer或Stream
     * @param {Object} metadata - 文件元数据
     * @returns {Promise<Object>} 上传结果
     */
    async uploadFile(bucketName, objectName, filePath, metadata = {}) {
        try {
            console.log(`📤 开始上传文件到 MinIO: ${bucketName}/${objectName}`);
            
            let result;
            if (typeof filePath === 'string') {
                // 从文件路径上传
                result = await this.client.fPutObject(bucketName, objectName, filePath, metadata);
            } else {
                // 从Buffer或Stream上传
                result = await this.client.putObject(bucketName, objectName, filePath, metadata);
            }
            
            console.log(`✅ 文件上传成功: ${bucketName}/${objectName}`);
            return {
                success: true,
                bucketName,
                objectName,
                etag: result.etag,
                versionId: result.versionId
            };
        } catch (error) {
            console.error(`❌ 文件上传失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`文件上传失败: ${error.message}`);
        }
    }

    /**
     * 下载文件从 MinIO
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @param {string} downloadPath - 下载路径 (可选)
     * @returns {Promise<Stream|Buffer>} 文件流或Buffer
     */
    async downloadFile(bucketName, objectName, downloadPath = null) {
        try {
            console.log(`📥 开始下载文件: ${bucketName}/${objectName}`);
            
            if (downloadPath) {
                // 下载到指定路径
                await this.client.fGetObject(bucketName, objectName, downloadPath);
                console.log(`✅ 文件下载成功: ${downloadPath}`);
                return downloadPath;
            } else {
                // 返回文件流
                const stream = await this.client.getObject(bucketName, objectName);
                console.log(`✅ 获取文件流成功: ${bucketName}/${objectName}`);
                return stream;
            }
        } catch (error) {
            console.error(`❌ 文件下载失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`文件下载失败: ${error.message}`);
        }
    }

    /**
     * 删除文件
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @returns {Promise<boolean>} 删除结果
     */
    async deleteFile(bucketName, objectName) {
        try {
            console.log(`🗑️ 开始删除文件: ${bucketName}/${objectName}`);
            await this.client.removeObject(bucketName, objectName);
            console.log(`✅ 文件删除成功: ${bucketName}/${objectName}`);
            return true;
        } catch (error) {
            console.error(`❌ 文件删除失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`文件删除失败: ${error.message}`);
        }
    }

    /**
     * 获取文件预签名 URL
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @param {number} expiry - 过期时间(秒)，默认7天
     * @returns {Promise<string>} 预签名URL
     */
    async getPresignedUrl(bucketName, objectName, expiry = 7 * 24 * 60 * 60) {
        try {
            const url = await this.client.presignedGetObject(bucketName, objectName, expiry);
            console.log(`✅ 获取预签名URL成功: ${bucketName}/${objectName}`);
            return url;
        } catch (error) {
            console.error(`❌ 获取预签名URL失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`获取预签名URL失败: ${error.message}`);
        }
    }

    /**
     * 获取文件内容为Buffer
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @returns {Promise<Buffer>} 文件内容Buffer
     */
    async getFileBuffer(bucketName, objectName, maxBytes = 64 * 1024 * 1024) {
        try {
            console.log(`📋 开始获取文件内容: ${bucketName}/${objectName}`);
            const stream = await this.client.getObject(bucketName, objectName);
            const chunks = [];
            
            return new Promise((resolve, reject) => {
                let totalBytes = 0;
                stream.on('data', (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > maxBytes) {
                        stream.destroy(new Error('Object exceeds in-memory processing limit'));
                        return;
                    }
                    chunks.push(chunk);
                });
                stream.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    console.log(`✅ 获取文件内容成功: ${bucketName}/${objectName}, 大小: ${buffer.length} bytes`);
                    resolve(buffer);
                });
                stream.on('error', (error) => {
                    console.error(`❌ 获取文件内容失败: ${bucketName}/${objectName}`, error.message);
                    reject(new Error(`获取文件内容失败: ${error.message}`));
                });
            });
        } catch (error) {
            console.error(`❌ 获取文件内容失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`获取文件内容失败: ${error.message}`);
        }
    }

    /**
     * 获取文件信息
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @returns {Promise<Object>} 文件信息
     */
    async getFileInfo(bucketName, objectName) {
        try {
            const stat = await this.client.statObject(bucketName, objectName);
            console.log(`✅ 获取文件信息成功: ${bucketName}/${objectName}`);
            return {
                size: stat.size,
                lastModified: stat.lastModified,
                etag: stat.etag,
                contentType: stat.metaData['content-type'] || 'application/octet-stream'
            };
        } catch (error) {
            console.error(`❌ 获取文件信息失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`获取文件信息失败: ${error.message}`);
        }
    }

    /**
     * 列出存储桶中的文件
     * @param {string} bucketName - 存储桶名称
     * @param {string} prefix - 文件前缀
     * @param {boolean} recursive - 是否递归
     * @returns {Promise<Array>} 文件列表
     */
    async listFiles(bucketName, prefix = '', recursive = true) {
        try {
            const files = [];
            const stream = this.client.listObjects(bucketName, prefix, recursive);
            
            return new Promise((resolve, reject) => {
                stream.on('data', (obj) => {
                    files.push({
                        name: obj.name,
                        size: obj.size,
                        lastModified: obj.lastModified,
                        etag: obj.etag
                    });
                });
                
                stream.on('end', () => {
                    console.log(`✅ 获取文件列表成功: ${bucketName} (${files.length} 个文件)`);
                    resolve(files);
                });
                
                stream.on('error', (error) => {
                    console.error(`❌ 获取文件列表失败: ${bucketName}`, error.message);
                    reject(new Error(`获取文件列表失败: ${error.message}`));
                });
            });
        } catch (error) {
            console.error(`❌ 获取文件列表失败: ${bucketName}`, error.message);
            throw new Error(`获取文件列表失败: ${error.message}`);
        }
    }

    /**
     * 生成唯一的对象名称
     * @param {string} userId - 用户ID
     * @param {string} originalName - 原始文件名
     * @param {string} type - 文件类型 (video, document, thumbnail)
     * @returns {string} 对象名称
     */
    generateObjectName(userId, originalName, type = 'file') {
        const timestamp = Date.now();
        const uuid = uuidv4().substring(0, 8);
        const ext = path.extname(originalName);
        const sanitizedName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '_');
        
        // 使用目录前缀区分不同类型的文件
        return `${type}/${userId}/${timestamp}-${uuid}-${sanitizedName}${ext}`;
    }

    /**
     * 上传视频文件
     * @param {number} userId - 用户ID
     * @param {string} filePath - 本地文件路径
     * @param {string} originalName - 原始文件名
     * @param {string} mimeType - MIME类型
     * @returns {Promise<Object>} 上传结果
     */
    async uploadVideo(userId, filePath, originalName, mimeType) {
        const objectName = this.generateObjectName(userId, originalName, 'video');
        const metadata = {
            'Content-Type': mimeType,
            'x-amz-meta-original-name': Buffer.from(originalName, 'utf8').toString('base64'),
            'x-amz-meta-user-id': userId.toString()
        };
        
        return await this.uploadFile(this.buckets.VIDEOS, objectName, filePath, metadata);
    }

    /**
     * 上传文档文件
     * @param {number} userId - 用户ID
     * @param {string} filePath - 本地文件路径
     * @param {string} originalName - 原始文件名
     * @param {string} mimeType - MIME类型
     * @returns {Promise<Object>} 上传结果
     */
    async uploadDocument(userId, filePath, originalName, mimeType) {
        const objectName = this.generateObjectName(userId, originalName, 'document');
        const metadata = {
            'Content-Type': mimeType,
            'x-amz-meta-original-name': Buffer.from(originalName, 'utf8').toString('base64'),
            'x-amz-meta-user-id': userId.toString()
        };
        
        return await this.uploadFile(this.buckets.DOCUMENTS, objectName, filePath, metadata);
    }

    /**
     * 上传缩略图文件
     * @param {number} userId - 用户ID
     * @param {string} filePath - 本地文件路径
     * @param {string} originalName - 原始文件名
     * @returns {Promise<Object>} 上传结果
     */
    async uploadThumbnail(userId, filePath, originalName) {
        const objectName = this.generateObjectName(userId, originalName, 'thumbnail');
        const metadata = {
            'Content-Type': 'image/png',
            'x-amz-meta-original-name': Buffer.from(originalName, 'utf8').toString('base64'),
            'x-amz-meta-user-id': userId.toString()
        };
        
        return await this.uploadFile(this.buckets.THUMBNAILS, objectName, filePath, metadata);
    }

    /**
     * 获取文件的临时下载URL
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @param {number} expiry - 过期时间(秒)，默认1小时
     * @returns {Promise<string>} 临时下载URL
     */
    async getTempDownloadUrl(bucketName, objectName, expiry = 3600) {
        return await this.getPresignedUrl(bucketName, objectName, expiry);
    }

    /**
     * 从本地文件系统迁移文件到 MinIO
     * @param {string} localPath - 本地文件路径
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @param {Object} metadata - 元数据
     * @returns {Promise<Object>} 迁移结果
     */
    async migrateFileFromLocal(localPath, bucketName, objectName, metadata = {}) {
        try {
            if (!fs.existsSync(localPath)) {
                throw new Error(`本地文件不存在: ${localPath}`);
            }
            
            console.log(`🔄 开始迁移文件: ${localPath} -> ${bucketName}/${objectName}`);
            
            const result = await this.uploadFile(bucketName, objectName, localPath, metadata);
            
            console.log(`✅ 文件迁移成功: ${bucketName}/${objectName}`);
            return result;
        } catch (error) {
            console.error(`❌ 文件迁移失败: ${localPath}`, error.message);
            throw error;
        }
    }

    /**
     * 获取文件的部分内容 (支持Range请求)
     * @param {string} bucketName - 存储桶名称
     * @param {string} objectName - 对象名称
     * @param {number} start - 开始字节位置
     * @param {number} end - 结束字节位置
     * @returns {Promise<Stream>} 部分内容流
     */
    async getPartialObject(bucketName, objectName, start, end) {
        try {
            console.log(`📥 开始获取部分文件内容: ${bucketName}/${objectName}, 范围: ${start}-${end}`);
            
            // 使用 MinIO 的 getPartialObject 方法
            const partialStream = await this.client.getPartialObject(bucketName, objectName, start, end - start + 1);
            
            console.log(`✅ 获取部分文件内容成功: ${bucketName}/${objectName}, 范围: ${start}-${end}`);
            return partialStream;
        } catch (error) {
            console.error(`❌ 获取部分文件内容失败: ${bucketName}/${objectName}`, error.message);
            throw new Error(`获取部分文件内容失败: ${error.message}`);
        }
    }
}

module.exports = new MinioService();
