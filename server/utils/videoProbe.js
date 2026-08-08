const { execFile } = require('node:child_process');

function buildProbeArgs(filePath) {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath];
}

function parseDuration(output) {
  try {
    if (typeof output !== 'string' || output.length > 64 * 1024) return null;
    const duration = Number(JSON.parse(output)?.format?.duration);
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  } catch {
    return null;
  }
}

function probeVideoDuration(filePath, { ffprobePath, timeoutMs = 15_000, executor = execFile } = {}) {
  return new Promise((resolve) => {
    executor(ffprobePath || 'ffprobe', buildProbeArgs(filePath), {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true
    }, (error, stdout) => resolve(error ? null : parseDuration(stdout)));
  });
}

module.exports = { buildProbeArgs, parseDuration, probeVideoDuration };
