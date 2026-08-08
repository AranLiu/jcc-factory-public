-- 数据库迁移脚本：为knowledge_base表添加last_modified_at字段
-- 解决知识库文档编辑保存后预览不能正确显示的问题

USE jcc_factory;

-- 检查并添加last_modified_at字段
ALTER TABLE knowledge_base 
ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
AFTER updated_at;

-- 为现有记录设置last_modified_at值
UPDATE knowledge_base 
SET last_modified_at = updated_at 
WHERE last_modified_at IS NULL;

-- 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_last_modified_at ON knowledge_base(last_modified_at);

-- 确认更改
SELECT 'Migration completed: last_modified_at field added to knowledge_base table' as status; 