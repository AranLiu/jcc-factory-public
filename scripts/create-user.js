#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const readline = require('readline');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });
const { validateDatabaseEnv } = require('../server/config/env');
const { normalizeOptionalEmail, validateAccountPassword } = require('../server/utils/accountPolicy');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createUser() {
  try {
    console.log('=== 剧绕乐用户创建工具 ===\n');

    // 获取用户输入
    const username = await question('请输入用户名: ');
    const email = normalizeOptionalEmail(await question('请输入邮箱（可选，直接回车跳过）: '));
    let password = await question('请输入密码: ');
    
    if (!username || !password) {
      console.log('❌ 用户名和密码必须填写');
      process.exit(1);
    }

    try {
      validateAccountPassword(password);
    } catch {
      console.log('❌ 密码长度必须为 8-128 位');
      process.exit(1);
    }

    // 连接数据库
    const connection = await mysql.createConnection(validateDatabaseEnv(process.env));

    console.log('✅ 数据库连接成功');

    // 检查用户是否已存在
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      console.log('❌ 用户名或邮箱已存在');
      await connection.end();
      process.exit(1);
    }

    // 加密密码
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 创建用户
    const [result] = await connection.execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );

    console.log('\n✅ 用户创建成功！');
    console.log('用户信息:');
    console.log(`  ID: ${result.insertId}`);
    console.log(`  用户名: ${username}`);
    if (email) console.log(`  邮箱: ${email}`);
    console.log('\n密码未写入日志，请由创建者安全保管。');

    await connection.end();
    
  } catch (error) {
    console.error('❌ 创建用户失败:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// 检查环境变量
if (!process.env.DB_PASSWORD) {
  console.log('❌ 请先配置数据库环境变量');
  console.log('请确保 server/.env 文件存在并配置正确');
  process.exit(1);
}

// 运行创建用户函数
createUser();
