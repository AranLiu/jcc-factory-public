const { pool } = require('../config/database');

async function fixPermissionEnum() {
    try {
        console.log('开始修复权限字段枚举值...');
        
        // 首先检查当前的权限字段定义
        const [columns] = await pool.execute(`
            SELECT COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'permission'
        `, [process.env.DB_NAME || 'jcc_factory']);
        
        if (columns.length > 0) {
            console.log('当前权限字段定义:', columns[0].COLUMN_TYPE);
            
            // 检查是否包含'full_access'
            if (columns[0].COLUMN_TYPE.includes('full_access')) {
                console.log('检测到需要修复的权限字段，开始修复...');
                
                // 先更新现有的'full_access'数据为'global'
                const [updateResult] = await pool.execute(`
                    UPDATE users SET permission = 'global' WHERE permission = 'full_access'
                `);
                console.log(`更新了 ${updateResult.affectedRows} 条记录的权限值`);
                
                // 修改列定义
                await pool.execute(`
                    ALTER TABLE users MODIFY COLUMN permission 
                    ENUM('personal', 'readonly_global', 'global') DEFAULT 'personal' NOT NULL
                `);
                console.log('✅ 权限字段枚举值修复完成');
            } else {
                console.log('权限字段已经是正确的格式，无需修复');
            }
        } else {
            console.log('未找到权限字段，可能表结构有问题');
        }
        
        // 验证修复结果
        const [newColumns] = await pool.execute(`
            SELECT COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'permission'
        `, [process.env.DB_NAME || 'jcc_factory']);
        
        if (newColumns.length > 0) {
            console.log('修复后的权限字段定义:', newColumns[0].COLUMN_TYPE);
        }
        
        console.log('✅ 权限字段修复脚本执行完成');
        
    } catch (error) {
        console.error('❌ 修复权限字段时出错:', error);
        throw error;
    }
}

// 如果直接运行这个脚本
if (require.main === module) {
    fixPermissionEnum()
        .then(() => {
            console.log('脚本执行完成');
            process.exit(0);
        })
        .catch(error => {
            console.error('脚本执行失败:', error);
            process.exit(1);
        });
}

module.exports = { fixPermissionEnum }; 