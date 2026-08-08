INSERT INTO system_config (config_key, config_value, config_type, description)
VALUES ('api_onboarding_completed', 'false', 'boolean', 'API onboarding completion marker')
ON DUPLICATE KEY UPDATE config_key = VALUES(config_key);
