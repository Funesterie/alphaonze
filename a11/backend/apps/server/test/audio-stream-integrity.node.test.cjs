'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { readAudioStreamIntegrity, validateAudioStreamIntegrity } = require('../src/music/audio-stream-integrity.cjs');
const { createAudioProvenancePlan, buildSignedAudioProvenanceManifest, verifyAudioProvenanceManifest } = require('../src/music/funesterie-audio-provenance.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-golden-thread-'));
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const ffprobe = process.env.FFPROBE_BIN || 'ffprobe';
const available = spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0 && spawnSync(ffprobe, ['-version'], { windowsHide: true }).status === 0;
const source = path.join(root, 'source.mp3'), tagged = path.join(root, 'tagged.mp3'), remuxed = path.join(root, 'remuxed.mka'), changed = path.join(root, 'changed.mp3'), multi = path.join(root, 'multi.mka');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = args => execFileSync(ffmpeg, ['-nostdin', '-v', 'error', ...args], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
before(() => {
  if (!available) return;
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', source]);
  run(['-i', source, '-map', '0:a:0', '-c:a', 'copy', '-metadata', 'title=New title, same audio', tagged]);
  run(['-i', source, '-map', '0:a:0', '-c:a', 'copy', remuxed]);
  run(['-i', source, '-af', 'volume=0.5', '-c:a', 'libmp3lame', '-b:a', '128k', changed]);
  run(['-i', source, '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.4', '-map', '0:a:0', '-map', '1:a:0', '-c:a:0', 'copy', '-c:a:1', 'pcm_s16le', multi]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('fil d’or : les tags et le conteneur changent le fichier mais pas le flux audio copié', { skip: !available }, async () => {
  const base = await readAudioStreamIntegrity(source);
  for (const file of [tagged, remuxed, multi]) {
    assert.notEqual(sha(file), sha(source));
    const audio = await readAudioStreamIntegrity(file);
    assert.equal(audio.sha256, base.sha256);
    assert.equal(audio.codec, 'mp3');
    assert.equal(audio.selection, '0:a:0');
  }
});

test('un traitement audio change le SHA du flux et garde une filiation signée, sans falsifier une égalité', { skip: !available }, async () => {
  const sourceStreamIntegrity = await readAudioStreamIntegrity(source), assetStreamIntegrity = await readAudioStreamIntegrity(changed);
  assert.notEqual(sourceStreamIntegrity.sha256, assetStreamIntegrity.sha256);
  const pair = crypto.generateKeyPairSync('ed25519');
  const keyPair = { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), keyId: 'test-key' };
  const plan = createAudioProvenancePlan(source, { sourceStreamIntegrity });
  const manifest = buildSignedAudioProvenanceManifest(changed, plan, { keyPair, assetStreamIntegrity });
  assert.equal(manifest.schema, 'funesterie.audio.provenance.v2');
  assert.equal(manifest.goldenThread.sourceStreamSha256, sourceStreamIntegrity.sha256);
  assert.equal(manifest.goldenThread.sameEncodedStream, false);
  assert.equal(verifyAudioProvenanceManifest(manifest), true);
  manifest.streamIntegrity.asset.sha256 = 'a'.repeat(64);
  assert.equal(verifyAudioProvenanceManifest(manifest), false);
  const legacy = buildSignedAudioProvenanceManifest(changed, createAudioProvenancePlan(source), { keyPair });
  assert.equal(legacy.schema, 'funesterie.audio.provenance.v1'); assert.equal(verifyAudioProvenanceManifest(legacy), true);
  assert.throws(() => buildSignedAudioProvenanceManifest(changed, plan, { keyPair }), /stream_pair_required/);
});

test('ne certifie pas un fichier vide, un conteneur illisible ou des empreintes mal formées', async () => {
  const empty = path.join(root, 'empty.mp3'); fs.writeFileSync(empty, '');
  await assert.rejects(readAudioStreamIntegrity(empty), /input_empty/);
  assert.throws(() => validateAudioStreamIntegrity({ sha256: 'not-a-hash' }), /integrity_invalid/);
  if (available) { fs.writeFileSync(empty, 'not media'); await assert.rejects(readAudioStreamIntegrity(empty), /probe_failed|stream_missing/); }
});

test('une mutation pendant le contrôle refuse la certification et les sous-processus ne lisent pas stdin', async () => {
  const file = path.join(root, 'changing.mp3'); fs.writeFileSync(file, 'fixture');
  let calls = 0;
  await assert.rejects(readAudioStreamIntegrity(file, { execFile: async (_bin, args) => {
    calls++;
    assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
    if (calls === 1) return { stdout: JSON.stringify({ streams: [{ index: 0, codec_name: 'mp3', sample_rate: '48000', channels: 2 }] }) };
    assert.ok(args.includes('-nostdin')); assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
    fs.appendFileSync(file, '-changed'); return { stdout: '0,a,SHA256=' + 'b'.repeat(64) + '\n' };
  } }), /input_changed/);
});

test('un flux déclaré sans paquets ou sans piste audio ne reçoit jamais une empreinte valide', async () => {
  const file = path.join(root, 'empty-stream.mp3'); fs.writeFileSync(file, 'fixture');
  await assert.rejects(readAudioStreamIntegrity(file, { execFile: async () => ({ stdout: '{"streams":[]}' }) }), /audio_stream_missing/);
  let calls = 0;
  await assert.rejects(readAudioStreamIntegrity(file, { execFile: async () => ++calls === 1
    ? { stdout: '{"streams":[{"index":0,"codec_name":"mp3","sample_rate":"48000","channels":2}]}' }
    : { stdout: '0,a,SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n' }
  }), /hash_empty_or_invalid/);
});
