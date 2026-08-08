-- 数据库升级脚本：添加角色知识图谱相关字段和系统配置

-- 1. 添加角色知识图谱Prompt到系统配置
INSERT INTO system_config (config_key, config_value, config_type, description) 
VALUES ('character_knowledge_graph_prompt', '请根据视频内容分析主要角色的特征、关系和发展轨迹，生成详细的角色知识图谱。', 'string', '角色知识图谱生成提示词')
ON DUPLICATE KEY UPDATE 
config_value = VALUES(config_value),
description = VALUES(description);

-- 2. 为files表添加character_knowledge_graph字段
ALTER TABLE files ADD COLUMN character_knowledge_graph TEXT COMMENT '角色知识图谱内容';

-- 3. 为projects表添加character_knowledge_graph_prompt字段
ALTER TABLE projects ADD COLUMN character_knowledge_graph_prompt TEXT COMMENT '项目级别的角色知识图谱生成提示词';

-- 验证字段添加成功
SELECT 'character_knowledge_graph_prompt 系统配置添加完成' as status;
SELECT 'files表character_knowledge_graph字段添加完成' as status;
SELECT 'projects表character_knowledge_graph_prompt字段添加完成' as status; 