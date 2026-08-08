-- 标签全局化迁移脚本
-- 将标签从用户私有改为全局共享

USE jcc_factory;

-- 第一步：处理重复标签
-- 首先查看重复情况
SELECT 
    name,
    COUNT(*) as count,
    GROUP_CONCAT(id ORDER BY id) as ids
FROM tags 
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1;

-- 手动处理重复的"人工审核完成"标签
-- 更新所有指向id=4和id=5的关联到id=3
UPDATE knowledge_base_tags SET tag_id = 3 WHERE tag_id = 4 AND NOT EXISTS (
    SELECT 1 FROM (SELECT * FROM knowledge_base_tags) as kbt2 
    WHERE kbt2.knowledge_base_id = knowledge_base_tags.knowledge_base_id 
    AND kbt2.tag_id = 3
);

UPDATE knowledge_base_tags SET tag_id = 3 WHERE tag_id = 5 AND NOT EXISTS (
    SELECT 1 FROM (SELECT * FROM knowledge_base_tags) as kbt2 
    WHERE kbt2.knowledge_base_id = knowledge_base_tags.knowledge_base_id 
    AND kbt2.tag_id = 3
);

-- 删除重复的关联记录
DELETE FROM knowledge_base_tags WHERE tag_id IN (4, 5);

-- 删除重复的标签
DELETE FROM tags WHERE id IN (4, 5);

-- 第二步：移除外键约束
ALTER TABLE tags DROP FOREIGN KEY tags_ibfk_1;

-- 第三步：删除唯一约束
ALTER TABLE tags DROP INDEX unique_user_tag;

-- 第四步：删除user_id字段
ALTER TABLE tags DROP COLUMN user_id;

-- 第五步：添加新的唯一约束（标签名称全局唯一）
ALTER TABLE tags ADD UNIQUE KEY unique_tag_name (name);

-- 显示迁移结果
SELECT 'Migration completed. Current tags:' as message;
SELECT id, name, color FROM tags ORDER BY name;

-- 显示标签使用统计
SELECT 
    t.id,
    t.name,
    t.color,
    COUNT(kbt.knowledge_base_id) as usage_count
FROM tags t
LEFT JOIN knowledge_base_tags kbt ON t.id = kbt.tag_id
GROUP BY t.id, t.name, t.color
ORDER BY usage_count DESC, t.name; 