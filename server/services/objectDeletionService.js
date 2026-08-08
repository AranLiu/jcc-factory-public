function objectDeletionError() {
  const error = new Error('Object storage deletion failed');
  error.code = 'OBJECT_STORAGE_DELETE_FAILED';
  error.retryable = true;
  return error;
}

async function deleteStoredObjects(storageService, targets = []) {
  const uniqueTargets = new Map();
  for (const target of targets) {
    if (!target?.bucket || !target?.object) continue;
    uniqueTargets.set(`${target.bucket}\0${target.object}`, target);
  }

  try {
    for (const { bucket, object } of uniqueTargets.values()) {
      await storageService.deleteFile(bucket, object);
    }
  } catch {
    throw objectDeletionError();
  }
}

module.exports = {
  deleteStoredObjects,
};
