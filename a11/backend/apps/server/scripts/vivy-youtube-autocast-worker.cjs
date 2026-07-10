#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DEFAULT_RUNTIME_ROOT = process.env.A11_RUNTIME_ROOT || '/app/runtime';
const DEFAULT_PUBLIC_BASE_URL = process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me';
const DEFAULT_STATE_PATH = process.env.VIVY_STREAM_STATE_PATH || path.join(DEFAULT_RUNTIME_ROOT, 'vivy-stream', 'state.json');
const DEFAULT_LEDGER_PATH = process.env.VIVY_YOUTUBE_AUTOCAST_LEDGER || path.join(DEFAULT_RUNTIME_ROOT, 'youtube-autocast', 'ledger.json');
const DEFAULT_DESIRE_PATH = process.env.VIVY_YOUTUBE_AUTOCAST_DESIRE_PATH || path.join(DEFAULT_RUNTIME_ROOT, 'youtube-autocast', 'theme-seeds.jsonl');
const DEFAULT_TOKEN_PATH = process.env.VIVY_YOUTUBE_TOKEN_FILE || path.join(DEFAULT_RUNTIME_ROOT, 'secrets', 'google', 'vivy', 'token_vivy_media.json');
const DEFAULT_RANDOM_THEMES = Object.freeze([
  'Djeff cypher nocturne, punchlines sèches, néons violets, énergie de revanche',
  'Vivy warehouse rêve, gabber oldschool, foule en transe, kick sale mais mélodique',
  'Mille Fleurs matière-source, données zen qui deviennent lumière et particules',
  'Shiryu lame de sang, pluie noire, découper la fumée des conversations',
  'Funesterie in ze space, station pirate, rap français sombre et synthwave',
  'Djeff joker élégant, chaos poli, sourire dangereux, basse lourde',
  'Vivy live dans la nuit néon, voix claire, club vide, caméra lente',
  'NOSSEN dédommagement, réparer les bugs, transformer la fatigue en banger',
]);

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function intEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function numEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function cleanText(value = '', max = 1000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadLedger(file = DEFAULT_LEDGER_PATH) {
  const existing = readJson(file, null);
  if (existing && typeof existing === 'object') {
    existing.startedAt ||= new Date().toISOString();
    existing.songs ||= {};
    existing.desires ||= [];
    return existing;
  }
  return {
    schema: 1,
    startedAt: new Date().toISOString(),
    songs: {},
    desires: [],
  };
}

function stableSongKey(song = {}) {
  return cleanText(song.id || song.trackId || song.trackUrl || song.title || song.createdAt, 300)
    || crypto.createHash('sha1').update(JSON.stringify(song)).digest('hex').slice(0, 16);
}

function absolutizeUrl(url = '', base = DEFAULT_PUBLIC_BASE_URL) {
  const value = cleanText(url, 1600);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${base.replace(/\/+$/, '')}${value}`;
  return value;
}

function basenameFromTrackUrl(trackUrl = '') {
  const value = cleanText(trackUrl, 1600);
  if (!value) return '';
  try {
    const parsed = new URL(absolutizeUrl(value));
    return path.basename(parsed.pathname);
  } catch {
    return path.basename(value.split('?')[0]);
  }
}

function resolveLocalTrackPath(song = {}, runtimeRoot = DEFAULT_RUNTIME_ROOT) {
  const explicit = cleanText(song.localTrackPath || song.filePath || '', 2000);
  if (explicit && fs.existsSync(explicit)) return explicit;
  const name = basenameFromTrackUrl(song.trackUrl || song.sharePath || '');
  if (!name) return '';
  const candidates = [
    path.join(runtimeRoot, 'files', 'generated', 'vivy', name),
    path.join(runtimeRoot, 'files', 'uploads', name),
    path.join(runtimeRoot, 'files', name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function hasDirtyRhymeLabels(lyrics = '') {
  return String(lyrics || '')
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^\[[^\]]+\]$/.test(trimmed)) return false;
      return /\s*(?:[,;:]\s*[A-H]|\([A-H]\)|\[[A-H]\])\s*$/i.test(trimmed);
    });
}

function hasFrenchOnlyLeak(lyrics = '') {
  return /(^|\n)\s*yeah\b/i.test(lyrics)
    || /\b(?:payload|hook|complete)\b/i.test(lyrics);
}

function hasInternalPromptLeak(lyrics = '') {
  return /\b(?:prompt|brief\s+suno|suno_style|clean_lyrics|provider\s+pack|direction\s+freestyle\s+rap\s+obligatoire|r[èe]gles?\s+priv[ée]es?|distribution\s+vocale|casting\s+vocal)\b/i
    .test(lyrics);
}

function qualityReasons(song = {}, opts = {}) {
  const reasons = [];
  const duration = Number(song.durationSeconds || 0);
  const lyrics = String(song.lyrics || '');
  if (!cleanText(song.trackUrl || song.shareVideoUrl || '', 1600)) reasons.push('missing_media_url');
  if (duration && duration < opts.minSeconds) reasons.push(`duration_${Math.round(duration)}s_below_${opts.minSeconds}s`);
  if (song.shortMix === true && !opts.allowShort) reasons.push('short_mix');
  if (/version courte/i.test(cleanText(song.qualityNote || '', 200)) && !opts.allowShort) reasons.push('quality_note_short');
  if (hasDirtyRhymeLabels(lyrics)) reasons.push('literal_rhyme_labels');
  if (hasFrenchOnlyLeak(lyrics)) reasons.push('english_or_prompt_tokens_in_lyrics');
  if (hasInternalPromptLeak(lyrics)) reasons.push('internal_prompt_leakage');
  return reasons;
}

function pickNextSong(state = {}, ledger = {}, opts = {}) {
  const songs = Array.isArray(state.songs) ? state.songs : [];
  const startedAtMs = Date.parse(ledger.startedAt || '') || 0;
  for (const song of songs.slice().sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))) {
    const key = stableSongKey(song);
    const previous = ledger.songs[key];
    if (previous?.status === 'uploaded') continue;
    if (!opts.backfill && Date.parse(song.createdAt || '') < startedAtMs) {
      ledger.songs[key] ||= {
        status: 'ignored_before_autocast_start',
        title: cleanText(song.title || song.trackTitle, 140),
        createdAt: song.createdAt || '',
        at: new Date().toISOString(),
      };
      continue;
    }
    const reasons = qualityReasons(song, opts);
    if (reasons.length) {
      ledger.songs[key] = {
        status: 'skipped_quality_gate',
        title: cleanText(song.title || song.trackTitle, 140),
        createdAt: song.createdAt || '',
        reasons,
        at: new Date().toISOString(),
      };
      continue;
    }
    return { key, song };
  }
  return null;
}

function parseRandomThemes(value = '') {
  const custom = String(value || '').split(/\r?\n|[|;]/g).map((entry) => cleanText(entry, 240)).filter(Boolean);
  return custom.length ? custom : [...DEFAULT_RANDOM_THEMES];
}

function pickDeterministicTheme(themes = [], seed = '') {
  const safeThemes = themes.length ? themes : [...DEFAULT_RANDOM_THEMES];
  const hash = crypto.createHash('sha1').update(String(seed || new Date().toISOString())).digest();
  const index = hash.readUInt32BE(0) % safeThemes.length;
  return safeThemes[index];
}

function buildPostingDesire(opts = {}, ledger = {}) {
  const now = new Date(opts.now || Date.now());
  const bucketMs = Math.max(60 * 1000, Number(opts.desireCooldownMs || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
  const bucket = Math.floor(now.getTime() / bucketMs);
  const themes = parseRandomThemes(opts.randomThemes);
  const theme = pickDeterministicTheme(themes, `${bucket}:${ledger.startedAt || ''}:${Object.keys(ledger.songs || {}).length}`);
  const digest = crypto.createHash('sha1').update(`${theme}:${bucket}`).digest('hex').slice(0, 12);
  return {
    id: `desire_${digest}`,
    at: now.toISOString(),
    status: 'seed_only',
    theme,
    titleHint: cleanText(theme.split(',')[0] || theme, 96),
    prompt: cleanText(`!nossen ${theme}. Fais une chanson française originale, propre, forte, sans réciter les réglages internes.`, 500),
    publicationIntent: 'youtube_autocast_seed_when_funesterie_wants_to_post',
    safeMode: true,
    paidGeneration: false,
  };
}

function shouldRecordPostingDesire(ledger = {}, opts = {}) {
  if (!opts.desireEnabled) return false;
  const nowMs = Date.parse(opts.now || new Date().toISOString()) || Date.now();
  const cooldownMs = Math.max(60 * 1000, Number(opts.desireCooldownMs || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
  const last = Array.isArray(ledger.desires) ? ledger.desires[ledger.desires.length - 1] : null;
  const lastMs = Date.parse(last?.at || '') || 0;
  if (lastMs && nowMs - lastMs < cooldownMs) return false;
  const chance = Math.max(0, Math.min(1, Number(opts.desireChance ?? 1)));
  if (chance >= 1) return true;
  const rollSeed = crypto.createHash('sha1').update(`${Math.floor(nowMs / cooldownMs)}:${ledger.startedAt || ''}`).digest();
  const roll = rollSeed.readUInt32BE(4) / 0xffffffff;
  return roll <= chance;
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function maybeRecordPostingDesire(ledger = {}, opts = {}) {
  if (!shouldRecordPostingDesire(ledger, opts)) return null;
  const desire = buildPostingDesire(opts, ledger);
  ledger.desires ||= [];
  if (ledger.desires.some((entry) => entry.id === desire.id)) return null;
  ledger.desires.push(desire);
  if (opts.desirePath) appendJsonl(opts.desirePath, desire);
  return desire;
}

async function downloadToFile(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout?.(120000) });
  if (!response.ok) throw new Error(`download_failed_${response.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, buffer);
  return file;
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`ffmpeg_failed: ${String(result.stderr || result.stdout || '').slice(0, 800)}`);
  }
}

async function buildVideoForSong(song = {}, opts = {}) {
  const workRoot = opts.workRoot;
  fs.mkdirSync(workRoot, { recursive: true });
  const key = stableSongKey(song).replace(/[^a-z0-9_-]/gi, '_');
  const audioPath = resolveLocalTrackPath(song, opts.runtimeRoot);
  if (!audioPath) throw new Error('local_audio_not_found');
  const output = path.join(workRoot, `${key}.mp4`);
  const coverUrl = absolutizeUrl(song.coverImageUrl || '', opts.publicBaseUrl);
  if (coverUrl) {
    const coverPath = path.join(workRoot, `${key}-cover.jpg`);
    await downloadToFile(coverUrl, coverPath);
    runFfmpeg([
      '-y',
      '-loop', '1',
      '-i', coverPath,
      '-i', audioPath,
      '-shortest',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p',
      '-r', '24',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ]);
  } else {
    runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x09040f:s=1280x720:r=24',
      '-i', audioPath,
      '-shortest',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ]);
  }
  return output;
}

function loadYoutubeCredentials(tokenFile = DEFAULT_TOKEN_PATH) {
  const token = readJson(tokenFile, null);
  if (!token?.refresh_token || !token?.client_id || !token?.client_secret) {
    throw new Error('youtube_token_missing_or_incomplete');
  }
  return token;
}

async function refreshYoutubeAccessToken(token) {
  const body = new URLSearchParams({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch(token.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`youtube_refresh_failed_${response.status}`);
  }
  return payload.access_token;
}

function buildYoutubeMetadata(song = {}, opts = {}) {
  const title = cleanText(song.title || song.trackTitle || 'Vivy Live', 100);
  const trackUrl = absolutizeUrl(song.trackUrl || '', opts.publicBaseUrl);
  const description = [
    `${title}`,
    '',
    'Vivy Live — Funesterie / NOSSEN autocast.',
    song.requestedBy ? `Demandé par : ${cleanText(song.requestedBy, 80)}` : '',
    song.durationSeconds ? `Durée : ${Math.round(Number(song.durationSeconds))}s` : '',
    trackUrl ? `Archive audio : ${trackUrl}` : '',
    '',
    'Chaîne : Djeff / Vivy / Funesterie',
  ].filter(Boolean).join('\n').slice(0, 5000);
  const tags = [
    'Funesterie',
    'Vivy',
    'Djeff',
    'NOSSEN',
    'rap français',
    'musique IA',
    'Vivy Live',
  ];
  return {
    snippet: {
      title,
      description,
      tags,
      categoryId: '10',
    },
    status: {
      privacyStatus: opts.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };
}

async function uploadYoutubeVideo(file, song = {}, opts = {}) {
  const token = loadYoutubeCredentials(opts.tokenFile);
  const accessToken = await refreshYoutubeAccessToken(token);
  const metadata = buildYoutubeMetadata(song, opts);
  const size = fs.statSync(file).size;
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'video/mp4',
      'x-upload-content-length': String(size),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw new Error(`youtube_upload_init_failed_${init.status}`);
  const location = init.headers.get('location');
  if (!location) throw new Error('youtube_upload_location_missing');
  const upload = await fetch(location, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'video/mp4',
      'content-length': String(size),
    },
    body: fs.readFileSync(file),
  });
  const payload = await upload.json().catch(() => ({}));
  if (!upload.ok || !payload.id) throw new Error(`youtube_upload_failed_${upload.status}`);
  return {
    videoId: payload.id,
    url: `https://www.youtube.com/watch?v=${payload.id}`,
    privacyStatus: opts.privacyStatus,
  };
}

async function runOnce(opts = {}) {
  const ledger = loadLedger(opts.ledgerPath);
  const state = readJson(opts.statePath, {});
  const selected = pickNextSong(state, ledger, opts);
  if (!selected) {
    const desire = maybeRecordPostingDesire(ledger, opts);
    writeJson(opts.ledgerPath, ledger);
    if (desire) {
      console.log('[youtube-autocast] no eligible song; desire seeded title=%s paidGeneration=false', desire.titleHint);
      return { ok: true, uploaded: false, desire };
    }
    console.log('[youtube-autocast] no eligible song');
    return { ok: true, uploaded: false };
  }
  const { key, song } = selected;
  const title = cleanText(song.title || song.trackTitle || key, 160);
  if (opts.dryRun) {
    ledger.songs[key] = {
      status: 'dry_run_ready',
      title,
      createdAt: song.createdAt || '',
      at: new Date().toISOString(),
    };
    writeJson(opts.ledgerPath, ledger);
    console.log('[youtube-autocast] dry-run ready title=%s', title);
    return { ok: true, uploaded: false, dryRun: true, title };
  }
  const videoFile = await buildVideoForSong(song, opts);
  const upload = await uploadYoutubeVideo(videoFile, song, opts);
  ledger.songs[key] = {
    status: 'uploaded',
    title,
    createdAt: song.createdAt || '',
    videoId: upload.videoId,
    url: upload.url,
    privacyStatus: upload.privacyStatus,
    at: new Date().toISOString(),
  };
  writeJson(opts.ledgerPath, ledger);
  console.log('[youtube-autocast] uploaded title=%s url=%s privacy=%s', title, upload.url, upload.privacyStatus);
  return { ok: true, uploaded: true, ...upload };
}

function buildOptions() {
  const args = new Set(process.argv.slice(2));
  return {
    loop: args.has('--loop'),
    once: args.has('--once') || !args.has('--loop'),
    enabled: boolEnv('VIVY_YOUTUBE_AUTOCAST_ENABLED', false) || args.has('--force'),
    dryRun: boolEnv('VIVY_YOUTUBE_AUTOCAST_DRY_RUN', false) || args.has('--dry-run'),
    backfill: boolEnv('VIVY_YOUTUBE_AUTOCAST_BACKFILL', false) || args.has('--backfill'),
    allowShort: boolEnv('VIVY_YOUTUBE_AUTOCAST_ALLOW_SHORT', false) || args.has('--allow-short'),
    minSeconds: intEnv('VIVY_YOUTUBE_AUTOCAST_MIN_SECONDS', 120, 30, 3600),
    intervalMs: intEnv('VIVY_YOUTUBE_AUTOCAST_INTERVAL_MS', 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    desireEnabled: boolEnv('VIVY_YOUTUBE_AUTOCAST_DESIRE_ENABLED', false),
    desireChance: numEnv('VIVY_YOUTUBE_AUTOCAST_DESIRE_CHANCE', 1, 0, 1),
    desireCooldownMs: intEnv('VIVY_YOUTUBE_AUTOCAST_DESIRE_COOLDOWN_MS', 6 * 60 * 60 * 1000, 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    randomThemes: process.env.VIVY_YOUTUBE_AUTOCAST_RANDOM_THEMES || '',
    desirePath: process.env.VIVY_YOUTUBE_AUTOCAST_DESIRE_PATH || DEFAULT_DESIRE_PATH,
    statePath: process.env.VIVY_STREAM_STATE_PATH || DEFAULT_STATE_PATH,
    runtimeRoot: process.env.A11_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT,
    publicBaseUrl: process.env.VIVY_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
    ledgerPath: process.env.VIVY_YOUTUBE_AUTOCAST_LEDGER || DEFAULT_LEDGER_PATH,
    tokenFile: process.env.VIVY_YOUTUBE_TOKEN_FILE || DEFAULT_TOKEN_PATH,
    workRoot: process.env.VIVY_YOUTUBE_AUTOCAST_WORK_DIR || path.join(DEFAULT_RUNTIME_ROOT, 'youtube-autocast', 'work'),
    privacyStatus: cleanText(process.env.VIVY_YOUTUBE_AUTOCAST_PRIVACY || 'unlisted', 20).toLowerCase().replace(/[^a-z]/g, '') || 'unlisted',
  };
}

async function main() {
  const opts = buildOptions();
  if (!['private', 'unlisted', 'public'].includes(opts.privacyStatus)) {
    throw new Error('invalid_youtube_privacy_status');
  }
  if (opts.privacyStatus === 'public' && !boolEnv('VIVY_YOUTUBE_AUTOCAST_CONFIRM_PUBLIC', false)) {
    throw new Error('public_autocast_requires_VIVY_YOUTUBE_AUTOCAST_CONFIRM_PUBLIC');
  }
  if (!opts.enabled) {
    console.log('[youtube-autocast] disabled: set VIVY_YOUTUBE_AUTOCAST_ENABLED=1');
    return;
  }
  if (opts.loop) {
    console.log('[youtube-autocast] loop enabled privacy=%s minSeconds=%s allowShort=%s dryRun=%s', opts.privacyStatus, opts.minSeconds, opts.allowShort, opts.dryRun);
    for (;;) {
      try {
        await runOnce(opts);
      } catch (error) {
        console.warn('[youtube-autocast] error=%s', cleanText(error?.message || error, 300));
      }
      await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
    }
  }
  await runOnce(opts);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[youtube-autocast] fatal=%s', cleanText(error?.message || error, 300));
    process.exitCode = 1;
  });
}

module.exports = {
  qualityReasons,
  pickNextSong,
  buildYoutubeMetadata,
  buildPostingDesire,
  maybeRecordPostingDesire,
  parseRandomThemes,
  stableSongKey,
};
