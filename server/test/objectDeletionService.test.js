const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../services/objectDeletionService.js');

test('object deletion service exists before behavior checks', () => {
  assert.equal(fs.existsSync(servicePath), true, 'missing objectDeletionService.js');
});

test('object deletion ignores empty targets and deletes each unique object once', async () => {
  const { deleteStoredObjects } = require(servicePath);
  const calls = [];
  const storage = {
    async deleteFile(bucket, object) {
      calls.push([bucket, object]);
    },
  };

  await deleteStoredObjects(storage, [
    null,
    {},
    { bucket: 'files', object: 'a' },
    { bucket: 'files', object: 'a' },
    { bucket: 'thumbs', object: 'b' },
  ]);

  assert.deepEqual(calls, [
    ['files', 'a'],
    ['thumbs', 'b'],
  ]);
});

test('object deletion propagates a generic retryable error without storage details', async () => {
  const { deleteStoredObjects } = require(servicePath);
  const secret = 'MINIO_INTERNAL_SECRET_7d3a';
  const storage = {
    async deleteFile() {
      throw new Error(secret);
    },
  };

  await assert.rejects(
    deleteStoredObjects(storage, [{ bucket: 'files', object: 'a' }]),
    error => {
      assert.equal(error.code, 'OBJECT_STORAGE_DELETE_FAILED');
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});
