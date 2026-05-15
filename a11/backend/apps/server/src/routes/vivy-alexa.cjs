'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TITLE = 'Vivy demo';
const DEFAULT_ARTIST = 'Funesterie';

function env(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isAuthorized(req) {
  const expected = env('VIVY_ALEXA_TOKEN');
  if (!expected) return true;
  return getBearerToken(req) === expected;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadManifestTracks(runtimeRoot) {
  const explicitManifest = env('VIVY_SONG_MANIFEST');
  const manifestPath = explicitManifest || path.join(runtimeRoot || process.cwd(), 'music', 'vivy-songs.json');

  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const parsed = readJsonFile(manifestPath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.tracks)) return parsed.tracks;
  return [];
}

function loadEnvTrack() {
  const audioUrl = env('VIVY_ALEXA_TRACK_URL');
  if (!audioUrl) return null;

  return {
    title: env('VIVY_ALEXA_TRACK_TITLE', DEFAULT_TITLE),
    artist: env('VIVY_ALEXA_TRACK_ARTIST', DEFAULT_ARTIST),
    audioUrl,
    soundcloudUrl: env('VIVY_ALEXA_SOUNDCLOUD_URL') || undefined,
    source: env('VIVY_ALEXA_TRACK_SOURCE', 'env'),
    enabled: true,
  };
}

function normalizeTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const audioUrl = String(track.audioUrl || track.audio_url || track.url || '').trim();
  if (!audioUrl || !isHttpsUrl(audioUrl)) return null;

  return {
    title: String(track.title || DEFAULT_TITLE),
    artist: String(track.artist || DEFAULT_ARTIST),
    audioUrl,
    durationMs: Number(track.durationMs || track.duration_ms || 0) || undefined,
    artworkUrl: track.artworkUrl || track.artwork_url || undefined,
    soundcloudUrl: track.soundcloudUrl || track.soundcloud_url || undefined,
    source: track.source || 'manifest',
    license: track.license || undefined,
    audioFormat: track.audioFormat || track.audio_format || undefined,
    tags: Array.isArray(track.tags) ? track.tags.map(String) : [],
    enabled: track.enabled !== false,
  };
}

function pickTrack(tracks, mood) {
  const normalized = tracks
    .map(normalizeTrack)
    .filter((track) => track && track.enabled);

  if (!normalized.length) return null;
  const cleanMood = String(mood || '').trim().toLowerCase();
  if (!cleanMood) return normalized[0];

  return normalized.find((track) => track.tags.some((tag) => tag.toLowerCase() === cleanMood)) || normalized[0];
}

function createVivyAlexaRouter({ runtimeRoot } = {}) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    const envTrack = loadEnvTrack();
    let manifestTrackCount = 0;
    try {
      manifestTrackCount = loadManifestTracks(runtimeRoot).length;
    } catch {}

    return res.json({
      ok: true,
      service: 'vivy-alexa',
      authRequired: Boolean(env('VIVY_ALEXA_TOKEN')),
      envTrackConfigured: Boolean(envTrack),
      manifestTrackCount,
      accepts: ['mp3', 'aac', 'hls'],
      requiresHttpsAudio: true,
    });
  });

  router.post('/song', express.json({ limit: '64kb' }), (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'vivy_alexa_unauthorized' });
    }

    const mood = req.body?.mood;
    let tracks = [];

    const envTrack = loadEnvTrack();
    if (envTrack) tracks.push(envTrack);

    try {
      tracks = tracks.concat(loadManifestTracks(runtimeRoot));
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'vivy_manifest_invalid',
        message: error.message,
      });
    }

    const track = pickTrack(tracks, mood);
    if (!track) {
      return res.status(503).json({
        ok: false,
        error: 'vivy_no_authorized_track',
        hint: 'Set VIVY_ALEXA_TRACK_URL or create runtime/music/vivy-songs.json with HTTPS MP3/AAC/HLS tracks.',
      });
    }

    return res.json({
      ok: true,
      title: track.title,
      artist: track.artist,
      audioUrl: track.audioUrl,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl,
      soundcloudUrl: track.soundcloudUrl,
      source: track.source,
      license: track.license,
      audioFormat: track.audioFormat,
    });
  });

  return router;
}

module.exports = {
  createVivyAlexaRouter,
  pickTrack,
  normalizeTrack,
  isHttpsUrl,
};
