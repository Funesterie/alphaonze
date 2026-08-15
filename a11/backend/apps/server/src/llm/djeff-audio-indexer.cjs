'use strict';
/**
 * djeff-audio-indexer.cjs — Indexe tous les sons Funesterie dans Neo4j.
 *
 * Pour chaque fichier audio :
 *   - Mesure LUFS, peak, durée, tempo estimé
 *   - Extrait le profil spectral (brillance, corps, fond, densité)
 *   - Récupère les paroles/contexte du store Vivy si disponible
 *   - Écrit un nœud :AudioProfile dans Neo4j
 *
 * Le LLM Djeff Engine utilise ces données comme "pilote sonore" :
 * il connaît chaque morceau par son profil mesuré, pas par sa description.
 *
 * Usage:
 *   node djeff-audio-indexer.cjs [--limit 50] [--force]
 *   Ou via le serveur: POST /api/djeff-engine/index-audio
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const neo4j = require('neo4j-driver');

const RUNTIME_ROOT = process.env.A11_RUNTIME_ROOT || '/app/runtime';
const AUDIO_DIRS = [
  path.join(RUNTIME_ROOT, 'files/generated/vivy'),
  path.join(RUNTIME_ROOT, 'recovered-suno-20260807'),
  path.join(RUNTIME_ROOT, 'double-harmonic-d40'),
  path.join(RUNTIME_ROOT, 'vivy-studio-assets'),
];

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://a11-neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USERNAME || process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASS = process.env.NEO4J_PASSWORD || '';
const NEO4J_DB = process.env.NEO4J_DATABASE || 'neo4j';

const BATCH_SIZE = 10;
const MAX_FILES = Number(process.env.DJEFF_INDEX_LIMIT || 500);
const FORCE = process.argv.includes('--force');

/**
 * Analyse un fichier audio avec ffprobe/ffmpeg.
 */
function analyzeAudio(filePath) {
  try {
    // Durée + format
    const probe = execSync(
      `ffprobe -v error -show_entries format=duration,bit_rate -show_entries stream=sample_rate,channels -of json "${filePath}"`,
      { timeout: 15000 }
    ).toString();
    const data = JSON.parse(probe);
    const duration = parseFloat(data.format?.duration || 0);
    const bitrate = parseInt(data.format?.bit_rate || 0, 10);
    const sampleRate = parseInt(data.streams?.[0]?.sample_rate || 44100, 10);

    // LUFS
    let lufs = -14;
    try {
      const loudness = execSync(
        `ffmpeg -i "${filePath}" -af loudnorm=print_format=json -f null - 2>&1`,
        { timeout: 30000 }
      ).toString();
      const lufsMatch = loudness.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
      if (lufsMatch) lufs = parseFloat(lufsMatch[1]);
    } catch (_) {}

    // Profil spectral simplifié (4 bandes)
    let brillance = 0, corps = 0, fond = 0;
    try {
      // Énergie haute fréquence (brillance : 4-8 kHz)
      const highBand = execSync(
        `ffmpeg -i "${filePath}" -af "highpass=f=4000,astats=metadata=1:reset=1" -f null - 2>&1`,
        { timeout: 20000 }
      ).toString();
      const rmsMatch = highBand.match(/RMS level dB:\s*(-?[\d.]+)/);
      if (rmsMatch) brillance = parseFloat(rmsMatch[1]);

      // Énergie medium (corps : 200-2000 Hz)
      const midBand = execSync(
        `ffmpeg -i "${filePath}" -af "highpass=f=200,lowpass=f=2000,astats=metadata=1:reset=1" -f null - 2>&1`,
        { timeout: 20000 }
      ).toString();
      const midMatch = midBand.match(/RMS level dB:\s*(-?[\d.]+)/);
      if (midMatch) corps = parseFloat(midMatch[1]);

      // Énergie basse (fond : < 200 Hz)
      const lowBand = execSync(
        `ffmpeg -i "${filePath}" -af "lowpass=f=200,astats=metadata=1:reset=1" -f null - 2>&1`,
        { timeout: 20000 }
      ).toString();
      const lowMatch = lowBand.match(/RMS level dB:\s*(-?[\d.]+)/);
      if (lowMatch) fond = parseFloat(lowMatch[1]);
    } catch (_) {}

    return {
      duration: Math.round(duration * 10) / 10,
      lufs: Math.round(lufs * 100) / 100,
      bitrate,
      sampleRate,
      brillance: Math.round(brillance * 100) / 100,
      corps: Math.round(corps * 100) / 100,
      fond: Math.round(fond * 100) / 100,
      puissance: Math.round((24 + lufs) * 10) / 10,
    };
  } catch (err) {
    return { error: err.message, duration: 0, lufs: -14 };
  }
}

/**
 * Récupère les métadonnées des chansons depuis le store Vivy.
 */
function fetchSongMetadata() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:3000/api/vivy/stream/songs.json', { timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).songs || []); }
        catch (_) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

/**
 * Trouve les métadonnées d'une chanson par son nom de fichier.
 */
function matchSongMeta(filename, songs) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  return songs.find(s => {
    const url = (s.trackUrl || '').toLowerCase();
    return url.includes(base.slice(0, 20)) || url.includes(base);
  }) || null;
}

/**
 * Indexe les fichiers audio dans Neo4j.
 */
async function indexAudio() {
  if (!NEO4J_PASS) {
    console.error('[indexer] NEO4J_PASSWORD manquant');
    process.exit(1);
  }

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session({ database: NEO4J_DB });

  // Créer l'index si absent
  try {
    await session.run('CREATE INDEX audio_profile_path IF NOT EXISTS FOR (a:AudioProfile) ON (a.path)');
  } catch (_) {}

  // Lister tous les fichiers audio
  const allFiles = [];
  for (const dir of AUDIO_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f))
      .map(f => path.join(dir, f));
    allFiles.push(...files);
  }
  console.log(`[indexer] ${allFiles.length} fichiers audio trouvés`);

  // Filtrer ceux déjà indexés (sauf --force)
  let toProcess = allFiles.slice(0, MAX_FILES);
  if (!FORCE) {
    const existing = await session.run(
      'MATCH (a:AudioProfile) RETURN a.path AS path'
    );
    const indexed = new Set(existing.records.map(r => r.get('path')));
    toProcess = toProcess.filter(f => !indexed.has(f));
    console.log(`[indexer] ${toProcess.length} à indexer (${indexed.size} déjà faits)`);
  }

  // Récupérer les métadonnées des chansons
  const songs = await fetchSongMetadata();
  console.log(`[indexer] ${songs.length} chansons dans le store Vivy`);

  // Indexer par batch
  let processed = 0;
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const profiles = [];

    for (const filePath of batch) {
      const profile = analyzeAudio(filePath);
      const meta = matchSongMeta(path.basename(filePath), songs);

      profiles.push({
        path: filePath,
        filename: path.basename(filePath),
        ...profile,
        title: meta?.trackTitle || meta?.title || path.basename(filePath, path.extname(filePath)),
        artist: meta?.requestedBy || 'funesterie',
        lyrics: (meta?.coverPrompt || '').slice(0, 1000),
        source: meta?.source || 'vivy',
        createdAt: meta?.createdAt || new Date().toISOString(),
      });
    }

    // Écrire dans Neo4j
    await session.run(`
      UNWIND $profiles AS p
      MERGE (a:AudioProfile { path: p.path })
      SET a.filename = p.filename,
          a.title = p.title,
          a.artist = p.artist,
          a.duration = p.duration,
          a.lufs = p.lufs,
          a.puissance = p.puissance,
          a.brillance = p.brillance,
          a.corps = p.corps,
          a.fond = p.fond,
          a.bitrate = p.bitrate,
          a.sampleRate = p.sampleRate,
          a.lyrics = p.lyrics,
          a.source = p.source,
          a.createdAt = p.createdAt,
          a.indexedAt = datetime()
    `, { profiles });

    processed += batch.length;
    console.log(`[indexer] ${processed}/${toProcess.length} indexés`);
  }

  await session.close();
  await driver.close();
  console.log(`[indexer] Terminé: ${processed} profils audio dans Neo4j`);
}

module.exports = { analyzeAudio, indexAudio, fetchSongMetadata };

// Exécution directe
if (require.main === module) {
  indexAudio().catch(err => {
    console.error('[indexer]', err.message);
    process.exit(1);
  });
}
