const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const {
    createInitialAdmin,
    validateInitialAdmin
} = require('../server/services/firstRunSetup');
const envPath = path.resolve(__dirname, '../server/.env');
require('dotenv').config({ path: envPath });

const DEFAULT_BUSY_RETRIES = 2;
const DEFAULT_BUSY_RETRY_DELAY_MS = 1000;

class SetupAdminBusyError extends Error {
    constructor() {
        super('Initial administrator setup remained busy after retries');
        this.name = 'SetupAdminBusyError';
        this.code = 'SETUP_ADMIN_BUSY';
    }
}

class SetupAdminResultError extends Error {
    constructor() {
        super('Initial administrator setup returned an invalid result');
        this.name = 'SetupAdminResultError';
        this.code = 'SETUP_ADMIN_INVALID_RESULT';
    }
}

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

function readAdminConfig(env = process.env) {
    const dbConfig = {
        host: env.DB_HOST,
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME
    };
    const adminInput = {
        username: env.ADMIN_USERNAME,
        password: env.ADMIN_PASSWORD
    };

    if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
        throw new Error('DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are required');
    }

    const admin = validateInitialAdmin(adminInput);
    return { dbConfig, admin };
}

async function provisionInitialAdmin({
    pool,
    input,
    hashPassword,
    logger = console,
    createAdmin = createInitialAdmin
}) {
    const result = await createAdmin({ pool, input, hashPassword });
    if (result?.created === true) {
        logger.log('Initial administrator created.');
    } else if (result?.created === false && result.reason === 'already_initialized') {
        logger.log('The system already contains a user; leaving existing accounts unchanged.');
    } else if (result?.created === false && result.reason === 'setup_busy') {
        logger.log('Initial administrator setup is already in progress; no account was created.');
    }
    return result;
}

async function setupAdmin(options = {}) {
    const env = options.env ?? process.env;
    const logger = options.logger ?? console;
    const createPool = options.createPool ?? mysql.createPool;
    const createAdmin = options.createAdmin ?? createInitialAdmin;
    const hashPassword = options.hashPassword ?? ((password) => bcrypt.hash(password, 10));
    const sleep = options.sleep ?? delay;
    const maxBusyRetries = Number.isInteger(options.maxBusyRetries) && options.maxBusyRetries >= 0
        ? options.maxBusyRetries
        : DEFAULT_BUSY_RETRIES;
    const busyRetryDelayMs = Number.isFinite(options.busyRetryDelayMs) && options.busyRetryDelayMs >= 0
        ? options.busyRetryDelayMs
        : DEFAULT_BUSY_RETRY_DELAY_MS;
    const { dbConfig, admin } = readAdminConfig(env);
    let pool;

    try {
        logger.log('Connecting to database...');
        pool = createPool(dbConfig);
        for (let busyRetries = 0; ; busyRetries += 1) {
            const result = await provisionInitialAdmin({
                pool,
                input: admin,
                hashPassword,
                logger,
                createAdmin
            });
            if (result?.created === true ||
                (result?.created === false && result.reason === 'already_initialized')) {
                logger.log('Database connection successful.');
                return result;
            }
            if (result?.created !== false || result.reason !== 'setup_busy') {
                throw new SetupAdminResultError();
            }
            if (busyRetries >= maxBusyRetries) throw new SetupAdminBusyError();
            logger.log('Initial administrator setup is busy; retrying.');
            await sleep(busyRetryDelayMs);
        }
    } finally {
        if (pool) {
            await pool.end();
            logger.log('Database pool closed.');
        }
    }
}

async function runSetupAdminCli(options = {}) {
    const run = options.run ?? setupAdmin;
    const processLike = options.processLike ?? process;
    const logger = options.logger ?? console;
    try {
        return await run();
    } catch {
        logger.error('Initial administrator setup failed.');
        processLike.exitCode = 1;
        return null;
    }
}

if (require.main === module) {
    runSetupAdminCli();
}

module.exports = {
    SetupAdminBusyError,
    SetupAdminResultError,
    provisionInitialAdmin,
    readAdminConfig,
    runSetupAdminCli,
    setupAdmin
};
