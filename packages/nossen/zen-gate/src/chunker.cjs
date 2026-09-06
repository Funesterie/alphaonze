'use strict';
const DEFAULT_CHUNK_SIZE = 256 * 1024;
function chunkBuffer(buf, size = DEFAULT_CHUNK_SIZE) {
  const chunks = [];
  for (let o = 0; o < buf.length; o += size) {
    const part = buf.subarray(o, Math.min(o + size, buf.length));
    chunks.push({ index: chunks.length, offset: o, size: part.length, data: part });
  }
  return chunks;
}
module.exports = { chunkBuffer, DEFAULT_CHUNK_SIZE };
