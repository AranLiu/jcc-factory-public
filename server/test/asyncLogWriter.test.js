const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AsyncLogWriter } = require('../utils/asyncLogWriter');

test('AsyncLogWriter appends asynchronously and rotates at the size limit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jcc-log-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const writer = new AsyncLogWriter({ logDir: directory, maxBytes: 12, fileName: 'app.log' });

  await writer.write('first-line');
  await writer.write('second-line');

  const files = await fs.readdir(directory);
  assert.equal(files.includes('app.log'), true);
  assert.equal(files.some((name) => name.startsWith('app.') && name.endsWith('.log')), true);
  assert.match(await fs.readFile(path.join(directory, 'app.log'), 'utf8'), /second-line/);
});
