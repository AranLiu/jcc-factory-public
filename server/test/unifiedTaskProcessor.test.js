const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every processor control checkpoint carries the active worker lease id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/UnifiedTaskProcessor.js'),
    'utf8'
  );
  const calls = [...source.matchAll(/this\.applyTaskControl\(([^)]*)\)/g)]
    .map(match => match[1].replace(/\s+/g, ''));
  assert.ok(calls.length >= 4);
  assert.equal(calls.includes('taskId'), false);
  assert.equal(calls.every(args => args.endsWith(',workerId')), true);
});
