'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  decodeZenFileAsync,
  encodeZenFileAsync,
  inspectZen,
  verifyZenFileAsync
} = require('../src/index.cjs');

function tempArtifacts(directory) {
  return fs.readdirSync(directory).filter((name) => /\.zen-(?:body|output|raw)-/.test(name));
}

test('async file helpers stream an 8 MiB round trip and clean temporary siblings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-zen-stream-'));
  const inputPath = path.join(directory, 'input.bin');
  const archivePath = path.join(directory, 'archive.zen');
  const outputPath = path.join(directory, 'output.bin');
  const input = Buffer.alloc(8 * 1024 * 1024);
  for (let index = 0; index < input.length; index += 1) input[index] = index % 251;
  fs.writeFileSync(inputPath, input);

  assert.equal(await encodeZenFileAsync(inputPath, archivePath, { key: 'stream-key' }), archivePath);
  const decoded = await decodeZenFileAsync(archivePath, outputPath, { key: 'stream-key' });
  assert.equal(decoded.outputPath, outputPath);
  assert.equal(decoded.rawBytes, input.length);
  assert.deepEqual(fs.readFileSync(outputPath), input);
  assert.equal(inspectZen(archivePath).header.version, 1);
  assert.deepEqual(await verifyZenFileAsync(archivePath, { key: 'stream-key' }), {
    valid: true,
    format: 'zen',
    version: 1,
    mode: 'encrypted_multiload',
    rawBytes: input.length
  });
  assert.deepEqual(tempArtifacts(directory), []);
});

test('async decode preserves an existing destination when authentication fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-zen-auth-'));
  const inputPath = path.join(directory, 'input.txt');
  const archivePath = path.join(directory, 'archive.zen');
  const outputPath = path.join(directory, 'output.txt');
  fs.writeFileSync(inputPath, 'private');
  fs.writeFileSync(outputPath, 'keep-me');
  await encodeZenFileAsync(inputPath, archivePath, { key: 'right-key' });

  await assert.rejects(
    decodeZenFileAsync(archivePath, outputPath, { key: 'wrong-key' }),
    (error) => error.code === 'ZEN_ERR_AUTH'
  );
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'keep-me');
  assert.deepEqual(tempArtifacts(directory), []);
});
