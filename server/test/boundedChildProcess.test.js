const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  collectBoundedProcess,
  parseFinalJsonLine,
} = require('../utils/boundedChildProcess');

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = () => true;
  child.stdin.end = () => {};
  child.kill = () => true;
  return child;
}

test('bounded collector preserves UTF-8 JSON split inside a multibyte character', async () => {
  const child = createChild();
  const collected = collectBoundedProcess(child);
  const payload = Buffer.from('{"success":true,"text":"你好"}\n', 'utf8');
  const chineseStart = payload.indexOf(Buffer.from('你', 'utf8'));

  child.stdout.emit('data', payload.subarray(0, chineseStart + 1));
  child.stdout.emit('data', payload.subarray(chineseStart + 1));
  child.emit('close', 0);

  const { stdout } = await collected;
  assert.deepEqual(parseFinalJsonLine(stdout), { success: true, text: '你好' });
});

test('bounded collector converts stdin stream errors into a stable process error', async () => {
  const child = createChild();
  child.stdin.write = () => {
    process.nextTick(() => child.stdin.emit('error', new Error('EPIPE secret detail')));
    return false;
  };

  const collected = collectBoundedProcess(child, { stdinData: '{"prompt":"hello"}' });

  await assert.rejects(collected, error => (
    error.code === 'AI_PROCESS_STDIN_FAILED' && !error.message.includes('secret detail')
  ));
});

test('bounded collector times out, kills the child, and returns a stable error', async () => {
  const child = createChild();
  let killed = false;
  child.kill = () => { killed = true; };

  await assert.rejects(
    collectBoundedProcess(child, { timeoutMs: 5 }),
    error => error.code === 'AI_PROCESS_TIMEOUT'
  );
  assert.equal(killed, true);
});

test('invalid subprocess output is rejected without echoing raw output', () => {
  const secret = 'RAW_SUBPROCESS_SECRET';
  assert.throws(
    () => parseFinalJsonLine(secret),
    error => error.code === 'AI_PROCESS_INVALID_RESPONSE' && !error.message.includes(secret)
  );
});
