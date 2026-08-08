CREATE TABLE IF NOT EXISTS ai_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  provider_type VARCHAR(32) NOT NULL,
  base_url VARCHAR(512) NULL,
  api_key_ciphertext TEXT NOT NULL,
  default_model VARCHAR(128) NOT NULL,
  models_json JSON NOT NULL,
  capabilities_json JSON NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_test_status VARCHAR(16) NULL,
  last_tested_at TIMESTAMP NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_providers_name (name),
  KEY idx_ai_providers_enabled_type (enabled, provider_type),
  CONSTRAINT fk_ai_providers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_providers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_task_routes (
  task_type VARCHAR(64) PRIMARY KEY,
  provider_id BIGINT UNSIGNED NOT NULL,
  model VARCHAR(128) NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_task_routes_provider FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ai_task_routes_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
