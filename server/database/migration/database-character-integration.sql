-- 数据库升级脚本：添加角色知识图谱整合相关配置

-- 1. 添加角色知识图谱整合Prompt到系统配置
INSERT INTO system_config (config_key, config_value, config_type, description) 
VALUES ('character_integration_prompt', '请根据以下多个分集的角色知识图谱，直接整合生成一个完整、连贯的全局角色关系图谱。要求：\n1. 合并相同角色在不同分集中的信息\n2. 理清角色之间的关系网络\n3. 分析角色发展轨迹\n4. 生成结构化的角色档案\n5. 保持角色信息的完整性和连贯性', 'string', '角色知识图谱整合提示词')
ON DUPLICATE KEY UPDATE 
config_value = VALUES(config_value),
description = VALUES(description);

-- 2. 为projects表添加character_integration_prompt字段
ALTER TABLE projects ADD COLUMN character_integration_prompt TEXT COMMENT '项目级别的角色知识图谱整合提示词';

-- 3. 为ai_tasks表添加新的任务类型支持（如果还没有的话）
-- ai_tasks表的task_type字段应该支持：'video_analysis', 'character_graph', 'script_integration', 'character_integration'

-- 验证字段添加成功
SELECT 'character_integration_prompt 系统配置添加完成' as status;
SELECT 'projects表character_integration_prompt字段添加完成' as status; 