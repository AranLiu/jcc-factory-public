UPDATE ai_tasks
SET task_type = 'global_character_content'
WHERE task_type = 'character_integration'
  AND prompt = '手动录入全局角色图谱';
