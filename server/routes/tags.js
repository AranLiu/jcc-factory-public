const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All tag routes require authentication
router.use(authenticateToken);

// GET /api/tags - Get all tags (now global) with usage count
router.get('/', async (req, res) => {
    try {
        const [tags] = await pool.execute(
            `SELECT 
                t.id, t.name, t.color, COUNT(kbt.knowledge_base_id) as usage_count,
                COUNT(kbt.knowledge_base_id) as file_count
            FROM tags t
            LEFT JOIN knowledge_base_tags kbt ON t.id = kbt.tag_id
            GROUP BY t.id
            ORDER BY t.name`
        );
        res.json(tags);
    } catch (error) {
        console.error('Failed to get tags:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/tags - Create a new tag (now global)
router.post('/', async (req, res) => {
    const { name, color } = req.body;

    if (!name || !color) {
        return res.status(400).json({ message: 'Tag name and color are required.' });
    }

    try {
        const [result] = await pool.execute(
            'INSERT INTO tags (name, color) VALUES (?, ?)',
            [name, color]
        );
        const newTagId = result.insertId;
        res.status(201).json({ id: newTagId, name, color });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'A tag with this name already exists.' });
        }
        console.error('Failed to create tag:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/tags/:id - Delete a tag (now global, requires admin permission)
router.delete('/:id', async (req, res) => {
    const { id: tagId } = req.params;
    const { role: userRole, permission: userPermission } = req.user;

    try {
        // 只有管理员或global权限用户可以删除标签
        if (userRole !== 'admin' && userPermission !== 'global') {
            return res.status(403).json({ message: 'Permission denied. Only admins can delete global tags.' });
        }

        // 检查标签是否存在
        const [tags] = await pool.execute(
            'SELECT * FROM tags WHERE id = ?',
            [tagId]
        );

        if (tags.length === 0) {
            return res.status(404).json({ message: 'Tag not found.' });
        }

        await pool.execute('DELETE FROM tags WHERE id = ?', [tagId]);
        // The ON DELETE CASCADE in the knowledge_base_tags table will handle orphaned entries.
        res.status(204).send(); // No Content
    } catch (error) {
        console.error(`Failed to delete tag ${tagId}:`, error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router; 