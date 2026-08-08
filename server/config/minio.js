const Minio = require('minio');
require('dotenv').config();
const { validateMinioEnv } = require('./env');

const minioConfig = validateMinioEnv(process.env);

console.log('=======================================');
console.log('  ATTEMPTING TO CONNECT WITH MINIO  ');
console.log('---------------------------------------');
console.log(`  Endpoint:  ${minioConfig.endPoint}`);
console.log(`  Port:      ${minioConfig.port}`);
console.log(`  UseSSL:    ${minioConfig.useSSL}`);
console.log(`  Region:    ${minioConfig.region}`);
console.log('=======================================');

const minioClient = new Minio.Client(minioConfig);

// 定义存储桶名称 - 使用现有的存储桶
const BUCKETS = {
    VIDEOS: minioConfig.bucket,
    DOCUMENTS: minioConfig.bucket,
    THUMBNAILS: minioConfig.bucket
};

// 测试 MinIO 连接并验证存储桶
async function testConnectionAndCreateBuckets({
    client = minioClient,
    config = minioConfig,
    logger = console
} = {}) {
    try {
        logger.log('🔗 正在测试 MinIO 连接...');
        
        // 测试连接
        await client.listBuckets();
        logger.log('✅ MinIO 连接成功');
        
        // 验证存储桶是否存在
        const mainBucket = config.bucket;
        const bucketExists = await client.bucketExists(mainBucket);
        
        if (bucketExists) {
            logger.log(`📁 存储桶已存在: ${mainBucket}`);
        } else {
            logger.log(`Creating MinIO bucket: ${mainBucket}`);
            await client.makeBucket(mainBucket, config.region);
            logger.log(`MinIO bucket created: ${mainBucket}`);
        }

        logger.log('📂 文件将按以下目录结构存储:');
        logger.log('   - videos/: 视频文件');
        logger.log('   - documents/: 文档文件');
        logger.log('   - thumbnails/: 缩略图文件');
        
        return true;
    } catch (error) {
        logger.error('❌ MinIO 连接失败:', error.message);
        return false;
    }
}

module.exports = { 
    minioClient, 
    BUCKETS, 
    testConnectionAndCreateBuckets,
    minioConfig 
};
