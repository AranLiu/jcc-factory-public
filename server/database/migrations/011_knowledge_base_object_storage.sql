-- Bring the MinIO-backed knowledge-base contract into the ordered migration chain.
-- Keep each column/index in an independent statement so partially migrated legacy
-- installations can converge through the migration runner's duplicate guards.
ALTER TABLE knowledge_base ADD COLUMN minio_bucket VARCHAR(100) NULL AFTER file_size;
ALTER TABLE knowledge_base ADD COLUMN minio_object_name VARCHAR(500) NULL AFTER minio_bucket;
ALTER TABLE knowledge_base ADD COLUMN storage_type ENUM('local', 'minio') NOT NULL DEFAULT 'local' AFTER minio_object_name;

UPDATE knowledge_base SET storage_type = 'local' WHERE storage_type IS NULL;
ALTER TABLE knowledge_base MODIFY COLUMN storage_type ENUM('local', 'minio') NOT NULL DEFAULT 'local';

CREATE INDEX idx_kb_storage_type ON knowledge_base (storage_type);
CREATE INDEX idx_kb_minio_bucket ON knowledge_base (minio_bucket);
CREATE INDEX idx_kb_minio_object_name ON knowledge_base (minio_object_name);
