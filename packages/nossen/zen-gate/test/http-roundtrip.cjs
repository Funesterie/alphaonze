'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { HttpTransport, syncFile } = require('../src/index.cjs');
const cli = path.join(__dirname, '..', 'bin', 'zen-gate.cjs');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CS = 256 * 1024;

function startServe(store, port) {
  return new Promise((res, rej) => {
    const ch = spawn(process.execPath, [cli, 'serve', '--store', store, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    ch.stderr.on('data', d => { const s = d.toString(); if (!ready && s.includes('serve on')) { ready = true; res(ch); } });
    ch.on('error', rej);
    setTimeout(() => { if (!ready) rej(new Error('serve did not start')); }, 5000);
  });
}
function freePort() { return new Promise(res => { const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

(async () => {
  const tmp = path.join(os.tmpdir(), 'zen-gate-http-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(tmp, 'src.bin');
  const recvStore = path.join(tmp, 'recv-store');
  fs.writeFileSync(src, crypto.randomBytes(1024 * 1024));
  const port = await freePort();
  const serve = await startServe(recvStore, port);
  const base = 'http://127.0.0.1:' + port;

  let tp = new HttpTransport({ baseUrl: base });
  let r = await syncFile(src, tp, { chunkSize: CS });
  assert.ok(r.ok && r.sha256 === sha(fs.readFileSync(src)) && r.sent === r.total);
  console.log('1) first sync : sent=' + r.sent + '/' + r.total + ' wire=' + (tp.bytes/1024).toFixed(0) + 'KiB  sha OK');

  tp = new HttpTransport({ baseUrl: base });
  r = await syncFile(src, tp, { chunkSize: CS });
  assert.strictEqual(r.sent, 0);
  console.log('2) same file  : sent=' + r.sent + ' wire=' + tp.bytes + 'B  (full dedup over HTTP)');

  const B = Buffer.from(fs.readFileSync(src)); const off = 2 * CS; for (let i = off; i < off + 1000; i++) B[i] ^= 0xff;
  fs.writeFileSync(src, B);
  tp = new HttpTransport({ baseUrl: base });
  r = await syncFile(src, tp, { chunkSize: CS });
  assert.ok(r.ok && r.sha256 === sha(B) && r.sent === 1);
  console.log('3) 1-chunk mod : sent=' + r.sent + '/' + r.total + ' wire=' + (tp.bytes/1024).toFixed(0) + 'KiB  sha OK');

  console.log('\nZEN Gate V1 HTTP round-trip: OK (serve + HttpTransport, dedup proven over real HTTP)');
  serve.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
