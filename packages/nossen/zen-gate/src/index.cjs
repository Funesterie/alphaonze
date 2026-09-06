'use strict';
const fs = require('node:fs');
const { buildManifest, buildManifestFromBuffer } = require('./manifest.cjs');
const { haveNeed } = require('./negotiate.cjs');
const { packNeededFromBuffer } = require('./pack.cjs');
const { reconstruct } = require('./reconstruct.cjs');
const { ChunkStore } = require('./store.cjs');
const { InMemoryTransport, SubprocessTransport, SshTransport } = require('./transport.cjs');
const { HttpTransport } = require('./transport-http.cjs');
const { drivePush, drivePull, loadManifest } = require('./drive.cjs');

// Uniform sync over any transport. sender buffer -> receiver (transport reconstructs remotely or locally).
async function syncBuffer(buf, transport, opts = {}) {
  const manifest = buildManifestFromBuffer(buf, { chunkSize: opts.chunkSize, name: opts.name });
  await transport.sendManifest(manifest);
  const plan = await transport.requestHaveNeed();
  const packed = packNeededFromBuffer(buf, plan.need, manifest, { brotliQuality: opts.brotliQuality });
  const res = await transport.sendBundle(packed);
  return { ...res, need: plan.need.length, have: plan.have.length, bytes: transport.bytes, rounds: transport.rounds };
}
async function syncFile(filePath, transport, opts = {}) { return syncBuffer(fs.readFileSync(filePath), transport, { ...opts, name: opts.name || filePath }); }

module.exports = {
  buildManifest, buildManifestFromBuffer, haveNeed, packNeededFromBuffer, reconstruct,
  ChunkStore, InMemoryTransport, SubprocessTransport, SshTransport, HttpTransport, syncBuffer, syncFile, drivePush, drivePull, loadManifest,
};
