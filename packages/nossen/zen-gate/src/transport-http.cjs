'use strict';
const http = require('node:http');
const { encodeBundle } = require('./bundle.cjs');
function httpReq(baseUrl, path, body, binary) {
  return new Promise((res, rej) => {
    const u = new URL(path, baseUrl);
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + (u.search || ''), method: 'POST', headers: { 'content-type': binary ? 'application/octet-stream' : 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 120000 }, r => { const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch))); });
    req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('http timeout')); });
    req.end(body);
  });
}
// HTTP transport: POST /have (manifest JSON) -> {need,have}; POST /apply (binary bundle) -> result JSON.
class HttpTransport {
  constructor({ baseUrl }) { this.baseUrl = baseUrl; this.manifest = null; this.bytes = 0; this.rounds = 0; }
  async sendManifest(m) { this.manifest = m; this.bytes += Buffer.byteLength(JSON.stringify(m), 'utf8'); return m; }
  async requestHaveNeed() { this.rounds++; const out = await httpReq(this.baseUrl, '/have', Buffer.from(JSON.stringify(this.manifest), 'utf8'), false); return JSON.parse(out.toString('utf8')); }
  async sendBundle(packed) { const bin = encodeBundle(packed.manifest, packed.chunks); this.bytes += bin.length; const out = await httpReq(this.baseUrl, '/apply', bin, true); return JSON.parse(out.toString('utf8')); }
}
module.exports = { HttpTransport };
