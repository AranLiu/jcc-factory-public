const mysql = require('mysql2/promise');
const path = require('path');
// 明确从 server/.env 读取环境变量，避免工作目录差异导致未加载
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { validateDatabaseEnv } = require('./env');

const validatedDbConfig = validateDatabaseEnv(process.env);
const dbConfig = {
    ...validatedDbConfig,
    charset: 'utf8mb4',
    connectionLimit: 10,
    connectTimeout: 60000
};

console.log('=======================================');
console.log('  ATTEMPTING TO CONNECT WITH DATABASE  ');
console.log('---------------------------------------');
console.log(`  Host:     ${dbConfig.host}`);
console.log(`  Port:     ${dbConfig.port}`);
console.log(`  User:     ${dbConfig.user}`);
console.log(`  Database: ${dbConfig.database}`);
console.log(`  Password: ${dbConfig.password ? 'Provided' : 'NOT PROVIDED (empty)'}`);
console.log('=======================================');

const pool = mysql.createPool(dbConfig);
const quotaPool = mysql.createPool({
    ...dbConfig,
    connectionLimit: Number(process.env.QUOTA_LOCK_CONNECTION_LIMIT || 4),
    queueLimit: Number(process.env.QUOTA_LOCK_QUEUE_LIMIT || 32)
});

// 测试数据库连接
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log(`✅ 数据库连接成功:
   - Host: ${dbConfig.host}
   - Port: ${dbConfig.port}
   - User: ${dbConfig.user}
   - Database: ${dbConfig.database}`);
        connection.release();
    } catch (error) {
        console.error('❌ 数据库连接失败:', error.message);
        process.exit(1);
    }
}

module.exports = { dbConfig, pool, quotaPool, testConnection };
