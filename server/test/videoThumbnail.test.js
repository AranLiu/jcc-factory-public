const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateVideoThumbnail } = require('../utils/videoThumbnail');

test('thumbnail generation uses a fixed FFmpeg argument vector', async () => {
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  await generateVideoThumbnail('opaque-input.mp4', 'opaque-output.png', { spawnImpl, command: 'ffmpeg-test' });
  assert.equal(invocation.command, 'ffmpeg-test');
  assert.deepEqual(invocation.args.slice(-2), ['-y', 'opaque-output.png']);
  assert.equal(invocation.options.windowsHide, true);
});

test('thumbnail generation kills oversized diagnostics without exposing them', async () => {
  const secret = 'FFMPEG_SECRET_DIAGNOSTIC';
  let killed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed = true; };
    queueMicrotask(() => child.stderr.emit('data', Buffer.from(secret.repeat(100))));
    return child;
  };

  await assert.rejects(
    generateVideoThumbnail('input.mp4', 'output.png', {
      spawnImpl,
      maxStderrBytes: 32,
    }),
    error => error.code === 'FFMPEG_OUTPUT_LIMIT' && !error.message.includes(secret)
  );
  assert.equal(killed, true);
});

test('thumbnail generation returns a fixed error on non-zero exit', async () => {
  const secret = 'FFMPEG_PATH_SECRET';
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from(secret));
      child.emit('close', 1);
    });
    return child;
  };

  await assert.rejects(
    generateVideoThumbnail('input.mp4', 'output.png', { spawnImpl }),
    error => error.code === 'FFMPEG_FAILED' && !error.message.includes(secret)
  );
});
