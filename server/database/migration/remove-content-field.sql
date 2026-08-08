-- 数据库迁移脚本：移除knowledge_base表的content字段
-- 移除content字段，总是从文件读取完整内容

USE jcc_factory;

-- 移除全文搜索索引
DROP INDEX ft_title_content ON knowledge_base;

-- 移除content字段
ALTER TABLE knowledge_base DROP COLUMN content;

-- 确认更改
SELECT 'Migration completed: content field removed from knowledge_base table' as status; 