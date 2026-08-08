const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes, randomUUID } = require('node:crypto');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');
const {
    createSetupHandler,
    createSetupStatusHandler
} = require('../services/firstRunSetup');
const {
    clearCsrfCookieOptions,
    clearSessionCookieOptions,
    csrfCookieOptions,
    SESSION_TTL_SECONDS,
    sessionCookieOptions
} = require('../utils/sessionSecurity');
const { getApiOnboardingStatus } = require('../services/apiOnboarding');
const { normalizeOptionalEmail, validateAccountPassword } = require('../utils/accountPolicy');
const {
    updatePasswordAndRevokeSessions,
    updateUserStatusAndSessions
} = require('../services/credentialService');

const router = express.Router();
const DUMMY_PASSWORD_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5f9GFlK4ncZQ0Bqcpj3F8yYw57ixIxa';

async function withApiOnboardingRequirement(user, {
    connectionLike = pool,
    env = process.env,
    getStatus = getApiOnboardingStatus,
    logger: statusLogger = logger
} = {}) {
    if (user.role !== 'admin') return user;

    try {
        const status = await getStatus({ connectionLike, env });
        return { ...user, apiOnboardingRequired: Boolean(status.required) };
    } catch (error) {
        statusLogger.error('AUTH', 'API onboarding status unavailable', { userId: user.id });
        return { ...user, apiOnboardingRequired: true };
    }
}

router.get('/setup-status', createSetupStatusHandler({
    connectionLike: pool,
    logger
}));

router.post('/setup', createSetupHandler({
    pool,
    hashPassword: password => bcrypt.hash(password, 10),
    logger
}));

// 登录
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '用户名和密码不能为空' });
        }

        // 查询用户
        const [users] = await pool.execute(
            'SELECT id, username, email, password_hash, role, permission, status FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        const user = users[0];
        const isValidPassword = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);

        if (!user || !isValidPassword) {
            logger.warn('AUTH', '登录失败 - 凭据无效', { ip: req.ip });
            return res.status(401).json({ message: '用户名或密码错误' });
        }

        // 检查用户状态
        if (user.status === 'inactive') {
            logger.warn('AUTH', '登录失败 - 账号已停用', { userId: user.id, username: user.username, ip: req.ip });
            return res.status(401).json({ message: '账号已被停用，请联系管理员' });
        }

        const sessionId = randomUUID();
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            {
                expiresIn: SESSION_TTL_SECONDS,
                jwtid: sessionId,
                issuer: 'jcc-factory',
                audience: 'jcc-factory-web'
            }
        );
        const csrfToken = randomBytes(32).toString('base64url');

        await pool.execute(
            `INSERT INTO auth_sessions (id, user_id, expires_at, user_agent, ip_address)
             VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND), ?, ?)`,
            [sessionId, user.id, SESSION_TTL_SECONDS, req.get('User-Agent') || null, req.ip || null]
        );

        res.cookie('jcc_session', token, sessionCookieOptions());
        res.cookie('jcc_csrf', csrfToken, csrfCookieOptions());

        logger.success('AUTH', '用户登录成功', { 
            userId: user.id, 
            username: user.username, 
            role: user.role,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const responseUser = await withApiOnboardingRequirement({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            permission: user.permission
        });

        res.json({
            message: '登录成功',
            user: responseUser
        });
    } catch (error) {
        logger.error('AUTH', '登录过程发生错误', error);
        res.status(500).json({ message: '登录失败' });
    }
});

// 验证token
router.get('/verify', authenticateToken, async (req, res) => {
    const responseUser = await withApiOnboardingRequirement({
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        permission: req.user.permission
    });

    res.json({
        message: 'Token有效',
        user: responseUser
    });
});

router.post('/logout', authenticateToken, async (req, res) => {
    await pool.execute('DELETE FROM auth_sessions WHERE id = ?', [req.sessionId]);
    res.clearCookie('jcc_session', clearSessionCookieOptions());
    res.clearCookie('jcc_csrf', clearCsrfCookieOptions());
    res.json({ message: '已退出登录' });
});

// 保留旧路径，但严格限制为管理员，避免已有管理端调用失效。
router.post('/create-user', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '用户名和密码都是必需的' });
        }

        let normalizedEmail;
        try {
            normalizedEmail = normalizeOptionalEmail(email);
            validateAccountPassword(password);
        } catch (error) {
            const message = error.code === 'INVALID_EMAIL'
                ? '邮箱格式无效'
                : '密码长度必须为 8-128 位';
            return res.status(400).json({ message });
        }

        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ message: '用户名或邮箱已存在' });
        }

        // 加密密码
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // 创建用户
        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, normalizedEmail, passwordHash]
        );

        res.status(201).json({
            message: '用户创建成功',
            userId: result.insertId
        });
    } catch (error) {
        console.error('创建用户错误:', error);
        res.status(500).json({ message: '创建用户失败' });
    }
});

// 修改密码
router.post('/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: '旧密码和新密码不能为空' });
    }

    try {
        validateAccountPassword(newPassword);
    } catch {
        return res.status(400).json({ message: '新密码长度必须为 8-128 位' });
    }

    try {
        // 获取当前用户密码
        const [users] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }
        const user = users[0];

        // 验证旧密码
        const isValidPassword = await bcrypt.compare(oldPassword, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: '旧密码错误' });
        }

        // 加密新密码并更新
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await updatePasswordAndRevokeSessions(pool, userId, newPasswordHash);

        res.clearCookie('jcc_session', clearSessionCookieOptions());
        res.clearCookie('jcc_csrf', clearCsrfCookieOptions());

        res.json({ message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ message: '服务器内部错误，修改失败' });
    }
});

// ===================
// 管理员专用用户管理API
// ===================

// 获取用户列表（管理员）
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [users] = await pool.execute(`
            SELECT 
                u.id, 
                u.username, 
                u.email, 
                u.role, 
                u.permission,
                u.status,
                u.remarks,
                u.created_at,
                COALESCE(p.project_count, 0) as project_count,
                COALESCE(k.kb_count, 0) as kb_count
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) as project_count 
                FROM projects 
                GROUP BY user_id
            ) p ON u.id = p.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as kb_count 
                FROM knowledge_base 
                GROUP BY user_id
            ) k ON u.id = k.user_id
            ORDER BY u.created_at DESC
        `);
        res.json({ users });
    } catch (error) {
        console.error('获取用户列表错误:', error);
        res.status(500).json({ message: '获取用户列表失败' });
    }
});

// 创建用户（管理员）
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, email, password, role = 'user', permission = 'personal', remarks = '' } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '用户名和密码都是必需的' });
        }

        let normalizedEmail;
        try {
            normalizedEmail = normalizeOptionalEmail(email);
            validateAccountPassword(password);
        } catch (error) {
            const message = error.code === 'INVALID_EMAIL'
                ? '邮箱格式无效'
                : '密码长度必须为 8-128 位';
            return res.status(400).json({ message });
        }

        // 验证权限值
        if (!['personal', 'readonly_global', 'global'].includes(permission)) {
            return res.status(400).json({ message: '无效的权限设置' });
        }

        // 检查用户是否已存在
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ message: '用户名或邮箱已存在' });
        }

        // 加密密码
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // 创建用户
        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password_hash, role, permission, remarks) VALUES (?, ?, ?, ?, ?, ?)',
            [username, normalizedEmail, passwordHash, role, permission, remarks]
        );

        res.status(201).json({
            message: '用户创建成功',
            user: {
                id: result.insertId,
                username,
                email: normalizedEmail,
                role,
                permission,
                remarks
            }
        });
    } catch (error) {
        console.error('创建用户错误:', error);
        res.status(500).json({ message: '创建用户失败' });
    }
});

// 重置用户密码（管理员）
router.post('/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({ message: '新密码不能为空' });
        }

        try {
            validateAccountPassword(newPassword);
        } catch {
            return res.status(400).json({ message: '密码长度必须为 8-128 位' });
        }

        // 检查用户是否存在
        const [users] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }

        // 加密新密码并更新
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await updatePasswordAndRevokeSessions(pool, id, passwordHash);

        res.json({ message: '密码重置成功' });
    } catch (error) {
        console.error('重置密码错误:', error);
        res.status(500).json({ message: '重置密码失败' });
    }
});

// 删除用户（管理员）
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // 不允许删除自己
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ message: '不能删除自己的账号' });
        }

        // 检查用户是否存在
        const [users] = await pool.execute('SELECT id, username FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const user = users[0];

        // 检查用户是否有关联的项目
        const [projects] = await pool.execute(
            'SELECT COUNT(*) as project_count FROM projects WHERE user_id = ?', 
            [id]
        );
        
        if (projects[0].project_count > 0) {
            return res.status(400).json({ 
                message: `无法删除用户"${user.username}"，该用户还有 ${projects[0].project_count} 个项目。请先删除或转移其项目后再删除用户。`
            });
        }

        // 检查用户是否有知识库内容
        const [knowledgeBase] = await pool.execute(
            'SELECT COUNT(*) as kb_count FROM knowledge_base WHERE user_id = ?', 
            [id]
        );
        
        if (knowledgeBase[0].kb_count > 0) {
            return res.status(400).json({ 
                message: `无法删除用户"${user.username}"，该用户还有 ${knowledgeBase[0].kb_count} 个知识库条目。请先清理其知识库内容后再删除用户。`
            });
        }

        // 如果没有关联数据，则可以安全删除
        await pool.execute('DELETE FROM users WHERE id = ?', [id]);

        res.json({ message: `用户"${user.username}"删除成功` });
    } catch (error) {
        console.error('删除用户错误:', error);
        res.status(500).json({ message: '删除用户失败' });
    }
});

// 停用/启用用户（管理员）
router.put('/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // 验证状态值
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ message: '无效的状态值' });
        }

        // 不允许停用自己
        if (parseInt(id) === req.user.id && status === 'inactive') {
            return res.status(400).json({ message: '不能停用自己的账号' });
        }

        // 检查用户是否存在
        const [users] = await pool.execute('SELECT id, username, status FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const user = users[0];
        
        // 如果状态相同，无需更新
        if (user.status === status) {
            return res.status(200).json({ 
                message: `用户"${user.username}"已经是${status === 'active' ? '启用' : '停用'}状态` 
            });
        }

        // 更新用户状态
        await updateUserStatusAndSessions(pool, id, status);

        const action = status === 'active' ? '启用' : '停用';
        res.json({ message: `用户"${user.username}"${action}成功` });
    } catch (error) {
        console.error('更新用户状态错误:', error);
        res.status(500).json({ message: '更新用户状态失败' });
    }
});

// 更新用户备注（管理员）
router.put('/users/:id/remarks', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        // 检查用户是否存在
        const [users] = await pool.execute('SELECT id, username FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const user = users[0];

        // 更新用户备注
        await pool.execute('UPDATE users SET remarks = ? WHERE id = ?', [remarks || '', id]);

        res.json({ message: `用户"${user.username}"备注更新成功` });
    } catch (error) {
        console.error('更新用户备注错误:', error);
        res.status(500).json({ message: '更新用户备注失败' });
    }
});

// 更新用户权限（管理员）
router.put('/users/:id/permission', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permission } = req.body;

        // 验证权限值
        if (!['personal', 'readonly_global', 'global'].includes(permission)) {
            return res.status(400).json({ message: '无效的权限设置' });
        }

        // 检查用户是否存在
        const [users] = await pool.execute('SELECT id, username, permission FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const user = users[0];
        
        // 如果权限相同，无需更新
        if (user.permission === permission) {
            return res.status(200).json({ 
                message: `用户"${user.username}"已经是${getPermissionText(permission)}权限` 
            });
        }

        // 更新用户权限
        await pool.execute('UPDATE users SET permission = ? WHERE id = ?', [permission, id]);

        res.json({ message: `用户"${user.username}"权限更新为${getPermissionText(permission)}成功` });
    } catch (error) {
        console.error('更新用户权限错误:', error);
        res.status(500).json({ message: '更新用户权限失败' });
    }
});

// 权限文本映射
function getPermissionText(permission) {
    const map = {
        'personal': '个人',
        'readonly_global': '全局只读',
        'global': '全局'
    };
    return map[permission] || permission;
}

module.exports = router;
module.exports.withApiOnboardingRequirement = withApiOnboardingRequirement;
