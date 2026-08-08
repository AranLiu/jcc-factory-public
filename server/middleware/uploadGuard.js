function createUploadGuard({ maxConcurrent = 2, maxBytes, usageProvider = async () => 0 } = {}) {
  const activeByUser = new Map();

  return async function uploadGuard(req, res, next) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    const incomingBytes = Number(req.headers['content-length']);
    if (!Number.isFinite(incomingBytes) || incomingBytes <= 0) {
      return res.status(411).json({ message: 'A valid Content-Length header is required' });
    }

    const active = activeByUser.get(userId) || 0;
    if (active >= maxConcurrent) {
      return res.status(429).json({ message: 'Too many concurrent uploads' });
    }

    activeByUser.set(userId, active + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const current = activeByUser.get(userId) || 1;
      if (current <= 1) activeByUser.delete(userId);
      else activeByUser.set(userId, current - 1);
    };
    res.once('finish', release);
    res.once('close', release);

    try {
      const usedBytes = Number(await usageProvider(userId)) || 0;
      if (Number.isFinite(maxBytes) && usedBytes + incomingBytes > maxBytes) {
        release();
        return res.status(413).json({ message: 'User storage quota exceeded' });
      }
      next();
    } catch {
      release();
      return res.status(503).json({ message: 'Unable to verify upload quota' });
    }
  };
}

module.exports = { createUploadGuard };
