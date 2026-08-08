-- 数据库升级脚本：单元剧本三步工作流
-- 创建时间：2025-01-03
-- 用途：为script_units表添加三步工作流支持字段

USE jcc_factory;

-- 为script_units表添加三步工作流字段
ALTER TABLE script_units 
ADD COLUMN IF NOT EXISTS step1_completed BOOLEAN DEFAULT FALSE COMMENT '第一步（选择素材）完成状态',
ADD COLUMN IF NOT EXISTS step2_completed BOOLEAN DEFAULT FALSE COMMENT '第二步（内容整合）完成状态', 
ADD COLUMN IF NOT EXISTS step3_completed BOOLEAN DEFAULT FALSE COMMENT '第三步（角色整合）完成状态',
ADD COLUMN IF NOT EXISTS selected_materials JSON COMMENT '选择的素材信息',
ADD COLUMN IF NOT EXISTS content_integration_result TEXT COMMENT '内容整合结果',
ADD COLUMN IF NOT EXISTS character_integration_result TEXT COMMENT '角色整合结果',
ADD COLUMN IF NOT EXISTS content_integration_prompt TEXT COMMENT '内容整合Prompt',
ADD COLUMN IF NOT EXISTS character_integration_prompt TEXT COMMENT '角色整合Prompt';

-- 为现有数据设置默认值
-- 如果已有draft_content，则认为第一步已完成
UPDATE script_units 
SET step1_completed = TRUE, 
    selected_materials = JSON_OBJECT(
        'selectedFileIds', selected_file_ids,
        'selectedEpisodes', selected_episodes,
        'includeCharacterGraph', FALSE
    )
WHERE draft_content IS NOT NULL AND draft_content != '';

-- 如果已有integration_result，则认为第二步已完成，并将原结果迁移到content_integration_result
UPDATE script_units 
SET step2_completed = TRUE,
    content_integration_result = integration_result,
    content_integration_prompt = integration_prompt
WHERE integration_result IS NOT NULL AND integration_result != '';

-- 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_step_status ON script_units(step1_completed, step2_completed, step3_completed);

-- 确认更改
SELECT 'Script units workflow upgrade completed' as status; 