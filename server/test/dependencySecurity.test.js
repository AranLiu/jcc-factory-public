const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const lock = require(path.resolve(__dirname, '../package-lock.json'));

function isUnsafeNanoid(version) {
  const [major, minor, patch] = String(version).split('.').map(Number);
  if (major === 4) return true;
  return major === 5 && (minor < 1 || (minor === 1 && patch <= 15));
}

test('server lockfile excludes nanoid denial-of-service advisory ranges', () => {
  const unsafe = Object.entries(lock.packages || {})
    .filter(([packagePath, metadata]) => (
      packagePath.endsWith('node_modules/nanoid') && isUnsafeNanoid(metadata.version)
    ))
    .map(([packagePath, metadata]) => `${packagePath}@${metadata.version}`);

  assert.deepEqual(unsafe, []);
});
