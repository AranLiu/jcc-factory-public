const ONBOARDING_KEY = 'api_onboarding_completed';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const {
  BOOT_GEMINI_ENVIRONMENT,
  getBootGeminiEnvironment,
} = require('../config/geminiEnvironment');

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

async function getApiOnboardingStatus({ connectionLike, env = BOOT_GEMINI_ENVIRONMENT }) {
  const [rows] = await connectionLike.execute(
    'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)',
    [ONBOARDING_KEY, 'gemini_api_key', 'gemini_default_model']
  );
  const configs = new Map(rows.map(row => [row.config_key, row.config_value]));
  const environmentKeyConfigured = hasValue(env.GEMINI_API_KEY);
  const storedKeyConfigured = hasValue(configs.get('gemini_api_key'));
  const completed = configs.get(ONBOARDING_KEY) === 'true';
  const environmentModel = hasValue(env.GEMINI_DEFAULT_MODEL) ? env.GEMINI_DEFAULT_MODEL : null;
  const storedModel = hasValue(configs.get('gemini_default_model'))
    ? configs.get('gemini_default_model')
    : null;

  return {
    required: !(environmentKeyConfigured || storedKeyConfigured || completed),
    completed,
    apiKeyConfigured: environmentKeyConfigured || storedKeyConfigured,
    managedByEnvironment: environmentKeyConfigured,
    defaultModel: environmentModel || storedModel || DEFAULT_MODEL,
  };
}

async function completeApiOnboarding({ pool, userId, skipped }) {
  await pool.execute(
    `INSERT INTO system_config (config_key, config_value, config_type, description, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       config_value = VALUES(config_value),
       config_type = VALUES(config_type),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [ONBOARDING_KEY, 'true', 'boolean', 'API onboarding completion marker', userId]
  );

  return { completed: true, skipped };
}

module.exports = {
  completeApiOnboarding,
  getBootGeminiEnvironment,
  getApiOnboardingStatus,
};
