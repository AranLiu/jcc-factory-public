const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const {
  detectFileKind,
  isAllowedProjectFile,
  isSupportedProjectMime,
  projectFileFilter,
} = require('../utils/fileSignatures');

test('detectFileKind identifies representative document and video signatures', () => {
  assert.equal(detectFileKind(Buffer.from('%PDF-1.7')), 'pdf');
  assert.equal(detectFileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip');
  assert.equal(detectFileKind(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), 'mp4');
});

test('isAllowedProjectFile rejects a mismatched signature regardless of MIME', () => {
  assert.equal(isAllowedProjectFile('video', 'movie.mp4', 'video/mp4', Buffer.from('%PDF-1.7')), false);
  assert.equal(isAllowedProjectFile('novel', 'story.pdf', 'application/pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(isAllowedProjectFile('novel', 'story.exe', 'text/plain', Buffer.from('hello')), false);
});

test('multipart prefilter is field-order independent and project type stays authoritative', () => {
  assert.equal(isSupportedProjectMime('video/mp4'), true);
  assert.equal(isSupportedProjectMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  assert.equal(isSupportedProjectMime('application/x-msdownload'), false);
  assert.equal(isAllowedProjectFile('novel', 'forged.mp4', 'video/mp4', Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), false);
});

test('real multipart parsing accepts a file part before project fields', async () => {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), fileFilter: projectFileFilter });
  app.post('/upload', upload.single('file'), (req, res) => {
    res.json({ projectId: req.body.projectId, file: req.file.originalname });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }), 'movie.mp4');
    form.append('projectId', '17');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projectId: '17', file: 'movie.mp4' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
