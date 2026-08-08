const { spawn } = require('node:child_process');

function generateVideoThumbnail(inputPath, outputPath, {
  command = process.env.FFMPEG_COMMAND || 'ffmpeg',
  spawnImpl = spawn,
  timeoutMs = 15_000,
  maxStderrBytes = 8 * 1024,
} = {}) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', inputPath,
    '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease',
    '-y', outputPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrBytes = 0;
    let settled = false;
    let timer;

    const fail = (code, message, { kill = false } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (kill) {
        try { child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
      }
      const error = new Error(message);
      error.code = code;
      reject(error);
    };

    child.stderr?.on('data', chunk => {
      if (settled) return;
      stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), 'utf8');
      if (stderrBytes > maxStderrBytes) {
        fail('FFMPEG_OUTPUT_LIMIT', 'FFmpeg diagnostics exceeded the configured limit', { kill: true });
      }
    });
    timer = setTimeout(() => {
      fail('FFMPEG_TIMEOUT', 'FFmpeg thumbnail generation timed out', { kill: true });
    }, timeoutMs);
    timer.unref?.();
    child.once('error', () => {
      fail('FFMPEG_START_FAILED', 'Unable to start FFmpeg thumbnail generation');
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const error = new Error('FFmpeg thumbnail generation failed');
        error.code = 'FFMPEG_FAILED';
        reject(error);
      }
    });
  });
}

module.exports = { generateVideoThumbnail };
