const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class AsyncLogWriter {
  constructor({ logDir, maxBytes = 10 * 1024 * 1024, fileName = 'app.log' }) {
    this.logDir = path.resolve(logDir);
    this.maxBytes = maxBytes;
    this.fileName = fileName;
    this.queue = Promise.resolve();
  }

  write(line) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.logDir, { recursive: true });
      const filePath = path.join(this.logDir, this.fileName);
      const output = `${line}\n`;
      let currentSize = 0;
      try { currentSize = (await fs.stat(filePath)).size; } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      if (currentSize > 0 && currentSize + Buffer.byteLength(output) > this.maxBytes) {
        const parsed = path.parse(this.fileName);
        const rotated = path.join(this.logDir, `${parsed.name}.${Date.now()}-${randomUUID()}${parsed.ext}`);
        await fs.rename(filePath, rotated);
      }
      await fs.appendFile(filePath, output, 'utf8');
    });
    return this.queue;
  }
}

module.exports = { AsyncLogWriter };
