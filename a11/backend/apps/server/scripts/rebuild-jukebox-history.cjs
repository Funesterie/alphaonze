'use strict';
// Explicit historical recovery, not an automatic publication of future uploads.
// No API key and no generation endpoint: only existing local/provider audio.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const { downloadRemoteMedia } = require('../src/security/safe-media-input.cjs');
const { historyDirectory, mergeHistoryTracks, rememberHistoryTracks } = require('../src/music/jukebox-history.cjs');
const root = getCanonicalRuntimeRoot();
const assetDir = path.join(root, 'files/generated/vivy');
const callbackDir = path.join(root, 'vivy-suno-callbacks');
const apply = process.argv.includes('--publish-all');
const recoverRemote = process.argv.includes('--recover-remote');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const urlsFor = track => [...new Set(['audio_url', 'source_audio_url', 'stream_audio_url', 'source_stream_audio_url'].map(key => track[key]).filter(value => typeof value === 'string' && value.startsWith('https://')))];
const hosts = ['tempfile.aiquickdraw.com', 'cdn1.suno.ai', 'cdn2.suno.ai', 'musicfile.removeai.ai', 'audiopipe.suno.ai', 'audiostream.api.box'];
const stats = { callbacks: 0, localFiles: 0, remoteRecovered: 0, unavailable: 0, invalidFiles: 0, failedCallbacks: 0, networkAttempts: 0, paidGenerationRequests: 0 };

function inspect(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) return null;
  try {
    const j = JSON.parse(result.stdout), duration = Number(j.format?.duration);
    if (!j.streams?.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0) return null;
    return { durationSeconds: duration, audioSha256: hash(fs.readFileSync(file)) };
  } catch { return null; }
}

async function rebuild() {
  if (recoverRemote && !apply) throw Error('--recover-remote requires explicit --publish-all');
  const records = [], locals = new Map(), consumed = new Set();
  for (const name of fs.readdirSync(path.join(root, 'vivy-stream')).filter(x => /^state\.json(?:$|\.bak)/.test(x))) {
    const state = JSON.parse(fs.readFileSync(path.join(root, 'vivy-stream', name)));
    records.push(...(state.songs || []), ...(state.jukebox?.tracks || []));
  }
  for (const entry of fs.readdirSync(assetDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mp3|wav|flac)$/i.test(entry.name) || entry.name.startsWith('vivy-music-jukebox-v11pan-')) continue;
    const file = path.join(assetDir, entry.name), measured = inspect(file);
    if (!measured) { stats.invalidFiles++; continue; }
    locals.set(entry.name, { ...measured, trackUrl: '/api/vivy/studio/assets/' + encodeURIComponent(entry.name), createdAt: fs.statSync(file).mtime.toISOString() });
  }
  stats.localFiles = locals.size;
  console.log(JSON.stringify({ phase: 'local-probed', ...stats }));
  const missing = [];
  for (const name of fs.readdirSync(callbackDir).filter(x => x.endsWith('.json'))) {
    const callback = JSON.parse(fs.readFileSync(path.join(callbackDir, name))); stats.callbacks++;
    const tracks = callback.payload?.data?.data;
    if (!Array.isArray(tracks)) { stats.failedCallbacks++; continue; }
    for (const [index, track] of tracks.entries()) {
      if (!track?.id) continue;
      const urls = urlsFor(track);
      const matches = urls.map(url => 'vivy-music-suno-' + hash(url).slice(0, 16) + '.mp3').filter(name => locals.has(name));
      const record = { id: 'suno-' + track.id, providerTrackId: track.id, title: track.title, lyrics: track.prompt,
        createdAt: Number(track.createTime) > 0 ? new Date(Number(track.createTime)).toISOString() : callback.receivedAt,
        durationSeconds: Number(track.duration) || 0, source: 'suno-archive', variant: 'Variante ' + (index + 1), trackUrl: '' };
      if (matches.length) {
        for (const name of matches) { consumed.add(name); records.push({ ...record, ...locals.get(name), createdAt: record.createdAt }); }
      } else missing.push({ record, urls });
    }
  }
  // Preserve local mixes, layers and WAV/FLAC experiments, without invented titles.
  for (const [name, media] of locals) if (!consumed.has(name)) records.push({ ...media, title: name, source: /^vivy-layer-/.test(name) ? 'essai-couche-audio' : 'archive-fichier-local', variant: 'Fichier local' });
  const extraDir = path.join(root, 'recovered-suno-20260807');
  if (fs.existsSync(extraDir)) for (const name of fs.readdirSync(extraDir).filter(x => /^[a-z0-9-]+\.mp3$/i.test(x))) {
    const file = path.join(extraDir, name), measured = inspect(file); if (!measured) continue;
    const destination = 'vivy-music-recovered-' + name, target = path.join(assetDir, destination);
    if (apply && !fs.existsSync(target)) fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    records.push({ ...measured, title: name, trackUrl: '/api/vivy/studio/assets/' + destination, createdAt: fs.statSync(file).mtime.toISOString(), source: 'suno-recuperation-20260807', variant: 'Variante archivée' });
  }
  let cursor = 0, completed = 0;
  await Promise.all(Array.from({ length: recoverRemote ? 4 : 1 }, async () => {
    while (cursor < missing.length) {
      const { record, urls } = missing[cursor++]; let recovered = false;
      if (recoverRemote) for (const url of urls.slice(0, 4)) {
        let temporary;
        try {
          stats.networkAttempts++;
          const media = await downloadRemoteMedia(url, { allowedHosts: hosts, allowedContentTypes: ['audio/*', 'application/octet-stream'], maxBytes: 50 * 1024 * 1024, timeoutMs: 8000, maxRedirects: 3 });
          const name = 'vivy-music-suno-' + hash(media.finalUrl).slice(0, 16) + '.mp3';
          const target = path.join(assetDir, name);
          temporary = target + '.' + crypto.randomUUID() + '.recovery.tmp';
          fs.writeFileSync(temporary, media.buffer, { flag: 'wx', mode: 0o644 });
          const measured = inspect(temporary); if (!measured) throw Error('invalid_audio');
          if (!fs.existsSync(target)) fs.renameSync(temporary, target);
          Object.assign(record, measured, { trackUrl: '/api/vivy/studio/assets/' + name });
          stats.remoteRecovered++; recovered = true; break;
        } catch (error) { record.unavailableReason = /^media_download_\d+$/.test(error.message) ? error.message : 'audio_not_recovered'; }
        finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      }
      if (!recovered) stats.unavailable++;
      records.push(record); completed++;
      if (completed % 100 === 0) console.log(JSON.stringify({ phase: 'existing-provider-audio', completed, candidates: missing.length, ...stats }));
    }
  }));
  // Existing curated state is last: retain its human titles and sharing links.
  const state = JSON.parse(fs.readFileSync(path.join(root, 'vivy-stream/state.json')));
  const merged = mergeHistoryTracks(records, state.songs || []);
  const output = { ...stats, tracks: merged.length, playable: merged.filter(t => t.available).length, unavailable: merged.filter(t => !t.available).length, published: apply };
  if (apply) {
    const dir = historyDirectory();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report = path.join(root, 'vivy-stream', 'history-recovery-' + stamp + '.json');
    fs.writeFileSync(report, JSON.stringify({ ...output, recoveredAt: new Date().toISOString(), publicationAuthority: 'User: Tout rendre public, 2026-09-09', sourceScope: 'Existing generated music, cached Suno callbacks and recovered-suno-20260807; voice reference libraries excluded' }, null, 2), { flag: 'wx', mode: 0o600 });
    output.filesWritten = rememberHistoryTracks(merged, dir);
  }
  console.log(JSON.stringify({ phase: 'complete', ...output }));
}

rebuild().catch(error => { console.error(JSON.stringify({ error: String(error.message).replace(/https?:\/\/\S+/g, '[url]') })); process.exitCode = 1; });
