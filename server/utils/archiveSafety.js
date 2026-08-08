function assertSafeZipBuffer(buffer, {
  maxEntries = 5000,
  maxUncompressedBytes = 128 * 1024 * 1024,
  maxCompressionRatio = 100,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('Invalid ZIP archive');

  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  let entries = 0;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  while ((offset = buffer.indexOf(centralSignature, offset)) !== -1) {
    if (offset + 46 > buffer.length) throw new Error('Truncated ZIP central directory');
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('ZIP64 archives are not accepted');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > buffer.length) throw new Error('Truncated ZIP entry');

    entries += 1;
    compressedTotal += compressed;
    uncompressedTotal += uncompressed;
    if (entries > maxEntries) throw new Error('ZIP contains too many entries');
    if (uncompressedTotal > maxUncompressedBytes) throw new Error('ZIP expands beyond the processing limit');
    if (uncompressed > 0 && compressed === 0) throw new Error('ZIP entry has an unsafe compression ratio');
    offset = nextOffset;
  }

  if (entries === 0) throw new Error('ZIP central directory is missing');
  if (compressedTotal > 0 && uncompressedTotal / compressedTotal > maxCompressionRatio) {
    throw new Error('ZIP compression ratio exceeds the processing limit');
  }
  return { entries, compressedBytes: compressedTotal, uncompressedBytes: uncompressedTotal };
}

module.exports = { assertSafeZipBuffer };
