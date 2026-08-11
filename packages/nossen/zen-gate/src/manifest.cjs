'use strict';
const fs = require('node:fs');
const { sha256Hex } = require('./hash.cjs');
const { chunkBuffer, DEFAULT_CHUNK_SIZE } = require('./chunker.cjs');
function buildManifestFromBuffer(buf, { chunkSize = DEFAULT_CHUNK_SIZE, name = null } = {}) {
  const chunks = chunkBuffer(buf, chunkSize);
  return {
    version: 1, schema: 'nossen.zen-gate.manifest.v1', createdAt: new Date().toISOString(),
    file: { name, size: buf.length, sha256: sha256Hex(buf) },
    chunkSize, chunkCount: chunks.length,
    chunks: chunks.map(c => ({ index: c.index, offset: c.offset, size: c.size, sha256: sha256Hex(c.data) })),
  };
}
function buildManifest(filePath, opts = {}) { return buildManifestFromBuffer(fs.readFileSync(filePath), { ...opts, name: filePath }); }
module.exports = { buildManifest, buildManifestFromBuffer };
