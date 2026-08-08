-- 数据库重构脚本：统一使用 ai_tasks 表存储所有AI分析结果

-- 1. 为 ai_tasks 表添加任务类型字段
ALTER TABLE ai_tasks ADD COLUMN task_type ENUM('video_analysis', 'character_graph', 'script_integration') DEFAULT 'video_analysis' COMMENT 'AI任务类型';

-- 2. 为现有的 ai_tasks 记录设置默认类型为 video_analysis
UPDATE ai_tasks SET task_type = 'video_analysis' WHERE task_type IS NULL;

-- 3. 迁移 files 表中的角色知识图谱数据到 ai_tasks 表
INSERT INTO ai_tasks (project_id, file_id, prompt, result, status, task_type, created_at, completed_at)
SELECT 
    f.project_id,
    f.id as file_id,
    '角色知识图谱分析' as prompt,
    f.character_knowledge_graph as result,
    'completed' as status,
    'character_graph' as task_type,
    f.uploaded_at as created_at,
    f.uploaded_at as completed_at
FROM files f 
WHERE f.character_knowledge_graph IS NOT NULL 
AND f.character_knowledge_graph != '';

-- 4. 删除 files 表中的 character_knowledge_graph 字段
ALTER TABLE files DROP COLUMN character_knowledge_graph;

-- 5. 为 ai_tasks 表添加索引以提高查询性能
CREATE INDEX idx_ai_tasks_task_type ON ai_tasks(task_type);
CREATE INDEX idx_ai_tasks_file_task_type ON ai_tasks(file_id, task_type);
CREATE INDEX idx_ai_tasks_project_task_type ON ai_tasks(project_id, task_type);

-- 验证操作完成
SELECT 'ai_tasks表task_type字段添加完成' as status;
SELECT 'files表character_knowledge_graph字段移除完成' as status;
SELECT 'ai_tasks表索引创建完成' as status;

-- 查看迁移结果统计
SELECT 
    task_type,
    COUNT(*) as count,
    MIN(created_at) as earliest,
    MAX(created_at) as latest
FROM ai_tasks 
GROUP BY task_type; 