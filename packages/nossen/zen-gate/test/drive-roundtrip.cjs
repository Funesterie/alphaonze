'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { drivePush, drivePull, loadManifest } = require('../src/index.cjs');
const cli = path.join(__dirname, '..', 'bin', 'zen-gate.cjs');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CS = 256 * 1024;

(async () => {
  const tmp = path.join(os.tmpdir(), 'zen-gate-drive-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const shared = path.join(tmp, 'shared-drive');   // the OneDrive-style shared store (both sides see it)
  const src = path.join(tmp, 'src.bin');
  const out = path.join(tmp, 'out.bin');
  fs.writeFileSync(src, crypto.randomBytes(1024 * 1024));

  // PC push (direct)
  let r = drivePush(fs.readFileSync(src), shared, { name: 'src.bin', chunkSize: CS });
  assert.strictEqual(r.newChunks, r.totalChunks);
  console.log('1) PC push    : new=' + r.newChunks + '/' + r.totalChunks + ' chunks  written=' + (r.bytesWritten/1024).toFixed(0) + 'KiB to shared drive');

  // EX44 pull (direct) -> reconstruct + verify
  let p = drivePull(loadManifest(shared, 'src.bin'), shared, out);
  assert.ok(p.ok && p.sha256 === sha(fs.readFileSync(src)));
  console.log('2) EX44 pull  : reconstructed sha OK (' + p.total + ' chunks from shared drive)');

  // push same file again -> 0 new chunks (OneDrive syncs nothing)
  r = drivePush(fs.readFileSync(src), shared, { name: 'src.bin', chunkSize: CS });
  assert.strictEqual(r.newChunks, 0);
  console.log('3) PC re-push : new=' + r.newChunks + ' chunks  written=' + r.bytesWritten + 'B  (full dedup, OneDrive idle)');

  // modify one chunk -> 1 new chunk
  const B = Buffer.from(fs.readFileSync(src)); const off = 2 * CS; for (let i = off; i < off + 1000; i++) B[i] ^= 0xff;
  fs.writeFileSync(src, B);
  r = drivePush(fs.readFileSync(src), shared, { name: 'src.bin', chunkSize: CS });
  assert.strictEqual(r.newChunks, 1);
  console.log('4) PC push mod: new=' + r.newChunks + '/' + r.totalChunks + ' chunks  written=' + (r.bytesWritten/1024).toFixed(0) + 'KiB');
  p = drivePull(loadManifest(shared, 'src.bin'), shared, out);
  assert.ok(p.ok && p.sha256 === sha(B));
  console.log('5) EX44 pull  : reconstructed modified sha OK');

  // CLI drive-push / drive-pull end-to-end (subprocess)
  fs.writeFileSync(src, crypto.randomBytes(1024 * 1024));
  const pushOut = execFileSync(process.execPath, [cli, 'drive-push', src, '--store', shared, '--name', 'cli.bin', '--chunk-size', String(CS)], { encoding: 'utf8' });
  const pj = JSON.parse(pushOut);
  const pullOut = execFileSync(process.execPath, [cli, 'drive-pull', '--store', shared, '--name', 'cli.bin', '--out', out], { encoding: 'utf8' });
  const ll = JSON.parse(pullOut);
  assert.ok(ll.ok && ll.sha256 === sha(fs.readFileSync(src)));
  console.log('6) CLI push/pull: new=' + pj.newChunks + '/' + pj.totalChunks + '  pull sha OK');

  console.log('\nZEN Gate V1 DRIVE round-trip: OK (shared content-addressed store; OneDrive syncs only NEW compressed chunks; final SHA-256 verified)');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
