'use strict';
const zlib = require('node:zlib');
const { chunkBuffer } = require('./chunker.cjs');
const { sha256Hex } = require('./hash.cjs');
function packNeededFromBuffer(buf, need, manifest, { brotliQuality = 11 } = {}) {
  const want = new Set(need.map(c => c.index));
  const all = chunkBuffer(buf, manifest.chunkSize || 256 * 1024);
  const out = [];
  for (const c of all) {
    if (!want.has(c.index)) continue;
    const compressed = zlib.brotliCompressSync(c.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality } });
    out.push({ index: c.index, sha256: sha256Hex(c.data), size: c.size, compressedLength: compressed.length, compressed });
  }
  return { manifest, chunks: out };
}
module.exports = { packNeededFromBuffer };
