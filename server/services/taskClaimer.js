async function claimNextTask(pool, { workerId, leaseSeconds = 30 * 60 } = {}) {
  if (!workerId) throw new Error('workerId is required');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [pauseRows] = await connection.execute(
      "SELECT config_value FROM system_config WHERE config_key = 'queue_paused' FOR UPDATE"
    );
    if (String(pauseRows[0]?.config_value).toLowerCase() === 'true') {
      await connection.commit();
      return null;
    }
    const [tasks] = await connection.execute(`
      SELECT at.*, f.original_name, f.file_path, f.mime_type AS file_type, f.storage_type,
             f.minio_bucket, f.minio_object_name, p.name AS project_name,
             p.type AS project_type, p.user_id
      FROM ai_tasks at
      JOIN files f ON at.file_id = f.id
      JOIN projects p ON at.project_id = p.id
      WHERE (at.status = 'pending' AND at.available_at <= CURRENT_TIMESTAMP)
         OR (at.status = 'processing' AND (at.lease_until IS NULL OR at.lease_until < CURRENT_TIMESTAMP))
      ORDER BY at.priority DESC, at.queue_position ASC, at.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (tasks.length === 0) {
      await connection.commit();
      return null;
    }

    const task = tasks[0];
    const [result] = await connection.execute(`
      UPDATE ai_tasks
      SET status = 'processing', worker_id = ?,
          lease_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
          attempt_count = attempt_count + 1,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `, [workerId, leaseSeconds, task.id]);
    if (result.affectedRows !== 1) throw new Error('Task claim was not persisted');

    await connection.commit();
    return { ...task, worker_id: workerId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeClaimedTask(pool, { taskId, workerId, result }) {
  const [write] = await pool.execute(`
    UPDATE ai_tasks
    SET status = 'completed', result = ?, completed_at = CURRENT_TIMESTAMP,
        worker_id = NULL, lease_until = NULL
    WHERE id = ? AND status = 'processing' AND worker_id = ?
      AND cancel_requested = 0 AND pause_requested = 0
  `, [result, taskId, workerId]);
  return write.affectedRows === 1;
}

async function rescheduleClaimedTask(pool, {
  taskId,
  workerId,
  retryCount,
  errorMessage,
  delayMinutes,
}) {
  const [write] = await pool.execute(`
    UPDATE ai_tasks
    SET status = 'pending', retry_count = ?, error_message = ?, started_at = NULL,
        worker_id = NULL, lease_until = NULL,
        available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)
    WHERE id = ? AND status = 'processing' AND worker_id = ?
      AND cancel_requested = 0 AND pause_requested = 0
  `, [retryCount, errorMessage, delayMinutes, taskId, workerId]);
  return write.affectedRows === 1;
}

async function failClaimedTask(pool, { taskId, workerId, errorMessage }) {
  const [write] = await pool.execute(`
    UPDATE ai_tasks
    SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP,
        worker_id = NULL, lease_until = NULL
    WHERE id = ? AND status = 'processing' AND worker_id = ?
      AND cancel_requested = 0 AND pause_requested = 0
  `, [errorMessage, taskId, workerId]);
  return write.affectedRows === 1;
}

module.exports = {
  claimNextTask,
  completeClaimedTask,
  failClaimedTask,
  rescheduleClaimedTask,
};
