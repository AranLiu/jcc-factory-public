const GEMINI_ENVIRONMENT_KEYS = Object.freeze([
  'GEMINI_API_KEY',
  'GEMINI_DEFAULT_MODEL',
  'GEMINI_AVAILABLE_MODELS',
]);

function captureGeminiEnvironment(env = process.env) {
  return Object.freeze(Object.fromEntries(
    GEMINI_ENVIRONMENT_KEYS.map(key => [key, env[key]])
  ));
}

const BOOT_GEMINI_ENVIRONMENT = captureGeminiEnvironment(process.env);

function getBootGeminiEnvironment() {
  return BOOT_GEMINI_ENVIRONMENT;
}

module.exports = {
  BOOT_GEMINI_ENVIRONMENT,
  GEMINI_ENVIRONMENT_KEYS,
  captureGeminiEnvironment,
  getBootGeminiEnvironment,
};
