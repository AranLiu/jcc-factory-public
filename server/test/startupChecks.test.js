const test = require('node:test');
const assert = require('node:assert/strict');

const { requireStorageReady } = require('../config/startupChecks');

test('object storage false result blocks the startup gate', () => {
  assert.throws(
    () => requireStorageReady(false),
    /Object storage initialization failed/
  );
});

test('object storage startup gate accepts only an explicit true result', () => {
  assert.equal(requireStorageReady(true), true);
  for (const result of [undefined, null, 0, 'true']) {
    assert.throws(
      () => requireStorageReady(result),
      /Object storage initialization failed/
    );
  }
});
