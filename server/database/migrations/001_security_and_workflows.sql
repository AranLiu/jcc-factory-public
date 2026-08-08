ALTER TABLE users
  MODIFY COLUMN permission ENUM('personal', 'readonly_global', 'global', 'full_access') NOT NULL DEFAULT 'personal';

UPDATE users SET permission = 'global' WHERE permission = 'full_access';

ALTER TABLE users
  MODIFY COLUMN permission ENUM('personal', 'readonly_global', 'global') NOT NULL DEFAULT 'personal';

ALTER TABLE files ADD COLUMN mark_done TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN mark_done_by INT NULL;
ALTER TABLE files ADD COLUMN mark_done_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  user_agent VARCHAR(512),
  ip_address VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_sessions_user (user_id),
  INDEX idx_auth_sessions_expiry (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE ai_tasks
  MODIFY COLUMN status ENUM('pending', 'processing', 'paused', 'completed', 'failed', 'canceled') NOT NULL DEFAULT 'pending';
ALTER TABLE ai_tasks ADD COLUMN retry_count TINYINT NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN max_retries TINYINT NOT NULL DEFAULT 3;
ALTER TABLE ai_tasks ADD COLUMN attempt_count INT NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN started_at DATETIME NULL;
ALTER TABLE ai_tasks ADD COLUMN available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ai_tasks ADD COLUMN worker_id VARCHAR(128) NULL;
ALTER TABLE ai_tasks ADD COLUMN lease_until DATETIME NULL;
ALTER TABLE ai_tasks ADD COLUMN cancel_requested TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN pause_requested TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN canceled_at DATETIME NULL;
ALTER TABLE ai_tasks ADD COLUMN paused_at DATETIME NULL;
ALTER TABLE ai_tasks ADD COLUMN priority SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN task_type VARCHAR(64) NOT NULL DEFAULT 'video_analysis';
ALTER TABLE ai_tasks MODIFY COLUMN task_type VARCHAR(64) NOT NULL DEFAULT 'video_analysis';
ALTER TABLE ai_tasks ADD COLUMN task_source ENUM('immediate', 'queue') NOT NULL DEFAULT 'immediate';
ALTER TABLE ai_tasks ADD COLUMN queue_position INT NULL;
ALTER TABLE ai_tasks ADD COLUMN idempotency_key VARCHAR(128) NULL;

UPDATE ai_tasks task
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY id) AS duplicate_rank
  FROM ai_tasks
  WHERE task_source = 'queue' AND status IN ('pending', 'processing', 'paused') AND file_id IS NOT NULL
) duplicates ON duplicates.id = task.id
SET task.status = 'canceled', task.canceled_at = CURRENT_TIMESTAMP,
    task.worker_id = NULL, task.lease_until = NULL
WHERE duplicates.duplicate_rank > 1;

ALTER TABLE ai_tasks ADD COLUMN active_queue_file_id INT
  GENERATED ALWAYS AS (
    CASE WHEN task_source = 'queue' AND status IN ('pending', 'processing', 'paused') THEN file_id ELSE NULL END
  ) STORED;

UPDATE ai_tasks
SET status = 'pending', worker_id = NULL, lease_until = NULL, started_at = NULL,
    available_at = CURRENT_TIMESTAMP
WHERE status = 'processing' AND lease_until IS NULL;

CREATE INDEX idx_ai_tasks_claim ON ai_tasks(status, available_at, lease_until, priority, queue_position, created_at);
ALTER TABLE ai_tasks DROP INDEX uq_ai_tasks_idempotency;
CREATE UNIQUE INDEX uq_ai_tasks_idempotency ON ai_tasks(project_id, idempotency_key);
CREATE UNIQUE INDEX uq_ai_tasks_active_queue_file ON ai_tasks(active_queue_file_id);

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
  step3_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_script_units_project_order (project_id, unit_order),
  INDEX idx_script_units_project (project_id),
  CONSTRAINT fk_script_units_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE script_units ADD COLUMN selected_materials JSON;
ALTER TABLE script_units ADD COLUMN selected_character_graphs JSON;
ALTER TABLE script_units ADD COLUMN content_integration_result LONGTEXT;
ALTER TABLE script_units ADD COLUMN enhanced_content_integration_result LONGTEXT;
ALTER TABLE script_units ADD COLUMN character_integration_result LONGTEXT;
ALTER TABLE script_units ADD COLUMN content_integration_prompt TEXT;
ALTER TABLE script_units ADD COLUMN character_integration_prompt TEXT;
ALTER TABLE script_units ADD COLUMN character_graph_content LONGTEXT;
ALTER TABLE script_units ADD COLUMN step1_completed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE script_units ADD COLUMN step2_completed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE script_units ADD COLUMN step2_character_graph_completed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE script_units ADD COLUMN step3_completed TINYINT(1) NOT NULL DEFAULT 0;

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
  CONSTRAINT fk_full_scripts_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE full_scripts ADD COLUMN archive_title VARCHAR(255) NULL;

INSERT INTO system_config (config_key, config_value, config_type, description) VALUES
  ('analysis_concurrency_per_project', '1', 'string', '每个项目的并发度'),
  ('analysis_global_concurrency', '2', 'string', '全局并发度上限')
ON DUPLICATE KEY UPDATE config_key = VALUES(config_key);

INSERT INTO system_config (config_key, config_value, config_type, description)
VALUES ('queue_paused', 'false', 'boolean', 'Global task intake pause flag')
ON DUPLICATE KEY UPDATE config_key = VALUES(config_key);
