const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../server/.env');

if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    console.log('⚠️  环境变量文件不存在，将读取进程环境变量');
}

const { validateDatabaseEnv } = require('../server/config/env');
const dbConfig = validateDatabaseEnv(process.env);

async function setAdminPermissions() {
    let connection;
    try {
        console.log('🔗 连接数据库...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ 数据库连接成功');

        // 设置admin用户的最高权限
        console.log('🔑 设置admin用户最高权限...');
        const [result] = await connection.execute(
            `UPDATE users 
             SET role = 'admin', 
                 permission = 'global',
                 status = 'active' 
             WHERE username = 'admin'`
        );

        if (result.affectedRows > 0) {
            console.log('✅ admin用户权限设置成功！');
            
            // 查询并显示当前权限
            const [userInfo] = await connection.execute(
                'SELECT id, username, email, role, permission, status FROM users WHERE username = ?',
                ['admin']
            );

            if (userInfo.length > 0) {
                const user = userInfo[0];
                console.log('\n📋 admin用户当前信息：');
                console.log(`   ID: ${user.id}`);
                console.log(`   用户名: ${user.username}`);
                console.log(`   邮箱: ${user.email}`);
                console.log(`   角色: ${user.role}`);
                console.log(`   权限: ${user.permission}`);
                console.log(`   状态: ${user.status}`);
                
                console.log('\n🎯 权限说明：');
                console.log('   • role: admin = 管理员角色');
                console.log('   • permission: global = 全局读写权限');
                console.log('   • 包含权限：系统管理、用户管理、全局数据访问');
            }
        } else {
            console.error('❌ 未找到admin用户，请先运行 setup-admin.js 创建admin用户');
        }

    } catch (error) {
        console.error('❌ 权限设置失败:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔒 数据库连接已关闭');
        }
    }
}

// 显示权限级别说明
function showPermissionInfo() {
    console.log('\n📚 系统权限级别说明：');
    console.log('┌─────────────────┬──────────────────────────────────────┐');
    console.log('│ 权限级别        │ 描述                                 │');
    console.log('├─────────────────┼──────────────────────────────────────┤');
    console.log('│ personal        │ 个人权限，只能访问自己的数据         │');
    console.log('│ readonly_global │ 全局只读，可查看所有数据但不能修改   │');
    console.log('│ global          │ 全局访问，可读写所有业务数据         │');
    console.log('└─────────────────┴──────────────────────────────────────┘');
    
    console.log('\n🔒 角色级别说明：');
    console.log('┌─────────────────┬──────────────────────────────────────┐');
    console.log('│ 角色类型        │ 描述                                 │');
    console.log('├─────────────────┼──────────────────────────────────────┤');
    console.log('│ user            │ 普通用户                             │');
    console.log('│ admin           │ 管理员用户，拥有系统管理权限         │');
    console.log('└─────────────────┴──────────────────────────────────────┘');
}

console.log('🚀 设置 JCC Factory Admin 用户权限');
console.log('=====================================');

showPermissionInfo();
setAdminPermissions();
