'use strict';
// Binary bundle framing for streaming over SSH/subprocess stdin/stdout (binary-safe).
// layout: MAGIC(8) | manifestLen(u32 BE) | manifestJSON | chunkCount(u32 BE) | per chunk: index(u32)|size(u32)|clen(u32)|compressed(clen)
const MAGIC = Buffer.from('ZENGATE1');
function encodeBundle(manifest, chunks) {
  const parts = [MAGIC];
  const mj = Buffer.from(JSON.stringify(manifest), 'utf8');
  const ml = Buffer.alloc(4); ml.writeUInt32BE(mj.length, 0); parts.push(ml, mj);
  const nc = Buffer.alloc(4); nc.writeUInt32BE(chunks.length, 0); parts.push(nc);
  for (const c of chunks) {
    const h = Buffer.alloc(12);
    h.writeUInt32BE(c.index, 0);
    h.writeUInt32BE(c.size || 0, 4);
    h.writeUInt32BE(c.compressed.length, 8);
    parts.push(h, c.compressed);
  }
  return Buffer.concat(parts);
}
function decodeBundle(buf) {
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error('bad bundle magic');
  let o = 8;
  const ml = buf.readUInt32BE(o); o += 4;
  const manifest = JSON.parse(buf.subarray(o, o + ml).toString('utf8')); o += ml;
  const nc = buf.readUInt32BE(o); o += 4;
  const chunks = [];
  for (let i = 0; i < nc; i++) {
    const index = buf.readUInt32BE(o); o += 4;
    const size = buf.readUInt32BE(o); o += 4;
    const clen = buf.readUInt32BE(o); o += 4;
    const compressed = Buffer.from(buf.subarray(o, o + clen)); o += clen;
    const m = manifest.chunks.find(x => x.index === index);
    chunks.push({ index, sha256: m.sha256, size, compressed });
  }
  return { manifest, chunks };
}
module.exports = { encodeBundle, decodeBundle, MAGIC };
