'use strict';
/**
 * Jukebox Drive — ScentGate-style music streaming for Funesterie
 * Serves songs from the catalog with playback, queue, and discovery.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_PATH = '/agent-bus/vivy-songs-catalog.json';
const SONGS_DIR = '/app/runtime/double-harmonic-d40';

// In-memory play queue per session
const queues = new Map();

function loadCatalog() {
  try { return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); }
  catch (e) { return { count: 0, songs: [] }; }
}

function mountJukeboxRoutes(app) {
  // List all songs (public)
  app.get('/api/jukebox/tracks', (req, res) => {
    const catalog = loadCatalog();
    const tracks = catalog.songs.map((s, i) => ({
      id: i,
      title: s.title,
      date: s.date,
      size_mb: s.size_mb,
      playUrl: `/api/jukebox/play/${encodeURIComponent(s.filename)}`,
    }));
    res.json({ count: tracks.length, tracks });
  });

  // Play a track (stream audio with proper headers)
  app.get('/api/jukebox/play/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(SONGS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Track not found' });

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/mpeg');

    if (range) {
      // Partial content for seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Queue management
  app.post('/api/jukebox/queue/add', require('express').json(), (req, res) => {
    const { sessionId = 'default', trackId } = req.body;
    if (!queues.has(sessionId)) queues.set(sessionId, []);
    const catalog = loadCatalog();
    if (trackId >= 0 && trackId < catalog.songs.length) {
      queues.get(sessionId).push(catalog.songs[trackId]);
      res.json({ ok: true, queue: queues.get(sessionId).map(s => s.title) });
    } else {
      res.status(400).json({ error: 'Invalid trackId' });
    }
  });

  app.get('/api/jukebox/queue/:sessionId', (req, res) => {
    const q = queues.get(req.params.sessionId) || [];
    res.json({ queue: q.map(s => s.title), count: q.length });
  });

  // Random pick
  app.get('/api/jukebox/random', (req, res) => {
    const catalog = loadCatalog();
    if (!catalog.songs.length) return res.json({ error: 'No tracks' });
    const pick = catalog.songs[Math.floor(Math.random() * catalog.songs.length)];
    res.json({ title: pick.title, playUrl: `/api/jukebox/play/${encodeURIComponent(pick.filename)}`, date: pick.date });
  });

  // Now playing (for Discord bot integration)
  app.get('/api/jukebox/now-playing', (req, res) => {
    const catalog = loadCatalog();
    if (!catalog.songs.length) return res.json({ playing: false });
    // Return latest track as "now playing"
    const latest = catalog.songs[0];
    res.json({ playing: true, track: latest.title, url: `/api/jukebox/play/${encodeURIComponent(latest.filename)}` });
  });

  console.log('[jukebox] Drive mounted: /api/jukebox/{tracks,play,queue,random,now-playing}');
}

module.exports = { mountJukeboxRoutes, loadCatalog };
