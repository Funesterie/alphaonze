'use strict';
// Drive/shared-store transport: a content-addressed chunk store on a path BOTH sides see
// (e.g. OneDrive mounted on PC + EX44). PC pushes new compressed chunks; EX44 pulls + reconstructs.
// OneDrive only syncs the NEW chunks (dedup) and they are Brotli-compressed (less traffic).
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { sha256Hex } = require('./hash.cjs');
const { chunkBuffer, DEFAULT_CHUNK_SIZE } = require('./chunker.cjs');

function drivePush(buf, storePath, opts = {}) {
  const cs = opts.chunkSize || DEFAULT_CHUNK_SIZE;
  fs.mkdirSync(storePath, { recursive: true });
  fs.mkdirSync(path.join(storePath, 'manifests'), { recursive: true });
  const chunks = chunkBuffer(buf, cs);
  let newChunks = 0, bytesWritten = 0;
  const list = chunks.map(c => {
    const sha = sha256Hex(c.data);
    const p = path.join(storePath, sha + '.z');
    if (!fs.existsSync(p)) {
      const comp = zlib.brotliCompressSync(c.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: opts.brotliQuality || 11 } });
      fs.writeFileSync(p, comp);
      newChunks++; bytesWritten += comp.length;
    }
    return { index: c.index, offset: c.offset, size: c.size, sha256: sha };
  });
  const manifest = {
    version: 1, schema: 'nossen.zen-gate.drive.v1', createdAt: new Date().toISOString(),
    file: { name: opts.name || null, size: buf.length, sha256: sha256Hex(buf) },
    chunkSize: cs, chunkCount: chunks.length, chunks: list,
  };
  const mName = (opts.name ? path.basename(opts.name) : manifest.file.sha256) + '.manifest.json';
  const mp = path.join(storePath, 'manifests', mName);
  fs.writeFileSync(mp, JSON.stringify(manifest));
  return { manifest, newChunks, totalChunks: chunks.length, bytesWritten, manifestPath: mp, fileSha: manifest.file.sha256 };
}

function drivePull(manifest, storePath, outPath) {
  const buf = Buffer.alloc(manifest.file.size);
  let missing = 0;
  for (const c of manifest.chunks) {
    const p = path.join(storePath, c.sha256 + '.z');
    if (!fs.existsSync(p)) { missing++; continue; }
    const data = zlib.brotliDecompressSync(fs.readFileSync(p));
    if (sha256Hex(data) !== c.sha256) throw new Error('chunk sha mismatch idx=' + c.index);
    data.copy(buf, c.offset);
  }
  if (missing > 0) throw new Error(missing + ' chunk(s) missing in shared store (OneDrive not synced yet?)');
  if (sha256Hex(buf) !== manifest.file.sha256) throw new Error('final sha mismatch');
  if (outPath) fs.writeFileSync(outPath, buf);
  return { ok: true, size: buf.length, sha256: sha256Hex(buf), total: manifest.chunks.length };
}

function loadManifest(storePath, name) {
  const mp = path.join(storePath, 'manifests', (name || '') + '.manifest.json');
  return JSON.parse(fs.readFileSync(mp, 'utf8'));
}

module.exports = { drivePush, drivePull, loadManifest };
