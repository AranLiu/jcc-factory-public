// 直接设置数据库密码

const { pool } = require('../config/database');

async function checkColumnExists(tableName, columnName) {
    const [columns] = await pool.execute(
        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE table_name = ? AND table_schema = 'jcc_factory' AND column_name = ?`,
        [tableName, columnName]
    );
    return columns[0].count > 0;
}

async function checkIndexExists(tableName, indexName) {
    const [indexes] = await pool.execute(
        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.STATISTICS 
         WHERE table_name = ? AND table_schema = 'jcc_factory' AND index_name = ?`,
        [tableName, indexName]
    );
    return indexes[0].count > 0;
}

async function addColumnIfNotExists(tableName, columnName, columnDefinition) {
    const exists = await checkColumnExists(tableName, columnName);
    if (!exists) {
        console.log(`➕ 添加字段 ${tableName}.${columnName}`);
        await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
        console.log(`✅ 字段 ${tableName}.${columnName} 添加成功`);
    } else {
        console.log(`⚠️  字段 ${tableName}.${columnName} 已存在，跳过`);
    }
}

async function addIndexIfNotExists(tableName, indexName, indexDefinition) {
    const exists = await checkIndexExists(tableName, indexName);
    if (!exists) {
        console.log(`➕ 添加索引 ${tableName}.${indexName}`);
        await pool.execute(`ALTER TABLE ${tableName} ADD INDEX ${indexDefinition}`);
        console.log(`✅ 索引 ${tableName}.${indexName} 添加成功`);
    } else {
        console.log(`⚠️  索引 ${tableName}.${indexName} 已存在，跳过`);
    }
}

async function runMigration() {
    try {
        console.log('🔄 开始数据库迁移...');
        
        // 为 files 表添加 MinIO 相关字段
        console.log('\n📁 处理 files 表字段...');
        await addColumnIfNotExists('files', 'minio_bucket', 
            "minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称'");
        await addColumnIfNotExists('files', 'minio_object_name', 
            "minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称'");
        await addColumnIfNotExists('files', 'minio_thumbnail_bucket', 
            "minio_thumbnail_bucket VARCHAR(100) COMMENT 'MinIO 缩略图存储桶名称'");
        await addColumnIfNotExists('files', 'minio_thumbnail_object', 
            "minio_thumbnail_object VARCHAR(500) COMMENT 'MinIO 缩略图对象名称'");
        await addColumnIfNotExists('files', 'storage_type', 
            "storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型'");

        // 为 knowledge_base 表添加 MinIO 相关字段
        console.log('\n📚 处理 knowledge_base 表字段...');
        await addColumnIfNotExists('knowledge_base', 'minio_bucket', 
            "minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称'");
        await addColumnIfNotExists('knowledge_base', 'minio_object_name', 
            "minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称'");
        await addColumnIfNotExists('knowledge_base', 'storage_type', 
            "storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型'");

        // 为 files 表添加索引
        console.log('\n📁 处理 files 表索引...');
        await addIndexIfNotExists('files', 'idx_storage_type', 
            'idx_storage_type (storage_type)');
        await addIndexIfNotExists('files', 'idx_minio_bucket', 
            'idx_minio_bucket (minio_bucket)');
        await addIndexIfNotExists('files', 'idx_minio_object_name', 
            'idx_minio_object_name (minio_object_name)');

        // 为 knowledge_base 表添加索引
        console.log('\n📚 处理 knowledge_base 表索引...');
        await addIndexIfNotExists('knowledge_base', 'idx_kb_storage_type', 
            'idx_kb_storage_type (storage_type)');
        await addIndexIfNotExists('knowledge_base', 'idx_kb_minio_bucket', 
            'idx_kb_minio_bucket (minio_bucket)');
        await addIndexIfNotExists('knowledge_base', 'idx_kb_minio_object_name', 
            'idx_kb_minio_object_name (minio_object_name)');

        // 更新现有记录的存储类型为 'local'
        console.log('\n🔄 更新现有记录的存储类型...');
        const [filesResult] = await pool.execute(
            "UPDATE files SET storage_type = 'local' WHERE storage_type IS NULL"
        );
        console.log(`✅ 更新了 ${filesResult.affectedRows} 条 files 记录`);

        const [kbResult] = await pool.execute(
            "UPDATE knowledge_base SET storage_type = 'local' WHERE storage_type IS NULL"
        );
        console.log(`✅ 更新了 ${kbResult.affectedRows} 条 knowledge_base 记录`);

        console.log('\n✅ 数据库迁移完成！');
        
        // 验证迁移结果
        console.log('\n🔍 验证迁移结果...');
        
        // 检查 files 表的新字段
        const [filesColumns] = await pool.execute("SHOW COLUMNS FROM files LIKE 'minio_%'");
        console.log(`📁 files 表新增字段数量: ${filesColumns.length}`);
        filesColumns.forEach(col => {
            console.log(`   - ${col.Field}: ${col.Type}`);
        });
        
        // 检查 knowledge_base 表的新字段
        const [kbColumns] = await pool.execute("SHOW COLUMNS FROM knowledge_base LIKE 'minio_%'");
        console.log(`📚 knowledge_base 表新增字段数量: ${kbColumns.length}`);
        kbColumns.forEach(col => {
            console.log(`   - ${col.Field}: ${col.Type}`);
        });

        // 检查 storage_type 字段
        const [filesStorageType] = await pool.execute("SHOW COLUMNS FROM files LIKE 'storage_type'");
        const [kbStorageType] = await pool.execute("SHOW COLUMNS FROM knowledge_base LIKE 'storage_type'");
        console.log(`📦 storage_type 字段: files(${filesStorageType.length}), knowledge_base(${kbStorageType.length})`);
        
        console.log('\n🎉 迁移验证完成！');
        
    } catch (error) {
        console.error('❌ 数据库迁移失败:', error);
        process.exit(1);
    } finally {
        // 关闭数据库连接
        await pool.end();
        console.log('🔌 数据库连接已关闭');
        process.exit(0);
    }
}

// 运行迁移
runMigration();
