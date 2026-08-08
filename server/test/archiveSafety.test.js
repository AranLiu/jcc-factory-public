const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeZipBuffer } = require('../utils/archiveSafety');

function centralEntry(compressed, uncompressed) {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt32LE(compressed, 20);
  entry.writeUInt32LE(uncompressed, 24);
  return entry;
}

test('ZIP safety accepts bounded central-directory metadata', () => {
  assert.deepEqual(assertSafeZipBuffer(centralEntry(100, 500)), {
    entries: 1,
    compressedBytes: 100,
    uncompressedBytes: 500,
  });
});

test('ZIP safety rejects bombs, missing metadata, and ZIP64 sizes', () => {
  assert.throws(() => assertSafeZipBuffer(centralEntry(1, 10_000)), /ratio/);
  assert.throws(() => assertSafeZipBuffer(Buffer.from('PK\x03\x04')), /central directory/);
  assert.throws(() => assertSafeZipBuffer(centralEntry(0xffffffff, 1)), /ZIP64/);
});
