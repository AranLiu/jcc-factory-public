const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { extractSessionToken } = require('../utils/security');

const authenticateToken = async (req, res, next) => {
    if (req.user && req.sessionId) return next();
    const token = extractSessionToken(req);

    if (!token) {
        return res.status(401).json({ message: '未认证' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            issuer: 'jcc-factory',
            audience: 'jcc-factory-web'
        });
        
        // JWT 只作为不可伪造的会话票据，数据库记录负责撤销和过期控制。
        const [users] = await pool.execute(
            `SELECT u.id, u.username, u.email, u.role, u.permission, u.status
             FROM users u
             JOIN auth_sessions s ON s.user_id = u.id
             WHERE u.id = ? AND s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
            [decoded.userId, decoded.jti]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: '用户不存在' });
        }

        const user = users[0];
        
        // 检查用户状态
        if (user.status === 'inactive') {
            return res.status(401).json({ message: '账号已被停用' });
        }

        req.user = user;
        req.sessionId = decoded.jti;
        next();
    } catch (error) {
        return res.status(401).json({ message: '会话无效或已过期' });
    }
};

// 管理员权限验证中间件
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: '未认证' });
    }
    
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '需要管理员权限' });
    }
    
    next();
};

module.exports = { authenticateToken, requireAdmin };
