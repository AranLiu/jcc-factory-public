-- 数据库迁移脚本：为full_scripts表添加archive_title字段
-- 解决完整剧本存档时不能保存用户自定义文档名称的问题

USE jcc_factory;

-- 检查并添加archive_title字段
ALTER TABLE full_scripts 
ADD COLUMN IF NOT EXISTS archive_title VARCHAR(255) DEFAULT NULL COMMENT '存档文档名称'
AFTER review_notes;

-- 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_archive_title ON full_scripts(archive_title);

-- 确认更改
SELECT 'Migration completed: archive_title field added to full_scripts table' as status; 