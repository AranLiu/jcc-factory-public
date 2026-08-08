const path = require('node:path');
const { TextDecoder } = require('node:util');

function startsWithBytes(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function detectFileKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'unknown';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0])) return 'ole';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 11).toString('ascii') === 'AVI') return 'avi';
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'mkv';
  if (startsWithBytes(buffer, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'wmv';
  if (!buffer.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return 'text';
    } catch (_) {}
  }
  return 'unknown';
}

const ALLOWED = {
  video: {
    '.mp4': { kind: 'mp4', mime: ['video/mp4'] },
    '.mov': { kind: 'mp4', mime: ['video/mov', 'video/quicktime'] },
    '.avi': { kind: 'avi', mime: ['video/avi', 'video/x-msvideo'] },
    '.mkv': { kind: 'mkv', mime: ['video/mkv', 'video/x-matroska'] },
    '.wmv': { kind: 'wmv', mime: ['video/wmv', 'video/x-ms-wmv'] },
  },
  novel: {
    '.txt': { kind: 'text', mime: ['text/plain'] },
    '.pdf': { kind: 'pdf', mime: ['application/pdf'] },
    '.docx': { kind: 'zip', mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  },
};

function isAllowedProjectFile(projectType, filename, mimeType, header) {
  const rule = ALLOWED[projectType]?.[path.extname(String(filename)).toLowerCase()];
  return Boolean(rule && rule.kind === detectFileKind(header) && rule.mime.includes(String(mimeType).toLowerCase()));
}

function isSupportedProjectMime(mimeType) {
  const normalized = String(mimeType).toLowerCase();
  return Object.values(ALLOWED).some(extensionRules => (
    Object.values(extensionRules).some(rule => rule.mime.includes(normalized))
  ));
}

function projectFileFilter(req, file, callback) {
  const supported = isSupportedProjectMime(file.mimetype);
  callback(supported ? null : new Error('Unsupported upload MIME type'), supported);
}

module.exports = { detectFileKind, isAllowedProjectFile, isSupportedProjectMime, projectFileFilter };
