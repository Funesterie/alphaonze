'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const WHISPER_URL = 'http://a11-stt-whisper:9000/asr';
const OLLAMA_URL = 'http://a11-ollama:11434/api/generate';
const CATALOG_PATH = '/agent-bus/vivy-songs-catalog.json';
const SONGS_DIR = '/app/runtime/double-harmonic-d40';

// Transcribe first 30s of audio via Whisper
async function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    // Extract first 30s to temp file for faster transcription
    const tmp = '/tmp/title-extract-' + Date.now() + '.wav';
    try {
      execSync(`ffmpeg -y -i "${filePath}" -t 30 -ar 16000 -ac 1 "${tmp}" 2>/dev/null`, { timeout: 30000 });
    } catch (e) {
      return reject(new Error('FFmpeg extract failed'));
    }

    // Send to Whisper (OpenAI-compatible API)
    const boundary = '----FormBound' + Date.now();
    const fileData = fs.readFileSync(tmp);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nbase\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--${boundary}--\r\n`)
    ]);

    const opts = {
      method: 'POST',
      hostname: 'a11-stt-whisper',
      port: 9000,
      path: '/v1/audio/transcriptions',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    };

    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { fs.unlinkSync(tmp); } catch (e) {}
        try {
          const j = JSON.parse(d);
          resolve(j.text || j.transcription || d.slice(0, 500));
        } catch (e) { resolve(d.slice(0, 500)); }
      });
    });
    req.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (x) {} reject(e); });
    req.write(body);
    req.end();
  });
}

// Generate title from lyrics using Ollama
async function generateTitle(lyrics) {
  if (!lyrics || lyrics.trim().length < 10) return null;
  
  return new Promise((resolve, reject) => {
    const prompt = `Tu es un assistant qui génère des titres de chansons courts et accrocheurs. À partir de ces paroles, donne UN SEUL titre de chanson (3-5 mots max, en français, sans guillemets, sans explication):\n\nParoles: "${lyrics.slice(0, 300)}"\n\nTitre:`;
    
    const body = JSON.stringify({ model: 'qwen2.5:7b', prompt, stream: false, options: { temperature: 0.7, num_predict: 20 } });
    
    const req = http.request({
      method: 'POST', hostname: 'a11-ollama', port: 11434, path: '/api/generate',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          let title = (j.response || '').trim().split('\n')[0].trim();
          // Clean up common artifacts
          title = title.replace(/^["«]|["»]$/g, '').replace(/^titre\s*:\s*/i, '').trim();
          if (title.length > 2 && title.length < 50) resolve(title);
          else resolve(null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// Process one song: transcribe → generate title
async function titleForSong(filePath) {
  try {
    const lyrics = await transcribeAudio(filePath);
    if (!lyrics || lyrics.length < 10) return null;
    const title = await generateTitle(lyrics);
    return { title, lyrics: lyrics.slice(0, 200) };
  } catch (e) {
    return null;
  }
}

// Rebuild the full catalog with generated titles
async function rebuildCatalog() {
  const files = fs.readdirSync(SONGS_DIR)
    .filter(f => f.startsWith('v11pan_') && f.endsWith('-funesterie-d40-v10boom-v11pan.mp3'))
    .sort().reverse();

  console.log(`[title-gen] Processing ${files.length} songs...`);
  const songs = [];

  for (const filename of files) {
    const filePath = path.join(SONGS_DIR, filename);
    const stat = fs.statSync(filePath);
    
    // Try to get a good title
    let title = null;
    try {
      const result = await titleForSong(filePath);
      if (result && result.title) title = result.title;
    } catch (e) {}
    
    // Fallback: clean from filename
    if (!title) {
      let clean = filename.replace(/^v11pan_\d+_[a-f0-9]+-/, '').replace(/-funesterie-d40-v10boom-v11pan\.mp3$/, '').replace(/-/g, ' ').trim();
      if (clean.toLowerCase() === 'session principale' || clean.length < 3) {
        clean = 'Vivy ' + new Date(stat.mtime).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      }
      title = clean.slice(0, 45);
    }

    songs.push({
      title,
      filename,
      size_mb: Math.round(stat.size / 1024 / 1024 * 10) / 10,
      date: new Date(stat.mtime).toISOString().slice(0, 10),
      path: filePath,
    });
  }

  const catalog = { count: songs.length, songs, generatedAt: new Date().toISOString() };
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log(`[title-gen] Catalog saved: ${songs.length} songs`);
  return catalog;
}

// Express route to trigger rebuild or get single title
function mountTitleRoutes(app) {
  app.post('/api/mcp-bridge/songs/rebuild-titles', async (req, res) => {
    try {
      const catalog = await rebuildCatalog();
      res.json({ ok: true, count: catalog.count });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/mcp-bridge/songs/title/:filename', async (req, res) => {
    try {
      const filePath = path.join(SONGS_DIR, req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
      const result = await titleForSong(filePath);
      res.json(result || { title: null, error: 'Could not generate title' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[title-gen] Routes: /api/mcp-bridge/songs/{rebuild-titles,title/:filename}');
}

module.exports = { generateTitle, mountTitleRoutes, rebuildCatalog, titleForSong, transcribeAudio };
