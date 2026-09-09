'use strict';
// Read-only media pass. Independent sidecars avoid racing the active V11 writer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const { historyDirectory } = require('../src/music/jukebox-history.cjs');
const { inspectMasterRecord } = require('../src/music/jukebox-stream-integrity.cjs');

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function backfill({ directory = historyDirectory(), assetDir = path.join(getCanonicalRuntimeRoot(), 'files/generated/vivy') } = {}) {
  const stats = { inspected: 0, reused: 0, failed: 0, errors: [], updatedAt: '' };
  for (const name of fs.readdirSync(directory + '-masters').sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const file = path.join(directory + '-masters', name), original = fs.readFileSync(file, 'utf8');
      const record = JSON.parse(original), target = path.join(directory + '-streams', name);
      const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
      if (previous?.schema === 'funesterie.jukebox.stream-sidecar.v1' && previous.sourceSha256 === record.sourceSha256 && previous.outputSha256 === record.outputSha256 && previous.goldenThread?.recipe === record.recipe) { stats.reused++; continue; }
      const result = await inspectMasterRecord(record, assetDir);
      if (fs.readFileSync(file, 'utf8') !== original) throw Error('master_record_changed');
      atomic(target, result); stats.inspected++;
    } catch (error) { stats.failed++; stats.errors.push({ record: name, error: String(error.code || error.message).slice(0, 100) }); }
    stats.updatedAt = new Date().toISOString();
    atomic(path.join(path.dirname(directory), 'jukebox-stream-integrity-status.json'), stats);
  }
  stats.updatedAt = new Date().toISOString();
  atomic(path.join(path.dirname(directory), 'jukebox-stream-integrity-status.json'), stats);
  return stats;
}

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const root = path.join(getCanonicalRuntimeRoot(), 'vivy-stream');
  const lock = path.join(root, 'jukebox-stream-integrity.lock');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });
  try {
    do {
      const stats = await backfill(); console.log(JSON.stringify(stats));
      if (stats.failed) { process.exitCode = 1; break; }
      const status = JSON.parse(fs.readFileSync(path.join(root, 'jukebox-v11pan-status.json'), 'utf8'));
      if (stopping || !process.argv.includes('--follow-master')) break;
      if (status.state !== 'running') { console.log(JSON.stringify(await backfill())); break; }
      await new Promise(resolve => setTimeout(resolve, 30000));
    } while (!stopping);
  } finally { fs.unlinkSync(lock); }
}
if (require.main === module) main().catch(error => { console.error(String(error.code || error.message)); process.exitCode = 1; });
module.exports = { backfill };
