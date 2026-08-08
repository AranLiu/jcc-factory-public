const { StringDecoder } = require('node:string_decoder');

const DEFAULT_AI_INPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_STDERR_BYTES = 512 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

function createProcessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertAiInputSize(value, maxBytes = DEFAULT_AI_INPUT_BYTES) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw createProcessError('AI_INPUT_TOO_LARGE', 'AI request exceeds the configured input limit');
  }
  return serialized;
}

function serializeAiPayload(payload, maxBytes = DEFAULT_AI_INPUT_BYTES) {
  return assertAiInputSize(JSON.stringify(payload), maxBytes);
}

function collectBoundedProcess(child, {
  stdinData = null,
  timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
  maxStdoutBytes = DEFAULT_STDOUT_BYTES,
  maxStderrBytes = DEFAULT_STDERR_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    const timer = setTimeout(() => {
      fail('AI_PROCESS_TIMEOUT', 'AI subprocess timed out');
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
    }

    function terminate() {
      try {
        child.kill('SIGTERM');
      } catch {
        // The process may already have exited. Close/error handlers remain guarded.
      }
    }

    function fail(code, message, { kill = true } = {}) {
      if (settled) return;
      settled = true;
      cleanup();
      if (kill) terminate();
      reject(createProcessError(code, message));
    }

    child.stdout.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      stdoutBytes += bytes.length;
      if (stdoutBytes > maxStdoutBytes) {
        fail('AI_PROCESS_OUTPUT_LIMIT', 'AI subprocess output exceeded the configured limit');
        return;
      }
      stdout += stdoutDecoder.write(bytes);
    });

    child.stderr.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      stderrBytes += bytes.length;
      if (stderrBytes > maxStderrBytes) {
        fail('AI_PROCESS_OUTPUT_LIMIT', 'AI subprocess diagnostics exceeded the configured limit');
        return;
      }
      stderr += stderrDecoder.write(bytes);
    });

    child.stdin.on?.('error', () => {
      fail('AI_PROCESS_STDIN_FAILED', 'Unable to write AI subprocess input');
    });

    child.on('error', () => {
      fail('AI_PROCESS_START_FAILED', 'Unable to start AI subprocess', { kill: false });
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      cleanup();
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (code !== 0) {
        reject(createProcessError('AI_PROCESS_FAILED', 'AI subprocess failed'));
        return;
      }
      resolve({ code, stdout, stderr });
    });

    try {
      if (stdinData !== null && stdinData !== undefined) {
        child.stdin.write(stdinData, 'utf8');
      }
      child.stdin.end();
    } catch {
      fail('AI_PROCESS_STDIN_FAILED', 'Unable to write AI subprocess input');
    }
  });
}

function parseFinalJsonLine(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Only the final valid JSON line is part of the subprocess contract.
    }
  }
  throw createProcessError('AI_PROCESS_INVALID_RESPONSE', 'AI subprocess returned an invalid response');
}

module.exports = {
  DEFAULT_AI_INPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  DEFAULT_STDERR_BYTES,
  DEFAULT_STDOUT_BYTES,
  assertAiInputSize,
  collectBoundedProcess,
  createProcessError,
  parseFinalJsonLine,
  serializeAiPayload,
};
