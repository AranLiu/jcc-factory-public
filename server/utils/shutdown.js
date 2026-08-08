async function shutdownResources({ taskProcessor, httpServer, pool, pools = [] }) {
  if (taskProcessor?.stop) await taskProcessor.stop();
  if (httpServer?.close) {
    await new Promise((resolve, reject) => {
      httpServer.close(error => error ? reject(error) : resolve());
    });
  }
  if (pool?.end) await pool.end();
  for (const extraPool of pools) {
    if (extraPool?.end) await extraPool.end();
  }
}

module.exports = { shutdownResources };
