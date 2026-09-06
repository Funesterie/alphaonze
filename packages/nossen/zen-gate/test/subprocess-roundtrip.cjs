'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { SubprocessTransport, syncFile } = require('../src/index.cjs');
const cli = path.join(__dirname, '..', 'bin', 'zen-gate.cjs');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CS = 256 * 1024;

(async () => {
  const tmp = path.join(os.tmpdir(), 'zen-gate-subproc-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(tmp, 'src.bin');
  const recvStore = path.join(tmp, 'recv-store');
  const recvOut = path.join(tmp, 'recv.bin');
  fs.writeFileSync(src, crypto.randomBytes(1024 * 1024));

  let tp = new SubprocessTransport({ nodeBin: process.execPath, cliScript: cli, recvStore, out: recvOut });
  let r = await syncFile(src, tp, { chunkSize: CS });
  assert.ok(r.ok, 'first sync failed');
  assert.strictEqual(r.sha256, sha(fs.readFileSync(src)));
  assert.strictEqual(r.sent, r.total);
  console.log('1) first sync  : sent=' + r.sent + '/' + r.total + ' chunks  wire=' + (tp.bytes/1024).toFixed(0) + 'KiB  recv sha OK');

  tp = new SubprocessTransport({ nodeBin: process.execPath, cliScript: cli, recvStore, out: recvOut });
  r = await syncFile(src, tp, { chunkSize: CS });
  assert.strictEqual(r.sent, 0);
  console.log('2) same file   : sent=' + r.sent + ' chunks  wire=' + tp.bytes + 'B  (full dedup over subprocess)');

  const B = Buffer.from(fs.readFileSync(src)); const off = 2 * CS; for (let i = off; i < off + 1000; i++) B[i] ^= 0xff;
  fs.writeFileSync(src, B);
  tp = new SubprocessTransport({ nodeBin: process.execPath, cliScript: cli, recvStore, out: recvOut });
  r = await syncFile(src, tp, { chunkSize: CS });
  assert.ok(r.ok && r.sha256 === sha(B));
  assert.strictEqual(r.sent, 1);
  console.log('3) 1-chunk mod  : sent=' + r.sent + '/' + r.total + ' chunks  wire=' + (tp.bytes/1024).toFixed(0) + 'KiB  recv sha OK');

  console.log('\nZEN Gate V1 SUBPROCESS round-trip: OK (real have/apply CLI + binary bundle over stdin/stdout, dedup proven)');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
