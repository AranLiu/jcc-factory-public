-- 安全的 MinIO 迁移脚本
-- 为现有的 files 表添加 MinIO 相关字段

-- 检查并添加 files 表的字段
SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND column_name='minio_bucket') > 0,
    "SELECT 'minio_bucket column already exists' as msg",
    "ALTER TABLE files ADD COLUMN minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND column_name='minio_object_name') > 0,
    "SELECT 'minio_object_name column already exists' as msg",
    "ALTER TABLE files ADD COLUMN minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND column_name='minio_thumbnail_bucket') > 0,
    "SELECT 'minio_thumbnail_bucket column already exists' as msg",
    "ALTER TABLE files ADD COLUMN minio_thumbnail_bucket VARCHAR(100) COMMENT 'MinIO 缩略图存储桶名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND column_name='minio_thumbnail_object') > 0,
    "SELECT 'minio_thumbnail_object column already exists' as msg",
    "ALTER TABLE files ADD COLUMN minio_thumbnail_object VARCHAR(500) COMMENT 'MinIO 缩略图对象名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND column_name='storage_type') > 0,
    "SELECT 'storage_type column already exists' as msg",
    "ALTER TABLE files ADD COLUMN storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 knowledge_base 表的字段
SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND column_name='minio_bucket') > 0,
    "SELECT 'knowledge_base minio_bucket column already exists' as msg",
    "ALTER TABLE knowledge_base ADD COLUMN minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND column_name='minio_object_name') > 0,
    "SELECT 'knowledge_base minio_object_name column already exists' as msg",
    "ALTER TABLE knowledge_base ADD COLUMN minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND column_name='storage_type') > 0,
    "SELECT 'knowledge_base storage_type column already exists' as msg",
    "ALTER TABLE knowledge_base ADD COLUMN storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型'"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加索引（files 表）
SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND index_name='idx_storage_type') > 0,
    "SELECT 'idx_storage_type index already exists' as msg",
    "ALTER TABLE files ADD INDEX idx_storage_type (storage_type)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND index_name='idx_minio_bucket') > 0,
    "SELECT 'idx_minio_bucket index already exists' as msg",
    "ALTER TABLE files ADD INDEX idx_minio_bucket (minio_bucket)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='files'
        AND table_schema='jcc_factory'
        AND index_name='idx_minio_object_name') > 0,
    "SELECT 'idx_minio_object_name index already exists' as msg",
    "ALTER TABLE files ADD INDEX idx_minio_object_name (minio_object_name)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加索引（knowledge_base 表）
SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND index_name='idx_kb_storage_type') > 0,
    "SELECT 'idx_kb_storage_type index already exists' as msg",
    "ALTER TABLE knowledge_base ADD INDEX idx_kb_storage_type (storage_type)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND index_name='idx_kb_minio_bucket') > 0,
    "SELECT 'idx_kb_minio_bucket index already exists' as msg",
    "ALTER TABLE knowledge_base ADD INDEX idx_kb_minio_bucket (minio_bucket)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_name='knowledge_base'
        AND table_schema='jcc_factory'
        AND index_name='idx_kb_minio_object_name') > 0,
    "SELECT 'idx_kb_minio_object_name index already exists' as msg",
    "ALTER TABLE knowledge_base ADD INDEX idx_kb_minio_object_name (minio_object_name)"
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 更新现有记录的存储类型为 'local'
UPDATE files SET storage_type = 'local' WHERE storage_type IS NULL;
UPDATE knowledge_base SET storage_type = 'local' WHERE storage_type IS NULL; 