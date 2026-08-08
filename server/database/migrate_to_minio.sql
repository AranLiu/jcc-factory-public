-- 为现有的 files 表添加 MinIO 相关字段
-- 如果表不存在这些字段，则添加它们

-- 为 files 表添加 MinIO 相关字段
ALTER TABLE files ADD COLUMN minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称';
ALTER TABLE files ADD COLUMN minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称';
ALTER TABLE files ADD COLUMN minio_thumbnail_bucket VARCHAR(100) COMMENT 'MinIO 缩略图存储桶名称';
ALTER TABLE files ADD COLUMN minio_thumbnail_object VARCHAR(500) COMMENT 'MinIO 缩略图对象名称';
ALTER TABLE files ADD COLUMN storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型';

-- 为 files 表添加索引
ALTER TABLE files ADD INDEX idx_storage_type (storage_type);
ALTER TABLE files ADD INDEX idx_minio_bucket (minio_bucket);
ALTER TABLE files ADD INDEX idx_minio_object_name (minio_object_name);

-- 为 knowledge_base 表添加 MinIO 相关字段
ALTER TABLE knowledge_base ADD COLUMN minio_bucket VARCHAR(100) COMMENT 'MinIO 存储桶名称';
ALTER TABLE knowledge_base ADD COLUMN minio_object_name VARCHAR(500) COMMENT 'MinIO 对象名称';
ALTER TABLE knowledge_base ADD COLUMN storage_type ENUM('local', 'minio') DEFAULT 'local' COMMENT '存储类型';

-- 为 knowledge_base 表添加索引
ALTER TABLE knowledge_base ADD INDEX idx_kb_storage_type (storage_type);
ALTER TABLE knowledge_base ADD INDEX idx_kb_minio_bucket (minio_bucket);
ALTER TABLE knowledge_base ADD INDEX idx_kb_minio_object_name (minio_object_name);

-- 更新现有记录的存储类型为 'local'
UPDATE files SET storage_type = 'local' WHERE storage_type IS NULL;
UPDATE knowledge_base SET storage_type = 'local' WHERE storage_type IS NULL; 