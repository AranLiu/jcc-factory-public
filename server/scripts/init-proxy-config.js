#!/usr/bin/env node

const mysql = require('mysql2/promise');
require('dotenv').config();
const { validateDatabaseEnv } = require('../config/env');

// 创建数据库连接
const pool = mysql.createPool({
    ...validateDatabaseEnv(process.env),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000
});

async function initProxyConfigs() {
    try {
        console.log('🔧 初始化代理服务配置...');
        
        const configs = [
            ['proxy_service_enabled', 'false', 'boolean', '是否启用代理服务'],
            ['proxy_service_url', '', 'string', '代理服务器地址'],
            ['proxy_service_auth_token', '', 'string', '代理服务认证密钥']
        ];
        
        for (const [key, value, type, description] of configs) {
            // 检查配置是否已存在
            const [existing] = await pool.execute(
                'SELECT config_key FROM system_config WHERE config_key = ?',
                [key]
            );
            
            if (existing.length === 0) {
                await pool.execute(`
                    INSERT INTO system_config (config_key, config_value, config_type, description, updated_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 1, NOW(), NOW())
                `, [key, value, type, description]);
                console.log(`✅ 新增配置项: ${key}`);
            } else {
                console.log(`ℹ️  配置项已存在: ${key}`);
            }
        }
        
        console.log('🎉 代理服务配置初始化完成');
        
    } catch (error) {
        console.error('❌ 初始化失败:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    initProxyConfigs()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { initProxyConfigs };
