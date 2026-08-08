function requireStorageReady(result) {
  if (result !== true) {
    throw new Error('Object storage initialization failed');
  }
  return true;
}

module.exports = { requireStorageReady };
