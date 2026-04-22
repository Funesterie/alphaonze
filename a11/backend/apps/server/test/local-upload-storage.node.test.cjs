const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  deleteLocalUploadObject,
  isLocalUploadStorageKey,
  readLocalUploadBuffer,
  saveBufferToLocalUploadStorage,
} = require('../lib/local-upload-storage.cjs');

test('saveBufferToLocalUploadStorage writes a public runtime upload with a local storage key', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-local-upload-'));

  try {
    const saved = saveBufferToLocalUploadStorage({
      uploadsRoot: tempDir,
      filename: 'IMG 1610.png',
      buffer: Buffer.from('hello'),
      contentType: 'image/png',
      sanitizeFileName: (value) => String(value || '').replace(/\s+/g, '_'),
    });

    assert.equal(isLocalUploadStorageKey(saved.storageKey), true);
    assert.match(saved.url, /^\/files\/runtime\/files\/uploads\/upload_/);
    assert.equal(saved.filename, 'IMG_1610.png');
    assert.equal(fs.existsSync(saved.outputPath), true);

    const loaded = readLocalUploadBuffer({
      storageKey: saved.storageKey,
      uploadsRoot: tempDir,
    });
    assert.equal(String(loaded.buffer), 'hello');

    const deleted = deleteLocalUploadObject({
      storageKey: saved.storageKey,
      uploadsRoot: tempDir,
    });
    assert.equal(deleted.ok, true);
    assert.equal(fs.existsSync(saved.outputPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
