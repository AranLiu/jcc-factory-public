const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToSafeDocx } = require('../utils/docxExporter');

test('htmlToSafeDocx creates an OOXML archive from sanitized text', async () => {
  const output = await htmlToSafeDocx('<h1>标题</h1><script>alert(1)</script><p>正文</p>');
  assert.equal(output.subarray(0, 2).toString('ascii'), 'PK');
  assert.equal(output.includes(Buffer.from('alert(1)')), false);
});
