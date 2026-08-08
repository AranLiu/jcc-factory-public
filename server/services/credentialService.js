'use strict';

async function updatePasswordAndRevokeSessions(pool, userId, passwordHash) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [passwordHash, userId]
        );
        await connection.execute(
            'DELETE FROM auth_sessions WHERE user_id = ?',
            [userId]
        );
        await connection.commit();
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // Preserve the original transactional failure.
        }
        throw error;
    } finally {
        connection.release();
    }
}

async function updateUserStatusAndSessions(pool, userId, status) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(
            'UPDATE users SET status = ? WHERE id = ?',
            [status, userId]
        );
        if (status === 'inactive') {
            await connection.execute(
                'DELETE FROM auth_sessions WHERE user_id = ?',
                [userId]
            );
        }
        await connection.commit();
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // Preserve the original transactional failure.
        }
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    updatePasswordAndRevokeSessions,
    updateUserStatusAndSessions,
};
