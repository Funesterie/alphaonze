'use strict';
const fs = require('node:fs'), zlib = require('node:zlib');
const { sha256Hex } = require('./hash.cjs');
function reconstruct(bundle, store, outPath = null) {
  const { manifest, chunks } = bundle;
  const buf = Buffer.alloc(manifest.file.size);
  for (const c of chunks) {
    const data = zlib.brotliDecompressSync(c.compressed);
    if (sha256Hex(data) !== c.sha256) throw new Error('chunk sha mismatch idx=' + c.index);
    store.putHashed(c.sha256, data);
    const m = manifest.chunks.find(x => x.index === c.index);
    data.copy(buf, m.offset);
  }
  const sent = new Set(chunks.map(c => c.index));
  for (const c of manifest.chunks) {
    if (sent.has(c.index)) continue;
    const d = store.get(c.sha256);
    if (!d) throw new Error('missing chunk idx=' + c.index + ' sha=' + c.sha256.slice(0,12));
    d.copy(buf, c.offset);
  }
  if (sha256Hex(buf) !== manifest.file.sha256) throw new Error('final sha mismatch: got ' + sha256Hex(buf).slice(0,12) + ' expected ' + manifest.file.sha256.slice(0,12));
  if (outPath) fs.writeFileSync(outPath, buf);
  return { ok: true, size: buf.length, sha256: sha256Hex(buf), sent: chunks.length, total: manifest.chunks.length };
}
module.exports = { reconstruct };
