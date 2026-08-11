'use strict';
const fs = require('node:fs'), http = require('node:http');
const { buildManifest } = require('../src/manifest.cjs');
const { haveNeed } = require('../src/negotiate.cjs');
const { packNeededFromBuffer } = require('../src/pack.cjs');
const { reconstruct } = require('../src/reconstruct.cjs');
const { ChunkStore } = require('../src/store.cjs');
const { encodeBundle, decodeBundle } = require('../src/bundle.cjs');
const { SshTransport } = require('../src/transport.cjs');
const { syncFile } = require('../src/index.cjs');
const { drivePush, drivePull, loadManifest } = require('../src/drive.cjs');

function readStdin() { return new Promise((res) => { const ch = []; process.stdin.on('data', d => ch.push(d)); process.stdin.on('end', () => res(Buffer.concat(ch))); process.stdin.on('error', () => res(Buffer.alloc(0))); }); }
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function num(name, d) { const v = Number(arg(name)); return Number.isFinite(v) && v > 0 ? v : d; }
function readBody(req) { return new Promise(r => { const ch = []; req.on('data', d => ch.push(d)); req.on('end', () => r(Buffer.concat(ch))); }); }

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'manifest') {
    process.stdout.write(JSON.stringify(buildManifest(process.argv[3], { chunkSize: num('--chunk-size', undefined) })));
  } else if (cmd === 'have') {
    const store = new ChunkStore(arg('--store'));
    const manifest = JSON.parse((await readStdin()).toString('utf8'));
    const plan = haveNeed(manifest, store);
    process.stdout.write(JSON.stringify({ need: plan.need, have: plan.have.map(c => c.sha256) }));
  } else if (cmd === 'pack') {
    const file = process.argv[3]; const buf = fs.readFileSync(file);
    const need = JSON.parse((await readStdin()).toString('utf8')).need;
    const manifest = buildManifest(file, { chunkSize: num('--chunk-size', undefined) });
    const packed = packNeededFromBuffer(buf, need, manifest, { brotliQuality: num('--quality', 11) });
    process.stdout.write(encodeBundle(packed.manifest, packed.chunks));
  } else if (cmd === 'apply') {
    const store = new ChunkStore(arg('--store'));
    const r = reconstruct(decodeBundle(await readStdin()), store, arg('--out') || null);
    process.stdout.write(JSON.stringify(r));
  } else if (cmd === 'serve') {
    const store = new ChunkStore(arg('--store'));
    const port = num('--port', 8080);
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const body = await readBody(req);
      try {
        if (req.url === '/have') { const plan = haveNeed(JSON.parse(body.toString('utf8')), store); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ need: plan.need, have: plan.have.map(c => c.sha256) })); }
        else if (req.url && req.url.startsWith('/apply')) { const u = new URL(req.url, 'http://x'); const out = u.searchParams.get('out'); const r = reconstruct(decodeBundle(body), store, out); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)); }
        else { res.writeHead(404); res.end(); }
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
    });
    server.listen(port, '0.0.0.0', () => process.stderr.write('zen-gate serve on 0.0.0.0:' + port + '\n'));
  } else if (cmd === 'sync') {
    const file = process.argv[3];
    const tp = new SshTransport({ sshArgs: ['-i', arg('--key'), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'], remoteNode: arg('--remote-node') || 'node', remoteCli: arg('--remote-cli'), remoteStore: arg('--remote-store'), remoteOut: arg('--remote-out') || null });
    const r = await syncFile(file, tp, { chunkSize: num('--chunk-size', undefined), brotliQuality: num('--quality', 11), name: arg('--name') || file });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else if (cmd === 'drive-push') {
    const file = process.argv[3]; const buf = fs.readFileSync(file);
    const r = drivePush(buf, arg('--store'), { chunkSize: num('--chunk-size', undefined), brotliQuality: num('--quality', 11), name: arg('--name') || file });
    process.stdout.write(JSON.stringify({ fileSha: r.fileSha, newChunks: r.newChunks, totalChunks: r.totalChunks, bytesWritten: r.bytesWritten, manifestPath: r.manifestPath }) + '\n');
  } else if (cmd === 'drive-pull') {
    const store = arg('--store'); const name = arg('--name');
    const manifest = arg('--manifest') ? JSON.parse(fs.readFileSync(arg('--manifest'), 'utf8')) : loadManifest(store, name);
    const r = drivePull(manifest, store, arg('--out'));
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    process.stderr.write('usage: zen-gate <manifest|have|pack|apply|serve|sync|drive-push|drive-pull> ...\n'); process.exit(2);
  }
})().catch(e => { process.stderr.write('zen-gate error: ' + (e && e.stack || e) + '\n'); process.exit(1); });
