-- 创建数据库
CREATE DATABASE IF NOT EXISTS jcc_factory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE jcc_factory;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    role ENUM('admin', 'user') DEFAULT 'user' NOT NULL,
    permission ENUM('personal', 'readonly_global', 'global') DEFAULT 'personal' NOT NULL,
    remarks TEXT,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    
    -- 添加索引
    INDEX idx_role (role),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id CHAR(36) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    user_agent VARCHAR(512),
    ip_address VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_sessions_user (user_id),
    INDEX idx_auth_sessions_expiry (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    user_id INT NOT NULL,
    type ENUM('video', 'novel') NOT NULL,
    status ENUM('created', 'processing', 'completed', 'failed') DEFAULT 'created',
    analysis_prompt TEXT,
    integration_prompt TEXT,
    character_knowledge_graph_prompt TEXT,
    character_integration_prompt TEXT,
    character_prompt TEXT,
    integrated_script TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_operation_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_operator_id INT,
    
    -- 添加索引
    INDEX idx_user_id (user_id),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_last_operation_at (last_operation_at),
    
    -- 外键约束
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (last_operator_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 文件表
CREATE TABLE IF NOT EXISTS files (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL, -- 兼容性：存储 MinIO 对象名称或本地路径
    file_size BIGINT NOT NULL,
    mark_done TINYINT(1) NOT NULL DEFAULT 0,
    mark_done_by INT NULL,
    mark_done_at DATETIME NULL,
    mime_type VARCHAR(100) NOT NULL,
    duration FLOAT, -- 视频或音频时长（秒）
    thumbnail_path VARCHAR(255), -- 缩略图路径或 MinIO 对象名称
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- MinIO 相关字段
    minio_bucket VARCHAR(100), -- MinIO 存储桶名称
    minio_object_name VARCHAR(500), -- MinIO 对象名称
    minio_thumbnail_bucket VARCHAR(100), -- MinIO 缩略图存储桶名称
    minio_thumbnail_object VARCHAR(500), -- MinIO 缩略图对象名称
    storage_type ENUM('local', 'minio') DEFAULT 'local', -- 存储类型
    
    -- 添加索引
    INDEX idx_project_id (project_id),
    INDEX idx_filename (filename),
    INDEX idx_mime_type (mime_type),
    INDEX idx_uploaded_at (uploaded_at),
    INDEX idx_file_size (file_size),
    INDEX idx_files_mark_done (mark_done),
    INDEX idx_storage_type (storage_type),
    INDEX idx_minio_bucket (minio_bucket),
    INDEX idx_minio_object_name (minio_object_name),
    
    -- 外键约束
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- AI处理任务表
CREATE TABLE IF NOT EXISTS ai_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT NOT NULL,
    file_id INT,
    prompt TEXT NOT NULL,
    model_config JSON,
    status ENUM('pending', 'processing', 'paused', 'completed', 'failed', 'canceled') DEFAULT 'pending',
    retry_count TINYINT NOT NULL DEFAULT 0,
    max_retries TINYINT NOT NULL DEFAULT 3,
    attempt_count INT NOT NULL DEFAULT 0,
    started_at DATETIME NULL,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    worker_id VARCHAR(128) NULL,
    lease_until DATETIME NULL,
    cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
    pause_requested TINYINT(1) NOT NULL DEFAULT 0,
    canceled_at DATETIME NULL,
    paused_at DATETIME NULL,
    priority SMALLINT NOT NULL DEFAULT 0,
    task_type VARCHAR(64) NOT NULL DEFAULT 'video_analysis',
    task_source ENUM('immediate', 'queue') NOT NULL DEFAULT 'immediate',
    queue_position INT NULL,
    idempotency_key VARCHAR(128) NULL,
    active_queue_file_id INT GENERATED ALWAYS AS (
        CASE WHEN task_source = 'queue' AND status IN ('pending', 'processing', 'paused') THEN file_id ELSE NULL END
    ) VIRTUAL,
    result TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    
    -- 添加索引
    INDEX idx_project_id (project_id),
    INDEX idx_file_id (file_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_completed_at (completed_at),
    UNIQUE INDEX uq_ai_tasks_idempotency (project_id, idempotency_key),
    UNIQUE INDEX uq_ai_tasks_active_queue_file (active_queue_file_id),
    INDEX idx_status_created (status, created_at), -- 复合索引，用于按状态和时间查询
    
    -- 外键约束
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS script_units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT NOT NULL,
    unit_name VARCHAR(255) NOT NULL,
    unit_order INT NOT NULL,
    selected_episodes JSON,
    selected_file_ids JSON,
    selected_materials JSON,
    selected_character_graphs JSON,
    draft_content LONGTEXT,
    integration_result LONGTEXT,
    integration_prompt TEXT,
    content_integration_result LONGTEXT,
    enhanced_content_integration_result LONGTEXT,
    character_integration_result LONGTEXT,
    content_integration_prompt TEXT,
    character_integration_prompt TEXT,
    character_graph_content LONGTEXT,
    step1_completed TINYINT(1) NOT NULL DEFAULT 0,
    step2_completed TINYINT(1) NOT NULL DEFAULT 0,
    step2_character_graph_completed TINYINT(1) NOT NULL DEFAULT 0,
    step3_character_graph_completed TINYINT(1) NOT NULL DEFAULT 0,
    step3_completed TINYINT(1) NOT NULL DEFAULT 0,
    step4_completed TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_script_units_project_order (project_id, unit_order),
    INDEX idx_script_units_project (project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS full_scripts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT NOT NULL,
    script_name VARCHAR(255) NOT NULL DEFAULT '完整剧本',
    current_step TINYINT NOT NULL DEFAULT 1,
    step_1_completed TINYINT(1) NOT NULL DEFAULT 0,
    step_2_completed TINYINT(1) NOT NULL DEFAULT 0,
    step_3_completed TINYINT(1) NOT NULL DEFAULT 0,
    selected_unit_ids JSON,
    concatenated_content LONGTEXT,
    reviewed_content LONGTEXT,
    review_notes TEXT,
    archive_title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_full_scripts_project (project_id),
    INDEX idx_full_scripts_archive_title (archive_title),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 知识库表
CREATE TABLE IF NOT EXISTS knowledge_base (
    id INT PRIMARY KEY AUTO_INCREMENT,
    project_id INT,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(255),
    file_type VARCHAR(255),
    file_size BIGINT DEFAULT 0,
    minio_bucket VARCHAR(100),
    minio_object_name VARCHAR(500),
    storage_type ENUM('local', 'minio') NOT NULL DEFAULT 'local',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_modified_by INT,
    
    -- 添加索引
    INDEX idx_user_id (user_id),
    INDEX idx_project_id (project_id),
    INDEX idx_title (title),
    INDEX idx_file_type (file_type),
    INDEX idx_kb_storage_type (storage_type),
    INDEX idx_kb_minio_bucket (minio_bucket),
    INDEX idx_kb_minio_object_name (minio_object_name),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at),
    INDEX idx_last_modified_by (last_modified_by),
    
    -- 外键约束
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (last_modified_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 标签表（全局共享）
CREATE TABLE IF NOT EXISTS tags (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(20) NOT NULL, -- 用于存储颜色代码
    
    -- 添加索引
    INDEX idx_name (name),
    
    -- 唯一约束
    UNIQUE KEY unique_tag_name (name) -- 确保标签名称全局唯一
);

-- 知识库标签关联表
CREATE TABLE IF NOT EXISTS knowledge_base_tags (
    knowledge_base_id INT NOT NULL,
    tag_id INT NOT NULL,
    
    -- 添加索引
    INDEX idx_knowledge_base_id (knowledge_base_id),
    INDEX idx_tag_id (tag_id),
    
    -- 外键约束
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
    
    -- 复合主键，同时避免重复关联
    PRIMARY KEY (knowledge_base_id, tag_id)
);

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    config_type ENUM('string', 'json', 'boolean') DEFAULT 'string' NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    
    -- 添加索引
    INDEX idx_config_key (config_key),
    INDEX idx_config_type (config_type),
    INDEX idx_updated_at (updated_at),
    
    -- 外键约束（updated_by引用users表）
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 插入默认系统配置
INSERT INTO system_config (config_key, config_value, config_type, description) VALUES
('gemini_api_key', '', 'string', 'Google Gemini API密钥'),
('gemini_default_model', 'gemini-3.6-flash', 'string', '默认使用的Gemini模型'),
('gemini_available_models', '["gemini-3.6-flash"]', 'json', '可用的Gemini模型列表'),
('video_analysis_prompt', '请分析这个视频的内容，并提供详细的分析报告。', 'string', '视频分析提示词'),
('script_integration_prompt', '请基于提供的内容整合出一个完整的脚本。', 'string', '脚本整合提示词'),
('max_file_size', '500', 'string', '最大文件上传大小(MB)'),
('allowed_file_types', '["mp4", "avi", "mov", "txt", "docx", "pdf"]', 'json', '允许上传的文件类型'),
('system_maintenance', 'false', 'boolean', '系统维护模式开关'),
('proxy_service_enabled', 'false', 'boolean', '代理服务开关'),
('proxy_service_url', '', 'string', '代理服务器地址'),
('proxy_service_auth_token', '', 'string', '代理服务认证密钥')
ON DUPLICATE KEY UPDATE 
config_value = VALUES(config_value),
description = VALUES(description);

INSERT INTO system_config (config_key, config_value, config_type, description)
VALUES ('queue_paused', 'false', 'boolean', 'Global task intake pause flag')
ON DUPLICATE KEY UPDATE config_key = VALUES(config_key);

INSERT INTO system_config (config_key, config_value, config_type, description)
VALUES ('api_onboarding_completed', 'false', 'boolean', 'API onboarding completion marker')
ON DUPLICATE KEY UPDATE config_key = VALUES(config_key);

-- 管理员用户通过 setup-admin.js 和 ADMIN_* 环境变量创建，不提供默认密码。
-- 确保在初始化数据库后运行: node scripts/setup-admin.js
