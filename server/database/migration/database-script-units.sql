-- 单元剧本数据表升级脚本
-- 用于支持多单元Tab管理功能

USE jcc_factory;

-- 创建单元剧本表
CREATE TABLE IF NOT EXISTS script_units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT NOT NULL,
    unit_name VARCHAR(255) NOT NULL COMMENT '单元名称，如：一单元（1-10集）',
    unit_order INT NOT NULL COMMENT '单元排序，从1开始',
    selected_episodes JSON COMMENT '选择的集数JSON数组，如：[1,2,3,4,5]',
    selected_file_ids JSON COMMENT '选择的文件ID JSON数组，如：[101,102,103]',
    draft_content TEXT COMMENT '素材区内容',
    integration_result TEXT COMMENT '成品区内容',
    integration_prompt TEXT COMMENT '单元使用的整合提示词',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引
    INDEX idx_project_id (project_id),
    INDEX idx_project_unit_order (project_id, unit_order),
    INDEX idx_created_at (created_at),
    
    -- 外键约束
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) COMMENT='单元剧本表，支持多单元Tab管理';

-- 确保项目的单元顺序唯一
ALTER TABLE script_units ADD UNIQUE KEY unique_project_unit_order (project_id, unit_order);

-- 更新系统配置术语：剧本整合 -> 单元剧本
UPDATE system_config 
SET description = '单元剧本提示词'
WHERE config_key = 'script_integration_prompt';

-- 更新默认提示词内容
UPDATE system_config 
SET config_value = '请基于提供的内容整合出一个完整的单元剧本。'
WHERE config_key = 'script_integration_prompt'; 