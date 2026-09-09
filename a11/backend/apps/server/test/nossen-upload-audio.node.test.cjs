'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { mountUploadAudioRoute } = require('../src/clips/mount-upload-audio-route.cjs');

test('uploaded audio: finite length, HEAD, seek ranges, missing files and malformed imports', async t => {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-upload-test-'));
  const app = express();
  mountUploadAudioRoute(app, { uploadDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(997, 5)]);
  async function upload(content, filename) {
    const body = new FormData();
    body.append('file', new Blob([content]), filename);
    return fetch(base + '/api/mcp-bridge/upload-audio', { method: 'POST', body });
  }
  const uploaded = await upload(bytes, 'test.mp3');
  assert.equal(uploaded.status, 200);
  const { url } = await uploaded.json();
  const full = await fetch(base + url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), String(bytes.length));
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const head = await fetch(base + url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const part = await fetch(base + url, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(part.headers.get('content-length'), '100');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));
  const invalidRange = await fetch(base + url, { headers: { Range: 'bytes=2000-' } });
  assert.equal(invalidRange.status, 416);
  assert.equal((await fetch(base + '/api/mcp-bridge/play-upload/missing.mp3')).status, 404);
  assert.equal((await upload('<html>' + 'error'.repeat(100) + '</html>', 'error.mp3')).status, 415);
  assert.equal((await upload(bytes, 'not-audio.mp4')).status, 415);
});
