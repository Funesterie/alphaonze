'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createChunkedUploadStore } = require('../src/files/chunked-upload-store.cjs');

function makeStore(maxBytes = 1024) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunks-'));
  return { root, store: createChunkedUploadStore({ root, maxBytes }) };
}

test('les morceaux se recollent dans l ordre et le fichier ne sert qu une fois', () => {
  const { root, store } = makeStore();
  const id = 'abcdef12-video';
  assert.equal(store.appendChunk({ userId: '2', uploadId: id, offset: 0, buffer: Buffer.from('hello ') }).received, 6);
  assert.equal(store.appendChunk({ userId: '2', uploadId: id, offset: 6, buffer: Buffer.from('world') }).received, 11);
  assert.equal(store.takeAssembled({ userId: '2', uploadId: id, expectedBytes: 11 }).toString(), 'hello world');
  assert.throws(() => store.takeAssembled({ userId: '2', uploadId: id }), { code: 'chunked_upload_not_found' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('un morceau renvoye apres une coupure n est pas recolle deux fois', () => {
  const { root, store } = makeStore();
  const id = 'reprise-0001';
  store.appendChunk({ userId: '2', uploadId: id, offset: 0, buffer: Buffer.from('abc') });
  const again = store.appendChunk({ userId: '2', uploadId: id, offset: 0, buffer: Buffer.from('abc') });
  assert.equal(again.duplicate, true);
  assert.equal(again.received, 3);
  assert.throws(() => store.appendChunk({ userId: '2', uploadId: id, offset: 10, buffer: Buffer.from('x') }), { code: 'offset_mismatch' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('taille maximale, identifiant invalide, fichier incomplet, et pas de fuite entre utilisateurs', () => {
  const { root, store } = makeStore(5);
  assert.throws(() => store.appendChunk({ userId: '2', uploadId: 'trop-gros-01', offset: 0, buffer: Buffer.alloc(6) }), { code: 'file_too_large' });
  assert.throws(() => store.appendChunk({ userId: '2', uploadId: '../../etc', offset: 0, buffer: Buffer.from('a') }), { code: 'invalid_upload_id' });
  store.appendChunk({ userId: '2', uploadId: 'partiel-001', offset: 0, buffer: Buffer.from('ab') });
  assert.throws(() => store.takeAssembled({ userId: '2', uploadId: 'partiel-001', expectedBytes: 4 }), { code: 'chunked_upload_incomplete' });
  assert.throws(() => store.takeAssembled({ userId: '3', uploadId: 'partiel-001' }), { code: 'chunked_upload_not_found' });
  fs.rmSync(root, { recursive: true, force: true });
});
