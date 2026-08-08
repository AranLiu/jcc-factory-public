async function insertQueuedTask(pool, {
  projectId,
  fileId,
  prompt,
  modelConfig = {},
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(`
      INSERT INTO ai_tasks
      (project_id, file_id, prompt, model_config, status, task_type, task_source, priority, queue_position, max_retries)
      VALUES (?, ?, ?, ?, 'pending', 'video_analysis', 'queue', 1, NULL, 3)
    `, [projectId, fileId, prompt, JSON.stringify(modelConfig)]);
    await connection.execute(
      'UPDATE ai_tasks SET queue_position = ? WHERE id = ?',
      [result.insertId, result.insertId]
    );
    await connection.commit();
    return { insertId: result.insertId, queuePosition: result.insertId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { insertQueuedTask };
