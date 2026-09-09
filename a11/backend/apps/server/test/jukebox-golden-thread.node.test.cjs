'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jukebox-golden-'));
process.env.A11_RUNTIME_ROOT = root;
const { readAudioStreamIntegrity } = require('../src/music/audio-stream-integrity.cjs');
const { inspectMasterRecord, resolveJukeboxAsset } = require('../src/music/jukebox-stream-integrity.cjs');
const { applyHistoryEnhancements } = require('../src/music/jukebox-history.cjs');
const { backfill } = require('../scripts/backfill-jukebox-stream-integrity.cjs');
const { measure, RECIPE } = require('../scripts/master-jukebox-v11pan.cjs');
const jukebox = require('../src/clips/jukebox-zen.cjs');
let zen;
try { zen = require('../../../../../packages/nossen/zen/src/index.cjs'); } catch { zen = require('@nossen/zen'); }
const KEY = 'test-only-golden-thread-key';
const assets = path.join(root, 'files/generated/vivy'), directory = path.join(root, 'vivy-stream/history');
const source = path.join(assets, 'source.mp3'), master = path.join(assets, 'master.mp3');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceUrl = '/api/vivy/studio/assets/source.mp3', masterUrl = '/api/vivy/studio/assets/master.mp3';
let record, recordPath, sourceBuffer, masterBuffer;
before(() => {
  fs.mkdirSync(assets, { recursive: true }); fs.mkdirSync(directory + '-masters', { recursive: true });
  const run = args => execFileSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-nostdin', '-v', 'error', ...args], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', source]);
  run(['-i', source, '-af', 'volume=0.5', '-c:a', 'libmp3lame', master]);
  sourceBuffer = fs.readFileSync(source); masterBuffer = fs.readFileSync(master);
  record = { sourceTrackUrl: sourceUrl, trackUrl: masterUrl, sourceSha256: hash(sourceBuffer), outputSha256: hash(masterBuffer), recipe: RECIPE, verified: true };
  recordPath = path.join(directory + '-masters', hash(sourceUrl) + '.json');
  fs.writeFileSync(recordPath, JSON.stringify(record));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('V11 measure includes the main stream without confusing source and master', async () => {
  const sourceMetrics = await measure(source), outputMetrics = await measure(master);
  assert.equal(sourceMetrics.streamSha256, (await readAudioStreamIntegrity(source)).sha256);
  assert.notEqual(sourceMetrics.streamSha256, outputMetrics.streamSha256);
});

test('backfill is idempotent, leaves media and active master records untouched, exposes bound lineage only', async () => {
  const initialRecord = fs.readFileSync(recordPath);
  const first = await backfill({ directory, assetDir: assets });
  assert.equal(first.inspected, 1); assert.equal(first.failed, 0);
  const second = await backfill({ directory, assetDir: assets });
  assert.equal(second.inspected, 0); assert.equal(second.reused, 1);
  assert.deepEqual(fs.readFileSync(recordPath), initialRecord);
  assert.deepEqual(fs.readFileSync(source), sourceBuffer); assert.deepEqual(fs.readFileSync(master), masterBuffer);
  const item = applyHistoryEnhancements([{ trackUrl: sourceUrl }], directory)[0];
  assert.equal(item.goldenThread.relationship, 'derived-from');
  assert.equal(item.goldenThread.sameEncodedStream, false);
  // Stale evidence cannot certify a replacement master with different bytes.
  fs.writeFileSync(recordPath, JSON.stringify({ ...record, outputSha256: 'a'.repeat(64) }));
  const otherDirectory = path.join(root, 'stale');
  fs.cpSync(directory + '-masters', otherDirectory + '-masters', { recursive: true });
  fs.cpSync(directory + '-streams', otherDirectory + '-streams', { recursive: true });
  assert.equal(applyHistoryEnhancements([{ trackUrl: sourceUrl }], otherDirectory)[0].goldenThread, undefined);
  fs.writeFileSync(recordPath, initialRecord);
});

test('mismatched source, concurrent changes and unsafe paths cannot acquire evidence', async () => {
  await assert.rejects(inspectMasterRecord({ ...record, sourceSha256: 'b'.repeat(64) }, assets), /integrity_mismatch/);
  await assert.rejects(inspectMasterRecord(record, assets, { readAudioStreamIntegrity: async file => {
    const result = await readAudioStreamIntegrity(file);
    if (file === master) fs.appendFileSync(source, 'changed');
    return result;
  } }), /integrity_mismatch/);
  fs.writeFileSync(source, sourceBuffer);
  for (const url of ['/etc/passwd', '/api/vivy/studio/assets/a%2Fb.mp3', 'https://evil.test/a.mp3']) assert.throws(() => resolveJukeboxAsset(url, assets), /unsupported_source/);
});

test('verified ZEN preserves original, master, cover and lineage; no key travels inside', async () => {
  const encoded = await jukebox.encodeTrackVerified({ audioBuffer: sourceBuffer, title: 'Fil dor', coverBuffer: Buffer.from('cover'), masters: [{ id: 'v11', chain: RECIPE, buffer: masterBuffer }] }, { key: KEY });
  assert.equal(encoded.includes(Buffer.from(KEY)), false);
  const decoded = await jukebox.decodeTrackVerified(encoded, { key: KEY });
  assert.equal(decoded.integrityOk, true); assert.equal(decoded.streamIntegrityOk, true);
  assert.deepEqual(decoded.audio.buffer, sourceBuffer); assert.deepEqual(decoded.masters[0].buffer, masterBuffer);
  assert.equal(decoded.masters[0].goldenThread.sameEncodedStream, false);
  assert.equal(decoded.masters[0].goldenThread.sourceStreamSha256, decoded.audio.streamSha256);
});

test('false stream hash or false master lineage is rejected even with valid container authentication', async () => {
  const a = await readAudioStreamIntegrity(source), b = await readAudioStreamIntegrity(master);
  const build = () => jukebox.buildTrackPayload({ audioBuffer: sourceBuffer, audioStreamIntegrity: a, masters: [{ buffer: masterBuffer, streamIntegrity: b, chain: RECIPE }], coverBuffer: Buffer.from('cover') });
  const wrongStream = build(); wrongStream.audio.streamSha256 = 'c'.repeat(64);
  const bad = await jukebox.decodeTrackVerified(zen.encodeZenContainer(wrongStream, { key: KEY }), { key: KEY });
  assert.equal(bad.integrityOk, false); assert.equal(bad.streamIntegrityOk, false);
  const wrongLineage = build(); wrongLineage.masters[0].goldenThread.sameEncodedStream = true;
  assert.equal((await jukebox.decodeTrackVerified(zen.encodeZenContainer(wrongLineage, { key: KEY }), { key: KEY })).integrityOk, false);
  const corruptMaster = build(); corruptMaster.masters[0].sha256 = 'd'.repeat(64);
  const decoded = jukebox.decodeTrack(zen.encodeZenContainer(corruptMaster, { key: KEY }), { key: KEY });
  assert.equal(decoded.integrityOk, false); assert.equal(decoded.cover.integrityOk, true); assert.equal(decoded.masters[0].integrityOk, false);
});

test('legacy archives stay readable but never claim measured stream integrity', async () => {
  const legacy = jukebox.encodeTrack({ audioBuffer: sourceBuffer }, { key: KEY });
  const decoded = await jukebox.decodeTrackVerified(legacy, { key: KEY });
  assert.equal(decoded.integrityOk, true); assert.equal(decoded.streamIntegrityOk, null);
  await assert.rejects(jukebox.encodeTrackVerified({ audioBuffer: sourceBuffer, masters: Array.from({ length: 9 }, () => ({ buffer: masterBuffer })) }, { key: KEY }), /size_limit/);
});
