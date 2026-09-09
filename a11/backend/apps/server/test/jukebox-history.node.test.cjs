'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jukebox-history-test-'));
process.env.A11_RUNTIME_ROOT = root;
const { localAudioUrl, normalizeHistoryTrack, mergeHistoryTracks, rememberHistoryTracks, readHistoryTracks, historyDirectory, applyHistoryEnhancements } = require('../src/music/jukebox-history.cjs');
const track = i => ({ title: 'Chanson ' + i, trackUrl: '/api/vivy/studio/assets/music-' + i + '.mp3', createdAt: new Date(1700000000000 + i * 1000).toISOString(), lyrics: 'Paroles ' + i });
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('archive durable non plafonnée, idempotente et visible depuis une autre instance', () => {
  const dir = path.join(root, 'archive');
  assert.equal(rememberHistoryTracks(Array.from({ length: 350 }, (_, i) => track(i)), dir), 350);
  assert.equal(readHistoryTracks(dir).length, 350);
  assert.equal(rememberHistoryTracks([track(1)], dir), 0);
  delete require.cache[require.resolve('../src/music/jukebox-history.cjs')];
  const other = require('../src/music/jukebox-history.cjs');
  other.rememberHistoryTracks([track(351)], dir);
  assert.equal(readHistoryTracks(dir).length, 351);
});

test('liens signés, hôtes étrangers, traversée et données sensibles restent hors archive publique', () => {
  for (const url of ['https://cdn1.suno.ai/a.mp3?token=SECRET', 'https://evil.example/a.mp3', '/api/vivy/studio/assets/a%2fb.mp3', '/etc/passwd', 'file:///a.mp3']) assert.equal(localAudioUrl(url), '');
  const safe = normalizeHistoryTrack({ ...track(1), secret: 'SECRET', apiKey: 'KEY', localPath: '/private', sourceUrl: 'https://cdn1.suno.ai/a.mp3?token=SECRET' });
  assert.doesNotMatch(JSON.stringify(safe), /SECRET|KEY|private|cdn1/);
});

test('doublons exacts fusionnés, variantes distinctes conservées, indisponibilité honnête', () => {
  const source = { ...track(1), providerTrackId: 'abc12345', audioSha256: 'a'.repeat(64) };
  const tracks = mergeHistoryTracks([source, { ...track(2), audioSha256: 'a'.repeat(64) }, { ...track(3), audioSha256: 'b'.repeat(64) }, { title: 'Perdu', providerTrackId: 'abc12345', unavailableReason: 'media_download_404' }, { title: 'Manquant', providerTrackId: 'def12345' }]);
  assert.equal(tracks.length, 3);
  assert.equal(tracks.filter(t => t.available).length, 2);
  assert.equal(tracks.find(t => t.providerTrackId === 'abc12345').unavailableReason, '');
  assert.equal(tracks.find(t => t.providerTrackId === 'def12345').trackUrl, '');
});

test('chargement du direct archive les morceaux avant sa limite de 120 et conserve les anciens liens', () => {
  const { createVivyStreamStore, STREAM_SCHEMA } = require('../src/routes/vivy-stream.cjs');
  const statePath = path.join(root, 'stream', 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ schema: STREAM_SCHEMA, songs: Array.from({ length: 160 }, (_, i) => ({ ...track(i), id: 'track-test-' + i, sharePath: '/api/vivy/stream/s/test-' + i })) }));
  const store = createVivyStreamStore({ statePath, idleJukeboxEnabled: false });
  assert.equal(store.getState().songs.length, 120);
  assert.equal(store.getSongsArchive().length, 160);
  assert.equal(readHistoryTracks(historyDirectory(statePath)).length, 160);
  assert.equal(store.findSongByShareSlug('test-0').title, 'Chanson 0');
});

test('seuls les audios disponibles sont publics, les traces manquantes restent conservées', () => {
  const directory = path.join(root, 'only-available');
  const items = [track(1), { title: 'Perdu', providerTrackId: 'missing123' }];
  rememberHistoryTracks(items, directory);
  assert.equal(readHistoryTracks(directory).length, 2);
  assert.equal(applyHistoryEnhancements(readHistoryTracks(directory), directory).length, 1);
});

test('V11 compare la durée réellement décodée, pas une estimation MP3 sans index Xing', () => {
  const { decodedDurationSeconds } = require('../scripts/master-jukebox-v11pan.cjs');
  assert.equal(decodedDurationSeconds(48000 * 2 * 205, 48000), 205);
  assert.equal(decodedDurationSeconds(44100 * 2 * 30, 44100), 30);
  for (const args of [[0, 48000], [42, 0], [undefined, 44100], [Infinity, 44100]]) assert.throws(() => decodedDurationSeconds(...args), /missing_decoded_duration/);
});

test('Claude et V11 ne remplacent ni la source ni les originaux et exigent une sortie vérifiée présente', () => {
  const directory = path.join(root, 'enhanced'), item = track(2);
  const key = require('node:crypto').createHash('sha256').update(item.trackUrl).digest('hex');
  fs.mkdirSync(directory + '-titles', { recursive: true }); fs.mkdirSync(directory + '-masters', { recursive: true });
  fs.writeFileSync(path.join(directory + '-titles', key + '.json'), JSON.stringify({ sourceTrackUrl: item.trackUrl, provider: 'anthropic', title: 'La nuit nous écoute' }));
  const masterFile = path.join(directory + '-masters', key + '.json');
  fs.writeFileSync(masterFile, JSON.stringify({ sourceTrackUrl: item.trackUrl, recipe: 'v11pan-v9electrolysis-blend-1.5-4-v1', verified: true, trackUrl: '/api/vivy/studio/assets/master.mp3' }));
  const before = applyHistoryEnhancements([item], directory)[0];
  assert.equal(before.title, 'La nuit nous écoute'); assert.equal(before.trackUrl, item.trackUrl);
  const assets = path.join(root, 'files/generated/vivy'); fs.mkdirSync(assets, { recursive: true }); fs.writeFileSync(path.join(assets, 'master.mp3'), 'fixture');
  const after = applyHistoryEnhancements([item], directory)[0];
  assert.equal(after.mastering, 'V11 Pan'); assert.equal(after.originalTrackUrl, item.trackUrl);
  assert.equal(after.originalTitle, item.title); assert.equal(item.title, 'Chanson 2');
});
