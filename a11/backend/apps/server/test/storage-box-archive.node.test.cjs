'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  archiveLocalSongBestEffort,
  sanitizeArchiveName,
} = require('../src/audio/storage-box-archive.cjs');

test('nettoie le nom avant archivage', () => {
  assert.equal(sanitizeArchiveName('/tmp/NOSSEN final ?!.mp3'), 'NOSSEN_final__.mp3');
});

test('archive le master local avec ssh -p puis scp -P', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-box-'));
  const source = path.join(dir, 'nossen.mp3');
  const key = path.join(dir, 'storagebox_ed25519');
  fs.writeFileSync(source, Buffer.from('audio-local'));
  fs.writeFileSync(key, 'private-key-placeholder-for-test-only');
  const calls = [];
  const execFile = (binary, args, _options, callback) => {
    calls.push({ binary, args });
    callback(null, '', '');
  };
  try {
    const result = await archiveLocalSongBestEffort(source, {
      env: {
        STORAGE_BOX_HOST: 'box.example.test',
        STORAGE_BOX_USER: 'archive',
        STORAGE_BOX_PORT: '23',
        STORAGE_BOX_KEY: key,
        STORAGE_BOX_DIR: '/vivy-archive',
      },
      execFile,
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].binary, 'ssh');
    assert.ok(calls[0].args.includes('-p'));
    assert.equal(calls[1].binary, 'scp');
    assert.ok(calls[1].args.includes('-P'));
    assert.ok(calls[1].args.some((arg) => String(arg).includes('/vivy-archive/songs/nossen.mp3')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('archive desactivee ne touche pas au reseau', async () => {
  const result = await archiveLocalSongBestEffort('/tmp/absent.mp3', {
    env: { VIVY_STORAGE_BOX_ARCHIVE_ENABLED: 'false' },
    execFile: () => { throw new Error('ne doit pas etre appele'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
});
