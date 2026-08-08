async function withAdvisoryLock(pool, key, callback, timeoutSeconds = 30) {
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(key)) throw new Error('Invalid advisory lock key');
  const connection = await pool.getConnection();
  try {
    const [[result]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [key, timeoutSeconds]);
    if (Number(result.acquired) !== 1) throw new Error(`Timed out waiting for lock: ${key}`);
    return await callback(connection);
  } finally {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [key]);
    } finally {
      connection.release();
    }
  }
}

module.exports = { withAdvisoryLock };
