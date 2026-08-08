const RELAY_KEYS = new Set([
  'proxy_service_enabled',
  'proxy_service_url',
  'proxy_service_auth_token',
]);

const MAX_RELAY_TOKEN_LENGTH = 4096;
const GENERIC_VALIDATION_MESSAGE = 'API relay configuration is invalid';
const GENERIC_STORAGE_MESSAGE = 'API relay configuration is unavailable';

class RelayConfigValidationError extends Error {
  constructor() {
    super(GENERIC_VALIDATION_MESSAGE);
    this.name = 'RelayConfigValidationError';
  }
}

class RelayConfigStorageError extends Error {
  constructor() {
    super(GENERIC_STORAGE_MESSAGE);
    this.name = 'RelayConfigStorageError';
  }
}

function invalidRelayConfig() {
  throw new RelayConfigValidationError();
}

function validateRelayUrl(value) {
  if (typeof value !== 'string') invalidRelayConfig();

  const normalized = value.trim();
  if (normalized === '') return '';

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    invalidRelayConfig();
  }

  if (parsed.username || parsed.password) invalidRelayConfig();

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isSecure = parsed.protocol === 'https:';
  const isLoopbackDevelopment = parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname.toLowerCase());
  if (!isSecure && !isLoopbackDevelopment) invalidRelayConfig();

  return normalized;
}

function validateRelayToken(value) {
  if (typeof value !== 'string' || value.length > MAX_RELAY_TOKEN_LENGTH) invalidRelayConfig();
  if (/^\[redacted\]$/i.test(value.trim())) invalidRelayConfig();
  if (value !== '' && (/^[\s]+$/.test(value) || /[\u0000-\u001f\u007f]/.test(value))) invalidRelayConfig();
  return value;
}

function validateRelayConfigUpdate(key, value) {
  if (!RELAY_KEYS.has(key)) invalidRelayConfig();

  if (key === 'proxy_service_enabled') {
    if (typeof value !== 'boolean') invalidRelayConfig();
    return value;
  }

  if (key === 'proxy_service_url') return validateRelayUrl(value);
  return validateRelayToken(value);
}

function validateEnabledRelaySnapshot(enabled, url, authToken, { requireEnabled = false } = {}) {
  const validEnabled = validateRelayConfigUpdate('proxy_service_enabled', enabled);
  if (!validEnabled) {
    if (requireEnabled) invalidRelayConfig();
    return { enabled: false, url: '', authToken: '' };
  }

  const validUrl = validateRelayConfigUpdate('proxy_service_url', url);
  const validToken = validateRelayConfigUpdate('proxy_service_auth_token', authToken);
  if (!validUrl || !validToken) invalidRelayConfig();
  return { enabled: true, url: validUrl, authToken: validToken };
}

async function loadValidatedRelayConfig(configService, options = {}) {
  let snapshot;
  try {
    snapshot = await configService.getRelayConfigSnapshot();
  } catch {
    throw new RelayConfigStorageError();
  }

  return validateEnabledRelaySnapshot(
    snapshot?.proxy_service_enabled,
    snapshot?.proxy_service_url,
    snapshot?.proxy_service_auth_token,
    options
  );
}

function normalizeLockedRelayRows(rows) {
  const values = new Map(rows.map(row => [row.config_key, row.config_value]));
  if (values.size !== RELAY_KEYS.size || [...RELAY_KEYS].some(key => !values.has(key))) {
    invalidRelayConfig();
  }

  const rawEnabled = values.get('proxy_service_enabled');
  let enabled;
  if (rawEnabled === true || rawEnabled === 'true') enabled = true;
  else if (rawEnabled === false || rawEnabled === 'false') enabled = false;
  else invalidRelayConfig();

  return {
    proxy_service_enabled: enabled,
    proxy_service_url: values.get('proxy_service_url'),
    proxy_service_auth_token: values.get('proxy_service_auth_token'),
  };
}

async function readRelayConfigSnapshot(connectionLike) {
  const [rows] = await connectionLike.execute(
    `SELECT config_key, config_value, config_type
     FROM system_config
     WHERE config_key IN ('proxy_service_enabled', 'proxy_service_url', 'proxy_service_auth_token')
     ORDER BY config_key`,
    []
  );
  return normalizeLockedRelayRows(rows);
}

function validateProposedRelaySnapshot(snapshot, key, value) {
  if ((key === 'proxy_service_url' || key === 'proxy_service_auth_token') && snapshot.proxy_service_enabled) {
    invalidRelayConfig();
  }

  const proposed = { ...snapshot, [key]: value };
  if (proposed.proxy_service_enabled) {
    validateEnabledRelaySnapshot(
      proposed.proxy_service_enabled,
      proposed.proxy_service_url,
      proposed.proxy_service_auth_token,
      { requireEnabled: true }
    );
  }
}

async function updateRelayConfigTransaction({ pool, key, value, userId }) {
  const validValue = validateRelayConfigUpdate(key, value);
  const connection = await pool.getConnection();
  let transactionActive = false;
  let transactionOutcomeUnknown = false;
  let connectionMustBeDestroyed = false;
  let cleanupFailed = false;
  let primaryError;
  let result = false;

  try {
    transactionOutcomeUnknown = true;
    await connection.beginTransaction();
    transactionOutcomeUnknown = false;
    transactionActive = true;

    const [rows] = await connection.execute(
      `SELECT config_key, config_value, config_type
       FROM system_config
       WHERE config_key IN ('proxy_service_enabled', 'proxy_service_url', 'proxy_service_auth_token')
       ORDER BY config_key
       FOR UPDATE`
    );
    const snapshot = normalizeLockedRelayRows(rows);
    validateProposedRelaySnapshot(snapshot, key, validValue);

    const configType = key === 'proxy_service_enabled' ? 'boolean' : 'string';
    const configValue = key === 'proxy_service_enabled' ? String(validValue) : validValue;
    const [updateResult] = await connection.execute(
      `UPDATE system_config
       SET config_value = ?, config_type = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE config_key = ?`,
      [configValue, configType, userId, key]
    );
    if (updateResult.affectedRows !== 1) throw new RelayConfigStorageError();

    transactionOutcomeUnknown = true;
    await connection.commit();
    transactionOutcomeUnknown = false;
    transactionActive = false;
    result = true;
  } catch (error) {
    primaryError = error instanceof RelayConfigValidationError || error instanceof RelayConfigStorageError
      ? error
      : new RelayConfigStorageError();
    if (transactionOutcomeUnknown) connectionMustBeDestroyed = true;
  } finally {
    if (transactionActive || transactionOutcomeUnknown) {
      try {
        await connection.rollback();
        transactionActive = false;
        transactionOutcomeUnknown = false;
      } catch {
        cleanupFailed = true;
        connectionMustBeDestroyed = true;
      }
    }

    if (connectionMustBeDestroyed || cleanupFailed) {
      try { connection.destroy(); } catch { /* unsafe connection is discarded */ }
    } else {
      try {
        connection.release();
      } catch {
        cleanupFailed = true;
        try { connection.destroy(); } catch { /* unsafe connection is discarded */ }
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupFailed) throw new RelayConfigStorageError();
  return result;
}

function createRelayConfigUpdateHandler({ configService } = {}) {
  const service = configService || require('../services/systemConfigService');

  return async function updateRelayConfig(req, res) {
    try {
      const key = req.params?.key;
      const value = validateRelayConfigUpdate(key, req.body?.value);

      const success = await service.updateRelayConfig(key, value, req.user.id);
      if (!success) {
        return res.status(500).json({ success: false, message: 'Unable to update API relay configuration' });
      }

      return res.json({ success: true, message: 'API relay configuration updated' });
    } catch (error) {
      if (error instanceof RelayConfigValidationError) {
        return res.status(400).json({ success: false, message: GENERIC_VALIDATION_MESSAGE });
      }

      console.error('Failed to update API relay configuration');
      return res.status(500).json({ success: false, message: 'Unable to update API relay configuration' });
    }
  };
}

module.exports = {
  MAX_RELAY_TOKEN_LENGTH,
  RELAY_KEYS,
  RelayConfigStorageError,
  RelayConfigValidationError,
  createRelayConfigUpdateHandler,
  loadValidatedRelayConfig,
  readRelayConfigSnapshot,
  updateRelayConfigTransaction,
  validateRelayConfigUpdate,
};
