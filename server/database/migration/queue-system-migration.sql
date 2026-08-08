-- 队列系统数据库迁移脚本
-- 执行时间: 2025-01-13

-- 1. 为 ai_tasks 表添加队列相关字段（只添加缺少的字段）
-- 检查并添加缺少的字段
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND COLUMN_NAME = 'task_source') = 0,
    'ALTER TABLE ai_tasks ADD COLUMN task_source ENUM(''immediate'', ''queue'') DEFAULT ''immediate'' COMMENT ''任务来源'';',
    'SELECT ''task_source字段已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND COLUMN_NAME = 'max_retries') = 0,
    'ALTER TABLE ai_tasks ADD COLUMN max_retries INT DEFAULT 3 COMMENT ''最大重试次数'';',
    'SELECT ''max_retries字段已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND COLUMN_NAME = 'queue_position') = 0,
    'ALTER TABLE ai_tasks ADD COLUMN queue_position INT NULL COMMENT ''队列位置'';',
    'SELECT ''queue_position字段已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 添加索引优化查询性能（检查是否已存在）
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND INDEX_NAME = 'idx_ai_tasks_queue') = 0,
    'CREATE INDEX idx_ai_tasks_queue ON ai_tasks(task_source, status, priority, queue_position);',
    'SELECT ''idx_ai_tasks_queue索引已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND INDEX_NAME = 'idx_ai_tasks_processing') = 0,
    'CREATE INDEX idx_ai_tasks_processing ON ai_tasks(status, started_at);',
    'SELECT ''idx_ai_tasks_processing索引已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_NAME = 'ai_tasks' 
     AND TABLE_SCHEMA = 'jcc_factory' 
     AND INDEX_NAME = 'idx_ai_tasks_retry') = 0,
    'CREATE INDEX idx_ai_tasks_retry ON ai_tasks(retry_count, max_retries);',
    'SELECT ''idx_ai_tasks_retry索引已存在'' as status;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. 更新现有任务的默认值
UPDATE ai_tasks SET 
    task_source = 'immediate', 
    priority = 10
WHERE task_source IS NULL OR task_source = '';

UPDATE ai_tasks SET 
    max_retries = 3
WHERE max_retries IS NULL OR max_retries = 0;

-- 4. 验证迁移结果
SELECT 'ai_tasks表字段添加完成' as status;

-- 查看表结构
DESCRIBE ai_tasks;

-- 查看索引
SHOW INDEX FROM ai_tasks WHERE Key_name LIKE 'idx_ai_tasks_%';

-- 统计现有数据
SELECT 
    task_source,
    priority,
    status,
    COUNT(*) as count
FROM ai_tasks 
GROUP BY task_source, priority, status
ORDER BY task_source, priority, status;
