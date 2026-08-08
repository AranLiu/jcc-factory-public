-- =============================================
-- JCC Factory - 完整剧本模块数据库脚本
-- 版本: 1.0
-- 创建时间: 2025-07-01
-- =============================================

-- 创建完整剧本表
CREATE TABLE IF NOT EXISTS `full_scripts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL,
  `script_name` varchar(255) NOT NULL DEFAULT '完整剧本',
  `current_step` tinyint(1) NOT NULL DEFAULT 1 COMMENT '当前步骤: 1=单元拼接, 2=全剧本审核, 3=知识库存档',
  `step_1_completed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '步骤1完成状态',
  `step_2_completed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '步骤2完成状态',
  `step_3_completed` tinyint(1) NOT NULL DEFAULT 0 COMMENT '步骤3完成状态',
  `selected_unit_ids` JSON DEFAULT NULL COMMENT '选择的单元ID列表',
  `concatenated_content` LONGTEXT DEFAULT NULL COMMENT '拼接后的完整剧本内容',
  `reviewed_content` LONGTEXT DEFAULT NULL COMMENT '审核后的剧本内容',
  `review_notes` TEXT DEFAULT NULL COMMENT '审核备注',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_current_step` (`current_step`),
  CONSTRAINT `fk_full_scripts_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='完整剧本工作流管理表';

-- 更新系统配置 - 添加完整剧本相关配置
INSERT INTO `system_config` (`config_key`, `config_value`, `description`, `updated_at`) VALUES
('full_script_default_name', '完整剧本', '完整剧本默认名称', NOW()),
('full_script_max_units', '50', '完整剧本最大单元数量', NOW()),
('full_script_auto_archive', '1', '审核通过后自动存档到知识库', NOW())
ON DUPLICATE KEY UPDATE 
  `config_value` = VALUES(`config_value`),
  `description` = VALUES(`description`),
  `updated_at` = NOW();

-- 创建索引优化查询性能
-- CREATE INDEX `idx_full_scripts_steps` ON `full_scripts` (`step_1_completed`, `step_2_completed`, `step_3_completed`);
-- CREATE INDEX `idx_full_scripts_updated` ON `full_scripts` (`updated_at`);

-- 插入测试提示
SELECT '完整剧本模块数据库脚本执行完成！' as message;
SELECT 'full_scripts表已创建，支持完整的工作流管理' as table_info; 