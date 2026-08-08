const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProbeArgs, parseDuration } = require('../utils/videoProbe');

test('video probe uses a fixed argument vector and parses bounded JSON', () => {
  assert.deepEqual(buildProbeArgs('C:\\media\\sample.mp4'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', 'C:\\media\\sample.mp4'
  ]);
  assert.equal(parseDuration('{"format":{"duration":"12.75"}}'), 12.75);
  assert.equal(parseDuration('{"format":{"duration":"invalid"}}'), null);
});
