'use strict';

// The live state is a bounded working set, not the permanent music archive.
// One atomic file per track avoids a shared blue/green read-modify-write index.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateAudioStreamIntegrity } = require('./audio-stream-integrity.cjs');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const cache = new Map();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const text = (value, max) => String(value || '').trim().slice(0, max);

function historyDirectory(statePath) {
  const directory = statePath ? path.dirname(statePath) : path.join(getCanonicalRuntimeRoot(), 'vivy-stream');
  const name = statePath && path.basename(statePath) !== 'state.json' ? path.basename(statePath, '.json') + '-history' : 'history';
  return path.join(directory, name);
}

function publicAssetUrl(value) {
  try {
    const u = new URL(String(value || ''), 'https://a11.funesterie.me');
    if (!['a11.funesterie.me', 'vivy.funesterie.me', 'funesterie.me'].includes(u.hostname) || u.search || u.hash) return '';
    return /^\/api\/vivy\/studio\/assets\/[^/]+$/.test(u.pathname) ? u.pathname : '';
  } catch { return ''; }
}

function localAudioUrl(value) {
  try {
    const u = new URL(String(value || ''), 'https://a11.funesterie.me');
    if (!['a11.funesterie.me', 'vivy.funesterie.me', 'funesterie.me'].includes(u.hostname) || u.search || u.hash) return '';
    const name = decodeURIComponent(u.pathname.split('/').pop());
    if (!name || /[\\/]/.test(name) || !/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(name)) return '';
    if (!/^\/api\/(vivy\/studio\/assets|mcp-bridge\/play-upload)\/[^/]+$/.test(u.pathname)) return '';
    return u.pathname;
  } catch { return ''; }
}

function normalizeHistoryTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const trackUrl = localAudioUrl(value.trackUrl || value.audioUrl);
  const providerTrackId = /^[a-z0-9-]{8,80}$/i.test(value.providerTrackId || '') ? value.providerTrackId : '';
  if (!trackUrl && !providerTrackId) return null;
  const id = /^[-a-z0-9_]{4,100}$/i.test(value.id || '') ? value.id : 'archive-' + hash(trackUrl || providerTrackId).slice(0, 20);
  const title = text(value.trackTitle || value.title, 240) || 'Titre non retrouvé';
  const date = Date.parse(value.createdAt || '');
  const duration = Number(value.durationSeconds || 0);
  return {
    id, title, trackTitle: title, trackUrl,
    available: Boolean(trackUrl),
    unavailableReason: trackUrl ? '' : text(value.unavailableReason || 'audio_not_recovered', 100),
    createdAt: Number.isFinite(date) ? new Date(date).toISOString() : '',
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
    source: text(value.source || 'archive-recovered', 80),
    requestedBy: text(value.requestedBy, 80),
    lyrics: text(value.lyrics, 16000),
    providerTrackId,
    variant: text(value.variant, 80),
    audioSha256: /^[a-f0-9]{64}$/.test(value.audioSha256 || '') ? value.audioSha256 : '',
    sharePath: /^\/api\/vivy\/stream\/s\/[a-z0-9_-]+$/i.test(value.sharePath || '') ? value.sharePath : '',
    coverImageUrl: publicAssetUrl(value.coverImageUrl),
    coverVideoUrl: publicAssetUrl(value.coverVideoUrl),
    shareVideoUrl: publicAssetUrl(value.shareVideoUrl),
    coverPrompt: text(value.coverPrompt, 2000),
    coverVideoPrompt: text(value.coverVideoPrompt, 2600),
    qualityNote: text(value.qualityNote, 140),
    shortMix: value.shortMix === true,
    // Never expose provider URLs, signed tokens, local paths or raw callbacks.
    starCount: Math.max(0, Number(value.starCount) || 0),
    starAverage: Math.max(0, Math.min(5, Number(value.starAverage) || 0)),
  };
}

function mergeHistoryTracks(...collections) {
  const tracks = [], keys = new Map();
  for (const candidate of collections.flat()) {
    const item = normalizeHistoryTrack(candidate);
    if (!item) continue;
    const identifiers = ['id:' + item.id];
    if (item.trackUrl) identifiers.push('url:' + item.trackUrl);
    if (item.providerTrackId) identifiers.push('provider:' + item.providerTrackId);
    if (item.audioSha256) identifiers.push('hash:' + item.audioSha256);
    const position = identifiers.map(key => keys.get(key)).find(index => index !== undefined);
    if (position === undefined) {
      identifiers.forEach(key => keys.set(key, tracks.length)); tracks.push(item);
    } else {
      const previous = tracks[position];
      // A missing remote candidate never replaces an already recovered local file.
      const combined = { ...previous };
      for (const [key, value] of Object.entries(item)) if (value !== '' && value !== 0 && value !== false) combined[key] = value;
      if (previous.available && !item.available) Object.assign(combined, { trackUrl: previous.trackUrl, available: true, unavailableReason: '' });
      if (combined.available) combined.unavailableReason = '';
      tracks[position] = combined; identifiers.forEach(key => keys.set(key, position));
    }
  }
  return tracks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function readHistoryTracks(directory = historyDirectory()) {
  if (!fs.existsSync(directory)) return [];
  const signature = fs.statSync(directory).mtimeMs;
  const existing = cache.get(directory);
  if (existing && existing.signature === signature && Date.now() - existing.at < 5000) return existing.tracks.map(t => ({ ...t }));
  const tracks = [];
  for (const filename of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
    const file = path.join(directory, filename);
    if (!fs.lstatSync(file).isFile()) continue;
    try { const item = normalizeHistoryTrack(JSON.parse(fs.readFileSync(file, 'utf8'))); if (item) tracks.push(item); }
    catch (error) { throw new Error('jukebox_history_unreadable: ' + filename); }
  }
  const merged = mergeHistoryTracks(tracks);
  cache.set(directory, { signature, at: Date.now(), tracks: merged });
  return merged.map(t => ({ ...t }));
}

function rememberHistoryTracks(items, directory = historyDirectory()) {
  fs.mkdirSync(directory, { recursive: true });
  let written = 0;
  for (const candidate of items) {
    const item = normalizeHistoryTrack(candidate); if (!item) continue;
    const file = path.join(directory, hash(item.trackUrl || item.providerTrackId) + '.json');
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const merged = old ? mergeHistoryTracks([old, item])[0] : item;
    const output = JSON.stringify(merged);
    if (old && JSON.stringify(old) === output) continue;
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, output, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file); written++;
  }
  cache.delete(directory);
  return written;
}

function summarizeHistoryTrack(track) {
  const { lyrics, audioSha256, coverPrompt, coverVideoPrompt, ...summary } = track;
  return { ...summary, hasLyrics: Boolean(lyrics) };
}

function readEnhancements(directory) {
  if (!fs.existsSync(directory)) return {};
  const signature = fs.statSync(directory).mtimeMs;
  const previous = cache.get(directory);
  if (previous && previous.signature === signature && Date.now() - previous.at < 5000) return previous.items;
  const items = {};
  for (const filename of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
    try { items[filename.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8')); }
    catch { /* An incomplete enhancement must never hide a playable original. */ }
  }
  cache.set(directory, { signature, at: Date.now(), items });
  return items;
}

function applyHistoryEnhancements(tracks, directory = historyDirectory()) {
  const masters = readEnhancements(directory + '-masters');
  const titles = readEnhancements(directory + '-titles');
  const streams = readEnhancements(directory + '-streams');
  return tracks.filter(track => {
    if (!track.trackUrl || track.available === false) return false;
    const url = localAudioUrl(track.trackUrl);
    // Recovered files were probed and hashed. Hide one if its disk asset vanishes.
    if (track.audioSha256 && url.startsWith('/api/vivy/studio/assets/')) return fs.existsSync(path.join(getCanonicalRuntimeRoot(), 'files/generated/vivy', decodeURIComponent(url.split('/').pop())));
    return true;
  }).map(track => {
    const key = hash(track.trackUrl), master = masters[key], title = titles[key];
    const result = { ...track };
    if (title?.sourceTrackUrl === track.trackUrl && title.provider === 'anthropic' && typeof title.title === 'string' && title.title.trim()) {
      result.originalTitle = result.trackTitle || result.title;
      result.title = result.trackTitle = text(title.title, 120);
      result.titleBy = 'Claude';
    }
    const masterUrl = localAudioUrl(master?.trackUrl);
    if (master?.sourceTrackUrl === track.trackUrl && master.recipe === 'v11pan-v9electrolysis-blend-1.5-4-v1' && master.verified === true && masterUrl) {
      const file = path.join(getCanonicalRuntimeRoot(), 'files/generated/vivy', decodeURIComponent(masterUrl.split('/').pop()));
      if (masterUrl.startsWith('/api/vivy/studio/assets/') && fs.existsSync(file)) {
        result.originalTrackUrl = track.trackUrl;
        result.trackUrl = masterUrl;
        result.mastering = 'V11 Pan';
        result.durationSeconds = Number(master.durationSeconds) || track.durationSeconds;
        const evidence = streams[key];
        try {
          const source = validateAudioStreamIntegrity(master.sourceMetrics?.streamIntegrity || evidence?.sourceStreamIntegrity);
          const output = validateAudioStreamIntegrity(master.outputMetrics?.streamIntegrity || evidence?.outputStreamIntegrity);
          const bound = master.sourceMetrics?.streamIntegrity || (evidence.sourceTrackUrl === track.trackUrl && evidence.trackUrl === masterUrl && evidence.sourceSha256 === master.sourceSha256 && evidence.outputSha256 === master.outputSha256);
          if (bound) result.goldenThread = { relationship: 'derived-from', sourceStreamSha256: source.sha256, assetStreamSha256: output.sha256,
            sameEncodedStream: source.sha256 === output.sha256 && source.codec === output.codec, recipe: master.recipe };
        } catch { /* Missing or stale evidence is never presented as verified. */ }
      }
    }
    return result;
  });
}

module.exports = { historyDirectory, localAudioUrl, normalizeHistoryTrack, mergeHistoryTracks, readHistoryTracks, rememberHistoryTracks, summarizeHistoryTrack, applyHistoryEnhancements };
