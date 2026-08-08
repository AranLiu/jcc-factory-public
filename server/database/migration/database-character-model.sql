-- 数据库升级脚本：角色整合模型配置
-- 创建时间：2025-01-03
-- 用途：为项目表添加角色整合模型配置字段，为系统配置表添加角色整合Prompt配置

-- 1. 为projects表添加角色整合模型配置字段
ALTER TABLE projects 
ADD COLUMN character_model VARCHAR(255) DEFAULT 'gemini-2.5-flash' COMMENT '角色整合模型';

ALTER TABLE projects 
ADD COLUMN character_temperature DECIMAL(3,2) DEFAULT 1.00 COMMENT '角色整合温度参数';

ALTER TABLE projects 
ADD COLUMN characterPrompt TEXT COMMENT '角色整合Prompt';

-- 2. 为system_config表添加角色整合Prompt配置
INSERT INTO system_config (config_key, config_value, config_type, description, created_at, updated_at) 
VALUES (
    'character_prompt', 
    '# Role: 角色整合专家 (Character Integration Expert)

## Profile
- author: JCC Factory
- version: 1.0
- language: 中文
- description: 你是一位专业的角色整合专家，负责对各类素材进行角色相关的整合处理。

## Skills
1. 角色信息提取与整理
2. 角色关系分析与梳理
3. 角色发展轨迹整合
4. 角色特征统一化处理

## Rules
1. 严格按照用户要求进行角色整合处理
2. 保持角色信息的准确性和一致性
3. 突出角色的关键特征和发展变化
4. 确保输出内容的逻辑性和连贯性

## Workflow
1. 仔细分析提供的素材内容
2. 识别并提取角色相关信息
3. 按照要求进行整合处理
4. 输出符合规范的角色整合结果

请根据以上指导原则，对用户提供的素材进行角色整合处理。', 
    'text', 
    '角色整合功能的默认Prompt', 
    NOW(), 
    NOW()
) ON DUPLICATE KEY UPDATE 
config_value = VALUES(config_value),
description = VALUES(description),
updated_at = NOW();

-- 3. 更新现有项目的默认值（可选，如果希望为现有项目设置默认模型）
-- UPDATE projects 
-- SET character_model = 'gemini-2.5-flash', 
--     character_temperature = 1.00 
-- WHERE character_model IS NULL;

-- 4. 添加索引以提高查询性能（可选）
-- CREATE INDEX idx_projects_character_model ON projects(character_model);

COMMIT; 