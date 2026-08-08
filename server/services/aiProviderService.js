const axios = require('axios')
const { openProviderSecret, sealProviderSecret } = require('./providerSecret')

const PROVIDER_TYPES = new Set(['gemini', 'openai', 'openai_compatible'])
const PROVIDER_CAPABILITIES = Object.freeze({
  gemini: ['script_integration'],
  openai: ['script_integration'],
  openai_compatible: ['script_integration'],
})
const DEFAULT_BASE_URLS = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
})
const MAX_RESPONSE_CHARS = 2_000_000
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 180_000
const CONNECTION_TEST_TIMEOUT_MS = 30_000
const MIN_PROVIDER_REQUEST_TIMEOUT_MS = 30_000
const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 600_000

class ProviderValidationError extends Error {
  constructor(message = 'AI provider configuration is invalid') {
    super(message)
    this.name = 'ProviderValidationError'
  }
}

class ProviderRequestError extends Error {
  constructor(code = 'provider_request_failed') {
    const messages = {
      provider_request_failed: 'AI provider request failed',
      provider_timeout: 'AI provider request timed out',
    }
    super(messages[code] || messages.provider_request_failed)
    this.name = 'ProviderRequestError'
    this.code = Object.hasOwn(messages, code) ? code : 'provider_request_failed'
  }
}

function invalidProvider() {
  throw new ProviderValidationError()
}

function normalizeRequestTimeout(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  const timeoutMs = Number(value)
  if (!Number.isInteger(timeoutMs)
    || timeoutMs < MIN_PROVIDER_REQUEST_TIMEOUT_MS
    || timeoutMs > MAX_PROVIDER_REQUEST_TIMEOUT_MS) {
    invalidProvider()
  }
  return timeoutMs
}

function normalizeBaseUrl(value, providerType) {
  const candidate = String(value || DEFAULT_BASE_URLS[providerType] || '').trim().replace(/\/+$/, '')
  if (!candidate || candidate.length > 512) invalidProvider()

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    invalidProvider()
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) invalidProvider()

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const isSecure = parsed.protocol === 'https:'
  const isLoopbackDevelopment = parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname.toLowerCase())
  if (!isSecure && !isLoopbackDevelopment) invalidProvider()

  if (providerType === 'openai' && candidate !== DEFAULT_BASE_URLS.openai) invalidProvider()
  if (providerType === 'gemini' && candidate !== DEFAULT_BASE_URLS.gemini) invalidProvider()
  return candidate
}

function normalizeModels(models, defaultModel) {
  if (!Array.isArray(models) || models.length === 0 || models.length > 50) invalidProvider()
  const normalized = [...new Set(models.map(model => String(model).trim()))]
  if (normalized.some(model => !model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model))) invalidProvider()
  if (!normalized.includes(defaultModel)) invalidProvider()
  return normalized
}

function normalizeProviderInput(input, { requireApiKey = true } = {}) {
  if (!input || typeof input !== 'object') invalidProvider()
  const name = String(input.name || '').trim()
  const providerType = String(input.providerType || input.provider_type || '').trim()
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  const defaultModel = String(input.defaultModel || input.default_model || '').trim()
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) invalidProvider()
  if (!PROVIDER_TYPES.has(providerType)) invalidProvider()
  if (!defaultModel || defaultModel.length > 128 || /[\u0000-\u001f\u007f]/.test(defaultModel)) invalidProvider()
  if ((requireApiKey && !apiKey) || apiKey.length > 4096 || /^\[redacted\]$/i.test(apiKey) || /[\u0000-\u001f\u007f]/.test(apiKey)) invalidProvider()

  return {
    name,
    providerType,
    baseUrl: normalizeBaseUrl(input.baseUrl || input.base_url, providerType),
    apiKey,
    defaultModel,
    models: normalizeModels(input.models, defaultModel),
    capabilities: PROVIDER_CAPABILITIES[providerType],
    enabled: input.enabled !== false,
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function serializeProvider(row) {
  return {
    id: Number(row.id),
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiKeyConfigured: Boolean(row.api_key_ciphertext),
    defaultModel: row.default_model,
    models: parseJsonArray(row.models_json),
    capabilities: parseJsonArray(row.capabilities_json),
    enabled: Boolean(row.enabled),
    lastTestStatus: row.last_test_status || null,
    lastTestedAt: row.last_tested_at || null,
    updatedAt: row.updated_at || null,
  }
}

function boundedText(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_RESPONSE_CHARS) {
    throw new ProviderRequestError()
  }
  return value
}

function extractOpenAiResponse(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts = Array.isArray(data?.output)
    ? data.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    : []
  return parts.map(part => part?.text).filter(text => typeof text === 'string').join('\n')
}

function requestOptions(apiKey, headerName = 'Authorization', timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS) {
  const headerValue = headerName === 'Authorization' ? `Bearer ${apiKey}` : apiKey
  return {
    timeout: timeoutMs,
    maxContentLength: 2 * 1024 * 1024,
    maxBodyLength: 256 * 1024,
    headers: {
      'Content-Type': 'application/json',
      [headerName]: headerValue,
    },
  }
}

class AiProviderService {
  constructor({
    pool,
    httpClient = axios,
    masterSecret = process.env.JWT_SECRET,
    requestTimeoutMs = process.env.AI_PROVIDER_TIMEOUT_MS,
  } = {}) {
    this.pool = pool
    this.httpClient = httpClient
    this.masterSecret = masterSecret
    this.requestTimeoutMs = normalizeRequestTimeout(requestTimeoutMs)
  }

  async listProviders() {
    const [rows] = await this.pool.execute(
      `SELECT id, name, provider_type, base_url, api_key_ciphertext, default_model,
              models_json, capabilities_json, enabled, last_test_status, last_tested_at, updated_at
       FROM ai_providers ORDER BY enabled DESC, name ASC`
    )
    return rows.map(serializeProvider)
  }

  async getProviderRecord(id) {
    const numericId = Number(id)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) invalidProvider()
    const [rows] = await this.pool.execute('SELECT * FROM ai_providers WHERE id = ?', [numericId])
    if (rows.length !== 1) throw new ProviderValidationError('AI provider was not found')
    return rows[0]
  }

  async createProvider(input, actorId) {
    const provider = normalizeProviderInput(input)
    const ciphertext = sealProviderSecret(provider.apiKey, this.masterSecret)
    const [result] = await this.pool.execute(
      `INSERT INTO ai_providers
       (name, provider_type, base_url, api_key_ciphertext, default_model, models_json,
        capabilities_json, enabled, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider.name, provider.providerType, provider.baseUrl, ciphertext, provider.defaultModel,
        JSON.stringify(provider.models), JSON.stringify(provider.capabilities), provider.enabled ? 1 : 0,
        actorId, actorId]
    )
    return serializeProvider(await this.getProviderRecord(result.insertId))
  }

  async updateProvider(id, input, actorId) {
    const existing = await this.getProviderRecord(id)
    const update = input && typeof input === 'object' ? input : {}
    const provider = normalizeProviderInput({
      name: update.name ?? existing.name,
      providerType: update.providerType ?? existing.provider_type,
      baseUrl: update.baseUrl ?? existing.base_url,
      apiKey: update.apiKey ?? '',
      defaultModel: update.defaultModel ?? existing.default_model,
      models: update.models ?? parseJsonArray(existing.models_json),
      enabled: update.enabled ?? Boolean(existing.enabled),
    }, { requireApiKey: false })
    const ciphertext = provider.apiKey
      ? sealProviderSecret(provider.apiKey, this.masterSecret)
      : existing.api_key_ciphertext
    await this.pool.execute(
      `UPDATE ai_providers
       SET name = ?, provider_type = ?, base_url = ?, api_key_ciphertext = ?, default_model = ?,
           models_json = ?, capabilities_json = ?, enabled = ?, updated_by = ?
       WHERE id = ?`,
      [provider.name, provider.providerType, provider.baseUrl, ciphertext, provider.defaultModel,
        JSON.stringify(provider.models), JSON.stringify(provider.capabilities), provider.enabled ? 1 : 0,
        actorId, Number(id)]
    )
    return serializeProvider(await this.getProviderRecord(id))
  }

  async setTaskRoute(taskType, providerId, model, actorId) {
    if (taskType !== 'script_integration') invalidProvider()
    const provider = await this.getProviderRecord(providerId)
    const capabilities = parseJsonArray(provider.capabilities_json)
    const models = parseJsonArray(provider.models_json)
    const normalizedModel = String(model || '').trim()
    if (!provider.enabled || !capabilities.includes(taskType) || !models.includes(normalizedModel)) invalidProvider()
    await this.pool.execute(
      `INSERT INTO ai_task_routes (task_type, provider_id, model, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE provider_id = VALUES(provider_id), model = VALUES(model),
         updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
      [taskType, Number(providerId), normalizedModel, actorId]
    )
    return { taskType, providerId: Number(providerId), model: normalizedModel }
  }

  async getTaskRoute(taskType = 'script_integration', { allowInvalid = false } = {}) {
    const [rows] = await this.pool.execute(
      `SELECT r.task_type, r.model AS route_model, p.*
       FROM ai_task_routes r JOIN ai_providers p ON p.id = r.provider_id
       WHERE r.task_type = ?`,
      [taskType]
    )
    if (rows.length !== 1) return null

    const provider = rows[0]
    const capabilities = parseJsonArray(provider.capabilities_json)
    const models = parseJsonArray(provider.models_json)
    if (!allowInvalid && (
      !provider.enabled ||
      !capabilities.includes(taskType) ||
      !models.includes(provider.route_model)
    )) invalidProvider()

    return { taskType: provider.task_type, model: provider.route_model, provider }
  }

  async testProvider(id) {
    const provider = await this.getProviderRecord(id)
    try {
      await this.generateText(
        provider,
        '你是连接测试助手。',
        '只回复 OK。',
        provider.default_model,
        { timeoutMs: CONNECTION_TEST_TIMEOUT_MS }
      )
      await this.pool.execute(
        "UPDATE ai_providers SET last_test_status = 'success', last_tested_at = CURRENT_TIMESTAMP WHERE id = ?",
        [Number(id)]
      )
      return { success: true }
    } catch {
      await this.pool.execute(
        "UPDATE ai_providers SET last_test_status = 'failed', last_tested_at = CURRENT_TIMESTAMP WHERE id = ?",
        [Number(id)]
      )
      throw new ProviderRequestError()
    }
  }

  async generateText(provider, systemPrompt, input, modelOverride, { timeoutMs = this.requestTimeoutMs } = {}) {
    try {
      const apiKey = openProviderSecret(provider.api_key_ciphertext, this.masterSecret)
      const model = String(modelOverride || provider.default_model || '').trim()
      const baseUrl = normalizeBaseUrl(provider.base_url, provider.provider_type)
      const normalizedTimeoutMs = normalizeRequestTimeout(timeoutMs)
      if (!model) invalidProvider()

      if (provider.provider_type === 'openai') {
        const response = await this.httpClient.post(
          `${baseUrl}/responses`,
          { model, instructions: String(systemPrompt || ''), input: String(input || ''), store: false },
          requestOptions(apiKey, 'Authorization', normalizedTimeoutMs)
        )
        return { success: true, text: boundedText(extractOpenAiResponse(response.data)) }
      }

      if (provider.provider_type === 'openai_compatible') {
        const response = await this.httpClient.post(
          `${baseUrl}/chat/completions`,
          {
            model,
            messages: [
              { role: 'system', content: String(systemPrompt || '') },
              { role: 'user', content: String(input || '') },
            ],
          },
          requestOptions(apiKey, 'Authorization', normalizedTimeoutMs)
        )
        return { success: true, text: boundedText(response.data?.choices?.[0]?.message?.content) }
      }

      if (provider.provider_type === 'gemini') {
        const response = await this.httpClient.post(
          `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
          {
            system_instruction: { parts: [{ text: String(systemPrompt || '') }] },
            contents: [{ role: 'user', parts: [{ text: String(input || '') }] }],
          },
          requestOptions(apiKey, 'x-goog-api-key', normalizedTimeoutMs)
        )
        const parts = response.data?.candidates?.[0]?.content?.parts || []
        return { success: true, text: boundedText(parts.map(part => part?.text).filter(Boolean).join('\n')) }
      }

      invalidProvider()
    } catch (error) {
      if (error instanceof ProviderValidationError) throw error
      if (error instanceof ProviderRequestError) throw error
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
        throw new ProviderRequestError('provider_timeout')
      }
      throw new ProviderRequestError()
    }
  }
}

module.exports = {
  AiProviderService,
  CONNECTION_TEST_TIMEOUT_MS,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  DEFAULT_BASE_URLS,
  PROVIDER_CAPABILITIES,
  PROVIDER_TYPES,
  ProviderRequestError,
  ProviderValidationError,
  normalizeProviderInput,
  normalizeRequestTimeout,
  serializeProvider,
}
