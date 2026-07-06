const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { clearUserEpisodes } = require('../../lib/episodic-memory.cjs');
const {
  createVivyStreamNossenRunner,
  extractTwitchMusicProviderDirective,
} = require('../vivy/twitch-nossen-runner.cjs');
const { estimateTwitchFullClipCost } = require('../vivy/twitch-clip-director.cjs');
const {
  loadWardrobe,
  offerWardrobeGift,
  recordWardrobeDecision,
} = require('../vivy/wardrobe.cjs');
const {
  buildAndStoreSocialPromptContext,
  formatSocialContextForPrompt,
} = require('../social/social-autoprompt.cjs');
const { getEmergencyMediaAssetPath } = require('../media/emergency-media.cjs');

const STREAM_SCHEMA = 'funesterie.vivy.stream.v1';
const MAX_RECENT_MESSAGES = 48;
const MAX_SUGGESTIONS = 24;
const MAX_PENDING_SUGGESTIONS = 24;
const MAX_STARS = 120;
const MAX_JUKEBOX_TRACKS = 80;
const MAX_LIVE_SONGS = 120;
const MAX_STREAM_MESSAGE_CHARS = 2200;
const MAX_STREAM_SUGGESTION_CHARS = 2000;
const DEFAULT_ROUND_MS = 90 * 1000;
const DEFAULT_IDLE_JUKEBOX_DELAY_MS = 12 * 1000;
const WINNER_REVEAL_MS = 4 * 1000;
const PRESENTATION_MS = 4 * 1000;
const DEFAULT_TRACK_SECONDS = 4 * 60;
const RATING_MS = 30 * 1000;
const LIVE_PHASES = new Set([
  'idle', 'listening', 'interlude', 'voting', 'winner', 'composing', 'presenting', 'playing', 'rating', 'error',
]);
const PRODUCTION_STAGES = ['analysis', 'lyrics', 'composition', 'mix'];

const STOP_WORDS = new Set([
  'avec', 'alors', 'avoir', 'cette', 'dans', 'des', 'donc', 'elle', 'faire', 'fais',
  'fait', 'pour', 'que', 'qui', 'sur', 'une', 'les', 'pas', 'plus', 'mais', 'comme',
  'chanson', 'musique', 'nossen', 'vivy', 'theme', 'thème', 'song', 'vote', 'etoile',
  'étoile', 'stars', 'star', 'style', 'magique', 'classique', 'generique', 'générique',
  'ambiance', 'titre', 'titres', 'voix',
]);

function cleanText(value = '', max = 2000) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function resolveVivySocialContextUserId(env = process.env) {
  return cleanText(
    env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || env.SOCIAL_CONTEXT_USER_ID
    || '',
    160
  );
}

function cleanOneLine(value = '', fallback = '', max = 200) {
  const cleaned = cleanText(value, max);
  return cleaned || fallback;
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absolutizePublicUrl(value = '', baseUrl = 'https://vivy.funesterie.me') {
  const raw = cleanOneLine(value, '', 1200);
  if (!raw) return '';
  try {
    return new URL(raw, cleanOneLine(baseUrl, 'https://vivy.funesterie.me', 240)).toString();
  } catch {
    return raw;
  }
}

function inferMediaContentType(url = '', fallback = 'application/octet-stream') {
  const pathname = (() => {
    try {
      return new URL(url, 'https://vivy.local').pathname;
    } catch {
      return String(url || '');
    }
  })().toLowerCase();
  if (pathname.endsWith('.mp3')) return 'audio/mpeg';
  if (pathname.endsWith('.wav')) return 'audio/wav';
  if (pathname.endsWith('.mp4')) return 'video/mp4';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
}

function safeDownloadFilename(url = '', kind = 'media') {
  let base = `${cleanOneLine(kind, 'media', 40)}.bin`;
  try {
    const parsed = new URL(url, 'https://vivy.local');
    base = path.basename(decodeURIComponent(parsed.pathname)) || base;
  } catch {}
  return base
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
    || `${cleanOneLine(kind, 'media', 40)}.bin`;
}

function buildStreamDownloadPath(url = '', kind = 'media') {
  const raw = cleanOneLine(url, '', 1600);
  if (!raw) return '';
  const params = new URLSearchParams({ url: raw, kind: cleanOneLine(kind, 'media', 40) });
  return `/api/vivy/stream/download?${params.toString()}`;
}

function isAllowedVivyStreamDownloadUrl(rawUrl = '', req = null, publicBaseUrl = process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me') {
  const raw = cleanOneLine(rawUrl, '', 1600);
  if (!raw) return false;
  const origin = req
    ? `${req.protocol || 'http'}://${req.get?.('host') || '127.0.0.1:3000'}`
    : cleanOneLine(publicBaseUrl, 'https://vivy.funesterie.me', 240);
  let parsed;
  try {
    parsed = new URL(raw, origin);
  } catch {
    return false;
  }
  const sameHost = req && parsed.host === req.get?.('host');
  const publicHost = (() => {
    try {
      return parsed.host === new URL(publicBaseUrl).host;
    } catch {
      return false;
    }
  })();
  if ((sameHost || publicHost) && /^\/api\/vivy\/studio\/assets\/[^/?#]+$/i.test(parsed.pathname)) return true;
  if ((sameHost || publicHost) && /^\/api\/double-harmonic\/out\/[^/?#]+$/i.test(parsed.pathname)) return true;
  if (parsed.hostname === 'files.funesterie.me') {
    return /^\/users\/(?:vivy-twitch-live|image-tool)\//i.test(parsed.pathname)
      || /^\/public\/vivy\//i.test(parsed.pathname);
  }
  return false;
}

function resolveRoundMs(value = process.env.VIVY_STREAM_VOTE_MS || process.env.VIVY_STREAM_ROUND_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ROUND_MS;
  return Math.max(10_000, Math.min(10 * 60 * 1000, Math.floor(parsed)));
}

function resolveIdleJukeboxDelayMs(value = process.env.VIVY_STREAM_IDLE_JUKEBOX_DELAY_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_JUKEBOX_DELAY_MS;
  return Math.max(0, Math.min(10 * 60 * 1000, Math.floor(parsed)));
}

function foldForLookup(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function createRound(id = createShortId('round')) {
  const startedAt = Date.now();
  return {
    id,
    status: 'open',
    startedAt: new Date(startedAt).toISOString(),
    endsAt: null,
    suggestions: [],
    voters: {},
    winningSuggestionId: null,
  };
}

function createProductionState() {
  return {
    startedAt: null,
    updatedAt: null,
    stages: {
      analysis: { status: 'pending', progress: 0 },
      lyrics: { status: 'pending', progress: 0 },
      composition: { status: 'pending', progress: 0 },
      mix: { status: 'pending', progress: 0 },
    },
  };
}

function createInitialState() {
  return {
    schema: STREAM_SCHEMA,
    updatedAt: nowIso(),
    current: {
      title: 'Vivy Live',
      phase: 'idle',
      trackUrl: '',
      trackTitle: '',
      requestedBy: '',
      phaseStartedAt: null,
      phaseEndsAt: null,
      playbackStartedAt: null,
      durationSeconds: 0,
      trackId: '',
      sharePath: '',
      coverImageUrl: '',
      coverPrompt: '',
      coverVideoUrl: '',
      coverVideoPrompt: '',
      message: 'En attente du chat Twitch.',
    },
    round: createRound(),
    production: createProductionState(),
    jukebox: {
      tracks: [],
      lastTrackId: '',
      lastScanAt: null,
    },
    songs: [],
    pendingSuggestions: [],
    recentMessages: [],
    stars: [],
    twitch: {
      online: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
      lastResetAt: null,
      lastResetReason: '',
    },
    learning: {
      totalStars: 0,
      averageStars: 0,
      keywordScores: {},
      likedTerms: [],
    },
    stats: {
      messages: 0,
      suggestions: 0,
      votes: 0,
      stars: 0,
    },
  };
}

function createShortId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function createTrackId(trackUrl = '') {
  return `track-${crypto.createHash('sha1').update(String(trackUrl || '')).digest('hex').slice(0, 12)}`;
}

function slugifyTitle(value = '', fallback = 'vivy-live') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return slug || fallback;
}

function cleanTrackTitle(value = '', fallback = 'Vivy Live') {
  return cleanOneLine(value, fallback, 160);
}

function buildSongSharePath(track = {}) {
  const title = track.trackTitle || track.title || 'vivy-live';
  const id = cleanOneLine(track.id || createTrackId(track.trackUrl), createTrackId(track.trackUrl), 80);
  const suffix = String(id).replace(/^track-/, '').slice(0, 8) || crypto.randomBytes(4).toString('hex');
  return `/api/vivy/stream/s/${slugifyTitle(title)}-${suffix}`;
}

function isProviderOnlyTrackUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw, 'https://vivy.local');
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'musicfile.removeai.ai';
  } catch {
    return /^https:\/\/musicfile\.removeai\.ai\//i.test(raw);
  }
}

function cleanProviderOnlyCurrentTrack(current = {}) {
  const cleaned = { ...current };
  if (!isProviderOnlyTrackUrl(cleaned.trackUrl)) return cleaned;
  cleaned.trackUrl = '';
  cleaned.trackId = '';
  cleaned.sharePath = '';
  cleaned.durationSeconds = 0;
  cleaned.playbackStartedAt = null;
  if (['interlude', 'presenting', 'playing', 'rating'].includes(cleaned.phase)) {
    cleaned.phase = 'idle';
    cleaned.message = 'Piste provider brute ignorée: Vivy attend une copie locale.';
  }
  return cleaned;
}

function normalizeJukeboxTrack(input = {}) {
  const trackUrl = cleanOneLine(input.trackUrl || input.audioUrl || input.url, '', 1200);
  if (!trackUrl || isProviderOnlyTrackUrl(trackUrl)) return null;
  const rawDuration = Number(input.durationSeconds || input.duration || 0) || 0;
  const durationSeconds = rawDuration > 0 ? Math.max(1, Math.min(3600, rawDuration)) : 0;
  const track = {
    id: cleanOneLine(input.id, createTrackId(trackUrl), 80),
    title: cleanTrackTitle(input.title || input.trackTitle, 'Archive Vivy Live'),
    trackTitle: cleanTrackTitle(input.trackTitle || input.title, 'Archive Vivy Live'),
    trackUrl,
    requestedBy: cleanOneLine(input.requestedBy || input.author, '', 80),
    durationSeconds,
    source: cleanOneLine(input.source, 'twitch-live', 80),
    createdAt: input.createdAt || nowIso(),
    starCount: Math.max(0, Number(input.starCount || 0) || 0),
    starAverage: Math.max(0, Math.min(5, Number(input.starAverage || 0) || 0)),
    coverImageUrl: cleanOneLine(
      input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url,
      '',
      1200
    ),
    coverPrompt: cleanOneLine(input.coverPrompt || input.imagePrompt || input.image_prompt, '', 2000),
    coverVideoUrl: cleanOneLine(
      input.coverVideoUrl || input.videoUrl || input.video_url || input.clipUrl || input.clip_url,
      '',
      1200
    ),
    coverVideoPrompt: cleanOneLine(input.coverVideoPrompt || input.videoPrompt || input.video_prompt, '', 2600),
    shareVideoUrl: cleanOneLine(input.shareVideoUrl || input.share_video_url, '', 1200),
    qualityNote: cleanOneLine(input.qualityNote || input.quality_note || '', '', 140),
    shortMix: input.shortMix === true || input.short_mix === true,
    lyrics: String(input.lyrics || '').replace(/\r\n/g, '\n').trim().slice(0, 16000),
  };
  track.sharePath = cleanOneLine(input.sharePath, buildSongSharePath(track), 240);
  return track;
}

function inferJukeboxTitleFromFilename(filename = '') {
  const base = path.basename(String(filename || ''), path.extname(String(filename || '')));
  const slug = base
    .replace(/^vivy-music-suno-[a-f0-9]{8,}$/i, '')
    .replace(/^vivy-music-/i, '')
    .replace(/-[a-f0-9]{8,}$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!slug) return 'Archive Vivy Live';
  return slug.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 120);
}

function probeLocalAudioDurationSeconds(filePath = '') {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const stdout = execFileSync(
      String(process.env.FFPROBE_BIN || 'ffprobe').trim() || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const duration = Number(String(stdout || '').trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function discoverVivyJukeboxTracksFromAssets() {
  const probePath = getEmergencyMediaAssetPath('vivy-music-probe.mp3');
  const dir = probePath ? path.dirname(probePath) : '';
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^vivy-music-.+\.mp3$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        let stats = null;
        try { stats = fs.statSync(filePath); } catch { return null; }
        if (!stats || stats.size < 1024) return null;
        const trackUrl = `/api/vivy/studio/assets/${encodeURIComponent(entry.name)}`;
        return normalizeJukeboxTrack({
          id: createTrackId(trackUrl),
          title: inferJukeboxTitleFromFilename(entry.name),
          trackTitle: inferJukeboxTitleFromFilename(entry.name),
          trackUrl,
          durationSeconds: 0,
          requestedBy: 'Vivy Live',
          source: 'vivy-asset-archive',
          createdAt: stats.mtime.toISOString(),
          filePath,
        });
      })
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, MAX_JUKEBOX_TRACKS);
  } catch {
    return [];
  }
}

function normalizeSuggestionId(value = '') {
  const raw = cleanOneLine(value, '', 24).toUpperCase();
  if (!raw) return '';
  if (/^\d{1,3}$/.test(raw)) return `S${raw}`;
  return raw.replace(/^#/, '');
}

function extractSuggestion(message = '') {
  const raw = cleanText(message, MAX_STREAM_MESSAGE_CHARS);
  const match = raw.match(/^!(?:vivy|nossen|song|chanson|theme|th[eè]me|idee|idée)\s+(.{4,})$/i);
  if (!match) return '';
  return cleanText(match[1], MAX_STREAM_SUGGESTION_CHARS);
}

function extractSuggestionPayload(message = '') {
  const suggestion = extractSuggestion(message);
  if (!suggestion) return { suggestion: '', musicProvider: '' };
  const directive = extractTwitchMusicProviderDirective(suggestion);
  return {
    suggestion: directive.text || suggestion,
    musicProvider: cleanOneLine(directive.provider, '', 40),
  };
}

function extractVote(message = '') {
  const raw = cleanText(message, 120);
  const match = raw.match(/^!(?:vote|choix)\s+#?([a-z0-9_-]{1,16})\b/i);
  if (!match) return '';
  return normalizeSuggestionId(match[1]);
}

function extractStarRating(message = '') {
  const raw = cleanText(message, 200);
  const explicit = raw.match(/^!(?:etoiles?|étoiles?|stars?|note)\s+([1-5])(?:\s+#?([a-z0-9_-]{1,16}))?/i)
    || raw.match(/\b([1-5])\s*\/\s*5\b/);
  if (explicit) {
    return {
      rating: Math.max(1, Math.min(5, Number(explicit[1]))),
      targetId: normalizeSuggestionId(explicit[2] || ''),
    };
  }
  const starCount = (raw.match(/[⭐★🌟]/gu) || []).length;
  if (!starCount) return null;
  return {
    rating: Math.max(1, Math.min(5, starCount)),
    targetId: '',
  };
}

function parseVivyStreamChatMessage(input = {}) {
  const message = cleanText(input.message || input.text || input.content, MAX_STREAM_MESSAGE_CHARS);
  const author = cleanOneLine(input.username || input.user || input.displayName || input.author, 'anonymous', 80);
  const source = cleanOneLine(input.source || 'twitch', 'twitch', 40);
  const suggestionPayload = extractSuggestionPayload(message);
  return {
    source,
    author,
    message,
    messageId: cleanOneLine(input.messageId || input.id, createShortId('chat'), 120),
    suggestion: suggestionPayload.suggestion,
    musicProvider: suggestionPayload.musicProvider,
    voteTargetId: extractVote(message),
    star: extractStarRating(message),
    receivedAt: cleanOneLine(input.receivedAt || input.timestamp || '', '', 80) || nowIso(),
  };
}

function toTimestampMs(value = '') {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function isDuplicateStreamChatMessage(recentMessages = [], parsed = {}) {
  const messageId = cleanOneLine(parsed.messageId, '', 120);
  if (messageId && recentMessages.some((entry) => cleanOneLine(entry?.id, '', 120) === messageId)) {
    return true;
  }
  const author = foldForLookup(parsed.author);
  const message = foldForLookup(parsed.message);
  if (!author || !message) return false;
  const receivedAtMs = toTimestampMs(parsed.receivedAt) || Date.now();
  return recentMessages.some((entry) => {
    if (foldForLookup(entry?.author) !== author) return false;
    if (foldForLookup(entry?.message) !== message) return false;
    const entryMs = toTimestampMs(entry?.receivedAt);
    if (!entryMs) return false;
    return Math.abs(receivedAtMs - entryMs) <= 3500;
  });
}

function collectLearningTerms(value = '') {
  return foldForLookup(value)
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .filter((word, index, list) => list.indexOf(word) === index)
    .slice(0, 16);
}

function refreshSuggestionScores(round) {
  const suggestions = Array.isArray(round?.suggestions) ? round.suggestions : [];
  suggestions.forEach((suggestion) => {
    const votes = Number(suggestion.votes || 0);
    const starAverage = Number(suggestion.starAverage || 0);
    const starBonus = starAverage ? (starAverage - 3) * 1.5 : 0;
    suggestion.score = Number((1 + votes * 2 + starBonus).toFixed(2));
  });
  suggestions.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function buildNossenSeedFromRound(state) {
  const round = state?.round || {};
  refreshSuggestionScores(round);
  const winner = round.suggestions?.find((entry) => entry.id === round.winningSuggestionId)
    || round.suggestions?.[0]
    || null;
  const hasCurrentRoundMaterial = Boolean(winner || (round.suggestions || []).length);
  const currentRoundTerms = hasCurrentRoundMaterial
    ? new Set(collectLearningTerms((round.suggestions || []).map((entry) => entry.text).join(' ')))
    : new Set();
  const likedTerms = hasCurrentRoundMaterial && Array.isArray(state?.learning?.likedTerms)
    ? state.learning.likedTerms.filter((term) => currentRoundTerms.has(term)).slice(0, 10)
    : [];
  const topIdeas = (round.suggestions || []).slice(0, 5).map((entry) => (
    `${entry.id}: ${entry.text} (${entry.votes || 0} votes, ${entry.starAverage || 0}/5)`
  ));
  return {
    ok: Boolean(winner),
    source: 'twitch-live',
    winner,
    canvas: [
      winner ? `Matière Twitch gagnante: ${winner.text}` : '',
      topIdeas.length ? `Autres idées du round:\n${topIdeas.join('\n')}` : '',
      likedTerms.length ? `Vocabulaire validé dans ce round: ${likedTerms.join(', ')}` : '',
      'Objectif: transformer la demande gagnante en mini-histoire chantée, précise, pas générique, avec vocabulaire vécu.',
      'Architecture narrative attendue: sujet + personnages + problème + évolution + scène finale + style musical. Chaque couplet doit avoir une fonction.',
      'Lecture à trois intentions: sujet visible, sous-thème humain ou émotionnel, puis morale cachée / message de troisième intention. La morale doit rester incarnée dans les scènes, jamais expliquée comme une leçon.',
      'Validation avant Suno: début clair, problème clair, bascule claire, fin mémorable, comportement risqué non glorifié, message caché perceptible sans être scolaire.',
    ].filter(Boolean).join('\n\n'),
    notes: likedTerms.length
      ? `Construire une vraie progression dramatique avec une troisième intention cachée. Éviter les images passe-partout; privilégier les détails concrets aimés: ${likedTerms.join(', ')}.`
      : 'Construire une vraie progression dramatique avec une troisième intention cachée. Éviter les images passe-partout; chercher des détails concrets dans le sujet demandé.',
  };
}

// Noyau réel de la direction Djeff Engine: l'overlay réagit au mood.
// L'accent visuel de la scène est dérivé du thème/tenue du morceau.
// Additif: si rien ne matche, on garde l'accent Vivy par défaut.
const VIVY_MOOD_THEMES = [
  { name: 'Poison Feu', accent: '#ff3b3b', glow: 'rgba(255,59,59,.32)', re: /\b(poison|feu|rage|rageu|clash|egotrip|ego\s*trip|sombre|violent|colère|colere|guerre|enfer|démon|demon|hardcore|gabber)\b/i },
  { name: 'Rune Claire', accent: '#5fe0e6', glow: 'rgba(95,224,230,.30)', re: /\b(rune|code|ascii|machine|cyber|tech|glitch|numérique|numerique|robot|electro)\b/i },
  { name: 'Soleil Avalé', accent: '#ffb84d', glow: 'rgba(255,184,77,.30)', re: /\b(soleil|or\b|lumière|lumiere|chaleur|été|ete\b|tendre|cœur|coeur|fable|conte)\b/i },
  { name: 'Aile Noire', accent: '#9fb8d6', glow: 'rgba(159,184,214,.28)', re: /\b(aile|nuit|noir|argent|douleur|larme|deuil|mélancolie|melancolie|pluie|hiver)\b/i },
  { name: 'Club Violet', accent: '#b06cff', glow: 'rgba(176,108,255,.32)', re: /\b(club|violet|néon|neon|rave|scène|scene|danse|fête|fete|live|party)\b/i },
];
const VIVY_MOOD_DEFAULT = { name: 'Vivy', accent: '#f07ad9', glow: 'rgba(240,122,217,.30)' };

function resolveVivyMoodTheme(text = '') {
  const folded = String(text || '');
  for (const theme of VIVY_MOOD_THEMES) {
    if (theme.re.test(folded)) {
      return { name: theme.name, accent: theme.accent, glow: theme.glow };
    }
  }
  return { ...VIVY_MOOD_DEFAULT };
}

function publicState(state) {
  const cloned = JSON.parse(JSON.stringify(state || createInitialState()));
  cloned.current = cleanProviderOnlyCurrentTrack(cloned.current || {});
  if (cloned.current && typeof cloned.current === 'object') {
    const moodSource = [
      cloned.current.title,
      cloned.current.trackTitle,
      cloned.current.coverPrompt,
    ].filter(Boolean).join(' ');
    cloned.current.moodTheme = resolveVivyMoodTheme(moodSource);
  }
  const stripLyricsForPublicState = (track) => {
    if (!track || typeof track !== 'object') return;
    if (track.lyrics) {
      track.hasLyrics = true;
      delete track.lyrics;
    }
  };
  if (Array.isArray(cloned.jukebox?.tracks)) {
    cloned.jukebox.tracks = cloned.jukebox.tracks.filter((track) => !isProviderOnlyTrackUrl(track?.trackUrl));
    cloned.jukebox.tracks.forEach(stripLyricsForPublicState);
  }
  if (Array.isArray(cloned.songs)) {
    cloned.songs = cloned.songs.filter((track) => !isProviderOnlyTrackUrl(track?.trackUrl));
    cloned.songs.forEach(stripLyricsForPublicState);
  }
  if (cloned.round?.voters) delete cloned.round.voters;
  cloned.serverNow = nowIso();
  cloned.nossenSeed = buildNossenSeedFromRound(cloned);
  return cloned;
}

function buildSongsArchiveHtml(state = {}, options = {}) {
  const publicBaseUrl = options.publicBaseUrl || process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me';
  const songs = (Array.isArray(state.songs) ? state.songs : [])
    .filter((song) => song?.trackUrl)
    .slice()
    .reverse();
  const rows = songs.map((song, index) => {
    const title = cleanTrackTitle(song.trackTitle || song.title, `Morceau ${songs.length - index}`);
    const audioUrl = absolutizePublicUrl(song.sharePath || song.trackUrl, publicBaseUrl);
    const directUrl = absolutizePublicUrl(song.trackUrl, publicBaseUrl);
    const coverUrl = absolutizePublicUrl(song.coverImageUrl || '', publicBaseUrl);
    const clipUrl = absolutizePublicUrl(song.coverVideoUrl || '', publicBaseUrl);
    const downloadAudioUrl = buildStreamDownloadPath(directUrl, 'audio');
    const downloadCoverUrl = coverUrl ? buildStreamDownloadPath(coverUrl, 'image') : '';
    const downloadClipUrl = clipUrl ? buildStreamDownloadPath(clipUrl, 'clip') : '';
    const lyricsUrl = (song.lyrics || song.hasLyrics) && song.sharePath
      ? absolutizePublicUrl(`${song.sharePath}/paroles.txt`, publicBaseUrl)
      : '';
    const requestedBy = cleanOneLine(song.requestedBy, '', 80);
    const rating = Number(song.starCount || 0) && Number(song.starAverage || 0)
      ? `${Number(song.starAverage).toFixed(Number(song.starAverage) % 1 ? 1 : 0)}/5 (${Number(song.starCount || 0)})`
      : 'pas encore noté';
    return `
      <article class="song">
        ${coverUrl ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="">` : '<div class="cover empty">Vivy</div>'}
        <div class="body">
          <p class="rank">#${songs.length - index}</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="meta">${requestedBy ? `Demandé par ${escapeHtml(requestedBy)} · ` : ''}${escapeHtml(rating)}</p>
          <p class="links"><a href="${escapeHtml(audioUrl)}">Ouvrir</a><a href="${escapeHtml(downloadAudioUrl)}" download>Télécharger MP3</a>${lyricsUrl ? `<a href="${escapeHtml(lyricsUrl)}" download>Paroles</a>` : ''}${coverUrl ? `<a href="${escapeHtml(downloadCoverUrl)}" download>Télécharger image</a>` : ''}${clipUrl ? `<a href="${escapeHtml(downloadClipUrl)}" download>Télécharger clip</a>` : ''}</p>
        </div>
      </article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playlist Vivy Live</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #060409; color: #fff8ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 18% 8%, rgba(240,122,217,.2), transparent 34%), #060409; }
    main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0 64px; }
    header { margin-bottom: 30px; }
    .eyebrow { margin: 0 0 8px; color: #73d9e6; font-size: 13px; font-weight: 900; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(34px, 7vw, 78px); line-height: .95; letter-spacing: 0; }
    .count { margin: 14px 0 0; color: #d9c8dc; font-size: 17px; }
    .list { display: grid; gap: 14px; }
    .song { display: grid; grid-template-columns: 148px minmax(0, 1fr); gap: 18px; align-items: stretch; padding: 14px; border: 1px solid rgba(240,122,217,.35); background: rgba(8,5,13,.78); }
    .cover { width: 148px; height: 84px; object-fit: cover; background: #13091c; border: 1px solid rgba(255,255,255,.14); }
    .cover.empty { display: grid; place-items: center; color: #f07ad9; font-weight: 900; }
    .rank { margin: 0 0 4px; color: #f07ad9; font-size: 12px; font-weight: 900; }
    h2 { margin: 0; overflow-wrap: anywhere; font-size: 24px; line-height: 1.08; }
    .meta { margin: 8px 0 0; color: #d9c8dc; }
    .links { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 10px; }
    a { color: #73d9e6; text-decoration: none; font-weight: 850; }
    a:hover { text-decoration: underline; }
    .empty-state { padding: 28px; border: 1px solid rgba(255,255,255,.14); color: #d9c8dc; background: rgba(8,5,13,.72); }
    @media (max-width: 620px) { .song { grid-template-columns: 1fr; } .cover { width: 100%; height: auto; aspect-ratio: 16 / 9; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Vivy Live</p>
      <h1>Playlist du live</h1>
      <p class="count">${songs.length} morceau${songs.length > 1 ? 'x' : ''} passé${songs.length > 1 ? 's' : ''}</p>
    </header>
    <section class="list">
      ${rows || '<div class="empty-state">Aucun morceau archivé pour ce live.</div>'}
    </section>
  </main>
</body>
</html>`;
}

function buildSongShareHtml(song = {}, options = {}) {
  const publicBaseUrl = options.publicBaseUrl || process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me';
  const title = cleanTrackTitle(song.trackTitle || song.title, 'Morceau Vivy');
  const audioUrl = absolutizePublicUrl(song.trackUrl, publicBaseUrl);
  const coverUrl = absolutizePublicUrl(song.coverImageUrl || '', publicBaseUrl);
  const clipUrl = absolutizePublicUrl(song.coverVideoUrl || '', publicBaseUrl);
  const downloadAudioUrl = buildStreamDownloadPath(audioUrl, 'audio');
  const downloadCoverUrl = coverUrl ? buildStreamDownloadPath(coverUrl, 'image') : '';
  const downloadClipUrl = clipUrl ? buildStreamDownloadPath(clipUrl, 'clip') : '';
  const lyricsUrl = (song.lyrics || song.hasLyrics) && song.sharePath
    ? absolutizePublicUrl(`${song.sharePath}/paroles.txt`, publicBaseUrl)
    : '';
  const relicWavUrl = song.sharePath ? absolutizePublicUrl(`${song.sharePath}/relic.wav`, publicBaseUrl) : '';
  const relicFlacUrl = song.sharePath ? absolutizePublicUrl(`${song.sharePath}/relic.flac`, publicBaseUrl) : '';
  const requestedBy = cleanOneLine(song.requestedBy, '', 80);
  const rating = Number(song.starCount || 0) && Number(song.starAverage || 0)
    ? `${Number(song.starAverage).toFixed(Number(song.starAverage) % 1 ? 1 : 0)}/5 (${Number(song.starCount || 0)})`
    : 'pas encore noté';
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Vivy Live</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #060409; color: #fff8ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 22px; background: radial-gradient(circle at 22% 10%, rgba(240,122,217,.22), transparent 36%), #060409; }
    main { width: min(760px, 100%); display: grid; gap: 18px; }
    .media { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #12081a; border: 1px solid rgba(240,122,217,.35); }
    h1 { margin: 0; font-size: clamp(34px, 9vw, 72px); line-height: .95; letter-spacing: 0; }
    .meta { margin: 0; color: #d9c8dc; font-size: 16px; }
    audio { width: 100%; }
    .links { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; }
    a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 14px; border: 1px solid rgba(115,217,230,.42); color: #73d9e6; text-decoration: none; font-weight: 900; background: rgba(6,4,9,.72); }
    a:hover { text-decoration: underline; }
    .back { color: #f07ad9; border-color: rgba(240,122,217,.42); }
  </style>
</head>
<body>
  <main>
    ${clipUrl ? `<video class="media" src="${escapeHtml(clipUrl)}" poster="${escapeHtml(coverUrl)}" autoplay muted loop playsinline controls></video>` : (coverUrl ? `<img class="media" src="${escapeHtml(coverUrl)}" alt="">` : '')}
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">${requestedBy ? `Demandé par ${escapeHtml(requestedBy)} · ` : ''}${escapeHtml(rating)}</p>
    <audio src="${escapeHtml(audioUrl)}" controls preload="metadata"></audio>
    <p class="links">
      <a href="${escapeHtml(downloadAudioUrl)}" download>Télécharger MP3</a>
      ${relicWavUrl ? `<a href="${escapeHtml(relicWavUrl)}" download>Relique WAV</a>` : ''}
      ${relicFlacUrl ? `<a href="${escapeHtml(relicFlacUrl)}" download>Relique FLAC</a>` : ''}
      ${lyricsUrl ? `<a href="${escapeHtml(lyricsUrl)}" download>Télécharger paroles</a>` : ''}
      ${coverUrl ? `<a href="${escapeHtml(downloadCoverUrl)}" download>Télécharger image</a>` : ''}
      ${clipUrl ? `<a href="${escapeHtml(downloadClipUrl)}" download>Télécharger clip</a>` : ''}
      <a class="back" href="/api/vivy/stream/songs">Playlist</a>
    </p>
  </main>
</body>
</html>`;
}

function createVivyStreamStore(options = {}) {
  const runtimeRoot = options.runtimeRoot || getCanonicalRuntimeRoot(process.env);
  const statePath = options.statePath || path.join(runtimeRoot, 'vivy-stream', 'state.json');
  const clients = new Set();
  const onRoundLocked = typeof options.onRoundLocked === 'function' ? options.onRoundLocked : null;
  const idleJukeboxEnabled = options.idleJukeboxEnabled !== false
    && String(process.env.VIVY_STREAM_IDLE_JUKEBOX_DISABLED || '').trim() !== '1';
  const randomInt = typeof options.randomInt === 'function' ? options.randomInt : (max) => crypto.randomInt(max);
  let state = createInitialState();
  let lifecycleTimer = null;

  function load() {
    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (parsed?.schema === STREAM_SCHEMA) {
          const initial = createInitialState();
          state = {
            ...initial,
            ...parsed,
            current: cleanProviderOnlyCurrentTrack({ ...initial.current, ...(parsed.current || {}) }),
            round: { ...initial.round, ...(parsed.round || {}) },
            production: {
              ...initial.production,
              ...(parsed.production || {}),
              stages: {
                ...initial.production.stages,
                ...(parsed.production?.stages || {}),
              },
            },
            jukebox: {
              ...initial.jukebox,
              ...(parsed.jukebox || {}),
              tracks: Array.isArray(parsed.jukebox?.tracks)
                ? parsed.jukebox.tracks.map(normalizeJukeboxTrack).filter(Boolean)
                : [],
            },
            songs: Array.isArray(parsed.songs)
              ? parsed.songs.map(normalizeJukeboxTrack).filter(Boolean).slice(-MAX_LIVE_SONGS)
              : [],
            learning: { ...initial.learning, ...(parsed.learning || {}) },
            stats: { ...initial.stats, ...(parsed.stats || {}) },
            pendingSuggestions: Array.isArray(parsed.pendingSuggestions) ? parsed.pendingSuggestions : [],
            recentMessages: Array.isArray(parsed.recentMessages) ? parsed.recentMessages : [],
            stars: Array.isArray(parsed.stars) ? parsed.stars : [],
            twitch: { ...initial.twitch, ...(parsed.twitch || {}) },
          };
        }
      }
    } catch (error) {
      console.warn('[vivy-stream] state load failed:', error?.message || String(error));
    }
    scheduleLifecycle();
    return state;
  }

  function save() {
    state.updatedAt = nowIso();
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.warn('[vivy-stream] state save failed:', error?.message || String(error));
    }
    broadcast();
    scheduleLifecycle();
  }

  function broadcast(eventName = 'state') {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(publicState(state))}\n\n`;
    clients.forEach((res) => {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    });
  }

  function ensureOpenRound() {
    if (!state.round || state.round.status !== 'open') {
      state.round = createRound();
    }
    return state.round;
  }

  function winnerFromState() {
    return state.round?.suggestions?.find((entry) => entry.id === state.round.winningSuggestionId)
      || state.round?.suggestions?.[0]
      || null;
  }

  function setCurrentPhase(phase, fields = {}) {
    const normalized = LIVE_PHASES.has(phase) ? phase : 'idle';
    state.current = {
      ...state.current,
      ...fields,
      phase: normalized,
      phaseStartedAt: nowIso(),
    };
  }

  function stopDisabledIdleJukeboxInterlude() {
    if (idleJukeboxEnabled || state.current?.phase !== 'interlude') return false;
    setCurrentPhase('idle', {
      title: 'Vivy Live',
      trackUrl: '',
      trackTitle: '',
      trackId: '',
      sharePath: '',
      requestedBy: '',
      playbackStartedAt: null,
      phaseEndsAt: null,
      durationSeconds: 0,
      message: 'Fond musical d’attente désactivé.',
    });
    save();
    return true;
  }

  function ensureJukebox() {
    state.jukebox = state.jukebox && typeof state.jukebox === 'object'
      ? state.jukebox
      : { tracks: [], lastTrackId: '', lastScanAt: null };
    state.jukebox.tracks = Array.isArray(state.jukebox.tracks) ? state.jukebox.tracks : [];
    return state.jukebox;
  }

  function addJukeboxTrack(input = {}) {
    const track = normalizeJukeboxTrack(input);
    if (!track) return null;
    const jukebox = ensureJukebox();
    const existingIndex = jukebox.tracks.findIndex((entry) => entry.id === track.id || entry.trackUrl === track.trackUrl);
    if (existingIndex >= 0) {
      jukebox.tracks[existingIndex] = {
        ...jukebox.tracks[existingIndex],
        ...track,
        createdAt: jukebox.tracks[existingIndex].createdAt || track.createdAt,
      };
    } else {
      jukebox.tracks.unshift(track);
    }
    jukebox.tracks = jukebox.tracks
      .filter((entry, index, list) => entry?.trackUrl && list.findIndex((candidate) => candidate.trackUrl === entry.trackUrl) === index)
      .slice(0, MAX_JUKEBOX_TRACKS);
    return track;
  }

  function ensureSongs() {
    state.songs = Array.isArray(state.songs) ? state.songs : [];
    return state.songs;
  }

  function addLiveSong(input = {}) {
    const song = normalizeJukeboxTrack(input);
    if (!song) return null;
    const songs = ensureSongs();
    const existingIndex = songs.findIndex((entry) => entry.id === song.id || entry.trackUrl === song.trackUrl);
    if (existingIndex >= 0) {
      songs[existingIndex] = {
        ...songs[existingIndex],
        ...song,
        createdAt: songs[existingIndex].createdAt || song.createdAt,
      };
    } else {
      songs.push(song);
    }
    state.songs = songs
      .filter((entry, index, list) => entry?.trackUrl && list.findIndex((candidate) => candidate.trackUrl === entry.trackUrl) === index)
      .slice(-MAX_LIVE_SONGS);
    return song;
  }

  function updateTrackStars(trackId = '', rating = 0) {
    const id = cleanOneLine(trackId, '', 80);
    const value = Math.max(1, Math.min(5, Number(rating || 0) || 0));
    if (!id || !value) return null;
    let updated = null;
    const apply = (track) => {
      if (!track || track.id !== id) return;
      const previousCount = Number(track.starCount || 0);
      const previousAverage = Number(track.starAverage || 0);
      track.starCount = previousCount + 1;
      track.starAverage = Number((((previousAverage * previousCount) + value) / track.starCount).toFixed(2));
      updated = track;
    };
    ensureJukebox().tracks.forEach(apply);
    ensureSongs().forEach(apply);
    return updated;
  }

  function findSongByShareSlug(slug = '') {
    const needle = cleanOneLine(slug, '', 180);
    if (!needle) return null;
    const allTracks = [
      ...ensureSongs(),
      ...ensureJukebox().tracks,
    ].filter((track) => !isProviderOnlyTrackUrl(track?.trackUrl));
    return allTracks.find((track) => {
      const shareSlug = String(track.sharePath || '').split('/').pop();
      return shareSlug === needle || track.id === needle;
    }) || null;
  }

  function refreshJukeboxFromAssets() {
    const jukebox = ensureJukebox();
    const discovered = discoverVivyJukeboxTracksFromAssets();
    discovered.forEach((track) => addJukeboxTrack(track));
    jukebox.lastScanAt = nowIso();
    return jukebox.tracks;
  }

  function getJukeboxTracks() {
    const jukebox = ensureJukebox();
    if (!jukebox.tracks.length) refreshJukeboxFromAssets();
    jukebox.tracks = jukebox.tracks.filter((track) => track?.trackUrl && !isProviderOnlyTrackUrl(track.trackUrl));
    return jukebox.tracks;
  }

  function getLocalJukeboxTrackPath(track = {}) {
    const rawUrl = String(track.trackUrl || '').trim();
    let filename = '';
    try {
      const parsed = new URL(rawUrl, 'https://vivy.local');
      filename = path.basename(decodeURIComponent(parsed.pathname));
    } catch {
      filename = path.basename(rawUrl);
    }
    if (!/^vivy-music-.+\.mp3$/i.test(filename)) return '';
    return getEmergencyMediaAssetPath(filename);
  }

  function resolveJukeboxTrackDuration(track = {}) {
    const reported = Number(track.durationSeconds || track.duration || 0);
    if (Number.isFinite(reported) && reported > 1) return reported;
    const localPath = getLocalJukeboxTrackPath(track);
    const measured = probeLocalAudioDurationSeconds(localPath);
    if (measured > 0) {
      track.durationSeconds = measured;
      return measured;
    }
    return DEFAULT_TRACK_SECONDS;
  }

  function selectJukeboxTrack() {
    const tracks = getJukeboxTracks();
    if (!tracks.length) return null;
    const jukebox = ensureJukebox();
    const candidates = tracks.length > 1
      ? tracks.filter((track) => track.id !== jukebox.lastTrackId)
      : tracks;
    const pool = candidates.length ? candidates : tracks;
    return pool[randomInt(pool.length)];
  }

  function shouldStartIdleJukebox({ allowInterlude = false } = {}) {
    if (!idleJukeboxEnabled) return false;
    if (state.twitch?.online === false) return false;
    const phase = state.current?.phase || 'idle';
    if (phase !== 'idle' && phase !== 'listening' && !(allowInterlude && phase === 'interlude')) return false;
    if (state.round?.status !== 'open') return false;
    if (state.round?.suggestions?.length) return false;
    if (Array.isArray(state.pendingSuggestions) && state.pendingSuggestions.length) return false;
    return true;
  }

  function beginIdleJukebox(options = {}) {
    if (!idleJukeboxEnabled) {
      stopDisabledIdleJukeboxInterlude();
      return publicState(state);
    }
    if (!shouldStartIdleJukebox({ allowInterlude: Boolean(options.rotate) })) return publicState(state);
    const track = selectJukeboxTrack();
    if (!track) return publicState(state);
    const startedAt = Date.now();
    const durationSeconds = Math.max(1, Math.min(3600, Number(resolveJukeboxTrackDuration(track) || DEFAULT_TRACK_SECONDS)));
    const jukebox = ensureJukebox();
    jukebox.lastTrackId = track.id;
    addLiveSong({
      ...track,
      source: track.source || 'vivy-interlude',
      createdAt: nowIso(),
    });
    setCurrentPhase('interlude', {
      title: track.title || 'Vivy Live',
      trackTitle: track.trackTitle || track.title || 'Archive Vivy Live',
      trackUrl: track.trackUrl,
      trackId: track.id,
      sharePath: track.sharePath,
      coverImageUrl: track.coverImageUrl || '',
      coverPrompt: track.coverPrompt || '',
      coverVideoUrl: track.coverVideoUrl || '',
      coverVideoPrompt: track.coverVideoPrompt || '',
      requestedBy: track.requestedBy || 'Vivy Live',
      durationSeconds,
      playbackStartedAt: new Date(startedAt).toISOString(),
      phaseEndsAt: new Date(startedAt + (durationSeconds * 1000)).toISOString(),
      message: 'Fond musical d’attente pendant que le chat prépare la prochaine demande.',
    });
    save();
    return publicState(state);
  }

  function startVotingCountdown(round) {
    if (!round?.suggestions?.length || round.endsAt) return;
    const startedAt = Date.now();
    round.startedAt = new Date(startedAt).toISOString();
    round.endsAt = new Date(startedAt + resolveRoundMs()).toISOString();
  }

  function beginProduction() {
    const winner = winnerFromState();
    if (!winner) return startRound();
    const startedAt = nowIso();
    state.production = createProductionState();
    state.production.startedAt = startedAt;
    state.production.updatedAt = startedAt;
    state.production.stages.analysis = { status: 'active', progress: 0 };
    setCurrentPhase('composing', {
      title: winner.text,
      requestedBy: winner.author,
      phaseEndsAt: null,
      message: 'Vivy commence à composer.',
    });
    save();
    return publicState(state);
  }

  function beginPlayback() {
    if (!state.current.trackUrl) {
      setCurrentPhase('error', {
        phaseEndsAt: null,
        message: 'La piste audio du live est introuvable.',
      });
      save();
      return publicState(state);
    }
    const durationSeconds = Math.max(1, Number(state.current.durationSeconds || DEFAULT_TRACK_SECONDS));
    const startedAt = Date.now();
    setCurrentPhase('playing', {
      playbackStartedAt: new Date(startedAt).toISOString(),
      phaseEndsAt: new Date(startedAt + (durationSeconds * 1000)).toISOString(),
      message: 'Lecture en cours',
    });
    save();
    return publicState(state);
  }

  function beginRating() {
    const endsAt = Date.now() + RATING_MS;
    setCurrentPhase('rating', {
      phaseEndsAt: new Date(endsAt).toISOString(),
      message: 'Votez avec !etoiles 1 à 5',
    });
    save();
    return publicState(state);
  }

  function scheduleLifecycle() {
    if (lifecycleTimer) clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
    if (stopDisabledIdleJukeboxInterlude()) return;
    const phase = state.current?.phase;
    let deadline = null;
    let transition = null;
    if (state.round?.status === 'open' && state.round?.suggestions?.length && state.round.endsAt) {
      deadline = Date.parse(state.round.endsAt);
      transition = () => lockRound();
    } else if (phase === 'winner' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginProduction;
    } else if (phase === 'presenting' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginPlayback;
    } else if (phase === 'interlude' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = () => beginIdleJukebox({ rotate: true });
    } else if (phase === 'playing' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = beginRating;
    } else if (phase === 'rating' && state.current.phaseEndsAt) {
      deadline = Date.parse(state.current.phaseEndsAt);
      transition = () => startRound();
    } else if (shouldStartIdleJukebox()) {
      deadline = Date.now() + resolveIdleJukeboxDelayMs();
      transition = beginIdleJukebox;
    }
    if (!Number.isFinite(deadline) || !transition) return;
    const timerDelay = Math.max(10, Math.min(2_147_000_000, deadline - Date.now()));
    lifecycleTimer = setTimeout(transition, timerDelay);
    lifecycleTimer.unref?.();
  }

  function addSuggestion(parsed) {
    const round = ensureOpenRound();
    const text = cleanText(parsed.suggestion, MAX_STREAM_SUGGESTION_CHARS);
    if (!text) return null;
    const folded = foldForLookup(text);
    const existing = round.suggestions.find((entry) => foldForLookup(entry.text) === folded);
    if (existing) {
      existing.votes = Number(existing.votes || 0) + 1;
      existing.updatedAt = parsed.receivedAt;
      if (!existing.musicProvider && parsed.musicProvider) existing.musicProvider = parsed.musicProvider;
      startVotingCountdown(round);
      return existing;
    }
    const suggestionNumber = round.suggestions.reduce((highest, entry) => {
      const number = Number(String(entry.id || '').replace(/^S/i, ''));
      return Number.isFinite(number) ? Math.max(highest, number) : highest;
    }, 0) + 1;
    const suggestion = {
      id: `S${suggestionNumber}`,
      text,
      author: parsed.author,
      source: parsed.source,
      musicProvider: cleanOneLine(parsed.musicProvider, '', 40),
      createdAt: parsed.receivedAt,
      updatedAt: parsed.receivedAt,
      votes: 1,
      starCount: 0,
      starAverage: 0,
      score: 1,
    };
    round.suggestions.unshift(suggestion);
    round.suggestions = round.suggestions.slice(0, MAX_SUGGESTIONS);
    state.stats.suggestions = Number(state.stats.suggestions || 0) + 1;
    startVotingCountdown(round);
    return suggestion;
  }

  function queueSuggestion(parsed) {
    const text = cleanText(parsed.suggestion, MAX_STREAM_SUGGESTION_CHARS);
    if (!text) return null;
    state.pendingSuggestions = Array.isArray(state.pendingSuggestions) ? state.pendingSuggestions : [];
    const folded = foldForLookup(text);
    const existing = state.pendingSuggestions.find((entry) => foldForLookup(entry.suggestion) === folded);
    if (existing) {
      existing.receivedAt = parsed.receivedAt;
      existing.author = parsed.author;
      if (!existing.musicProvider && parsed.musicProvider) existing.musicProvider = parsed.musicProvider;
      return existing;
    }
    const queued = {
      suggestion: text,
      author: parsed.author,
      source: parsed.source,
      musicProvider: cleanOneLine(parsed.musicProvider, '', 40),
      message: parsed.message,
      messageId: parsed.messageId,
      receivedAt: parsed.receivedAt,
    };
    state.pendingSuggestions.push(queued);
    state.pendingSuggestions = state.pendingSuggestions.slice(-MAX_PENDING_SUGGESTIONS);
    return queued;
  }

  function addVote(parsed) {
    const round = ensureOpenRound();
    const targetId = normalizeSuggestionId(parsed.voteTargetId);
    const suggestion = round.suggestions.find((entry) => entry.id === targetId);
    if (!suggestion) return null;
    const voterKey = foldForLookup(parsed.author);
    const previousId = round.voters?.[voterKey];
    if (previousId && previousId !== targetId) {
      const previous = round.suggestions.find((entry) => entry.id === previousId);
      if (previous) previous.votes = Math.max(0, Number(previous.votes || 0) - 1);
    }
    round.voters = round.voters || {};
    if (previousId !== targetId) {
      suggestion.votes = Number(suggestion.votes || 0) + 1;
      state.stats.votes = Number(state.stats.votes || 0) + 1;
    }
    round.voters[voterKey] = targetId;
    suggestion.updatedAt = parsed.receivedAt;
    return suggestion;
  }

  function addStar(parsed) {
    const star = parsed.star;
    if (!star?.rating) return null;
    const round = state.round || createRound();
    const targetId = normalizeSuggestionId(star.targetId);
    const suggestion = targetId
      ? round.suggestions.find((entry) => entry.id === targetId)
      : winnerFromState() || round.suggestions[0] || null;
    const entry = {
      id: createShortId('star'),
      rating: Number(star.rating),
      author: parsed.author,
      targetId: suggestion?.id || targetId || null,
      message: parsed.message,
      createdAt: parsed.receivedAt,
    };
    state.stars = Array.isArray(state.stars) ? state.stars : [];
    state.stars.unshift(entry);
    state.stars = state.stars.slice(0, MAX_STARS);
    state.stats.stars = Number(state.stats.stars || 0) + 1;
    const totalStars = Number(state.learning.totalStars || 0) + 1;
    const currentAverage = Number(state.learning.averageStars || 0);
    state.learning.totalStars = totalStars;
    state.learning.averageStars = Number((((currentAverage * (totalStars - 1)) + entry.rating) / totalStars).toFixed(2));
    if (suggestion) {
      const previousCount = Number(suggestion.starCount || 0);
      const previousAverage = Number(suggestion.starAverage || 0);
      suggestion.starCount = previousCount + 1;
      suggestion.starAverage = Number((((previousAverage * previousCount) + entry.rating) / suggestion.starCount).toFixed(2));
      collectLearningTerms(suggestion.text).forEach((term) => {
        state.learning.keywordScores[term] = Number((Number(state.learning.keywordScores[term] || 0) + (entry.rating - 3)).toFixed(2));
      });
      state.learning.likedTerms = Object.entries(state.learning.keywordScores)
        .filter(([, score]) => Number(score) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
        .map(([term]) => term)
        .slice(0, 18);
    }
    const currentTrackPhases = new Set(['presenting', 'playing', 'rating', 'interlude']);
    const currentTrackId = state.current?.trackId || '';
    const targetMatchesCurrentSong = currentTrackId
      && currentTrackPhases.has(state.current?.phase)
      && (!targetId || targetId === currentTrackId || suggestion?.id === round.winningSuggestionId);
    if (targetMatchesCurrentSong) {
      updateTrackStars(currentTrackId, entry.rating);
    } else if (targetId && /^track-[a-z0-9_-]+$/i.test(targetId)) {
      updateTrackStars(targetId, entry.rating);
    }
    return entry;
  }

  function addChatMessage(input = {}) {
    const parsed = parseVivyStreamChatMessage(input);
    if (!parsed.message) {
      return { ok: false, error: 'empty_message', state: publicState(state) };
    }
    if (isDuplicateStreamChatMessage(state.recentMessages || [], parsed)) {
      return {
        ok: true,
        action: 'duplicate_ignored',
        duplicate: true,
        parsed,
        state: publicState(state),
      };
    }
    if (parsed.source === 'twitch') {
      state.twitch = {
        ...(state.twitch || {}),
        online: true,
        lastOnlineAt: nowIso(),
      };
    }
    state.stats.messages = Number(state.stats.messages || 0) + 1;
    state.recentMessages.unshift({
      id: parsed.messageId,
      source: parsed.source,
      author: parsed.author,
      message: parsed.message,
      receivedAt: parsed.receivedAt,
    });
    state.recentMessages = state.recentMessages.slice(0, MAX_RECENT_MESSAGES);

    if (parsed.suggestion && state.current?.phase === 'error') {
      queueSuggestion(parsed);
      const recoveredState = startRound({
        title: 'Vivy Live',
        message: 'Erreur précédente absorbée: nouveau round ouvert.',
      });
      const suggestion = recoveredState.round?.suggestions?.[0] || null;
      return {
        ok: true,
        action: 'suggestion_recovered',
        parsed,
        suggestion,
        vote: null,
        star: null,
        recovered: true,
        state: recoveredState,
      };
    }

    let action = 'message';
    let suggestion = null;
    let vote = null;
    let star = null;
    const acceptsRoundInput = ['idle', 'listening', 'interlude', 'voting'].includes(state.current.phase)
      && (!state.round || state.round.status === 'open');
    if (parsed.suggestion && acceptsRoundInput) {
      suggestion = addSuggestion(parsed);
      action = 'suggestion';
    } else if (parsed.suggestion) {
      suggestion = queueSuggestion(parsed);
      action = suggestion ? 'suggestion_queued' : 'suggestion_ignored';
    }
    if (parsed.voteTargetId && acceptsRoundInput) {
      vote = addVote(parsed);
      if (vote) action = 'vote';
    } else if (parsed.voteTargetId) {
      action = 'vote_ignored';
    }
    if (parsed.star) {
      star = addStar(parsed);
      if (star) action = action === 'message' ? 'star' : `${action}+star`;
    }
    refreshSuggestionScores(state.round);
    if ((suggestion || vote) && ['idle', 'listening', 'interlude', 'voting'].includes(state.current.phase)) {
      const latest = suggestion || vote;
      setCurrentPhase('voting', {
        title: latest?.text || state.current.title || 'Vivy Live',
        trackUrl: '',
        trackTitle: '',
        trackId: '',
        sharePath: '',
        coverImageUrl: '',
        coverPrompt: '',
        coverVideoUrl: '',
        coverVideoPrompt: '',
        requestedBy: latest?.author || state.current.requestedBy || '',
        phaseEndsAt: state.round.endsAt,
        playbackStartedAt: null,
        durationSeconds: 0,
        message: 'Le chat propose et vote pour le prochain NOSSEN.',
      });
    } else if (star && state.current.phase === 'rating') {
      state.current.message = `${state.stats.stars} note${state.stats.stars > 1 ? 's' : ''} reçue${state.stats.stars > 1 ? 's' : ''}.`;
    }
    save();
    return { ok: true, action, parsed, suggestion, vote, star, state: publicState(state) };
  }

  function startRound(input = {}) {
    const title = cleanOneLine(input.title || input.topic, 'Vivy Live', 120);
    const queuedSuggestions = Array.isArray(state.pendingSuggestions)
      ? state.pendingSuggestions.slice(0, MAX_PENDING_SUGGESTIONS)
      : [];
    state.pendingSuggestions = [];
    state.round = createRound(createShortId('round'));
    state.production = createProductionState();
    state.current = {
      title,
      phase: 'listening',
      trackUrl: '',
      trackTitle: '',
      requestedBy: '',
      phaseStartedAt: nowIso(),
      phaseEndsAt: null,
      playbackStartedAt: null,
      durationSeconds: 0,
      trackId: '',
      sharePath: '',
      coverImageUrl: '',
      coverPrompt: '',
      coverVideoUrl: '',
      coverVideoPrompt: '',
      message: 'Nouveau round Twitch ouvert.',
    };
    queuedSuggestions.forEach((entry) => addSuggestion(entry));
    if (state.round.suggestions.length) {
      const latest = state.round.suggestions[0];
      setCurrentPhase('voting', {
        title: latest.text,
        requestedBy: latest.author,
        phaseEndsAt: state.round.endsAt,
        message: 'Les propositions reçues pendant le morceau passent au vote.',
      });
    }
    save();
    return publicState(state);
  }

  function peekNextClipMode() {
    return cleanOneLine(state.nextClipMode, '', 40).toLowerCase();
  }

  function armNextClipMode(mode = '') {
    state.nextClipMode = cleanOneLine(mode, '', 40).toLowerCase();
    save();
    return state.nextClipMode;
  }

  function consumeNextClipMode() {
    const mode = peekNextClipMode();
    if (mode) {
      state.nextClipMode = '';
      save();
    }
    return mode;
  }

  function lockRound(input = {}) {
    const targetId = normalizeSuggestionId(input.suggestionId || input.id || '');
    refreshSuggestionScores(state.round);
    const existingWinner = winnerFromState();
    if (state.round?.status === 'locked' && existingWinner) {
      return {
        ok: true,
        alreadyLocked: true,
        winner: existingWinner,
        nossenSeed: buildNossenSeedFromRound(state),
        state: publicState(state),
      };
    }
    const winner = targetId
      ? state.round.suggestions.find((entry) => entry.id === targetId)
      : state.round.suggestions[0];
    if (!winner) return { ok: false, error: 'no_suggestion', state: publicState(state) };
    state.round.status = 'locked';
    state.round.winningSuggestionId = winner.id;
    const revealEndsAt = Date.now() + WINNER_REVEAL_MS;
    setCurrentPhase('winner', {
      title: winner.text,
      requestedBy: winner.author,
      phaseEndsAt: new Date(revealEndsAt).toISOString(),
      message: `Idée gagnante ${winner.id}`,
    });
    save();
    const nossenSeed = buildNossenSeedFromRound(state);
    if (onRoundLocked) {
      Promise.resolve(onRoundLocked({
        roundId: state.round.id,
        winner: JSON.parse(JSON.stringify(winner)),
        nossenSeed,
        clipMode: consumeNextClipMode(),
      })).catch((error) => {
        console.error('[vivy-stream] automatic NOSSEN start failed:', error?.message || String(error));
      });
    }
    return { ok: true, winner, nossenSeed, state: publicState(state) };
  }

  function updateLive(input = {}) {
    const action = cleanOneLine(input.action || input.phase, '', 40).toLowerCase();
    const source = cleanOneLine(input.source, '', 80);
    if (source === 'twitch-live' && state.twitch?.online === false && action !== 'next' && action !== 'start') {
      return { ok: false, error: 'twitch_stream_offline', state: publicState(state) };
    }
    const winner = winnerFromState();
    if (action === 'progress' || action === 'composing') {
      if (!state.production?.stages) state.production = createProductionState();
      const stage = cleanOneLine(input.stage, 'analysis', 40).toLowerCase();
      if (!PRODUCTION_STAGES.includes(stage)) {
        return { ok: false, error: 'invalid_production_stage', state: publicState(state) };
      }
      const progress = Math.max(0, Math.min(100, Number(input.progress ?? 0) || 0));
      const stageIndex = PRODUCTION_STAGES.indexOf(stage);
      PRODUCTION_STAGES.forEach((name, index) => {
        if (index < stageIndex) state.production.stages[name] = { status: 'done', progress: 100 };
        else if (index === stageIndex) {
          state.production.stages[name] = {
            status: progress >= 100 ? 'done' : 'active',
            progress,
          };
        }
      });
      state.production.startedAt ||= nowIso();
      state.production.updatedAt = nowIso();
      setCurrentPhase('composing', {
        title: cleanOneLine(input.title, winner?.text || state.current.title || 'Vivy Live', 160),
        requestedBy: cleanOneLine(input.requestedBy || input.author, winner?.author || state.current.requestedBy, 80),
        phaseEndsAt: null,
        message: cleanOneLine(input.message, 'Vivy compose la chanson gagnante.', 200),
      });
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'ready' || action === 'presenting') {
      const trackUrl = cleanOneLine(input.trackUrl || input.audioUrl || input.url, '', 1200);
      if (!trackUrl) return { ok: false, error: 'track_url_missing', state: publicState(state) };
      const durationSeconds = Math.max(1, Math.min(3600, Number(input.durationSeconds || input.duration || DEFAULT_TRACK_SECONDS)));
      const coverImageUrl = cleanOneLine(
        input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url || state.current.coverImageUrl,
        '',
        1200
      );
      const coverPrompt = cleanOneLine(input.coverPrompt || input.imagePrompt || input.image_prompt || state.current.coverPrompt, '', 2000);
      const coverVideoUrl = cleanOneLine(
        input.coverVideoUrl || input.videoUrl || input.video_url || input.clipUrl || input.clip_url || state.current.coverVideoUrl,
        '',
        1200
      );
      const coverVideoPrompt = cleanOneLine(
        input.coverVideoPrompt || input.videoPrompt || input.video_prompt || state.current.coverVideoPrompt,
        '',
        2600
      );
      const track = addJukeboxTrack({
        title: input.title || input.trackTitle || winner?.text || state.current.title,
        trackTitle: input.trackTitle || input.title || winner?.text || state.current.trackTitle,
        trackUrl,
        requestedBy: input.requestedBy || input.author || winner?.author || state.current.requestedBy,
        durationSeconds,
        source: 'twitch-live',
        starCount: winner?.starCount || 0,
        starAverage: winner?.starAverage || 0,
        coverImageUrl,
        coverPrompt,
        coverVideoUrl,
        coverVideoPrompt,
        shareVideoUrl: cleanOneLine(input.shareVideoUrl || input.share_video_url, '', 1200),
        qualityNote: cleanOneLine(input.qualityNote || input.quality_note || '', '', 140),
        shortMix: input.shortMix === true || input.short_mix === true,
        lyrics: input.lyrics,
      });
      addLiveSong({
        ...track,
        title: input.title || input.trackTitle || winner?.text || state.current.title,
        trackTitle: input.trackTitle || input.title || winner?.text || state.current.trackTitle,
        requestedBy: input.requestedBy || input.author || winner?.author || state.current.requestedBy,
        createdAt: nowIso(),
        starCount: winner?.starCount || track?.starCount || 0,
        starAverage: winner?.starAverage || track?.starAverage || 0,
      });
      PRODUCTION_STAGES.forEach((name) => {
        state.production.stages[name] = { status: 'done', progress: 100 };
      });
      state.production.updatedAt = nowIso();
      const presentationEndsAt = Date.now() + PRESENTATION_MS;
      setCurrentPhase('presenting', {
        title: cleanOneLine(input.title || input.trackTitle, winner?.text || state.current.title || 'Nouvelle composition', 160),
        trackTitle: cleanOneLine(input.trackTitle || input.title, winner?.text || 'Nouvelle composition', 160),
        trackUrl,
        trackId: track?.id || createTrackId(trackUrl),
        sharePath: track?.sharePath || buildSongSharePath({ id: createTrackId(trackUrl), trackUrl, trackTitle: input.trackTitle || input.title }),
        requestedBy: cleanOneLine(input.requestedBy || input.author, winner?.author || state.current.requestedBy, 80),
        durationSeconds,
        qualityNote: track?.qualityNote || cleanOneLine(input.qualityNote || input.quality_note || '', '', 140),
        shortMix: track?.shortMix === true || input.shortMix === true || input.short_mix === true,
        playbackStartedAt: null,
        phaseEndsAt: new Date(presentationEndsAt).toISOString(),
        coverImageUrl: track?.coverImageUrl || coverImageUrl,
        coverPrompt: track?.coverPrompt || coverPrompt,
        coverVideoUrl: track?.coverVideoUrl || coverVideoUrl,
        coverVideoPrompt: track?.coverVideoPrompt || coverVideoPrompt,
        message: track?.shortMix === true || input.shortMix === true || input.short_mix === true
          ? 'Vivy présente sa nouvelle composition, version courte générée.'
          : 'Vivy présente sa nouvelle composition.',
      });
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'cover' || action === 'artwork' || action === 'image') {
      const mediaRoundId = cleanOneLine(input.roundId, '', 120);
      if (mediaRoundId && state.round?.id && mediaRoundId !== state.round.id) {
        return { ok: false, error: 'stale_round_media', state: publicState(state) };
      }
      const coverImageUrl = cleanOneLine(input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url || input.url, '', 1200);
      if (!coverImageUrl) return { ok: false, error: 'cover_image_url_missing', state: publicState(state) };
      const coverPrompt = cleanOneLine(input.coverPrompt || input.imagePrompt || input.image_prompt || input.prompt, '', 2000);
      const trackId = cleanOneLine(input.trackId || state.current.trackId, '', 80);
      const trackUrl = cleanOneLine(input.trackUrl || state.current.trackUrl, '', 1200);
      state.current.coverImageUrl = coverImageUrl;
      if (coverPrompt) state.current.coverPrompt = coverPrompt;
      const applyCover = (track) => {
        if (!track) return;
        const matchesTrackId = trackId && track.id === trackId;
        const matchesTrackUrl = trackUrl && track.trackUrl === trackUrl;
        if (!matchesTrackId && !matchesTrackUrl) return;
        track.coverImageUrl = coverImageUrl;
        if (coverPrompt) track.coverPrompt = coverPrompt;
      };
      ensureJukebox().tracks.forEach(applyCover);
      ensureSongs().forEach(applyCover);
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'clip' || action === 'video' || action === 'animation') {
      const mediaRoundId = cleanOneLine(input.roundId, '', 120);
      if (mediaRoundId && state.round?.id && mediaRoundId !== state.round.id) {
        return { ok: false, error: 'stale_round_media', state: publicState(state) };
      }
      const coverVideoUrl = cleanOneLine(
        input.coverVideoUrl || input.videoUrl || input.video_url || input.clipUrl || input.clip_url || input.url,
        '',
        1200
      );
      if (!coverVideoUrl) return { ok: false, error: 'cover_video_url_missing', state: publicState(state) };
      const coverVideoPrompt = cleanOneLine(
        input.coverVideoPrompt || input.videoPrompt || input.video_prompt || input.prompt,
        '',
        2600
      );
      const coverImageUrl = cleanOneLine(
        input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url,
        '',
        1200
      );
      const shareVideoUrl = cleanOneLine(input.shareVideoUrl || input.share_video_url, '', 1200);
      const trackId = cleanOneLine(input.trackId || state.current.trackId, '', 80);
      const trackUrl = cleanOneLine(input.trackUrl || state.current.trackUrl, '', 1200);
      const currentMatches = (!trackId && !trackUrl)
        || (trackId && state.current.trackId === trackId)
        || (trackUrl && state.current.trackUrl === trackUrl);
      if (currentMatches) {
        state.current.coverVideoUrl = coverVideoUrl;
        if (coverVideoPrompt) state.current.coverVideoPrompt = coverVideoPrompt;
        if (coverImageUrl) state.current.coverImageUrl = coverImageUrl;
      }
      const applyClip = (track) => {
        if (!track) return;
        const matchesTrackId = trackId && track.id === trackId;
        const matchesTrackUrl = trackUrl && track.trackUrl === trackUrl;
        if (!matchesTrackId && !matchesTrackUrl) return;
        track.coverVideoUrl = coverVideoUrl;
        if (coverVideoPrompt) track.coverVideoPrompt = coverVideoPrompt;
        if (coverImageUrl) track.coverImageUrl = coverImageUrl;
        if (shareVideoUrl) track.shareVideoUrl = shareVideoUrl;
      };
      ensureJukebox().tracks.forEach(applyClip);
      ensureSongs().forEach(applyClip);
      save();
      return { ok: true, state: publicState(state) };
    }
    if (action === 'play' || action === 'playing') {
      if (input.trackUrl || input.audioUrl || input.url) {
        state.current.trackUrl = cleanOneLine(input.trackUrl || input.audioUrl || input.url, '', 1200);
      }
      if (input.durationSeconds || input.duration) {
        state.current.durationSeconds = Math.max(1, Math.min(3600, Number(input.durationSeconds || input.duration)));
      }
      if (input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url) {
        state.current.coverImageUrl = cleanOneLine(input.coverImageUrl || input.coverUrl || input.imageUrl || input.image_url, '', 1200);
      }
      if (input.coverVideoUrl || input.videoUrl || input.video_url || input.clipUrl || input.clip_url) {
        state.current.coverVideoUrl = cleanOneLine(
          input.coverVideoUrl || input.videoUrl || input.video_url || input.clipUrl || input.clip_url,
          '',
          1200
        );
      }
      return { ok: Boolean(state.current.trackUrl), state: beginPlayback() };
    }
    if (action === 'rating') return { ok: true, state: beginRating() };
    if (action === 'interlude' || action === 'jukebox') return { ok: true, state: beginIdleJukebox({ rotate: true }) };
    if (action === 'next' || action === 'start') return { ok: true, state: startRound(input) };
    if (action === 'error') {
      const hasQueuedSuggestions = Array.isArray(state.pendingSuggestions) && state.pendingSuggestions.length > 0;
      setCurrentPhase('error', {
        phaseEndsAt: null,
        message: cleanOneLine(input.message, 'La composition a rencontré un problème.', 240),
      });
      if (hasQueuedSuggestions) {
        const recoveredState = startRound({
          title: 'Vivy Live',
          message: 'Erreur précédente absorbée: les idées en attente passent au vote.',
        });
        return { ok: true, recovered: true, state: recoveredState };
      }
      save();
      return { ok: true, state: publicState(state) };
    }
    return { ok: false, error: 'invalid_live_action', state: publicState(state) };
  }

  function resetLiveSession(input = {}) {
    const previous = state || createInitialState();
    const reason = cleanOneLine(input.reason, 'twitch_offline', 120);
    const resetAt = nowIso();
    const preserveSongs = input.preserveSongs !== false;
    const preserveJukebox = input.preserveJukebox === true;
    const preserveLearning = input.preserveLearning === true;
    const removed = {
      suggestions: Array.isArray(previous.round?.suggestions) ? previous.round.suggestions.length : 0,
      pendingSuggestions: Array.isArray(previous.pendingSuggestions) ? previous.pendingSuggestions.length : 0,
      recentMessages: Array.isArray(previous.recentMessages) ? previous.recentMessages.length : 0,
      stars: Array.isArray(previous.stars) ? previous.stars.length : 0,
      jukeboxTracks: preserveJukebox ? 0 : (Array.isArray(previous.jukebox?.tracks) ? previous.jukebox.tracks.length : 0),
      likedTerms: preserveLearning ? 0 : (Array.isArray(previous.learning?.likedTerms) ? previous.learning.likedTerms.length : 0),
    };
    const initial = createInitialState();
    const previousJukebox = previous.jukebox || {};
    const previousLearning = previous.learning || {};
    state = {
      ...initial,
      updatedAt: resetAt,
      current: {
        ...initial.current,
        title: cleanOneLine(input.title, 'Vivy Live', 120),
        phase: 'idle',
        phaseStartedAt: resetAt,
        message: cleanOneLine(input.message, 'Twitch offline: session live remise à zéro.', 240),
      },
      round: createRound(createShortId('round')),
      production: createProductionState(),
      jukebox: {
        ...initial.jukebox,
        ...(preserveJukebox ? previousJukebox : {}),
        tracks: preserveJukebox && Array.isArray(previousJukebox.tracks) ? previousJukebox.tracks : [],
      },
      songs: preserveSongs && Array.isArray(previous.songs) ? previous.songs : [],
      learning: {
        ...initial.learning,
        ...(preserveLearning ? previousLearning : {}),
      },
      stats: { ...initial.stats },
      pendingSuggestions: [],
      recentMessages: [],
      stars: [],
      twitch: {
        ...(previous.twitch || {}),
        online: false,
        lastOfflineAt: resetAt,
        lastResetAt: resetAt,
        lastResetReason: reason,
      },
    };
    let memory = { ok: true, removed: 0, skipped: true };
    if (input.clearMemory !== false) {
      try {
        memory = clearUserEpisodes('user:vivy-twitch-live', { typePrefix: 'vivy_' });
      } catch (error) {
        memory = { ok: false, error: String(error?.message || error), removed: 0 };
      }
    }
    save();
    return {
      ok: true,
      reset: true,
      reason,
      removed,
      memoryCleared: memory?.removed || 0,
      memoryOk: memory?.ok !== false,
      state: publicState(state),
    };
  }

  function connectSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, schema: STREAM_SCHEMA })}\n\n`);
    clients.add(res);
    broadcast();
    req.on('close', () => clients.delete(res));
  }

  load();
  return {
    getState: () => publicState(state),
    addChatMessage,
    startRound,
    lockRound,
    updateLive,
    resetLiveSession,
    startIdleJukebox: beginIdleJukebox,
    addJukeboxTrack,
    findSongByShareSlug,
    connectSse,
    peekNextClipMode,
    armNextClipMode,
    consumeNextClipMode,
  };
}

function isLocalRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function createWriteGuard() {
  return function guard(req, res, next) {
    const configuredSecret = String(process.env.VIVY_STREAM_SECRET || '').trim();
    const provided = String(req.get('x-vivy-stream-secret') || req.get('x-twitch-stream-secret') || req.body?.secret || '').trim();
    if (configuredSecret && provided) {
      const expected = Buffer.from(configuredSecret);
      const candidate = Buffer.from(provided);
      if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) {
        return next();
      }
    }
    if (!configuredSecret) {
      if ((process.env.NODE_ENV !== 'production') && (isLocalRequest(req) || process.env.VIVY_STREAM_ALLOW_UNSIGNED === '1')) {
        return next();
      }
      if (process.env.VIVY_STREAM_ALLOW_UNSIGNED === '1') return next();
    }
    return res.status(configuredSecret ? 401 : 503).json({
      ok: false,
      error: configuredSecret ? 'vivy_stream_secret_invalid' : 'vivy_stream_secret_missing',
      message: configuredSecret
        ? 'Secret live Vivy invalide.'
        : 'VIVY_STREAM_SECRET doit etre configure avant d accepter les messages Twitch.',
    });
  };
}

function buildLegacyOverlayHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vivy Live Overlay</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: transparent; color: #fff; overflow: hidden; }
    .wrap { width: 100vw; height: 100vh; box-sizing: border-box; padding: 28px; display: grid; align-content: end; gap: 14px; text-shadow: 0 2px 16px rgba(0,0,0,.72); }
    .panel { max-width: 760px; background: rgba(10, 5, 18, .72); border: 1px solid rgba(255, 119, 218, .5); border-radius: 8px; padding: 18px 20px; box-shadow: 0 20px 80px rgba(0,0,0,.35); backdrop-filter: blur(10px); }
    h1 { font-size: 30px; line-height: 1.05; margin: 0 0 8px; letter-spacing: 0; }
    .phase { color: #ff8fe8; font-weight: 800; text-transform: uppercase; font-size: 12px; }
    .message { margin: 0 0 12px; color: #f6d8ef; font-size: 16px; }
    ol { margin: 0; padding-left: 24px; display: grid; gap: 8px; }
    li { font-size: 18px; line-height: 1.2; }
    .meta { color: #ffd9f6; font-size: 13px; opacity: .86; }
    .stars { font-size: 18px; color: #ffd34d; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="panel">
      <div class="phase" id="phase">Vivy Live</div>
      <h1 id="title">Vivy Live</h1>
      <p class="message" id="message">Connexion au live...</p>
      <ol id="suggestions"></ol>
      <div class="meta" id="meta"></div>
    </section>
  </main>
  <script>
    const phase = document.getElementById('phase');
    const title = document.getElementById('title');
    const message = document.getElementById('message');
    const suggestions = document.getElementById('suggestions');
    const meta = document.getElementById('meta');
    function render(state) {
      const current = state.current || {};
      const round = state.round || {};
      phase.textContent = current.phase || 'live';
      title.textContent = current.title || 'Vivy Live';
      message.textContent = current.message || '';
      suggestions.innerHTML = '';
      (round.suggestions || []).slice(0, 5).forEach((entry) => {
        const li = document.createElement('li');
        const id = document.createElement('strong');
        id.textContent = entry.id || '';
        const body = document.createTextNode(' ' + (entry.text || ''));
        const details = document.createElement('div');
        details.className = 'meta';
        details.textContent = (entry.votes || 0) + ' votes · score ' + (entry.score || 0);
        if (entry.starAverage) {
          const stars = document.createElement('span');
          stars.className = 'stars';
          stars.textContent = ' ' + '★'.repeat(Math.max(1, Math.min(5, Math.round(entry.starAverage))));
          details.appendChild(stars);
        }
        li.appendChild(id);
        li.appendChild(body);
        li.appendChild(details);
        suggestions.appendChild(li);
      });
      const learning = state.learning || {};
      meta.textContent = 'Messages ' + (state.stats?.messages || 0) + ' · étoiles moyennes ' + (learning.averageStars || 0) + '/5 · mots aimés: ' + ((learning.likedTerms || []).slice(0, 8).join(', ') || 'en écoute');
    }
    const stream = new EventSource('/api/vivy/stream/events');
    stream.addEventListener('state', (event) => render(JSON.parse(event.data)));
    stream.onerror = () => { message.textContent = 'Overlay Vivy: reconnexion...'; };
  </script>
</body>
</html>`;
}

function buildOverlayHtml() {
  const overlayPath = path.join(__dirname, '../../public/vivy-live-overlay.html');
  try {
    return fs.readFileSync(overlayPath, 'utf8');
  } catch {
    return buildLegacyOverlayHtml();
  }
}

const VIVY_STREAM_IDENTITY_ASSETS = {
  'a11-agent-media-avatar': 'a11-agent-media-avatar.png',
  'a11-agent-media-card': 'a11-agent-media-card.png',
  'djeff-reference-01': 'djeff-reference-01.jpg',
  'djeff-reference-02': 'djeff-reference-02.jpg',
  'djeff-reference-03': 'djeff-reference-03.jpg',
  'djeff-reference-04': 'djeff-reference-04.jpg',
  'djeff-reference-05': 'djeff-reference-05.jpg',
  'k44-copilot-reference': 'k44-copilot-reference.png',
  'marvin-reference-brothers-01': 'marvin-reference-brothers-01.jpg',
  'marvin-reference-brothers-02': 'marvin-reference-brothers-02.jpg',
  'marvin-reference-brothers-03': 'marvin-reference-brothers-03.jpg',
  'marvin-reference-brothers-04': 'marvin-reference-brothers-04.jpg',
  'marvin-reference-family': 'marvin-reference-family.jpeg',
  'vivy-presence-musicale': 'vivy-presence-musicale.png',
};

function createVivyStreamRouter(options = {}) {
  const router = express.Router();
  let store = options.store || null;
  const autoGenerateEnabled = options.autoGenerateEnabled === true
    || (options.autoGenerateEnabled !== false && process.env.VIVY_STREAM_AUTOGENERATE_ENABLED === '1');
  const runner = options.runner || (autoGenerateEnabled
    ? createVivyStreamNossenRunner({
      updateLive: (input) => store.updateLive(input),
      buildSocialPromptContext: options.db && typeof options.db.query === 'function'
        ? async ({ topic, kind, limit }) => {
          const context = await buildAndStoreSocialPromptContext(options.db, {
            userId: resolveVivySocialContextUserId(process.env),
            topic,
            kind,
            limit,
          });
          return {
            context,
            promptText: formatSocialContextForPrompt(context),
          };
        }
        : null,
    })
    : null);
  const onRoundLocked = options.onRoundLocked || (runner
    ? (payload) => runner.start(payload)
    : null);
  if (!store) store = createVivyStreamStore({ ...options, onRoundLocked });
  const writeGuard = options.writeGuard || createWriteGuard();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'vivy-stream', schema: STREAM_SCHEMA });
  });

  router.get('/state', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(store.getState());
  });

  router.get('/songs', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    res.type('html').send(buildSongsArchiveHtml(store.getState()));
  });

  router.get('/songs.json', (_req, res) => {
    const state = store.getState();
    res.set('Cache-Control', 'public, max-age=15');
    res.json({
      ok: true,
      songs: Array.isArray(state.songs) ? state.songs : [],
      current: state.current || {},
      serverNow: state.serverNow || nowIso(),
    });
  });

  router.get('/download', async (req, res) => {
    const publicBaseUrl = process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me';
    const rawUrl = cleanOneLine(req.query.url, '', 1600);
    const kind = cleanOneLine(req.query.kind, 'media', 40);
    if (!isAllowedVivyStreamDownloadUrl(rawUrl, req, publicBaseUrl)) {
      return res.status(400).json({ ok: false, error: 'download_url_not_allowed' });
    }

    const origin = `${req.protocol || 'http'}://${req.get?.('host') || req.get('host') || '127.0.0.1'}`;
    const targetUrl = new URL(rawUrl, origin).toString();
    try {
      const upstream = await fetch(targetUrl, {
        headers: { 'User-Agent': 'VivyStreamDownloader/1.0' },
      });
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          ok: false,
          error: 'download_upstream_failed',
          status: upstream.status,
        });
      }

      const filename = safeDownloadFilename(targetUrl, kind);
      const contentType = upstream.headers.get('content-type') || inferMediaContentType(targetUrl);
      const contentLength = upstream.headers.get('content-length');
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', contentType);
      res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      if (contentLength) res.set('Content-Length', contentLength);

      if (upstream.body && typeof Readable.fromWeb === 'function') {
        await pipeline(Readable.fromWeb(upstream.body), res);
        return undefined;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return res.end(buffer);
    } catch (error) {
      console.warn('[VivyStreamDownload] failed', error?.message || error);
      return res.status(502).json({ ok: false, error: 'download_failed' });
    }
  });

  router.get('/s/:slug', (req, res) => {
    const song = store.findSongByShareSlug(req.params.slug || '');
    if (!song?.trackUrl) {
      return res.status(404).send('Vivy song not found');
    }
    res.set('Cache-Control', 'public, max-age=300');
    if (String(req.query.raw || '') === '1') return res.redirect(302, song.trackUrl);
    return res.type('html').send(buildSongShareHtml(song));
  });

  router.get('/s/:slug/paroles.txt', (req, res) => {
    const song = store.findSongByShareSlug(req.params.slug || '');
    if (!song?.trackUrl) {
      return res.status(404).send('Vivy song not found');
    }
    const lyrics = String(song.lyrics || '').trim();
    if (!lyrics) {
      return res.status(404).send('Paroles indisponibles pour ce morceau.');
    }
    const title = cleanTrackTitle(song.trackTitle || song.title, 'Morceau Vivy');
    const slug = cleanOneLine(req.params.slug, 'vivy', 180).replace(/[^a-z0-9-]/gi, '-');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="paroles-${slug}.txt"`);
    return res.send(`${title}\n${'='.repeat(Math.max(4, Math.min(60, title.length)))}\n\n${lyrics}\n`);
  });

  // Relique WAV/FLAC = master V9 dynamique à la demande. Règle canon:
  // MP3 live = preview rapide (Suno brut); WAV/FLAC = relique masterisée,
  // coffre, reprise future. Chaîne V9: highpass + loudnorm (hotter que le
  // preview, LRA préservé = dynamique) + limiter. Local, aucun appel payant.
  const buildV9DynamicMasterFilter = () => {
    if (['0', 'false', 'off', 'no'].includes(String(process.env.VIVY_RELIC_MASTER_DISABLED || '').trim().toLowerCase())
      || String(process.env.VIVY_RELIC_MASTER_DISABLED || '').trim() === '1') {
      return '';
    }
    const i = cleanOneLine(process.env.VIVY_RELIC_MASTER_LUFS, '-11', 12);
    const tp = cleanOneLine(process.env.VIVY_RELIC_MASTER_TP, '-1.0', 12);
    const lra = cleanOneLine(process.env.VIVY_RELIC_MASTER_LRA, '11', 12);
    return `highpass=f=30,loudnorm=I=${i}:TP=${tp}:LRA=${lra},alimiter=limit=0.97`;
  };
  router.get('/s/:slug/relic.:format', async (req, res) => {
    const format = String(req.params.format || '').toLowerCase();
    if (format !== 'wav' && format !== 'flac') {
      return res.status(404).json({ ok: false, error: 'relic_format_unsupported' });
    }
    const song = store.findSongByShareSlug(req.params.slug || '');
    if (!song?.trackUrl) {
      return res.status(404).send('Vivy song not found');
    }
    const publicBaseUrl = process.env.VIVY_PUBLIC_BASE_URL || 'https://vivy.funesterie.me';
    const sourceUrl = absolutizePublicUrl(song.trackUrl, publicBaseUrl);
    const slug = cleanOneLine(req.params.slug, 'vivy', 180).replace(/[^a-z0-9-]/gi, '-');
    const ffmpegBin = cleanOneLine(process.env.A11_VIDEO_FFMPEG_BIN || process.env.FFMPEG_BIN, 'ffmpeg', 400);
    try {
      const upstream = await fetch(sourceUrl, { signal: AbortSignal.timeout?.(30000) });
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ ok: false, error: 'relic_source_unavailable' });
      }
      const masterFilter = buildV9DynamicMasterFilter();
      const masterArgs = masterFilter ? ['-af', masterFilter] : [];
      const args = format === 'flac'
        ? ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...masterArgs, '-ac', '2', '-ar', '44100', '-c:a', 'flac', '-compression_level', '5', '-f', 'flac', 'pipe:1']
        : ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...masterArgs, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s24le', '-f', 'wav', 'pipe:1'];
      const ff = spawn(ffmpegBin, args, { stdio: ['pipe', 'pipe', 'inherit'] });
      let failed = false;
      ff.on('error', (error) => {
        failed = true;
        console.warn('[VivyRelic] ffmpeg spawn failed', error?.message || error);
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'relic_transcode_failed' });
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.set('Content-Type', format === 'flac' ? 'audio/flac' : 'audio/wav');
      res.set('Content-Disposition', `attachment; filename="relique-${slug}.${format}"`);
      ff.stdout.pipe(res);
      await pipeline(Readable.fromWeb(upstream.body), ff.stdin).catch(() => {});
      ff.on('close', () => { if (failed && !res.headersSent) res.status(500).end(); });
    } catch (error) {
      console.warn('[VivyRelic] failed', error?.message || error);
      if (!res.headersSent) return res.status(502).json({ ok: false, error: 'relic_failed' });
      return undefined;
    }
    return undefined;
  });

  router.get('/nossen-seed', (_req, res) => {
    res.json(buildNossenSeedFromRound(store.getState()));
  });

  router.get('/events', (req, res) => {
    store.connectSse(req, res);
  });

  router.get('/overlay', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.type('html').send(buildOverlayHtml());
  });

  router.get('/overlay/background', (_req, res) => {
    const backgroundPath = path.join(__dirname, '../../public/assets/vivy-presence-musicale.png');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(backgroundPath);
  });

  router.get('/identity/:asset', (req, res) => {
    const filename = VIVY_STREAM_IDENTITY_ASSETS[cleanOneLine(req.params.asset, '', 120)];
    if (!filename) return res.status(404).send('Vivy identity asset not found');
    const assetPath = path.join(__dirname, '../../public/assets', filename);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    return res.sendFile(assetPath);
  });

  router.post('/chat', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    res.json(store.addChatMessage(req.body || {}));
  });

  router.post('/event', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    res.json(store.addChatMessage(req.body || {}));
  });

  router.post('/round/start', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    res.json(store.startRound(req.body || {}));
  });

  router.post('/round/lock', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    const result = store.lockRound(req.body || {});
    res.status(result.ok ? 200 : 409).json(result);
  });

  router.get('/wardrobe', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ ok: true, wardrobe: loadWardrobe() });
  });

  router.post('/wardrobe/offer', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    const result = offerWardrobeGift(req.body?.gift || req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/wardrobe/decision', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    const result = recordWardrobeDecision(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/round/clip-mode', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    const body = req.body || {};
    const mode = cleanOneLine(body.mode || body.clipMode, '', 40).toLowerCase();
    const disarm = !mode || mode === 'off' || mode === 'none' || mode === 'default';
    const estimate = disarm ? null : estimateTwitchFullClipCost(process.env, { mode });
    if (body.confirm !== true) {
      return res.json({
        ok: true,
        armed: false,
        requiresConfirmation: !disarm,
        nextClipMode: store.peekNextClipMode(),
        estimate,
        message: disarm
          ? 'Envoyer confirm=true pour désarmer le mode clip one-shot.'
          : 'Estimation seulement: renvoyer confirm=true pour armer ce mode sur le prochain round.',
      });
    }
    const armed = store.armNextClipMode(disarm ? '' : mode);
    return res.json({
      ok: true,
      armed: Boolean(armed),
      nextClipMode: armed,
      estimate,
      message: armed
        ? `Mode clip ${armed} armé pour le prochain round uniquement.`
        : 'Mode clip one-shot désarmé; retour au mode configuré par env.',
    });
  });

  router.post('/round/generate', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    if (!runner) {
      return res.status(503).json({ ok: false, error: 'vivy_stream_autogenerate_disabled' });
    }
    const state = store.getState();
    const winner = state.round?.suggestions?.find((entry) => entry.id === state.round.winningSuggestionId)
      || state.round?.suggestions?.[0];
    if (!winner || state.round?.status !== 'locked') {
      return res.status(409).json({ ok: false, error: 'vivy_stream_round_not_locked' });
    }
    const started = runner.start({
      roundId: state.round.id,
      winner,
      nossenSeed: buildNossenSeedFromRound(state),
      clipMode: store.consumeNextClipMode(),
    });
    return res.status(started.started ? 202 : 409).json({
      ok: started.started,
      started: started.started,
      error: started.error,
      roundId: state.round.id,
    });
  });

  router.post('/control', express.json({ limit: '32kb' }), writeGuard, (req, res) => {
    const result = store.updateLive(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/reset', express.json({ limit: '16kb' }), writeGuard, (req, res) => {
    const result = store.resetLiveSession(req.body || {});
    res.status(result.ok ? 200 : 500).json(result);
  });

  return router;
}

module.exports = {
  STREAM_SCHEMA,
  buildSongShareHtml,
  buildSongsArchiveHtml,
  buildStreamDownloadPath,
  buildOverlayHtml,
  buildNossenSeedFromRound,
  createVivyStreamRouter,
  createVivyStreamStore,
  extractStarRating,
  isDuplicateStreamChatMessage,
  isAllowedVivyStreamDownloadUrl,
  parseVivyStreamChatMessage,
  resolveRoundMs,
  resolveVivyMoodTheme,
};
