const { randomBytes } = require('node:crypto');
const logger = require('../utils/logger');
const { csrfCookieOptions } = require('../utils/sessionSecurity');
const { validateAccountPassword } = require('../utils/accountPolicy');

const LOCK_NAME = 'jcc_factory_first_admin_setup';

class SetupValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'SetupValidationError';
    this.field = field;
  }
}

class SetupCleanupError extends Error {
  constructor() {
    super('First-run setup cleanup failed');
    this.name = 'SetupCleanupError';
    this.code = 'FIRST_RUN_SETUP_CLEANUP_FAILED';
  }
}

function validateInitialAdmin(input) {
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  const password = typeof input?.password === 'string' ? input.password : '';

  if (username.length < 3 || username.length > 50 || /[\u0000-\u001f\u007f-\u009f]/u.test(username)) {
    throw new SetupValidationError('username', 'Username must be 3 to 50 visible characters');
  }

  // First-run setup intentionally does not collect email. Ignore legacy or manually supplied values.
  const email = null;

  try {
    validateAccountPassword(password);
  } catch {
    throw new SetupValidationError('password', 'Password must be 8 to 128 characters');
  }

  return { username, email, password };
}

async function getSetupStatus(connectionLike) {
  const [rows] = await connectionLike.execute('SELECT id FROM users LIMIT 1');
  return { initialized: rows.length > 0 };
}

async function createInitialAdmin({ pool, input, hashPassword }) {
  const { username, email, password } = validateInitialAdmin(input);
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionActive = false;
  let primaryError;
  let cleanupFailed = false;
  let lockOutcomeUnknown = false;
  let transactionOutcomeUnknown = false;
  let connectionMustBeDestroyed = false;
  let result;

  try {
    lockOutcomeUnknown = true;
    const [lockRows] = await connection.execute(
      `SELECT GET_LOCK('${LOCK_NAME}', 10) AS acquired`
    );
    lockOutcomeUnknown = false;
    const acquired = lockRows[0]?.acquired;

    if (acquired === 0 || acquired === '0') {
      result = { created: false, reason: 'setup_busy' };
    } else {
      if (acquired !== 1 && acquired !== '1') {
        throw new Error('Unable to acquire first-run setup lock');
      }
      lockAcquired = true;

      transactionOutcomeUnknown = true;
      await connection.beginTransaction();
      transactionOutcomeUnknown = false;
      transactionActive = true;

      const { initialized } = await getSetupStatus(connection);
      if (initialized) {
        transactionOutcomeUnknown = true;
        await connection.commit();
        transactionOutcomeUnknown = false;
        transactionActive = false;
        result = { created: false, reason: 'already_initialized' };
      } else {
        const passwordHash = await hashPassword(password);
        const [insertResult] = await connection.execute(
          "INSERT INTO users (username, email, password_hash, role, permission, status) VALUES (?, ?, ?, 'admin', 'global', 'active')",
          [username, email, passwordHash]
        );
        if (insertResult.affectedRows !== 1) {
          throw new Error('Initial administrator was not created');
        }

        transactionOutcomeUnknown = true;
        await connection.commit();
        transactionOutcomeUnknown = false;
        transactionActive = false;
        result = {
          created: true,
          user: {
            id: insertResult.insertId,
            username,
            email,
            role: 'admin',
            permission: 'global',
          },
        };
      }
    }
  } catch (error) {
    primaryError = error;
    if (lockOutcomeUnknown) cleanupFailed = true;
    if (transactionOutcomeUnknown) connectionMustBeDestroyed = true;
  } finally {
    if (transactionActive || transactionOutcomeUnknown) {
      try {
        await connection.rollback();
        transactionActive = false;
        transactionOutcomeUnknown = false;
      } catch {
        cleanupFailed = true;
      }
    }

    if (lockAcquired) {
      try {
        const [releaseRows] = await connection.execute(
          `SELECT RELEASE_LOCK('${LOCK_NAME}') AS released`
        );
        const released = releaseRows[0]?.released;
        if (released !== 1 && released !== '1') {
          cleanupFailed = true;
        }
      } catch {
        cleanupFailed = true;
      }
    }

    if (cleanupFailed || connectionMustBeDestroyed) {
      try {
        connection.destroy();
      } catch {
        // The connection is already unsafe; preserve the primary or safe cleanup error below.
      }
    } else {
      try {
        connection.release();
      } catch {
        cleanupFailed = true;
        try {
          connection.destroy();
        } catch {
          // The connection is already unsafe; preserve the primary or safe cleanup error below.
        }
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupFailed) throw new SetupCleanupError();
  return result;
}

function setResponseHeader(res, name, value) {
  if (typeof res.set === 'function') return res.set(name, value);
  return res.setHeader(name, value);
}

function publicAdmin(user = {}) {
  const { id, username, email, role, permission } = user;
  return { id, username, email, role, permission };
}

function createSetupStatusHandler(dependencies = {}) {
  const connectionLike = dependencies.connectionLike || dependencies.pool;
  const getStatus = dependencies.getStatus || dependencies.getSetupStatus || getSetupStatus;
  const generateCsrfToken = dependencies.generateCsrfToken ||
    (() => randomBytes(32).toString('base64url'));
  const getCookieOptions = dependencies.getCookieOptions || csrfCookieOptions;
  const handlerLogger = dependencies.logger || logger;

  return async function setupStatusHandler(req, res) {
    try {
      const status = await getStatus(connectionLike);
      if (!status.initialized) {
        res.cookie('jcc_csrf', generateCsrfToken(), getCookieOptions());
      }
      return res.json({ initialized: Boolean(status.initialized) });
    } catch {
      handlerLogger.error('AUTH', 'First-run setup status failed');
      return res.status(500).json({ message: 'Unable to check setup status' });
    }
  };
}

function createSetupHandler(dependencies = {}) {
  const createAdmin = dependencies.createAdmin || dependencies.createInitialAdmin || createInitialAdmin;
  const handlerLogger = dependencies.logger || logger;
  const pool = dependencies.pool;
  const hashPassword = dependencies.hashPassword;

  return async function setupHandler(req, res) {
    try {
      const result = await createAdmin({ pool, input: req.body, hashPassword });

      if (result.created) {
        return res.status(201).json({ created: true, user: publicAdmin(result.user) });
      }
      if (result.reason === 'already_initialized') {
        return res.status(409).json({
          code: 'already_initialized',
          message: 'The system is already initialized',
        });
      }
      if (result.reason === 'setup_busy') {
        setResponseHeader(res, 'Retry-After', '1');
        return res.status(503).json({
          code: 'setup_busy',
          message: 'Initial setup is temporarily busy',
        });
      }

      handlerLogger.error('AUTH', 'First-run setup returned an unexpected result');
      return res.status(500).json({ message: 'Unable to create the initial administrator' });
    } catch (error) {
      if (error instanceof SetupValidationError) {
        const field = ['username', 'email', 'password'].includes(error.field) ? error.field : 'input';
        return res.status(400).json({
          field,
          message: `Invalid ${field}`,
        });
      }

      handlerLogger.error('AUTH', 'First-run setup failed');
      return res.status(500).json({ message: 'Unable to create the initial administrator' });
    }
  };
}

module.exports = {
  SetupCleanupError,
  SetupValidationError,
  createSetupHandler,
  createSetupStatusHandler,
  createInitialAdmin,
  getSetupStatus,
  validateInitialAdmin,
};
