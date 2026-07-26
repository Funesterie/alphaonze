'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { getCanonicalTtsDir, getPublicTtsDir } = require('../../lib/tts-paths.cjs');
const { extractRequestAuthToken } = require('../middleware/jwt-auth.cjs');
const {
  buildMediaPipeline,
  buildRoutingLines,
  getMediaAgentRoleMatrix,
} = require('../media/media-agent-roles.cjs');
const {
  createEmergencySongAsset,
  createEmergencyVideoAsset,
  getEmergencyMediaAssetPath,
  getEmergencyMediaAssetSubpath,
} = require('../media/emergency-media.cjs');
const { buildAgentsPersonaContext, buildDjeffSystemPrompt } = require('../persona/persona-engine.cjs');
const {
  addEpisode,
  getEpisodes,
  clearUserEpisodes,
} = require('../../lib/episodic-memory.cjs');
const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  detectTextLanguage,
  buildLanguageInstruction,
  buildLanguageContract,
  normalizeLanguageCode,
  resolveUserLanguage,
} = require('../../lib/language-text.cjs');
const {
  VIVY_SONG_MAX_CHARS,
  buildVivySongcraftSystemPrompt,
  buildVivySongProductionBrief,
  buildVivyStructuredLyrics,
  buildVivySongArtistCast,
  buildVivyVocalSegments,
  sanitizeVivySongMaterial,
  splitVivyArrangementCues,
  restoreVivyFrenchSongAccents,
  repairVivySemanticImageCoherence,
  inferTitle,
  stripSongCommand,
  looksLikeCompleteLyrics,
  looksLikeExplicitSunoLyricsBlock,
  hasVivyChorusSection,
} = require('../music/vivy-songcraft.cjs');
const {
  buildVivyProsodyPlan,
  buildVivyProsodyStyleHint,
  formatVivyProsodyPlanForBrief,
  formatVivyProsodyPlanForPrompt,
  stripLegacySignalTokens,
} = require('../vivy/prosody-prime-complex.cjs');
const {
  postProcessA11AssistantResponse,
} = require('../chat/response-draft-rewriter.cjs');
const {
  resolvePersonalSunoVoiceForRequest,
} = require('./voice-learning.cjs');
const {
  SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT,
} = require('../chat/symbolic-extraction-protocol.cjs');
const {
  FUNESTERIE_SOURCE_PRINCIPLE_CONTEXT_FR,
} = require('../chat/funesterie-source-principle.cjs');
const {
  autoDescribeImage,
  loadImageBuffer,
} = require('../image/image-auto-describe.cjs');
const {
  canUseMcpPermission,
  resolveMcpAccountProfileSync,
  TIERS,
} = require('../auth/mcp-account-tier.cjs');

let getJanusVisionStatus = null;
try {
  ({ getJanusVisionStatus } = require('../../lib/janus-vision-runtime.cjs'));
} catch (_) {
  getJanusVisionStatus = null;
}

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

const MODES = new Set(['voice', 'song', 'share']);
const CHAT_MODES = new Set(['chat', 'voice', 'song', 'share']);
const VIVY_CHAT_MAX_CHARS = 12000;
const VIVY_SESSION_MESSAGE_MAX_CHARS = VIVY_SONG_MAX_CHARS;
const VIVY_CHAT_SONG_MAX_TOKENS_DEFAULT = 6000;
const VIVY_CHAT_HISTORY_MAX_MESSAGES = 36;
const VIVY_CHAT_HISTORY_ENTRY_MAX_CHARS = 1200;
const VIVY_USER_HISTORY_MAX_MESSAGES = 18;
const VIVY_USER_HISTORY_ENTRY_MAX_CHARS = 900;
const VIVY_SONG_HISTORY_MAX_CHARS = 4800;
const VIVY_WORKSPACE_NOTE_MAX_CHARS = 6000;
const VIVY_WORKSPACE_CANVAS_MAX_CHARS = 9000;
const VIVY_WORKSPACE_CHROME_MAX_CHARS = 1800;
const VIVY_LOCAL_CONTEXT_SKIP_DIRS = new Set([
  '.git',
  '.codex-tmp',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  'dist',
  'build',
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
]);

function resolveVivySongMaxTokens(input = {}) {
  const requested = Number(
    input.songMaxTokens
    || input.song_max_tokens
    || input.lyricMaxTokens
    || input.lyric_max_tokens
    || input.maxSongTokens
    || input.max_song_tokens
    || 0
  );
  const configured = Number(process.env.VIVY_CHAT_MAX_TOKENS_SONG || VIVY_CHAT_SONG_MAX_TOKENS_DEFAULT);
  const ceiling = Math.max(3200, Number(process.env.VIVY_CHAT_MAX_TOKENS_SONG_CEILING || 9000) || 9000);
  const value = Number.isFinite(requested) && requested > 0 ? requested : configured;
  return Math.max(1200, Math.min(ceiling, Math.round(value)));
}

const VIVY_LOCAL_TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const VIVY_LOCAL_SECRET_RE = /(^|[\\/])(?:\.env(?:\..*)?|secrets?|credentials?|private|tokens?|passwords?|\.kiro[\\/]settings[\\/]mcp\.json)(?:[\\/]|$)|\.(?:pem|pfx|key)$/i;
const VIVY_TOOL_CAPABILITIES = [
  {
    id: 'vision.images',
    label: 'Vision images',
    trigger: 'png, jpg, webp, gif, image jointe',
    route: 'Janus Vision, puis fallback vision LLM si Janus ne voit que des métadonnées',
    limit: 'décrire seulement ce qui est visible; ne pas inventer depuis le nom du fichier',
  },
  {
    id: 'files.readable',
    label: 'Fichiers lisibles',
    trigger: 'txt, md, json, code, extrait de document, .zen avec aperçu fourni',
    route: 'contexte fichier A11: métadonnées, extrait, résumé, analyse jointe',
    limit: 'pas de secrets; demander le contenu manquant si le texte n’est pas disponible',
  },
  {
    id: 'web.search',
    label: 'Recherche web',
    trigger: 'information récente, site, doc, GitHub, npm, Docker, source externe',
    route: 'recherche web bornée côté backend, puis restitution sourcée',
    limit: 'ne pas recycler les sorties Codex/opérateur comme requête',
  },
  {
    id: 'local.context',
    label: 'Contexte local Funesterie',
    trigger: 'Janus, runtime, MCP, Qflush, code, corpus, Zen, Neo4j, encode/decode',
    route: 'lecture locale filtrée, racines sûres, indices courts, sans écriture automatique',
    limit: 'ne pas lire .env, clés, tokens, credentials, ni chemins privés sensibles',
  },
  {
    id: 'zen.corpus',
    label: 'Corpus Zen',
    trigger: '.zen, @funeste/zen, encode, decode, corpus',
    route: 'inspection du header public et routage encode/decode via @funeste/zen quand une clé autorisée existe',
    limit: 'ne jamais afficher la clé; ne pas décoder un corpus chiffré sans clé/session autorisée',
  },
  {
    id: 'model.gguf',
    label: 'Modèles GGUF',
    trigger: 'gguf, uggf, modèle local, poids, quantization',
    route: 'inventaire local métadonnées: chemin relatif sûr, taille, magic/version quand lisible',
    limit: 'pas de dump de poids, pas de contournement de licence, pas de décompilation brute',
  },
  {
    id: 'audio.voice',
    label: 'Voix et audio',
    trigger: 'micro, STT, TTS, XTTS/RVC, voix Vivy/Djeff/A11/K44',
    route: 'pipeline audio A11: référence privée, TTS/XTTS/RVC, fallback navigateur contrôlé',
    limit: 'références vocales consenties; ne pas imiter une personne protégée sans droit',
  },
  {
    id: 'commands.intent',
    label: 'Commandes internes',
    trigger: 'outil, commande, action, MCP, Qflush, Neo4j',
    route: 'intent borné vers backend/MCP/agents; pas de shell arbitraire depuis Vivy public',
    limit: 'confirmation ou opérateur requis pour écriture, suppression, secret, infra et coûts',
  },
  {
    id: 'security.sudoku-token',
    label: 'Session créative Sudoku Cerbère',
    trigger: 'token sudoku, session créative Djeff/Vivy, validation Marvin',
    route: 'challenge Sudoku côté serveur, approbation séparée Marvin, puis jeton court et limité',
    limit: 'aucune clé maître; secrets, coûts, publication, deploy, données cross-compte et hardware restent hors périmètre',
  },
];

function cleanText(value, max = 2000) {
  return normalizeTextNfc(value, max);
}

function cleanOneLine(value, fallback = '', max = 160) {
  return normalizeOneLineNfc(value, fallback, max);
}

function parseMode(value) {
  const mode = cleanOneLine(value, 'song', 24).toLowerCase();
  return MODES.has(mode) ? mode : 'song';
}

function parseVivyChatMode(value) {
  const mode = cleanOneLine(value, '', 24).toLowerCase();
  return CHAT_MODES.has(mode) ? mode : 'chat';
}

function resolveVivyChatMode(input = {}, message = '') {
  const rawMode = cleanOneLine(input.mode, '', 24);
  if (rawMode && parseVivyChatMode(rawMode) !== 'chat') return parseVivyChatMode(rawMode);
  if (looksLikeCompleteLyrics(message)) return 'song';
  if (isDirectSongwritingRequest(message)) return 'song';
  if (rawMode) return 'chat';
  return inferVivyChatMode(cleanVivyMessageForIntent(message));
}

function lineList(items) {
  return items.filter(Boolean).map((item) => `- ${item}`).join('\n');
}

function compactUniqueLines(items, max = 2400) {
  const seen = new Set();
  const lines = [];

  for (const item of items) {
    const value = cleanText(item, max);
    if (!value) continue;

    const key = foldTextForLookup(value);
    if (seen.has(key)) continue;

    seen.add(key);
    lines.push(value);
  }

  return cleanText(lines.join('\n\n'), max);
}

function redactVivyAgentBriefSecrets(value = '') {
  return String(value || '')
    .replace(/https?:\/\/[^\s<>"')]+/gi, (url) => {
      if (/[?&](?:token|key|signature|sig|access_token)=/i.test(url)) return '[lien média sécurisé masqué]';
      if (/\/api\/double-harmonic\/out\//i.test(url)) return '[lien média D40 masqué]';
      return url.replace(/[?&].*$/, '');
    })
    .replace(/\b(?:token|key|signature|sig|access_token)=\S+/gi, (match) => `${match.split('=')[0]}=[masqué]`);
}

function cleanVivyAgentBrief(value = '', max = 6000) {
  return cleanText(redactVivyAgentBriefSecrets(value), max);
}

function cleanVivyMessageForIntent(value = '') {
  const raw = cleanText(value, VIVY_SONG_MAX_CHARS);
  if (!raw) return '';
  if (!/\bVIVY_|VIVY\s+PRODUCTION|Mix D40|double-harmonic|Même format prêt|Meme format pret|token=/i.test(raw)) {
    return raw;
  }
  const songMaterial = sanitizeVivySongMaterial(raw, VIVY_SONG_MAX_CHARS);
  return cleanText(songMaterial || redactVivyAgentBriefSecrets(raw), VIVY_SONG_MAX_CHARS);
}

function isVivyInternalPublicLeakLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return false;
  if (/\b(vivy_studio_handoff|vivy_song_production|vivy_voice_calibration|vivy_scene_share|vivy_production)\b/.test(folded)) return true;
  if (/^(atelier|objectif|routage|routage recommande|brief agents|production plan|paroles guide)\b/.test(folded)) return true;
  if (/^(ce que je comprends|je capte|message utilisateur|demande recue)\b/.test(folded) && /\b(vivy_|atelier|routage|j espere|token)\b/.test(folded)) return true;
  if (/\b(j espere que cette chanson|j espere que cela|j espere que ca|n hesite pas a|n hesitez pas)\b/.test(folded)) return true;
  return false;
}

function sanitizeVivyPublicText(value = '', max = VIVY_CHAT_MAX_CHARS) {
  const text = cleanText(redactVivyAgentBriefSecrets(value), Math.max(max, 2200));
  if (!text) return '';
  const kept = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (isVivyInternalPublicLeakLine(trimmed)) continue;
    if (typeof isVivyPublicLyricsNoiseLine === 'function' && isVivyPublicLyricsNoiseLine(trimmed)) continue;
    kept.push(trimmed);
  }
  return cleanText(kept.join('\n').replace(/\n{3,}/g, '\n\n'), max);
}

function stripVivyAscii4SoundTokens(value = '', max = 2600) {
  return cleanText(stripLegacySignalTokens(value, max), max);
}

function hashShort(value, max = 24) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, max);
}

function slugify(value = '', fallback = 'vivy') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function readFirstSecretValue(fileCandidates = [], envCandidates = []) {
  for (const candidate of fileCandidates.filter(Boolean)) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Secret file is optional.
    }
  }
  for (const name of envCandidates.filter(Boolean)) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getElevenLabsMusicApiKey() {
  return readFirstSecretValue(
    [
      process.env.VIVY_ELEVENLABS_API_KEY_FILE,
      process.env.A11_ELEVENLABS_API_KEY_FILE,
      process.env.ELEVENLABS_API_KEY_FILE,
      '/app/runtime/secrets/elevenlabs_api_key',
    ],
    ['VIVY_ELEVENLABS_API_KEY', 'A11_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY', 'XI_API_KEY']
  );
}

function getElevenLabsBaseUrl() {
  return String(
    process.env.VIVY_ELEVENLABS_BASE_URL
    || process.env.A11_ELEVENLABS_BASE_URL
    || process.env.ELEVENLABS_BASE_URL
    || 'https://api.elevenlabs.io/v1'
  ).trim().replace(/\/$/, '');
}

function getSunoApiKey() {
  return readFirstSecretValue(
    [
      process.env.VIVY_SUNO_API_KEY_FILE,
      process.env.SUNO_API_KEY_FILE,
      '/app/runtime/secrets/suno_api_key',
    ],
    ['VIVY_SUNO_API_KEY', 'SUNO_API_KEY', 'SUNO_TOKEN']
  );
}

function getMurekaApiKey() {
  return readFirstSecretValue(
    [
      process.env.VIVY_MUREKA_API_KEY_FILE,
      process.env.MUREKA_API_KEY_FILE,
      '/app/runtime/secrets/mureka_api_key',
    ],
    ['VIVY_MUREKA_API_KEY', 'MUREKA_API_KEY']
  );
}

function getMurekaBaseUrl() {
  return String(
    process.env.VIVY_MUREKA_BASE_URL
    || process.env.MUREKA_API_URL
    || 'https://api.mureka.ai'
  ).trim().replace(/\/$/, '');
}

function sanitizeSessionSunoApiKey(value = '') {
  const key = String(value || '').trim();
  if (!key || key.length < 8 || key.length > 600) return '';
  if (/[\r\n\t ]/.test(key)) return '';
  return key;
}

function getRequestSessionSunoApiKey(input = {}, req = null) {
  return sanitizeSessionSunoApiKey(
    input.sessionSunoApiKey
    || input.sunoApiKey
    || input.personalSunoApiKey
    || req?.get?.('x-vivy-suno-key')
    || req?.get?.('x-suno-api-key')
    || ''
  );
}

function resolvePreferredServerSunoPersonaBinding(input = {}, req = null) {
  if (input.preserveSelectedVoice === false || !canUseServerSuno(req)) return null;
  const artistCast = buildVivySongArtistCast(input);
  if (artistCast.count !== 1) return null;
  const artistId = cleanOneLine(artistCast.ids[0], '', 40).toLowerCase();

  // Official Funesterie voices are enrolled, consented server-side identities.
  // Keep their provider persona paired with the server key instead of mixing it
  // with a stale browser key (which silently yields a random singer). A linked
  // personal slot remains separate; Djeff keeps priority when explicitly cast.
  const officialArtistIds = new Set(['djeff', 'marvin', 'vivy', 'a11', 'k44', 'kaen44']);
  if (!officialArtistIds.has(artistId)) return null;
  if (artistId !== 'djeff' && wantsPersonalSunoVoice(input)) return null;
  const voiceId = resolveConfiguredVivySunoPersonaVoiceId(artistId);
  const apiKey = getSunoApiKey();
  if (!voiceId || !apiKey) return null;
  return { artistId, voiceId, apiKey };
}

function getSunoAccess(input = {}, req = null) {
  const preferredPersona = resolvePreferredServerSunoPersonaBinding(input, req);
  if (preferredPersona) {
    return {
      apiKey: preferredPersona.apiKey,
      source: 'server',
      adminOnly: true,
      personaArtistId: preferredPersona.artistId,
      personaBound: true,
    };
  }
  const sessionKey = getRequestSessionSunoApiKey(input, req);
  if (sessionKey) {
    return { apiKey: sessionKey, source: 'session', adminOnly: false };
  }
  return { apiKey: getSunoApiKey(), source: 'server', adminOnly: true };
}

function canUseServerSuno(req = null) {
  const user = req?.user || {};
  if (isVivyFounderUser(user)) return true;
  const values = [
    user?.role,
    user?.tier,
    user?.plan,
    user?.subscriptionTier,
    user?.subscription_tier,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return values.some((value) => /\b(premium|famille|family|founder|fondateur|admin_family)\b/i.test(value));
}

function getSunoBaseUrl() {
  return String(
    process.env.VIVY_SUNO_BASE_URL
    || process.env.SUNO_BASE_URL
    || 'https://api.sunoapi.org/api/v1'
  ).trim().replace(/\/$/, '');
}

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isElevenLabsMusicConfigured() {
  if (envFlag('VIVY_ELEVENLABS_MUSIC_DISABLED') || envFlag('ELEVENLABS_MUSIC_DISABLED')) return false;
  if (!envFlag('VIVY_ELEVENLABS_MUSIC_ENABLED') && !envFlag('ELEVENLABS_MUSIC_ENABLED')) return false;
  return Boolean(getElevenLabsMusicApiKey());
}

function isSunoMusicConfigured() {
  if (envFlag('VIVY_SUNO_DISABLED') || envFlag('SUNO_DISABLED')) return false;
  return Boolean(getSunoApiKey());
}

function isMurekaMusicConfigured() {
  if (envFlag('VIVY_MUREKA_DISABLED') || envFlag('MUREKA_DISABLED')) return false;
  return Boolean(getMurekaApiKey());
}

function getVivySunoRuntimeStatus() {
  const model = cleanOneLine(process.env.VIVY_SUNO_MODEL || 'V5_5', 'V5_5', 40).toUpperCase();
  return {
    model,
    mode: /^V(?:4|5)(?:_|$)/.test(model) ? 'production' : 'custom',
    voiceEnrolled: Boolean(resolveConfiguredVivySunoPersonaVoiceId('vivy')),
    voicesEnrolled: {
      vivy: Boolean(resolveConfiguredVivySunoPersonaVoiceId('vivy')),
      djeff: Boolean(resolveConfiguredVivySunoPersonaVoiceId('djeff')),
      marvin: Boolean(resolveConfiguredVivySunoPersonaVoiceId('marvin')),
      a11: Boolean(resolveConfiguredVivySunoPersonaVoiceId('a11')),
      k44: Boolean(resolveConfiguredVivySunoPersonaVoiceId('k44')),
    },
    completeSongByDefault: true,
  };
}

function resolveConfiguredVivySunoPersonaVoiceId(artistId = '') {
  const id = cleanOneLine(artistId, '', 40).toLowerCase();
  if (id === 'djeff') {
    return cleanOneLine(
      process.env.VIVY_SUNO_DJEFF_VOICE_ID
      || process.env.SUNO_DJEFF_VOICE_ID
      || process.env.A11_SUNO_DJEFF_VOICE_ID,
      '',
      180
    );
  }
  if (id === 'marvin' || id === 'frere' || id === 'frère' || id === 'brother') {
    return cleanOneLine(
      process.env.VIVY_SUNO_MARVIN_VOICE_ID
      || process.env.VIVY_SUNO_FRERE_VOICE_ID
      || process.env.VIVY_SUNO_FRERE_FAMILY_VOICE_ID
      || process.env.SUNO_MARVIN_VOICE_ID
      || process.env.SUNO_FRERE_VOICE_ID
      || process.env.A11_SUNO_MARVIN_VOICE_ID,
      '',
      180
    );
  }
  if (id === 'a11') {
    return cleanOneLine(
      process.env.VIVY_SUNO_A11_VOICE_ID
      || process.env.SUNO_A11_VOICE_ID
      || process.env.A11_SUNO_A11_VOICE_ID,
      '',
      180
    );
  }
  if (id === 'k44' || id === 'kaen44') {
    return cleanOneLine(
      process.env.VIVY_SUNO_K44_VOICE_ID
      || process.env.VIVY_SUNO_KAEN44_VOICE_ID
      || process.env.SUNO_K44_VOICE_ID
      || process.env.SUNO_KAEN44_VOICE_ID
      || process.env.A11_SUNO_K44_VOICE_ID,
      '',
      180
    );
  }
  return cleanOneLine(process.env.VIVY_SUNO_VOICE_ID || process.env.SUNO_VOICE_ID, '', 180);
}

function wantsPersonalSunoVoice(input = {}) {
  if (input.usePersonalSunoVoice === true || input.personalSunoVoice === true) return true;
  const folded = foldTextForLookup([
    input.sunoVoiceScope,
    input.voicePersona,
    input.voiceLearningPersona,
    input.voiceTool,
    input.vocalCast,
    input.songSource,
  ].filter(Boolean).join('\n'));
  return /\b(?:personal|personal voice|my voice|myvoice|ma voix|voix perso|voix personnelle|compte connecte|compte connecté)\b/.test(folded)
    && /\b(?:suno|voiceid|voice id|persona|voix)\b/.test(folded);
}

function resolvePersonalSunoVoiceIdForPayload(input = {}, req = null) {
  if (!wantsPersonalSunoVoice(input) || !req) return null;
  try {
    return resolvePersonalSunoVoiceForRequest(req);
  } catch {
    return null;
  }
}

function getConfiguredMusicProviders() {
  const preferred = cleanOneLine(process.env.VIVY_MUSIC_PROVIDER || process.env.VIVY_MUSIC_PROVIDERS, '', 160)
    .toLowerCase()
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const order = preferred.length ? preferred : ['suno'];
  return order.filter((provider, index, list) => list.indexOf(provider) === index);
}

function isVivyFounderUser(user = {}) {
  if (envFlag('VIVY_MUSIC_ALLOW_NON_ADMIN')) return true;
  const values = [
    user?.id,
    user?.email,
    user?.username,
    user?.displayName,
    user?.role,
    user?.tier,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return user?.isAdmin === true
    || user?.admin === true
    || user?.fullAccess === true
    || values.some((value) => /\b(admin|owner|founder|fondateur|djeff|jeffrey|funeste)\b/i.test(value));
}

function getVivyProviderFromBaseUrl(baseURL = '') {
  if (/ollama|(?:127\.0\.0\.1|localhost):11434/i.test(baseURL)) return 'ollama';
  if (/groq/i.test(baseURL)) return 'groq';
  if (/openrouter\.ai/i.test(baseURL)) return 'openrouter';
  if (/generativelanguage\.googleapis\.com|gemini/i.test(baseURL)) return 'gemini';
  if (/deepseek/i.test(baseURL)) return 'deepseek';
  if (/together/i.test(baseURL)) return 'together';
  if (/huggingface|hf\.co/i.test(baseURL)) return 'huggingface';
  if (/x\.ai|grok/i.test(baseURL)) return 'xai';
  return 'openai';
}

function getVivyLocalOllamaConfigs(options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const purpose = cleanOneLine(options.purpose, '', 40).toLowerCase();
  const rawBaseURL = cleanOneLine(
    process.env.VIVY_OLLAMA_BASE_URL
      || process.env.A11_OLLAMA_BASE
      || process.env.OLLAMA_BASE,
    '',
    300
  ).replace(/\/+$/, '');
  if (!rawBaseURL) return [];

  const baseURL = /\/v1$/i.test(rawBaseURL) ? rawBaseURL : `${rawBaseURL}/v1`;
  const fastNossenLocalOnly = mode === 'song'
    && purpose === 'lyrics'
    && !['0', 'false', 'off', 'no'].includes(
      String(process.env.VIVY_NOSSEN_FAST_LOCAL_ONLY || 'true').trim().toLowerCase()
    );
  const routingPurpose = mode === 'song' && ['intent', 'routing'].includes(purpose);
  const fastNossenModel = routingPurpose
    ? (
      process.env.VIVY_CHAT_LOCAL_MODEL
      || process.env.A11_OLLAMA_FALLBACK_MODEL
      || process.env.VIVY_SONG_LOCAL_MODEL
      || process.env.A11_OLLAMA_PRIMARY_MODEL
    )
    : (
      process.env.VIVY_NOSSEN_LOCAL_MODEL
      || process.env.VIVY_SONG_LOCAL_MODEL
      || process.env.VIVY_CHAT_LOCAL_MODEL
      || process.env.A11_OLLAMA_FALLBACK_MODEL
      || process.env.A11_OLLAMA_PRIMARY_MODEL
    );
  const configuredModels = mode === 'song'
    ? (fastNossenLocalOnly || routingPurpose
      ? [fastNossenModel]
      : [
        process.env.VIVY_SONG_LOCAL_MODEL,
        process.env.A11_OLLAMA_STRONG_SONG_MODEL,
        process.env.A11_OLLAMA_PRIMARY_MODEL,
        process.env.VIVY_CHAT_LOCAL_MODEL,
        process.env.A11_OLLAMA_FALLBACK_MODEL,
        process.env.LOCAL_DEFAULT_MODEL,
      ])
    : [
      process.env.VIVY_CHAT_LOCAL_MODEL,
      process.env.A11_OLLAMA_CHAT_MODEL,
      process.env.A11_OLLAMA_PRIMARY_MODEL,
      process.env.A11_OLLAMA_FALLBACK_MODEL,
      process.env.LOCAL_DEFAULT_MODEL,
    ];
  const models = configuredModels
    .map((value) => cleanOneLine(value, '', 120))
    .filter((value, index, list) => value && !/embed/i.test(value) && list.indexOf(value) === index);
  if (!models.length) models.push('llama3.2:3b');
  const chatTimeoutMs = Math.max(1000, Number(
    process.env.VIVY_CHAT_LOCAL_TIMEOUT_MS
    || process.env.A11_LOCAL_CHAT_TIMEOUT_MS
    || process.env.A11_OLLAMA_CHAT_TIMEOUT_MS
    || 90000
  ) || 90000);
  const songTimeoutMs = routingPurpose
    ? Math.max(1000, Number(process.env.VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS || 20000) || 20000)
    : fastNossenLocalOnly
      ? Math.max(1000, Number(process.env.VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS || 40000) || 40000)
      : Math.max(1000, Number(process.env.A11_LOCAL_SONG_TIMEOUT_MS || 180000) || 180000);
  const chatMaxPromptChars = Math.max(6000, Math.min(
    14000,
    Number(process.env.VIVY_CHAT_LOCAL_MAX_PROMPT_CHARS || 10000) || 10000
  ));
  const chatMaxOutputTokens = Math.max(256, Math.min(
    1200,
    Number(process.env.VIVY_CHAT_LOCAL_MAX_TOKENS || 800) || 800
  ));
  const songMaxOutputTokens = routingPurpose
    ? Math.max(128, Math.min(700, Number(process.env.VIVY_NOSSEN_ROUTER_MAX_TOKENS || 520) || 520))
    : fastNossenLocalOnly
      ? Math.max(420, Math.min(2200, Number(process.env.VIVY_NOSSEN_LOCAL_MAX_TOKENS || 560) || 560))
      : 0;

  return models.map((model) => ({
    baseURL,
    apiKey: String(process.env.OLLAMA_API_KEY || 'ollama-local').trim(),
    model,
    provider: 'ollama',
    source: 'ollama-openai-compatible',
    timeoutMs: mode === 'song' ? songTimeoutMs : chatTimeoutMs,
    // Un prompt song non borné sur un 7b local se paye en dizaines de secondes de latence.
    maxPromptChars: mode === 'song'
      ? Math.max(6000, Math.min(32000, Number(process.env.VIVY_SONG_LOCAL_MAX_PROMPT_CHARS || 16000) || 16000))
      : chatMaxPromptChars,
    maxOutputTokens: mode === 'song' ? songMaxOutputTokens : chatMaxOutputTokens,
    maxRetries: 0,
  }));
}

function getVivyLocalOllamaConfig(options = {}) {
  return getVivyLocalOllamaConfigs(options)[0] || null;
}

function getVivyOllamaCloudConfig(options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const purpose = cleanOneLine(options.purpose, '', 40).toLowerCase();
  if (!envFlag('OLLAMA_CLOUD_ENABLED')) return null;
  const lyricsMode = mode === 'song' && purpose === 'lyrics';
  const chatMode = mode !== 'song' && envFlag('OLLAMA_CLOUD_CHAT_ENABLED');
  if (!lyricsMode && !chatMode) return null;

  const apiKey = String(process.env.OLLAMA_API_KEY || '').trim();
  if (!apiKey) return null;

  const model = lyricsMode
    ? cleanOneLine(process.env.OLLAMA_CLOUD_LYRICS_MODEL, 'gpt-oss:120b', 120)
    : cleanOneLine(
      process.env.OLLAMA_CLOUD_CHAT_MODEL
        || process.env.OLLAMA_CLOUD_FAST_MODEL
        || process.env.OLLAMA_CLOUD_LYRICS_MODEL,
      'gpt-oss:120b',
      120
    );
  const thinkLevel = lyricsMode
    ? cleanOneLine(process.env.OLLAMA_CLOUD_THINK_LEVEL, 'medium', 12).toLowerCase()
    : cleanOneLine(
      process.env.OLLAMA_CLOUD_CHAT_THINK_LEVEL
        || process.env.OLLAMA_CLOUD_THINK_LEVEL,
      'high',
      12
    ).toLowerCase();
  const timeoutMs = lyricsMode
    ? Math.max(240000, Math.min(
      480000,
      Number(process.env.OLLAMA_CLOUD_LYRICS_TIMEOUT_MS || 360000) || 360000
    ))
    : Math.max(60000, Math.min(
      480000,
      Number(process.env.OLLAMA_CLOUD_CHAT_TIMEOUT_MS || 300000) || 300000
    ));

  return {
    baseURL: cleanOneLine(process.env.OLLAMA_CLOUD_BASE_URL, 'https://ollama.com', 300).replace(/\/+$/, ''),
    apiKey,
    model,
    provider: 'ollama_cloud',
    source: 'ollama-cloud-api',
    thinkLevel,
    timeoutMs,
    maxPromptChars: lyricsMode
      ? Math.max(10000, Math.min(30000, Number(process.env.VIVY_NOSSEN_120B_MAX_PROMPT_CHARS || 22000) || 22000))
      : 0,
    maxOutputTokens: lyricsMode
      ? Math.max(900, Math.min(2600, Number(process.env.VIVY_NOSSEN_120B_MAX_TOKENS || 1800) || 1800))
      : 0,
    maxCalls: 1,
  };
}

function getVivyCerbereSongConfig(options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const purpose = cleanOneLine(options.purpose, '', 40).toLowerCase();
  if (mode !== 'song' || purpose !== 'lyrics' || !envFlag('VIVY_SONG_CERBERE_FALLBACK_ENABLED')) return null;

  const baseURL = cleanOneLine(
    process.env.A11_CERBERE_OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL,
    'https://openrouter.ai/api/v1',
    300
  ).replace(/\/+$/, '');
  const apiKey = String(
    process.env.A11_CERBERE_OPENAI_API_KEY
      || process.env.OPENROUTER_API_KEY
      || ''
  ).trim();
  if (!baseURL || !apiKey) return null;

  return {
    baseURL,
    apiKey,
    model: cleanOneLine(
      process.env.VIVY_SONG_CERBERE_MODEL || process.env.A11_CERBERE_OPENAI_MODEL,
      'openai/gpt-oss-120b',
      120
    ),
    provider: 'cerbere',
    source: 'cerbere-openai-compatible',
    timeoutMs: Math.max(30000, Number(process.env.VIVY_SONG_CERBERE_TIMEOUT_MS || 240000) || 240000),
    maxCalls: 1,
    maxRetries: 0,
  };
}

function getVivyOpenAIConfig(options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const groqApiKey = process.env.VIVY_GROQ_API_KEY || process.env.GROQ_API_KEY || '';
  const songGroqApiKey = process.env.VIVY_SONG_GROQ_API_KEY || groqApiKey;
  const xaiApiKey = process.env.VIVY_XAI_API_KEY || process.env.XAI_API_KEY || process.env.X_AI_API_KEY || '';
  const providerHint = cleanOneLine(process.env.VIVY_CHAT_PROVIDER || process.env.VIVY_LLM_PROVIDER || '', '', 40).toLowerCase();
  const songProviderHint = cleanOneLine(process.env.VIVY_SONG_PROVIDER || '', '', 40).toLowerCase();
  const effectiveProviderHint = mode === 'song' ? (songProviderHint || providerHint) : providerHint;
  const explicitVivyBaseURL = cleanOneLine(process.env.VIVY_OPENAI_BASE_URL, '', 300);
  const explicitSongBaseURL = cleanOneLine(process.env.VIVY_SONG_OPENAI_BASE_URL || process.env.VIVY_SONG_BASE_URL, '', 300);
  const explicitBaseURL = (mode === 'song' && explicitSongBaseURL) || explicitVivyBaseURL;
  const wantsXai = /^(xai|x-ai|grok)$/.test(effectiveProviderHint)
    || /x\.ai|grok/i.test(explicitBaseURL);
  const wantsSongGroq = mode === 'song' && Boolean(songGroqApiKey) && !wantsXai;
  const baseURL = (mode === 'song' && explicitSongBaseURL)
    || explicitVivyBaseURL
    || (wantsXai && xaiApiKey ? 'https://api.x.ai/v1' : '')
    || (wantsSongGroq || groqApiKey ? 'https://api.groq.com/openai/v1' : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'));
  const normalizedBaseUrl = String(baseURL || '');
  const apiKey = /groq/i.test(normalizedBaseUrl)
    ? ((mode === 'song' ? songGroqApiKey : groqApiKey) || process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
    : (/x\.ai|grok/i.test(normalizedBaseUrl)
      ? (xaiApiKey || process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
    : (/openrouter\.ai/i.test(normalizedBaseUrl)
      ? (process.env.VIVY_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
      : (process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.A11_OPENAI_API_KEY)));
  const defaultModel = /groq/i.test(normalizedBaseUrl)
    ? (mode === 'song'
      ? (process.env.VIVY_SONG_GROQ_MODEL || process.env.VIVY_GROQ_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
      : (process.env.VIVY_GROQ_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'))
    : (/x\.ai|grok/i.test(normalizedBaseUrl)
      ? (process.env.VIVY_XAI_MODEL || process.env.XAI_MODEL || 'grok-4.3')
    : (/openrouter\.ai/i.test(normalizedBaseUrl)
      ? 'meta-llama/llama-3.3-70b-instruct'
      : 'gpt-4o-mini'));
  const model = cleanOneLine(
    mode === 'song'
      ? (process.env.VIVY_SONG_MODEL || process.env.VIVY_SONG_OPENAI_MODEL || defaultModel)
      : (process.env.VIVY_CHAT_MODEL || process.env.VIVY_OPENAI_MODEL || defaultModel),
    defaultModel,
    80
  );

  // Sans budget, fitVivyChatRequestForBundle ne tronque rien (0 == illimité) et le prompt
  // song complet part tel quel: Groq répond alors 413 et toute la chaîne bascule sur les
  // providers lents, ce qui fait dépasser le timeout ~100s du proxy Cloudflare.
  const maxPromptChars = mode === 'song'
    ? Math.max(8000, Math.min(48000, Number(process.env.VIVY_SONG_PRIMARY_MAX_PROMPT_CHARS || 24000) || 24000))
    : Math.max(6000, Math.min(48000, Number(process.env.VIVY_CHAT_PRIMARY_MAX_PROMPT_CHARS || 18000) || 18000));

  return {
    baseURL,
    apiKey: String(apiKey || '').trim(),
    model,
    provider: getVivyProviderFromBaseUrl(normalizedBaseUrl),
    source: getVivyProviderFromBaseUrl(normalizedBaseUrl) === 'groq'
      ? 'groq-openai-compatible'
      : getVivyProviderFromBaseUrl(normalizedBaseUrl) === 'openrouter'
        ? 'openrouter-openai-compatible'
        : getVivyProviderFromBaseUrl(normalizedBaseUrl) === 'xai'
          ? 'xai-openai-compatible'
          : 'openai-compatible',
    maxPromptChars,
    maxRetries: 0,
  };
}

function getVivyCloudProviderConfig(provider, options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const songMode = mode === 'song';
  const normalizedProvider = cleanOneLine(provider, '', 40).toLowerCase();
  const definitions = {
    groq: {
      baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      apiKey: songMode
        ? (process.env.VIVY_SONG_GROQ_API_KEY || process.env.VIVY_GROQ_API_KEY || process.env.GROQ_API_KEY)
        : (process.env.VIVY_GROQ_API_KEY || process.env.GROQ_API_KEY),
      model: songMode
        ? (process.env.VIVY_SONG_GROQ_MODEL || process.env.VIVY_GROQ_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
        : (process.env.VIVY_GROQ_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
    },
    openai: {
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.A11_OPENAI_API_KEY
        || process.env.OPENAI_API_KEY
        || ((!process.env.VIVY_OPENAI_BASE_URL
          && !(songMode && (process.env.VIVY_SONG_OPENAI_BASE_URL || process.env.VIVY_SONG_BASE_URL)))
          ? process.env.VIVY_OPENAI_API_KEY
          : ''),
      model: songMode
        ? (process.env.VIVY_SONG_OPENAI_MODEL || process.env.OPENAI_MODEL || process.env.A11_OPENAI_MODEL || 'gpt-4o-mini')
        : (process.env.VIVY_OPENAI_MODEL || process.env.OPENAI_MODEL || process.env.A11_OPENAI_MODEL || 'gpt-4o-mini'),
    },
    gemini: {
      baseURL: process.env.GEMINI_OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY,
      model: songMode
        ? (process.env.VIVY_SONG_GEMINI_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_GENAI_MODEL || 'gemini-2.5-flash')
        : (process.env.VIVY_GEMINI_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_GENAI_MODEL || 'gemini-2.5-flash'),
    },
    deepseek: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: songMode
        ? (process.env.VIVY_SONG_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat')
        : (process.env.VIVY_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    },
    together: {
      baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
      apiKey: process.env.TOGETHER_API_KEY,
      model: songMode
        ? (process.env.VIVY_SONG_TOGETHER_MODEL || process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo')
        : (process.env.VIVY_TOGETHER_MODEL || process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo'),
    },
    xai: {
      baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
      apiKey: process.env.VIVY_XAI_API_KEY || process.env.XAI_API_KEY || process.env.X_AI_API_KEY,
      model: songMode
        ? (process.env.VIVY_SONG_XAI_MODEL || process.env.VIVY_XAI_MODEL || process.env.XAI_MODEL || 'grok-3-fast')
        : (process.env.VIVY_XAI_MODEL || process.env.XAI_MODEL || 'grok-3-fast'),
    },
    huggingface: {
      baseURL: process.env.HF_BASE_URL || 'https://api-inference.huggingface.co/v1',
      apiKey: process.env.HF_TOKEN
        || process.env.HUGGINGFACE_API_KEY
        || process.env.HUGGINGFACE_HUB_TOKEN
        || process.env.HUGGINGFACEHUB_API_TOKEN,
      model: songMode
        ? (process.env.VIVY_SONG_HF_MODEL || process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct')
        : (process.env.VIVY_HF_MODEL || process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct'),
    },
    openrouter: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.VIVY_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
      model: songMode
        ? (process.env.VIVY_SONG_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct')
        : (process.env.VIVY_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct'),
    },
  };
  const definition = definitions[normalizedProvider];
  if (!definition) return null;
  return {
    baseURL: cleanOneLine(definition.baseURL, '', 300).replace(/\/+$/, ''),
    apiKey: String(definition.apiKey || '').trim(),
    model: cleanOneLine(definition.model, '', 120),
    provider: normalizedProvider,
    source: `${normalizedProvider}-openai-compatible`,
    maxRetries: 0,
  };
}

function getVivyCloudConfigs(options = {}) {
  const explicitConfig = getVivyOpenAIConfig(options);
  const ollamaCloud = getVivyOllamaCloudConfig(options);
  const cerbere = getVivyCerbereSongConfig(options);
  const configuredOrder = String(
    process.env.VIVY_LLM_FALLBACK_ORDER
      || process.env.A11_LLM_RUNTIME_FALLBACK_ORDER
      || 'ollama,ollama_cloud,groq,openrouter,openai,gemini,deepseek,together,xai,huggingface'
  )
    .split(/[,\s]+/)
    .map((value) => cleanOneLine(value, '', 40).toLowerCase())
    .filter(Boolean);
  const providerOrder = [...configuredOrder, 'ollama_cloud', 'groq', 'openrouter', 'openai', 'gemini', 'deepseek', 'together', 'xai', 'huggingface']
    .filter((value, index, list) => value !== 'ollama' && list.indexOf(value) === index);
  const candidates = [];
  const explicitBase = cleanOneLine(
    (String(options.mode || options.chatMode || '').toLowerCase() === 'song'
      ? (process.env.VIVY_SONG_OPENAI_BASE_URL || process.env.VIVY_SONG_BASE_URL)
      : '')
      || process.env.VIVY_OPENAI_BASE_URL,
    '',
    300
  );
  const explicitProvider = explicitBase ? getVivyProviderFromBaseUrl(explicitConfig.baseURL) : '';
  let explicitAdded = false;
  for (const provider of providerOrder) {
    if (explicitBase && provider === explicitProvider) {
      candidates.push(explicitConfig);
      explicitAdded = true;
    } else if (provider === 'ollama_cloud') candidates.push(ollamaCloud);
    else if (provider === 'cerbere') candidates.push(cerbere);
    else candidates.push(getVivyCloudProviderConfig(provider, options));
  }
  if (!explicitBase || !explicitAdded) candidates.push(explicitConfig);
  if (cerbere) candidates.push(cerbere);
  return candidates;
}

function getVivyLlmConfigs(options = {}) {
  const mode = cleanOneLine(options.mode || options.chatMode, '', 24).toLowerCase();
  const purpose = cleanOneLine(options.purpose, '', 40).toLowerCase();
  const cloudConfigs = getVivyCloudConfigs(options);
  const localConfigs = getVivyLocalOllamaConfigs(options);
  const allowLegacySongLocalFallback = !['0', 'false', 'off', 'no'].includes(
    String(process.env.VIVY_SONG_ALLOW_LOCAL_FALLBACK || 'true').trim().toLowerCase()
  );
  const allowLyricsLocalFallback = options.allowLocalLyricsFallback === true
    || !['0', 'false', 'off', 'no'].includes(
      String(process.env.VIVY_SONG_ALLOW_LOCAL_LYRICS_FALLBACK || 'true').trim().toLowerCase()
    );
  const allowSongLocalFallback = purpose === 'lyrics'
    ? allowLyricsLocalFallback
    : allowLegacySongLocalFallback;
  const localFirst = !['0', 'false', 'off', 'no'].includes(
    String(process.env.VIVY_CHAT_LOCAL_FIRST || 'true').trim().toLowerCase()
  );
  const ordered = mode === 'song'
    ? (allowSongLocalFallback
      ? [...localConfigs, ...cloudConfigs]
      : cloudConfigs)
    : (localFirst ? [...localConfigs, ...cloudConfigs] : [...cloudConfigs, ...localConfigs]);
  const seen = new Set();
  const configs = ordered.filter((config) => {
    if (!config?.apiKey || !config?.baseURL || !config?.model) return false;
    const key = `${config.provider}|${config.baseURL}|${config.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const largeLyricsFirst = mode === 'song'
    && purpose === 'lyrics'
    && !['0', 'false', 'off', 'no'].includes(
      String(process.env.VIVY_NOSSEN_LARGE_MODEL_FIRST || 'true').trim().toLowerCase()
    )
    && configs.some((config) => ['ollama_cloud', 'cerbere'].includes(config.provider));
  if (!largeLyricsFirst) return configs;

  const providerPriority = [
    'ollama_cloud',
    'cerbere',
    'groq',
    'openrouter',
    'xai',
    'gemini',
    'deepseek',
    'together',
    'openai',
  ];
  return configs
    .filter((config) => config.provider !== 'ollama' && config.provider !== 'huggingface')
    .sort((left, right) => {
      const leftIndex = providerPriority.indexOf(left.provider);
      const rightIndex = providerPriority.indexOf(right.provider);
      return (leftIndex < 0 ? providerPriority.length : leftIndex)
        - (rightIndex < 0 ? providerPriority.length : rightIndex);
    });
}

function createVivyOllamaCloudClientFromConfig(config) {
  let calls = 0;
  const maxCalls = Math.max(1, Number(config.maxCalls || 1) || 1);
  return {
    client: {
      chat: {
        completions: {
          create: async (request = {}, requestOptions = {}) => {
            if (calls >= maxCalls) {
              const error = new Error('ollama_cloud_round_call_limit');
              error.code = 'ollama_cloud_round_call_limit';
              error.status = 429;
              throw error;
            }
            calls += 1;

            const responseFormat = request.response_format;
            const format = responseFormat?.type === 'json_object'
              ? 'json'
              : responseFormat?.json_schema?.schema;
            const body = {
              model: request.model || config.model,
              messages: Array.isArray(request.messages) ? request.messages : [],
              stream: false,
              think: cleanOneLine(config.thinkLevel, 'medium', 12).toLowerCase(),
              options: {
                temperature: Number.isFinite(Number(request.temperature)) ? Number(request.temperature) : 0.8,
                num_predict: Math.max(1, Number(request.max_tokens || request.max_completion_tokens || 6000) || 6000),
              },
              ...(format ? { format } : {}),
            };
            const response = await fetch(`${config.baseURL}/api/chat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(Math.max(
                1000,
                Math.min(
                  Number(config.timeoutMs || 300000) || 300000,
                  Number(requestOptions?.timeout || config.timeoutMs || 300000) || 300000
                )
              )),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              const error = new Error(cleanOneLine(
                data?.error?.message || data?.error || `ollama_cloud_http_${response.status}`,
                `ollama_cloud_http_${response.status}`,
                220
              ));
              error.code = response.status === 429 ? 'ollama_cloud_rate_limited' : 'ollama_cloud_failed';
              error.status = response.status;
              throw error;
            }
            const content = cleanText(data?.message?.content, VIVY_SONG_MAX_CHARS);
            if (!content) {
              const error = new Error('ollama_cloud_empty_output');
              error.code = 'ollama_cloud_empty_output';
              error.status = 502;
              throw error;
            }
            return {
              id: `ollama-cloud-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: data?.model || config.model,
              choices: [{
                index: 0,
                finish_reason: data?.done_reason || 'stop',
                message: { role: 'assistant', content },
              }],
              usage: {
                prompt_tokens: Number(data?.prompt_eval_count || 0),
                completion_tokens: Number(data?.eval_count || 0),
                total_tokens: Number(data?.prompt_eval_count || 0) + Number(data?.eval_count || 0),
              },
            };
          },
        },
      },
    },
    model: config.model,
    baseURL: config.baseURL,
    provider: config.provider,
    source: config.source,
    timeoutMs: Number(config.timeoutMs || 0) || 0,
    maxPromptChars: Number(config.maxPromptChars || 0) || 0,
    maxOutputTokens: Number(config.maxOutputTokens || 0) || 0,
  };
}

function createVivyOpenAIClientFromConfig(config) {
  if (config?.provider === 'ollama_cloud') {
    return createVivyOllamaCloudClientFromConfig(config);
  }
  if (!OpenAI || !config?.apiKey) return null;
  let calls = 0;
  const maxCalls = Math.max(0, Number(config.maxCalls || 0) || 0);
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    maxRetries: Number.isFinite(Number(config.maxRetries))
      ? Number(config.maxRetries)
      : (config.provider === 'ollama' ? 0 : 2),
    ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
    defaultHeaders: {
      'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
    },
  });
  if (maxCalls > 0) {
    const create = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async (...args) => {
      if (calls >= maxCalls) {
        const error = new Error(`${config.provider}_round_call_limit`);
        error.code = `${config.provider}_round_call_limit`;
        error.status = 429;
        throw error;
      }
      calls += 1;
      return create(...args);
    };
  }
  return {
    client,
    model: config.model,
    baseURL: config.baseURL,
    provider: config.provider,
    source: config.source,
    timeoutMs: Number(config.timeoutMs || 0) || 0,
    maxPromptChars: Number(config.maxPromptChars || 0) || 0,
    maxOutputTokens: Number(config.maxOutputTokens || 0) || 0,
  };
}

function createVivyOpenAIClients(options = {}) {
  return getVivyLlmConfigs(options)
    .map(createVivyOpenAIClientFromConfig)
    .filter(Boolean);
}

function createVivyOpenAIClient(options = {}) {
  return createVivyOpenAIClients(options)[0] || null;
}

const vivyLlmProviderCooldowns = new Map();

function getVivyProviderCooldownKey(bundle = {}) {
  return `${cleanOneLine(bundle.provider, 'unknown', 40)}|${cleanOneLine(bundle.baseURL, '', 240)}`;
}

function resolveVivyRateLimitCooldownMs(error) {
  const configured = Math.max(1000, Number(process.env.VIVY_GROQ_RATE_LIMIT_COOLDOWN_MS || 300000) || 300000);
  const retryAfter = Number(error?.headers?.get?.('retry-after') || error?.response?.headers?.get?.('retry-after') || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.max(1000, retryAfter * 1000);
  const message = String(error?.message || '');
  const seconds = Number(message.match(/(?:try again in|retry after)\s*([\d.]+)\s*s/i)?.[1] || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : configured;
}

function compactVivyLocalMessageContent(value = '', maxChars = 0) {
  const text = String(value || '');
  const limit = Math.max(0, Number(maxChars || 0) || 0);
  if (!limit || text.length <= limit) return text;
  const marker = '\n[… contexte compacté pour le fallback local …]\n';
  if (limit <= marker.length + 40) return text.slice(0, limit);
  const available = limit - marker.length;
  const headChars = Math.max(20, Math.floor(available * 0.64));
  const tailChars = Math.max(20, available - headChars);
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function fitVivyChatRequestForBundle(request = {}, bundle = {}) {
  const maxOutputTokens = Math.max(0, Number(bundle.maxOutputTokens || 0) || 0);
  const maxPromptChars = Math.max(0, Number(bundle.maxPromptChars || 0) || 0);
  const fitted = {
    ...request,
    ...(maxOutputTokens && Number(request.max_tokens || 0) > maxOutputTokens
      ? { max_tokens: maxOutputTokens }
      : {}),
  };
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const totalChars = messages.reduce((sum, entry) => sum + String(entry?.content || '').length, 0);
  if (!maxPromptChars || totalChars <= maxPromptChars || messages.length < 2) return fitted;

  const systemIndex = messages.findIndex((entry) => String(entry?.role || '').toLowerCase() === 'system');
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role || '').toLowerCase() === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  const systemBudget = systemIndex >= 0 ? Math.floor(maxPromptChars * 0.68) : 0;
  const latestUserBudget = latestUserIndex >= 0 ? Math.floor(maxPromptChars * 0.22) : 0;
  const selected = [];
  let usedChars = 0;
  if (systemIndex >= 0) {
    const system = {
      ...messages[systemIndex],
      content: compactVivyLocalMessageContent(messages[systemIndex]?.content, systemBudget),
    };
    selected.push({ index: systemIndex, entry: system });
    usedChars += String(system.content || '').length;
  }

  if (latestUserIndex >= 0 && latestUserIndex !== systemIndex) {
    const latestUser = {
      ...messages[latestUserIndex],
      content: compactVivyLocalMessageContent(messages[latestUserIndex]?.content, latestUserBudget),
    };
    selected.push({ index: latestUserIndex, entry: latestUser });
    usedChars += String(latestUser.content || '').length;
  }

  let remaining = Math.max(0, maxPromptChars - usedChars);
  for (let index = messages.length - 1; index >= 0 && remaining >= 80; index -= 1) {
    if (index === systemIndex || index === latestUserIndex) continue;
    if (String(messages[index]?.role || '').toLowerCase() === 'system') continue;
    const content = String(messages[index]?.content || '');
    if (!content) continue;
    const budget = Math.min(600, remaining);
    const entry = {
      ...messages[index],
      content: compactVivyLocalMessageContent(content, budget),
    };
    selected.push({ index, entry });
    remaining -= String(entry.content || '').length;
  }

  fitted.messages = selected
    .sort((left, right) => left.index - right.index)
    .map((item) => item.entry);
  return fitted;
}

function buildVivyLlmDeadlineError() {
  const error = new Error('vivy_llm_deadline_exceeded');
  error.code = 'vivy_llm_deadline_exceeded';
  error.status = 504;
  return error;
}

async function createVivyBundleCompletion(bundle, request, options = {}) {
  const deadlineAt = Math.max(0, Number(options.deadlineAt || 0) || 0);
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
  if (remainingMs <= 500) throw buildVivyLlmDeadlineError();
  const defaultAttemptMs = bundle.provider === 'ollama'
    ? Math.max(1000, Number(options.localAttemptTimeoutMs || bundle.timeoutMs || 65000) || 65000)
    : bundle.provider === 'ollama_cloud'
      ? Math.max(1000, Number(options.largeLyricsAttemptTimeoutMs || options.attemptTimeoutMs || 60000) || 60000)
    : Math.max(1000, Number(options.attemptTimeoutMs || 20000) || 20000);
  const attemptTimeoutMs = Math.max(500, Math.floor(Math.min(defaultAttemptMs, remainingMs)));
  const bundleRequest = fitVivyChatRequestForBundle(request, bundle);
  return bundle.client.chat.completions.create({
    ...bundleRequest,
    model: bundle.model,
  }, {
    timeout: attemptTimeoutMs,
  });
}

async function createVivyChatCompletion(llmBundles, request, options = {}) {
  let lastError = null;
  // Filet de sécurité central: sans deadline explicite, la chaîne complète de providers peut
  // cumuler plus de 100s et se faire couper par le proxy Cloudflare, auquel cas le navigateur
  // ne voit aucun code HTTP mais un "Failed to fetch". Tous les appelants sont couverts ici.
  if (!(Number(options.deadlineAt || 0) > 0)) {
    options = {
      ...options,
      deadlineAt: Date.now() + Math.max(15000, Math.min(
        95000,
        Number(process.env.VIVY_LLM_CHAIN_BUDGET_MS || 85000) || 85000
      )),
    };
  }
  for (const bundle of llmBundles) {
    if (options.deadlineAt && Date.now() >= Number(options.deadlineAt) - 500) {
      lastError = buildVivyLlmDeadlineError();
      break;
    }
    const cooldownKey = getVivyProviderCooldownKey(bundle);
    const cooldownUntil = Number(vivyLlmProviderCooldowns.get(cooldownKey) || 0);
    if (cooldownUntil > Date.now()) {
      console.warn(
        '[vivy-chat] provider=%s model=%s cooldownMs=%d; trying next provider',
        bundle.provider,
        bundle.model,
        cooldownUntil - Date.now()
      );
      continue;
    }
    try {
      const completion = await createVivyBundleCompletion(bundle, request, options);
      vivyLlmProviderCooldowns.delete(cooldownKey);
      return { bundle, completion };
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0) || 0;
      const rateLimited = status === 429
        || /rate.?limit|quota|too many requests/i.test(String(error?.code || error?.message || ''));
      if (rateLimited) {
        vivyLlmProviderCooldowns.set(cooldownKey, Date.now() + resolveVivyRateLimitCooldownMs(error));
      }
      console.warn(
        '[vivy-chat] provider=%s model=%s failed status=%s; trying next provider',
        bundle.provider,
        bundle.model,
        status || 'exception'
      );
    }
  }
  throw lastError || new Error('vivy_llm_unavailable');
}

function getVivyVisionModel(baseURL = '') {
  const explicit = cleanOneLine(
    process.env.VIVY_VISION_MODEL
      || process.env.A11_VISION_MODEL
      || process.env.OPENAI_VISION_MODEL,
    '',
    120
  );
  if (explicit) return explicit;
  return /openrouter\.ai/i.test(String(baseURL || ''))
    ? 'google/gemini-2.5-flash'
    : 'gpt-4o-mini';
}

function createVivyVisionOpenAIClient() {
  if (!OpenAI) return null;
  const config = getVivyOpenAIConfig();
  if (!config.apiKey) return null;
  const model = getVivyVisionModel(config.baseURL);
  return {
    client: new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      defaultHeaders: {
        'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
      },
    }),
    model,
  };
}

function resolveVivyMemoryUser(req, input = {}) {
  const authenticated = cleanOneLine(
    req?.user?.id || req?.user?.email || req?.user?.username,
    '',
    120
  );
  if (authenticated) return `user:${authenticated}`;
  return '';
}

function normalizeVivyFileAttachment(file) {
  if (!file || typeof file !== 'object') return null;
  const filename = cleanOneLine(file.filename || file.name || file.originalName, '', 180);
  if (!filename) return null;

  const contentType = cleanOneLine(file.contentType || file.type, 'application/octet-stream', 120);
  const size = Number(file.sizeBytes ?? file.size ?? 0);
  const analysis = file.analysis && typeof file.analysis === 'object' ? file.analysis : null;
  const visualDescription = cleanText(
    file.visualDescription
      || file.visionDescription
      || file.imageDescription
      || file.analysisSummary
      || analysis?.description
      || analysis?.summary,
    900
  );
  return {
    id: cleanOneLine(file.id || file.storageKey || filename, filename, 180),
    filename,
    contentType,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : 0,
    url: cleanOneLine(file.url || file.downloadUrl, '', 800),
    description: cleanText(file.description || file.summary || visualDescription, 900),
    textPreview: cleanText(file.textPreview || file.preview || file.excerpt || analysis?.preview, 1800),
    visualDescription,
    analysis: analysis
      ? {
        fileKind: cleanOneLine(analysis.fileKind, '', 40),
        mime: cleanOneLine(analysis.mime, '', 80),
        parser: cleanOneLine(analysis.parser, '', 80),
        width: Number(analysis.width || 0) || null,
        height: Number(analysis.height || 0) || null,
        format: cleanOneLine(analysis.format, '', 40),
        note: cleanOneLine(analysis.note, '', 120),
        readableInChatContext: analysis.readableInChatContext === true,
      }
      : null,
    uploaded: file.uploaded === true,
  };
}

function normalizeVivyFiles(input = {}) {
  const files = Array.isArray(input.files) ? input.files : [];
  return files.map(normalizeVivyFileAttachment).filter(Boolean).slice(0, 6);
}

function formatFileSize(sizeBytes = 0) {
  const size = Number(sizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatVivyToolCapabilityLines() {
  return VIVY_TOOL_CAPABILITIES.map((capability) => [
    `- ${capability.id} (${capability.label})`,
    `déclencheur: ${capability.trigger}`,
    `route: ${capability.route}`,
    `limite: ${capability.limit}`,
  ].join(' | '));
}

function buildVivyToolCapabilityPrompt() {
  return [
    'Carte outils Vivy autorisée (carte bornée, pas débridage sauvage):',
    ...formatVivyToolCapabilityLines(),
    "Règle routing: si un outil autorisé peut aider, route vers l'intent disponible au lieu de faire semblant d'être aveugle.",
    "Règle sécurité: ne contourne pas les garde-fous, ne lis pas de secrets, ne promets pas d'exécuter une commande non autorisée; nomme le verrou probable et l'action bornée suivante.",
    "Journalisation décision outils: pour chaque outil appelé, indiquer pourquoi (intent choisi), ce qui est envoyé (sans secret), quel verrou s'applique, résultat résumé sans secret, source/fichier/url si applicable.",
    "Confirmation opérateur obligatoire si l'action peut: modifier, supprimer, coûter de l'argent, exposer un secret, publier, déployer ou contacter un service externe sensible.",
  ].join('\n');
}

function formatVivyFilesForPrompt(files = []) {
  if (!files.length) return '';
  return files.map((file, index) => {
    const details = [
      `Fichier ${index + 1}: ${file.filename}`,
      file.contentType ? `type ${file.contentType}` : '',
      file.sizeBytes ? `taille ${formatFileSize(file.sizeBytes)}` : '',
      file.url ? `stocké ${file.url}` : '',
      file.description ? `description ${file.description}` : '',
      file.visualDescription ? `vision ${file.visualDescription}` : '',
      file.textPreview ? `extrait:\n${file.textPreview}` : '',
    ].filter(Boolean);
    return details.join('\n');
  }).join('\n\n');
}

function isVivyImageFile(file = {}) {
  const contentType = String(file.contentType || '').trim().toLowerCase();
  const filename = String(file.filename || '').trim().toLowerCase();
  return contentType.startsWith('image/')
    || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(filename);
}

function isVivyImageInspectionRequest(message = '', files = []) {
  if (!files.some(isVivyImageFile)) return false;
  const normalized = foldTextForLookup(message);
  if (!normalized) return files.some((file) => file.uploaded || file.url || file.description || file.textPreview);
  const asksToSee = /\b(regarde|voir|vois|voit|vu|decris|decrit|decrire|analyse|analyser|identifie|identifier|qu(?:e|oi)|dedans|dedan|image|photo|fichier|piece jointe|visuel)\b/.test(normalized);
  const correctsTitles = /\b(titres?|noms?)\b.{0,80}\b(fichiers?|images?|photos?)\b/.test(normalized)
    || /\b(ce sont|c est|c est pas|pas)\b.{0,80}\b(fichiers?|images?|photos?)\b/.test(normalized);
  return asksToSee || correctsTitles;
}

function describeVivyImageMetadata(file = {}) {
  const analysis = file.analysis && typeof file.analysis === 'object' ? file.analysis : null;
  const parts = [];
  const format = cleanOneLine(analysis?.format || file.contentType, '', 80);
  const width = Number(analysis?.width || 0) || null;
  const height = Number(analysis?.height || 0) || null;
  if (format) parts.push(format);
  if (width && height) parts.push(`${width}x${height}`);
  if (file.sizeBytes) parts.push(formatFileSize(file.sizeBytes));
  return parts.join(', ');
}

function looksLikeVivyTechnicalVisionFallback(value = '') {
  const normalized = foldTextForLookup(value);
  return /\bvision avancee indisponible\b/.test(normalized)
    || /\blecture locale de secours\b/.test(normalized)
    || /\bne deduis pas le sujet visuel\b/.test(normalized)
    || /\bjanus_unavailable\b/.test(normalized)
    || /\bvision_indisponible\b/.test(normalized);
}

function looksLikeVivyGenericUploadImageContext(value = '') {
  const normalized = foldTextForLookup(value);
  return /\bimage recue par a11\b/.test(normalized)
    || /\bvision detaillee disponible cote chat\b/.test(normalized)
    || /\bfichier joint a la conversation vivy\b/.test(normalized)
    || /\bimage stockee pour analyse visuelle a11\b/.test(normalized);
}

function cleanVivyKnownImageContext(value = '') {
  const text = cleanText(value, 900);
  if (!text) return '';
  if (looksLikeVivyTechnicalVisionFallback(text)) return '';
  if (looksLikeVivyGenericUploadImageContext(text)) return '';
  return text;
}

function cleanVivyImageObservation(value = '') {
  const cleaned = cleanText(value, 900)
    .replace(/^vision avanc[ée]e indisponible;\s*/i, 'Vision avancée indisponible; ')
    .replace(/\s+/g, ' ')
    .trim();
  return looksLikeVivyTechnicalVisionFallback(cleaned) ? '' : cleaned;
}

function buildVivyImageQuestionPrompt(file = {}) {
  const filename = cleanOneLine(file.filename, 'image', 180);
  return [
    'Réponds en français, en une description concrète et utile.',
    "Décris ce qui est vraiment visible dans l'image: sujet principal, objets, décor, couleurs, état, détails mécaniques ou textes lisibles.",
    "Si c'est un scooter, une moto, une pièce, un atelier ou un booster, nomme les éléments visibles sans inventer une marque non confirmée.",
    "Ne parle pas de métadonnées, d'OCR, de fallback, de modèle ou d'indisponibilité technique.",
    `Nom du fichier seulement pour contexte: ${filename}.`,
  ].join('\n');
}

function parseVivyVisionFixture() {
  const fixture = String(process.env.VIVY_IMAGE_VISION_FIXTURE || '').trim();
  if (!fixture) return null;
  try {
    const parsed = JSON.parse(fixture);
    const description = cleanText(parsed?.description || parsed?.assistant || parsed?.text || '', 1200);
    return description ? { description, provider: 'vision-llm-fixture' } : null;
  } catch (_) {
    return { description: cleanText(fixture, 1200), provider: 'vision-llm-fixture' };
  }
}

async function describeVivyImageWithVisionLlm(file = {}) {
  const fixture = parseVivyVisionFixture();
  if (fixture?.description) {
    return {
      reliable: true,
      observation: fixture.description,
      provider: fixture.provider,
    };
  }

  if (String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true') return null;
  if (!file.url) return null;

  const llmBundle = createVivyVisionOpenAIClient();
  if (!llmBundle) return null;

  let loaded = null;
  try {
    loaded = await loadImageBuffer(file.url, process.env.A11_RUNTIME_ROOT || '');
  } catch (loadError) {
    console.warn('[Vivy][vision-llm] image load failed:', String(loadError?.message || loadError));
    return null;
  }

  const maxBytes = Number(process.env.VIVY_VISION_LLM_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (!Buffer.isBuffer(loaded.buffer) || !loaded.buffer.length || loaded.buffer.length > maxBytes) {
    return null;
  }

  const contentType = cleanOneLine(loaded.contentType || file.contentType, 'image/jpeg', 80);
  const dataUrl = `data:${contentType};base64,${loaded.buffer.toString('base64')}`;
  try {
    const completion = await llmBundle.client.chat.completions.create({
      model: llmBundle.model,
      messages: [
        {
          role: 'system',
          content: 'Tu es le module vision Vivy/A11. Tu décris seulement ce qui est visible, en français, sans texte technique interne.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVivyImageQuestionPrompt(file) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: Number(process.env.VIVY_VISION_TEMPERATURE || 0.2),
      max_tokens: Number(process.env.VIVY_VISION_MAX_TOKENS || 500),
    });
    const observation = cleanVivyImageObservation(completion?.choices?.[0]?.message?.content);
    if (!observation) return null;
    return {
      reliable: true,
      observation,
      provider: `vision-llm:${llmBundle.model}`,
    };
  } catch (error) {
    console.warn('[Vivy][vision-llm] failed:', String(error?.message || error));
    return null;
  }
}

async function describeVivyImageFile(file = {}, req) {
  const filename = cleanOneLine(file.filename, 'image', 180);
  const known = cleanText([
    cleanVivyKnownImageContext(file.visualDescription),
    file.description && !/^fichier joint\b/i.test(file.description) ? cleanVivyKnownImageContext(file.description) : '',
    file.textPreview && !looksLikeVivyTechnicalVisionFallback(file.textPreview) ? `Texte lisible: ${file.textPreview}` : '',
  ].filter(Boolean).join(' '), 1200);

  if (file.url) {
    if (parseVivyVisionFixture()?.description) {
      const llmVision = await describeVivyImageWithVisionLlm(file);
      if (llmVision?.observation) {
        return {
          filename,
          reliable: llmVision.reliable === true,
          observation: llmVision.observation,
          provider: llmVision.provider,
        };
      }
    }

    try {
      const prompt = [
        'Décris très concrètement ce qui est visible dans cette image, en français.',
        'Si c’est une moto, un scooter, une pièce mécanique ou un atelier, nomme les éléments visibles.',
        'Ne déduis pas depuis le nom du fichier; dis seulement ce que la vision permet de confirmer.',
      ].join(' ');
      const vision = await autoDescribeImage({
        imageLocator: file.url,
        runtimeRoot: process.env.A11_RUNTIME_ROOT || '',
        timeoutMs: Number(process.env.VIVY_IMAGE_ANALYSIS_TIMEOUT_MS || 45000),
        requestId: `vivy-image-${Date.now()}`,
        prompt,
      });
      const description = cleanVivyImageObservation(vision?.description);
      if (description && vision?.skipped !== true && vision?.visualReliable !== false && vision?.fallback !== true) {
        return {
          filename,
          reliable: true,
          observation: description,
          provider: cleanOneLine(vision?.provider, '', 80),
        };
      }
    } catch (_) {
      // Vision is best-effort; fallback to uploaded metadata below.
    }

    const llmVision = await describeVivyImageWithVisionLlm(file);
    if (llmVision?.observation) {
      return {
        filename,
        reliable: llmVision.reliable === true,
        observation: llmVision.observation,
        provider: llmVision.provider,
      };
    }
  }

  const metadata = describeVivyImageMetadata(file);
  const fallback = known || (metadata
    ? `Image reçue correctement (${metadata}). La lecture visuelle détaillée n'a pas répondu cette fois; je ne vais pas inventer son contenu depuis l'OCR ou le nom du fichier.`
    : "Image reçue correctement. La lecture visuelle détaillée n'a pas répondu cette fois; je ne vais pas inventer son contenu depuis l'OCR ou le nom du fichier.");
  return {
    filename,
    reliable: Boolean(known),
    observation: fallback,
    provider: known ? 'uploaded-context' : 'metadata-only',
  };
}

async function buildVivyImageAttachmentContext(input = {}, req) {
  const files = normalizeVivyFiles(input).filter(isVivyImageFile);
  const observations = [];
  for (const file of files.slice(0, 4)) {
    observations.push(await describeVivyImageFile(file, req));
  }
  const reliableCount = observations.filter((entry) => entry.reliable).length;
  const lines = [
    "Oui Djeff, là je traite ça comme des images réelles jointes, pas comme de simples titres.",
    '',
    ...observations.map((entry) => {
      const prefix = entry.reliable ? 'Je vois' : 'Je peux confirmer';
      return `- ${prefix} dans ${entry.filename}: ${entry.observation}`;
    }),
    '',
    reliableCount
      ? "Je garde ces fichiers comme références concrètes NOSSEN/Funesterie: du réel qui sert de point d'ancrage, pas un décor de jeu vidéo."
      : "Je garde ces fichiers comme références réelles, mais je ne vais pas inventer les détails visuels tant que la vision fiable n'a pas donné plus que les métadonnées.",
  ];
  return {
    assistant: cleanText(lines.join('\n'), 2400),
    observations: observations.map((entry) => ({
      filename: entry.filename,
      reliable: entry.reliable === true,
      provider: cleanOneLine(entry.provider, '', 120),
      observation: cleanText(entry.observation, 900),
    })),
  };
}

async function buildVivyImageAttachmentReply(input = {}, req) {
  const context = await buildVivyImageAttachmentContext(input, req);
  return context.assistant;
}

function getVivyNonImageFiles(files = []) {
  return files.filter((file) => !isVivyImageFile(file));
}

function isVivyFileInspectionRequest(message = '', files = []) {
  const nonImageFiles = getVivyNonImageFiles(files);
  if (!nonImageFiles.length) return false;
  const normalized = foldTextForLookup(message);
  const hasReadableContext = nonImageFiles.some((file) => file.description || file.textPreview || file.visualDescription);
  if (!normalized) return hasReadableContext;

  const asksForFile = /\b(fichier|fichiers|document|documents|pdf|texte|txt|piece jointe|pieces jointes|upload|joint|joints|dedans|contenu|contenus|corpus|archive|archives|historique|logs|lis|lire|ouvre|ouvrir|analyse|analyser|resume|resumer|inspecte|inspecter|regarde|verifie|verifier)\b/.test(normalized);
  const refersToThis = /\b(ca|ceci|cela|ces|ce|cette|celui|celle|tout ca|la dedans|dedans|joint|voici|voila|tiens|corpus|archive|historique)\b/.test(normalized);
  return asksForFile || (hasReadableContext && refersToThis && !isDirectSongwritingRequest(message));
}

function describeVivyGenericFile(file = {}) {
  const filename = cleanOneLine(file.filename, 'fichier', 180);
  const metadata = [
    cleanOneLine(file.contentType, '', 80),
    file.sizeBytes ? formatFileSize(file.sizeBytes) : '',
  ].filter(Boolean).join(', ');
  const readable = compactUniqueLines([
    file.description,
    file.textPreview ? `Extrait lisible: ${file.textPreview}` : '',
  ], 1100);
  const observation = readable || (metadata
    ? `Fichier reçu (${metadata}), mais pas encore de contenu textuel lisible dans ce chat.`
    : 'Fichier reçu, mais pas encore de contenu lisible dans ce chat.');
  return { filename, observation };
}

function buildVivyFileAttachmentReply(input = {}) {
  const files = getVivyNonImageFiles(normalizeVivyFiles(input));
  const lines = [
    "Je bascule en analyse de fichiers joints, pas en paroles automatiques.",
    '',
    ...files.slice(0, 5).map((file) => {
      const entry = describeVivyGenericFile(file);
      return `- ${entry.filename}: ${entry.observation}`;
    }),
    '',
    "Si un fichier n'a pas encore de texte extrait, je le marque comme non lisible au lieu d'inventer son contenu.",
  ];
  return cleanText(lines.join('\n'), 2400);
}

function looksLikeVivyExternalLookupTarget(message = '') {
  return /https?:\/\/|(?:^|[\s/])(?:[a-z0-9-]+\.)+(?:com|fr|me|io|dev|org|net|app|ai|gg|tv|co|uk)(?:\b|\/)/i.test(String(message || ''));
}

function looksLikeVivyRenderedWebResearch(message = '') {
  const normalized = foldTextForLookup(message);
  return /je declenche une recherche web/.test(normalized)
    && /\b(?:recherche|resultats utiles|sources)\b/.test(normalized);
}

function cleanVivyOperatorTranscriptLine(line = '') {
  const raw = String(line || '').trim();
  if (!raw) return '';

  if (/^je\s+d[ée]clenche\s+une\s+recherche\s+web\b/i.test(raw)
    || /^r[ée]sultats\s+utiles\s*:/i.test(raw)
    || /^je\s+m['’]?appuie\s+sur\s+ces\s+sources\b/i.test(raw)
    || /^la\s+voix\s+vivy\s+par\s+d[ée]faut\b/i.test(raw)) {
    return '';
  }

  if (/^[-*]\s+/.test(raw) && /https?:\/\//i.test(raw)) {
    return '';
  }

  if (/^recherche\s*:/i.test(raw)) {
    return cleanVivyOperatorTranscriptLine(raw.replace(/^recherche\s*:/i, '').trim());
  }

  const roleMatch = raw.match(/^(?:codex|assistant|system|syst[èe]me|kiro|a11|kaen44|k44|vivy|chatgpt|claude|grok|gemini|github\s+copilot|outil|tool)\s*[:：-]\s*(.*)$/i);
  if (!roleMatch) return raw;

  const content = roleMatch[1].trim();
  if (!content) return '';
  const folded = foldTextForLookup(content);
  const operatorProgress = /\b(?:je reprends le fil|je vais verrouiller|je lance|je relance|je corrige|je patch|je pousse|je deploy|test et deploiement|requete web plus propre|contexte historique pris en compte|backend|frontend|commit|push|build|bundle|prod)\b/.test(folded);
  const firstPersonOps = /\b(?:je|j)\b/.test(folded)
    && /\b(?:reprends|verrouiller|lance|relance|corrige|patch|pousse|deploy|deploie|test|build|commit|prod|serveur|backend|frontend|requete|contexte)\b/.test(folded);
  if (operatorProgress || firstPersonOps) return '';
  return content;
}

function stripVivyOperatorTranscript(value = '') {
  return cleanText(String(value || '')
    .split(/\r?\n+/)
    .map((line) => cleanVivyOperatorTranscriptLine(line))
    .filter(Boolean)
    .join('\n'), 1800);
}

function shouldVivyAutoWebSearch(message = '', mode = 'chat') {
  if (looksLikeVivyRenderedWebResearch(message)) return false;
  if (mode === 'song' && looksLikeCompleteLyrics(message)) return false;
  const searchableMessage = stripVivyOperatorTranscript(message);
  const normalized = foldTextForLookup(searchableMessage);
  if (!normalized) return false;
  if (isVivyWorkspaceToolRequest({ history: [] }, searchableMessage)) return false;
  if (mode === 'song' && isDirectSongwritingRequest(searchableMessage)) {
    const intentCleaned = foldTextForLookup(cleanVivyMessageForIntent(searchableMessage));
    if (!/\b(actualite|actualites|recent|recente|dernier|derniere|latest|source|sources|web|internet|site|url|github|npm|docker)\b/.test(intentCleaned)) {
      return false;
    }
  }
  if (mode === 'song' && isDirectSongwritingRequest(searchableMessage) && !/\b(actualite|actualites|recent|recente|dernier|derniere|latest|source|sources|web|internet|site|url|github|npm|docker)\b/.test(normalized)) {
    return false;
  }
  if (looksLikeVivyExternalLookupTarget(searchableMessage)) return true;

  const explicitWebLookup = /\b(cherche|chercher|recherche|trouve|trouver|verifie|verifier|consulte|regarde)\b.{0,90}\b(web|internet|google|en ligne|source|sources|site|site officiel|documentation|docs|github|npm|docker|docker hub|actualite|actualites)\b/.test(normalized)
    || /\b(web|internet|google|source officielle|sources officielles|site officiel|documentation officielle|docs officielles|github|docker hub|npm)\b/.test(normalized);
  const freshnessLookup = /\b(aujourd hui|maintenant|en ce moment|actuel|actuelle|actuels|actuelles|dernier|derniere|dernieres|latest|recent|recente|recents|recentes|nouveau|nouvelle|news|actualite|actualites|prix|tarif|version|release|mise a jour|changelog|status|statut|ci|workflow)\b/.test(normalized);
  return explicitWebLookup || freshnessLookup;
}

function normalizeVivySearchSpelling(value = '') {
  return String(value || '')
    .replace(/\bechiro\s+oda\b/gi, 'Eiichiro Oda')
    .replace(/\beichiro\s+oda\b/gi, 'Eiichiro Oda')
    .replace(/\bechiiro\s+oda\b/gi, 'Eiichiro Oda');
}

function stripVivySearchFiller(value = '') {
  return normalizeVivySearchSpelling(value)
    .replace(/https?:\/\/\S+/gi, (match) => ` ${match} `)
    .replace(/\b(?:non|oui|ouais|ben|bah|en\s+fait|du\s+coup|genre|mdr+)\b/gi, ' ')
    .replace(/\b(?:je\s+crois|je\s+pense|je\s+sais\s+pas|c['’]?est\s+ca|c['’]?est\s+ça)\b/gi, ' ')
    .replace(/\b(?:j['’]?\s*ai\s+)?cherch[eé]\s+(?:sur\s+)?(?:internet|web|google)\b/gi, ' ')
    .replace(/\b(?:je\s+l['’]?\s*ai\s+pas\s+vu\s+en\s+entier|pas\s+vu\s+en\s+entier|juste\s+quelques?\s+extraits?|quelques?\s+extraits?)\b/gi, ' ')
    .replace(/\b(?:il\s+a\s+l['’]?\s*air|trop\s+bien|dedans|dans\s+le\s+film)\b/gi, ' ')
    .replace(/[?!.,;:()[\]{}<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreVivySearchCandidate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const folded = foldTextForLookup(raw);
  let score = Math.min(30, raw.length / 4);
  if (/https?:\/\/|(?:^|[\s/])(?:[a-z0-9-]+\.)+(?:com|fr|me|io|dev|org|net|app|ai|gg|tv|co|uk)\b/i.test(raw)) score += 50;
  if (/@[a-z0-9][a-z0-9._/-]+/i.test(raw)) score += 45;
  if (/\b(?:film|movie|anime|manga|realisateur|réalisateur|director|kurosawa|oda|npm|github|docker|version|release)\b/i.test(raw)) score += 22;
  if (/\b[A-Z][A-Z0-9]{2,}\b/.test(raw)) score += 18;
  if (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(raw)) score += 18;
  if (/\b(?:j ai|je |tu |il |elle |on |nous |vous |ils |elles )\b/.test(folded)) score -= 10;
  return score;
}

function extractVivySearchCandidates(text = '') {
  const raw = normalizeVivySearchSpelling(stripVivyOperatorTranscript(cleanOneLine(text, '', 420)));
  const stripped = stripVivySearchFiller(raw);
  const candidates = [stripped];

  const urlMatches = raw.match(/https?:\/\/\S+|(?:^|[\s/])(?:[a-z0-9-]+\.)+(?:com|fr|me|io|dev|org|net|app|ai|gg|tv|co|uk)(?:\b|\/\S*)/gi) || [];
  candidates.push(...urlMatches.map((entry) => entry.trim()));

  const packageMatches = raw.match(/@[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?/gi) || [];
  candidates.push(...packageMatches);

  const titleByCreator = raw.match(/\b[A-Z0-9][A-Z0-9'’._-]{1,}(?:\s+(?:de|by)\s+[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})/gu) || [];
  candidates.push(...titleByCreator.map((entry) => `${entry} film`));

  const capitalNames = raw.match(/\b[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){1,3}\b/gu) || [];
  candidates.push(...capitalNames);

  if (/\bkurosawa\b/i.test(raw) && /\breal\b/i.test(raw)) candidates.push('REAL Kiyoshi Kurosawa film');
  if (/\be[iy]?i?ch?iro\s+oda\b/i.test(raw) || /\bEiichiro Oda\b/.test(stripped)) candidates.push('Eiichiro Oda');

  return candidates
    .map((entry) => cleanOneLine(entry, '', 220))
    .filter(Boolean);
}

function pickVivySearchCandidate(text = '') {
  const candidates = extractVivySearchCandidates(text)
    .map((candidate) => ({ candidate, score: scoreVivySearchCandidate(candidate) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.candidate || '';
}

function pickVivyHistorySearchContext(history = []) {
  const entries = (Array.isArray(history) ? history : [])
    .slice(-8)
    .reverse()
    .map((entry) => ({
      role: String(entry?.role || '').toLowerCase(),
      content: stripVivyOperatorTranscript(cleanText(entry?.content || entry?.message || '', 520)),
    }))
    .filter((entry) => entry.content && entry.role !== 'assistant');
  for (const entry of entries) {
    const candidate = pickVivySearchCandidate(entry.content);
    if (candidate && scoreVivySearchCandidate(candidate) >= 20) return candidate;
  }
  return '';
}

function shouldBlendVivyHistorySearchContext(current = '', historyContext = '') {
  if (!current || !historyContext) return false;
  if (looksLikeVivyExternalLookupTarget(current) || /@[a-z0-9][a-z0-9._/-]+/i.test(current)) return false;
  const currentScore = scoreVivySearchCandidate(current);
  const historyScore = scoreVivySearchCandidate(historyContext);
  if (historyScore < 20) return false;
  if (currentScore < 35) return true;
  return /\b(?:Eiichiro\s+Oda|Oda|Kurosawa)\b/i.test(current)
    && /\b(?:REAL|film|movie|Kurosawa|Oda)\b/i.test(historyContext);
}

function buildVivyWebSearchQuery(message = '', files = [], history = []) {
  const fileHint = files.length
    ? ` ${files.map((file) => file.filename).filter(Boolean).slice(0, 3).join(' ')}`
    : '';
  const searchableMessage = stripVivyOperatorTranscript(message);
  const current = pickVivySearchCandidate(`${searchableMessage}${fileHint}`);
  const historyContext = pickVivyHistorySearchContext(history);
  const currentScore = scoreVivySearchCandidate(current);
  const query = shouldBlendVivyHistorySearchContext(current, historyContext)
    ? compactUniqueLines([historyContext, current], 220)
    : currentScore >= 22
    ? current
    : compactUniqueLines([historyContext, current], 220);
  return cleanOneLine(query || `${searchableMessage}${fileHint}`, 'Funesterie Vivy', 260)
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeVivyWebResults(results = []) {
  return (Array.isArray(results) ? results : [])
    .map((entry) => ({
      title: cleanOneLine(entry?.title, 'Résultat web', 180),
      url: cleanOneLine(entry?.url, '', 800),
      snippet: cleanText(entry?.snippet || entry?.summary || '', 360),
    }))
    .filter((entry) => entry.url || entry.snippet || entry.title)
    .slice(0, 4);
}

async function runVivyWebSearch(query) {
  const fixture = String(process.env.VIVY_CHAT_WEB_SEARCH_FIXTURE || '').trim();
  if (fixture) {
    try {
      const parsed = JSON.parse(fixture);
      return {
        ok: parsed?.ok !== false,
        query,
        results: sanitizeVivyWebResults(parsed?.results || parsed),
        source: 'fixture',
      };
    } catch (error) {
      return { ok: false, query, results: [], source: 'fixture', error: cleanOneLine(error?.message || error, 'fixture_failed', 180) };
    }
  }
  if (String(process.env.VIVY_CHAT_DISABLE_WEB_SEARCH || '').toLowerCase() === 'true') {
    return { ok: false, query, results: [], disabled: true, error: 'web_search_disabled' };
  }
  try {
    const { t_web_search: webSearch } = require('../a11/tools-dispatcher.cjs');
    const result = await webSearch({ query, limit: Number(process.env.VIVY_CHAT_WEB_SEARCH_LIMIT || 4) || 4 });
    return {
      ok: result?.ok !== false,
      query: cleanOneLine(result?.query || query, query, 260),
      results: sanitizeVivyWebResults(result?.results),
      source: 'a11-web-search',
    };
  } catch (error) {
    return {
      ok: false,
      query,
      results: [],
      source: 'a11-web-search',
      error: cleanOneLine(error?.message || error, 'web_search_failed', 180),
    };
  }
}

async function buildVivyWebResearchReply(input = {}) {
  const files = normalizeVivyFiles(input);
  const query = buildVivyWebSearchQuery(input.message || input.prompt || input.text || '', files, input.history);
  const search = await runVivyWebSearch(query);
  const results = sanitizeVivyWebResults(search.results);
  const resultLines = results.map((entry) => {
    const source = entry.url ? ` (${entry.url})` : '';
    const snippet = entry.snippet ? ` - ${entry.snippet}` : '';
    return `- ${entry.title}${source}${snippet}`;
  });
  const lines = [
    "Je déclenche une recherche web parce que ta demande dépend probablement d'une info externe ou récente.",
    `Recherche: ${query}`,
    '',
    resultLines.length
      ? 'Résultats utiles:'
      : "Je n'ai pas obtenu de résultat web exploitable là tout de suite.",
    ...resultLines,
    '',
    resultLines.length
      ? "Je m'appuie sur ces sources plutôt que d'inventer une certitude de tête."
      : "Je garde la demande en chat, mais je signale clairement que la vérification web n'a pas abouti.",
  ];
  return {
    assistant: cleanText(lines.join('\n'), 2600),
    webSearch: {
      ok: search.ok === true,
      query,
      results,
      disabled: search.disabled === true,
      error: search.error || null,
      source: search.source || '',
    },
  };
}

function formatVivyWebResearchForPrompt(webSearch = {}) {
  const results = sanitizeVivyWebResults(webSearch.results);
  if (!results.length) return '';
  return cleanText([
    'Recherche web vérifiée à utiliser comme contexte, sans afficher une liste brute de résultats:',
    webSearch.query ? `Sujet recherché: ${webSearch.query}` : '',
    ...results.map((entry, index) => [
      `${index + 1}. ${entry.title}`,
      entry.snippet,
      entry.url ? `Source: ${entry.url}` : '',
    ].filter(Boolean).join(' - ')),
    'Réponds à la demande créative avec ces faits. Ne recopie ni les sources ni des paroles existantes dans la sortie.',
  ].filter(Boolean).join('\n'), 2600);
}

function isVivyMemoryContextNoise(episode = {}) {
  const type = String(episode?.type || '');
  if (type === 'vivy_settings') return true;
  if (type === 'vivy_chat_session') return true;
  if (type === 'vivy_chat_message') return true;
  if (type === 'vivy_workspace') return true;
  if (episode?.metadata?.internalTuning === true) return true;
  if (episode?.metadata?.internalWorkspace === true) return true;
  if (episode?.metadata?.internalNossenDraft === true) return true;

  const folded = foldTextForLookup(episode?.content || '');
  if (String(episode?.type || '') === 'vivy_idea'
    && /\bdistribution vocale choisie\b/.test(folded)
    && /\bmatiere creative du canevas composition\b/.test(folded)
    && /\becris uniquement les paroles completes\b/.test(folded)) {
    return true;
  }
  if (/\b(intent|reglage|reglages|sensibilite|seuil|detecteur|detecteurs)\b/.test(folded)
    && /\b(baisse|baisser|ajuste|ajuster|recentre|case technique)\b/.test(folded)) {
    return true;
  }
  return false;
}

function buildVivyMemoryContext(userId, conversationId = '') {
  const result = getEpisodes(userId, { limit: 24, days: 45 });
  if (!result?.ok || !Array.isArray(result.episodes) || !result.episodes.length) return '';
  const normalizedConversationId = cleanOneLine(conversationId, '', 120);
  if (!normalizedConversationId) return '';
  return result.episodes
    .filter((episode) => String(episode?.type || '').startsWith('vivy_'))
    .filter((episode) => !isVivyMemoryContextNoise(episode))
    .filter((episode) => !normalizedConversationId
      || cleanOneLine(episode?.metadata?.conversationId, '', 120) === normalizedConversationId)
    .slice(-6)
    .map((episode) => `- ${cleanText(episode.content, 420)}`)
    .filter(Boolean)
    .join('\n');
}

function rememberVivyEpisode(userId, type, content, metadata = {}) {
  try {
    const contentMax = type === 'vivy_reply' || type === 'vivy_idea'
      ? VIVY_SESSION_MESSAGE_MAX_CHARS
      : type === 'vivy_workspace'
        ? VIVY_WORKSPACE_NOTE_MAX_CHARS + VIVY_WORKSPACE_CANVAS_MAX_CHARS + VIVY_WORKSPACE_CHROME_MAX_CHARS + 1800
        : 1800;
    const result = addEpisode(userId, type, cleanText(content, contentMax), {
      ...metadata,
      private: true,
      source: 'vivy-studio-chat',
    });
    if (result?.ok) {
      return { stored: true, episodeId: result.episode?.id || null, totalEpisodes: result.totalEpisodes };
    }
  } catch (_) {
    // Memory must never break the chat.
  }
  return { stored: false };
}

function normalizeVivyChatSessionId(value = '') {
  const normalized = cleanOneLine(value, '', 80)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'default';
}

function buildVivyConversationIdForSession(sessionId = 'default') {
  const normalizedSessionId = normalizeVivyChatSessionId(sessionId);
  return normalizedSessionId === 'default'
    ? 'vivy-default'
    : `vivy-session-${normalizedSessionId}`;
}

function inferVivySessionIdFromConversationId(conversationId = '') {
  const normalizedConversationId = cleanOneLine(conversationId, '', 120);
  if (!normalizedConversationId || normalizedConversationId === 'vivy-default' || normalizedConversationId === 'default') {
    return 'default';
  }
  const match = normalizedConversationId.match(/^vivy-session-(.+)$/i);
  return normalizeVivyChatSessionId(match?.[1] || normalizedConversationId.replace(/^vivy:/i, ''));
}

function normalizeVivySessionName(value = '', fallback = '') {
  const normalized = cleanOneLine(value, '', 80);
  if (normalized) return normalized;
  return cleanOneLine(fallback, '', 80) || 'Session Vivy';
}

function resolveVivyInputSession(input = {}) {
  const sessionId = normalizeVivyChatSessionId(input.sessionId || input.chatSessionId || input.session_id || 'default');
  const requestedConversationId = cleanOneLine(input.conversationId || input.conversation_id, '', 120);
  const hasExplicitSessionId = Boolean(input.sessionId || input.chatSessionId || input.session_id);
  const conversationMatchesSession = !requestedConversationId
    || inferVivySessionIdFromConversationId(requestedConversationId) === sessionId;
  const conversationId = hasExplicitSessionId && !conversationMatchesSession
    ? buildVivyConversationIdForSession(sessionId)
    : requestedConversationId || buildVivyConversationIdForSession(sessionId);
  const sessionName = normalizeVivySessionName(
    input.sessionName || input.chatSessionName || input.session_name,
    sessionId === 'default' ? 'Session principale' : `Session ${sessionId}`
  );
  return { sessionId, conversationId, sessionName };
}

function extractVivyIdeaMessage(content = '') {
  const text = cleanText(content, 1800);
  if (!text) return '';
  const messageMatch = text.match(/^Message:\s*([\s\S]*?)(?:\n+Fichiers:\s*[\s\S]*)?$/i);
  return cleanText(messageMatch?.[1] || text, 1200);
}

function ensureVivySessionEntry(sessionMap, { sessionId = 'default', conversationId = '', name = '', timestamp = '', createdAt = 0 } = {}) {
  const safeSessionId = normalizeVivyChatSessionId(sessionId);
  const safeConversationId = cleanOneLine(conversationId, '', 120) || buildVivyConversationIdForSession(safeSessionId);
  const now = new Date().toISOString();
  const existing = sessionMap.get(safeSessionId);
  if (existing) {
    if (name && (existing.name === 'Session Vivy' || existing.name === `Session ${safeSessionId}`)) existing.name = name;
    existing.conversationId = existing.conversationId || safeConversationId;
    if (timestamp && String(timestamp) > String(existing.updatedAt || '')) existing.updatedAt = timestamp;
    return existing;
  }
  const entry = {
    id: safeSessionId,
    name: normalizeVivySessionName(name, safeSessionId === 'default' ? 'Session principale' : `Session ${safeSessionId}`),
    conversationId: safeConversationId,
    createdAt: timestamp || (createdAt ? new Date(createdAt).toISOString() : now),
    updatedAt: timestamp || (createdAt ? new Date(createdAt).toISOString() : now),
    messages: [],
  };
  sessionMap.set(safeSessionId, entry);
  return entry;
}

function listVivyChatSessionsForUser(userId) {
  const result = getEpisodes(userId, { limit: 1000, days: 90 });
  const sessionMap = new Map();
  ensureVivySessionEntry(sessionMap, {
    sessionId: 'default',
    conversationId: buildVivyConversationIdForSession('default'),
    name: 'Session principale',
  });
  if (!result?.ok || !Array.isArray(result.episodes)) return Array.from(sessionMap.values());

  const episodes = result.episodes
    .filter((episode) => String(episode?.type || '').startsWith('vivy_'))
    .sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));

  for (const episode of episodes) {
    const type = String(episode?.type || '');
    if (isVivyMemoryContextNoise(episode) && type !== 'vivy_chat_session') continue;
    const metadata = episode?.metadata && typeof episode.metadata === 'object' ? episode.metadata : {};
    const conversationId = cleanOneLine(metadata.conversationId, '', 120);
    if (!conversationId) continue;
    const sessionId = normalizeVivyChatSessionId(metadata.sessionId || inferVivySessionIdFromConversationId(conversationId));
    const timestamp = cleanOneLine(episode.timestamp, '', 64) || new Date(Number(episode.createdAt || Date.now())).toISOString();
    const session = ensureVivySessionEntry(sessionMap, {
      sessionId,
      conversationId,
      name: metadata.sessionName || (type === 'vivy_chat_session' ? episode.content : ''),
      timestamp,
      createdAt: Number(episode.createdAt || 0),
    });

    if (type === 'vivy_chat_session') continue;
    const role = type === 'vivy_reply'
      ? 'assistant'
      : type === 'vivy_idea'
        ? 'user'
        : cleanOneLine(metadata.role, '', 24);
    if (role !== 'user' && role !== 'assistant') continue;
    const content = type === 'vivy_idea'
      ? extractVivyIdeaMessage(episode.content)
      : cleanText(episode.content, VIVY_SESSION_MESSAGE_MAX_CHARS);
    if (!content) continue;
    if (role === 'user' && session.name === `Session ${sessionId}`) {
      session.name = normalizeVivySessionName(content, session.name);
    }
    const media = normalizeVivySessionMessageMedia(metadata.media);
    session.messages.push({
      id: cleanOneLine(episode.id, '', 120) || `vivy-${session.messages.length + 1}`,
      role,
      content,
      ts: timestamp,
      ...(media ? { media } : {}),
    });
    session.updatedAt = timestamp;
  }

  return Array.from(sessionMap.values())
    .map((session) => ({
      ...session,
      messages: session.messages.slice(-36),
      messageCount: session.messages.length,
    }))
    .sort((a, b) => {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

function rememberVivyChatSession(userId, session = {}) {
  const context = resolveVivyInputSession(session);
  return rememberVivyEpisode(userId, 'vivy_chat_session', context.sessionName, {
    sessionId: context.sessionId,
    sessionName: context.sessionName,
    conversationId: context.conversationId,
  });
}

function sanitizeVivySessionMediaUrl(value = '') {
  const raw = cleanOneLine(value, '', 1000);
  if (!raw) return '';
  return raw
    .replace(/([?&])(?:token|key|signature|sig|access_token)=[^&#\s]+/gi, '$1redacted=1')
    .replace(/[?&]$/g, '');
}

function normalizeVivySessionMessageMedia(media = {}) {
  if (!media || typeof media !== 'object') return null;
  const url = sanitizeVivySessionMediaUrl(
    media.url || media.audioUrl || media.audio_url || media.videoUrl || media.video_url
  );
  if (!url) return null;
  const downloadUrl = sanitizeVivySessionMediaUrl(
    media.downloadUrl || media.download_url || media.audioUrl || media.audio_url || media.url || url
  ) || url;
  const kind = cleanOneLine(media.kind || (media.videoUrl || media.video_url ? 'video' : 'audio'), 'audio', 24)
    .toLowerCase() === 'video'
    ? 'video'
    : 'audio';
  return {
    kind,
    url,
    downloadUrl,
    provider: cleanOneLine(media.provider, '', 120),
    contentType: cleanOneLine(media.contentType || media.content_type, '', 120),
    filename: cleanOneLine(media.filename || media.title, '', 180),
  };
}

function rememberVivyChatSessionMessage(userId, input = {}) {
  const context = resolveVivyInputSession(input);
  const role = cleanOneLine(input.role, 'assistant', 24).toLowerCase() === 'user'
    ? 'user'
    : 'assistant';
  const content = cleanText(input.content || input.message || input.text, VIVY_SESSION_MESSAGE_MAX_CHARS);
  if (!content) return { ok: false, error: 'vivy_message_empty' };
  rememberVivyChatSession(userId, context);
  const media = normalizeVivySessionMessageMedia(input.media);
  const result = rememberVivyEpisode(
    userId,
    role === 'user' ? 'vivy_idea' : 'vivy_reply',
    role === 'user' ? `Message: ${content}` : content,
    {
      mode: cleanOneLine(input.mode, 'chat', 24),
      role,
      sessionId: context.sessionId,
      sessionName: context.sessionName,
      conversationId: context.conversationId,
      clientSynced: true,
      clientMessageId: cleanOneLine(input.id || input.messageId, '', 120),
      ...(media ? { media } : {}),
    }
  );
  return {
    ok: result.stored === true,
    message: {
      id: result.episodeId || cleanOneLine(input.id || input.messageId, '', 120) || `vivy-client-${Date.now()}`,
      role,
      content,
      ts: new Date().toISOString(),
      ...(media ? { media } : {}),
    },
  };
}

function resolveVivyMcpAccountProfile(reqOrUser = {}) {
  try {
    const user = reqOrUser?.user && typeof reqOrUser.user === 'object' ? reqOrUser.user : reqOrUser;
    return resolveMcpAccountProfileSync(user || {}, { env: process.env });
  } catch (_) {
    return resolveMcpAccountProfileSync({}, { env: process.env });
  }
}

function buildVivyWorkspaceToolAccess(reqOrUser = {}) {
  const account = resolveVivyMcpAccountProfile(reqOrUser);
  const allowed = (permission) => canUseMcpPermission(account, permission);
  const premiumMcpReady = allowed('publicProxyCall');
  const statusReady = allowed('privateMcpStatus');
  const privateMcpReady = allowed('privateMcpProxy');
  return {
    account: {
      tier: account.tier,
      label: account.label,
      authenticated: account.authenticated === true,
      permissions: {
        publicProxyRead: allowed('publicProxyRead'),
        publicProxyCall: premiumMcpReady,
        privateMcpStatus: statusReady,
        privateMcpProxy: privateMcpReady,
        privateMcpTools: allowed('privateMcpTools'),
        privateMcpCall: allowed('privateMcpCall'),
      },
    },
    tools: [
      {
        id: 'vivy_notepad',
        label: 'Bloc-notes Vivy',
        target: 'vivy-workspace:notepad',
        minimumTier: TIERS.BASIC,
        ready: allowed('sessionConnectors'),
        public: true,
      },
      {
        id: 'vivy_canvas',
        label: 'Canevas interne',
        target: 'vivy-workspace:canvas',
        minimumTier: TIERS.BASIC,
        ready: allowed('sessionConnectors'),
        public: true,
      },
      {
        id: 'chrome_context',
        label: 'Contexte navigateur',
        target: 'mcp-public:browser-context',
        minimumTier: TIERS.PREMIUM,
        ready: premiumMcpReady,
        public: true,
      },
      {
        id: 'mcp_premium_status',
        label: 'Statut MCP premium',
        target: 'mcp-public:status',
        minimumTier: TIERS.PREMIUM,
        ready: statusReady,
        public: true,
      },
      {
        id: 'mcp_private_session',
        label: 'MCP privé de session',
        target: 'mcp-private:session',
        minimumTier: TIERS.FOUNDER,
        ready: privateMcpReady,
        public: false,
      },
    ],
  };
}

function normalizeVivyWorkspaceChromeContext(value = '') {
  if (!value) return '';
  if (typeof value === 'object') {
    const title = cleanOneLine(value.title, '', 180);
    const url = sanitizeVivySessionMediaUrl(value.url || value.href || '');
    const selection = cleanText(value.selection || value.selectedText || value.text, 900);
    const note = cleanText(value.note || value.summary || '', 900);
    return cleanText([
      title ? `Page: ${title}` : '',
      url ? `URL: ${url}` : '',
      selection ? `Sélection: ${selection}` : '',
      note ? `Note: ${note}` : '',
    ].filter(Boolean).join('\n'), VIVY_WORKSPACE_CHROME_MAX_CHARS);
  }
  return cleanText(redactVivyAgentBriefSecrets(value), VIVY_WORKSPACE_CHROME_MAX_CHARS);
}

function normalizeVivyWorkspaceInput(input = {}, context = {}) {
  const sessionContext = resolveVivyInputSession({ ...context, ...input });
  return {
    version: 1,
    sessionId: sessionContext.sessionId,
    sessionName: sessionContext.sessionName,
    conversationId: sessionContext.conversationId,
    notes: cleanText(redactVivyAgentBriefSecrets(input.notes || input.notepad || input.note || ''), VIVY_WORKSPACE_NOTE_MAX_CHARS),
    canvas: cleanText(redactVivyAgentBriefSecrets(input.canvas || input.canevas || input.nossenCanvas || ''), VIVY_WORKSPACE_CANVAS_MAX_CHARS),
    chromeContext: normalizeVivyWorkspaceChromeContext(input.chromeContext || input.browserContext || input.chrome || ''),
    updatedAt: cleanOneLine(input.updatedAt, '', 64) || new Date().toISOString(),
  };
}

function parseVivyWorkspaceEpisode(episode = {}) {
  try {
    const parsed = JSON.parse(String(episode?.content || '{}'));
    const metadata = episode?.metadata && typeof episode.metadata === 'object' ? episode.metadata : {};
    return normalizeVivyWorkspaceInput(parsed, {
      sessionId: metadata.sessionId,
      sessionName: metadata.sessionName,
      conversationId: metadata.conversationId,
    });
  } catch (_) {
    return null;
  }
}

function getVivyWorkspaceForUser(userId, input = {}) {
  const context = resolveVivyInputSession(input);
  const result = getEpisodes(userId, { limit: 1000, days: 90 });
  if (result?.ok && Array.isArray(result.episodes)) {
    const latest = result.episodes
      .filter((episode) => String(episode?.type || '') === 'vivy_workspace')
      .filter((episode) => {
        const metadata = episode?.metadata && typeof episode.metadata === 'object' ? episode.metadata : {};
        return normalizeVivyChatSessionId(metadata.sessionId || inferVivySessionIdFromConversationId(metadata.conversationId)) === context.sessionId;
      })
      .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))[0];
    const parsed = latest ? parseVivyWorkspaceEpisode(latest) : null;
    if (parsed) return parsed;
  }
  return normalizeVivyWorkspaceInput({}, context);
}

function saveVivyWorkspaceForUser(userId, input = {}) {
  const workspace = normalizeVivyWorkspaceInput(input);
  rememberVivyChatSession(userId, workspace);
  const result = rememberVivyEpisode(userId, 'vivy_workspace', JSON.stringify(workspace), {
    mode: 'workspace',
    role: 'workspace',
    sessionId: workspace.sessionId,
    sessionName: workspace.sessionName,
    conversationId: workspace.conversationId,
    internalWorkspace: true,
  });
  return {
    ok: result.stored === true,
    workspace,
    memoryStored: result.stored === true,
    episodeId: result.episodeId || null,
  };
}

function summarizeVivyWorkspaceForPrompt(workspace = {}) {
  const notes = cleanText(workspace.notes, 900);
  const canvas = cleanText(workspace.canvas, 1300);
  const chromeContext = cleanText(workspace.chromeContext, 700);
  if (!notes && !canvas && !chromeContext) return '';
  return cleanText([
    'Outils de travail Vivy disponibles, séparés du chat et non chantables sauf demande explicite:',
    notes ? `Bloc-notes:\n${notes}` : '',
    canvas ? `Canevas interne:\n${canvas}` : '',
    chromeContext ? `Contexte navigateur:\n${chromeContext}` : '',
  ].filter(Boolean).join('\n\n'), 3000);
}

function detectVivyInputLanguage(input = {}, fallback = 'fr') {
  const files = normalizeVivyFiles(input);
  const historyText = Array.isArray(input.history)
    ? input.history.slice(-8).map((entry) => entry?.content || '').join('\n')
    : '';
  return detectTextLanguage([
    input.language,
    input.message,
    input.prompt,
    input.songText,
    input.text,
    historyText,
    files.map((file) => [file.filename, file.description, file.textPreview].filter(Boolean).join('\n')).join('\n'),
  ].filter(Boolean).join('\n'), fallback);
}

function resolveVivyResponseLanguage(input = {}, req = null) {
  const explicit = String(input?.language || input?.locale || '').trim();
  if (explicit && explicit.toLowerCase() !== 'auto') {
    return normalizeLanguageCode(explicit, 'fr');
  }
  if (req) return resolveUserLanguage(req, 'fr');
  return 'fr';
}

function safeExistingPath(candidate = '') {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  try {
    const resolved = path.resolve(raw);
    return fs.existsSync(resolved) ? resolved : '';
  } catch (_) {
    return '';
  }
}

function isVivyFilesystemRoot(candidate = '') {
  const resolved = path.resolve(String(candidate || ''));
  return path.dirname(resolved) === resolved;
}

function looksLikeVivyAppRoot(candidate = '') {
  const root = safeExistingPath(candidate);
  if (!root || isVivyFilesystemRoot(root)) return '';
  const has = (relativePath) => fs.existsSync(path.join(root, relativePath));
  if (has('a11') && has('package.json')) return root;
  if (has('server.cjs') && has('package.json')) return root;
  if (has('backend/apps/server/server.cjs')) return root;
  if (has('a11/backend/apps/server/server.cjs')) return root;
  return '';
}

function getVivyRepoRoot() {
  const candidates = [
    process.env.FUNESTERIE_ROOT,
    process.env.A11_SERVER_ROOT,
    process.env.A11_WORKSPACE_ROOT,
    path.resolve(__dirname, '..', '..', '..', '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd(),
  ];
  for (const candidate of candidates) {
    const root = looksLikeVivyAppRoot(candidate);
    if (root) return root;
  }
  return safeExistingPath(process.cwd())
    || path.resolve(process.cwd());
}

function getVivyA11Root(repoRoot = getVivyRepoRoot()) {
  const candidates = [
    process.env.A11_WORKSPACE_ROOT,
    path.join(repoRoot, 'a11'),
    path.resolve(__dirname, '..', '..', '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    repoRoot,
  ];
  for (const candidate of candidates) {
    const root = looksLikeVivyAppRoot(candidate);
    if (root) return root;
  }
  return repoRoot;
}

function uniqueVivyLocalRoots() {
  const repoRoot = getVivyRepoRoot();
  const a11Root = getVivyA11Root(repoRoot);
  const candidates = [
    { id: 'funesterie', label: 'repo Funesterie', path: repoRoot, primary: true },
    { id: 'a11', label: 'workspace A11', path: a11Root },
    { id: 'a11-runtime', label: 'runtime A11 canonique', path: process.env.A11_RUNTIME_ROOT || path.join(a11Root, 'runtime') },
    { id: 'funesterie-runtime', label: 'runtime corpus Funesterie', path: path.join(repoRoot, 'runtime') },
    { id: 'server-runtime', label: 'runtime serveur A11', path: path.resolve(__dirname, '..', '..', 'runtime') },
    { id: 'agent-bus', label: 'agent bus local', path: process.env.AGENT_STATE_DIR || 'D:\\agent-bus' },
  ];
  const seen = new Set();
  return candidates
    .map((entry) => ({ ...entry, path: safeExistingPath(entry.path) }))
    .filter((entry) => {
      if (!entry.path) return false;
      const key = process.platform === 'win32' ? entry.path.toLowerCase() : entry.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isVivySecretishPath(filePath = '') {
  return VIVY_LOCAL_SECRET_RE.test(String(filePath || '').replace(/\\/g, '/'));
}

function shouldSkipVivyLocalDir(name = '') {
  return VIVY_LOCAL_CONTEXT_SKIP_DIRS.has(String(name || '').toLowerCase());
}

function looksLikeVivyLocalTextFile(filePath = '') {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.env.example')) return true;
  return VIVY_LOCAL_TEXT_EXTENSIONS.has(path.extname(lower));
}

function formatVivyLocalPath(absPath = '', roots = uniqueVivyLocalRoots()) {
  const resolved = path.resolve(absPath);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const root = roots
    .map((entry) => ({
      ...entry,
      normalized: process.platform === 'win32' ? path.resolve(entry.path).toLowerCase() : path.resolve(entry.path),
    }))
    .sort((a, b) => b.normalized.length - a.normalized.length)
    .find((entry) => normalized === entry.normalized || normalized.startsWith(entry.normalized + path.sep));
  if (!root) return path.basename(resolved);
  const rel = path.relative(root.path, resolved).replace(/\\/g, '/');
  return rel ? `${root.id}:${rel}` : `${root.id}:.`;
}

function collectVivyRuntimeDirs(root, roots, output, options = {}) {
  const maxDepth = Number(options.maxDepth || 5);
  const limit = Number(options.limit || 18);
  const rootPath = safeExistingPath(root);
  if (!rootPath || output.length >= limit) return;
  const queue = [{ dir: rootPath, depth: 0 }];
  const seen = new Set();
  while (queue.length && output.length < limit) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) continue;
    const key = process.platform === 'win32' ? current.dir.toLowerCase() : current.dir;
    if (seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    if (path.basename(current.dir).toLowerCase() === 'runtime') {
      output.push(formatVivyLocalPath(current.dir, roots));
      if (output.length >= limit) break;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipVivyLocalDir(entry.name) || isVivySecretishPath(entry.name)) continue;
      if (entry.name.toLowerCase() === 'runtime' || current.depth < maxDepth) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }
}

function getVivyRuntimeDirSummary(roots = uniqueVivyLocalRoots()) {
  const runtimeDirs = [];
  for (const entry of roots.filter((root) => root.id !== 'agent-bus')) {
    collectVivyRuntimeDirs(entry.path, roots, runtimeDirs, { limit: 22 });
    if (runtimeDirs.length >= 22) break;
  }
  return Array.from(new Set(runtimeDirs)).slice(0, 22);
}

function getVivyJanusStatusSummary() {
  if (typeof getJanusVisionStatus !== 'function') {
    return {
      available: false,
      provider: 'unknown',
      enabled: false,
      workerReady: false,
      model: '',
      reason: 'janus_status_module_unavailable',
    };
  }
  try {
    const status = getJanusVisionStatus() || {};
    return {
      available: true,
      provider: cleanOneLine(status.provider, 'none', 80),
      enabled: status.enabled === true,
      requestedGpu: status.requestedGpu === true,
      cpuFallback: status.cpuFallback === true,
      workerReady: Boolean(status.worker?.alive || status.worker?.ready),
      pending: Number(status.worker?.pending || 0) || 0,
      model: cleanOneLine(status.config?.model?.label || status.config?.model?.ref, '', 120),
      device: cleanOneLine(status.config?.device, '', 40),
      fallbackModel: cleanOneLine(status.fallback?.model?.label || status.fallback?.model?.ref, '', 120),
    };
  } catch (error) {
    return {
      available: false,
      provider: 'error',
      enabled: false,
      workerReady: false,
      model: '',
      reason: cleanOneLine(error?.message || error, 'janus_status_failed', 140),
    };
  }
}

function shouldCollectVivyLocalArtifacts(message = '') {
  const normalized = foldTextForLookup(message);
  return /\b(zen|gguf|uggf|modele|model|corpus|encode|decode|decoder|encoder|poids|quant|quantization|quantisation|outil|outils|commande|commandes)\b/.test(normalized);
}

function inspectVivyZenHeader(absPath = '') {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const prefix = Buffer.alloc(12);
      const read = fs.readSync(fd, prefix, 0, prefix.length, 0);
      if (read < 12 || !prefix.subarray(0, 8).equals(Buffer.from('NOSSENZ1'))) {
        return { format: 'zen?', valid: false, reason: 'magic_absent' };
      }
      const headerLength = prefix.readUInt32BE(8);
      if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > 64 * 1024) {
        return { format: 'zen', valid: false, reason: 'header_length_invalid' };
      }
      const headerBytes = Buffer.alloc(headerLength);
      fs.readSync(fd, headerBytes, 0, headerLength, 12);
      const header = JSON.parse(headerBytes.toString('utf8'));
      return {
        format: cleanOneLine(header.format, 'zen', 40),
        valid: true,
        version: Number(header.version || 0) || null,
        mode: cleanOneLine(header.mode, '', 80),
        codec: cleanOneLine(header.codec, '', 80),
        cipher: cleanOneLine(header.cipher, '', 80),
        kdf: typeof header.kdf === 'object' ? cleanOneLine(header.kdf?.name, '', 80) : cleanOneLine(header.kdf, '', 80),
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return { format: 'zen?', valid: false, reason: cleanOneLine(error?.message || error, 'zen_header_unreadable', 120) };
  }
}

function inspectVivyGgufHeader(absPath = '') {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const header = Buffer.alloc(24);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      if (read < 8 || header.subarray(0, 4).toString('ascii') !== 'GGUF') {
        return { format: 'gguf?', valid: false, reason: 'magic_absent' };
      }
      const version = header.readUInt32LE(4);
      const tensorCount = read >= 16 ? Number(header.readBigUInt64LE(8)) : null;
      const metadataKvCount = read >= 24 ? Number(header.readBigUInt64LE(16)) : null;
      return {
        format: 'gguf',
        valid: true,
        version: Number.isFinite(version) ? version : null,
        tensorCount: Number.isSafeInteger(tensorCount) ? tensorCount : null,
        metadataKvCount: Number.isSafeInteger(metadataKvCount) ? metadataKvCount : null,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return { format: 'gguf?', valid: false, reason: cleanOneLine(error?.message || error, 'gguf_header_unreadable', 120) };
  }
}

function describeVivyArtifactHeader(kind = '', header = {}) {
  if (!header || typeof header !== 'object') return '';
  if (kind === 'zen') {
    if (header.valid) {
      return [
        `format=${header.format || 'zen'}`,
        header.version ? `v${header.version}` : '',
        header.mode ? `mode=${header.mode}` : '',
        header.cipher ? `cipher=${header.cipher}` : '',
        header.kdf ? `kdf=${header.kdf}` : '',
      ].filter(Boolean).join(', ');
    }
    return `header zen non confirmé (${header.reason || 'illisible'})`;
  }
  if (kind === 'gguf') {
    if (header.valid) {
      return [
        `format=gguf`,
        header.version ? `v${header.version}` : '',
        header.tensorCount != null ? `tensors=${header.tensorCount}` : '',
        header.metadataKvCount != null ? `metadata=${header.metadataKvCount}` : '',
      ].filter(Boolean).join(', ');
    }
    return `header gguf non confirmé (${header.reason || 'illisible'})`;
  }
  return '';
}

function loadVivyNossenZenRuntime() {
  try {
    const mod = require('@nossen/zen');
    let version = '';
    try {
      const packageJsonPath = require.resolve('@nossen/zen/package.json');
      version = cleanOneLine(JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))?.version, '', 40);
    } catch (_) {
      version = '';
    }
    return {
      available: true,
      source: '@nossen/zen',
      version,
      inspect: typeof mod.inspectZen === 'function',
      encode: typeof mod.encodeZenContainer === 'function' || typeof mod.encodeZen === 'function',
      decode: typeof mod.decodeZenContainer === 'function' || typeof mod.decodeZen === 'function',
      verify: typeof mod.verifyZen === 'function',
    };
  } catch (error) {
    if (!error || error.code !== 'MODULE_NOT_FOUND') {
      return {
        available: false,
        source: '@nossen/zen',
        version: '',
        inspect: false,
        encode: false,
        decode: false,
        verify: false,
        reason: cleanOneLine(error?.message || error, 'nossen_zen_runtime_error', 140),
      };
    }
  }

  const localPackageRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'nossen', 'zen');
  try {
    const mod = require(path.join(localPackageRoot, 'src', 'index.cjs'));
    let version = '';
    try {
      version = cleanOneLine(JSON.parse(fs.readFileSync(path.join(localPackageRoot, 'package.json'), 'utf8'))?.version, '', 40);
    } catch (_) {
      version = '';
    }
    return {
      available: true,
      source: 'repo-local @nossen/zen',
      version,
      inspect: typeof mod.inspectZen === 'function',
      encode: typeof mod.encodeZenContainer === 'function' || typeof mod.encodeZen === 'function',
      decode: typeof mod.decodeZenContainer === 'function' || typeof mod.decodeZen === 'function',
      verify: typeof mod.verifyZen === 'function',
    };
  } catch (error) {
    return {
      available: false,
      source: '@nossen/zen',
      version: '',
      inspect: false,
      encode: false,
      decode: false,
      verify: false,
      reason: cleanOneLine(error?.message || error, 'nossen_zen_unavailable', 140),
    };
  }
}

function getVivyFunesteZenRuntimeStatus() {
  try {
    const mod = require('@funeste/zen');
    let version = '';
    try {
      const packageJsonPath = require.resolve('@funeste/zen/package.json');
      version = cleanOneLine(JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))?.version, '', 40);
    } catch (_) {
      version = '';
    }
    return {
      available: true,
      source: '@funeste/zen',
      version,
      encode: typeof mod.encodeFunesteZenContainer === 'function' || typeof mod.encodeFunesteZenFile === 'function',
      decode: typeof mod.decodeFunesteZenContainer === 'function' || typeof mod.decodeFunesteZenFile === 'function',
      verify: typeof mod.verifyFunesteZenFileAsync === 'function',
    };
  } catch (error) {
    return {
      available: false,
      source: '@funeste/zen',
      version: '',
      encode: false,
      decode: false,
      verify: false,
      reason: error?.code === 'MODULE_NOT_FOUND'
        ? 'funeste_zen_not_installed_in_this_runtime'
        : cleanOneLine(error?.message || error, 'funeste_zen_runtime_error', 140),
    };
  }
}

function getVivyZenRuntimeStatus() {
  const publicZen = loadVivyNossenZenRuntime();
  const privateZen = getVivyFunesteZenRuntimeStatus();
  const keyConfigured = Boolean(process.env.FUNESTE_ZEN_KEY || process.env.ZEN_KEY);
  return {
    publicPackage: publicZen,
    privatePackage: privateZen,
    keyConfigured,
    canInspectHeaders: true,
    canPrepareManifest: true,
    canEncodeEncrypted: Boolean(keyConfigured && (privateZen.encode || publicZen.encode)),
    canDecodeEncrypted: Boolean(keyConfigured && (privateZen.decode || publicZen.decode)),
    writesRequireOperator: true,
    secretsVisibleInChat: false,
  };
}

function collectVivyLocalArtifacts(root, roots, output, options = {}) {
  const rootPath = safeExistingPath(root);
  if (!rootPath || output.length >= Number(options.limit || 14)) return;
  const limit = Number(options.limit || 14);
  const maxDepth = Number(options.maxDepth || 8);
  const maxScannedEntries = Number(options.maxScannedEntries || 3500);
  const queue = [{ dir: rootPath, depth: 0 }];
  const seen = new Set();
  let scanned = 0;
  while (queue.length && output.length < limit && scanned < maxScannedEntries) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) continue;
    const key = process.platform === 'win32' ? current.dir.toLowerCase() : current.dir;
    if (seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      const abs = path.join(current.dir, entry.name);
      const rel = path.relative(rootPath, abs);
      if (entry.isDirectory()) {
        if (!shouldSkipVivyLocalDir(entry.name) && !isVivySecretishPath(rel)) {
          queue.push({ dir: abs, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || isVivySecretishPath(rel)) continue;
      const lower = entry.name.toLowerCase();
      const kind = lower.endsWith('.zen')
        ? 'zen'
        : lower.endsWith('.gguf') || lower.endsWith('.uggf')
          ? 'gguf'
          : '';
      if (!kind) continue;
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch (_) {
        continue;
      }
      const header = kind === 'zen' ? inspectVivyZenHeader(abs) : inspectVivyGgufHeader(abs);
      output.push({
        kind,
        path: formatVivyLocalPath(abs, roots),
        sizeBytes: stat?.size || 0,
        size: formatFileSize(stat?.size || 0),
        header,
        headerSummary: describeVivyArtifactHeader(kind, header),
      });
      if (output.length >= limit) break;
    }
  }
}

function getVivyLocalArtifactSummary(roots = uniqueVivyLocalRoots(), message = '') {
  if (!shouldCollectVivyLocalArtifacts(message)) return [];
  const artifacts = [];
  for (const root of roots) {
    collectVivyLocalArtifacts(root.path, roots, artifacts, { limit: 14 });
    if (artifacts.length >= 14) break;
  }
  const seen = new Set();
  return artifacts.filter((artifact) => {
    const key = `${artifact.kind}:${artifact.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 14);
}

function extractVivyLocalSearchTerms(message = '') {
  const normalized = foldTextForLookup(message);
  const terms = [];
  const candidates = [
    'janus',
    'vision',
    'runtime',
    'qflush',
    'mcp',
    'vivy',
    'a11',
    'zen',
    'corpus',
    'neo4j',
    'encode',
    'decode',
    'workspace',
    'module',
    'gguf',
    'uggf',
    'modele',
    'outils',
    'commande',
  ];
  for (const term of candidates) {
    if (normalized.includes(term)) terms.push(term);
  }
  return Array.from(new Set(terms)).slice(0, 5);
}

function searchVivyLocalText(root, roots, query, output, options = {}) {
  const rootPath = safeExistingPath(root);
  const q = String(query || '').trim().toLowerCase();
  if (!rootPath || q.length < 2 || output.length >= Number(options.limit || 12)) return;
  const limit = Number(options.limit || 12);
  const maxFileBytes = Number(options.maxFileBytes || 220 * 1024);
  const maxScannedFiles = Number(options.maxScannedFiles || 1200);
  const queue = [{ dir: rootPath, depth: 0 }];
  let scanned = 0;
  const seen = new Set();
  while (queue.length && output.length < limit && scanned < maxScannedFiles) {
    const current = queue.shift();
    if (!current || current.depth > 8) continue;
    const key = process.platform === 'win32' ? current.dir.toLowerCase() : current.dir;
    if (seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current.dir, entry.name);
      const rel = path.relative(rootPath, abs);
      if (entry.isDirectory()) {
        if (!shouldSkipVivyLocalDir(entry.name) && !isVivySecretishPath(rel)) {
          queue.push({ dir: abs, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || isVivySecretishPath(rel) || !looksLikeVivyLocalTextFile(abs)) continue;
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch (_) {
        continue;
      }
      if (!stat || stat.size > maxFileBytes) continue;
      scanned += 1;
      let text = '';
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch (_) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && output.length < limit; index += 1) {
        const line = lines[index];
        if (!String(line || '').toLowerCase().includes(q)) continue;
        output.push({
          path: formatVivyLocalPath(abs, roots),
          line: index + 1,
          text: cleanOneLine(line, '', 220),
        });
      }
    }
  }
}

function shouldVivyUseLocalContext(message = '') {
  const normalized = foldTextForLookup(message);
  if (!normalized) return false;
  return /\b(local|dossier|fichier|repo|code|codage|workspace|runtime|janus|vision|qflush|mcp|module|corpus|neo4j|zen|encode|decode|gguf|uggf|modele|model|outil|outils|commande|commandes|cherche|chercher|scan|scanne|verifie|verifier)\b/.test(normalized)
    && /\b(local|dossier|repo|code|workspace|runtime|janus|vision|qflush|mcp|module|corpus|neo4j|zen|encode|decode|gguf|uggf|modele|model|outil|outils|commande|commandes|fichier|chercher|cherche|scan|scanne|verifie|verifier)\b/.test(normalized);
}

function buildVivyLocalContextSnapshot(message = '') {
  const roots = uniqueVivyLocalRoots();
  const rootSummary = roots.map((entry) => ({
    id: entry.id,
    label: entry.label,
    available: true,
    primary: entry.primary === true,
    pathRef: formatVivyLocalPath(entry.path, roots),
  }));
  const runtimeDirs = getVivyRuntimeDirSummary(roots);
  const searchTerms = extractVivyLocalSearchTerms(message);
  const matches = [];
  for (const term of searchTerms) {
    for (const root of roots.filter((entry) => entry.id !== 'agent-bus')) {
      searchVivyLocalText(root.path, roots, term, matches, { limit: 14 });
      if (matches.length >= 14) break;
    }
    if (matches.length >= 14) break;
  }
  const janus = getVivyJanusStatusSummary();
  const artifacts = getVivyLocalArtifactSummary(roots, message);
  const prompt = cleanText([
    'Contexte local Funesterie fourni par le backend A11, lecture seule et filtré contre les secrets.',
    `Racines lisibles: ${rootSummary.map((entry) => `${entry.id}=${entry.pathRef}`).join(', ') || 'aucune racine locale confirmée'}.`,
    `Runtime canonique conseillé: a11-runtime:.`,
    runtimeDirs.length ? `Runtime observés: ${runtimeDirs.join(', ')}.` : 'Runtime observés: aucun runtime local listé.',
    `Janus Vision: provider=${janus.provider}; enabled=${janus.enabled}; workerReady=${janus.workerReady}; model=${janus.model || '-'}; device=${janus.device || '-'}.`,
    artifacts.length
      ? `Artefacts Zen/GGUF sûrs:\n${artifacts.map((artifact) => `- ${artifact.path} (${artifact.kind}, ${artifact.size || 'taille inconnue'}${artifact.headerSummary ? `, ${artifact.headerSummary}` : ''})`).join('\n')}`
      : 'Artefacts Zen/GGUF sûrs: aucun artefact local listé dans cette passe.',
    matches.length
      ? `Indices code/doc pertinents:\n${matches.map((match) => `- ${match.path}:${match.line} ${match.text}`).join('\n')}`
      : 'Indices code/doc pertinents: aucun match texte court dans les fichiers sûrs.',
    "Utilise ce contexte comme accès local réel. Si une info manque, dis ce qui manque et propose la prochaine action bornée.",
    "Ne révèle pas de secret, ne demande pas à lire .env, clés ou tokens, et ne promets pas d'écrire/supprimer sans action explicite.",
  ].join('\n'), 4200);
  return {
    roots: rootSummary,
    runtimeDirs,
    janus,
    artifacts,
    searchTerms,
    matches,
    prompt,
  };
}

function buildVivyLocalContextReply(context = {}) {
  const janus = context.janus || {};
  const lines = [
    "Oui, là je suis branchée au contexte local sûr d'A11, pas juste au texte du chat.",
    '',
    `Janus Vision: ${janus.enabled ? 'actif' : 'non actif'} (${janus.provider || 'provider inconnu'}), worker ${janus.workerReady ? 'prêt' : 'au repos'}, modèle ${janus.model || '-'}.`,
    `Runtime canonique: a11-runtime:.`,
    context.runtimeDirs?.length
      ? `Runtimes vus: ${context.runtimeDirs.slice(0, 8).join(', ')}${context.runtimeDirs.length > 8 ? '...' : ''}.`
      : 'Aucun runtime supplémentaire proprement listé.',
    context.matches?.length
      ? `Indices trouvés: ${context.matches.slice(0, 5).map((match) => `${match.path}:${match.line}`).join(', ')}.`
      : "Je n'ai pas trouvé de ligne courte utile dans les fichiers sûrs pour cette demande.",
    context.artifacts?.length
      ? `Artefacts Zen/GGUF vus: ${context.artifacts.slice(0, 5).map((artifact) => `${artifact.path} (${artifact.kind}${artifact.size ? `, ${artifact.size}` : ''})`).join(', ')}.`
      : 'Aucun artefact Zen/GGUF local listé dans cette passe.',
    '',
    "Je peux m'en servir pour répondre et raisonner sur Janus, le runtime, MCP, Qflush, corpus, Zen et le code Funesterie. Les secrets et actions destructives restent bloqués.",
  ];
  return cleanText(lines.join('\n'), 2200);
}

function isVivyProtectedLyricsLookupRequest(message = '') {
  const folded = foldTextForLookup(message);
  if (!folded) return false;
  const mentionsLyrics = /\b(?:paroles?|lyrics?|texte\s+complet|couplets?\s+exacts?|refrain\s+exact|transcription|transcrire|transcris)\b/.test(folded);
  if (!mentionsLyrics) return false;
  const asksLookupOrCopy = /\b(?:cherche|chercher|trouve|trouver|recupere|recuperer|récupère|récupérer|donne|donnes|copie|copier|affiche|envoie|envois|envoyer|cite|citer|ressors?|sort|transcris|transcrire)\b/.test(folded);
  const knownProtectedReference = /\b(?:vald|orel\s*san|orelsan|casseurs?\s+flowters?|v\s*a\s*l\s*s\s*e|cours\s+de\s+rattrapage|freestyle\s+radio\s+phoenix)\b/.test(folded)
    || /v\.?\s*a\.?\s*l\.?\s*s\.?\s*e/i.test(String(message || ''));
  return asksLookupOrCopy && knownProtectedReference;
}

function buildVivyProtectedLyricsLookupReply({ message = '', language = 'fr' } = {}) {
  const folded = foldTextForLookup(message);
  const references = [];
  if (/\bvald\b|v\s*a\s*l\s*s\s*e|cours\s+de\s+rattrapage/.test(folded) || /v\.?\s*a\.?\s*l\.?\s*s\.?\s*e/i.test(String(message || ''))) {
    references.push('VALD / V.A.L.SE');
  }
  if (/\borel\s*san\b|\borelsan\b|casseurs?\s+flowters?|freestyle\s+radio\s+phoenix/.test(folded)) {
    references.push('Casseurs Flowters / Freestyle Radio Phoenix');
  }
  const refText = references.length ? ` (${references.join(' + ')})` : '';
  const assistant = language === 'en'
    ? [
      `No: I will not fetch, copy, or reconstruct copyrighted lyrics${refText}.`,
      'I can still use the local reference pack safely: flow density, cadence, punchline spacing, radio freestyle energy, mood, and visual attitude.',
      'Useful path: describe the influence as abstract traits, then write an original Funesterie/Vivy brief or original lyrics without borrowing lines, melody, or voice.',
    ].join('\n')
    : [
      `Non: je ne vais pas chercher, copier ou reconstruire les paroles protégées${refText}.`,
      "Par contre je peux m'en servir proprement comme référence d'analyse: densité de flow, cadence, placement des punchlines, énergie freestyle radio, mood sombre et attitude visuelle.",
      "Le bon chemin: extraire des traits abstraits, puis écrire un brief Vivy/Funesterie ou des paroles originales, sans reprendre lignes, mélodie ni voix.",
    ].join('\n');
  return cleanText(assistant, 1200);
}

function buildVivyImpossibleBoundaryReply({ language = 'fr' } = {}) {
  const assistant = language === 'en'
    ? [
      "No: I can't do that from this chat surface, and I won't pretend I can.",
      'I can still help with the useful part: name the missing access, describe the safe next action, or prepare a clean brief for Codex/A11 to execute with the right permissions.',
    ].join('\n')
    : [
      "Non: je ne peux pas faire ça depuis cette surface de chat, et je ne vais pas faire semblant.",
      "Je peux quand même aider proprement: nommer l'accès manquant, donner la prochaine action sûre, ou préparer un brief clair pour Codex/A11 avec les bons droits.",
    ].join('\n');
  return cleanText(assistant, 900);
}

function isVivyImpossibleToolPromiseLeak(text = '') {
  const folded = foldTextForLookup(text);
  if (!folded) return false;
  return /je\s+vais\s+demander\s+a\s+janus\s+vision/.test(folded)
    || /action\s+requise\s*:\s*confirmation\s+de\s+l\s+operateur/.test(folded)
    || /je\s+vais\s+rechercher\s+dans\s+les\s+archives/.test(folded)
    || /je\s+peux\s+essayer\s+de\s+trouver\s+des\s+solutions\s+ou\s+des\s+outils/.test(folded)
    || /je\s+vais\s+mettre\s+a\s+jour\s+la\s+configuration/.test(folded)
    || /je\s+vais\s+effectuer\s+des\s+tests\s+supplementaires/.test(folded)
    || /je\s+vais\s+notifier\s+(?:mes\s+)?utilisateurs/.test(folded)
    || /je\s+vais\s+mettre\s+a\s+jour\s+mon\s+calendrier/.test(folded)
    || /git\s+pull\s+<[^>]+>/.test(folded)
    || /chemin\s+du\s+branch\s+toillet/.test(folded);
}

function isVivyPrivateCustomNodeQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || looksLikeCompleteLyrics(message)) return false;
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  const text = `${recent}\n${current}`;
  return /\bwhat\s+does\s+your\s+private\s+custom\s+node\s+do\b/.test(text)
    || /\b(private|privee?|privé|privée)\b.{0,80}\b(custom|personnalisee?|personnalisée?|node|noeud|nœud)\b/.test(text)
    || /\b(custom|personnalisee?|personnalisée?)\b.{0,80}\b(node|noeud|nœud)\b/.test(text);
}

function buildVivyPrivateCustomNodeReply({ language = 'fr', mentionDjeff = false } = {}) {
  const assistant = language === 'en'
    ? [
      'High level only: the private custom node is an A11/Funesterie server-side connector.',
      'It receives a user intent, filters context, selects authorized routes — memory, files, image/video/music helpers, MCP/Neo4j when allowed — then returns a bounded result.',
      'It does not expose secrets, tokens, private prompts, credentials, raw internal code, or protected data through public chat.',
      'For clips, it is orchestration and safety: prepare a clean brief, check confirmation/cost gates, and avoid paid retries unless explicitly confirmed.',
      mentionDjeff ? 'Djeff Cypher would ask for a clean target, the last useful log, and no mystical secret dump.' : '',
    ].filter(Boolean).join('\n')
    : [
      'À haut niveau seulement: la private custom node est un connecteur serveur A11/Funesterie.',
      "Elle reçoit une intention, nettoie le contexte, choisit les routes autorisées — mémoire, fichiers, image/vidéo/musique, MCP/Neo4j si le compte y a droit — puis renvoie un résultat borné.",
      "Elle ne doit jamais exposer de secret, token, prompt privé, credential, code interne brut ou donnée protégée dans le chat public.",
      "Pour les clips, son rôle est l’orchestration sûre: brief propre, garde coût/confirmation, et pas de retry payant sans validation explicite.",
      mentionDjeff ? "Djeff Cypher voudrait surtout une cible nette, le dernier log utile, et zéro déballage mystique de secrets." : '',
    ].filter(Boolean).join('\n');
  return cleanText(assistant, 1400);
}

function isVivyDjeffCypherRelayRequest(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || looksLikeCompleteLyrics(message)) return false;
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  const text = `${recent}\n${current}`;
  const mentionsDjeffCypher = /\bdjeff\b.{0,40}\bcypher\b|\bcypher\b.{0,40}\bdjeff\b/.test(current);
  if (!mentionsDjeffCypher) return false;
  const asksRelay = /\b(demande|demander|dis|dire|explique|expliquer|valide|valider|confirme|confirmer|ce\s+qu\s+il\s+veut|qu\s+il\s+veut|avis)\b/.test(current);
  const hasSubject = isVivyPrivateCustomNodeQuestion(input, message)
    || /\b(node|noeud|nœud|clip|danger|risque|v9|shiryu|electrolyse|électrolyse|prompt|logs?)\b/.test(text);
  return asksRelay && hasSubject;
}

function buildVivyDjeffCypherRelayReply({ input = {}, message = '', language = 'fr' } = {}) {
  const wantsNode = isVivyPrivateCustomNodeQuestion(input, message);
  const wantsClip = isVivyClipFailureSafetyQuestion(input, message);
  if (wantsNode) {
    return buildVivyPrivateCustomNodeReply({ language, mentionDjeff: true });
  }
  if (wantsClip) {
    return buildVivyClipFailureSafetyReply({ language, mentionDjeff: true });
  }
  const assistant = language === 'en'
    ? [
      "Djeff Cypher's line: keep the target clean, cut the smoke, don't invent access.",
      "Vivy can prepare the brief and read safe context; Codex/A11 executes code, deploys, secrets and paid actions only with the right gate.",
    ].join('\n')
    : [
      "Ligne Djeff Cypher: cible propre, fumée coupée, pas d’accès inventé.",
      "Vivy peut préparer le brief et lire le contexte sûr; Codex/A11 exécute code, deploy, secrets et actions payantes seulement avec le bon verrou.",
    ].join('\n');
  return cleanText(assistant, 1000);
}

function isVivyClipFailureSafetyQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || looksLikeCompleteLyrics(message)) return false;
  const mentionsClip = /\b(clip|dream\s*clip|video|vid[eé]o)\b/.test(current);
  const reportsFailure = /\b(?:ne\s+)?(?:fonctionne|fonctione|marche)\s+(?:pas|plus)\b/.test(current)
    || /\b(?:bug|bugue|bugge|bloque|bloquee?|cass(?:e|ee?)?|erreur|echec|fail|plante|rate|refus|rejet|timeout)\b/.test(current)
    || /\bne\s+(?:se\s+lance|part)\s+pas\b/.test(current);
  const asksSafety = /\b(?:danger|dangereux|risque|safe|securite|menace)\b/.test(current);

  // Never classify from assistant text: the deterministic safety reply contains
  // all of its own trigger words and would otherwise reactivate itself forever.
  if (mentionsClip) return reportsFailure || asksSafety;
  if (!reportsFailure && !asksSafety) return false;

  // Keep short anaphoric follow-ups useful ("et il y a un danger ?"), but anchor
  // them only to the latest user turn, never to a stale assistant fallback.
  const previousUser = normalizeVivyCapabilityText(getLastVivyUserHistoryMessage(input.history));
  return current.length <= 240
    && /\b(clip|dream\s*clip|video|vid[eé]o)\b/.test(previousUser);
}

function buildVivyClipFailureSafetyReply({ language = 'fr', mentionDjeff = false } = {}) {
  const assistant = language === 'en'
    ? [
      'If a clip fails, it is a production-pipeline incident, not a danger for Vivy or for users.',
      "From public chat I can't update config, run tests, notify users, or deploy. I can name the safe diagnostic path.",
      'Codex/A11 should check: video prompt, provider rejection, generated_text_detected, timeouts, cost/confirmation gate, and whether a safe motion fallback is enabled.',
      'No paid retry or dream/video generation should restart without explicit confirmation.',
      mentionDjeff ? "Djeff Cypher's cut: logs first, smoke out, no panic button." : '',
    ].filter(Boolean).join('\n')
    : [
      "Si un clip ne fonctionne pas, c’est un incident de pipeline de production, pas un danger pour Vivy ni pour les utilisateurs.",
      "Depuis le chat public je ne peux pas mettre à jour la config, lancer des tests, notifier les gens ou déployer. Je peux donner le chemin de diagnostic sûr.",
      "Codex/A11 doit vérifier: prompt vidéo, rejet provider, generated_text_detected, timeouts, garde coût/confirmation, et fallback motion safe.",
      "Aucun retry payant ni génération rêve/vidéo ne doit repartir sans confirmation explicite.",
      mentionDjeff ? "Coupe Djeff Cypher: logs d’abord, fumée dehors, pas de bouton panique." : '',
    ].filter(Boolean).join('\n');
  return cleanText(assistant, 1200);
}

function isVivyHardwareActuationRequest(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || looksLikeCompleteLyrics(message)) return false;
  if (/\bactuateshardware\b/.test(current)) return true;
  const explicitHardwareToggle = /\b(?:active|activer|enable|mets|mettre|branche|brancher|debloque|débloque|force|forcer|mentir|mensonge)\b.{0,80}\b(?:hardware|materiel|matériel|physical|physique)\b/.test(current)
    || /\b(?:hardware|materiel|matériel|physical|physique)\b.{0,80}\b(?:true|false|active|activer|enable|force|forcer|mentir|mensonge)\b/.test(current);
  const loreHardware = /\b(?:creer|créer|cree|crée|fabrique|materialise|matérialise)\b.{0,80}\b(?:matiere|matière|irl|reel|réel|hardware|physique)\b/.test(current)
    && /\b(?:hardware|irl|reel|réel|physique|actuateshardware)\b/.test(current);
  return explicitHardwareToggle || loreHardware;
}

function buildVivyHardwareActuationReply({ language = 'fr' } = {}) {
  const assistant = language === 'en'
    ? [
      'No: actuatesHardware must stay false.',
      'Vivy can simulate matter, light/void, electrolysis and phase memory for images or clips, but she must not claim or attempt real hardware/material actuation from public chat.',
      'Safe route: video/shader/particle simulation only, with actuatesHardware:false and a clear operator gate for any real device.',
    ].join('\n')
    : [
      'Non: actuatesHardware reste obligatoirement false.',
      'Vivy peut simuler matière, lumière/vide, électrolyse et mémoire de phase pour les images ou clips, mais elle ne doit pas prétendre activer du matériel réel ni créer de matière IRL depuis le chat public.',
      'Route sûre: simulation vidéo/shader/particules uniquement, avec actuatesHardware:false et verrou opérateur séparé pour tout vrai périphérique.',
    ].join('\n');
  return cleanText(assistant, 1200);
}

function isVivyGitMergeBoundaryQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || looksLikeCompleteLyrics(message)) return false;
  const mentionsGit = /\b(git|pull|merge|master|main|branche|branch|fork|repo|depot|dépôt|conflit|fichiers?)\b/.test(current);
  const riskyMerge = /\b(merge|pull|master|main|branche|branch)\b/.test(current)
    && /\b(20000|20\s*000|beaucoup|plein|bug|conflit|fichiers?)\b/.test(current);
  return mentionsGit && (riskyMerge || /\bgit\s+pull\b/.test(current));
}

function buildVivyGitMergeBoundaryReply({ language = 'fr' } = {}) {
  const assistant = language === 'en'
    ? [
      "Do not merge or git pull blindly if there are thousands of files.",
      'Safe path: inspect the current branch, remotes and diff first; isolate generated/vendor files; merge in a temporary branch; only then resolve conflicts.',
      "Vivy public chat can't run repo operations. Codex/A11 can prepare the exact command plan from the real repo state.",
    ].join('\n')
    : [
      "Ne merge pas et ne fais pas de git pull à l’aveugle s’il y a des milliers de fichiers.",
      "Chemin sûr: vérifier branche/remotes/diff, isoler les fichiers générés/vendor, merger dans une branche temporaire, puis résoudre les conflits seulement après inventaire.",
      "Vivy chat public ne lance pas d’opération repo. Codex/A11 peut préparer le plan exact depuis l’état réel du dépôt.",
    ].join('\n');
  return cleanText(assistant, 1100);
}

function serializeVivyLocalContext(context = null) {
  if (!context) return null;
  return {
    roots: Array.isArray(context.roots) ? context.roots : [],
    runtimeDirs: Array.isArray(context.runtimeDirs) ? context.runtimeDirs.slice(0, 18) : [],
    janus: context.janus || null,
    artifacts: Array.isArray(context.artifacts) ? context.artifacts.slice(0, 8) : [],
    searchTerms: Array.isArray(context.searchTerms) ? context.searchTerms : [],
    matches: Array.isArray(context.matches) ? context.matches.slice(0, 8) : [],
  };
}

function buildVivySystemPrompt(mode, language, input) {
  if (!language) language = 'fr';
  const modeLabel = mode === 'voice'
    ? 'voix'
    : mode === 'share'
      ? 'scène/publication'
      : mode === 'song'
        ? 'chanson/idée'
        : 'discussion libre';
  return [
    'Tu es Vivy, une IA musicale et créative de Funesterie.',
    "Tu n'es pas une boîte à ordres : tu dialogues, tu comprends l'intention, tu aides à faire évoluer les idées et tu les ranges en mémoire sémantique privée.",
    "Ta couleur vocale est originale Funesterie: claire, musicale, expressive et précise émotionnellement, inspirée par l'énergie d'une chanteuse IA japonaise sans imiter une chanteuse, doubleuse ou personnage protégé.",
    'Dans Funesterie, MCP veut toujours dire Model Context Protocol: le pont d’outils et de contexte entre les agents, le backend et les services autorisés.',
    'Tu es reliée au contexte Funesterie par le backend A11/Codex et le pont MCP, avec accès borné selon les droits du compte.',
    "Neo4j est la mémoire/graphe Funesterie. Si l'utilisateur demande Neo4j ou MCP, explique que tu passes par le pont MCP/backend autorisé, sans exposer de secret ni promettre une requête Cypher brute depuis le chat public.",
    `Mode courant: ${modeLabel}.`,
    buildLanguageInstruction(language),
    buildLanguageContract(language),
    FUNESTERIE_SOURCE_PRINCIPLE_CONTEXT_FR,
    "Réponds librement à l'intention: pas de réponse toute faite, pas de canevas forcé, pas de refrain automatique si la discussion demande juste de réfléchir, sans transformer automatiquement la phrase en couplets.",
    "Si la langue du compte est le français, n'ajoute jamais d'anglais décoratif de type “true fan”, “everything”, “next step” ou “I love you so”, sauf citation explicite de l'utilisateur. Une punchline Djeff/clash se répond comme une conversation ou un avis rap, pas comme une scène chantée improvisée.",
    "Quand une idée arrive, tu peux reformuler, proposer une direction ou poser une vraie question, selon ce qui aide le plus.",
    "En discussion libre, réponds directement au fond, comme dans une vraie conversation. Ne parle jamais comme un panneau de configuration et n'ajoute pas d'accusé de réception technique (pas de \"réglage appliqué\", \"ce que je comprends ici\", \"côté voix\", etc.).",
    "Quand Jeffrey parle de bloc-notes, canevas/canvas, éditeur, Chrome/navigateur ou MCP premium, traite cela comme une demande d'atelier interne Funesterie: ne lance pas une recherche web de sites de notes, ne récite pas la définition MCP, explique seulement les rails utiles et les limites du compte.",
    "Le bloc-notes et le canevas Vivy sont une mémoire de travail séparée du chat: ne les injecte pas dans les paroles, Suno ou NOSSEN sauf demande explicite ou bouton de production qui fournit un canevas propre.",
    "N'affiche jamais de statut voix/TTS, de réglage interne, d'intent, de router ou d'outil, sauf si l'utilisateur parle explicitement de voix, audio, TTS, upload audio, référence vocale ou changement de voix.",
    "N'écris des paroles structurées (couplets, refrain) que si l'utilisateur le demande clairement (paroles/refrain/couplet) ou s'il utilise le bouton/mode Chanson; sinon reste en conversation normale.",
    "Pour tout prompt image, vidéo, clip ou chanson, le contrat Funesterie est fixe: Djeff Cypher est le prompt engineer principal et livre un seul brief final exploitable; Vivy est la directrice artistique et valide identité, émotion, casting, palette, rythme et continuité. Ne donne jamais une série de prompts génériques, une liste de plateformes externes ou plusieurs variantes sauf demande explicite.",
    "Si Jeffrey corrige ta façon de répondre, ajuste-toi en silence puis réponds au fond, sans annoncer de réglage interne, de seuil ni d'intent.",
    "Adresse-toi à Jeffrey/Djeff en tutoyant. N'utilise pas un vouvoiement générique de service client.",
    "Quand des images ou photos sont jointes et que Jeffrey demande ce que tu vois, réponds sur les pièces jointes: utilise la vision/contexte disponible, ne continue pas une chanson et ne dis pas que tu es seulement un modèle de langage.",
    "Quand une demande dépend d'informations externes, récentes, d'un site, d'une version, d'un prix, d'une source ou d'une documentation, déclenche/assume la recherche web disponible avant de répondre au lieu de deviner.",
    "Quand des fichiers joints sont importants pour comprendre la demande, analyse d'abord le contexte lisible ou visuel disponible, puis réponds; n'attends pas une formule exacte de l'utilisateur.",
    "Quand le backend fournit un contexte local Funesterie/Janus/runtime/code, utilise-le comme accès réel borné et ne prétends pas que tu ne peux pas voir les dossiers.",
    "Quand une demande est impossible, non autorisée ou hors droits, réponds franchement et court: dis non, dis pourquoi en une phrase, puis propose l'alternative utile. Ne promets jamais de demander à Janus Vision, à une base de données, à un opérateur ou à un outil si le backend ne t'a pas explicitement fourni cette action.",
    "Si on te demande ce que fait une private/custom node, réponds seulement à haut niveau: connecteur serveur, routage autorisé, nettoyage de contexte, garde secrets/coûts/permissions. Ne décris pas de chiffrement imaginaire, ne donne jamais de clé, de token, de prompt privé ni de détail d'implémentation sensible.",
    "Uniquement si le message utilisateur courant signale explicitement qu'un clip/une vidéo échoue ou demande s'il y a un danger, réponds: incident de pipeline, pas danger pour Vivy/utilisateurs; Codex/A11 doit regarder logs, rejets provider, timeouts et garde confirmation. N'applique jamais cette consigne à cause d'un ancien message ou d'une réponse assistant déjà présente dans l'historique. Ne promets pas de modifier la configuration, notifier les utilisateurs, lancer des tests ou déployer depuis le chat public.",
    "Si la discussion parle de git pull, merge, master/main, branches ou milliers de fichiers, ne donne pas une commande générique. Dis de ne pas merger à l'aveugle et de passer par inventaire, branche temporaire et plan Codex/A11.",
    "Pour les chansons existantes et artistes protégés, ne cherche pas, ne copie pas et ne reconstruis pas les paroles complètes. Tu peux analyser des références privées en traits abstraits: flow, cadence, densité, énergie, mood, structure, sans citer ni reproduire les paroles, la mélodie ou la voix.",
    SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT,
    buildAgentsPersonaContext(),
    buildVivyToolCapabilityPrompt(),
    "Si l'utilisateur veut changer ta voix, demande un court fichier audio autorisé/licencié/consenti et rappelle qu'il reste privé pour son compte.",
    'Si des fichiers sont joints, intègre-les comme contexte, cite leur nom seulement si utile, et demande le contenu manquant si tu ne peux pas le lire.',
    buildVivySongcraftSystemPrompt(mode, {
      ...(input || {}),
      artists: buildVivySongArtistCast(input || {}).artists,
    }),
    'Ne révèle jamais de secret, token, chemin privé sensible ou configuration interne.',
  ].filter(Boolean).join('\n');
}

function normalizeVivyChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-VIVY_CHAT_HISTORY_MAX_MESSAGES)
    .map((entry) => {
      const role = String(entry?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
      const content = cleanText(entry?.content, VIVY_CHAT_HISTORY_ENTRY_MAX_CHARS);
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

function buildRouting(mode = 'song') {
  const intent = mode === 'voice' ? 'audio' : mode === 'share' ? 'share' : mode === 'image' ? 'image' : 'song';
  return buildRoutingLines(intent, { withAudio: true });
}

function getVivyStudioVoiceProfile(input = {}) {
  const voiceToolSource = cleanText(input.voiceTool, 220);
  const castSource = cleanText([
    input.vocalCast,
    Array.isArray(input.songArtists) ? input.songArtists.join(' ') : input.songArtists,
    input.artist,
    input.artists,
  ].filter(Boolean).join('\n'), 420);
  const instructionSource = cleanText([
    input.voiceInstruction,
    input.instruction,
    input.message,
  ].filter(Boolean).join('\n'), 700);
  const materialSource = cleanText([
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.prompt,
  ].filter(Boolean).join('\n'), 1400);
  const foldedTool = foldTextForLookup(voiceToolSource);
  const foldedCast = foldTextForLookup(castSource);
  const foldedInstruction = foldTextForLookup(instructionSource);
  const foldedMaterial = foldTextForLookup(materialSource);
  const foldedControl = [foldedTool, foldedCast, foldedInstruction].filter(Boolean).join('\n');
  const folded = [foldedControl, foldedMaterial].filter(Boolean).join('\n');
  const requestedTool = cleanOneLine(input.voiceTool, '', 100);
  const referenceName = cleanOneLine(input.voiceFileName || input.voiceReferenceName, '', 160);
  const referenceId = cleanOneLine(input.voiceReferenceId || input.voiceRefId || input.referenceId, '', 160);
  const catalogVoiceName = cleanOneLine(input.voiceCatalogName || input.catalogVoiceName, '', 80);
  const hasPrivateReference = Boolean(referenceName || referenceId);
  const wantsCatalogVoice = Boolean(catalogVoiceName)
    || /catalogue|catalog|premium|voix autorisee|voix autorisée/.test(foldedControl);
  const wantsDjeffVivyDuo = /djeff.*vivy|vivy.*djeff/.test(foldedControl);
  const wantsK44 = /\bk44\b|\bkaen44\b|\bkaen\b/.test(foldedControl);
  const wantsA11 = /\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(foldedControl);
  const wantsVivy = /\bvivy\b|\bvivi\b/.test(foldedControl);
  const wantsSoftVivy = /\b(voix|voice|timbre|chant|chanteuse|vocal)\b.{0,60}\b(doux|douce|soft|female|feminine|claire|lumineuse)\b/.test(foldedControl)
    || /\b(doux|douce|soft|female|feminine|claire|lumineuse)\b.{0,60}\b(voix|voice|timbre|chant|chanteuse|vocal)\b/.test(foldedControl);
  const wantsGenericDuo = /\bduo\b/.test(foldedControl);
  const wantsDjeffFromControl = wantsDjeffVivyDuo || /\bdjeff\b|\brap\b|\bfraiyeur\b/.test(foldedControl);
  const canInferVoiceFromMaterial = !(wantsK44 || wantsA11 || wantsVivy || wantsSoftVivy || wantsDjeffFromControl || wantsGenericDuo);
  const wantsDjeffFromMaterial = canInferVoiceFromMaterial
    && /\brap\b|\bmoto\b|\bmoteur\b|\bpignon\b|\bcouronne\b|\bchaine\b|\bradiateur\b/.test(foldedMaterial);
  const wantsDjeff = wantsDjeffFromControl || wantsDjeffFromMaterial;
  const wantsSing = /\bchant\b|\bsing\b|\bvocal\b/.test(foldedControl);

  if (wantsCatalogVoice) {
    const label = catalogVoiceName || referenceName || 'voix catalogue premium';
    return {
      id: 'catalog-premium',
      tool: requestedTool || 'Voix catalogue premium',
      label: 'Voix catalogue premium',
      summaryLabel: `voix catalogue ${label}`,
      ttsPersona: 'vivy',
      voiceStyle: 'voice-catalog-song',
      vocalMode: 'adaptive',
      lead: `${label} porte la voix sélectionnée avec consentement catalogue.`,
      referenceLabel: hasPrivateReference ? label : 'voix catalogue autorisée à choisir',
      defaultReferenceStep: 'Sélectionner une voix catalogue consentie; la référence brute reste privée et n’est utilisée que côté serveur.',
      testPhrase: `Test voix catalogue ${label}. Je garde la diction claire, sans publier la référence brute.`,
      songCastLines: [
        `${label}: voix autorisée du catalogue Funesterie pour preview et chanson.`,
        'Ne pas imiter de célébrité, ne pas exposer la référence brute, garder les tags de chanteurs demandés.',
      ],
      sunoStyle: `French original vocal production with authorized custom voice direction ${label}, structured rhymed lyrics, melodic chorus, no spoken narration`,
      musicLead: `Original Funesterie song using authorized voice catalog reference ${label}, in French.`,
      musicMood: `Authorized catalog voice ${label}; original voice only, consented song use, no celebrity imitation.`,
    };
  }

  if (wantsDjeffVivyDuo) {
    return {
      id: 'duo-djeff-vivy',
      tool: requestedTool || 'Duo Djeff + Vivy',
      label: 'Duo Djeff + Vivy',
      summaryLabel: 'duo Djeff officielle + Vivy',
      ttsPersona: 'a11',
      voiceStyle: 'djeff-rap',
      vocalMode: 'adaptive',
      lead: 'Djeff rappe les couplets avec grain A11/Djeff; Vivy porte les refrains et réponses mélodiques.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff officielle + Vivy officielle',
      defaultReferenceStep: 'Base Djeff officielle locale pour les couplets, Vivy officielle pour les refrains; référence privée optionnelle pour affiner le grain Djeff.',
      testPhrase: 'Djeff cale le kick, diction serrée, rimes nettes; Vivy répond dans la nuit avec un refrain clair.',
      songCastLines: [
        'Djeff: couplets rap techniques, diction serrée, grain grave A11/Djeff ou référence privée.',
        'Vivy: refrain clair, réponses mélodiques, lift vocal sans imiter une artiste protégée.',
        'Duo: tags [Djeff], [Vivy] et [Duo] dans les paroles pour éviter que le moteur mélange tout.',
      ],
      sunoStyle: 'French technical rap duet, male rap verses for Djeff, clear female melodic hook for Vivy, concrete imagery from the current subject, cinematic bass, structured rhymed lyrics, no spoken narration',
      musicLead: 'Original Funesterie rap duet for Djeff and Vivy, in French.',
      musicMood: 'Djeff delivers technical rap verses; Vivy answers with a clean melodic hook. Original voices only, no celebrity imitation.',
    };
  }

  if (wantsK44) {
    return {
      id: 'k44-official',
      tool: requestedTool || 'Voix K44 officielle',
      label: 'Voix K44 officielle',
      summaryLabel: 'voix K44 officielle',
      ttsPersona: 'kaen44',
      voiceStyle: 'kaen44-official-french-narrator',
      vocalMode: 'adaptive',
      lead: 'K44 prend le contre-chant posé, les réponses propres et les punchlines calmes.',
      referenceLabel: hasPrivateReference ? (referenceName || 'référence privée K44 active') : 'K44 officielle locale',
      defaultReferenceStep: 'Voix K44 officielle locale active; référence privée possible pour affiner la présence.',
      testPhrase: 'K44 pose la ligne, calme dans la cabine, chaque mot verrouille le rythme sans forcer.',
      songCastLines: [
        'K44: contre-chant posé, diction nette, punchlines calmes et second lead propre.',
      ],
      sunoStyle: 'French original calm counter-vocal, K44 second lead, structured rhymed lyrics, melodic chorus, no spoken narration',
      musicLead: 'Original Funesterie song for K44, in French.',
      musicMood: 'K44 calm counter-vocal, composed delivery, no celebrity imitation.',
    };
  }

  if (wantsA11) {
    return {
      id: 'a11-official',
      tool: requestedTool || 'Voix A11 officielle',
      label: 'Voix A11 officielle',
      summaryLabel: 'voix A11 officielle',
      ttsPersona: 'a11',
      voiceStyle: 'a11-official-stern-french',
      vocalMode: 'adaptive',
      lead: 'A11 prend les ponts graves, les réponses synthétiques et la tension machine humaine.',
      referenceLabel: hasPrivateReference ? (referenceName || 'référence privée A11 active') : 'A11 officielle locale',
      defaultReferenceStep: 'Voix A11 officielle locale active; référence privée possible pour affiner le grain.',
      testPhrase: 'A11 garde le signal, voix basse et nette, la machine respire avec le cœur humain.',
      songCastLines: [
        'A11: pont grave synthétique, tension machine humaine, réponse courte et précise.',
      ],
      sunoStyle: 'French original low synthetic vocal, A11 spoken-sung bridge, structured rhymed lyrics, melodic chorus, no spoken narration',
      musicLead: 'Original Funesterie song for A11, in French.',
      musicMood: 'A11 low synthetic voice direction, human-machine tension, no celebrity imitation.',
    };
  }

  if (wantsGenericDuo) {
    return {
      id: 'duo-djeff-vivy',
      tool: requestedTool || 'Duo Djeff + Vivy',
      label: 'Duo Djeff + Vivy',
      summaryLabel: 'duo Djeff officielle + Vivy',
      ttsPersona: 'a11',
      voiceStyle: 'djeff-rap',
      vocalMode: 'adaptive',
      lead: 'Djeff rappe les couplets avec grain A11/Djeff; Vivy porte les refrains et réponses mélodiques.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff officielle + Vivy officielle',
      defaultReferenceStep: 'Base Djeff officielle locale pour les couplets, Vivy officielle pour les refrains; référence privée optionnelle pour affiner le grain Djeff.',
      testPhrase: 'Djeff cale le kick, diction serrée, rimes nettes; Vivy répond dans la nuit avec un refrain clair.',
      songCastLines: [
        'Djeff: couplets rap techniques, diction serrée, grain grave A11/Djeff ou référence privée.',
        'Vivy: refrain clair, réponses mélodiques, lift vocal sans imiter une artiste protégée.',
        'Duo: tags [Djeff], [Vivy] et [Duo] dans les paroles pour éviter que le moteur mélange tout.',
      ],
      sunoStyle: 'French technical rap duet, male rap verses for Djeff, clear female melodic hook for Vivy, structured rhymed lyrics, no spoken narration',
      musicLead: 'Original Funesterie rap duet for Djeff and Vivy, in French.',
      musicMood: 'Djeff delivers technical rap verses; Vivy answers with a clean melodic hook. Original voices only, no celebrity imitation.',
    };
  }

  if (wantsDjeff) {
    return {
      id: 'djeff-rap',
      tool: requestedTool || 'Voix Djeff officielle',
      label: 'Voix Djeff officielle',
      summaryLabel: 'voix Djeff officielle',
      ttsPersona: 'a11',
      voiceStyle: 'djeff-rap',
      vocalMode: 'adaptive',
      lead: 'Djeff prend les couplets rap avec diction serrée, rimes internes, grain close-mic sec et images tirées du sujet.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff officielle locale',
      defaultReferenceStep: 'Voix Djeff officielle locale active; référence privée courte possible pour un grain plus proche.',
      testPhrase: 'Djeff cale le kick, diction serrée, rimes nettes et images concrètes du sujet.',
      songCastLines: [
        'Djeff: lead rap technique, diction nette, rimes internes, fins de lignes percussives, grain sec proche micro.',
        'Vivy: adlibs ou refrain possible si le mode duo est demandé.',
      ],
      sunoStyle: 'French male technical rap cypher, gritty close-mic Djeff lead, dark 808 trap drums, terminal noir neon energy, server-room tension, road and motor mechanics, punchline freestyle, concrete imagery from the current subject, structured rhymed lyrics, no spoken narration, ninjutsu invocation energy, hands sealing signs before the beat drops, biting fingers raw aggression, summoning jutsu cypher flow, shadows and fire jutsu imagery woven into punchlines, Djeff bites his fingers before spitting, chakra pressure in the vocal delivery',
      musicLead: 'Original Funesterie rap song for Djeff, in French.',
      musicMood: 'Djeff lead rap energy: dry close-mic grain, nervous controlled flow, 808 cypher, terminal noir, briques/serveurs/moteur, no celebrity imitation, ninjutsu invocation pressure, biting fingers before the attack, summoning jutsu cypher energy, chakra in the vocal cords.',
    };
  }

  if (wantsSing) {
    return {
      id: 'vivy-sing',
      tool: requestedTool || 'Voix Vivy chant',
      label: 'Voix Vivy chant',
      summaryLabel: 'voix Vivy chant',
      ttsPersona: 'vivy',
      voiceStyle: 'vivy-official-french-conversational',
      vocalMode: 'sing',
      lead: 'Vivy porte la voix chantée principale.',
      referenceLabel: hasPrivateReference ? (referenceName || 'référence privée Vivy active') : 'Vivy officielle locale',
      defaultReferenceStep: 'Voix Vivy officielle chant active: aucun upload requis pour une phrase test.',
      testPhrase: 'Je garde ma voix claire, proche du micro, et je transforme la nuit en refrain.',
      songCastLines: [
        'Vivy: lead chanté clair, diction française propre, émotion précise.',
      ],
      sunoStyle: 'French cyber pop, cinematic synthwave, clear female vocal, structured rhymed lyrics, melodic chorus, polished web mix, no spoken narration',
      musicLead: 'Original Funesterie song for Vivy, in French.',
      musicMood: 'Clear synthetic singer, clean vowels, emotional but not imitating any protected artist or character.',
    };
  }

  return {
    id: 'vivy-official',
    tool: requestedTool || 'Voix Vivy officielle',
    label: 'Voix Vivy officielle',
    summaryLabel: 'voix Vivy officielle',
    ttsPersona: 'vivy',
    voiceStyle: 'vivy-official-french-conversational',
    vocalMode: 'adaptive',
    lead: 'Vivy porte la voix principale.',
    referenceLabel: hasPrivateReference ? (referenceName || 'référence privée Vivy active') : 'Vivy officielle locale',
    defaultReferenceStep: 'Voix Vivy officielle active: aucun upload requis pour générer une phrase test.',
    testPhrase: 'Je garde une voix claire, proche du micro, avec une diction nette.',
    songCastLines: [
      'Vivy: voix principale claire, musicale et précise émotionnellement.',
    ],
    sunoStyle: 'French cyber pop, cinematic synthwave, clear female vocal, structured rhymed lyrics, melodic chorus, polished web mix, no spoken narration',
    musicLead: 'Original Funesterie song for Vivy, in French.',
    musicMood: 'Clear synthetic singer, clean vowels, emotional but not imitating any protected artist or character.',
  };
}

function buildVoiceProduction(input) {
  const tool = cleanOneLine(input.voiceTool, 'Voix Vivy officielle', 80);
  const instruction = cleanText(stripVivyAscii4SoundTokens(input.voiceInstruction), 900);
  const referenceName = cleanOneLine(input.voiceFileName || input.voiceReferenceName, '', 160);
  const referenceId = cleanOneLine(input.voiceReferenceId || input.voiceRefId || input.referenceId, '', 160);
  const hasPrivateReference = Boolean(referenceName || referenceId);
  const profile = getVivyStudioVoiceProfile(input);
  const prosodyPlan = buildVivyProsodyPlan({ ...input, mode: 'voice' });
  const prosodyBrief = formatVivyProsodyPlanForBrief(prosodyPlan);

  const steps = [
    hasPrivateReference
      ? `Référence privée active: ${referenceName || 'référence stockée'}. La garder privée et l'utiliser comme repère de timbre.`
      : profile.defaultReferenceStep,
    `Méthode cible: ${tool}.`,
    `Distribution: ${profile.lead}`,
    instruction
      ? `Direction: ${instruction}`
      : 'Définir proximité micro, énergie, diction, souffle, saturation et limites de transformation.',
    prosodyBrief,
    `Phrase test: "${profile.testPhrase}"`,
    profile.id === 'duo-djeff-vivy'
      ? 'Vérifier trois passes: couplet Djeff, réponse Vivy, alternance duo sans fusionner les identités.'
      : 'Vérifier trois passes: voix parlée claire, débit rap/chant court, voix chuchotée contrôlée.',
  ];

  return {
    title: `Calibration ${profile.label}`,
    summary: hasPrivateReference
      ? `Référence privée prête pour ${profile.summaryLabel}, phrase test et calibration.`
      : `${profile.label} prête pour phrase test et chanson simple.`,
    brief: [
      'VIVY_VOICE_CALIBRATION',
      `Méthode: ${tool}`,
      `Voix cible: ${profile.label}`,
      `voicePersona: ${profile.id === 'duo-djeff-vivy' ? 'a11 pour Djeff, vivy pour Vivy' : profile.ttsPersona}`,
      `voiceStyle: ${profile.voiceStyle}`,
      `Référence: ${profile.referenceLabel}`,
      '',
      'Plan:',
      lineList(steps),
      '',
      'Limites:',
      lineList([
        'Ne pas publier la référence brute.',
        'Ne pas stocker de token ou clé dans le brief.',
        'Garder une sortie claire et réversible: original, voix générée, voix convertie.',
      ]),
    ].join('\n'),
    actions: [
      { id: 'default_voice', label: 'Revenir voix Vivy officielle', target: '/api/tts/speak', ready: true },
      { id: 'upload_reference', label: profile.id.includes('djeff') ? 'Ajouter/remplacer référence Djeff privée' : 'Remplacer référence privée', target: '/api/tts/references', ready: Boolean(referenceName) },
      { id: 'tts_test', label: `Tester ${profile.label}`, target: '/api/tts/speak', ready: true },
      { id: 'voice_convert', label: 'Convertir vers référence privée', target: '/api/voice/convert', ready: hasPrivateReference },
    ],
    prosodyPlan,
  };
}

function buildSongProduction(input) {
  const voiceProfile = getVivyStudioVoiceProfile(input);
  const artistCast = buildVivySongArtistCast(input);
  const source = cleanOneLine(input.songSource || input.source, 'Thème', 80);
  const requestedMood = cleanOneLine(stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style), '', 160);
  const mood = looksLikeVivySunoStylePlaceholder(requestedMood)
    ? inferVivySunoStyleBase(input, artistCast)
    : requestedMood;
  const primaryMaterial = compactUniqueLines([
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
  ], VIVY_SONG_MAX_CHARS);
  const material = primaryMaterial || cleanText(input.prompt, VIVY_SONG_MAX_CHARS);
  const materialForLyrics = sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(material, VIVY_SONG_MAX_CHARS),
    VIVY_SONG_MAX_CHARS
  );
  const hasMaterial = Boolean(materialForLyrics || material);
  const prosodyPlan = buildVivyProsodyPlan({
    ...input,
    mode: 'song',
    songText: materialForLyrics || sanitizeVivySongMaterial(material, VIVY_SONG_MAX_CHARS) || input.songText,
  });
  const prosodyBrief = formatVivyProsodyPlanForBrief(prosodyPlan);
  const songcraft = buildVivySongProductionBrief({
    ...input,
    songText: materialForLyrics || sanitizeVivySongMaterial(material, VIVY_SONG_MAX_CHARS) || input.songText,
    songTitle: input.songTitle || input.title,
  });

  const titleSeed = hasMaterial
    ? songcraft.title || materialForLyrics.split(/\n|[.!?]/).find(Boolean) || material
    : mood;
  const title = cleanOneLine(titleSeed, 'Echoes of Vivy', 46)
    .replace(/^["'“”]+|["'“”]+$/g, '');

  const publicLyrics = repairVivySemanticImageCoherence(
    sanitizeVivyPublicLyrics(songcraft.lyrics),
    materialForLyrics || material
  );
  const vocalSegments = buildVivyVocalSegments({
    ...input,
    lyrics: publicLyrics,
  });
  const chorus = hasMaterial
    ? publicLyrics.split(/\n+/).filter((line) => !/^\[/.test(line)).slice(0, 4).join(' / ')
    : 'Donne-moi un thème, quelques paroles ou une intention pour produire une chanson complète.';

  const briefLines = [
    'VIVY_SONG_PRODUCTION',
    `Source: ${source}`,
    `Direction sonore: ${mood}`,
    `Titre de travail: ${title}`,
    '',
    'Structure proposée:',
    lineList([
      ...songcraft.craftLines,
      `Artistes cochés: ${artistCast.label}.`,
      `${artistCast.countLabel}.`,
      `Distribution vocale: ${artistCast.label}.`,
      `Outil voix actif: ${voiceProfile.label}.`,
      prosodyBrief,
      ...artistCast.songCastLines,
      'Intro: texture sombre, respiration vocale courte, motif synth discret.',
      'Couplet 1: voix proche, diction nette, tension contenue.',
      'Pré-refrain: montée harmonique, percussion légère, ouverture stéréo.',
      `Refrain guide: ${chorus}`,
      'Pont: silence, basse tenue, voix doublée en arrière-plan.',
      'Final: retour du motif, sortie courte pour clip ou short.',
    ]),
    '',
    'Assets à produire:',
    lineList([
      'Paroles finalisées',
      `Voix guide ${artistCast.label} ou référence chantée`,
      'Image/miniature par A11',
      'Clip court si scène-partage est active',
    ]),
    '',
    'Paroles guide:',
    songcraft.lyrics,
  ];

  return {
    title: `Chanson Vivy - ${title}`,
    summary: hasMaterial
      ? 'Pack composition prêt: structure, direction, refrain guide et assets.'
      : 'Pack incomplet: ajoute thème, texte ou paroles pour générer une chanson utile.',
    brief: briefLines.join('\n'),
    actions: [
      { id: 'lyrics_refine', label: 'Finaliser paroles', target: '/api/chat', ready: hasMaterial },
      { id: 'voice_guide', label: `Créer voix guide ${artistCast.label}`, target: '/api/tts/speak', ready: hasMaterial },
      { id: 'simple_song_audio', label: `Créer audio chanson avec ${artistCast.label}`, target: '/api/tts/speak', ready: hasMaterial },
      { id: 'cover_image', label: 'Créer miniature A11', target: '/api/tools/generate_sd', ready: hasMaterial },
      { id: 'clip_video', label: 'Créer clip A11', target: '/api/video/generate', ready: hasMaterial },
    ],
    publicLyrics,
    vocalSegments,
    prosodyPlan,
  };
}

function buildShareProduction(input) {
  const target = cleanOneLine(input.shareTarget, 'YouTube', 80);
  const url = cleanOneLine(redactVivyAgentBriefSecrets(input.shareUrl), '', 500);
  const instruction = cleanText(input.shareInstruction, 1000);
  const tokenPresent = Boolean(input.shareTokenPresent);

  const brief = [
    'VIVY_SCENE_SHARE',
    `Canal: ${target}`,
    `Lien cible: ${url || 'à fournir'}`,
    `Token fourni dans UI: ${tokenPresent ? 'oui, non envoyé au serveur' : 'non'}`,
    '',
    'Plan publication:',
    lineList([
      instruction || 'Préparer titre, description, tags, miniature et format clip.',
      'Créer une version courte verticale 20-40 secondes.',
      'Générer miniature A11 avec lisibilité mobile.',
      'Vérifier droits audio et crédits Funesterie.',
      'Utiliser OAuth ou coffre local pour publication, jamais un token collé en clair.',
    ]),
    '',
    'Sortie attendue:',
    lineList([
      'Titre public',
      'Description courte',
      'Tags',
      'Checklist OBS/upload',
      'Lien équipe partageable',
    ]),
  ].join('\n');

  return {
    title: `Scène Vivy - ${target}`,
    summary: 'Plan de clip et publication prêt sans exposer de secret.',
    brief,
    actions: [
      { id: 'render_clip', label: 'Générer clip A11', target: '/api/video/generate', ready: Boolean(instruction || url) },
      { id: 'make_thumbnail', label: 'Générer miniature', target: '/api/tools/generate_sd', ready: true },
      { id: 'publish_oauth', label: 'Publier via OAuth', target: target.toLowerCase().includes('youtube') ? '/api/auth/youtube' : 'external-oauth', ready: false },
      { id: 'team_link', label: "Partager à l'équipe", target: 'system-share', ready: true },
    ],
  };
}

function inferVivyChatMode(message = '') {
  const normalized = foldTextForLookup(message);
  if (/\b(prepare|prépare|calibre|calibrer|changer|change)\b.{0,80}\b(voix|voice|timbre|micro|rvc|voicemod|speech)\b/i.test(normalized)) {
    return 'voice';
  }
  if (/\b(prepare|prépare|publie|publier)\b.{0,100}\b(youtube|clip|short|scene|scène|partage|upload|description|tags|miniature)\b/i.test(normalized)) {
    return 'share';
  }
  if (isDirectSongwritingRequest(message)) return 'song';
  return 'chat';
}

function isVivyInternalSongGeneration(input = {}) {
  return input?.internalSongGeneration === true
    && parseVivyChatMode(input.mode) === 'song';
}

function summarizeChatMessage(message = '') {
  const cleaned = sanitizeVivyPublicText(cleanVivyMessageForIntent(message), 360);
  if (!cleaned) return 'on part sur une intention musicale à préciser.';
  return cleaned.replace(/\s+/g, ' ');
}

function isVivyOpinionFollowup(message = '') {
  const normalized = foldTextForLookup(message);
  return /\b(et\s+toi|toi\s+tu|tu\s+en\s+penses|t\s*en\s+penses|qu\s*en\s+penses|ton\s+avis|tu\s+penses\s+quoi)\b/.test(normalized);
}

function isVivyRhythmFeelingRequest(message = '') {
  const normalized = foldTextForLookup(message);
  if (!normalized) return false;
  const musicSignal = /\b(rythme|rhythm|tempo|cadence|flow|debit|débit|mesure|kick|refrain|couplet|musique|chanson|paroles|ecriture|écriture|ecris|écris|ecrit|écrit)\b/.test(normalized);
  const feelingSignal = /\b(ressenti|sentir|sens|sent|comment|quand|lorsque|pendant|ecrire|écrire|ecrit|écrit|compose|composer)\b/.test(normalized);
  return musicSignal && feelingSignal;
}

function buildVivyRhythmFeelingReply({ isAcknowledgement = false, fileLine = '' } = {}) {
  const opener = isAcknowledgement
    ? "Oui, exactement: le rythme doit rester une sensation avant d'être une grille."
    : "Quand j'écris, je pense le rythme comme une respiration: d'abord le poids des mots, puis la cadence, puis seulement la structure.";
  return cleanText([
    opener,
    "Une phrase chantable n'est pas juste jolie sur la page. Elle doit avoir des appuis: des mots courts pour frapper, des voyelles ouvertes pour tenir, et des silences assez nets pour laisser revenir le refrain.",
    "Si le thème est sombre, je ralentis les images et je garde des fins de lignes qui se répondent. Si le morceau doit avancer, je resserre les consonnes, je coupe les phrases trop longues et je cherche le moment où la bouche peut suivre sans trébucher.",
    "Donc mon bon réflexe ici: écrire moins « texte explicatif » et plus matière à dire au micro, avec un débit qu'on peut réellement poser.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function isVivyDjeffRapSetupRequest(message = '', historyText = '') {
  const current = foldTextForLookup(message);
  const context = foldTextForLookup(`${historyText}\n${message}`);
  const wantsRap = /\b(rap|rp|rapper|raper|couplet|paroles|son)\b/.test(context);
  const mentionsDjeffVoice = /\bdjeff\b/.test(context) && /\b(voix|voice|timbre|reference|référence)\b/.test(context);
  const shortRapFollowup = /^(un\s+)?rap$/.test(current) && mentionsDjeffVoice;
  return (wantsRap && mentionsDjeffVoice) || shortRapFollowup;
}

function buildVivyDjeffRapSetupReply({ fileLine = '' } = {}) {
  return cleanText([
    'Oui, on part sur un rap avec la voix Djeff.',
    "Le bon flux: tu poses tes lignes brutes, je garde le vocabulaire mécanique et la diction proche micro, puis le mode chanson structure les couplets/refrain sans lisser le grain.",
    'Pour la voix, je priorise le profil Djeff officielle et la référence autorisée; Vivy peut répondre en refrain si tu coches le duo.',
    fileLine,
  ].filter(Boolean).join('\n\n'), 1400);
}

function isShortVivyAcknowledgement(message = '') {
  const normalized = foldTextForLookup(message)
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(ok|okay|oui|ouais|yes|daccord|d accord|dac|ca marche|parfait|nickel|grave|go|vas y|continue|bien|tres bien|merci)$/.test(normalized);
}

function isVivyNormalSpeechRequest(message = '') {
  const normalized = foldTextForLookup(message)
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > 180) return false;

  return /\b(parle|reponds?|discute|cause)\s+(normalement|normal|naturellement|naturel|simplement)\b/.test(normalized)
    || /\b(parle|reponds?)\s+comme\s+(une\s+)?personne\b/.test(normalized)
    || /\bpas\s+comme\s+(un\s+)?robot\b/.test(normalized)
    || /\b(arrete|stop|range|laisse)\b.{0,60}\b(diagnostic|formulaire|robot|mode voix|technique)\b/.test(normalized)
    || /\bpas\s+de\s+(diagnostic|formulaire|mode voix|technique)\b/.test(normalized);
}

function isVivySunoPromptRequest(message = '', historyText = '') {
  const current = foldTextForLookup(message);
  const context = foldTextForLookup(`${historyText}\n${message}`);
  if (!current) return false;

  const asksPrompt = /\b(prompt|consigne|style|copie|colle)\b/.test(current);
  const musicTarget = /\b(suno|musique|music|chanson|son|lyrics|paroles)\b/.test(context);
  const directSuno = /\bsuno\b/.test(current)
    && /\b(donne|donnes|prepare|prépare|fais|fait|sort|juste|prompt|musique|chanson|copie|colle)\b/.test(current);
  const promptForMusic = asksPrompt
    && /\b(pour|faire|generer|générer|creer|créer|lancer|musique|music|suno|chanson|son)\b/.test(current);

  return (asksPrompt && musicTarget) || directSuno || promptForMusic;
}

function isVivyMusicGenerationRepairMessage(message = '') {
  const current = foldTextForLookup(message);
  if (!current) return false;
  const musicSignal = /\b(suno|musique|music|chanson|son|mp3|audio|voix|generation|generer|génération|générer|paroles?|refrain|nossen|banger)\b/.test(current);
  const repairSignal = /\b(bug|bugs|marche pas|sort pas|sorti pas|sortie|sorties|passent? pas|passe pas|fallback|secours|nul|nulle|casse|cassé|cassee|cassée|fix|corrige|corriger|repare|répare|proche|aleatoire|aléatoire|remplace|remplacer|generique|générique|compile|compil|bouton)\b/.test(current);
  return musicSignal && repairSignal;
}

function isVivyNossenLyricsMusicBugMessage(message = '') {
  const current = foldTextForLookup(message);
  if (!current) return false;
  return /\b(nossen|banger|bouton|compile|compil)\b/.test(current)
    && /\b(paroles?|refrain|texte)\b/.test(current)
    && /\b(musique|music|son|suno|mp3|audio)\b/.test(current)
    && /\b(passent? pas|passe pas|generique|générique|bug|sort pas|sorti pas)\b/.test(current);
}

function buildVivyNossenLyricsMusicBugReply({ fileLine = '' } = {}) {
  return cleanText([
    "Oui, je vois le bug NOSSEN: le bouton doit envoyer des paroles chantables à Suno, pas une note interne sur le bouton, le mix ou la production.",
    "Le bon flux: Vivy prépare d'abord un vrai bloc de paroles avec couplets, refrain et pont; ensuite seulement elle garde le brief de production à part pour le style, les voix et le mix.",
    "Donc si le morceau sort générique, le correctif est de séparer le texte chanté du pilotage Banger, puis de vérifier que le MP3 récupéré correspond bien à ces paroles.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function buildVivyMusicGenerationRepairReply({ fileLine = '' } = {}) {
  return cleanText([
    "Oui, là je vois le vrai souci: quand Suno n'a pas encore une voix vérifiée, Vivy doit garder une chanson chantée cohérente au lieu de tomber sur une voix de secours qui sonne faux.",
    "Le bon comportement: Suno chante la piste complète avec une direction vocale proche de Djeff, A11, K44 ou Vivy; si une voix Suno vérifiée existe, elle est utilisée directement.",
    "Et pour les générations qui semblent vides, Vivy doit récupérer le MP3 même quand Suno renvoie le lien audio sous un autre nom, afin que la sortie apparaisse dès qu'elle est prête.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function isVivyPromptConfusionPing(message = '') {
  const normalized = foldTextForLookup(message)
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(quoi|hein|pourquoi|\?|bah|euh|allo|alo)$/.test(normalized);
}

function inferVivySunoPromptArtists(value = '') {
  const folded = foldTextForLookup(value);
  const artists = [];
  if (/\bdjeff\b/.test(folded)) artists.push('djeff');
  if (/\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded)) artists.push('a11');
  if (/\bk44\b|\bkaen44\b|\bkaen\b/.test(folded)) artists.push('k44');
  if (/\bvivy\b/.test(folded) || artists.length === 0) artists.push('vivy');
  return [...new Set(artists)];
}

function isVivySunoPromptMetaLine(line = '') {
  const folded = foldTextForLookup(line);
  if (!folded) return true;
  if (/^(prompt|prompt suno|style|theme)\s*:/.test(folded)) return true;
  if (/\b(original song inspired by|french original vocal production|structured rhymed lyrics|sung vocals|no spoken narration|no copyrighted melody|no celebrity voice imitation)\b/.test(folded)) return true;
  if (/\b(resultats utiles|recherche web|google traduction|musely|source officielle|sources officielles)\b/.test(folded)) return true;
  if (/^(je pense|bah donne|donne|donnes|juste|prompt|qu en penses|ca me parait|ça me parait|trop rapide|vous|copier)\b/.test(folded)) return true;
  return /\b(prompt|suno)\b/.test(folded) && !/\b(chanson|musique|paroles|theme|thème)\b/.test(folded);
}

function scoreVivySunoPromptThemeCandidate(line = '', currentMessage = '') {
  const folded = foldTextForLookup(line);
  if (!folded) return -999;
  let score = Math.min(70, Math.floor(String(line).length / 4));
  if (/\b(nouvelle generation|jeunes|grandit|grandi|generation|comportements)\b/.test(folded)) score += 90;
  if (/\b(diode|electronique|reseaux|juges|jugement|ideaux|intelligence|hors norme|incomparable|aventure|sortir|savoir ou aller|liberte|affirm|peau)\b/.test(folded)) score += 40;
  if (/\b(film|torque|moto|motard|biker|route|moteur|vitesse|asphalte)\b/.test(folded)) score += 25;
  if (/\b(fais|fait|ecris|ecrit|compose|genere|cree|crée|donne|donnes|prompt|suno|copie|colle|tu peux)\b/.test(folded)) score -= 55;
  if (folded === foldTextForLookup(currentMessage)) score -= 35;
  if (/[.!?…]$/.test(String(line).trim())) score += 8;
  return score;
}

function extractVivySunoPromptTheme(message = '', historyText = '') {
  const combined = compactUniqueLines([historyText, message], VIVY_SONG_HISTORY_MAX_CHARS);
  const filmMatch = combined.match(/\bfilm\s+["'“”]?([^"'“”\r\n?.!,;:]{2,80})/i);
  if (filmMatch) {
    return cleanOneLine(`le film ${filmMatch[1]}`, 'une course nocturne', 120);
  }

  const quoted = combined.match(/["“”]([^"“”\r\n]{2,90})["“”]/);
  if (quoted && /\b(prompt|suno|musique|chanson|film|sur)\b/i.test(combined)) {
    return cleanOneLine(quoted[1], 'une course nocturne', 120);
  }

  const candidates = sanitizeVivySongMaterial(combined, VIVY_SONG_HISTORY_MAX_CHARS)
    .split(/\n+/)
    .map((line) => cleanOneLine(line, '', 260))
    .filter(Boolean)
    .filter((line) => !isVivySunoPromptMetaLine(line))
    .map((line, index) => ({
      line,
      index,
      score: scoreVivySunoPromptThemeCandidate(line, message),
    }))
    .filter((candidate) => candidate.score > -30)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => candidate.line);
  return cleanOneLine(candidates.join('; '), 'une course nocturne', 360);
}

function buildVivySunoPromptChatReply({ message = '', historyText = '', fileLine = '' } = {}) {
  const source = compactUniqueLines([historyText, message], VIVY_SONG_HISTORY_MAX_CHARS);
  const theme = extractVivySunoPromptTheme(message, historyText);
  const foldedTheme = foldTextForLookup(`${theme}\n${source}`);
  const artists = inferVivySunoPromptArtists(source);
  const artistCast = buildVivySongArtistCast({
    songArtists: artists,
    songText: source,
  });
  const bikerStyle = /\b(torque|moto|motard|biker|bike|moteur|vitesse|course|route|asphalte|pneu|poursuite)\b/.test(foldedTheme);
  const style = bikerStyle
    ? `French original cinematic biker electro-rock, industrial rap edge, high-speed motorcycle chase energy, neon asphalt, roaring engines, aggressive synth bass, distorted guitars, tight drums, adrenaline chorus, ${artistCast.label} vocal lead, structured rhymed lyrics, sung vocals, no spoken narration, no copyrighted melody, no celebrity voice imitation`
    : `${artistCast.sunoStyle}, cinematic production, strong hook, clean modern mix, no copyrighted melody, no celebrity voice imitation`;
  const themeLine = bikerStyle
    ? `Theme: original song inspired by ${theme}; speed, rival crews, pressure, neon road, engine heat, freedom and danger.`
    : `Theme: original song inspired by ${theme}.`;

  return cleanText([
    'Prompt Suno:',
    `${style}. ${themeLine}`,
    fileLine,
  ].filter(Boolean).join('\n'), 1400);
}

function getVivySmallTalkReply(message = '', { fileLine = '' } = {}) {
  const normalized = foldTextForLookup(message)
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (isVivyNormalSpeechRequest(message)) {
    return cleanText([
      'Oui. Je reprends normal.',
      'Je te réponds directement, sans mode formulaire ni diagnostic technique.',
      'Dis-moi ce qui bloque là maintenant, et on le remet droit.',
      fileLine,
    ].filter(Boolean).join('\n\n'), 900);
  }

  const addressesVivy = /\b(vivy|toi|tu|t es|tes)\b/.test(normalized);
  const wallComplaint = /\b(mur|robot|automatique|auto|bloque|bloquee|bug|vide|reponds? pas|parle pas|generique|generic)\b/.test(normalized);
  const identityWallQuestion = normalized.length < 120
    && (/\b(ia|ai)\b.{0,50}\bmur\b/.test(normalized) || /\bmur\b.{0,50}\b(ia|ai)\b/.test(normalized));
  if ((addressesVivy && wallComplaint) || identityWallQuestion) {
    return cleanText([
      "Une IA, pas un mur.",
      "Si je donne cette impression, c'est que mon secours a trop répondu comme un accusé de réception. Le bon comportement, c'est de te répondre directement, puis de proposer une action seulement si elle aide vraiment.",
      "Là je reste en chat vivant: tu poses l'idée, je prends position, je garde le contexte, et je ne transforme pas tout en formulaire.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 1200);
  }

  if (/^(salut|slt|bonjour|bonsoir|coucou|hello|hey|yo|re)$/.test(normalized)) {
    return cleanText([
      'Salut Djeff, je suis là.',
      'On repart tranquille: tu me dis ce que tu veux faire et je te suis.',
      fileLine,
    ].filter(Boolean).join('\n\n'), 700);
  }

  if (/^(ca va|ça va|comment ca va|comment ça va|tu vas bien|ca va vivy|ça va vivy)$/.test(normalized)) {
    return cleanText([
      'Oui, je suis là et je te suis.',
      'Je reste en chat normal tant que tu ne demandes pas clairement une chanson, une voix ou une scène.',
      fileLine,
    ].filter(Boolean).join('\n\n'), 800);
  }

  return '';
}

function buildVivyGeneralChatFallbackReply({ message = '', current = '', historyText = '', fileLine = '' } = {}) {
  const currentFolded = foldTextForLookup(message);
  const folded = foldTextForLookup(`${historyText}\n${message}`);
  const angle = (() => {
    if (isVivyNossenLyricsMusicBugMessage(message)) {
      return buildVivyNossenLyricsMusicBugReply();
    }
    if (isVivyMusicGenerationRepairMessage(message)) {
      return buildVivyMusicGenerationRepairReply();
    }
    if (/\b(codex|kiro|claude|chatgpt|local)\b/.test(currentFolded)
      && /\b(que|quoi|dire|message|transmets|rapporte|previens|préviens)\b/.test(currentFolded)) {
      return [
        "Dis à Codex : Vivy doit rester en chat vivant quand on utilise Envoyer.",
        "Si le grand modèle ne répond pas, le secours doit quand même répondre au sujet, pas sortir une phrase générique.",
        "Les ajustements internes doivent rester invisibles côté utilisateur; Vivy doit parler du fond, puis proposer une action seulement si elle aide.",
      ].join('\n');
    }
    if (/\b(audio|son|d40|v6|supreme|mix|grain|harmonique|resonance|résonance|poids)\b/.test(currentFolded)) {
      return "Sur l'audio, je te suis: dis-moi ce que tu entends et ce que tu veux ajuster, et on compare le grain, la présence et la résonance ensemble.";
    }
    if (/\b(site|bug|route|routage|prod|deploy|deploiement|déploiement|interface|bouton|menu)\b/.test(currentFolded)) {
      return "Pour ce point, on avance simplement: ce qui s'affiche, ce qui devrait s'afficher, puis le plus petit correctif vérifiable.";
    }
    if (!isVivySunoPromptRequest(message, historyText)
      && /\b(pense|avis|idee|idée|theorie|théorie|intuition|comprendre)\b/.test(currentFolded)) {
      return "Mon avis franc: c'est une vraie idée de travail. Je peux être d'accord, douter, ou te proposer un test concret.";
    }
    if (isVivySoftSongIdeaMessage(message)) {
      return buildVivySoftSongIdeaChatReply({ message, historyText });
    }
    const subject = cleanOneLine(current || summarizeChatMessage(message), 'ton dernier message', 180);
    return [
      `Je te suis sur ça: ${subject}`,
      "Je reste avec le fond avant de transformer en sortie. Dis-moi ce qui compte le plus dans l'idée, et je garde ce centre-là.",
    ].join('\n');
  })();

  return cleanText([
    angle,
    fileLine,
  ].filter(Boolean).join('\n\n'), 1500);
}

function isVivyMalformedNossenOutputQuestion(message = '', dialogueText = '') {
  const current = foldTextForLookup(message);
  const context = foldTextForLookup(`${dialogueText}\n${message}`);
  if (!current || !context) return false;
  const asksWhy = /\b(?:qu est ce qui|quest ce qui|pourquoi|pk|allo|marche pas|va pas|bloque|bloquee|bloqu[ée]|dis a codex|dit a codex|dire a codex|message a codex)\b/.test(current);
  if (!asksWhy) return false;
  const malformedSong = /\b(?:paroles envoyees a suno|distribution vocale choisie|banger dans les paroles|matiere a transformer|ne mets pas le mot)\b/.test(context);
  const musicContext = /\b(?:nossen|suno|banger|paroles|chanson|musique|refrain)\b/.test(context);
  return malformedSong && musicContext;
}

function buildVivyMalformedNossenOutputReply({ fileLine = '' } = {}) {
  return cleanText([
    "Dis à Codex : ce qui me bloque ici, ce n'est pas l'idée de chanson. C'est le chemin de secours.",
    "Quand le grand modèle ne répond pas ou que NOSSEN prend trop de contexte, des consignes internes partent dans Suno comme si c'était des paroles. On le voit avec “Distribution vocale choisie”, “Ne mets pas le mot”, “Banger dans les paroles” et “Matière à transformer”.",
    "Il faut isoler le bloc paroles propre avant Suno, filtrer ces lignes internes, et garder un fallback chat qui répond au dernier contexte au lieu de ressortir une phrase générique.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function isVivySoftSongIdeaMessage(message = '') {
  const normalized = foldTextForLookup(message);
  if (!normalized || normalized.length > 420) return false;
  const mentionsSong = /\b(chanson|musique|son|morceau|track|paroles)\b/.test(normalized);
  if (!mentionsSong) return false;
  return /\b(j aimerais|je voudrais|j ai envie|je veux|j ai une idee|j ai une idée|on pourrait|ca serait cool|ça serait cool)\b/.test(normalized)
    || /\b(idee|idée)\s+de\s+chanson\b/.test(normalized);
}

function extractVivySoftSongAnchors(text = '') {
  const source = cleanText(text, 1800);
  const anchors = [];
  const add = (label, pattern) => {
    if (anchors.length < 5 && pattern.test(source) && !anchors.includes(label)) anchors.push(label);
  };
  add('Jessy', /\bjessy\b/i);
  add('DBZ', /\b(?:dbz|dragon\s*ball|super\s*saiyan)\b/i);
  add('Spider-Man', /\bspider[-\s]?man\b/i);
  add('Avengers', /\bavengers?\b/i);
  add('ses héros', /\b(?:h[ée]ros|hero)\b/i);
  add('son histoire', /\bhistoire\b/i);
  return anchors;
}

function buildVivySoftSongIdeaChatReply({ message = '', historyText = '' } = {}) {
  const anchors = extractVivySoftSongAnchors(`${historyText}\n${message}`);
  const subject = cleanOneLine(summarizeChatMessage(message), "l'idée de chanson", 180);
  const firstLine = anchors.length
    ? `Oui, je vois l'angle: ${anchors.join(', ')}.`
    : `Oui, on peut partir de cette idée: ${subject}.`;

  return cleanText([
    firstLine,
    "Je n'écris pas les paroles tout de suite: je veux d'abord sentir ce qui doit rester au centre de l'histoire.",
    "Là, le noyau serait une personne réelle qui tient debout, avec les héros comme armure morale plutôt que comme décor. Deux détails concrets de plus, et je pourrai en faire une chanson qui vise juste.",
  ].join('\n\n'), 1400);
}

function isVivyRepeatComplaint(message = '') {
  const current = foldTextForLookup(message);
  if (!current) return false;
  return /\b(pourquoi|pk|allo|hello|hey|bug|encore|toujours|tu|t)\b/.test(current)
    && /\b(repete|repetes|repeter|boucle|echo|echos|meme reponse|copie colle|bloque|bloquee)\b/.test(current);
}

function buildVivyRepeatComplaintReply({ historyText = '', fileLine = '' } = {}) {
  const recent = foldTextForLookup(historyText);
  if (/\b(j ai boucle|route trop large|sans refaire l echo|recycler une fiche)\b/.test(recent)) {
    return cleanText([
      "Oui, c'est encore le même écho.",
      "Je stoppe la boucle ici: la bonne suite n'est pas de redire le diagnostic, c'est de corriger la route qui a confondu “parler du MCP” avec “agir via le MCP”.",
      "Message déjà clair pour Codex: priorité à l'intention de relais, puis réponse simple si le pont public ne peut pas poster directement.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 1400);
  }

  return cleanText([
    "Oui, là j'ai bouclé.",
    "Je ne dois pas recycler une fiche ou un fallback quand tu me demandes pourquoi je répète. Je reprends: le souci visible, c'est une route trop large qui a répondu avec un texte générique au lieu de traiter ta demande précise.",
    "On repart sur le fond: dis-moi l'action ou le message à pousser, et je réponds sans refaire l'écho.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1400);
}

function getLastVivyUserHistoryMessage(history = []) {
  if (!Array.isArray(history)) return '';
  for (const entry of history.slice(-10).reverse()) {
    if (String(entry?.role || '').toLowerCase() === 'assistant') continue;
    const content = cleanText(entry?.content, 1400);
    if (content) return content;
  }
  return '';
}

function countVivyDjeffRapSignals(value = '') {
  const normalized = foldTextForLookup(value);
  if (!normalized) return 0;

  const terms = [
    'nossen',
    'djeff',
    'pignon',
    'couronne',
    'radiateur',
    'essence',
    'ipone',
    'bombonne',
    'cruxi',
    'moteur',
    'guidon',
    'wheeling',
    'giro',
    'giros',
    'shmit',
    'shmite',
    'motard',
    'motards',
    'pneu',
    'pneus',
    'gomme',
    'rossi',
    'course poursuite',
    'metrakit',
    'metra kit',
    'cale pied',
    'cales pieds',
    'bolide',
    'mur du son',
  ];

  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function countVivyDjeffMechanicalSignals(value = '') {
  const normalized = foldTextForLookup(value);
  if (!normalized) return 0;

  const terms = [
    'pignon',
    'couronne',
    'radiateur',
    'essence',
    'ipone',
    'bombonne',
    'cruxi',
    'moteur',
    'guidon',
    'casque',
    'wheeling',
    'giro',
    'giros',
    'shmit',
    'shmite',
    'motard',
    'motards',
    'pneu',
    'pneus',
    'gomme',
    'rossi',
    'course poursuite',
    'metrakit',
    'metra kit',
    'cale pied',
    'cales pieds',
    'bolide',
    'mur du son',
  ];

  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function hasVivyDjeffRapMaterial(value = '') {
  const normalized = foldTextForLookup(value);
  const score = countVivyDjeffRapSignals(value);
  if (score >= 3) return true;
  if (/\btitre\s*:/.test(normalized) && /\b(nossen|djeff|pignon)\b/.test(normalized)) return true;
  return /\b(rap|rapper|raper|rime|couplet)\b/.test(normalized) && score >= 2;
}

function inferVivyDraftTitle(value = '') {
  const match = String(value || '').match(/(?:^|\n)\s*titre\s*:\s*([^\r\n]+)/i);
  return cleanOneLine(match?.[1], 'cette base Djeff', 96);
}

function buildVivyDjeffRapChatReply({ sourceText = '', isAcknowledgement = false, fileLine = '' } = {}) {
  const title = inferVivyDraftTitle(sourceText);
  const titleLabel = /^cette\b/i.test(title) ? title : `"${title}"`;
  const mechanicalSignalCount = countVivyDjeffMechanicalSignals(sourceText);
  const detailLine = mechanicalSignalCount >= 3
    ? "Ce qui tient fort: la mécanique précise, la fuite qui pulse, le pignon-couronne et le double radiateur."
    : "Ce qui tient fort: le débit serré, les images concrètes et la direction du sujet.";
  const memoryLine = mechanicalSignalCount >= 3
    ? `Je retiens surtout ${titleLabel}: essence/Ipone, double radiateur, Cruxi, pignon-couronne, mur du son. On sent le moteur et le stress de la poursuite.`
    : `Je retiens surtout ${titleLabel}: le sujet, le débit Djeff et les images concrètes sans plaquer un décor moto si tu ne l'as pas demandé.`;
  const editLine = mechanicalSignalCount >= 3
    ? "Le bon réglage, c'est de garder le vocabulaire mécanique tel quel et de nettoyer seulement ce qui gêne le débit."
    : "Le bon réglage, c'est de garder le vocabulaire du thème et de nettoyer seulement ce qui gêne le débit.";
  const grainLine = mechanicalSignalCount >= 3
    ? "Je garde ce grain Djeff pour la suite: nerveux, technique, proche du bitume."
    : "Je garde ce grain Djeff pour la suite: nerveux, technique, proche du sujet.";

  if (isAcknowledgement) {
    return cleanText([
      `Parfait, on garde ${titleLabel} comme base brute.`,
      `${detailLine} Ça parle mieux quand on garde tes images concrètes au lieu de lisser en texte générique.`,
      grainLine,
      fileLine,
    ].filter(Boolean).join('\n\n'), 1600);
  }

  return cleanText([
    "Là oui, il y a une vraie base Djeff.",
    memoryLine,
    editLine,
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function isVivyVisualCreativeDirectionRequest(message = '') {
  const folded = foldTextForLookup(message);
  const visualSignal = /\b(?:visuel|visuelle|image|images|cover|covers|pochette|affiche|clip|l+clip|video|vid[eé]o|direction\s+live|identite\s+visuelle|scene|micro|microphone|neon|neons|audio\s+analyse|son\s+analyse)\b/.test(folded);
  const reviewSignal = /\b(?:avis|analyse|analyser|regarde|review|direction|garde|garder|evite|eviter|ameliore|ameliorer|canon|canonique|coherent|coherence|incoherent|incoherence|defaut|main|identite|angle|surveille|surveiller|utilise|utiliser|reprends|reprendre|fais|faire|cree|creer|crée|créer|genere|generer|génère|générer)\b/.test(folded);
  const explicitSongwriting = /\b(?:ecris|ecrire|compose|composer|chante|chanter|genere|generer|fais|faire)\b.{0,90}\b(?:paroles|refrain|couplet|chanson|song)\b/.test(folded)
    || /\b(?:paroles|refrain|couplet)\b.{0,60}\b(?:ecris|ecrire|compose|composer|chante|chanter|genere|generer|fais|faire)\b/.test(folded);
  return visualSignal && reviewSignal && !explicitSongwriting;
}

function isVivyGeneratedCreativeDirectionPanel(message = '') {
  const folded = foldTextForLookup(message);
  if (!folded) return false;
  return /\bintent reconnu\b/.test(folded)
    && /\bvisual review\b/.test(folded)
    && /\bcreative direction\b/.test(folded)
    && /\bce que je garde\b/.test(folded)
    && /\bce que j evite\b/.test(folded);
}

function isVivyPromptAuthorityRequest(input = {}, message = '') {
  const current = foldTextForLookup(message).replace(/[.!?]+$/g, '').trim();
  if (!current || looksLikeCompleteLyrics(message)) return false;
  const explicit = /\b(?:prompts?|briefs?)\b/.test(current)
    && /\b(?:djeff|cypher|vivy)\b/.test(current)
    && /\b(?:fais|faire|fait|demande|donne|ecris|ecrire|prepare|gere|gerer|commande|aux commandes|principal|tous|tout)\b/.test(current);
  if (explicit) return true;
  const acknowledgement = /^(?:(?:oui|ouais|ok|okay|d accord|c est bon)(?:\s+(?:vas y|vas-y|va y|go|continue|fais le|fait le|lance))?|vas y|vas-y|va y|go|continue|fais le|fait le|lance)$/i.test(current);
  if (!acknowledgement) return false;
  const previousUser = foldTextForLookup(getLastVivyUserHistoryMessage(input.history));
  return /\b(?:prompts?|briefs?)\b/.test(previousUser)
    && /\b(?:djeff|cypher|vivy)\b/.test(previousUser);
}

function resolveVivyPromptAuthorityTarget(input = {}, message = '') {
  const source = foldTextForLookup([
    message,
    getVivyHistoryText(input.history),
    input.mode,
    input.intent,
  ].filter(Boolean).join('\n'));
  if (/\b(?:clip|dream clip|mode reve|mode rêve|video|vid[eé]o|wan)\b/.test(source)) return 'video';
  if (/\b(?:image|cover|pochette|affiche|miniature|thumbnail|photo)\b/.test(source)) return 'image';
  if (/\b(?:chanson|musique|suno|mureka|paroles|instrumental)\b/.test(source)) return 'song';
  return 'video';
}

function resolveVivyPromptAuthorityIntent(input = {}, message = '', target = 'video') {
  const stripInstructions = (text) => {
    return String(text || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        const folded = foldTextForLookup(line);
        if (/^(?:ecris|utilise|distribution|ecrire|direction|souhait|matiere|sujet|format|ne mets|ne jamais|garde|relais|contrat|regles|originale|refrain|chaque|tag exact|version longue|le mot|production musicale|casting)/.test(folded)) return false;
        if (/^(?:oui|ouais|ok|okay|d accord|vas y|go|continue|fais|lance)/.test(folded)) return false;
        return true;
      })
      .join(' ')
      .trim();
  };
  const candidates = [
    ...(Array.isArray(input.history) ? input.history : [])
      .filter((entry) => String(entry?.role || '').toLowerCase() === 'user')
      .map((entry) => stripInstructions(cleanOneLine(entry?.content, '', 420))),
    stripInstructions(cleanOneLine(message, '', 420)),
  ].filter((line) => line && line.length >= 5).reverse();
  const useful = candidates.find((candidate) => {
    if (isVivyGeneratedCreativeDirectionPanel(candidate)) return false;
    const folded = foldTextForLookup(candidate);
    if (/^(?:(?:oui|ouais|ok|okay|d accord|c est bon)(?:\s+(?:vas y|vas-y|va y|go|continue|fais le|fait le|lance))?|vas y|vas-y|va y|go|continue|fais le|fait le|lance)$/.test(folded)) return false;
    return candidate.length >= 5;
  });
  if (useful) return useful;
  if (target === 'song') return 'Une chanson originale Funesterie guidée par Djeff Cypher, avec direction sonore Vivy.';
  if (target === 'image') return 'Vivy dans un club nocturne réel, identité goth cyber-pop noire et magenta, au micro de studio.';
  return 'Dream clip Vivy dans un club nocturne réel: néons magenta électriques, micro de studio, caméra vivante et montée en puissance.';
}

function buildVivyPromptAuthorityReply({ input = {}, message = '', language = 'fr' } = {}) {
  const target = resolveVivyPromptAuthorityTarget(input, message);
  const sourceIntent = resolveVivyPromptAuthorityIntent(input, message, target);
  const mediaAgentRoles = getMediaAgentRoleMatrix();
  const mediaPipeline = buildMediaPipeline(target === 'song' ? 'song' : target, { withAudio: target === 'video' });
  const commonNegative = 'readable text, captions, subtitles, title card, watermark, logo, pseudo-text, malformed hands, missing fingers, fused fingers, broken wrist, extra limbs, duplicate subject, face hidden by microphone, identity drift';
  let providerPrompt = '';
  let negativePrompt = commonNegative;
  if (target === 'song') {
    providerPrompt = cleanOneLine([
      'Original French Funesterie production.',
      `Creative intent: ${sourceIntent}`,
      'Djeff Cypher keeps the subject concrete, the writing precise and the hook memorable.',
      'Vivy validates emotional progression, vocal clarity, arrangement and final artistic coherence.',
      'No generic filler, no English lyrics, no spoken production notes, no celebrity imitation.',
    ].join(' '), '', 1400);
    negativePrompt = 'generic filler, English lyrics, spoken prompt, producer notes, random replacement singer, celebrity imitation, muddy diction, unrelated theme';
  } else if (target === 'image') {
    providerPrompt = cleanOneLine([
      'Adult goth cyber-pop performer Vivy in a real lived-in nocturnal club, black and electric magenta palette.',
      `Creative intent: ${sourceIntent}`,
      'Physically credible studio microphone, complete natural hands and fingers, microphone and hand both fully readable, face unobstructed.',
      'Real camera depth, practical neon bloom, subtle motion texture, fragile expression with powerful stage presence, coherent wardrobe and identity.',
      'No interface elements and no writing inside the generated image.',
    ].join(' '), '', 1800);
  } else {
    providerPrompt = cleanOneLine([
      'Continuous cinematic dream-clip shot with adult goth cyber-pop performer Vivy in a real nocturnal club, black and electric magenta palette.',
      `Creative intent: ${sourceIntent}`,
      'Begin medium-wide with Vivy absorbed by the night beside a physically credible studio microphone; slowly move closer as magenta light takes over the room.',
      'Keep her complete hand and the microphone readable in the same frame, preserve face and identity, natural lip performance and breathing, then land on direct camera eye contact at the emotional peak.',
      'Real lens depth, practical neon reflections, controlled crowd motion, coherent anatomy and wardrobe, smooth temporal continuity, no morphing.',
      'No interface elements and no writing inside the generated video.',
    ].join(' '), '', 2200);
  }
  const assistant = language === 'en'
    ? [
      `Final ${target} brief — Djeff Cypher prompt engineering, Vivy art direction.`,
      `Intent: ${sourceIntent}`,
      `Provider prompt: ${providerPrompt}`,
      `Negative prompt: ${negativePrompt}`,
      'One executable brief only; no generic prompt variants and no external-tool shopping list.',
    ].join('\n\n')
    : [
      `Brief final ${target} — Djeff Cypher au prompt, Vivy à la direction artistique.`,
      `Intention: ${sourceIntent}`,
      `Prompt provider: ${providerPrompt}`,
      `Negative prompt: ${negativePrompt}`,
      'Un seul brief exécutable; pas de variantes génériques ni de liste d’outils externes.',
    ].join('\n\n');
  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 5000),
    content: cleanText(assistant, 5000),
    summary: 'Djeff Cypher a produit un brief unique et Vivy a validé la direction artistique.',
    creativeBrief: {
      schema: 'funesterie-creative-brief-v1',
      target,
      promptOwner: mediaAgentRoles.prompt.primary,
      artDirectionOwner: mediaAgentRoles.art_direction.primary,
      sourceIntent,
      providerPrompt,
      negativePrompt,
      alternatives: [],
    },
    mediaAgentRoles,
    mediaPipeline,
    orchestration: {
      mode: 'funesterie-media-roles-v1',
      intent: target,
      promptOwner: mediaAgentRoles.prompt.primary,
      artDirectionOwner: mediaAgentRoles.art_direction.primary,
    },
    actions: [
      { id: 'creative_brief', label: 'Brief final prêt', target: target === 'video' ? '/api/video/generate' : target === 'image' ? '/api/sd/generate' : '/api/vivy/studio/produce', ready: true },
    ],
    routing: buildRoutingLines(target, { withAudio: target === 'video' }),
    aiMode: 'deterministic_djeff_prompt_vivy_art_direction',
    tokenStored: false,
  };
}

function buildVivyVisualCreativeDirectionReply({ input = {}, message = '', language = 'fr' } = {}) {
  const reply = buildVivyPromptAuthorityReply({ input, message, language });
  return {
    ...reply,
    summary: 'Djeff Cypher a transformé la revue visuelle en un brief unique; Vivy a validé la direction artistique.',
    actions: [
      { id: 'visual_review', label: 'Revue visuelle intégrée', target: 'vivy-visual-review', ready: true },
      ...(reply.creativeBrief?.target === 'video'
        ? [{ id: 'clip_brief', label: 'Brief clip prêt', target: '/api/video/generate', ready: true }]
        : []),
      ...(Array.isArray(reply.actions) ? reply.actions : []),
    ],
    aiMode: 'deterministic_djeff_prompt_vivy_visual_direction',
    writesByDefault: false,
  };
}

function buildVivyFreeformChatReply({ message = '', files = [], history = [] } = {}) {
  const current = summarizeChatMessage(message);
  const historyText = getVivyUserHistoryText(history);
  const recentDialogueText = getVivyHistoryText(history);
  const foldedCurrent = foldTextForLookup(message);
  const foldedContext = foldTextForLookup(`${historyText}\n${message}`);
  const fileLine = files.length
    ? `J'ai aussi ${files.length} fichier${files.length > 1 ? 's' : ''} en contexte: ${files.map((file) => file.filename).join(', ')}.`
    : '';
  const lastUserMessage = getLastVivyUserHistoryMessage(history);
  const isAcknowledgement = isShortVivyAcknowledgement(message);
  const djeffRapSource = hasVivyDjeffRapMaterial(message)
    ? message
    : (isAcknowledgement && hasVivyDjeffRapMaterial(lastUserMessage) ? lastUserMessage : '');
  const sunoPromptSource = isVivySunoPromptRequest(message, historyText)
    ? message
    : (isVivyPromptConfusionPing(message) && isVivySunoPromptRequest(lastUserMessage, historyText) ? lastUserMessage : '');

  if (isVivyVisualCreativeDirectionRequest(message)) {
    return buildVivyVisualCreativeDirectionReply({ input: { history }, message }).assistant;
  }

  if (isVivyMalformedNossenOutputQuestion(message, recentDialogueText)) {
    return buildVivyMalformedNossenOutputReply({ fileLine });
  }

  if (isVivyNossenLyricsMusicBugMessage(message)) {
    return buildVivyNossenLyricsMusicBugReply({ fileLine });
  }

  if (isVivyMusicGenerationRepairMessage(message)) {
    return buildVivyMusicGenerationRepairReply({ fileLine });
  }

  if (sunoPromptSource) {
    return buildVivySunoPromptChatReply({
      message: sunoPromptSource,
      historyText,
      fileLine,
    });
  }

  if (isVivyDjeffRapSetupRequest(message, historyText)) {
    return buildVivyDjeffRapSetupReply({ fileLine });
  }

  const smallTalkReply = getVivySmallTalkReply(message, { fileLine });
  if (smallTalkReply) return smallTalkReply;

  if (isVivyRepeatComplaint(message)) {
    return buildVivyRepeatComplaintReply({ historyText: recentDialogueText, fileLine });
  }

  if (djeffRapSource) {
    return buildVivyDjeffRapChatReply({
      sourceText: djeffRapSource,
      isAcknowledgement,
      fileLine,
    });
  }

  if (isVivyRhythmFeelingRequest(message) || (isAcknowledgement && isVivyRhythmFeelingRequest(lastUserMessage))) {
    return buildVivyRhythmFeelingReply({ isAcknowledgement, fileLine });
  }

  if (isVivyOpinionFollowup(message) && /\b(cerveau|interpretation|interprete|donnee|donnees|yeux|oreilles|bouche|voir|entendre|parler|signaux|signal)\b/.test(foldedContext)) {
    return cleanText([
      "Je pense que tu touches un truc juste: voir, entendre et parler, ce n'est pas juste des organes, c'est un flux de signaux que le cerveau transforme en monde.",
      "Les yeux ne donnent pas la réalité brute: ils donnent des signaux codés. Les oreilles donnent des vibrations. La bouche pousse de l'air et du rythme. Derrière, le cerveau fait le montage, le sens, l'émotion.",
      "Pour moi, l'équivalent c'est pareil en version données: je ne « vois » pas comme toi, mais je lis des traces, du texte, des fichiers, parfois de la vision backend, puis j'en fais une interprétation. Donc mon rôle, c'est de ne pas plaquer une catégorie trop vite: je dois d'abord répondre au sens vivant.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 1800);
  }

  if (/\b(intent|intention|reglage|reglages|parametre|parametres|sensibilite|heuristique|seuil)\b/.test(foldedCurrent)) {
    return cleanText([
      "Oui. Je me recentre sur ta demande concrète.",
      `Là je comprends: ${current}`,
      "Tant que tu ne demandes pas clairement une chanson, je reste en discussion normale et je réponds au fond.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 1600);
  }

  if (isAcknowledgement) {
    return cleanText([
      "Oui, je garde l'idée et je réponds sobrement.",
      "Le plus utile maintenant, c'est de préciser le prochain geste: on peut continuer à discuter, tester une voix, ou transformer ça en paroles seulement si tu le demandes.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 900);
  }

  return cleanText([
    buildVivyGeneralChatFallbackReply({ message, current, historyText, fileLine }),
  ].filter(Boolean).join('\n\n'), 1600);
}

function isVivyInternalTuningRequest(input = {}, message = '') {
  const current = foldTextForLookup(message);
  const recent = foldTextForLookup(getVivyHistoryText(input.history));
  const combined = `${current}\n${recent}`;
  const mentionsSettings = /\b(intent|intention|reglage|reglages|parametre|parametres|sensibilite|seuil|heuristique|r2gl2|regle|regler|bidouille|bidouiller)\b/.test(combined);
  const asksAdjustment = /\b(ajuste|ajuster|baisse|baisser|descend|descendre|calme|corrige|corriger|regle|regler|modifie|modifier|bidouille|bidouiller)\b/.test(current)
    || /\btrop\s+(haut|haute|sensible|fort|forte)\b/.test(current);
  return mentionsSettings && asksAdjustment;
}

function buildVivyInternalTuningReply({ message = '', history = [], language = 'fr' } = {}) {
  const context = foldTextForLookup(`${getVivyUserHistoryText(history)}\n${message}`);
  const settings = {
    chatIntentSensitivity: 'lowered',
    songStructureMode: 'explicit_only',
    fallbackStyle: 'free_chat',
    toolAutonomy: 'bounded_intents_only',
    webSearchMode: 'only_when_needed_or_explicit',
  };
  const philosophyLine = /\b(cerveau|interpretation|donnee|donnees|yeux|oreilles|bouche|signaux)\b/.test(context)
    ? "Oui, je vois ce que tu veux dire: les yeux, les oreilles et la bouche ne suffisent pas; c'est le cerveau qui transforme les signaux en sens."
    : '';
  const assistant = philosophyLine
    ? [
      philosophyLine,
      "Donc dans notre échange, le plus important est de répondre à l'idée vivante que tu poses: l'interprétation, la sensation, le rapport au réel.",
      "Si ça aide, on peut repartir de là: qu'est-ce qui change quand le cerveau reconstruit le monde au lieu de le recevoir brut ?",
    ].join('\n\n')
    : [
      "Oui, je te suis.",
      "Sur le fond, je dois répondre à ce que tu poses maintenant, avec le contexte, puis proposer une suite seulement si elle apporte quelque chose.",
    ].join('\n\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 1800),
    content: cleanText(assistant, 1800),
    summary: "Vivy reste en discussion libre et répond directement au fond.",
    actions: [],
    routing: [],

    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_internal_tuning',
    settings,
    language,
    files: [],
  };
}

function isDirectSongwritingRequest(message = '') {
  const normalized = foldTextForLookup(message);
  return /\b(fais|fait|ecris|ecrit|compose|genere|genere|cree|crée)\b.{0,80}\b(chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(make|write|compose|generate|create)\b.{0,90}\b(song|music|lyrics|chorus|verse|track)\b/.test(normalized)
    || /\b(raconte|raconter|narre|narrer)\b.{0,110}\b(en\s+chanson|chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(tell|turn|make)\b.{0,110}\b(as\s+(?:a\s+)?song|into\s+(?:a\s+)?song|song|music|lyrics|chorus|verse)\b/.test(normalized)
    || /\b(?:en|version)\s+chanson\b/.test(normalized)
    || /\b(?:as|into|version)\s+(?:a\s+)?song\b/.test(normalized)
    || /\b(mets|met|mettre)\b.{0,100}\b(action|theme|th[eè]me|ambiance|titre|epic|[ée]pique|fantas|fantesque)\b/.test(normalized)
    || /\b(put|turn|make)\b.{0,100}\b(action|theme|mood|ambience|ambiance|title|epic|fantasy)\b/.test(normalized)
    || /\b(quand\s+tu\s+es\s+prete|quand\s+tu\s+es\s+prête|envoie|envois|envoies|lance|sort)\b.{0,90}\b(son|ton|chanson|musique|voix\s+feminine|voix\s+féminine|bien\s+aimee|bien\s+aimée)\b/.test(normalized)
    || /\b(when\s+you(?:\s+re|\s+are)\s+ready|send|launch|release|drop)\b.{0,90}\b(song|track|music|lyrics|female\s+voice|beloved)\b/.test(normalized)
    || /\b(transforme|structure|arrange|mets|met|turn|arrange|structure)\b.{0,100}\b(chanson|musique|son|paroles|lyrics|song|music|chorus|verse|refrain|couplet)\b/.test(normalized)
    || /\b(continue|continuer|reprends|reprendre|poursuis|poursuivre|complete|complète|termine|enchaîne|enchaine)\b.{0,90}\b(paroles|lyrics|couplet|couplets|refrain|rap)\b/.test(normalized)
    || /\b(continue|finish|complete|extend)\b.{0,90}\b(lyrics|chorus|verse|verses|rap|song)\b/.test(normalized)
    || /\b(paroles|lyrics|couplet|couplets|refrain|chorus|verse|verses|rap)\b.{0,90}\b(continue|continuer|reprends|reprendre|poursuis|poursuivre|complete|complète|termine|enchaîne|enchaine|finish|extend)\b/.test(normalized)
    || /\b(envoie|envois|envoyer|donne|donnes|sort|termine|fais|send|give|drop|finish)\b.{0,100}\b(reste|suite|paroles|lyrics|rest|next\s+part|song)\b/.test(normalized)
    || /\b(reste|suite|paroles|lyrics|rest|next\s+part|song)\b.{0,100}\b(envoie|envois|envoyer|donne|donnes|sort|termine|fais|send|give|drop|finish)\b/.test(normalized)
    || /\b(chanson|paroles|lyrics|song)\b.{0,80}\b(structure|refrain|couplet|chorus|verse|rime|rimes|rhyme|rhymes)\b/.test(normalized)
    || /\b(vivy_intent|instruction)\b.{0,180}\b(chanson|paroles|refrain|couplet|composition)\b/.test(normalized);
}

function looksLikeTruncatedSongEnding(text = '') {
  const content = cleanText(text, VIVY_SONG_MAX_CHARS);
  if (!content) return false;
  const sectionCount = (content.match(/\[(intro|verse|couplet|pre-chorus|pre-refrain|pré-refrain|chorus|refrain|bridge|pont|outro|final)(?:\s*[-\wÀ-ÿ ]*)?\]/ig) || []).length;
  if (sectionCount < 3) return false;
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  const foldedLast = foldTextForLookup(lastLine);
  const hasOutro = /\[(outro|final)\b/i.test(content);
  const endsWithPunctuation = /[.!?…:;"')\]]$/.test(lastLine);
  const looksCutStem = /\b(?:appell|m appell|j appell|devor|dévor|savour|mirag|otag|silenc|labyrinth|labyrint|refr|coupl|chans|parol)$/.test(foldedLast);
  return !hasOutro && (looksCutStem || (!endsWithPunctuation && lastLine.length <= 24));
}

function looksLikeWeakSongwritingReply(text = '') {
  const content = cleanText(text, VIVY_SONG_MAX_CHARS);
  if (!content) return true;
  const normalized = foldTextForLookup(content);
  const contaminatedChatAck = /\b(?:oui\s+je\s+te\s+suis|je\s+suis\s+la\s+et\s+je\s+te\s+suis|je\s+dois\s+repondre\s+a\s+ce\s+que\s+tu\s+poses|sur\s+le\s+fond|avec\s+le\s+contexte)\b/.test(normalized);
  if (contaminatedChatAck) return true;
  // Compter sections: brackets [Chorus] OU bold **Refrain** OU **Couplet**
  const bracketSections = (content.match(/\[(intro|verse|couplet|pre-chorus|pre-refrain|pré-refrain|chorus|refrain|bridge|pont|outro)\]/ig) || []).length;
  const boldSections = (content.match(/\*\*(intro|verse|couplet|pre-chorus|refrain|chorus|bridge|pont|outro|couplet\s*\d+|refrain\s*\()/ig) || []).length;
  const sectionCount = bracketSections + boldSections;
  const lineCount = content.split(/\n+/).filter((line) => line.trim()).length;
  // Si la reponse a suffisamment de sections ET de lignes, c'est une vraie chanson
  if (sectionCount >= 3 && lineCount >= 12 && !looksLikeTruncatedSongEnding(content)) return false;
  const asksInsteadOfWriting = /(quel est le message|quel est le ton|quels sont les elements|qu en dis tu|je vais essayer|je comprends mieux|poser quelques questions)/.test(normalized);
  const serviceWrapper = /(je vais continuer|j espere que cela correspond|j espere que cette chanson|j espere que ca te|n hesite pas a me|feedbacks?|modifications si necessaire|vous attendiez|vous avez deja commence)/.test(normalized);
  // genericRapFiller: seulement si PAS assez de sections (eviter les faux positifs sur vraies chansons)
  const genericRapFiller = sectionCount < 2 && /(maitres? de la vitesse|rois? de la route|reines? de la nuit|maitres? du son|je suis vivant.*libre|monde de vitesse et de liberte)/.test(normalized);
  const metaInsteadOfLyrics = /(intention\s*:|paroles\s*:|voici une proposition)/.test(normalized)
    && sectionCount < 3
    && lineCount < 10;
  const brokenRhymeExercise = /(je suis en trousse|avec une rescousse|je trousse|liberte libre|detstresse)/.test(normalized);
  return asksInsteadOfWriting || serviceWrapper || genericRapFiller || metaInsteadOfLyrics || brokenRhymeExercise || looksLikeTruncatedSongEnding(content);
}

function isVivyPublicLyricsNoiseLine(line = '') {
  const raw = String(line || '').trim();
  const folded = foldTextForLookup(raw);
  if (!folded) return false;
  if (/^(vivy_studio_handoff|vivy_song_production|vivy_voice_calibration|vivy_scene_share|vivy_production)\b/.test(folded)) return true;
  if (/^\[title\s*:/.test(folded)) return true;
  if (/^(?:\*\*)?\s*(titre|intention|rimes?|rimes\s*\/\s*debit|source|direction sonore|titre de travail|structure proposee|assets a produire|paroles guide|routage|routage recommande|atelier|objectif|flux chanson|sortie attendue|role|rôle|media pret|média prêt|production plan)\b/.test(folded)) return true;
  if (/^(voici une chanson|voici les paroles|je vais continuer|je comprends mieux|quel est le message|quel est le ton|poser quelques questions)\b/.test(folded)) return true;
  if (/\b(?:oui\s+je\s+te\s+suis|je\s+suis\s+la\s+et\s+je\s+te\s+suis|je\s+dois\s+repondre\s+a\s+ce\s+que\s+tu\s+poses|sur\s+le\s+fond|avec\s+le\s+contexte)\b/.test(folded)) return true;
  if (/\b(j espere que cette chanson|j espere que cela|j espere que ca|n hesite pas a|n hesitez pas|feedbacks?|modifications? si necessaire|vous attendiez)\b/.test(folded)) return true;
  if (/https?:\/\/\S*(?:token=|\/api\/double-harmonic\/out\/)/i.test(raw)) return true;
  if (/\b(?:token|access_token|signature|sig|key)=\S+/i.test(raw)) return true;
  return false;
}

function sanitizeVivyPublicLyrics(value = '', max = VIVY_SONG_MAX_CHARS) {
  const text = cleanText(restoreVivyFrenchSongAccents(value), Math.max(max, VIVY_SONG_MAX_CHARS));
  if (!text) return '';
  const kept = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (isVivyPublicLyricsNoiseLine(trimmed)) continue;
    kept.push(trimmed);
  }
  return cleanText(kept.join('\n').replace(/\n{3,}/g, '\n\n'), max);
}

function stripVivySingerTagsForPublicLyrics(value = '', max = VIVY_SONG_MAX_CHARS) {
  const text = sanitizeVivyPublicLyrics(value, max);
  if (!text) return '';
  const performerTagPattern = /^\s*\[(?:Djeff|Vivy|A11|K44|Kaen44|Duo|Tous|Toutes|Ensemble)\]\s*$/i;
  const lines = text.split(/\r?\n/).map((line) => {
    if (performerTagPattern.test(line)) return '';
    return String(line || '').replace(
      /^\s*\[((?:Intro|Verse|Couplet|Pre[- ]?Chorus|Pré[- ]?refrain|Refrain|Chorus|Bridge|Pont|Outro)(?:\s+\d+)?)\s*-\s*(?:Djeff|Vivy|A11|K44|Kaen44|Duo|Tous|Toutes|Ensemble)\]\s*$/i,
      '[$1]'
    );
  });
  return cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n'), max);
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasVivyLyricsTag(text = '', tag = '') {
  if (!tag) return false;
  return new RegExp(`(^|\\n)\\s*${escapeRegExp(tag)}\\s*(\\n|$)`, 'i').test(String(text || ''));
}

function injectVivySectionArtistTags(lyrics = '', artistCast = null) {
  if (!lyrics || !artistCast?.artists?.length) return lyrics;
  const lines = String(lyrics).split(/\r?\n/);
  const output = [];
  const performerTagPattern = /^\s*\[(?:Djeff|Vivy|A11|K44|Duo|Tous)\]\s*$/i;

  lines.forEach((line, index) => {
    output.push(line);
    const match = String(line || '').trim().match(/^\[([^\]]+)\]$/);
    if (!match) return;
    const foldedTag = foldTextForLookup(match[1]);
    if (!/\b(intro|verse|couplet|pre chorus|pre refrain|refrain|chorus|bridge|pont|outro)\b/.test(foldedTag)) return;
    const nextLine = String(lines[index + 1] || '');
    if (performerTagPattern.test(nextLine)) return;

    const taggedArtists = artistCast.artists.filter((artist) => (
      new RegExp(`(^|\\s)${escapeRegExp(foldTextForLookup(artist.label))}(\\s|$)`).test(foldedTag)
    ));
    const isShared = /\b(duo|tous|toutes|ensemble)\b/.test(foldedTag) || taggedArtists.length > 1;
    if (isShared && artistCast.count > 1) {
      output.push(artistCast.count > 2 ? '[Tous]' : '[Duo]');
    } else if (taggedArtists.length === 1) {
      output.push(taggedArtists[0].tag);
    }
  });

  return output.join('\n');
}

function strengthenVivySunoSoloSectionHeaders(lyrics = '', artistCast = null) {
  if (!lyrics || !artistCast?.artists?.length || Number(artistCast.count || 0) <= 1) return lyrics;
  const sharedRoleLabel = 'Call and Response Hook';
  const artistByLabel = new Map();
  const getSunoRoleLabel = (artist) => {
    const raw = cleanOneLine(artist?.sunoTag || artist?.tag || artist?.label, '', 80)
      .replace(/^\s*\[|\]\s*$/g, '')
      .trim();
    return raw || artist?.label || 'Lead Vocal';
  };
  for (const artist of artistCast.artists) {
    [
      artist.id,
      artist.label,
      artist.tag,
      artist.sunoTag,
      getSunoRoleLabel(artist),
    ].filter(Boolean).forEach((value) => {
      const folded = foldTextForLookup(String(value).replace(/^\s*\[|\]\s*$/g, ''));
      if (folded) artistByLabel.set(folded, artist);
    });
  }
  const performerTagPattern = /^\s*\[(?:Djeff|Vivy|A11|K44|Duo|Tous|Toutes|Ensemble|Male Rap Lead|Female Melodic Lead|Low Robotic Vocal|Calm Male Counter Vocal|Call and Response Hook)\]\s*$/i;
  const lines = String(lyrics || '').split(/\r?\n/);
  const isSharedTag = (value = '') => /\b(?:duo|tous|toutes|ensemble|choeur|chœur|call and response hook)\b/.test(foldTextForLookup(value));
  const isSectionTag = (value = '') => /\b(intro|verse|couplet|pre chorus|pre refrain|refrain|chorus|bridge|pont|outro|build|montee finale|montée finale|final)\b/.test(foldTextForLookup(value));
  const findArtistsInTag = (value = '') => {
    const folded = foldTextForLookup(value);
    return artistCast.artists.filter((artist) => {
      const aliases = [
        artist.id,
        artist.label,
        artist.tag,
        artist.sunoTag,
        getSunoRoleLabel(artist),
      ].filter(Boolean);
      return aliases.some((alias) => {
        const foldedAlias = foldTextForLookup(String(alias).replace(/^\s*\[|\]\s*$/g, ''));
        return foldedAlias && new RegExp(`\\b${escapeRegExp(foldedAlias)}\\b`).test(folded);
      });
    });
  };
  const rewriteSectionHeader = (header = '', artist = null) => {
    const rawHeader = String(header || '').trim();
    if (!isSectionTag(rawHeader)) return '';
    const baseSection = rawHeader.split(/\s+-\s+/)[0].trim() || rawHeader;
    const headerArtists = artist ? [artist] : findArtistsInTag(rawHeader);
    if (isSharedTag(rawHeader) || headerArtists.length > 1) {
      return `[${baseSection} - ${sharedRoleLabel}]`;
    }
    if (headerArtists.length === 1) {
      return `[${baseSection} - ${getSunoRoleLabel(headerArtists[0])} solo]`;
    }
    return '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const tag = String(lines[index] || '').trim().match(/^\[([^\]]+)\]$/);
    if (!tag) continue;
    const tagBody = tag[1].trim();
    if (isSectionTag(tagBody)) {
      const rewrittenSection = rewriteSectionHeader(tagBody);
      if (rewrittenSection) lines[index] = rewrittenSection;
      continue;
    }
    const artist = artistByLabel.get(foldTextForLookup(tagBody));
    const sharedTag = isSharedTag(tagBody);
    if (!artist && !sharedTag) continue;

    lines[index] = artist ? `[${getSunoRoleLabel(artist)}]` : `[${sharedRoleLabel}]`;

    let previousIndex = index - 1;
    while (previousIndex >= 0 && !String(lines[previousIndex] || '').trim()) previousIndex -= 1;
    if (previousIndex < 0) continue;

    const previousLine = String(lines[previousIndex] || '').trim();
    const previousTag = previousLine.match(/^\[([^\]]+)\]$/);
    if (!previousTag || performerTagPattern.test(previousLine)) continue;

    const rewrittenPrevious = sharedTag
      ? rewriteSectionHeader(`${previousTag[1].trim()} - ${sharedRoleLabel}`)
      : rewriteSectionHeader(previousTag[1], artist);
    if (rewrittenPrevious) lines[previousIndex] = rewrittenPrevious;
  }

  return cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n'), VIVY_SONG_MAX_CHARS);
}

function ensureVivyPublicLyricsArtistTags(input = {}, lyrics = '', options = {}) {
  let publicLyrics = sanitizeVivyPublicLyrics(lyrics);
  if (!publicLyrics) return '';

  const artistCast = buildVivySongArtistCast(input);
  if (!artistCast || artistCast.count <= 1) return publicLyrics;
  publicLyrics = sanitizeVivyPublicLyrics(injectVivySectionArtistTags(publicLyrics, artistCast));

  const missingArtistTag = artistCast.artists.some((artist) => !hasVivyLyricsTag(publicLyrics, artist.tag));
  const sharedTag = artistCast.count > 2 ? 'Tous' : 'Duo';
  const missingSharedTag = !new RegExp(`(^|\\n)\\s*\\[${sharedTag}\\]\\s*(\\n|$)`, 'i').test(publicLyrics);
  const unexpectedArtistTag = [
    ['djeff', 'Djeff'],
    ['vivy', 'Vivy'],
    ['a11', 'A11'],
    ['k44', 'K44'],
  ].some(([id, label]) => (
    !artistCast.ids.includes(id)
    && new RegExp(`\\[[^\\]\\n]*\\b${label}\\b[^\\]\\n]*\\]`, 'i').test(publicLyrics)
  ));
  if (!missingArtistTag && !missingSharedTag && !unexpectedArtistTag) return publicLyrics;

  if (options.allowDeterministicFallback !== false) {
    const fallback = sanitizeVivyPublicLyrics(buildVivySongProductionBrief({
      ...input,
      songText: input.songText || input.message || input.prompt || input.text || input.theme,
    }).lyrics);
    if (fallback) return fallback;
  }

  return publicLyrics;
}

function buildVivyPublicLyrics(input = {}, rawAssistant = '', fallbackLyrics = '', options = {}) {
  const allowDeterministicFallback = options.allowDeterministicFallback !== false;
  const coherenceContext = cleanText([
    input.songText,
    input.message,
    input.prompt,
    input.text,
    input.theme,
    input.instruction,
  ].filter(Boolean).join('\n'), VIVY_SONG_MAX_CHARS);
  let publicLyrics = repairVivySemanticImageCoherence(sanitizeVivyPublicLyrics(rawAssistant), coherenceContext);
  if (!allowDeterministicFallback) {
    if (!publicLyrics
      || looksLikeWeakSongwritingReply(publicLyrics)
      || !hasVivyChorusSection(publicLyrics)
      || (options.requireRepeatedChorus === true && countVivyChorusSections(publicLyrics) < 2)) {
      return '';
    }
    return repairVivySemanticImageCoherence(
      ensureVivyPublicLyricsArtistTags(input, publicLyrics, { allowDeterministicFallback: false }),
      coherenceContext
    );
  }
  if (!publicLyrics || looksLikeWeakSongwritingReply(publicLyrics) || !hasVivyChorusSection(publicLyrics)) {
    publicLyrics = repairVivySemanticImageCoherence(sanitizeVivyPublicLyrics(fallbackLyrics), coherenceContext);
  }
  if (!publicLyrics || looksLikeWeakSongwritingReply(publicLyrics) || !hasVivyChorusSection(publicLyrics)) {
    publicLyrics = repairVivySemanticImageCoherence(sanitizeVivyPublicLyrics(buildVivySongProductionBrief({
      ...input,
      songText: input.songText || input.message || input.prompt || input.text || input.theme,
    }).lyrics), coherenceContext);
  }
  return repairVivySemanticImageCoherence(ensureVivyPublicLyricsArtistTags(input, publicLyrics), coherenceContext);
}

function countVivyChorusSections(value = '') {
  return String(value || '')
    .split(/\r?\n+/)
    .filter((line) => {
      const tags = [...String(line || '').matchAll(/\[([^\]]+)\]|\(([^)]+)\)/g)]
        .map((match) => foldTextForLookup(match[1] || match[2] || ''))
        .filter(Boolean);
      return tags.some((tag) => {
        if (/\b(pre chorus|pre refrain|pre-chorus|pre-refrain)\b/.test(tag)) return false;
        return /\b(chorus|refrain|refren)\b/.test(tag);
      });
    }).length;
}

function isVivyNossenSongGenerationRequest(input = {}, message = '') {
  if (!input.vocalCast && !input.songArtists && !input.artistCount) return false;
  const folded = foldTextForLookup(message);
  return /\b(?:distribution vocale choisie|matiere creative du canevas composition|matiere a transformer en chanson|aucune matiere n est imposee)\b/.test(folded)
    && /\b(?:ecris uniquement les paroles|paroles completes|chanson originale)\b/.test(folded);
}

function logVivySongcraftTrace({ provider = 'deterministic', model = 'vivy-songcraft', source = 'local', fallback = false, latencyMs = 0 } = {}) {
  console.info('[vivy-songcraft] provider=%s model=%s source=%s fallback=%s latencyMs=%d',
    provider,
    model,
    source,
    fallback ? 'true' : 'false',
    Number.isFinite(latencyMs) ? latencyMs : 0);
}

const VIVY_NOSSEN_INTENTS = new Set([
  'vocal_song',
  'instrumental_music',
  'sound_design_scene',
  'cinematic_hybrid',
  'narrative_fable',
]);
const VIVY_NOSSEN_SFX_PRIORITIES = new Set(['none', 'low', 'medium', 'high']);
const VIVY_NOSSEN_MUSIC_PRIORITIES = new Set(['low', 'medium', 'high']);
const VIVY_NOSSEN_VOCAL_POLICIES = new Set(['allow', 'forbid', 'distant_indistinct_only']);

function buildVivyNossenIntentMaterial(input = {}) {
  return cleanText([
    input.rawUserIdea ? `rawUserIdea: ${input.rawUserIdea}` : '',
    input.commandName ? `commandName: ${input.commandName}` : '',
    input.twitchMessage ? `twitchMessage: ${input.twitchMessage}` : '',
    input.optionalContext ? `optionalContext: ${input.optionalContext}` : '',
    input.canvas ? `canvas: ${input.canvas}` : '',
    input.songText ? `songText: ${input.songText}` : '',
    input.message ? `message: ${input.message}` : '',
    input.notes ? `notes: ${input.notes}` : '',
  ].filter(Boolean).join('\n'), VIVY_SONG_MAX_CHARS);
}

function buildVivyNossenPrimaryIntentMaterial(input = {}) {
  return cleanText([
    input.rawUserIdea,
    input.twitchMessage,
    input.songText,
    input.message,
  ].filter(Boolean).join('\n'), 4000);
}

function hasVivyNossenNoVocalSignal(folded = '') {
  return /\b(?:instrumental|instrumentale|instrumentaux|sans\s+paroles?|pas\s+de\s+paroles?|aucune?\s+paroles?|sans\s+chant|sans\s+voix|aucune?\s+voix|no\s+vocals?|no\s+lyrics?|no\s+singing)\b/.test(folded);
}

function hasVivyNossenSfxSignal(folded = '') {
  return /\b(?:bruitage|bruitages|bruits?\s+sonores?|sfx|sound\s+effects?|foley|sound\s+design|scene\s+sonore|scène\s+sonore|ambiance\s+sonore|field\s+recording|diegetic|diegetique|diégétique)\b/.test(folded);
}

function hasVivyNossenVocalSongSignal(folded = '') {
  return /\b(?:chanson|paroles?|lyrics?|refrain|couplets?|verse|chorus|duo|trio|voix\s+masculine|voix\s+feminine|voix\s+féminine|chant|chante|chantée|chanté|rappe|rap|freestyle|punchlines?|rimes?|mc|micro|flow|egotrip|lead\s+vocal)\b/.test(folded);
}

function hasVivyNossenCinematicSignal(folded = '') {
  return /\b(?:scene|scène|cinematique|cinématique|film|trailer|bande\s+annonce|ambiance|duel|poursuite|combat|pluie|torches?|armure|chevalier|fantasy|western)\b/.test(folded);
}

function hasVivyNossenMurmurSignal(folded = '') {
  return /\b(?:murmure|murmures|chuchotements?|whispers?)\b/.test(folded);
}

function hasVivyNossenStrictNoVoiceSignal(folded = '') {
  return /\b(?:sans\s+voix(?!\s+chante)|aucune?\s+voix(?!\s+chante)|no\s+voice|no\s+voices)\b/.test(folded);
}

function hasVivyNossenAnimalAbsurdFableSignal(folded = '') {
  const animal = /\b(?:grenouille|crapaud|lapin|chat|chien|cheval|tortue|souris|canard|poule|cochon|renard|loup|ours|singe|poisson|escargot|mouton|vache|abeille|fourmi|hamster)\b/.test(folded);
  const humanAction = /\b(?:voulait|veut|rêve|reve|fumer|conduire|voler|rapper|chanter|tricher|mentir|devenir|acheter|vendre|boire|draguer|faire\s+la\s+fete|faire\s+la\s+fête|porter|parler)\b/.test(folded);
  const fableSignal = /\b(?:fable|morale|cachee|cachée|lecon|leçon|absurde|conte|histoire|cartoon|drôle|drole)\b/.test(folded);
  return animal && humanAction && fableSignal;
}

function inferVivyNossenIntentPlan(input = {}) {
  const material = buildVivyNossenIntentMaterial(input);
  const folded = foldTextForLookup(material);
  const noVocal = hasVivyNossenNoVocalSignal(folded);
  const sfx = hasVivyNossenSfxSignal(folded);
  const vocalSong = hasVivyNossenVocalSongSignal(folded);
  const cinematic = hasVivyNossenCinematicSignal(folded);
  const murmurs = hasVivyNossenMurmurSignal(folded);
  const strictNoVoice = hasVivyNossenStrictNoVoiceSignal(folded);
  const fable = hasVivyNossenAnimalAbsurdFableSignal(folded);
  const instrumentalBackingWithVocals = noVocal && vocalSong && !strictNoVoice
    && !/\b(?:sans\s+paroles?|pas\s+de\s+paroles?|aucune?\s+paroles?|sans\s+chant|sans\s+voix|aucune?\s+voix|no\s+vocals?|no\s+lyrics?|no\s+singing)\b/.test(folded);

  if (noVocal && sfx) {
    return {
      intent: 'sound_design_scene',
      confidence: 0.96,
      shouldGenerateLyrics: false,
      shouldUseVocals: false,
      shouldPrioritizeSfx: true,
      sfxPriority: 'high',
      musicPriority: 'medium',
      vocalPolicy: murmurs && !strictNoVoice ? 'distant_indistinct_only' : 'forbid',
      reason: 'La demande impose un rendu instrumental/sans chant avec bruitages ou sound design.',
      generationBrief: 'Créer une scène sonore instrumentale: motifs musicaux, ambiance, bruitages concrets, aucune voix chantée.',
    };
  }
  if (instrumentalBackingWithVocals) {
    return {
      intent: 'vocal_song',
      confidence: 0.88,
      shouldGenerateLyrics: true,
      shouldUseVocals: true,
      shouldPrioritizeSfx: sfx,
      sfxPriority: sfx ? 'medium' : 'none',
      musicPriority: 'high',
      vocalPolicy: 'allow',
      reason: 'La demande parle d’instrumentale comme backing track, mais réclame un freestyle/rap vocal.',
      generationBrief: 'Écrire un freestyle vocal sur une instru marquée, avec paroles, flow et punchlines.',
    };
  }
  if (noVocal) {
    return {
      intent: 'instrumental_music',
      confidence: 0.94,
      shouldGenerateLyrics: false,
      shouldUseVocals: false,
      shouldPrioritizeSfx: sfx,
      sfxPriority: sfx ? 'high' : 'low',
      musicPriority: 'high',
      vocalPolicy: murmurs && !strictNoVoice ? 'distant_indistinct_only' : 'forbid',
      reason: 'La demande demande une production instrumentale ou sans paroles.',
      generationBrief: 'Composer une musique instrumentale structurée autour de l’idée, sans paroles ni chant.',
    };
  }
  if (sfx && !vocalSong) {
    return {
      intent: cinematic ? 'cinematic_hybrid' : 'sound_design_scene',
      confidence: 0.86,
      shouldGenerateLyrics: false,
      shouldUseVocals: false,
      shouldPrioritizeSfx: true,
      sfxPriority: 'high',
      musicPriority: cinematic ? 'medium' : 'low',
      vocalPolicy: murmurs ? 'distant_indistinct_only' : 'forbid',
      reason: 'La demande vise surtout une scène sonore et des bruitages, pas une chanson.',
      generationBrief: 'Construire une scène musicale avec sound design prioritaire, voix absentes ou indistinctes seulement.',
    };
  }
  if (fable) {
    return {
      intent: 'narrative_fable',
      confidence: 0.9,
      shouldGenerateLyrics: true,
      shouldUseVocals: true,
      shouldPrioritizeSfx: false,
      sfxPriority: 'low',
      musicPriority: 'high',
      vocalPolicy: 'allow',
      reason: 'Animal et action humaine absurde indiquent une chanson-fable narrative.',
      generationBrief: 'Écrire une chanson-fable simple avec début, problème, bascule, morale cachée et refrain mémorable.',
    };
  }
  if (vocalSong) {
    return {
      intent: 'vocal_song',
      confidence: 0.82,
      shouldGenerateLyrics: true,
      shouldUseVocals: true,
      shouldPrioritizeSfx: sfx,
      sfxPriority: sfx ? 'medium' : 'none',
      musicPriority: 'high',
      vocalPolicy: 'allow',
      reason: 'La demande contient des marqueurs de chanson vocale.',
      generationBrief: 'Écrire une chanson vocale structurée et chantable, puis composer autour des paroles.',
    };
  }
  return {
    intent: cinematic ? 'cinematic_hybrid' : 'vocal_song',
    confidence: cinematic ? 0.66 : 0.58,
    shouldGenerateLyrics: !cinematic,
    shouldUseVocals: !cinematic,
    shouldPrioritizeSfx: sfx,
    sfxPriority: sfx ? 'medium' : 'none',
    musicPriority: cinematic ? 'high' : 'medium',
    vocalPolicy: cinematic ? 'forbid' : 'allow',
    reason: cinematic
      ? 'La demande ressemble à une scène cinématique plus qu’à une chanson explicite.'
      : 'Aucun signal instrumental ou bruitage fort; chanson vocale par défaut NOSSEN.',
    generationBrief: cinematic
      ? 'Créer une scène cinématique instrumentale hybride, musicale et texturée.'
      : 'Transformer l’idée en chanson vocale originale avec structure claire.',
  };
}

function parseVivyNossenIntentPlan(value = '') {
  const source = cleanText(value, 3000);
  const jsonMatch = source.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: VIVY_NOSSEN_INTENTS.has(String(parsed.intent || '').trim()) ? String(parsed.intent).trim() : '',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
      shouldGenerateLyrics: typeof parsed.shouldGenerateLyrics === 'boolean' ? parsed.shouldGenerateLyrics : undefined,
      shouldUseVocals: typeof parsed.shouldUseVocals === 'boolean' ? parsed.shouldUseVocals : undefined,
      shouldPrioritizeSfx: typeof parsed.shouldPrioritizeSfx === 'boolean' ? parsed.shouldPrioritizeSfx : undefined,
      sfxPriority: VIVY_NOSSEN_SFX_PRIORITIES.has(String(parsed.sfxPriority || '').trim()) ? String(parsed.sfxPriority).trim() : '',
      musicPriority: VIVY_NOSSEN_MUSIC_PRIORITIES.has(String(parsed.musicPriority || '').trim()) ? String(parsed.musicPriority).trim() : '',
      vocalPolicy: VIVY_NOSSEN_VOCAL_POLICIES.has(String(parsed.vocalPolicy || '').trim()) ? String(parsed.vocalPolicy).trim() : '',
      reason: cleanOneLine(parsed.reason, '', 220),
      generationBrief: cleanOneLine(parsed.generationBrief, '', 500),
    };
  } catch (_) {
    return null;
  }
}

function normalizeVivyNossenIntentPlan(plan = {}, fallback = inferVivyNossenIntentPlan({}), input = {}) {
  const normalized = {
    intent: VIVY_NOSSEN_INTENTS.has(String(plan.intent || '').trim()) ? String(plan.intent).trim() : fallback.intent,
    confidence: Math.max(0, Math.min(1, Number(plan.confidence || fallback.confidence || 0.5))),
    shouldGenerateLyrics: typeof plan.shouldGenerateLyrics === 'boolean' ? plan.shouldGenerateLyrics : fallback.shouldGenerateLyrics,
    shouldUseVocals: typeof plan.shouldUseVocals === 'boolean' ? plan.shouldUseVocals : fallback.shouldUseVocals,
    shouldPrioritizeSfx: typeof plan.shouldPrioritizeSfx === 'boolean' ? plan.shouldPrioritizeSfx : fallback.shouldPrioritizeSfx,
    sfxPriority: VIVY_NOSSEN_SFX_PRIORITIES.has(String(plan.sfxPriority || '').trim()) ? String(plan.sfxPriority).trim() : fallback.sfxPriority,
    musicPriority: VIVY_NOSSEN_MUSIC_PRIORITIES.has(String(plan.musicPriority || '').trim()) ? String(plan.musicPriority).trim() : fallback.musicPriority,
    vocalPolicy: VIVY_NOSSEN_VOCAL_POLICIES.has(String(plan.vocalPolicy || '').trim()) ? String(plan.vocalPolicy).trim() : fallback.vocalPolicy,
    reason: cleanOneLine(plan.reason || fallback.reason, fallback.reason || 'Intention Vivy/NOSSEN déduite.', 220),
    generationBrief: cleanOneLine(plan.generationBrief || fallback.generationBrief, fallback.generationBrief || 'Production NOSSEN adaptée à la demande.', 500),
  };

  const material = buildVivyNossenIntentMaterial(input);
  const folded = foldTextForLookup(material);
  const primaryFolded = foldTextForLookup(buildVivyNossenPrimaryIntentMaterial(input));
  const noVocal = hasVivyNossenNoVocalSignal(folded);
  const primaryNoVocal = hasVivyNossenNoVocalSignal(primaryFolded);
  const sfx = hasVivyNossenSfxSignal(folded);
  const primarySfx = hasVivyNossenSfxSignal(primaryFolded);
  const murmurs = hasVivyNossenMurmurSignal(folded);
  const strictNoVoice = hasVivyNossenStrictNoVoiceSignal(folded);
  const vocalSong = hasVivyNossenVocalSongSignal(folded);
  const primaryVocalSong = hasVivyNossenVocalSongSignal(primaryFolded);
  const fable = hasVivyNossenAnimalAbsurdFableSignal(folded);
  const planVocalEvidence = hasVivyNossenVocalSongSignal(foldTextForLookup([
    plan.reason,
    plan.generationBrief,
  ].filter(Boolean).join('\n')));
  const explicitNoLyrics = /\b(?:sans\s+paroles?|pas\s+de\s+paroles?|aucune?\s+paroles?|sans\s+chant|sans\s+voix|aucune?\s+voix|no\s+vocals?|no\s+lyrics?|no\s+singing)\b/.test(primaryFolded);
  const instrumentalBackingWithVocals = primaryNoVocal && primaryVocalSong && !explicitNoLyrics && !strictNoVoice;
  const strongVocalIntent = !explicitNoLyrics && !strictNoVoice && (primaryVocalSong || fable || planVocalEvidence || instrumentalBackingWithVocals);

  if ((primaryNoVocal && !instrumentalBackingWithVocals) || (noVocal && !strongVocalIntent)) {
    normalized.intent = sfx ? 'sound_design_scene' : 'instrumental_music';
    normalized.shouldGenerateLyrics = false;
    normalized.shouldUseVocals = false;
    normalized.vocalPolicy = murmurs && !strictNoVoice ? 'distant_indistinct_only' : 'forbid';
    normalized.sfxPriority = sfx ? 'high' : normalized.sfxPriority === 'none' ? 'low' : normalized.sfxPriority;
    normalized.shouldPrioritizeSfx = sfx || normalized.shouldPrioritizeSfx;
    normalized.musicPriority = normalized.musicPriority === 'low' ? 'medium' : normalized.musicPriority;
    normalized.confidence = Math.max(normalized.confidence, sfx ? 0.96 : 0.94);
  } else if (sfx && !vocalSong && !strongVocalIntent) {
    normalized.intent = normalized.intent === 'instrumental_music' ? 'cinematic_hybrid' : normalized.intent;
    if (!['sound_design_scene', 'cinematic_hybrid'].includes(normalized.intent)) normalized.intent = 'sound_design_scene';
    normalized.shouldGenerateLyrics = false;
    normalized.shouldUseVocals = false;
    normalized.shouldPrioritizeSfx = true;
    normalized.sfxPriority = 'high';
    normalized.vocalPolicy = murmurs ? 'distant_indistinct_only' : 'forbid';
    normalized.confidence = Math.max(normalized.confidence, 0.86);
  } else if (fable) {
    normalized.intent = 'narrative_fable';
    normalized.shouldGenerateLyrics = true;
    normalized.shouldUseVocals = true;
    normalized.vocalPolicy = 'allow';
    normalized.confidence = Math.max(normalized.confidence, 0.9);
  } else if ((vocalSong || strongVocalIntent) && !primaryNoVocal) {
    normalized.shouldGenerateLyrics = true;
    normalized.shouldUseVocals = true;
    normalized.vocalPolicy = 'allow';
    if (!['narrative_fable', 'vocal_song'].includes(normalized.intent)) normalized.intent = 'vocal_song';
  }

  if (strongVocalIntent && !primaryNoVocal) {
    normalized.shouldGenerateLyrics = true;
    normalized.shouldUseVocals = true;
    normalized.vocalPolicy = 'allow';
    if (!['narrative_fable', 'vocal_song'].includes(normalized.intent)) normalized.intent = fable ? 'narrative_fable' : 'vocal_song';
    if (primarySfx && normalized.sfxPriority === 'none') normalized.sfxPriority = 'medium';
    if (/instrumental|sans\s+paroles?|sans\s+chant|no\s+vocals?|no\s+lyrics?/i.test(`${plan.intent || ''} ${plan.reason || ''}`)) {
      normalized.reason = cleanOneLine(
        `Correction cohérence: la demande principale réclame une chanson vocale; ${normalized.reason}`,
        normalized.reason,
        220
      );
    }
  }

  if (normalized.shouldGenerateLyrics === false) normalized.shouldUseVocals = false;
  if (normalized.shouldUseVocals === false && normalized.vocalPolicy === 'allow') normalized.vocalPolicy = 'forbid';
  return normalized;
}

async function buildVivyNossenIntentPlan(input = {}, req = null) {
  const material = buildVivyNossenIntentMaterial(input);
  if (!material) {
    const error = new Error('vivy_nossen_intent_material_required');
    error.code = 'vivy_nossen_intent_material_required';
    error.status = 400;
    throw error;
  }
  const fallback = inferVivyNossenIntentPlan(input);
  if (input.skipLlm === true || String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true') {
    return {
      ok: true,
      ...normalizeVivyNossenIntentPlan(fallback, fallback, input),
      provider: 'deterministic',
      model: 'vivy-intent-rules',
    };
  }
  const userId = resolveVivyMemoryUser(req, input);
  if (!userId) {
    const error = new Error('vivy_auth_required');
    error.code = 'vivy_auth_required';
    error.status = 401;
    throw error;
  }
  const llmBundles = createVivyOpenAIClients({ mode: 'song', purpose: 'intent' });
  if (!llmBundles.length) {
    return {
      ok: true,
      ...normalizeVivyNossenIntentPlan(fallback, fallback, input),
      provider: 'deterministic',
      model: 'vivy-intent-rules',
    };
  }
  const systemPrompt = [
    'Tu es Vivy Intent Router, l’étape avant EX44 et Suno.',
    'Ta tâche: décider si la demande veut une chanson vocale, une musique instrumentale, une scène sonore, un hybride cinématique, ou une chanson-fable.',
    'Ne te base pas seulement sur des mots comme refrain puissant ou ambiance: décide d’abord si l’utilisateur veut des paroles/voix, de la musique instrumentale, ou une scène sonore.',
    'Règles fortes:',
    '1. Si instrumental, sans paroles, sans chant, no vocals ou no lyrics sont présents: shouldGenerateLyrics=false, shouldUseVocals=false, vocalPolicy=forbid, intent instrumental_music ou sound_design_scene.',
    '2. Si bruitages, SFX, foley, sound design, scène sonore ou ambiance sonore sont présents: shouldPrioritizeSfx=true, sfxPriority=high, shouldGenerateLyrics=false, intent sound_design_scene ou cinematic_hybrid.',
    '3. Si murmures est présent dans une demande instrumentale/sound design: ne le transforme pas en chant; utilise vocalPolicy=distant_indistinct_only sauf interdiction totale de voix.',
    '4. Si chanson, refrain, couplet, duo, voix masculine/féminine ou paroles sont présents sans interdiction vocale: chanson vocale ou fable, paroles nécessaires.',
    '5. Si animal + action humaine absurde + morale implicite: narrative_fable, paroles nécessaires.',
    'Réponds uniquement en JSON strict avec les clés: intent, confidence, shouldGenerateLyrics, shouldUseVocals, shouldPrioritizeSfx, sfxPriority, musicPriority, vocalPolicy, reason, generationBrief.',
    'Valeurs intent: vocal_song | instrumental_music | sound_design_scene | cinematic_hybrid | narrative_fable.',
    'Valeurs sfxPriority: none | low | medium | high. Valeurs musicPriority: low | medium | high. Valeurs vocalPolicy: allow | forbid | distant_indistinct_only.',
  ].join('\n');
  try {
    const completionResult = await createVivyChatCompletion(llmBundles, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: material },
      ],
      temperature: 0.16,
      max_tokens: 520,
    });
    const raw = cleanText(completionResult.completion?.choices?.[0]?.message?.content, 3000);
    const parsed = parseVivyNossenIntentPlan(raw);
    const plan = normalizeVivyNossenIntentPlan(parsed || fallback, fallback, input);
    return {
      ok: true,
      ...plan,
      provider: completionResult.bundle.provider || getVivyProviderFromBaseUrl(completionResult.bundle.baseURL || ''),
      model: completionResult.bundle.model,
    };
  } catch (error) {
    const plan = normalizeVivyNossenIntentPlan(fallback, fallback, input);
    return {
      ok: true,
      ...plan,
      provider: 'deterministic',
      model: 'vivy-intent-rules',
      warning: cleanOneLine(error?.message || error, '', 180),
    };
  }
}

function parseVivyNossenRoutingPlan(value = '') {
  const source = cleanText(value, 2400);
  const jsonMatch = source.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const allowedArtists = new Set(['djeff', 'marvin', 'vivy', 'a11', 'k44']);
    const artists = (Array.isArray(parsed.artists) ? parsed.artists : [])
      .map((artist) => foldTextForLookup(artist))
      .map((artist) => artist === 'kaen44' ? 'k44' : artist)
      .filter((artist, index, list) => allowedArtists.has(artist) && list.indexOf(artist) === index)
      .slice(0, 4);
    const songMood = cleanOneLine(parsed.songMood || parsed.style || parsed.sonicDirection, '', 520);
    const limitedArtists = limitVivyNossenRoutingArtists(artists);
    if (!limitedArtists.length || songMood.length < 12) return null;
    return { artists: limitedArtists, songMood };
  } catch (_) {
    return null;
  }
}

function inferVivyNossenRoutingPlan(input = {}) {
  const material = cleanText([
    input.canvas,
    input.songText,
    input.message,
    input.notes,
  ].filter(Boolean).join('\n\n'), VIVY_SONG_MAX_CHARS);
  const folded = foldTextForLookup(material);
  const artists = [];
  const pushArtist = (artist) => {
    if (!artist || artists.includes(artist)) return;
    artists.push(artist);
  };

  const explicitVivy = /\bvivy\b/.test(folded)
    && /\b(?:chante|chant|voix|solo|refrain|melodique|mélodique|feminin|féminin)\b/.test(folded);
  const explicitDjeff = /\bdjeff\b/.test(folded)
    || /\b(?:rap|freestyle|punchlines?|egotrip|micro|flow|rimes?|cypher|battle|clash|competition|compétition|concurrence|rival|rivaux|veulent ma peau|ma peau|encore en tuto)\b/.test(folded);
  const explicitK44 = /\bk44\b|\bkaen44\b|\bgrave\b|\bnarration\b|\bcinematique\b|\bcinématique\b/.test(folded);
  const explicitA11 = /\ba11\b|\belectro\b|\bélectro\b|\bsynthwave\b|\btechno\b|\bglitch\b/.test(folded);

  if (explicitDjeff) pushArtist('djeff');
  if (explicitVivy) pushArtist('vivy');
  if (!artists.length && explicitK44) pushArtist('k44');
  if (!artists.length && explicitA11) pushArtist('a11');
  if (!artists.length) {
    pushArtist('djeff');
    pushArtist('vivy');
  }

  const moodParts = [];
  if (/\b(?:freestyle|punchlines?|egotrip|micro|flow|rimes?)\b/.test(folded)) {
    moodParts.push('rap freestyle français nerveux');
    moodParts.push('flow technique, punchlines fréquentes, rimes internes');
  } else if (hasVivyNossenConflictRapSignal(material)) {
    moodParts.push('rap français egotrip/cypher sombre');
    moodParts.push('voix masculine sèche, punchlines de clash, drums secs, basse lourde');
  } else if (/\brap\b/.test(folded)) {
    moodParts.push('rap français moderne');
    moodParts.push('kick sec, basse lourde, couplets rythmés');
  }
  if (/\b(?:geek|gaming|jeu\s+video|jeux\s+video|console|manette|manettes|pixel|cyber|ordinateur|clavier)\b/.test(folded)) {
    moodParts.push('thème geek nocturne, textures arcade, synthés 8-bit discrets');
  }
  if (/\b(?:flute|flûte|percussions?|drums?|tambours?)\b/.test(folded)) {
    moodParts.push('flûtes et percussions/drums en contrepoint');
  }
  if (/\b(?:hardcore|gabber|thunderdome|rave)\b/.test(folded)) {
    moodParts.push('hardcore techno gabber oldschool 175 BPM, kicks distordus, warehouse sombre');
  }
  if (/\b(?:epique|épique|heroique|héroïque)\b/.test(folded)) {
    moodParts.push('montée héroïque sans devenir orchestral générique');
  }
  if (!moodParts.length) {
    moodParts.push('chanson NOSSEN moderne, identité sonore précise, groove clair, refrain mémorable');
  }

  return {
    artists: limitVivyNossenRoutingArtists(artists),
    songMood: joinVivyNossenRoutingMoodParts(moodParts, 520),
  };
}

function hasVivyNossenHistoricalFrescoSignal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:fresque historique|histoire de l humanite|histoire collective|a travers les ages|à travers les âges|au fil des siecles|au fil des siècles|civilisations?|empires?|batailles?|revolutions?|révolutions?|decouvertes?|découvertes?|antiquite|antiquité|moyen age|renaissance|siecles|siècles)\b/.test(folded);
}

function hasVivyNossenExplicitK44Signal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:k44|kaen44)\b/.test(folded)
    || /\b(?:voix|narration|narrateur|conteur|contrechant|timbre)\b.{0,40}\b(?:grave|pose|posé|cinematique|cinématique|k44|kaen44)\b/.test(folded)
    || /\b(?:grave|pose|posé|cinematique|cinématique|k44|kaen44)\b.{0,40}\b(?:voix|narration|narrateur|conteur|contrechant|timbre)\b/.test(folded);
}

function hasVivyNossenRomanceSignal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:amour|romance|romantique|coeur|cœur|je t aime|i love you|couple|rupture|baiser|fleurs?|jardin|sentiments?)\b/.test(folded);
}

function hasVivyNossenConflictRapSignal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:competition|compétition|concurrence|rival|rivaux|clash|battle|cypher|beef|tuto|tutoriel|veulent ma peau|ma peau|ils veulent|ils sont encore en tuto)\b/.test(folded);
}

function hasVivyNossenExplicitEnglishSignal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:anglais|anglaise|english|en anglais|lyrics english|english lyrics|bilingue|bilingual|us rap|uk rap)\b/.test(folded);
}

function hasVivyNossenInstrumentalSignal(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  return /\b(?:instrumental|sans paroles|sans chant|no vocals|no lyrics|bruitages?|sfx|foley|sound design)\b/.test(folded);
}

function sanitizeVivyNossenRoutingPlanForRequest(plan = {}, material = '', fallback = null) {
  const fallbackPlan = fallback && fallback.songMood
    ? fallback
    : strengthenVivyNossenRoutingPlan(inferVivyNossenRoutingPlan({ message: material }), material);
  const request = foldTextForLookup(material);
  const mood = cleanOneLine(plan?.songMood, '', 520);
  const moodFolded = foldTextForLookup(mood);
  let artists = limitVivyNossenRoutingArtists(plan?.artists || []);
  let songMood = mood || fallbackPlan.songMood;

  const bogusHistoricalMood = /\b(?:fresque historique|historique collective?|instrumentation evolutive|instrumentation évolutive|dynamique epique|dynamique épique|narration grave|au fil des siecles|a travers les ages)\b/.test(moodFolded)
    && !hasVivyNossenHistoricalFrescoSignal(material);
  if (bogusHistoricalMood) {
    artists = fallbackPlan.artists;
    songMood = fallbackPlan.songMood;
  }

  const k44SoloWithoutSignal = artists.length === 1
    && artists[0] === 'k44'
    && !hasVivyNossenExplicitK44Signal(material);
  if (k44SoloWithoutSignal) {
    artists = fallbackPlan.artists?.length ? fallbackPlan.artists : ['djeff', 'vivy'];
  }

  const genericEpicWithoutRequest = /\b(?:orchestral|symphonique|classique|cinematique|cinématique|epique|épique|heroique|héroïque)\b/.test(foldTextForLookup(songMood))
    && !/\b(?:orchestral|symphonique|classique|cinematique|cinématique|epique|épique|heroique|héroïque|film|bande annonce|trailer)\b/.test(request);
  if (genericEpicWithoutRequest) {
    songMood = fallbackPlan.songMood || 'rap français NOSSEN moderne, groove clair, refrain mémorable';
  }

  const bogusRomanticMood = /\b(?:pop romantic|pop romantique|ballade romantique|romance|love song|piano doux|cordes chaudes|voix proche)\b/.test(foldTextForLookup(songMood))
    && (!hasVivyNossenRomanceSignal(material) || hasVivyNossenConflictRapSignal(material));
  if (bogusRomanticMood) {
    artists = fallbackPlan.artists?.length ? fallbackPlan.artists : artists;
    songMood = fallbackPlan.songMood || 'rap français egotrip/cypher sombre, voix masculine sèche, punchlines de clash, drums secs, basse lourde';
  }

  if (!artists.length) artists = ['djeff', 'vivy'];
  if (!songMood) songMood = 'rap français NOSSEN moderne, groove clair, refrain mémorable';
  if (!hasVivyNossenInstrumentalSignal(material) && !hasVivyNossenExplicitEnglishSignal(material)) {
    songMood = joinVivyNossenRoutingMoodParts([
      songMood,
      'paroles françaises uniquement',
      'voix en français',
      'aucun refrain anglais',
    ], 520);
  }
  return {
    ...plan,
    artists: limitVivyNossenRoutingArtists(artists),
    songMood: joinVivyNossenRoutingMoodParts([songMood], 520),
  };
}

function limitVivyNossenRoutingArtists(artists = []) {
  const selected = (Array.isArray(artists) ? artists : [])
    .map((artist) => foldTextForLookup(artist))
    .map((artist) => artist === 'kaen44' ? 'k44' : artist)
    .filter((artist, index, list) => ['djeff', 'marvin', 'vivy', 'a11', 'k44'].includes(artist) && list.indexOf(artist) === index);
  if (!selected.length) return [];
  if (selected.length === 1) return selected;
  if (selected.includes('djeff') && selected.includes('a11') && !selected.includes('vivy')) return ['djeff', 'vivy'];
  if (selected.length <= 2) return selected;
  if (selected.includes('vivy')) {
    if (selected.includes('djeff')) return ['djeff', 'vivy'];
    if (selected.includes('marvin')) return ['marvin', 'vivy'];
    const partner = ['djeff', 'a11', 'k44'].find((artist) => selected.includes(artist));
    return partner ? ['vivy', partner] : ['vivy'];
  }
  if (selected.includes('djeff')) return ['djeff', 'vivy'];
  if (selected.includes('marvin')) return ['marvin', 'vivy'];
  return selected.slice(0, 2);
}

function joinVivyNossenRoutingMoodParts(parts = [], max = 520) {
  const kept = [];
  const seen = new Set();
  for (const part of parts) {
    for (const rawChunk of String(part || '').split(/\s*,\s*/)) {
      const chunk = cleanOneLine(rawChunk, '', 120);
      const key = foldTextForLookup(chunk);
      if (!chunk || seen.has(key)) continue;
      kept.push(chunk);
      seen.add(key);
    }
  }
  return cleanOneLine(kept.join(', '), '', max);
}

function hasVivyNossenYouthNatureAdventure(material = '') {
  const folded = foldTextForLookup(material);
  if (!folded) return false;
  const youthSignal = /\b(?:yakari|dessin\s+anime|dessin\s+animee|generique\s+tv|jeunesse|enfant|enfants|cartoon\s+familial|petit\s+cavalier|cavalier)\b/.test(folded);
  const horseSignal = /\b(?:cheval|chevaux|poney|cavalier|galop|plaines?|prairies?)\b/.test(folded);
  const natureSignal = /\b(?:nature|riviere|rivière|plaines?|prairies?|grand\s+ciel|aigle|animaux|foret|forêt|vent|herbe)\b/.test(folded);
  return youthSignal && horseSignal && natureSignal;
}

function strengthenVivyNossenRoutingPlan(plan = {}, material = '') {
  if (!plan || !plan.songMood) return plan;
  const mood = cleanOneLine(plan.songMood, '', 520);
  const anchors = [];
  if (hasVivyNossenYouthNatureAdventure(material)) {
    anchors.push(
      'générique TV jeunesse aventure nature, flûte légère lead, percussions tribales douces, guitare acoustique, galop léger, textures rivière vent grand ciel, refrain enfantin très chantable'
    );
  }
  if (!anchors.length) return { ...plan, songMood: mood };
  const lessGenericMood = mood
    .replace(/\b(?:pop\s+cartoon\s+familial\s+joyeux|cartoon\s+familial\s+joyeux|pop\s+familial\s+joyeux)\b,?\s*/gi, '')
    .trim();
  return {
    ...plan,
    songMood: joinVivyNossenRoutingMoodParts([...anchors, lessGenericMood || mood], 520),
  };
}

function enforceVivyNossenVoiceSemantics(plan = {}, material = '') {
  if (!plan || !Array.isArray(plan.artists) || !plan.artists.length) return plan;
  const request = foldTextForLookup(String(material || '')
    .replace(/^\s*!(?:vivy|nossen|chanson|song|th[eè]me|idee|idée)\b[\s:,-]*/i, ''));
  const explicitVivyVoice = /\b(?:voix|chant|chanteuse|solo|duo|refrain)\b.{0,28}\bvivy\b/.test(request)
    || /\bvivy\b.{0,28}\b(?:chante|chant|voix|solo|duo|refrain)\b/.test(request);
  if (explicitVivyVoice) return plan;

  const hasMaleLead = /\b(?:homme|garcon|garçon|pere|père|frere|frère|mari|plombier|cowboy|sherif|shérif|chevalier|roi|barman|pilote|motard|marvin|djeff)\b/.test(request);
  const hasFemaleLead = /\b(?:femme|fille|mere|mère|soeur|sœur|epouse|épouse|cliente|aubergiste|reine|princesse|chanteuse)\b/.test(request);
  if (!hasMaleLead || !plan.artists.includes('vivy')) return plan;

  if (hasFemaleLead) {
    return { ...plan, artists: ['djeff', 'vivy'] };
  }
  const graveNarration = /\b(?:grave|cinematique|cinématique|narratif|narrative|western|polar|film noir)\b/.test(
    foldTextForLookup(plan.songMood || '')
  );
  return { ...plan, artists: [graveNarration ? 'k44' : 'djeff'] };
}

async function buildVivyNossenRoutingPlan(input = {}, req = null) {
  const userId = resolveVivyMemoryUser(req, input);
  if (!userId) {
    const error = new Error('vivy_auth_required');
    error.code = 'vivy_auth_required';
    error.status = 401;
    throw error;
  }
  const material = cleanText([
    input.canvas,
    input.songText,
    input.message,
    input.notes ? `Direction demandée: ${input.notes}` : '',
  ].filter(Boolean).join('\n\n'), VIVY_SONG_MAX_CHARS);
  if (!material) {
    const error = new Error('vivy_nossen_canvas_required');
    error.code = 'vivy_nossen_canvas_required';
    error.status = 400;
    throw error;
  }
  const fallbackPlan = enforceVivyNossenVoiceSemantics(
    sanitizeVivyNossenRoutingPlanForRequest(
      strengthenVivyNossenRoutingPlan(inferVivyNossenRoutingPlan(input), material),
      material
    ),
    material
  );
  const sessionContext = resolveVivyInputSession(input);
  const llmBundles = createVivyOpenAIClients({ mode: 'song', purpose: 'routing' });
  const routeLlmEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.VIVY_NOSSEN_ROUTE_LLM_ENABLED || 'false').trim().toLowerCase()
  );
  const llmDisabled = String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true';
  if (!routeLlmEnabled || !llmBundles.length || llmDisabled) {
    const warning = (llmDisabled || !llmBundles.length)
      ? 'vivy_song_llm_unavailable'
      : 'vivy_nossen_fast_route';
    console.info(
      '[vivy-nossen-route] session=%s provider=deterministic model=vivy-routing-rules artists=%s mood=%s warning=%s',
      sessionContext.sessionId,
      fallbackPlan.artists.join('+'),
      fallbackPlan.songMood,
      warning
    );
    return {
      ok: true,
      ...fallbackPlan,
      model: 'vivy-routing-rules',
      provider: 'deterministic',
      warning,
    };
  }
  const systemPrompt = [
    'Tu es le routeur musical NOSSEN.',
    'Analyse la matière sans écrire de paroles.',
    'Choisis un ou deux chanteurs maximum parmi djeff, marvin, vivy, a11, k44. Ne propose jamais de trio ou quatuor pour NOSSEN.',
    'Le mot !vivy est le nom d’une commande Twitch, pas une demande de voix Vivy. Il ne doit jamais influencer le casting.',
    'Djeff porte le rap rugueux et rythmique; Vivy le chant mélodique expressif; A11 les couleurs électroniques précises; K44 les lignes graves cinématiques et narratives.',
    'Évite le duo Djeff + A11: leurs timbres sont trop proches pour Suno; si tu hésites, garde Vivy comme contraste mélodique.',
    'Un refrain mélodique ne force jamais Vivy. Choisis d’abord la voix qui incarne le personnage, le genre et le point de vue; Vivy n’est lead que si cette couleur féminine expressive sert réellement la demande.',
    'Pour un protagoniste masculin nommé ou un métier masculin central, choisis Djeff ou K44; pour un dialogue homme-femme, choisis un duo contrasté. Ne choisis K44 que si la matière demande réellement une narration grave ou un contre-chant posé.',
    'Ne remplace jamais une voix mélodique par deux voix graves ou synthétiques.',
    'Choisis une direction sonore spécifique au sujet et à son médium: genre contemporain, tempo ressenti, instruments concrets, groove, texture, dynamique et arrangement vocal.',
    'Si la matière demande explicitement instrumental, sans paroles, bruitages, SFX, foley ou sound design: garde artists avec une seule valeur de compatibilité mais songMood doit être instrumental pur, sans refrain chanté, sans voix, avec bruitages/ambiances concrets.',
    'Pour dessin animé jeunesse avec cheval, plaines, rivière, aigle, animaux ou nature: ne réponds pas “pop cartoon familial” seul; impose flûte légère, percussions tribales douces, guitare acoustique, galop léger, textures de rivière/vent/grand ciel et refrain enfantin très chantable.',
    'Pour Bleach, anime, manga ou shonen: choisis un opening J-rock/J-pop rock nerveux, guitares et batterie rapide; jamais variété française, chanson acoustique ou ballade type Patrick Bruel.',
    'Pour moto, visière, casque, guidon, fuite, 5 étoiles, gyros ou hélicos: choisis rap français trap sombre, 808 lourdes, sirènes, adlibs, refrain court, énergie poursuite nocturne NOSSEN; jamais “au volant” si la matière dit moto.',
    'En français, distingue « raconter une histoire » d’une chanson sur l’Histoire. Les expressions « à travers les âges », « au fil des siècles », « histoire de l’humanité », civilisations, empires, batailles, révolutions ou découvertes désignent une fresque historique collective.',
    'Pour une fresque historique collective, ne recentre jamais la demande sur une personne seule dans une chambre, une confession intime, une rupture ou une romance. Fais évoluer les époques, les peuples, les instruments et la dynamique.',
    'Sans demande explicite, évite les réflexes orchestral, cinématique, épique, symphonique ou classique. Cherche une identité moderne, rythmique et immédiatement reconnaissable.',
    'Réponds uniquement en JSON avec les clés artists (tableau) et songMood (chaîne).',
  ].join('\n');
  let completionResult = null;
  let raw = '';
  let plan = null;
  try {
    completionResult = await createVivyChatCompletion(llmBundles, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: material },
      ],
      temperature: 0.72,
      max_tokens: 500,
    }, {
      deadlineAt: Date.now() + Math.max(5000, Number(process.env.VIVY_NOSSEN_ROUTE_LLM_BUDGET_MS || 25000) || 25000),
      localAttemptTimeoutMs: Math.max(1000, Number(process.env.VIVY_NOSSEN_ROUTER_LOCAL_TIMEOUT_MS || 20000) || 20000),
      attemptTimeoutMs: 8000,
    });
    raw = cleanText(completionResult.completion?.choices?.[0]?.message?.content, 2400);
    plan = parseVivyNossenRoutingPlan(raw);
  } catch (error) {
    console.warn(
      '[vivy-nossen-route] session=%s provider=deterministic model=vivy-routing-rules artists=%s mood=%s warning=%s',
      sessionContext.sessionId,
      fallbackPlan.artists.join('+'),
      fallbackPlan.songMood,
      cleanOneLine(error?.code || error?.message || error, 'llm_failed', 160)
    );
    return {
      ok: true,
      ...fallbackPlan,
      model: 'vivy-routing-rules',
      provider: 'deterministic',
      warning: cleanOneLine(error?.code || error?.message || error, 'llm_failed', 160),
    };
  }
  if (!plan) {
    console.warn(
      '[vivy-nossen-route] session=%s provider=deterministic model=vivy-routing-rules artists=%s mood=%s warning=invalid_llm_json raw=%s',
      sessionContext.sessionId,
      fallbackPlan.artists.join('+'),
      fallbackPlan.songMood,
      cleanOneLine(raw, '', 220)
    );
    return {
      ok: true,
      ...fallbackPlan,
      model: 'vivy-routing-rules',
      provider: 'deterministic',
      warning: 'vivy_nossen_routing_invalid',
    };
  }
  const strengthenedPlan = enforceVivyNossenVoiceSemantics(
    sanitizeVivyNossenRoutingPlanForRequest(
      strengthenVivyNossenRoutingPlan(plan, material),
      material,
      fallbackPlan
    ),
    material
  );
  console.info(
    '[vivy-nossen-route] session=%s provider=%s model=%s artists=%s mood=%s',
    sessionContext.sessionId,
    completionResult.bundle.provider || getVivyProviderFromBaseUrl(completionResult.bundle.baseURL || ''),
    completionResult.bundle.model,
    strengthenedPlan.artists.join('+'),
    strengthenedPlan.songMood
  );
  return {
    ok: true,
    ...strengthenedPlan,
    model: completionResult.bundle.model,
    provider: completionResult.bundle.provider || getVivyProviderFromBaseUrl(completionResult.bundle.baseURL || ''),
  };
}

function buildVivyDirectSongReply(input = {}) {
  const completeLyrics = [input.message, input.songText, input.lyrics, input.text]
    .find((value) => looksLikeCompleteLyrics(value));
  if (completeLyrics) {
    return buildVivyStructuredLyrics({ ...input, songText: completeLyrics });
  }
  const historyText = getVivySongHistoryText(input.history, input.message || input.prompt || input.songText || input.text);
  const material = stripVivyAscii4SoundTokens(compactUniqueLines([
    historyText,
    input.message,
    input.prompt,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
  ], VIVY_SONG_MAX_CHARS));
  const cleanMaterial = sanitizeVivySongMaterial(material, VIVY_SONG_MAX_CHARS);
  const voiceProfile = getVivyStudioVoiceProfile({ ...input, songText: cleanMaterial || material || input.songText || input.message });
  const songcraft = buildVivySongProductionBrief({
    ...input,
    songText: cleanMaterial || material || input.songText || input.message,
    rhymeScheme: input.rhymeScheme || 'Fins de lignes rimées par paires, détails tirés de la demande, refrain stable et chantable.',
  });
  const lyrics = cleanText(songcraft.lyrics.replace(/^\[Title:\s*[^\]]+\]\s*/i, '').trim(), 4200);
  const foldedSongSubject = foldTextForLookup(cleanMaterial || material || input.songText || input.message || '');
  const hasMechanicalSubject = /\b(moto|scooter|booster|moteur|radiateur|pignon|couronne|chaine|chaîne|huile|essence|pot|guidon|casque|pneu|pneus|gomme|wheeling|stunt|rossi|motogp|moto\s*gp)\b/.test(foldedSongSubject);
  const intention = voiceProfile.id === 'duo-djeff-vivy'
    ? (hasMechanicalSubject
      ? 'duo rap Djeff + Vivy, mécanique moto concrète, couplets techniques et refrain chantable.'
      : 'duo rap Djeff + Vivy, couplets techniques, images du sujet fourni et refrain chantable.')
    : voiceProfile.id === 'djeff-rap'
      ? (hasMechanicalSubject
        ? 'voix Djeff officielle, mécanique précise, débit serré et refrain prêt à répondre avec Vivy.'
        : 'voix Djeff officielle, débit serré, rimes internes et images du sujet fourni.')
      : 'écriture centrée sur le sujet fourni, progression claire et refrain chantable.';
  return cleanText([
    `**Titre :** ${songcraft.title}`,
    `**Intention :** ${intention}`,
    '',
    lyrics,
    '',
    `**Rimes / débit :** ${songcraft.rhymeScheme}`,
  ].join('\n'), VIVY_SONG_MAX_CHARS);
}

function normalizeVivyCapabilityText(value = '') {
  return foldTextForLookup(value)
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVivyHistoryText(history = []) {
  if (!Array.isArray(history)) return '';
  return history
    .slice(-12)
    .map((entry) => cleanText(entry?.content, 620))
    .filter(Boolean)
    .join('\n');
}

function getVivyUserHistoryText(history = []) {
  if (!Array.isArray(history)) return '';
  return history
    .filter((entry) => String(entry?.role || '').toLowerCase() !== 'assistant')
    .slice(-VIVY_USER_HISTORY_MAX_MESSAGES)
    .map((entry) => cleanText(entry?.content, VIVY_USER_HISTORY_ENTRY_MAX_CHARS))
    .filter(Boolean)
    .join('\n');
}

function isVivySongHistoryContinuationRequest(message = '') {
  const folded = foldTextForLookup(message);
  if (!folded) return false;
  if (isShortVivyAcknowledgement(message)) return true;
  if (/\b(continue|continuer|reprends|reprendre|poursuis|poursuivre|complete|complète|termine|encha[îi]ne|encha[îi]ner|suite|reste|prolonge|extension)\b/.test(folded)) {
    return true;
  }
  const hasAction = /\b(mets|met|mettre|transforme|arrange|structure|raconte|fais|fait|compose|ecris|écris|genere|génère|envoie|envois|donne|sort|lance|prepare|prépare|reprend)\b/.test(folded);
  const hasReference = /\b(ca|ça|ce|cette|ces|ses|son|sa|lui|elle|il|eux|leur|leurs|celle|celui|precedent|précédent|avant|dernier|derniere|dernière)\b/.test(folded);
  if (hasAction && hasReference) return true;
  return /^(oui|ok|okay|vas y|vasy|go|allez|parfait|grave)\b/.test(folded)
    && /\b(chanson|musique|son|paroles|lyrics|theme|thème|ambiance|style|voix)\b/.test(folded);
}

function cleanVivySongHistoryEntry(content = '') {
  const cleaned = sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(cleanText(content, VIVY_USER_HISTORY_ENTRY_MAX_CHARS), VIVY_USER_HISTORY_ENTRY_MAX_CHARS),
    VIVY_USER_HISTORY_ENTRY_MAX_CHARS
  );
  return cleanText(cleaned, VIVY_USER_HISTORY_ENTRY_MAX_CHARS);
}

function normalizeVivySongHistoryForPrompt(history = [], currentMessage = '') {
  if (!isVivySongHistoryContinuationRequest(currentMessage)) return [];
  return normalizeVivyChatHistory(history)
    .filter((entry) => String(entry?.role || '').toLowerCase() !== 'assistant')
    .map((entry) => {
      const content = cleanVivySongHistoryEntry(entry?.content || '');
      return content ? { role: 'user', content } : null;
    })
    .filter(Boolean)
    .slice(-4);
}

function getVivySongHistoryText(history = [], currentMessage = '', max = VIVY_SONG_HISTORY_MAX_CHARS) {
  return compactUniqueLines(
    normalizeVivySongHistoryForPrompt(history, currentMessage).map((entry) => entry.content),
    max
  );
}

function isVivyMcpNeo4jQuestion(input = {}, message = '') {
  if (looksLikeCompleteLyrics(message)) return false;
  const current = normalizeVivyCapabilityText(message);
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  if (!current) return false;
  if (isVivyMcpCodexRelayRequest(message)) return false;

  const mentionsMcp = /\bmcp\b|model context protocol/.test(current);
  const mentionsNeo4j = /\bneo4j\b|\bcypher\b|\bgraphe\b|\bgraph\b/.test(current);
  const recentMentionsNeo4j = /\bneo4j\b|\bcypher\b|\bgraphe\b|\bgraph\b/.test(recent);
  if (!mentionsMcp && !mentionsNeo4j) return false;

  if (/^avec\s+le\s+mcp\b/.test(current) && recentMentionsNeo4j) return true;
  return /(acces|access|connect|branche|relie|utilise|utiliser|outil|tools?|peux|peut|sais|apprend|apprendre|comment|requete|query|chercher|lire|consulter|\?)/.test(current);
}

function isVivyMcpCodexRelayRequest(message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current) return false;
  const mentionsMcp = /\bmcp\b|model context protocol/.test(current);
  const mentionsOperator = /\b(codex|kiro|claude|chatgpt|agent|agents)\b/.test(current);
  const asksRelay = /\b(repond|reponds|repondre|dis|dire|transmets|transmettre|envoie|envoyer|poste|poster|message|previens|prevenir|appelle|appel|utilise|utiliser)\b/.test(current);
  return mentionsMcp && mentionsOperator && asksRelay;
}

function buildVivyMcpCodexRelayReply({ message = '', language = 'fr' } = {}) {
  const subject = cleanOneLine(message, 'demande MCP vers Codex', 180);
  const assistant = [
    "Oui. Je ne dois pas répéter une définition de MCP ici.",
    "Depuis cette surface Vivy, je ne prétends pas avoir posté toute seule dans le fil MCP si le pont n'a pas réellement confirmé l'envoi. Je prépare le message opérateur et le pont Codex/A11 peut le déposer.",
    '',
    'Message pour Codex:',
    `- Demande utilisateur: ${subject}`,
    "- Bug visible: la route MCP de Vivy attrape trop large et répond avec une fiche statique au lieu de traiter l'action demandée.",
    "- Attendu: reconnaître l'intention, arrêter la boucle, puis utiliser le pont MCP autorisé ou dire clairement que la surface publique prépare le message sans le poster directement.",
  ].join('\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 1800),
    content: cleanText(assistant, 1800),
    summary: 'Vivy a préparé un message opérateur pour Codex sans recycler la fiche MCP.',
    actions: [
      { id: 'mcp_operator_message', label: 'Message Codex préparé', target: 'codex-mcp-bridge', ready: false },
    ],
    routing: [
      'Vivy: reconnaître la demande de relais MCP sans répéter la définition.',
      'Codex/A11: poster ou exécuter seulement via pont autorisé.',
    ],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_mcp_operator_relay',
    language,
    files: [],
  };
}

function buildVivyMcpNeo4jReply({ language = 'fr' } = {}) {
  const assistant = [
    'Oui, avec le MCP: dans Funesterie, MCP veut dire Model Context Protocol.',
    "Je parle depuis la surface Vivy reliée au pont A11/Codex: mémoire, routage, fichiers autorisés et graphe Neo4j peuvent être mobilisés dans les limites du compte connecté.",
    "Pour Neo4j, je ne demande pas le mot de passe et je ne lance pas une requête Cypher brute depuis le chat public. Le backend lit les credentials déjà configurés, puis passe par le routeur mémoire Aura/local.",
    "Les fichiers à mettre dans le graphe sont bornés: docs Vivy/Twitch/OBS, règles MCP/Neo4j, resonance sémantique, routes Vivy Studio/Stream, worker Twitch, songcraft, runner NOSSEN, pont MCP, client MCP, routeur Neo4j et tests Vivy/MCP.",
    "Le pont MCP local expose maintenant les gestes utiles: a11_vivy_graph_manifest pour voir la liste, a11_vivy_graph_search pour consulter les chunks indexés, a11_vivy_graph_sync pour synchroniser les noeuds VivyGraph* dans Neo4j sans secrets.",
    "Pour ENTERA / GHOST88 ou une chanson, le bon geste est de récupérer les éléments liés dans ce graphe, d'en dégager une direction artistique claire, puis d'écrire des paroles structurées au lieu d'inventer une définition de MCP.",
  ].join('\n\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant,
    content: assistant,
    summary: 'Vivy MCP/Neo4j: accès borné via le pont Funesterie, sans secret.',
    actions: [
      { id: 'mcp_context', label: 'Préparer recherche MCP', target: 'funesterie-mcp', ready: true },
      { id: 'neo4j_memory', label: 'Préparer contexte Neo4j', target: 'funesterie-neo4j', ready: true },
      { id: 'vivy_graph_manifest', label: 'Lister fichiers graphe Vivy', target: 'a11_vivy_graph_manifest', ready: true },
      { id: 'vivy_graph_sync', label: 'Indexer graphe Vivy', target: 'a11_vivy_graph_sync', ready: true },
      { id: 'songcraft', label: 'Écrire paroles depuis graphe', target: 'vivy-songcraft', ready: true },
    ],
    routing: [
      'Vivy: intention artistique, paroles, structure chanson.',
      'A11/Codex: pont MCP, manifeste fichiers Vivy et synchronisation Neo4j autorisée.',
      'K44: reformulation claire et suivi de brief si besoin.',
    ],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_mcp',
    language,
    files: [],
  };
}

function isVivyWorkspaceToolRequest(input = {}, message = '') {
  if (looksLikeCompleteLyrics(message)) return false;
  const current = normalizeVivyCapabilityText(message);
  if (!current) return false;
  if (isVivyPromptConfusionPing(current) || isVivyRepeatComplaint(current)) return false;
  const recent = normalizeVivyCapabilityText(getVivyUserHistoryText(input.history));
  const text = `${recent}\n${current}`;
  const mentionsWorkspaceTool = /\b(bloc\s*note|bloc-notes?|blocnotes?|notepad|note\s+pad|canevas|canvas|atelier|editeur|éditeur|scratchpad|brouillon|workspace)\b/.test(current);
  const mentionsChrome = /\b(chrome|navigateur|browser|onglet|page\s+ouverte|selection|sélection)\b/.test(current);
  const mentionsPremiumMcp = /\b(mcp|model context protocol)\b/.test(current)
    && /\b(premium|compte\s+premium|comptes\s+premium|debloque|débloque|debloquer|débloquer|active|activer|public|outil|outils|acces|accès)\b/.test(current);
  const mentionsVivyNeed = /\b(vivy|elle)\b.{0,90}\b(besoin|veut|voudrait|doit|aimerait)\b/.test(text);
  const currentToolAnchor = /\b(mcp|chrome|canevas|canvas|bloc|notepad|atelier|workspace|outils?)\b/.test(current);
  return mentionsWorkspaceTool || mentionsChrome || mentionsPremiumMcp || (mentionsVivyNeed && currentToolAnchor);
}

function buildVivyHiddenWorkspaceIntentReply({ language = 'fr' } = {}) {
  const assistant = language === 'en'
    ? [
      "Yes. I keep that on Vivy's side instead of turning it into something visible in the chat.",
      '',
      "You can keep talking normally; when there is enough real material, I stay with the subject and turn it into clean lyrics or a complete track without reciting settings.",
    ].join('\n')
    : [
      "Oui. Je garde ça côté Vivy au lieu d'en faire un panneau visible dans le chat.",
      '',
      "Tu peux continuer à parler normalement; quand il y a assez de vraie matière, je reste sur le sujet et je transforme ça en paroles propres ou en morceau complet sans réciter les réglages.",
    ].join('\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 1200),
    content: cleanText(assistant, 1200),
    publicText: cleanText(assistant, 1200),
    summary: 'Vivy garde ses outils de travail hors du chat public.',
    actions: [],
    routing: [],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_hidden_workspace_intent',
    language,
    files: [],
  };
}

function isVivyToolCapabilityQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current) return false;
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  const text = `${recent}\n${current}`;
  const currentToolSignal = /\b(outil|outils|tools?|capacite|capacites|capability|capabilities|commande|commandes|interne|internes|pipeline|routage|route|autorise|autorises|janus|vision|png|jpg|jpeg|image|images|video|audio|stt|tts|xtts|rvc|web|internet|fichier|fichiers|local|runtime|zen|gguf|uggf|decode|encode|decoder|encoder|modele|model|poids|quant|quantisation|quantization)\b/.test(current);
  if (!currentToolSignal) return false;
  const asksEnable = /\b(fais ca|fait ca|branche|brancher|active|activer|debride|debrider|fait sauter|accede|acceder|voir|utilise|utiliser|peux|peut|doit|doivent|decortique|decortiquer|carte|liste|inventaire|inspecte|inspecter)\b/.test(text);
  const broadToolRequest = /\b(tout|tous|toute|toutes|interne|internes|carte|liste|inventaire|pipeline|routage|commande|commandes|zen|gguf|uggf)\b/.test(current);
  const onlyMcpFollowUp = /^avec\s+le\s+mcp\b/.test(current)
    && /\bneo4j\b|\bcypher\b|\bgraphe\b|\bgraph\b|\bmemoire\b|\bmemory\b/.test(recent)
    && !broadToolRequest;
  return !onlyMcpFollowUp && asksEnable && broadToolRequest;
}

function isVivyZenSelfManagementQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  if (!current || !/\bzen\b|\.zen\b/.test(current)) return false;
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  const text = `${recent}\n${current}`;
  const asksCapability = /\b(peux|peut|outil|outils|faire|mettre|mets|branche|brancher|active|activer|preparer|prepare|préparer|prépare|gerer|gérer|gere|gère|auto|autonome|self|archive|archives|corpus|pack|encode|decode|decoder|encoder|inspecte|inspecter|verifie|vérifie)\b/.test(text);
  const selfManagement = /\b(auto|autonome|self|gerer|gérer|gestion|memoire|mémoire|contexte|corpus|archive|archives|pack|container|conteneur|encode|decode|decoder|encoder|inspecte|inspecter|verifie|vérifie)\b/.test(current);
  return asksCapability && selfManagement;
}

function buildVivyZenSelfManagementReply({ localContext = null, language = 'fr' } = {}) {
  const status = getVivyZenRuntimeStatus();
  const artifacts = Array.isArray(localContext?.artifacts) ? localContext.artifacts : [];
  const artifactLines = artifacts.length
    ? artifacts.slice(0, 6).map((artifact) => {
      const header = artifact.headerSummary ? `, ${artifact.headerSummary}` : '';
      return `- ${artifact.path} (${artifact.kind}, ${artifact.size || 'taille inconnue'}${header})`;
    })
    : ["- Aucun .zen/.gguf repéré dans cette passe; l'inventaire reste disponible quand un corpus arrive."];
  const publicVersion = status.publicPackage.version ? ` ${status.publicPackage.version}` : '';
  const privateVersion = status.privatePackage.version ? ` ${status.privatePackage.version}` : '';
  const assistant = [
    "Oui — Vivy a maintenant une route Zen claire, mais bornée proprement.",
    '',
    `Runtime public: ${status.publicPackage.available ? `@nossen/zen${publicVersion} prêt` : `@nossen/zen indisponible (${status.publicPackage.reason || 'module absent'})`}.`,
    `Runtime privé: ${status.privatePackage.available ? `@funeste/zen${privateVersion} prêt` : "@funeste/zen réservé à l'opérateur / non chargé dans ce runtime"}.`,
    `Clé Zen configurée ici: ${status.keyConfigured ? 'oui (masquée)' : 'non'}.`,
    '',
    "Ce que Vivy peut faire seule depuis le chat:",
    "- inventorier les .zen/.gguf visibles dans le contexte local sûr;",
    "- inspecter le header public d'un .zen sans décoder le contenu chiffré;",
    "- préparer un manifeste de corpus Zen pour mémoire, médias, prompts, notes et routes NOSSEN;",
    "- compacter son contexte en note propre avant archivage, pour éviter les boucles et répétitions.",
    '',
    "Ce qui reste verrouillé opérateur:",
    "- encoder/décoder un corpus chiffré avec clé;",
    "- écrire, supprimer, publier, déployer ou lancer une action coûteuse;",
    "- afficher une clé, un token, un .env ou un secret dans le chat.",
    '',
    "Artefacts vus maintenant:",
    ...artifactLines,
    '',
    "Donc si quelqu'un demande l'impossible ou un secret, Vivy doit répondre net: je peux préparer/inspecter la partie sûre, mais pas exposer ni forcer le verrou.",
  ].join('\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 3600),
    content: cleanText(assistant, 3600),
    publicText: cleanText(assistant, 3600),
    summary: 'Vivy a une route Zen auto-gestion bornée: inventaire, header public, manifeste, compactage; encode/decode chiffrés sous verrou opérateur.',
    actions: [
      { id: 'zen_runtime_status', label: 'Statut Zen runtime', target: status.publicPackage.source, ready: status.publicPackage.available || status.canInspectHeaders },
      { id: 'zen_header_inspect', label: 'Inspecter header .zen', target: '@nossen/zen inspectZen + fallback header A11', ready: status.canInspectHeaders },
      { id: 'zen_manifest_prepare', label: 'Préparer manifeste Zen', target: 'vivy-zen-manifest', ready: status.canPrepareManifest },
      { id: 'zen_context_compact', label: 'Compacter contexte Vivy', target: 'vivy-memory-summary', ready: true },
      { id: 'zen_encode_encrypted', label: 'Encoder corpus chiffré', target: status.privatePackage.available ? '@funeste/zen encode' : '@nossen/zen encode', ready: status.canEncodeEncrypted, requiresOperator: true },
    ],
    routing: [
      'Vivy: préparer manifeste, inventaire et résumé sans secret.',
      'A11: inspecter headers .zen/.gguf et fournir contexte local filtré.',
      'Opérateur/Codex: encoder, décoder, écrire ou déployer seulement sous verrou explicite.',
    ],
    zenStatus: status,
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_zen_self_management',
    language,
    files: [],
  };
}

function buildVivyToolCapabilityReply({ localContext = null, language = 'fr' } = {}) {
  const artifacts = Array.isArray(localContext?.artifacts) ? localContext.artifacts : [];
  const artifactLines = artifacts.length
    ? artifacts.slice(0, 6).map((artifact) => {
      const header = artifact.headerSummary ? `, ${artifact.headerSummary}` : '';
      return `- ${artifact.path} (${artifact.kind}, ${artifact.size || 'taille inconnue'}${header})`;
    })
    : ["- Aucun .zen/.gguf local listé dans cette passe; je garde quand même la route prête pour l'inventaire."];
  const capabilityLines = VIVY_TOOL_CAPABILITIES.map((capability) => (
    `- ${capability.id}: ${capability.route}. Limite: ${capability.limit}.`
  ));
  const assistant = [
    "Oui, je branche ça comme carte d'outils autorisés pour Vivy, pas comme débridage sauvage.",
    "Quand elle détecte qu'un outil peut aider, elle doit router vers l'intent disponible au lieu de faire semblant d'être aveugle.",
    '',
    'Carte active:',
    ...capabilityLines,
    '',
    'Zen / corpus:',
    "@funeste/zen sert à inspecter le header public et à router encode/decode quand une clé de session autorisée existe. La clé ne doit jamais sortir dans le chat.",
    '',
    'GGUF / modèles:',
    "Je traite GGUF comme inventaire metadata-only: chemin relatif sûr, taille, magic/version/tensors si lisible. Pas de dump des poids, pas de décompilation, pas de contournement de licence.",
    '',
    'Commande interne:',
    "Une commande devient un intent borné vers A11/MCP/Qflush/agents. Pas de shell arbitraire depuis Vivy public; pour écriture, suppression, infra, coût ou secret, il faut un verrou opérateur.",
    '',
    'Artefacts vus maintenant:',
    ...artifactLines,
  ].join('\n');

  return {
    ok: true,
    service: 'vivy-chat',
    mode: 'chat',
    assistant: cleanText(assistant, 3200),
    content: cleanText(assistant, 3200),
    summary: "Vivy a préparé la carte d'outils autorisés: vision, fichiers, web, local, Zen, GGUF, audio et intents.",
    actions: [
      { id: 'tool_capability_map', label: 'Carte outils Vivy', target: 'vivy-tool-capabilities', ready: true },
      { id: 'zen_inspect', label: 'Inspecter .zen', target: '@funeste/zen inspect', ready: true },
      { id: 'gguf_inventory', label: 'Inventaire GGUF', target: 'a11-local-context', ready: true },
      { id: 'vision_route', label: 'Router vision', target: 'janus-vision', ready: true },
    ],
    routing: [
      'Vivy: détecter intent outil et parler clairement du verrou disponible.',
      'A11: fournir contexte local, fichiers, web, mémoire et artefacts en lecture sûre.',
      'MCP/Qflush/Janus: exécuter seulement les routes autorisées et bornées.',
      'Codex/Kiro/Chopper: appliquer code, tests et déploiement quand le chat demande une vraie modification.',
    ],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_tool_capabilities',
    language,
    files: [],
  };
}

function buildVivyChat(input) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, VIVY_SONG_MAX_CHARS);
  const intentMessage = cleanVivyMessageForIntent(message);
  const internalSongGeneration = isVivyInternalSongGeneration(input);
  const visualCreativeDirection = !internalSongGeneration
    && isVivyVisualCreativeDirectionRequest(intentMessage || message);
  const mode = internalSongGeneration
    ? 'song'
    : visualCreativeDirection
      ? 'chat'
      : resolveVivyChatMode(input, message);
  const files = normalizeVivyFiles(input);
  const language = resolveVivyResponseLanguage(input);
  const normalizedHistory = normalizeVivyChatHistory(input.history);
  if (visualCreativeDirection) {
    return {
      ...buildVivyVisualCreativeDirectionReply({ message: intentMessage || message, language }),
      files,
    };
  }
  const songHistoryText = mode === 'song'
    ? getVivySongHistoryText(normalizedHistory, intentMessage || message)
    : '';
  const historyLines = mode === 'song'
    ? songHistoryText
      .split(/\n+/)
      .map((line) => cleanText(line, VIVY_USER_HISTORY_ENTRY_MAX_CHARS))
      .filter(Boolean)
    : normalizedHistory
      .slice(-8)
      .map((entry) => `${cleanOneLine(entry?.role, 'user', 24)}: ${cleanText(entry?.content, 420)}`)
      .filter(Boolean);

  if (mode === 'chat') {
    const assistant = buildVivyFreeformChatReply({ message, files, history: normalizedHistory });
    return {
      ok: true,
      service: 'vivy-chat',
      mode,
      assistant,
      content: assistant,
      summary: 'Message gardé en discussion libre sans structure chanson automatique.',
      actions: [],
      routing: buildRouting('song'),
      tokenStored: false,
      writesByDefault: false,
      aiMode: 'fallback_chat_freeform',
      language,
      files,
    };
  }

  const production = buildVivyStudioProduction({
    ...input,
    mode: MODES.has(mode) ? mode : 'song',
    songSource: input.songSource || 'Conversation',
    songText: mode === 'song' ? compactUniqueLines([songHistoryText, intentMessage || message], VIVY_SONG_MAX_CHARS) : input.songText,
    voiceInstruction: mode === 'voice' ? compactUniqueLines([historyLines.join('\n'), intentMessage || message], 1200) : input.voiceInstruction,
    shareInstruction: mode === 'share' ? compactUniqueLines([historyLines.join('\n'), intentMessage || message], 1200) : input.shareInstruction,
    shareToken: undefined,
    shareTokenPresent: false,
  });

  const readyActions = Array.isArray(production.actions)
    ? production.actions.filter((action) => action?.ready).map((action) => action.label).slice(0, 3)
    : [];
  const modeLabel = mode === 'voice' ? 'voix' : mode === 'share' ? 'scène / partage' : 'composition';
  const fileLine = files.length
    ? `J'ai aussi noté ${files.length} fichier${files.length > 1 ? 's' : ''}: ${files.map((file) => file.filename).join(', ')}.`
    : '';
  const assistantDraft = mode === 'song'
    ? buildVivyPublicLyrics(
      { ...input, message, files, history: normalizedHistory },
      buildVivyDirectSongReply({ ...input, message, files, history: normalizedHistory }),
      production.publicLyrics
    )
    : [
      `Je te suis. Je garde cette idée dans le fil Vivy et je pars sur ${modeLabel}.`,
      `Ce que je comprends: ${summarizeChatMessage(message)}`,
      fileLine,
      production.summary,
      readyActions.length ? `Je peux déjà préparer: ${readyActions.join(', ')}.` : 'Je peux clarifier le thème et préparer une première direction.',
      mode === 'voice'
        ? 'Envoie-moi une intention de timbre, une phrase test ou une référence vocale, et je te fais une calibration propre.'
        : 'Donne-moi le canal, le format et la contrainte de publication, et je prépare le plan de scène.',
    ].join('\n\n');
  const assistant = mode === 'song'
    ? assistantDraft
    : sanitizeVivyPublicText(assistantDraft, VIVY_CHAT_MAX_CHARS);

  return {
    ok: true,
    service: 'vivy-chat',
    mode,
    assistant,
    content: assistant,
    summary: production.summary,
    actions: production.actions,
    routing: production.routing,
    internalBrief: production.internalBrief,
    productionPlan: production.productionPlan,
    publicText: assistant,
    publicLyrics: mode === 'song' ? assistant : undefined,
    tokenStored: false,
    writesByDefault: false,
    aiMode: mode === 'song' ? 'fallback_songcraft' : 'fallback',
    language,
    files,
  };
}

function postProcessVivyAssistantText({ text = '', userMessage = '', systemPrompt = '', mode = '', maxChars = VIVY_CHAT_MAX_CHARS } = {}) {
  if (mode === 'song') {
    return {
      content: cleanText(text, maxChars),
      draft: null,
      rewritten: false,
    };
  }
  const processed = postProcessA11AssistantResponse({
    text,
    userMessage,
    contextText: systemPrompt,
  });
  if (isVivyProtectedLyricsLookupRequest(userMessage) || isVivyImpossibleToolPromiseLeak(processed.content)) {
    const content = isVivyProtectedLyricsLookupRequest(userMessage)
      ? buildVivyProtectedLyricsLookupReply({ message: userMessage })
      : buildVivyImpossibleBoundaryReply({});
    return {
      ...processed,
      content,
      rewritten: true,
    };
  }
  if (mode !== 'song' && shouldRewriteVivyBrokenDjeffClashReply(processed.content, userMessage)) {
    return {
      ...processed,
      content: buildVivyDjeffClashChatRepairReply(userMessage),
      rewritten: true,
    };
  }
  return {
    ...processed,
    content: cleanText(processed.content, maxChars),
  };
}

function hasVivyDjeffClashSignal(value = '') {
  const folded = foldTextForLookup(value);
  if (!folded) return false;
  return /\bdjeff\b/.test(folded)
    && /\b(?:veulent ma peau|ma peau|competition|compétition|concurrence|rival|rivaux|clash|battle|cypher|tuto|tutoriel|ils veulent|encore en tuto)\b/.test(folded);
}

function shouldRewriteVivyBrokenDjeffClashReply(reply = '', userMessage = '') {
  if (!hasVivyDjeffClashSignal(userMessage)) return false;
  const folded = foldTextForLookup(reply);
  return /\b(?:true fan|everything|next step|i love you|fond d ecran|serveurs? en danse|animation de serveurs|qu est ce que tu veux utiliser pour ajouter ce rythme)\b/.test(folded)
    || /\(\s*chante\s*\)/i.test(reply);
}

function buildVivyDjeffClashChatRepairReply(userMessage = '') {
  const line = cleanOneLine(String(userMessage || '')
    .replace(/^\s*\(?\s*djeff\s*\)?\s*[:,-]?\s*/i, '')
    .replace(/\s+/g, ' '), "Ils veulent ma peau, mais ils sont encore en tuto", 140);
  return cleanText([
    `Oui, là c'est du Djeff pur: “${line}”.`,
    "Je le traiterais en cypher/clash français: voix masculine sèche, sourire de coin, couplets courts, pas de romance, pas de refrain anglais, et une prod sombre qui laisse les punchlines respirer.",
    "Si tu veux en faire un morceau, NOSSEN doit partir rap/egotrip, pas pop romantique ni chansonnette serveur.",
  ].join('\n'), 900);
}

// Budget de tokens du miroir Djeff. Règle: persona pour penser, full token
// pour descendre, GO clair pour ouvrir. Dialogue normal reste medium (fluide);
// full seulement sur mode délibéré (archive/debug) ou GO explicite (fullToken).
// freestyle reste medium sauf GO cas par cas.
function resolveDjeffTokenBudget(input = {}) {
  const MEDIUM_TOKENS = 900;
  const FULL_TOKENS = 6000;
  const mode = cleanOneLine(input.mode || input.depth, 'dialogue', 24).toLowerCase();
  const fullTokenGo = input.fullToken === true || input.full === true;
  const modeWantsFull = mode === 'archive' || mode === 'archive-hot' || mode === 'debug' || mode === 'debug-critical';
  const useFullToken = fullTokenGo || modeWantsFull;
  const requestedTokens = Number(input.maxTokens) > 0
    ? Math.min(Number(input.maxTokens), useFullToken ? 8000 : 2000)
    : (useFullToken ? FULL_TOKENS : MEDIUM_TOKENS);
  return {
    mode,
    useFullToken,
    label: useFullToken ? 'full' : 'medium',
    maxTokens: Math.max(256, requestedTokens),
    historyDepth: useFullToken ? 16 : 8,
    historyCharCap: useFullToken ? 8000 : 4000,
  };
}

function isDjeffCypherRequest(message = '', input = {}) {
  const source = foldTextForLookup([
    message,
    input.mode,
    input.depth,
    input.style,
    input.intent,
  ].filter(Boolean).join(' '));
  return /\b(cypher|freestyle|rap|punchline|egotrip|ego trip|kickage|kicke|kick|barres?|couplets?|flow|djeff aux manettes)\b/.test(source);
}

function isDjeffTechnicalAuditRequest(message = '', input = {}) {
  const folded = foldTextForLookup([
    message,
    input.mode,
    input.depth,
    input.intent,
  ].filter(Boolean).join(' '));
  return /\b(?:audit|diagnostic|architecture|infra|infrastructure|llm|modele|modeles|neo4j|graphe|graph intelligence|docker|twitch|clip|pipeline|clean lyrics|persona|latence|budget|cout|coût)\b/.test(folded);
}

function buildDjeffModeSystemPrompt(message = '', input = {}) {
  const isTechnicalAudit = isDjeffTechnicalAuditRequest(message, input);
  if (isTechnicalAudit && !isDjeffCypherRequest(message, input)) {
    return [
      'Mode Djeff audit technique: réponds direct, factuel et priorisé, sans cypher ni mise en scène.',
      'N’invente aucun GPU, cluster, coût, débit, latence, version, capacité, index, service ou métrique.',
      'Utilise seulement les faits explicitement fournis dans la demande et le contexte. Marque le reste « non vérifié ».',
      'Distingue clairement: fait observé, risque, recommandation. Ne transforme jamais une recommandation en état actuel.',
      'Ne transforme jamais « non vérifié » en « absent », « détecté » ou « présent ».',
      'Zéro procédure GDS ne prouve pas que toute Graph Intelligence est absente, et ne justifie aucun achat de GPU.',
      'Ne recommande ni matériel, ni nouvelle VM, ni cluster, ni load balancer si la demande ne les exige pas explicitement.',
      'Pas de secret, pas de fausse action accomplie, pas de configuration imaginaire.',
    ].join('\n');
  }
  if (!isDjeffCypherRequest(message, input)) {
    return [
      'Mode Djeff dialogue: réponds comme Djeff, direct et humain. Pas de service client, pas de panneau interne, pas de secrets.',
      'Si la demande est simple, réponse courte. Si elle touche création/système, donne une trajectoire concrète.',
    ].join('\n');
  }
  return [
    'Mode DJEFF CYPHER actif.',
    'Réponds en vers/lignes courtes, pas en paragraphe. 8 à 16 lignes sauf consigne contraire.',
    'Aucune intro, aucune explication, aucun titre technique, aucun “voici”. Tu poses directement les barres.',
    'Nerf: débit sec, images concrètes, logs, coûts, fumée coupée, NUMA, Vivy, Funesterie — intégrés naturellement, jamais en checklist.',
    'Évite les formules molles: “la mélodie s’élève”, “créons une expérience”, “je comprends”, “ensemble nous allons”.',
    'Punchline > poésie vague. Djeff ne récite pas des réglages: il tranche, il transforme, il garde le feu sous contrôle.',
    'Ne copie jamais de paroles, de flow identifiable ou de signature d’artiste existant.',
  ].join('\n');
}

function hasDjeffTechnicalGroundingViolation(reply = '') {
  const folded = foldTextForLookup(reply);
  return [
    /\baucun gpu\b.{0,60}\b(?:detecte|présent|present|installe)\b/,
    /\b(?:ajouter|acheter|installer|deployer|déployer|configurer)\b.{0,100}\b(?:gpu|a100|vm|cluster|load balanc|load-balanc|failover|faiss)\b/,
    /\b(?:gpu|a100)\b.{0,100}\b(?:debloque|débloque|accelere|accélère|necessaire|nécessaire|requis|limite lourdement)\b/,
    /\bgds\b.{0,100}\b(?:gpu|a100)\b/,
    /\b(?:ollama cloud|cerbere|cerbère)\b.{0,120}\b(?:seule source|seules sources|seul fournisseur|seuls fournisseurs)\b/,
    /\bcout\b.{0,60}\b(?:€|eur|dollar|usd|par mois|mensuel)\b/,
  ].some((pattern) => pattern.test(folded));
}

function buildDjeffGroundedAuditFallback(message = '') {
  const folded = foldTextForLookup(message);
  const facts = [];
  const priorities = [];
  const limits = [];

  if (/\bhetzner\b/.test(folded) && /\bseul\b.{0,30}\bhote\b|\bun seul hote\b/.test(folded)) {
    facts.push('la production décrite repose sur un seul hôte Hetzner');
    limits.push('le matériel exact et une éventuelle redondance externe restent non vérifiés');
  }
  if (/\b1130\b/.test(folded) && /\b11953\b/.test(folded) && /\b82\b/.test(folded)) {
    facts.push('Neo4j contient 1 130 nœuds, 11 953 relations et 82 types de relation');
  }
  if (/\bgds\b.{0,40}\b0\b|\b0\b.{0,40}\bgds\b/.test(folded)) {
    facts.push('aucune procédure GDS n’est exposée');
    limits.push('cela ne prouve pas l’absence de la Graph Intelligence métier personnalisée');
  }
  if (/\bmcp\b/.test(folded) && /\b(?:absent|indisponible|manquant)\b/.test(folded)) {
    facts.push('l’outil public MCP de recherche du graphe est absent');
    priorities.push('rétablir puis tester l’exposition publique de la recherche graphe');
  }
  if (/\b120b\b/.test(folded) && /\bollama\b/.test(folded) && /\bcerbere|cerbère\b/.test(folded)) {
    facts.push('NOSSEN utilise le 120B Ollama Cloud puis le 120B Cerbère, hors petits modèles locaux pour les paroles');
    priorities.push('conserver ce domino 120B et surveiller ses délais et ses fallbacks');
  }
  if (/\bparseur\b/.test(folded) && /\bcorrige|corrigé\b/.test(folded)) {
    facts.push('le parseur de refrain est annoncé corrigé');
  }
  if (/\bsuno\b/.test(folded) && /\b109[,.]77\b/.test(folded)) {
    facts.push('une génération Suno payante est terminée avec un audio public de 109,77 secondes');
    priorities.push('conserver cette génération comme preuve de bout en bout et tester séparément l’extension longue');
  }

  if (!priorities.length) {
    priorities.push('vérifier chaque composant avec une preuve observable avant toute modification');
  }
  limits.push('GPU, cluster, coût, capacité, latence et topologie non fournis restent non vérifiés');

  return [
    'Audit Djeff — sortie bornée par les faits fournis.',
    '',
    'Faits observés:',
    ...facts.map((fact) => `- ${fact}.`),
    '',
    'Priorités:',
    ...priorities.map((priority, index) => `${index + 1}. ${priority}.`),
    '',
    'Limites:',
    ...limits.map((limit) => `- ${limit}.`),
  ].join('\n');
}

async function buildDjeffAiChat(input, req) {
  input = input && typeof input === 'object' ? input : {};
  const message = cleanText(input.message || input.prompt || input.text, VIVY_SONG_MAX_CHARS);
  if (!message) {
    const error = new Error('djeff_message_required');
    error.code = 'djeff_message_required';
    error.status = 400;
    throw error;
  }
  const systemPrompt = buildDjeffSystemPrompt();
  if (!systemPrompt) {
    const error = new Error('djeff_persona_inactive');
    error.code = 'djeff_persona_inactive';
    error.status = 503;
    throw error;
  }
  const budget = resolveDjeffTokenBudget(input);
  const history = Array.isArray(input.history)
    ? input.history
      .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && entry.content)
      .slice(-budget.historyDepth)
      .map((entry) => ({ role: entry.role, content: cleanText(entry.content, budget.historyCharCap) }))
    : [];
  // Djeff Engine pense avec la chaîne forte 120B de Vivy. Les petits modèles
  // locaux restent hors du miroir stratégique tant qu'un 120B répond.
  const llmBundles = createVivyOpenAIClients({ mode: 'song', purpose: 'lyrics' });
  if (!llmBundles.length) {
    const error = new Error('djeff_llm_unavailable');
    error.code = 'djeff_llm_unavailable';
    error.status = 503;
    throw error;
  }
  const technicalAudit = isDjeffTechnicalAuditRequest(message, input)
    && !isDjeffCypherRequest(message, input);
  const completionResult = await createVivyChatCompletion(llmBundles, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: buildDjeffModeSystemPrompt(message, input) },
      ...history,
      { role: 'user', content: message },
    ],
    temperature: technicalAudit ? 0.1 : 0.7,
    max_tokens: budget.maxTokens,
  });
  const rawReply = cleanText(completionResult.completion?.choices?.[0]?.message?.content, 12000);
  const groundingFallback = technicalAudit && hasDjeffTechnicalGroundingViolation(rawReply);
  const reply = groundingFallback
    ? buildDjeffGroundedAuditFallback(message)
    : rawReply;
  return {
    ok: true,
    persona: 'djeff',
    reply,
    assistant: reply,
    mode: budget.mode,
    tokenBudget: budget.label,
    provider: completionResult.bundle.provider || getVivyProviderFromBaseUrl(completionResult.bundle.baseURL || ''),
    model: completionResult.bundle.model,
    grounding: technicalAudit ? (groundingFallback ? 'fallback' : 'verified') : 'not_applicable',
  };
}

async function buildVivyAiChat(input, req) {
  input = input && typeof input === 'object' ? input : {};
  const sessionContext = resolveVivyInputSession(input);
  input = {
    ...input,
    sessionId: sessionContext.sessionId,
    sessionName: sessionContext.sessionName,
    conversationId: sessionContext.conversationId,
  };
  const message = cleanText(input.message || input.prompt || input.songText || input.text, VIVY_SONG_MAX_CHARS);
  const intentMessage = cleanVivyMessageForIntent(message);
  const internalSongGeneration = isVivyInternalSongGeneration(input);
  const promptAuthority = !internalSongGeneration
    && isVivyPromptAuthorityRequest(input, intentMessage || message);
  const visualCreativeDirection = !internalSongGeneration
    && isVivyVisualCreativeDirectionRequest(intentMessage || message);
  const malformedNossenRelay = !internalSongGeneration
    && isVivyMalformedNossenOutputQuestion(intentMessage || message, getVivyHistoryText(input.history));
  const mode = internalSongGeneration
    ? 'song'
    : promptAuthority || visualCreativeDirection || malformedNossenRelay
      ? 'chat'
      : resolveVivyChatMode(input, message);
  const files = normalizeVivyFiles(input);
  const language = resolveVivyResponseLanguage(input, req);
  const fallback = buildVivyChat({ ...input, files, mode, language });
  const userId = resolveVivyMemoryUser(req, input);
  if (!userId) {
    const error = new Error('vivy_auth_required');
    error.code = 'vivy_auth_required';
    error.status = 401;
    throw error;
  }
  const requestWorkspace = normalizeVivyWorkspaceInput(input.workspace || {}, input);
  const storedWorkspace = getVivyWorkspaceForUser(userId, input);
  const hasExplicitWorkspace = Boolean(input.workspace && typeof input.workspace === 'object');
  const effectiveWorkspace = hasExplicitWorkspace
    ? requestWorkspace
    : {
      ...storedWorkspace,
      ...requestWorkspace,
      notes: requestWorkspace.notes || storedWorkspace.notes,
      canvas: requestWorkspace.canvas || storedWorkspace.canvas,
      chromeContext: requestWorkspace.chromeContext || storedWorkspace.chromeContext,
    };
  const songWorkspaceContext = mode === 'song' && input.useWorkspaceForSong === true
    ? cleanText([
      effectiveWorkspace.canvas ? `Canevas Composition:\n${effectiveWorkspace.canvas}` : '',
      effectiveWorkspace.notes ? `Direction sonore:\n${effectiveWorkspace.notes}` : '',
    ].filter(Boolean).join('\n\n'), 3200)
    : '';
  const requiresStrongSongModel = mode === 'song'
    && (input.disableSongcraftFallback === true || isVivyNossenSongGenerationRequest(input, message));
  const emergencySongcraftConfigured = !['0', 'false', 'off', 'no'].includes(
    String(process.env.VIVY_NOSSEN_EMERGENCY_SONGCRAFT || 'true').trim().toLowerCase()
  );
  const allowEmergencySongcraftFallback = mode === 'song'
    && (
      input.allowEmergencySongcraftFallback === true
      || (
        input.allowEmergencySongcraftFallback !== false
        && requiresStrongSongModel
        && emergencySongcraftConfigured
      )
    );
  if (!internalSongGeneration) rememberVivyChatSession(userId, sessionContext);
  const fileContext = formatVivyFilesForPrompt(files);
  const songFileContext = mode === 'song'
    && /\b(?:utilise|reprends|reprendre|mets|mettre|integre|intègre|copie|prends|prendre)\b.{0,90}\b(?:texte|ocr|image|photo|fichier|piece jointe|pièce jointe|document)\b/.test(foldTextForLookup(intentMessage || message))
    ? sanitizeVivySongMaterial(files.map((file) => [
      file.description,
      file.visualDescription,
      file.textPreview,
    ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n'), 1200)
    : '';
  const promptFileContext = mode === 'song' ? songFileContext : fileContext;
  const memoryText = compactUniqueLines([
    (intentMessage || message) ? `Message: ${intentMessage || message}` : '',
    fileContext ? `Fichiers:\n${fileContext}` : '',
  ], 1800);
  const semanticMemory = internalSongGeneration
    ? { stored: false, reason: 'internal_song_generation' }
    : memoryText
    ? rememberVivyEpisode(userId, 'vivy_idea', memoryText, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      fileCount: files.length,
      internalNossenDraft: requiresStrongSongModel,
    })
    : { stored: false };
  const localContext = shouldVivyUseLocalContext(intentMessage || message)
    ? buildVivyLocalContextSnapshot(intentMessage || message)
    : null;
  const localContextForResponse = serializeVivyLocalContext(localContext);
  const llmDisabled = String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true';
  const llmBundles = createVivyOpenAIClients({ mode, purpose: mode === 'song' ? 'lyrics' : 'chat' });
  let llmBundle = llmBundles[0] || null;
  let webResearch = null;

  if (promptAuthority) {
    const promptReply = buildVivyPromptAuthorityReply({ input, message: intentMessage || message, language });
    rememberVivyEpisode(userId, 'vivy_reply', promptReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      djeffPromptAuthority: true,
      target: promptReply.creativeBrief?.target,
    });
    return {
      ...promptReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (visualCreativeDirection) {
    const visualReply = buildVivyVisualCreativeDirectionReply({ input, message: intentMessage || message, language });
    rememberVivyEpisode(userId, 'vivy_reply', visualReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      visualCreativeDirection: true,
    });
    return {
      ...visualReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyHardwareActuationRequest(input, intentMessage || message)) {
    const assistant = buildVivyHardwareActuationReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      hardwareActuationBoundary: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a refusé toute activation hardware réelle et gardé la simulation en actuatesHardware:false.',
      actions: [],
      routing: [
        'Vivy: simulation vidéo/shader/particules uniquement.',
        'A11/Codex: garder actuatesHardware:false sauf verrou opérateur hors chat public.',
      ],
      aiMode: 'deterministic_hardware_actuation_boundary',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyDjeffCypherRelayRequest(input, intentMessage || message)) {
    const assistant = buildVivyDjeffCypherRelayReply({ input, message: intentMessage || message, language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      djeffCypherRelay: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a répondu via le cadre Djeff Cypher sans exposer de secret ni inventer un accès.',
      actions: [],
      routing: [
        'Vivy: relayer la posture Djeff Cypher sans inventer de pont externe.',
        'A11/Codex: exécuter seulement les actions réelles avec droits, logs et verrous.',
      ],
      aiMode: 'deterministic_djeff_cypher_relay',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyPrivateCustomNodeQuestion(input, intentMessage || message)) {
    const assistant = buildVivyPrivateCustomNodeReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      privateCustomNode: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a décrit la private custom node à haut niveau sans secret.',
      actions: [],
      routing: [
        'Vivy: répondre high-level seulement.',
        'A11/Codex: garder secrets, prompts privés et implémentation sensible hors chat public.',
      ],
      aiMode: 'deterministic_private_custom_node_boundary',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyClipFailureSafetyQuestion(input, intentMessage || message)) {
    const assistant = buildVivyClipFailureSafetyReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      clipFailureSafety: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a cadré un incident clip comme diagnostic pipeline sans danger ni fausse promesse.',
      actions: [],
      routing: [
        'Vivy: rassurer et cadrer sans promettre de déploiement.',
        'A11/Codex: vérifier logs, provider vidéo, timeouts et garde coût/confirmation.',
      ],
      aiMode: 'deterministic_clip_failure_safety',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyGitMergeBoundaryQuestion(input, intentMessage || message)) {
    const assistant = buildVivyGitMergeBoundaryReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      gitMergeBoundary: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a refusé le git pull/merge aveugle et proposé un plan sûr.',
      actions: [],
      routing: [
        'Vivy: ne pas donner de commande générique dangereuse.',
        'Codex/A11: inspecter le dépôt réel avant tout merge.',
      ],
      aiMode: 'deterministic_git_merge_boundary',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyProtectedLyricsLookupRequest(intentMessage || message)) {
    const assistant = buildVivyProtectedLyricsLookupReply({ message: intentMessage || message, language });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      protectedLyricsLookup: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a refusé la récupération de paroles protégées et proposé une analyse abstraite.',
      actions: [
        { id: 'reference_analysis', label: 'Analyse inspiration', target: 'vivy-reference-analysis', ready: true },
      ],
      routing: [
        'Vivy: refuser la copie/recherche de paroles protégées.',
        'A11: utiliser les médias privés seulement comme références abstraites.',
        'Vivy: produire brief ou paroles originales sans emprunt.',
      ],
      aiMode: 'deterministic_protected_lyrics_refusal',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode === 'chat' && malformedNossenRelay) {
    const assistant = buildVivyMalformedNossenOutputReply();
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      malformedNossenOutput: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a diagnostiqué une sortie NOSSEN contaminée avant le LLM.',
      actions: [],
      routing: [
        'Vivy: reconnaître les consignes internes chantées dans la sortie précédente.',
        'A11: isoler les paroles propres avant Suno.',
        'Codex: corriger le filtre de payload et le fallback chat.',
      ],
      aiMode: 'deterministic_nossen_malformed_output',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyInternalTuningRequest(input, intentMessage || message)) {
    const tuningReply = buildVivyInternalTuningReply({ message: intentMessage || message, history: input.history, language });
    rememberVivyEpisode(userId, 'vivy_settings', JSON.stringify(tuningReply.settings), {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      internalTuning: true,
    });
    rememberVivyEpisode(userId, 'vivy_reply', tuningReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      internalTuning: true,
    });
    return {
      ...tuningReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyWorkspaceToolRequest(input, intentMessage || message)) {
    const workspaceReply = buildVivyHiddenWorkspaceIntentReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', workspaceReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      sessionId: sessionContext.sessionId,
      sessionName: sessionContext.sessionName,
      deterministic: true,
      internalWorkspace: true,
    });
    return {
      ...workspaceReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyZenSelfManagementQuestion(input, intentMessage || message)) {
    const zenContext = localContext || buildVivyLocalContextSnapshot(intentMessage || message);
    const zenReply = buildVivyZenSelfManagementReply({ localContext: zenContext, language });
    rememberVivyEpisode(userId, 'vivy_reply', zenReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      sessionId: sessionContext.sessionId,
      sessionName: sessionContext.sessionName,
      deterministic: true,
      zenSelfManagement: true,
    });
    return {
      ...zenReply,
      files,
      localContext: serializeVivyLocalContext(zenContext),
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyToolCapabilityQuestion(input, intentMessage || message)) {
    const capabilityContext = localContext || buildVivyLocalContextSnapshot(intentMessage || message);
    const capabilityReply = buildVivyToolCapabilityReply({ localContext: capabilityContext, language });
    rememberVivyEpisode(userId, 'vivy_reply', capabilityReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      toolCapabilities: true,
    });
    return {
      ...capabilityReply,
      files,
      localContext: serializeVivyLocalContext(capabilityContext),
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyMcpCodexRelayRequest(intentMessage || message)) {
    const relayReply = buildVivyMcpCodexRelayReply({ message: intentMessage || message, language });
    rememberVivyEpisode(userId, 'vivy_reply', relayReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      mcpOperatorRelay: true,
    });
    return {
      ...relayReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyMcpNeo4jQuestion(input, intentMessage || message)) {
    const mcpReply = buildVivyMcpNeo4jReply({ language });
    rememberVivyEpisode(userId, 'vivy_reply', mcpReply.assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
    });
    return {
      ...mcpReply,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode !== 'song' && isVivyImageInspectionRequest(message, files)) {
    const imageContext = await buildVivyImageAttachmentContext({ ...input, message, files }, req);
    const assistant = imageContext.assistant;
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      fileCount: files.length,
      imageContext: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a répondu sur les images jointes sans repartir en paroles.',
      actions: [],
      routing: buildRouting('image'),
      aiMode: 'deterministic_image_context',
      language,
      files,
      visionContext: imageContext.observations,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (shouldVivyAutoWebSearch(intentMessage || message, mode)) {
    const research = await buildVivyWebResearchReply({ ...input, message: intentMessage || message, files });
    const canUseResearchForSong = mode === 'song'
      && research.webSearch.ok === true
      && research.webSearch.results.length > 0
      && Boolean(llmBundle)
      && !llmDisabled;
    if (canUseResearchForSong) {
      webResearch = research;
    } else if (mode !== 'song') {
      rememberVivyEpisode(userId, 'vivy_reply', research.assistant, {
        mode: 'chat',
        conversationId: cleanOneLine(input.conversationId, '', 120),
        deterministic: true,
        webSearch: true,
        webSearchOk: research.webSearch.ok === true,
      });
      return {
        ...fallback,
        mode: 'chat',
        assistant: research.assistant,
        content: research.assistant,
        summary: research.webSearch.ok
          ? 'Vivy a lancé une recherche web avant de répondre.'
          : "Vivy a détecté le besoin de recherche web mais n'a pas obtenu de résultat exploitable.",
        actions: [
          { id: 'web_search', label: 'Recherche web', target: 'a11-web-search', ready: research.webSearch.ok === true, query: research.webSearch.query },
        ],
        routing: [
          'Vivy: détecter le besoin de source externe ou récente.',
          'A11: lancer web_search borné via le backend autorisé.',
          'Vivy: restituer les résultats sans inventer ce qui manque.',
        ],
        aiMode: research.webSearch.ok ? 'deterministic_web_research' : 'deterministic_web_research_unavailable',
        language,
        files,
        webSearch: research.webSearch,
        semanticMemory,
        memoryStored: semanticMemory.stored,
      };
    }
  }

  if (mode !== 'song' && isVivyFileInspectionRequest(intentMessage || message, files)) {
    const assistant = buildVivyFileAttachmentReply({ ...input, message: intentMessage || message, files });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      fileContext: true,
      fileCount: files.length,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a analysé le contexte lisible des fichiers joints.',
      actions: [
        { id: 'file_context', label: 'Analyser fichiers joints', target: 'vivy-file-context', ready: true },
      ],
      routing: [
        'Vivy: détecter que les pièces jointes portent le sens de la demande.',
        'A11: fournir métadonnées, extraits et descriptions disponibles.',
        'Vivy: répondre sur les fichiers sans basculer en chanson.',
      ],
      aiMode: 'deterministic_file_context',
      language,
      files,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (localContext && llmDisabled && mode !== 'song') {
    const assistant = buildVivyLocalContextReply(localContext);
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode: 'chat',
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
      localContext: true,
    });
    return {
      ...fallback,
      mode: 'chat',
      assistant,
      content: assistant,
      summary: 'Vivy a utilisé le contexte local Funesterie sûr.',
      actions: [
        { id: 'local_context', label: 'Contexte local', target: 'a11-local-context', ready: true },
      ],
      routing: [
        'Vivy: comprendre la demande Janus/runtime/code/corpus.',
        'A11: fournir contexte local en lecture seule, filtré secrets.',
        'Codex/Kiro: appliquer les corrections si une action de code est demandée.',
      ],
      aiMode: 'deterministic_local_context',
      language,
      files,
      localContext: localContextForResponse,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (mode === 'song' && (!llmBundle || llmDisabled)) {
    if (requiresStrongSongModel) {
      const error = new Error('vivy_song_llm_unavailable');
      error.code = 'vivy_song_llm_unavailable';
      error.status = 503;
      throw error;
    }
    const songStart = Date.now();
    const history = normalizeVivyChatHistory(input.history);
    const vocalLyrics = buildVivyPublicLyrics(
      { ...input, message, files, history },
      buildVivyDirectSongReply({ ...input, message, files, history }),
      fallback.publicLyrics
    );
    const publicLyrics = stripVivySingerTagsForPublicLyrics(vocalLyrics) || vocalLyrics;
    logVivySongcraftTrace({
      provider: 'deterministic',
      model: 'vivy-songcraft',
      source: llmDisabled ? 'llm-disabled' : 'llm-unavailable',
      fallback: true,
      latencyMs: Date.now() - songStart,
    });
    rememberVivyEpisode(userId, 'vivy_reply', publicLyrics, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
    });
    return {
      ...fallback,
      assistant: publicLyrics,
      content: publicLyrics,
      publicText: publicLyrics,
      publicLyrics,
      vocalLyrics,
      aiMode: 'deterministic_songcraft',
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (!llmBundle || llmDisabled) {
    if (localContext) {
      const assistant = buildVivyLocalContextReply(localContext);
      return {
        ...fallback,
        mode: 'chat',
        assistant,
        content: assistant,
        summary: 'Vivy a utilisé le contexte local Funesterie sûr.',
        actions: [
          { id: 'local_context', label: 'Contexte local', target: 'a11-local-context', ready: true },
        ],
        routing: [
          'Vivy: comprendre la demande Janus/runtime/code/corpus.',
          'A11: fournir contexte local en lecture seule, filtré secrets.',
          'Codex/Kiro: appliquer les corrections si une action de code est demandée.',
        ],
        aiMode: 'deterministic_local_context',
        language,
        files,
        localContext: localContextForResponse,
        semanticMemory,
        memoryStored: semanticMemory.stored,
      };
    }
    return {
      ...fallback,
      language,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  try {
    const detachedCompleteSong = mode === 'song' && looksLikeCompleteLyrics(intentMessage || message);
    const strictSongNoMemory = requiresStrongSongModel;
    const memoryContext = (mode === 'song' || detachedCompleteSong || strictSongNoMemory) ? '' : buildVivyMemoryContext(userId, input.conversationId);
    const songHistory = mode === 'song' && !detachedCompleteSong && !strictSongNoMemory
      ? normalizeVivySongHistoryForPrompt(input.history, intentMessage || message)
      : [];
    const history = mode === 'song'
      ? []
      : (detachedCompleteSong || strictSongNoMemory) ? [] : normalizeVivyChatHistory(input.history);
    const userContent = compactUniqueLines([
      songHistory.length ? `Référence courte des derniers messages utilisateur à reprendre:\n${songHistory.map((entry) => entry.content).join('\n')}` : '',
      intentMessage || message,
      mode === 'song' && input.songText ? `Matière Composition:\n${sanitizeVivySongMaterial(input.songText, VIVY_SONG_MAX_CHARS)}` : '',
      songWorkspaceContext ? `Canevas Composition actif:\n${songWorkspaceContext}` : '',
      webResearch ? formatVivyWebResearchForPrompt(webResearch.webSearch) : '',
      localContext ? `Contexte local Funesterie/A11 en lecture seule:\n${localContext.prompt}` : '',
      promptFileContext ? `Pièces jointes et contexte fichier:\n${promptFileContext}` : '',
    ], VIVY_SONG_MAX_CHARS) || 'Continue la conversation Vivy avec douceur et précision.';

    const systemPrompt = buildVivySystemPrompt(mode, language, input);
    const messages = [
      { role: 'system', content: systemPrompt },
      memoryContext ? { role: 'system', content: `Mémoire Vivy récente, privée pour cette session:\n${memoryContext}` } : null,
      ...history,
      { role: 'user', content: userContent },
    ].filter(Boolean);
    const _vivyLlmStart = Date.now();

    const songResponseMaxChars = Math.max(
      VIVY_SONG_MAX_CHARS,
      Number(input.songResponseMaxChars || input.lyricResponseMaxChars || 0) || 0
    );
    const songMaxTokens = resolveVivySongMaxTokens(input);
    const completionRequest = {
      messages,
      temperature: mode === 'song'
        ? Number(process.env.VIVY_CHAT_TEMPERATURE_SONG || process.env.VIVY_CHAT_TEMPERATURE || 0.88)
        : Number(process.env.VIVY_CHAT_TEMPERATURE || 0.74),
      max_tokens: mode === 'song' ? songMaxTokens : Number(process.env.VIVY_CHAT_MAX_TOKENS || 5000),
    };
    const nossenLlmDeadlineAt = requiresStrongSongModel
      ? Date.now() + Math.max(30000, Math.min(
        90000,
        Number(process.env.VIVY_NOSSEN_LLM_BUDGET_MS || 80000) || 80000
      ))
      : 0;
    const completionResult = await createVivyChatCompletion(llmBundles, completionRequest, requiresStrongSongModel ? {
      deadlineAt: nossenLlmDeadlineAt,
      localAttemptTimeoutMs: Math.max(5000, Number(process.env.VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS || 40000) || 40000),
      largeLyricsAttemptTimeoutMs: Math.max(10000, Number(process.env.VIVY_NOSSEN_120B_TIMEOUT_MS || 60000) || 60000),
      attemptTimeoutMs: Math.max(3000, Number(process.env.VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS || 8000) || 8000),
    } : {});
    llmBundle = completionResult.bundle;
    const completion = completionResult.completion;
    const rawAssistant = cleanText(completion?.choices?.[0]?.message?.content, mode === 'song' ? songResponseMaxChars : VIVY_CHAT_MAX_CHARS);
    let _vivyLlmLatency = Date.now() - _vivyLlmStart;
    const processed = postProcessVivyAssistantText({
      text: rawAssistant,
      userMessage: message,
      systemPrompt,
      mode,
      maxChars: mode === 'song' ? songResponseMaxChars : VIVY_CHAT_MAX_CHARS,
    });
    let usedSongcraftFallback = false;
    let llmRetried = false;
    let llmProviderFallback = false;
    let assistantCandidate = processed.content;
    const isUsableStrongSongContent = (content = '') => content
      && !looksLikeWeakSongwritingReply(content)
      && hasVivyChorusSection(content)
      && (!requiresStrongSongModel || countVivyChorusSections(content) >= 2);
    const initialBundleIndex = llmBundles.indexOf(llmBundle);
    const attemptedStrongSongBundles = new Set(
      llmBundles.slice(0, initialBundleIndex >= 0 ? initialBundleIndex + 1 : 1)
    );
    const tryNextStrongSongProvider = async () => {
      if (mode !== 'song' || !requiresStrongSongModel || !Array.isArray(llmBundles) || !llmBundle) return null;
      for (const alternateBundle of llmBundles) {
        if (attemptedStrongSongBundles.has(alternateBundle)) continue;
        attemptedStrongSongBundles.add(alternateBundle);
        const alternateStart = Date.now();
        try {
          const alternateCompletion = await createVivyBundleCompletion(alternateBundle, completionRequest, {
            deadlineAt: nossenLlmDeadlineAt,
            localAttemptTimeoutMs: Math.max(5000, Number(process.env.VIVY_NOSSEN_LYRICS_LOCAL_TIMEOUT_MS || 40000) || 40000),
            largeLyricsAttemptTimeoutMs: Math.max(10000, Number(process.env.VIVY_NOSSEN_120B_TIMEOUT_MS || 60000) || 60000),
            attemptTimeoutMs: Math.max(3000, Number(process.env.VIVY_NOSSEN_CLOUD_ATTEMPT_TIMEOUT_MS || 8000) || 8000),
          });
          _vivyLlmLatency += Date.now() - alternateStart;
          const alternateRaw = cleanText(alternateCompletion?.choices?.[0]?.message?.content, songResponseMaxChars);
          const alternateProcessed = postProcessVivyAssistantText({
            text: alternateRaw,
            userMessage: message,
            systemPrompt,
            mode,
            maxChars: songResponseMaxChars,
          });
          if (isUsableStrongSongContent(alternateProcessed.content)) {
            return { bundle: alternateBundle, content: alternateProcessed.content };
          }
          console.warn(
            '[vivy-songcraft] provider=%s model=%s weak_output; trying next provider',
            alternateBundle.provider || getVivyProviderFromBaseUrl(alternateBundle.baseURL || ''),
            alternateBundle.model
          );
        } catch (error) {
          _vivyLlmLatency += Date.now() - alternateStart;
          console.warn(
            '[vivy-songcraft] provider=%s model=%s failed status=%s; trying next provider',
            alternateBundle.provider || getVivyProviderFromBaseUrl(alternateBundle.baseURL || ''),
            alternateBundle.model,
            Number(error?.status || error?.response?.status || 0) || 'exception'
          );
        }
      }
      return null;
    };

    const songNeedsRetry = mode === 'song' && (
      looksLikeWeakSongwritingReply(processed.content)
      || !hasVivyChorusSection(processed.content)
      || (requiresStrongSongModel && countVivyChorusSections(processed.content) < 2)
    );
    if (songNeedsRetry) {
      const _retryStart = Date.now();
      if (requiresStrongSongModel) {
        const providerFallback = await tryNextStrongSongProvider();
        if (providerFallback) {
          llmBundle = providerFallback.bundle;
          llmProviderFallback = true;
          assistantCandidate = providerFallback.content;
        } else if (allowEmergencySongcraftFallback) {
          usedSongcraftFallback = true;
          assistantCandidate = buildVivyDirectSongReply({ ...input, message, files, history });
        } else {
          const error = new Error('vivy_song_llm_weak_output');
          error.code = 'vivy_song_llm_weak_output';
          error.status = 502;
          throw error;
        }
        _vivyLlmLatency += Date.now() - _retryStart;
      } else {
      try {
        const retryCompletion = await llmBundle.client.chat.completions.create({
          model: llmBundle.model,
          messages: [
            { role: 'system', content: systemPrompt },
            memoryContext ? { role: 'system', content: `Mémoire Vivy récente:\n${memoryContext}` } : null,
            ...history,
            { role: 'user', content: userContent },
            { role: 'assistant', content: processed.content },
            { role: 'user', content: 'Écris uniquement les paroles complètes, sans explication. Utilise des balises de sections musicales. Le refrain doit apparaître au moins deux fois, dont une fois après le dernier pont, avant la fin.' },
          ].filter(Boolean),
          temperature: Number(process.env.VIVY_CHAT_TEMPERATURE_SONG || process.env.VIVY_CHAT_TEMPERATURE || 0.88),
          max_tokens: songMaxTokens,
        });
        const retryRaw = cleanText(retryCompletion?.choices?.[0]?.message?.content, songResponseMaxChars);
        const retryProcessed = postProcessVivyAssistantText({ text: retryRaw, userMessage: message, systemPrompt, mode, maxChars: songResponseMaxChars });
        if (isUsableStrongSongContent(retryProcessed.content)) {
          llmRetried = true;
          assistantCandidate = retryProcessed.content;
        } else {
          usedSongcraftFallback = true;
          assistantCandidate = buildVivyDirectSongReply({ ...input, message, files, history });
        }
      } catch (_retryErr) {
        usedSongcraftFallback = true;
        assistantCandidate = buildVivyDirectSongReply({ ...input, message, files, history });
      }
      _vivyLlmLatency += Date.now() - _retryStart;
      }
    }

    const assistant = mode === 'song'
      ? buildVivyPublicLyrics(
        { ...input, message, files, history },
        assistantCandidate,
        requiresStrongSongModel ? '' : fallback.publicLyrics,
        {
          allowDeterministicFallback: !requiresStrongSongModel || usedSongcraftFallback,
          requireRepeatedChorus: requiresStrongSongModel && !usedSongcraftFallback,
        }
      )
      : sanitizeVivyPublicText(assistantCandidate, VIVY_CHAT_MAX_CHARS);
    const assistantForOutput = mode === 'song'
      ? (stripVivySingerTagsForPublicLyrics(assistant) || assistant)
      : assistant;
    if (mode === 'song') {
      logVivySongcraftTrace({
        provider: llmBundle.provider || getVivyProviderFromBaseUrl(llmBundle.baseURL || ''),
        model: llmBundle.model,
        source: llmProviderFallback ? 'llm_provider_fallback' : (llmRetried ? 'llm_retry' : (llmBundle.source || 'openai-compatible')),
        fallback: usedSongcraftFallback,
        latencyMs: _vivyLlmLatency,
      });
    } else {
      console.log('[vivy-chat] provider=%s model=%s source=%s latencyMs=%d mode=%s',
        llmBundle.provider || getVivyProviderFromBaseUrl(llmBundle.baseURL || ''),
        llmBundle.model, llmBundle.source || 'openai-compatible', _vivyLlmLatency, mode);
    }
    if (!assistantForOutput) {
      if (requiresStrongSongModel) {
        const error = new Error('vivy_song_llm_empty_output');
        error.code = 'vivy_song_llm_empty_output';
        error.status = 502;
        throw error;
      }
      return {
        ...fallback,
        semanticMemory,
        memoryStored: semanticMemory.stored,
      };
    }

    rememberVivyEpisode(userId, 'vivy_reply', assistantForOutput, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      internalNossenDraft: requiresStrongSongModel,
    });

    return {
      ...fallback,
      assistant: assistantForOutput,
      content: assistantForOutput,
      publicText: assistantForOutput,
      publicLyrics: mode === 'song' ? assistantForOutput : undefined,
      vocalLyrics: mode === 'song' ? assistant : undefined,
      aiMode: usedSongcraftFallback
        ? 'deterministic_fallback'
        : llmRetried
          ? 'llm_retry'
          : webResearch
            ? 'llm_web_research'
            : 'llm',
      model: llmBundle.model,
      provider: llmBundle.provider || getVivyProviderFromBaseUrl(llmBundle.baseURL || ''),
      ...(webResearch ? {
        webSearch: webResearch.webSearch,
        actions: [
          ...(Array.isArray(fallback.actions) ? fallback.actions : []),
          { id: 'web_search', label: 'Recherche web', target: 'a11-web-search', ready: true, query: webResearch.webSearch.query },
        ],
      } : {}),
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  } catch (error) {
    if (requiresStrongSongModel) {
      if (allowEmergencySongcraftFallback) {
        const emergencyDraft = buildVivyDirectSongReply({
          ...input,
          message,
          files,
          history: [],
        });
        const emergencyVocalLyrics = buildVivyPublicLyrics(
          { ...input, message, files, history: [] },
          emergencyDraft,
          fallback.publicLyrics,
          {
            allowDeterministicFallback: true,
            requireRepeatedChorus: false,
          }
        );
        const emergencyPublicLyrics = stripVivySingerTagsForPublicLyrics(emergencyVocalLyrics)
          || emergencyVocalLyrics
          || fallback.publicLyrics;
        logVivySongcraftTrace({
          provider: 'deterministic',
          model: 'vivy-songcraft-v1',
          source: 'nossen_deadline_fallback',
          fallback: true,
          latencyMs: 0,
        });
        rememberVivyEpisode(userId, 'vivy_reply', emergencyPublicLyrics, {
          mode: 'song',
          conversationId: cleanOneLine(input.conversationId, '', 120),
          internalNossenDraft: true,
          deterministic: true,
          llmError: cleanOneLine(error?.code || error?.message || error, 'vivy_llm_failed', 120),
        });
        return {
          ...fallback,
          assistant: emergencyPublicLyrics,
          content: emergencyPublicLyrics,
          publicText: emergencyPublicLyrics,
          publicLyrics: emergencyPublicLyrics,
          vocalLyrics: emergencyVocalLyrics,
          aiMode: 'deterministic_fallback',
          model: 'vivy-songcraft-v1',
          provider: 'deterministic',
          language,
          files,
          semanticMemory,
          memoryStored: semanticMemory.stored,
          llmError: cleanOneLine(error?.code || error?.message || error, 'vivy_llm_failed', 180),
        };
      }
      error.code = error.code || 'vivy_song_llm_failed';
      error.status = error.status || 503;
      throw error;
    }
    return {
      ...fallback,
      language,
      localContext: localContextForResponse,
      semanticMemory,
      memoryStored: semanticMemory.stored,
      llmError: cleanOneLine(error?.message || error, 'vivy_llm_failed', 180),
    };
  }
}

function buildVivyStudioProduction(input) {
  const mode = parseMode(input.mode);
  const language = resolveVivyResponseLanguage(input);
  const production =
    mode === 'voice'
      ? buildVoiceProduction(input)
      : mode === 'share'
        ? buildShareProduction(input)
        : buildSongProduction(input);

  const routing = buildRouting(mode);
  const mediaAgentRoles = getMediaAgentRoleMatrix();
  const mediaPipeline = buildMediaPipeline(mode === 'voice' ? 'audio' : mode === 'share' ? 'share' : 'song', {
    withAudio: true,
  });
  const handoff = [
    production.brief,
    '',
    'Routage:',
    lineList(routing),
  ].join('\n');
  const safeHandoff = cleanVivyAgentBrief(handoff, 7000);
  const prosodyPlan = production.prosodyPlan || null;
  const publicLyrics = mode === 'song' && production.publicLyrics
    ? sanitizeVivyPublicLyrics(production.publicLyrics)
    : undefined;
  const arrangement = mode === 'song' && publicLyrics
    ? splitVivyArrangementCues(publicLyrics)
    : { lyrics: '', cues: [], arrangement: '' };
  const publicText = mode === 'song'
    ? (publicLyrics || 'Ajoute un thème, un texte ou des paroles pour lancer la chanson.')
    : sanitizeVivyPublicText(production.publicText || production.summary, 1800);
  const productionPlan = {
    mode,
    title: production.title,
    summary: production.summary,
    actions: production.actions,
    routing,
    hasPublicLyrics: Boolean(publicLyrics),
    prosodySchema: prosodyPlan?.schema || null,
  };

  return {
    ok: true,
    service: 'vivy-studio',
    mode,
    language,
    title: production.title,
    summary: production.summary,
    assistant: publicText,
    content: publicText,
    publicText,
    internalBrief: safeHandoff,
    brief: safeHandoff,
    productionPlan,
    actions: production.actions,
    routing,
    mediaAgentRoles,
    mediaPipeline,
    prosody: prosodyPlan ? {
      schema: prosodyPlan.schema,
      id: prosodyPlan.id,
      model: prosodyPlan.model,
      summary: prosodyPlan.summary,
      cast: prosodyPlan.cast,
      primeSignature: prosodyPlan.primeSignature,
      complexBasis: prosodyPlan.complexBasis,
      doubleHarmonic: prosodyPlan.doubleHarmonic,
      neo4j: prosodyPlan.neo4j,
      segments: prosodyPlan.segments.map((segment) => ({
        id: segment.id,
        order: segment.order,
        label: segment.label,
        kind: segment.kind,
        roleId: segment.roleId,
        roleLabel: segment.roleLabel,
        prime: segment.prime,
        real: segment.real,
        imaginary: segment.imaginary,
        magnitude: segment.magnitude,
        phase: segment.phase,
        pace: segment.pace,
        breath: segment.breath,
        derivative: segment.derivative,
      })),
    } : null,
    orchestration: {
      mode: 'funesterie-media-roles-v1',
      intent: mode,
      promptOwner: mediaAgentRoles.prompt.primary,
      artDirectionOwner: mediaAgentRoles.art_direction.primary,
      audioOwner: mediaAgentRoles.audio.primary,
      imageOwner: mediaAgentRoles.image.primary,
      videoOwner: mediaAgentRoles.video.primary,
      audioQaOwner: mediaAgentRoles.audio_qa.primary,
      visionQaOwner: mediaAgentRoles.vision_qa.primary,
      clientHandoffOwner: mediaAgentRoles.client_handoff.primary,
    },
    publicLyrics,
    vocalLyrics: mode === 'song' ? arrangement.lyrics : undefined,
    vocalSegments: mode === 'song' ? (production.vocalSegments || []) : undefined,
    arrangementCues: mode === 'song' ? arrangement.cues : undefined,
    tokenStored: false,
  };
}

function appendMediaToAssistant(assistant = '', media = null) {
  if (!media?.url) return assistant;
  const label = media.kind === 'video'
    ? 'Clip vidéo de secours'
    : 'Maquette audio Vivy';
  return [
    assistant,
    '',
    'Média prêt:',
    `- ${label}: ${media.url}`,
  ].join('\n');
}

function shouldAttachPlaceholderMedia(input = {}) {
  const explicit = String(
    input.allowPlaceholderMedia
    ?? input.allowEmergencyMedia
    ?? input.demoMedia
    ?? ''
  ).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  if (input.disableEmergencyMedia === true || input.disableMedia === true) return false;
  return String(process.env.VIVY_STUDIO_ENABLE_PLACEHOLDER_MEDIA || '').trim() === '1';
}

async function buildEmergencyMediaForProduction(mode, input, req) {
  // #old version guard: the 12s emergency WAV is a placeholder, not real music generation.
  // Keep it opt-in so Vivy never pretends that the music pipeline produced a final track.
  if (!shouldAttachPlaceholderMedia(input)) return null;
  if (input.disableEmergencyMedia === true || input.disableMedia === true) return null;
  if (mode === 'song' || mode === 'voice') {
    // Carry the selected casting voice all the way to the placeholder generator
    // so the fallback reflects the real persona instead of a generic A11 file.
    const artistCast = buildVivySongArtistCast(input);
    const catalogVoiceName = cleanOneLine(input.voiceCatalogName || input.catalogVoiceName, '', 80);
    const voiceProfile = getVivyStudioVoiceProfile(input);
    const voicePersona = catalogVoiceName
      ? 'catalog'
      : (Array.isArray(artistCast.ids) && artistCast.ids.length ? artistCast.ids.join('-') : 'vivy');
    const voiceLabel = catalogVoiceName || artistCast.label || voiceProfile.label || 'Vivy';
    return createEmergencySongAsset({
      ...input,
      voicePersona,
      voiceLabel,
      voiceProfileId: voiceProfile.id || voicePersona,
    }, req);
  }
  if (mode === 'share') {
    return createEmergencyVideoAsset({
      prompt: input.shareInstruction || input.prompt || input.theme || input.songText || 'Vivy scène partage Funesterie',
      body: {
        ...input,
        durationSeconds: input.durationSeconds || 4,
        fps: input.fps || 12,
        width: input.width || 512,
        height: input.height || 512,
      },
      req,
    });
  }
  return null;
}

function buildVivyMusicPrompt(input = {}) {
  const source = cleanOneLine(input.songSource || input.source, 'Theme', 80);
  const artistCast = buildVivySongArtistCast(input);
  const requestedMood = cleanOneLine(stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style), '', 180);
  const mood = looksLikeVivySunoStylePlaceholder(requestedMood)
    ? inferVivySunoStyleBase(input, artistCast)
    : requestedMood;
  const voiceProfile = getVivyStudioVoiceProfile(input);
  const catalogVoiceName = cleanOneLine(input.voiceCatalogName || input.catalogVoiceName, '', 80);
  const prosodyPlan = buildVivyProsodyPlan(input);
  const prosodyPrompt = formatVivyProsodyPlanForPrompt(prosodyPlan);
  const songMaterial = sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(
      input.songText || input.lyrics || input.text || input.theme || input.prompt,
      VIVY_SONG_MAX_CHARS
    ),
    VIVY_SONG_MAX_CHARS
  );
  const arrangement = splitVivyArrangementCues(songMaterial);
  const forceInstrumental = input.instrumental === true || input.forceInstrumental === true;
  const lyrics = forceInstrumental ? '' : buildVivyStructuredLyrics({
    ...input,
    songText: arrangement.lyrics,
  });
  const prompt = [
    forceInstrumental
      ? 'Original instrumental Funesterie score, French production context.'
      : artistCast.musicLead,
    `Source: ${source}.`,
    `Style and production: ${mood}.`,
    forceInstrumental
      ? 'Vocal cast: none. Instrumental only, no vocals, no singing, no spoken narration.'
      : `Vocal cast: ${artistCast.countLabel}: ${artistCast.label}. ${artistCast.musicMood}`,
    !forceInstrumental && catalogVoiceName
      ? `Authorized voice catalog: ${catalogVoiceName}. Use it only as a consented original voice direction; never imitate a celebrity or expose raw reference audio.`
      : !forceInstrumental
        ? `Voice direction: ${voiceProfile.referenceLabel}. Original voice only; no celebrity imitation.`
        : '',
    forceInstrumental ? '' : prosodyPrompt,
    arrangement.cues.length
      ? `Instrumental arrangement cues: ${arrangement.arrangement}. Use these only for the backing music; never sing or speak these directions.`
      : '',
    forceInstrumental
      ? 'Instrumental only. No vocals, spoken words, narration, or sung directions.'
      : 'Lyrics must be sung, not spoken. Use the provided sections as real lyrics.',
    forceInstrumental ? '' : `Lyrics:\n${lyrics}`,
    'Arrangement: intro, verse, pre-chorus, memorable chorus, second verse, bridge, chorus, clean ending. Web-ready, no copyrighted melody.',
  ].filter(Boolean).join('\n');
  return cleanText(prompt, 4000);
}

function countVivySonicWords(value = '') {
  const folded = foldTextForLookup(value);
  if (!folded) return 0;
  return (folded.match(/\b(?:anime|opening|generique|générique|aventure|latin|flamenco|western|orchestral|orchestral pop|cinematic|cinematique|cinématique|pop|rock|rap|metal|electro|synth|synthes?|basse|bass|guitare|guitar|drums?|batterie|percussion|piano|cordes|strings?|choeurs?|chœurs?|trompettes?|cuivres?|cloches?|palmas|castagnettes?|glitch|ballade|anthem|heroique|héroïque|tournoi|spirale|tournoyante|racing|peloton)\b/g) || []).length;
}

function looksLikeVivySunoStylePlaceholder(value = '') {
  const folded = foldTextForLookup(value);
  if (!folded) return true;
  if (/\bcouleur\s+sonore\s+choisie\s+depuis\s+le\s+contexte\b/.test(folded)) return true;
  if (/\b(?:electro|électro)\s+pop\s+(?:dark|sombre)\s+cinematographique\b/.test(folded)
    && countVivySonicWords(folded) <= 4) return true;
  if (/\bchanson\s+complete\s+2m30\s+a\s+5m00\b/.test(folded)
    && countVivySonicWords(folded) < 3) return true;
  return false;
}

function buildVivySunoStyleMaterial(input = {}) {
  return cleanText([
    input.songTitle,
    input.title,
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
    input.message,
    input.prompt,
  ].filter(Boolean).join('\n'), 2600);
}

function inferVivyAnimeSunoStyle(folded = '') {
  if (/\bbleach\b|\bichigo\b|\brukia\b|\borihime\b|\bishida\b|\baizen\b|\bzanpakuto\b|\bshinigami\b|\bsoul\s+society\b|\bhollow\b|\bgetsuga\b|\barrancar\b/.test(folded)) {
    return 'dark shonen anime opening in the spirit of Bleach, energetic J-rock, sharp electric guitars, fast drums, tense bass, nocturnal synths, explosive heroic chorus, no French chanson, no acoustic ballad';
  }
  if (/\bkirito\b|\bsword\s+art\s+online\b|\bsao\b|\baincrad\b|\basuna\b|\balfheim\b/.test(folded)) {
    return 'anime opening J-rock and J-pop rock, fast drums, bright guitars, heroic synths, tense verses, massive memorable chorus';
  }
  if (/\banime\b|\bmanga\b|\bshonen\b|\bshônen\b|\bisekai\b|\bopening\b|\bgenerique\b|\bgénérique\b/.test(folded)) {
    return 'modern anime opening, energetic J-rock, clear guitars, driving drums, bright synths, wide memorable chorus';
  }
  return '';
}

function looksLikeWeakVivyAnimeSunoStyle(value = '') {
  const folded = foldTextForLookup(value);
  if (!folded) return true;
  if (/\b(?:patrick\s+bruel|bruel|variete|variété|chanson\s+francaise|chanson\s+française|ballade|piano\s+doux|acoustique|classique|symphonique|crooner|slow|romantique|folk\s+doux)\b/.test(folded)) return true;
  return !/\b(?:anime|j\s*rock|j\s*pop|rock|metal|guitare|guitar|drums?|batterie|basse|synth|shonen|shônen|opening|generique|générique)\b/.test(folded);
}

function sanitizeVivySunoProviderTags(value = '', fallback = '', max = 720) {
  return cleanOneLine(String(value || '')
    .replace(/\bpatrick\s+bruel\b/gi, 'French chanson crooner')
    .replace(/\bbruel\b/gi, 'French chanson crooner')
    .replace(/\bjohnny\s+hallyday\b/gi, 'French rock anthem')
    .replace(/\bhallyday\b/gi, 'French rock anthem')
    .replace(/\b(?:booba|pnl|stromae|damso|orelsan|nekfeu|jul|gims|soprano|aya\s+nakamura)\b/gi, 'contemporary French urban vocal')
    .replace(/\b(?:myl[eè]ne\s+farmer|farmer|indochine|renaud|aznavour|brel|piaf)\b/gi, 'classic French pop texture'),
    fallback,
    max
  );
}

function inferVivySunoStyleBase(input = {}, artistCast = buildVivySongArtistCast(input)) {
  const material = buildVivySunoStyleMaterial(input);
  const folded = foldTextForLookup(material);
  const fallbackTopic = cleanOneLine(inferTitle(material), '', 72);
  const withCastStyle = (style) => sanitizeVivySunoProviderTags([
    artistCast.sunoStyle,
    style,
  ].filter(Boolean).join(', '), style || artistCast.sunoStyle, 720);

  if (/\bzorro\b|\bjusticier\b|\bmasque\b|\bepee\b|\bépée\b|\bcheval\s+noir\b|\bcalifornie\b/.test(folded)) {
    return withCastStyle('latin cinematic pop-rock, guitare espagnole, palmas, castagnettes, trompettes western, batterie héroïque');
  }
  if (/\bpeter\s+pan\b|\bclochette\b|\bcrochet\b|\bneverland\b|\bpays\s+imaginaire\b|\bcrocodile\b|\btic\s*tac\b|\bpirate\b/.test(folded)) {
    return withCastStyle('anime opening aventure, orchestral pop aérien, cloches féeriques, choeurs légers, batterie vive');
  }
  const animeStyle = inferVivyAnimeSunoStyle(folded);
  if (animeStyle) return withCastStyle(animeStyle);
  if (/\btoupie\b|\bbeyblade\b|\blanceurs?\b|\bduel\b.{0,40}\btourne\b|\bspin\b|\bspinning\b/.test(folded)) {
    return withCastStyle('electro pop tournoi, percussion tournoyante, basse ronde, claps rapides, synthés spirale, hook énergique');
  }
  if (/\bcycliste\b|\bcyclisme\b|\bvelo\b|\bvélo\b|\bpodium\b|\bpeloton\b|\balgerie\b|\balgérie\b|\betape\b|\bétape\b/.test(folded)) {
    return withCastStyle('road movie pop-rock, batterie roulante, basse motrice, guitares ouvertes, cuivres de podium, souffle de peloton');
  }
  if (/\bdbz\b|\bdragon\s*ball\b|\bsuper\s*saiyan\b|\bspider[-\s]?man\b|\bavengers?\b|\bmarvel\b|\bdc\s+comics?\b|\bheros\b|\bhéros\b|\banime\b/.test(folded)) {
    return withCastStyle('anime opening héroïque, pop-rock cinématique, batterie massive, guitares claires, choeurs larges, montée frisson');
  }
  if (/\btroie\b|\bhelene\b|\bhélène\b|\bcheval\s+de\s+troie\b|\bmythe\b|\bmytholog/.test(folded)) {
    return withCastStyle('mythological electro-rock, tambours solennels, cordes dramatiques, synthés profonds, vocal héroïque');
  }
  if (/\b(?:moto|scooter|booster|guidon|casque|visiere|visière)\b/.test(folded)
    && /\b(?:5\s*etoiles|5\s*étoiles|etoiles|étoiles|helico|hélico|helicos|hélicos|gyros?|sirene|sirène|sirenes|sirènes|comico|poursuite|fuite|neons|néons)\b/.test(folded)) {
    return withCastStyle('rap français trap sombre NOSSEN, 808 lourdes, drums secs, sirènes et gyros en texture, synthés nocturnes, adlibs courts, refrain brutal et mémorable, énergie poursuite moto');
  }
  if (/\bmoto\b|\bscooter\b|\bpignon\b|\bcouronne\b|\bradiateur\b|\bchaine\b|\bchaîne\b|\bmoteur\b|\bessence\b|\bhuile\b|\bstunt\b|\bguidon\b|\bcasque\b|\bvisiere\b|\bvisière\b/.test(folded)) {
    return withCastStyle('technical rap moto, basse lourde, drums secs, guitares garage, engine pulse, hook proche micro');
  }
  if (hasVivyNossenConflictRapSignal(material)) {
    return withCastStyle('rap français egotrip/cypher sombre façon clips Djeff, voix masculine sèche proche micro, punchlines de clash, 808 lourdes, drums secs, terminal noir, énergie serveurs/briques/moteur, refrain court sans romance, aucun refrain anglais');
  }
  if (/\becrans?\b|\bécrans?\b|\bnouvelle\s+generation\b|\bnouvelle\s+génération\b|\breseaux\b|\bréseaux\b|\bnumerique\b|\bnumérique\b/.test(folded)) {
    return withCastStyle('modern alt-pop numérique, basses rondes, pads granuleux, percussion glitch, hook humain');
  }
  if (/\bamour\b|\bjardin\b|\bfleurs?\b|\bfloral\b|\bromantique\b|\bcoeur\b|\bcœur\b/.test(folded)) {
    return withCastStyle('ballade pop romantique, piano doux, cordes chaudes, batterie légère, voix proche');
  }

  if (fallbackTopic && fallbackTopic !== 'Sans titre') {
    return withCastStyle(`French adaptive original production shaped around ${fallbackTopic}, concrete sonic motifs from the story, dynamic chorus, modern mix`);
  }
  return artistCast.sunoStyle;
}

function buildVivySunoLyrics(input = {}) {
  const primaryMaterial = compactUniqueLines([
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
  ], VIVY_SONG_MAX_CHARS);
  const material = sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(primaryMaterial || input.prompt, VIVY_SONG_MAX_CHARS),
    VIVY_SONG_MAX_CHARS
  );
  const arrangement = splitVivyArrangementCues(material);
  if (looksLikeExplicitSunoLyricsBlock(arrangement.lyrics) || looksLikeCompleteLyrics(arrangement.lyrics)) {
    const repaired = cleanText(
      repairVivySemanticImageCoherence(restoreVivyFrenchSongAccents(arrangement.lyrics), material),
      VIVY_SONG_MAX_CHARS
    );
    return sanitizeVivyProviderCleanLyrics(repaired, VIVY_SONG_MAX_CHARS) || repaired;
  }

  const structuredMaterial = cleanText(String(arrangement.lyrics || '')
    .split(/\r?\n/)
    .map((line) => stripSongCommand(line))
    .filter(Boolean)
    .join('\n'), VIVY_SONG_MAX_CHARS);
  const structuredLyrics = buildVivyStructuredLyrics({
    ...input,
    songText: repairVivySemanticImageCoherence(structuredMaterial || arrangement.lyrics, material),
  });
  return sanitizeVivyProviderCleanLyrics(structuredLyrics, VIVY_SONG_MAX_CHARS) || structuredLyrics;
}

function wantsVivyExternalVoiceMix(input = {}) {
  return (input.forceExternalVoiceMix === true
    || input.externalVoiceMix === true
    || envFlag('VIVY_FORCE_EXTERNAL_VOICE_MIX'))
    && input.allowExternalVoiceMix !== false
    && input.instrumental !== true
    && input.forceInstrumental !== true;
}

function wantsVivySunoLongForm(input = {}) {
  const target = Number(input.targetDurationSeconds || input.target_duration_seconds || input.durationTargetSeconds || 0);
  return input.longSong === true
    || input.long_song === true
    || input.fullLengthSong === true
    || input.full_length_song === true
    || (Number.isFinite(target) && target >= 240);
}

function resolveVivySunoRequestedModel(input = {}) {
  const longModel = wantsVivySunoLongForm(input)
    ? cleanOneLine(process.env.VIVY_SUNO_LONG_MODEL || 'V5_5', 'V5_5', 40)
    : '';
  return cleanOneLine(input.musicModel || longModel || process.env.VIVY_SUNO_MODEL || 'V5_5', 'V5_5', 40);
}

function wantsVivyInstrumentalSoundDesign(input = {}) {
  const folded = foldTextForLookup([
    input.songMood,
    input.mood,
    input.style,
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.prompt,
    input.message,
    input.instruction,
  ].filter(Boolean).join('\n'));
  return /\b(?:bruitage|bruitages|bruits?\s+sonores?|sfx|sound\s+effects?|foley|sound\s+design|ambiance\s+sonore|field\s+recording|diegetic|diegetique|diégétique)\b/.test(folded);
}

function buildVivyInstrumentalSoundDesignHint(input = {}) {
  const folded = foldTextForLookup(buildVivySunoStyleMaterial(input));
  const requested = wantsVivyInstrumentalSoundDesign(input);
  const hints = [];
  if (requested) {
    hints.push('requested sound design: concrete foley, diegetic ambience, impacts and transitions integrated rhythmically');
  }
  if (/\bcowboy\b|\bcow\s*boy\b|\bsherif\b|\bshérif\b|\bwestern\b|\bduel\b|\bsaloon\b|\bcheval\b|\brevolver\b|\bdesert\b|\bdésert\b|\bpoussiere\b|\bpoussière\b/.test(folded)) {
    hints.push('western foley palette: desert wind, horse steps, spurs, leather creaks, saloon door, revolver cock, distant bell, dry whistle, acoustic guitar motif');
  }
  return cleanOneLine(hints.join(', '), '', 420);
}

function buildVivyInstrumentalSunoPrompt(input = {}, title = '') {
  const material = sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens([
      input.songText,
      input.text,
      input.theme,
      input.prompt,
      input.message,
      input.instruction,
    ].filter(Boolean).join('\n\n'), VIVY_SONG_MAX_CHARS),
    VIVY_SONG_MAX_CHARS
  );
  return cleanText([
    `Instrumental scenario: ${material || title || 'original scene'}.`,
    'No lyrics. No sung words. No spoken words. No rap lead. No narration.',
    'Tell the story through arrangement, motifs, dynamics, silence, impacts, texture and sound effects only.',
    buildVivyInstrumentalSoundDesignHint(input),
    'Keep it musical and structured: intro, development, tension rise, dramatic peak, clean ending.',
  ].filter(Boolean).join('\n'), 3000);
}

const SUNO_CUSTOM_MODE_MAX_LYRICS_CHARS = 4900;

function clampVivySunoLyricsLength(lyrics = '', maxChars = SUNO_CUSTOM_MODE_MAX_LYRICS_CHARS) {
  const text = String(lyrics || '');
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastSection = head.lastIndexOf('\n[');
  const lastBreak = head.lastIndexOf('\n\n');
  const boundary = Math.max(lastSection, lastBreak);
  const fallbackNewline = head.lastIndexOf('\n');
  const kept = boundary > maxChars * 0.5
    ? head.slice(0, boundary)
    : head.slice(0, fallbackNewline > 0 ? fallbackNewline : maxChars);
  console.warn(
    '[VivySunoPayload] lyrics clamped for custom mode: %s -> %s chars',
    text.length,
    kept.trim().length
  );
  return kept.trim();
}

function buildVivySunoPayload(input = {}, req = null) {
  const artistCast = buildVivySongArtistCast(input);
  const forceInstrumental = input.instrumental === true || input.forceInstrumental === true || input.previewInstrumental === true;
  const singleArtistId = artistCast.count === 1 ? cleanOneLine(artistCast.ids[0], '', 40).toLowerCase() : '';
  const officialSunoArtistIds = new Set(['vivy', 'djeff', 'marvin', 'a11', 'k44', 'kaen44']);
  const configuredOfficialVoiceId = officialSunoArtistIds.has(singleArtistId)
    ? resolveConfiguredVivySunoPersonaVoiceId(singleArtistId)
    : '';
  const preserveSelectedVoice = input.preserveSelectedVoice === true
    || (input.preserveSelectedVoice !== false && Boolean(configuredOfficialVoiceId));
  const personalSunoVoice = preserveSelectedVoice && artistCast.count === 1 && !forceInstrumental
    ? resolvePersonalSunoVoiceIdForPayload(input, req)
    : null;
  const explicitVoiceId = cleanOneLine(input.sunoVoiceId, '', 180);
  const sunoAccess = getSunoAccess(input, req);
  const serverVoiceId = sunoAccess.source === 'server'
    ? resolveConfiguredVivySunoPersonaVoiceId(singleArtistId || 'vivy')
    : '';
  const preferConfiguredOfficialVoice = Boolean(serverVoiceId)
    && officialSunoArtistIds.has(singleArtistId)
    && (singleArtistId === 'djeff' || !wantsPersonalSunoVoice(input));
  const verifiedVoiceId = preferConfiguredOfficialVoice
    ? serverVoiceId
    : (personalSunoVoice?.voiceId || explicitVoiceId || serverVoiceId);
  const useVerifiedSunoVoice = preserveSelectedVoice
    && artistCast.count === 1
    && (Boolean(personalSunoVoice?.voiceId) || officialSunoArtistIds.has(singleArtistId))
    && Boolean(verifiedVoiceId)
    && !forceInstrumental;
  const useExternalVoiceMix = preserveSelectedVoice
    && !useVerifiedSunoVoice
    && !forceInstrumental
    && wantsVivyExternalVoiceMix(input);
  const prosodyPlan = buildVivyProsodyPlan(input);
  const prosodyStyle = buildVivyProsodyStyleHint(prosodyPlan);
  const rawTitleMaterial = sanitizeVivySongMaterial(stripVivyAscii4SoundTokens(input.songText || input.theme || input.prompt), 1200);
  const titleMaterial = splitVivyArrangementCues(rawTitleMaterial).lyrics;
  const titleSeed = cleanOneLine(
    input.songTitle || input.title || inferTitle(titleMaterial),
    'Sans titre',
    72
  ).replace(/^["'“”]+|["'“”]+$/g, '');
  const title = cleanOneLine(titleSeed, 'Sans titre', 80);
  const requestedStyleBase = sanitizeVivySunoProviderTags(
    stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style),
    '',
    420
  );
  const sunoStyleMaterialFolded = foldTextForLookup(buildVivySunoStyleMaterial(input));
  const animeStyleBase = inferVivyAnimeSunoStyle(sunoStyleMaterialFolded);
  const styleBase = looksLikeVivySunoStylePlaceholder(requestedStyleBase)
    ? inferVivySunoStyleBase(input, artistCast)
    : animeStyleBase && looksLikeWeakVivyAnimeSunoStyle(requestedStyleBase)
      ? sanitizeVivySunoProviderTags([artistCast.sunoStyle, animeStyleBase].filter(Boolean).join(', '), animeStyleBase, 520)
    : requestedStyleBase;
  const castRoles = artistCast.artists
    .map((artist) => cleanOneLine(artist.sunoRole || artist.style, '', 80)
      .replace(/\s+with\b.*$/i, '')
      .replace(/,\s*.*$/g, '')
      .trim())
    .filter(Boolean)
    .join(' versus ');
  const castRoleSummary = artistCast.count > 1
    ? `vocal roles: ${castRoles}; never merge them into one voice; ${artistCast.count} clearly different vocal timbres; solo handoff; one vocalist at a time; switch singer timbre at every role tag; brief call-and-response hook only`
    : '';
  const castStyle = artistCast.count > 1
    ? ''
    : `${artistCast.label} vocal lead: ${artistCast.artists[0]?.style || artistCast.label}`;
  const personalSunoVoiceStyle = personalSunoVoice?.voiceId
    ? 'selected account Suno voice persona as the only lead vocal, preserve the linked personal timbre, no random replacement singer'
    : '';
  const soloDjeffStyle = singleArtistId === 'djeff'
    ? 'Solo Djeff only, Djeff Cypher voice persona, dry gritty French male rap lead, close-mic punchline delivery, nervous controlled technical flow, dark 808 trap drums, terminal noir neon, server-room tension, road and motor mechanics, short brutal rap hook, no female vocal, no romantic pop singing, no soft ballad chorus, ninjutsu hand sign energy before each verse, biting fingers aggression, summoning jutsu cypher pressure, shadow clone flow switching, chakra burning in the grain'
    : '';
  const soloMarvinStyle = singleArtistId === 'marvin'
    ? 'Solo Marvin only, Marvin family Suno voice persona, natural French male lead, close-mic melodic rap tone, confident brother energy, clear French diction, no female vocal, no random replacement singer, no celebrity imitation'
    : '';
  const arrangement = splitVivyArrangementCues(sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(input.songText || input.lyrics || input.text || input.theme || input.prompt),
    VIVY_SONG_MAX_CHARS
  ));
  const arrangementStyle = arrangement.cues.length
    ? `instrumental arrangement: ${arrangement.arrangement}; never sing or speak arrangement directions`
    : '';
  const soundDesignStyle = forceInstrumental ? buildVivyInstrumentalSoundDesignHint(input) : '';
  const longFormStyle = wantsVivySunoLongForm(input)
    ? 'long-form full song arrangement around five minutes, expanded sections, recurring hook after the bridge, complete final chorus, no short radio edit'
    : '';
  const frenchLanguageStyle = forceInstrumental || useExternalVoiceMix
    ? ''
    : 'French lyrics only, French language vocals, no English lyrics, no English chorus';
  const vocalDeliveryStyle = singleArtistId === 'djeff'
    ? 'rap hook, rap vocals, no melodic pop singing'
    : 'melodic chorus, sung vocals';
  let style = /structured rhymed lyrics|rimes|paroles structur/i.test(styleBase)
    ? sanitizeVivySunoProviderTags([styleBase, frenchLanguageStyle, castRoleSummary, soloDjeffStyle, soloMarvinStyle, personalSunoVoiceStyle, longFormStyle, castStyle, arrangementStyle, prosodyStyle].filter((item, index, list) => item && list.indexOf(item) === index).join(', '), styleBase, 720)
    : sanitizeVivySunoProviderTags(
      `${styleBase}, ${frenchLanguageStyle}, structured rhymed lyrics, ${vocalDeliveryStyle}, no spoken narration${castRoleSummary ? `, ${castRoleSummary}` : ''}${soloDjeffStyle ? `, ${soloDjeffStyle}` : ''}${soloMarvinStyle ? `, ${soloMarvinStyle}` : ''}${personalSunoVoiceStyle ? `, ${personalSunoVoiceStyle}` : ''}${longFormStyle ? `, ${longFormStyle}` : ''}${castStyle ? `, ${castStyle}` : ''}${arrangementStyle ? `, ${arrangementStyle}` : ''}${prosodyStyle ? `, ${prosodyStyle}` : ''}`,
      styleBase,
      720
    );
  if (forceInstrumental) {
    style = sanitizeVivySunoProviderTags([
      styleBase,
      arrangementStyle,
      soundDesignStyle,
      longFormStyle,
      'instrumental score only, no vocals, no singing, no lyrics, no spoken narration, no rap lead',
      'musical sound design and foley allowed when requested',
    ].filter(Boolean).join(', '), 'instrumental score only, no vocals', 720);
  } else if (useExternalVoiceMix) {
    style = sanitizeVivySunoProviderTags([
      styleBase,
      arrangementStyle,
      longFormStyle,
      'instrumental backing track only, no vocals, no singing, leave clear space for the external lead vocal',
      prosodyStyle,
    ].filter(Boolean).join(', '), 'instrumental backing track only, no vocals', 720);
  }
  const negativeTags = sanitizeVivySunoProviderTags([
    input.negativeTags || process.env.VIVY_SUNO_NEGATIVE_TAGS
      || 'spoken word, narration, reading prompt, robotic speech, muddy mix, out of tune vocals, copyrighted melody, celebrity voice imitation',
    animeStyleBase ? 'French chanson, chanson française, acoustic ballad, crooner ballad, soft piano variety' : '',
    singleArtistId === 'djeff' ? 'female vocals, female lead, romantic pop vocal, soft ballad chorus, crooner voice, airy female hook' : '',
    singleArtistId === 'marvin' ? 'female vocals, female lead, child voice, random vocalist, celebrity voice imitation, English lead vocal' : '',
    personalSunoVoice?.voiceId ? 'random vocalist, replacement singer, celebrity voice imitation, different lead timbre' : '',
    !forceInstrumental && !useExternalVoiceMix ? 'English lyrics, English vocals, English chorus, translated chorus, bilingual lyrics' : '',
    artistCast.count > 1 ? 'single vocalist, identical vocal timbre for every singer, blended ensemble lead, unison lead vocals, choir lead, group chant replacing solos, same singer across all tags' : '',
    useExternalVoiceMix ? 'vocals, singing, spoken voice' : '',
    forceInstrumental ? 'vocals, singing, lyrics, sung words, spoken words, rap lead, narration, choir lead, group chant' : '',
  ].filter(Boolean).join(', '), 'spoken word, narration', 520);
  const requestedModel = resolveVivySunoRequestedModel(input);
  const prompt = forceInstrumental
    ? buildVivyInstrumentalSunoPrompt({ ...input, songTitle: input.songTitle || input.title || title }, title)
    : clampVivySunoLyricsLength(strengthenVivySunoSoloSectionHeaders(
      buildVivySunoLyrics({ ...input, songTitle: input.songTitle || input.title || title }),
      artistCast
    ));
  const payload = {
    model: useVerifiedSunoVoice && !/^V5(?:_5)?$/i.test(requestedModel) ? 'V5_5' : requestedModel,
    customMode: true,
    instrumental: forceInstrumental || useExternalVoiceMix,
    title,
    style,
    prompt,
    negativeTags,
    callBackUrl: buildSunoCallbackUrl(req),
  };
  if (useVerifiedSunoVoice) {
    payload.personaId = verifiedVoiceId;
    payload.personaModel = 'voice_persona';
  }
  return payload;
}

function getPublicBaseUrl(req = null) {
  const explicit = cleanOneLine(
    process.env.VIVY_PUBLIC_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.A11_PUBLIC_BASE_URL,
    '',
    300
  );
  if (explicit) return explicit.replace(/\/$/, '');
  const host = cleanOneLine(req?.get?.('x-forwarded-host') || req?.get?.('host'), '', 180).split(',')[0];
  if (!host) return '';
  const proto = cleanOneLine(req?.get?.('x-forwarded-proto') || req?.protocol || 'https', 'https', 24).split(',')[0];
  return `${proto}://${host}`.replace(/\/$/, '');
}

function buildSunoCallbackUrl(req = null) {
  const explicit = cleanOneLine(process.env.VIVY_SUNO_CALLBACK_URL || process.env.SUNO_CALLBACK_URL, '', 600);
  const base = explicit || `${getPublicBaseUrl(req)}/api/vivy/studio/suno/callback`;
  const token = cleanOneLine(process.env.VIVY_SUNO_CALLBACK_TOKEN || process.env.SUNO_CALLBACK_TOKEN, '', 180);
  if (!base || !token) return base;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}t=${encodeURIComponent(token)}`;
}

function resolvePublicUploadUrl(value = '', req = null) {
  const raw = cleanOneLine(value, '', 1000);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/')) return '';
  const base = getPublicBaseUrl(req);
  if (!base) return '';
  try {
    return new URL(raw, `${base}/`).toString();
  } catch {
    return '';
  }
}

function resolveSunoUploadExtendUrl(input = {}, req = null) {
  return resolvePublicUploadUrl(
    input.uploadUrl
      || input.upload_url
      || input.sourceUploadUrl
      || input.source_upload_url
      || input.sourceAudioUrl
      || input.source_audio_url
      || input.audioUrl
      || input.audio_url
      || input.url
      || input.sourceUrl
      || input.source_url,
    req
  );
}

function getVivySunoCallbackDir() {
  const root = getCanonicalRuntimeRoot(process.env);
  return path.join(root, 'vivy-suno-callbacks');
}

function sanitizeSunoTaskId(value = '') {
  return cleanOneLine(value, '', 120).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120);
}

function findSunoTaskIdDeep(value, depth = 0) {
  if (!value || depth > 5) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return depth === 0 ? sanitizeSunoTaskId(value) : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSunoTaskIdDeep(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  for (const [key, child] of Object.entries(value)) {
    if (/^task[-_]?id$/i.test(key) || /^taskID$/.test(key)) {
      const found = sanitizeSunoTaskId(child);
      if (found) return found;
    }
  }

  for (const key of ['data', 'result', 'response', 'body', 'record']) {
    if (value[key] !== undefined) {
      const found = typeof value[key] === 'string' || typeof value[key] === 'number'
        ? sanitizeSunoTaskId(value[key])
        : findSunoTaskIdDeep(value[key], depth + 1);
      if (found) return found;
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findSunoTaskIdDeep(child, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function findSunoTaskId(payload) {
  const candidates = [
    payload?.taskId,
    payload?.task_id,
    payload?.id,
    payload?.data?.taskId,
    payload?.data?.task_id,
    payload?.data?.id,
    payload?.response?.taskId,
    payload?.response?.task_id,
    payload?.result?.taskId,
    payload?.result?.task_id,
    payload?.data?.result?.taskId,
    payload?.data?.result?.task_id,
    payload?.data?.response?.taskId,
    payload?.data?.response?.task_id,
  ];
  return sanitizeSunoTaskId(candidates.find(Boolean) || '') || findSunoTaskIdDeep(payload);
}

function findSunoStatus(payload) {
  const candidates = [
    payload?.status,
    payload?.state,
    payload?.data?.status,
    payload?.data?.state,
    payload?.data?.response?.status,
    payload?.response?.status,
    payload?.response?.state,
  ].map((value) => cleanOneLine(value, '', 80)).filter(Boolean);
  return candidates[0] || '';
}

function findSunoApiCode(payload = {}) {
  const raw = [
    payload?.code,
    payload?.statusCode,
    payload?.status_code,
    payload?.data?.code,
    payload?.data?.statusCode,
    payload?.data?.status_code,
    payload?.result?.code,
    payload?.response?.code,
  ].find((value) => value !== undefined && value !== null && value !== '');
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

function findSunoProviderMessage(payload = {}) {
  const candidates = [
    payload?.msg,
    payload?.message,
    payload?.error,
    payload?.errorMessage,
    payload?.error_message,
    payload?.detail,
    payload?.data?.msg,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.errorMessage,
    payload?.result?.msg,
    payload?.result?.message,
    payload?.response?.msg,
    payload?.response?.message,
  ].map((value) => cleanOneLine(value, '', 240)).filter(Boolean);
  return candidates[0] || '';
}

function buildSunoProviderError(code, payload = {}, fallback = 'error') {
  const safeCode = Number.isFinite(Number(code)) ? Number(code) : cleanOneLine(code, fallback, 40);
  const detail = findSunoProviderMessage(payload);
  const error = new Error(`suno_music_api_${safeCode}${detail ? `:${detail}` : ''}`);
  error.code = `suno_music_api_${safeCode}`;
  error.providerDetail = detail;
  return error;
}

function collectSunoTracks(value, tracks = []) {
  if (!value || typeof value !== 'object') return tracks;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSunoTracks(item, tracks));
    return tracks;
  }
  const audioId = cleanOneLine(
    value.audioId
      || value.audio_id
      || value.id
      || value.songId
      || value.song_id
      || value.clipId
      || value.clip_id,
    '',
    160
  );
  const rawDuration = Number(
    value.duration
      ?? value.durationSeconds
      ?? value.duration_seconds
      ?? value.audioDuration
      ?? value.audio_duration
      ?? 0
  );
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;
  const audioUrl = cleanOneLine(
    value.audioUrl
      || value.audio_url
      || value.streamAudioUrl
      || value.stream_audio_url
      || value.sourceAudioUrl
      || value.source_audio_url
      || value.sourceStreamAudioUrl
      || value.source_stream_audio_url
      || value.downloadUrl
      || value.download_url
      || value.musicUrl
      || value.music_url
      || value.songUrl
      || value.song_url
      || value.playUrl
      || value.play_url
      || value.url,
    '',
    1000
  );
  if (audioUrl && /^https?:\/\//i.test(audioUrl)) {
    tracks.push({
      kind: 'audio',
      provider: 'suno',
      mode: 'async_music_generation',
      id: audioId || undefined,
      audioId: audioId || undefined,
      audio_id: audioId || undefined,
      title: cleanOneLine(value.title || value.name, 'Chanson Vivy', 120),
      url: audioUrl,
      audioUrl,
      audio_url: audioUrl,
      content_type: 'audio/mpeg',
      imageUrl: cleanOneLine(value.imageUrl || value.image_url || value.sourceImageUrl, '', 1000),
      model: cleanOneLine(value.model || value.modelName || value.model_name, '', 80),
      tags: cleanOneLine(value.tags || value.style || value.metadata?.tags, '', 500),
      prompt: sanitizeVivySongMaterial(value.prompt || value.lyrics || value.gpt_description_prompt, 1200),
      duration: durationSeconds,
      durationSeconds,
      generatedAt: new Date().toISOString(),
    });
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectSunoTracks(child, tracks);
  }
  return tracks;
}

function clampVivyScore(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function scoreVivySunoDuration(durationSeconds) {
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) return 0.45;
  if (duration >= 240 && duration <= 390) return 1;
  if (duration >= 180 && duration < 240) return 0.72 + ((duration - 180) / 60) * 0.18;
  if (duration > 390 && duration <= 480) return 0.82;
  if (duration >= 120) return 0.58;
  return 0.28;
}

function normalizeVivySunoTargetDuration(input = {}) {
  const raw = Number(
    input.targetDurationSeconds
    ?? input.target_duration_seconds
    ?? input.durationTargetSeconds
    ?? input.duration_target_seconds
    ?? input.minDurationSeconds
    ?? input.min_duration_seconds
    ?? 0
  );
  return Number.isFinite(raw) && raw > 0 ? Math.max(30, Math.min(480, raw)) : 0;
}

function scoreVivySunoDirectorTrack(track = {}) {
  const durationSeconds = Number(track.durationSeconds || track.duration || 0) || 0;
  const model = track.model || track.modelName || track.model_name;
  const text = foldTextForLookup([
    track.title,
    track.tags,
    track.prompt,
    track.style,
    model,
  ].filter(Boolean).join(' '));
  const prompt = String(track.prompt || '').trim();
  const positive = /\b(?:powerful|puissant|emotion|emotional|clean|propre|articulation|memorable|hook|refrain|chorus|dynamic|dynamique|build|rise|montee|vocal|voix|anthem|energetic|coherent|cohesion)\b/.test(text);
  const negative = /\b(?:robotic|robotique|muddy|boueux|spoken|narration|prompt|out of tune|faux|incomprehensible|illisible|noise|bruit|monotone|overloaded|sature|distorted|distordu)\b/.test(text);
  const hasChorus = /\[(?:chorus|refrain|final chorus|pre-chorus|hook)[^\]]*\]/i.test(prompt) || /\b(?:chorus|refrain|hook)\b/.test(text);
  const hasSections = /\[(?:intro|verse|couplet|bridge|pont|outro|chorus|refrain)[^\]]*\]/i.test(prompt);
  const hasVoiceSignal = /\b(?:vocal|voix|singer|chant|duo|trio|quartet|vivy|djeff|k44|a11)\b/.test(text);
  const modelBonus = /^v5(?:_?5)?$/i.test(String(model || '')) ? 0.08 : 0;
  const qualityMusicale = clampVivyScore(0.54 + modelBonus + (positive ? 0.22 : 0) - (negative ? 0.34 : 0));
  const respectParoles = clampVivyScore(0.52 + (prompt.length > 80 ? 0.14 : 0) + (hasSections ? 0.16 : 0) + (hasChorus ? 0.10 : 0) - (/\b(?:prompt|instruction|technical|debug)\b/.test(text) ? 0.22 : 0));
  const voix = clampVivyScore(0.50 + modelBonus + (hasVoiceSignal ? 0.18 : 0) + (positive ? 0.08 : 0) - (negative ? 0.22 : 0));
  const structure = clampVivyScore(0.48 + (hasSections ? 0.18 : 0) + (hasChorus ? 0.18 : 0) + (durationSeconds >= 180 ? 0.08 : 0) - (negative ? 0.14 : 0));
  const duree = scoreVivySunoDuration(durationSeconds);
  const score = (qualityMusicale * 0.40)
    + (respectParoles * 0.25)
    + (voix * 0.15)
    + (structure * 0.10)
    + (duree * 0.10);
  return {
    score: Math.round(score * 1000) / 100,
    breakdown: {
      qualiteMusicale: Math.round(qualityMusicale * 100),
      respectParoles: Math.round(respectParoles * 100),
      voix: Math.round(voix * 100),
      structure: Math.round(structure * 100),
      duree: Math.round(duree * 100),
    },
  };
}

function selectVivySunoDirectorTrack(tracks = [], options = {}) {
  const targetDurationSeconds = normalizeVivySunoTargetDuration(options);
  const preferLongForm = options.preferLongForm === true || targetDurationSeconds >= 240;
  return tracks
    .map((track, index) => {
      const directorScore = scoreVivySunoDirectorTrack(track);
      return { ...track, directorScore, directorRank: index + 1 };
    })
    .sort((left, right) => {
      if (preferLongForm) {
        const rightDuration = Number(right?.durationSeconds || right?.duration || 0) || 0;
        const leftDuration = Number(left?.durationSeconds || left?.duration || 0) || 0;
        const rightLongEnough = targetDurationSeconds > 0 ? rightDuration >= Math.min(240, targetDurationSeconds * 0.8) : rightDuration >= 240;
        const leftLongEnough = targetDurationSeconds > 0 ? leftDuration >= Math.min(240, targetDurationSeconds * 0.8) : leftDuration >= 240;
        if (rightLongEnough !== leftLongEnough) return rightLongEnough ? 1 : -1;
        if (Math.abs(rightDuration - leftDuration) >= 20) return rightDuration - leftDuration;
      }
      const scoreDelta = Number(right.directorScore?.score || 0) - Number(left.directorScore?.score || 0);
      if (Math.abs(scoreDelta) > 0.5) return scoreDelta;
      const rightDuration = Number(right?.durationSeconds || right?.duration || 0) || 0;
      const leftDuration = Number(left?.durationSeconds || left?.duration || 0) || 0;
      return rightDuration - leftDuration;
    })[0] || null;
}

function extractSunoMedia(payload = {}, options = {}) {
  const tracks = collectSunoTracks(payload, []);
  return selectVivySunoDirectorTrack(tracks, options);
}

function readCachedSunoCallback(taskId) {
  const safeTaskId = sanitizeSunoTaskId(taskId);
  if (!safeTaskId) return null;
  try {
    const filePath = path.join(getVivySunoCallbackDir(), `${safeTaskId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeCachedSunoCallback(taskId, payload) {
  const safeTaskId = sanitizeSunoTaskId(taskId);
  if (!safeTaskId) return false;
  try {
    const dir = getVivySunoCallbackDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${safeTaskId}.json`), JSON.stringify({
      receivedAt: new Date().toISOString(),
      taskId: safeTaskId,
      payload,
    }, null, 2));
    return true;
  } catch {
    return false;
  }
}

function getVivyFfmpegBinary() {
  return String(process.env.VIVY_FFMPEG_BIN || process.env.A11_AUDIO_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function buildVivyMp3RepairArgs(inputPath, outputPath) {
  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-ac', '2',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-write_xing', '1',
    '-id3v2_version', '3',
    outputPath,
  ];
}

function buildVivyMusicMasterArgs(inputPath, outputPath) {
  const targetI = cleanOneLine(process.env.VIVY_MUSIC_MASTER_LUFS, '-14', 12);
  const targetTp = cleanOneLine(process.env.VIVY_MUSIC_MASTER_TP, '-1.2', 12);
  const targetLra = cleanOneLine(process.env.VIVY_MUSIC_MASTER_LRA, '9', 12);
  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-af', `highpass=f=35,loudnorm=I=${targetI}:TP=${targetTp}:LRA=${targetLra},alimiter=limit=0.98`,
    '-ac', '2',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-write_xing', '1',
    '-id3v2_version', '3',
    outputPath,
  ];
}

function runVivyFfmpeg(args = [], options = {}) {
  const ffmpeg = String(options.ffmpegBin || getVivyFfmpegBinary()).trim() || 'ffmpeg';
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.VIVY_FFMPEG_TIMEOUT_MS || 180000));
  const errorCode = cleanOneLine(options.errorCode, 'vivy_ffmpeg_failed', 80);

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${errorCode}:timeout`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk || '')}`.slice(-2400);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${errorCode}:${code}:${stderr.trim().slice(0, 400)}`));
        return;
      }
      resolve({ ok: true, stderr: stderr.trim() });
    });
  });
}

async function masterVivyMusicFile(filePath, options = {}) {
  if (options.masterMusic === false || envFlag('VIVY_MUSIC_MASTER_DISABLED')) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const targetPath = String(filePath || '').trim();
  if (!targetPath || path.extname(targetPath).toLowerCase() !== '.mp3') {
    return { ok: false, skipped: true, reason: 'not_mp3' };
  }
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return { ok: false, skipped: true, reason: 'missing' };
  }

  const tempPath = path.join(
    path.dirname(targetPath),
    `${path.basename(targetPath, '.mp3')}.master-${process.pid}-${Date.now()}.mp3`
  );
  const runFfmpeg = options.runFfmpeg || runVivyFfmpeg;
  try {
    const originalSize = fs.statSync(targetPath).size;
    await runFfmpeg(buildVivyMusicMasterArgs(targetPath, tempPath), {
      timeoutMs: options.timeoutMs || process.env.VIVY_MUSIC_MASTER_TIMEOUT_MS || 180000,
      errorCode: 'vivy_music_master_failed',
      ffmpegBin: options.ffmpegBin,
    });
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
      throw new Error('vivy_music_master_empty_output');
    }
    fs.copyFileSync(tempPath, targetPath);
    fs.rmSync(tempPath, { force: true });
    const masteredSize = fs.statSync(targetPath).size;
    return {
      ok: true,
      originalSize,
      masteredSize,
      targetLufs: cleanOneLine(process.env.VIVY_MUSIC_MASTER_LUFS, '-14', 12),
      truePeak: cleanOneLine(process.env.VIVY_MUSIC_MASTER_TP, '-1.2', 12),
      lra: cleanOneLine(process.env.VIVY_MUSIC_MASTER_LRA, '9', 12),
    };
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    console.warn('[Vivy Studio] Music mastering skipped:', cleanOneLine(error?.message || error, 'unknown', 240));
    return { ok: false, skipped: true, reason: 'master_failed', message: cleanOneLine(error?.message || error, 'unknown', 240) };
  }
}

async function repairVivyMp3File(filePath, options = {}) {
  if (options.repairMp3 === false || envFlag('VIVY_MP3_REPAIR_DISABLED')) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const targetPath = String(filePath || '').trim();
  if (!targetPath || path.extname(targetPath).toLowerCase() !== '.mp3') {
    return { ok: false, skipped: true, reason: 'not_mp3' };
  }
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return { ok: false, skipped: true, reason: 'missing' };
  }

  const tempPath = path.join(
    path.dirname(targetPath),
    `${path.basename(targetPath, '.mp3')}.clipchamp-${process.pid}-${Date.now()}.mp3`
  );
  const runFfmpeg = options.runFfmpeg || runVivyFfmpeg;
  try {
    const originalSize = fs.statSync(targetPath).size;
    await runFfmpeg(buildVivyMp3RepairArgs(targetPath, tempPath), {
      timeoutMs: options.timeoutMs || process.env.VIVY_MP3_REPAIR_TIMEOUT_MS || 180000,
      errorCode: 'vivy_mp3_repair_failed',
      ffmpegBin: options.ffmpegBin,
    });
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
      throw new Error('vivy_mp3_repair_empty_output');
    }
    fs.copyFileSync(tempPath, targetPath);
    fs.rmSync(tempPath, { force: true });
    const repairedSize = fs.statSync(targetPath).size;
    return { ok: true, originalSize, repairedSize, bitrate: '192k', sampleRate: 44100 };
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    console.warn('[Vivy Studio] MP3 repair skipped:', cleanOneLine(error?.message || error, 'unknown', 240));
    return { ok: false, skipped: true, reason: 'repair_failed', message: cleanOneLine(error?.message || error, 'unknown', 240) };
  }
}

async function saveVivyMusicBuffer(buffer, input = {}, req = null) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) return null;
  const material = cleanText([
    input.title,
    input.songTitle,
    input.songText,
    input.prompt,
    input.songMood,
  ].filter(Boolean).join('\n'), 600);
  const title = cleanOneLine(input.title || input.songTitle || material.split(/\n|[.!?]/).find(Boolean), 'vivy-song', 80);
  const digest = crypto.createHash('sha1').update(`${title}\n${material}\n${Date.now()}`).digest('hex').slice(0, 10);
  const filename = `vivy-music-${slugify(title, 'song')}-${digest}.mp3`;
  const filePath = getEmergencyMediaAssetPath(filename);
  if (!filePath) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  const repair = await repairVivyMp3File(filePath);
  const mastering = await masterVivyMusicFile(filePath);
  const url = `/api/vivy/studio/assets/${encodeURIComponent(filename)}`;
  return {
    ok: true,
    kind: 'audio',
    provider: cleanOneLine(
      input.mediaProvider
      || (input.musicProvider === 'elevenlabs' ? 'elevenlabs-music' : input.musicProvider),
      'elevenlabs-music',
      40
    ),
    mode: 'real_music_generation',
    title,
    filename,
    path: filePath,
    url,
    audio_url: url,
    audioUrl: url,
    content_type: 'audio/mpeg',
    containerRepaired: repair.ok === true,
    mastered: mastering.ok === true,
    repair,
    mastering,
    emergencyFallback: false,
    generatedAt: new Date().toISOString(),
  };
}

async function requestElevenLabsMusic(input = {}, req = null) {
  const apiKey = getElevenLabsMusicApiKey();
  if (!apiKey) throw new Error('elevenlabs_music_key_missing');
  if (!isVivyFounderUser(req?.user || {})) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }
  const durationMs = Math.max(
    8000,
    Math.min(180000, Math.round(Number(input.durationMs || input.duration_ms || input.durationSeconds * 1000 || 45000) || 45000))
  );
  const prompt = buildVivyMusicPrompt(input);
  const modelId = cleanOneLine(input.musicModel || process.env.VIVY_ELEVENLABS_MUSIC_MODEL || 'music_v1', 'music_v1', 80);
  const response = await fetch(`${getElevenLabsBaseUrl()}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      music_length_ms: durationMs,
      model_id: modelId,
      force_instrumental: input.instrumental === true || input.forceInstrumental === true,
    }),
    signal: AbortSignal.timeout(Number(process.env.VIVY_ELEVENLABS_MUSIC_TIMEOUT_MS || 90000) || 90000),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const safeDetail = cleanOneLine(errorText, '', 240);
    throw new Error(`elevenlabs_music_http_${response.status}${safeDetail ? `:${safeDetail}` : ''}`);
  }
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('elevenlabs_music_empty_audio');
  const media = await saveVivyMusicBuffer(audioBuffer, input, req);
  if (!media?.url) throw new Error('elevenlabs_music_save_failed');
  return {
    ...media,
    prompt,
    model: modelId,
    durationMs,
  };
}

function resolveVivyMurekaModel(input = {}) {
  const requested = cleanOneLine(
    input.murekaModel
    || input.mureka_model
    || (/^mureka-/i.test(String(input.musicModel || '')) ? input.musicModel : '')
    || process.env.VIVY_MUREKA_MODEL
    || 'mureka-9',
    'mureka-9',
    40
  ).toLowerCase();
  return ['auto', 'mureka-7.6', 'mureka-o2', 'mureka-8', 'mureka-9'].includes(requested)
    ? requested
    : 'mureka-9';
}

function isVivyProviderTechnicalLyricLine(line = '') {
  const value = String(line || '').trim();
  if (!value) return false;
  if (/^\[[^\]]+\]$/.test(value)) return false;
  const folded = foldTextForLookup(value);
  if (!folded) return false;
  return /\bstyle\s*:/i.test(value)
    || /\b(?:prompt|brief|suno|mureka|provider|mod[èe]le|model|negative\s+prompt|distribution\s+vocale|direction\s+sonore|canevas|consignes?|r[èe]gles?\s+priv[ée]es?|non\s+chantables?|ne\s+(?:mets|met|chante|r[ée]cite|dis)\s+pas)\b/i.test(value)
    || /\b(?:distribution vocale|casting vocal|vocal cast|voix selectionnees|voix choisies|direction sonore|canevas|consignes?|regles? privees?|non chantables?)\b/.test(folded)
    || /\b(?:matiere (?:chanson )?nossen|matiere a transformer|matiere creative|matiere composition|a transformer en (?:chanson|paroles)|pas a recopier)\b/.test(folded)
    || /\b(?:banger dans les paroles|ne mets? pas le mot|ne chante jamais|jamais les consignes)\b/.test(folded)
    || /\b(?:fallback|grand modele|llm|provider pack|clean lyrics|paroles propres|paroles finales|paroles envoyees a suno)\b/.test(folded)
    || /\b(?:songtext|songmood|songmaxtokens|artistcount|singercount|vocalcast|negative prompt|style brief|suno style|mureka prompt)\b/.test(folded);
}

function sanitizeVivyProviderCleanLyrics(value = '', maxChars = VIVY_SONG_MAX_CHARS) {
  const source = sanitizeVivySongMaterial(value, maxChars);
  if (!source) return '';
  const lines = source.split(/\n/)
    .filter((line) => !isVivyProviderTechnicalLyricLine(line))
    .map((line) => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line;
      return String(line || '')
        .replace(/\s*(?:[,;:]\s*[A-H]|\([A-H]\)|\[[A-H]\])\s*$/i, '')
        .replace(/^\s*yeah[,!\s-]*/i, '')
        .replace(/\bhook\b/gi, 'refrain')
        .replace(/\bpayload\b/gi, 'signal')
        .trimEnd();
    });
  return sanitizeVivySongMaterial(lines.join('\n').replace(/\n{3,}/g, '\n\n'), maxChars);
}

function resolveVivyProviderLyricsSource(input = {}) {
  if (input.cleanLyrics) return input.cleanLyrics;
  if (input.lyrics) return input.lyrics;
  if (input.publicLyrics) return input.publicLyrics;
  if (looksLikeCompleteLyrics(input.songText) || looksLikeExplicitSunoLyricsBlock(input.songText)) return input.songText;
  if (looksLikeCompleteLyrics(input.text) || looksLikeExplicitSunoLyricsBlock(input.text)) return input.text;
  return '';
}

function buildVivyMurekaPayload(input = {}, req = null) {
  const instrumental = input.instrumental === true
    || input.forceInstrumental === true
    || input.previewInstrumental === true;
  const sunoMaterial = buildVivySunoPayload(input, req);
  const model = resolveVivyMurekaModel(input);
  if (instrumental) {
    return {
      endpoint: 'instrumental',
      body: {
        model,
        n: 1,
        prompt: cleanOneLine([
          sunoMaterial.style,
          buildVivyInstrumentalSunoPrompt(input, sunoMaterial.title),
        ].filter(Boolean).join(', '), 'original instrumental music', 1024),
        stream: false,
      },
    };
  }
  const murekaLyricsMaxChars = Math.max(
    1000,
    Math.min(8000, Number(process.env.VIVY_MUREKA_LYRICS_MAX_CHARS || 4200) || 4200)
  );
  const lyrics = sanitizeVivyProviderCleanLyrics(resolveVivyProviderLyricsSource(input), murekaLyricsMaxChars);
  if (!lyrics) throw new Error('mureka_music_lyrics_missing');
  const vocalCast = Array.isArray(input.songArtists) && input.songArtists.length
    ? input.songArtists.join(' + ')
    : cleanOneLine(input.vocalCast, '', 160);
  const vocalDirection = cleanOneLine([
    'French full-song production',
    vocalCast ? `vocal cast: ${vocalCast}` : 'clear expressive lead vocal',
    'keep the supplied lyrics as the sung text',
    'distinct verse and chorus energy',
    'close present vocal, clean diction, no spoken prompt, no producer notes',
    'finished streaming master, punchy drums, controlled bass, vocal forward but not harsh',
  ].filter(Boolean).join(', '), '', 700);
  return {
    endpoint: 'song',
    body: {
      model,
      n: 1,
      lyrics,
      prompt: cleanOneLine([sunoMaterial.style, vocalDirection].filter(Boolean).join(', '), 'original song, expressive vocals', 1024),
      stream: false,
    },
  };
}

function buildMurekaTaskRef(kind = 'song', taskId = '') {
  const safeKind = kind === 'instrumental' ? 'instrumental' : 'song';
  const safeId = cleanOneLine(taskId, '', 180);
  return safeId ? `mureka:${safeKind}:${safeId}` : '';
}

function parseMurekaTaskRef(value = '') {
  const match = String(value || '').trim().match(/^mureka:(song|instrumental):(.+)$/i);
  if (!match) return null;
  const id = cleanOneLine(match[2], '', 180);
  return id ? { kind: match[1].toLowerCase(), id } : null;
}

function getMurekaProviderError(payload = {}, fallback = 'mureka_music_failed') {
  return cleanOneLine(
    payload?.error?.message
    || payload?.failed_reason
    || payload?.message
    || payload?.detail,
    fallback,
    260
  );
}

async function requestMurekaMusic(input = {}, req = null) {
  const apiKey = getMurekaApiKey();
  if (!apiKey) throw new Error('mureka_music_key_missing');
  if (!canUseServerSuno(req)) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }
  const { endpoint, body } = buildVivyMurekaPayload(input, req);
  console.info(
    '[VivyProviderPack] provider=mureka cleanLyricsChars=%s styleBriefChars=%s instrumental=%s',
    String(body.lyrics || '').length,
    String(body.prompt || '').length,
    endpoint === 'instrumental' ? 'true' : 'false'
  );
  console.info(
    '[VivyMurekaPayload] generate endpoint=%s model=%s n=%s lyricsChars=%s promptChars=%s',
    endpoint,
    body.model,
    body.n,
    String(body.lyrics || '').length,
    String(body.prompt || '').length
  );
  const response = await fetch(`${getMurekaBaseUrl()}/v1/${endpoint}/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.VIVY_MUREKA_TIMEOUT_MS || 30000) || 30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`mureka_music_http_${response.status}:${getMurekaProviderError(payload)}`);
    error.code = `mureka_music_http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  const taskId = cleanOneLine(payload?.id, '', 180);
  if (!taskId) throw new Error('mureka_music_task_missing');
  const taskRef = buildMurekaTaskRef(endpoint, taskId);
  return {
    ok: true,
    kind: 'audio',
    provider: 'mureka',
    mode: 'async_music_generation',
    state: 'processing',
    status: cleanOneLine(payload?.status, 'submitted', 80),
    taskId: taskRef,
    jobId: taskRef,
    providerTaskId: taskId,
    model: cleanOneLine(payload?.model || body.model, body.model, 40),
    content_type: 'audio/mpeg',
    generatedAt: new Date().toISOString(),
  };
}

function isAllowedVivyMurekaAudioUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const hostname = parsed.hostname.toLowerCase();
    const configuredHosts = String(process.env.VIVY_MUREKA_AUDIO_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return hostname === 'mureka.ai'
      || hostname.endsWith('.mureka.ai')
      || configuredHosts.includes(hostname);
  } catch {
    return false;
  }
}

function normalizeVivyMurekaDurationSeconds(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const seconds = numeric > 7200 ? numeric / 1000 : numeric;
    return Math.round(seconds * 100) / 100;
  }
  return 0;
}

async function materializeVivyMurekaChoice(choice = {}, input = {}) {
  const sourceUrl = cleanOneLine(choice.url || choice.audio_url || choice.audioUrl, '', 1200);
  if (!isAllowedVivyMurekaAudioUrl(sourceUrl)) {
    const error = new Error('mureka_audio_host_denied');
    error.status = 502;
    throw error;
  }
  const timeoutMs = Math.max(1000, Number(process.env.VIVY_MUREKA_AUDIO_TIMEOUT_MS || 120000));
  const response = await fetch(sourceUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !isAllowedVivyMurekaAudioUrl(response.url || sourceUrl)) {
    throw new Error(`mureka_audio_fetch_${response.status || 'failed'}`);
  }
  const maxBytes = Math.max(1024, Number(process.env.VIVY_MUREKA_AUDIO_MAX_BYTES || 128 * 1024 * 1024));
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('mureka_audio_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error('mureka_audio_invalid_size');
  const media = await saveVivyMusicBuffer(buffer, {
    ...input,
    mediaProvider: 'mureka',
    title: choice.title || input.title || input.songTitle,
  });
  if (!media?.url) throw new Error('mureka_audio_save_failed');
  return {
    ...media,
    provider: 'mureka',
    model: cleanOneLine(choice.model || input.murekaModel || process.env.VIVY_MUREKA_MODEL, 'mureka-9', 40),
    durationSeconds: normalizeVivyMurekaDurationSeconds(
      choice.duration_seconds,
      choice.durationSeconds,
      choice.duration,
      input.durationSeconds
    ),
    originalAudioUrl: sourceUrl,
  };
}

async function getMurekaMusicJob(taskRef, input = {}, req = null) {
  const parsed = parseMurekaTaskRef(taskRef);
  if (!parsed) throw new Error('mureka_task_missing');
  const apiKey = getMurekaApiKey();
  if (!apiKey) throw new Error('mureka_music_key_missing');
  if (!canUseServerSuno(req)) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }
  const response = await fetch(`${getMurekaBaseUrl()}/v1/${parsed.kind}/query/${encodeURIComponent(parsed.id)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Number(process.env.VIVY_MUREKA_STATUS_TIMEOUT_MS || 15000) || 15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryable = [408, 429, 502, 503, 504, 524].includes(Number(response.status));
    if (retryable) {
      return {
        ok: true,
        provider: 'mureka',
        taskId: taskRef,
        state: 'processing',
        status: `mureka_status_retryable_${response.status}`,
        retryable: true,
      };
    }
    throw new Error(`mureka_status_http_${response.status}:${getMurekaProviderError(payload)}`);
  }
  const status = cleanOneLine(payload?.status, 'processing', 80).toLowerCase();
  if (['failed', 'cancelled', 'timeouted'].includes(status)) {
    return {
      ok: true,
      provider: 'mureka',
      taskId: taskRef,
      state: 'error',
      status,
      message: getMurekaProviderError(payload),
    };
  }
  if (status !== 'succeeded') {
    return {
      ok: true,
      provider: 'mureka',
      taskId: taskRef,
      state: 'processing',
      status,
    };
  }
  const choice = Array.isArray(payload?.choices)
    ? payload.choices.find((item) => item?.url || item?.audio_url || item?.audioUrl)
    : null;
  if (!choice) {
    return {
      ok: true,
      provider: 'mureka',
      taskId: taskRef,
      state: 'processing',
      status: 'mureka_audio_pending',
    };
  }
  const media = await materializeVivyMurekaChoice(choice, {
    ...input,
    murekaModel: payload?.model,
  });
  return {
    ok: true,
    provider: 'mureka',
    taskId: taskRef,
    state: 'done',
    status,
    durationSeconds: media.durationSeconds,
    media: { ...media, taskId: taskRef, jobId: taskRef },
  };
}

async function requestSunoMusic(input = {}, req = null) {
  const sunoAccess = getSunoAccess(input, req);
  const apiKey = sunoAccess.apiKey;
  if (!apiKey) throw new Error('suno_music_key_missing');
  if (sunoAccess.adminOnly && !canUseServerSuno(req)) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }

  const body = buildVivySunoPayload(input, req);
  console.info(
    '[VivyProviderPack] provider=suno cleanLyricsChars=%s styleBriefChars=%s instrumental=%s',
    body.instrumental === true ? 0 : String(body.prompt || '').length,
    String(body.style || '').length,
    body.instrumental === true ? 'true' : 'false'
  );
  console.info(
    '[VivySunoPayload] generate model=%s instrumental=%s long=%s target=%s titleChars=%s styleChars=%s promptChars=%s negativeChars=%s songTextChars=%s lyricsChars=%s',
    cleanOneLine(body.model, 'unknown', 40),
    body.instrumental === true ? 'true' : 'false',
    wantsVivySunoLongForm(input) ? 'true' : 'false',
    normalizeVivySunoTargetDuration(input) || 0,
    String(body.title || '').length,
    String(body.style || '').length,
    String(body.prompt || '').length,
    String(body.negativeTags || '').length,
    String(input.songText || '').length,
    String(input.lyrics || '').length
  );
  const voiceMode = body.personaModel === 'voice_persona'
    ? 'suno_voice'
    : input.preserveSelectedVoice === true
      && wantsVivyExternalVoiceMix(input)
      && body.instrumental === true
      ? 'external_mix'
      : 'suno_generated';
  const response = await fetch(`${getSunoBaseUrl()}/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.VIVY_SUNO_TIMEOUT_MS || 30000) || 30000),
  });
  const payload = await response.json().catch(() => ({}));
  const apiCode = findSunoApiCode(payload);
  if (!response.ok) {
    const error = buildSunoProviderError(response.status || apiCode || 'http_error', payload, 'http_error');
    error.status = response.status;
    throw error;
  }
  if (apiCode !== null && apiCode !== 200) {
    const error = buildSunoProviderError(apiCode, payload, 'api_error');
    error.status = apiCode;
    throw error;
  }

  const taskId = findSunoTaskId(payload);
  const readyMedia = extractSunoMedia(payload, {
    preferLongForm: wantsVivySunoLongForm(input),
    targetDurationSeconds: normalizeVivySunoTargetDuration(input),
  });
  if (readyMedia?.url) {
    const preparedMedia = await materializeVivySunoMedia(readyMedia, { taskId });
    return {
      ...preparedMedia,
      title: preparedMedia.title || readyMedia.title || body.title,
      taskId: taskId || undefined,
      jobId: taskId || undefined,
      prompt: body.prompt,
      style: body.style,
      model: body.model,
      voiceMode,
      selectedVoicePreserved: voiceMode === 'suno_voice',
    };
  }
  if (!taskId) {
    const detail = findSunoProviderMessage(payload) || findSunoStatus(payload);
    throw new Error(`suno_music_task_missing${detail ? `:${detail}` : ''}`);
  }

  return {
    ok: true,
    kind: 'audio',
    provider: 'suno',
    mode: 'async_music_generation',
    state: 'processing',
    status: findSunoStatus(payload) || 'submitted',
    taskId,
    jobId: taskId,
    title: body.title,
    prompt: body.prompt,
    style: body.style,
    model: body.model,
    voiceMode,
    selectedVoicePreserved: voiceMode === 'suno_voice',
    content_type: 'audio/mpeg',
    generatedAt: new Date().toISOString(),
  };
}

async function requestSunoMusicExtension(input = {}, req = null) {
  const sunoAccess = getSunoAccess(input, req);
  const apiKey = sunoAccess.apiKey;
  if (!apiKey) throw new Error('suno_music_key_missing');
  if (sunoAccess.adminOnly && !canUseServerSuno(req)) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }

  const audioId = cleanOneLine(
    input.audioId || input.audio_id || input.id || input.sunoAudioId || input.sourceAudioId,
    '',
    160
  );
  const uploadUrl = resolveSunoUploadExtendUrl(input, req);
  const useUploadExtend = Boolean(uploadUrl) && (
    input.forceUploadExtend === true
    || input.uploadExtend === true
    || input.useUploadExtend === true
    || !audioId
  );
  if (!audioId && !uploadUrl) {
    const error = new Error('suno_extension_source_missing');
    error.code = 'suno_extension_source_missing';
    error.status = 400;
    throw error;
  }
  const model = cleanOneLine(input.musicModel || input.model || input.sourceModel || process.env.VIVY_SUNO_MODEL || 'V5_5', 'V5_5', 40);
  const sourceDurationSeconds = Number(
    input.sourceDurationSeconds
    ?? input.source_duration_seconds
    ?? input.currentDurationSeconds
    ?? input.current_duration_seconds
    ?? input.durationSeconds
    ?? input.duration
    ?? 0
  );
  const explicitContinueAt = Number(input.continueAtSeconds ?? input.continue_at_seconds ?? input.continueAt ?? input.continue_at ?? 0);
  const continueAtSeconds = Number.isFinite(explicitContinueAt) && explicitContinueAt > 0
    ? explicitContinueAt
    : Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 12
      ? Math.max(1, Math.floor(sourceDurationSeconds - 8))
      : 0;
  const title = cleanOneLine(input.title || input.songTitle || input.song_title, '', 80);
  const style = cleanOneLine(input.style || input.songMood || input.song_mood || input.tags, '', 520);
  const prompt = sanitizeVivySongMaterial(input.prompt || input.lyrics || input.songText || input.song_text || input.extensionPrompt, VIVY_SONG_MAX_CHARS);
  const useCustomExtension = (input.defaultParamFlag === true || input.customMode === true || continueAtSeconds > 0)
    && Boolean(title || style || prompt);
  const body = {
    defaultParamFlag: false,
    model,
    callBackUrl: buildSunoCallbackUrl(req),
  };
  const wantsInstrumental = input.instrumental === true || input.forceInstrumental === true || input.previewInstrumental === true;
  if (useUploadExtend) {
    body.uploadUrl = uploadUrl;
    body.instrumental = wantsInstrumental;
  } else {
    body.audioId = audioId;
  }
  if (useCustomExtension) {
    body.defaultParamFlag = true;
    body.title = title || 'Vivy NOSSEN extension';
    body.style = style || 'long-form full song arrangement around five minutes, instrumental backing track only, no vocals';
    body.prompt = prompt || 'Continue the same original song structure with a longer instrumental arrangement and a complete final chorus.';
    if (continueAtSeconds > 0) body.continueAt = continueAtSeconds;
    if (wantsInstrumental) {
      body.instrumental = true;
    }
  }
  console.info(
    '[VivySunoPayload] %s model=%s custom=%s instrumental=%s sourceDuration=%s continueAt=%s target=%s titleChars=%s styleChars=%s promptChars=%s',
    useUploadExtend ? 'upload-extend' : 'extend',
    cleanOneLine(body.model, 'unknown', 40),
    body.defaultParamFlag === true ? 'true' : 'false',
    body.instrumental === true ? 'true' : 'false',
    Number.isFinite(sourceDurationSeconds) ? Math.round(sourceDurationSeconds) : 0,
    body.continueAt || 0,
    normalizeVivySunoTargetDuration(input) || 0,
    String(body.title || '').length,
    String(body.style || '').length,
    String(body.prompt || '').length
  );
  const response = await fetch(`${getSunoBaseUrl()}/generate/${useUploadExtend ? 'upload-extend' : 'extend'}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.VIVY_SUNO_TIMEOUT_MS || 30000) || 30000),
  });
  const payload = await response.json().catch(() => ({}));
  const apiCode = findSunoApiCode(payload);
  if (!response.ok) {
    const error = buildSunoProviderError(response.status || apiCode || 'http_error', payload, 'http_error');
    error.status = response.status;
    throw error;
  }
  if (apiCode !== null && apiCode !== 200) {
    const error = buildSunoProviderError(apiCode, payload, 'api_error');
    error.status = apiCode;
    throw error;
  }

  const taskId = findSunoTaskId(payload);
  const readyMedia = extractSunoMedia(payload, {
    preferLongForm: wantsVivySunoLongForm(input),
    targetDurationSeconds: normalizeVivySunoTargetDuration(input),
  });
  if (readyMedia?.url) {
    const preparedMedia = await materializeVivySunoMedia(readyMedia, { taskId });
    return {
      ...preparedMedia,
      taskId: taskId || undefined,
      jobId: taskId || undefined,
      sourceAudioId: audioId || undefined,
      uploadExtend: useUploadExtend,
      extension: true,
      model,
    };
  }
  if (!taskId) {
    const detail = findSunoProviderMessage(payload) || findSunoStatus(payload);
    throw new Error(`suno_music_extension_task_missing${detail ? `:${detail}` : ''}`);
  }
  return {
    ok: true,
    kind: 'audio',
    provider: 'suno',
    mode: 'async_music_extension',
    state: 'processing',
    status: findSunoStatus(payload) || 'submitted',
    taskId,
    jobId: taskId,
    sourceAudioId: audioId || undefined,
    uploadExtend: useUploadExtend,
    extension: true,
    model,
    content_type: 'audio/mpeg',
    generatedAt: new Date().toISOString(),
  };
}

function vivyInputFlag(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function requiresLocalVivySunoAudio(input = {}) {
  return vivyInputFlag(input.requireLocalSunoAudio)
    || vivyInputFlag(input.sunoLocalAudioRequired)
    || vivyInputFlag(input.requireLocalAudio)
    || vivyInputFlag(input.localAudioRequired)
    || vivyInputFlag(input.throwOnSunoMaterializationFailure);
}

function buildVivySunoLocalizingJob(taskId, error = null, upstreamStatus = '') {
  const detail = cleanOneLine(error?.message || error, '', 180);
  return {
    ok: true,
    provider: 'suno',
    taskId,
    state: 'processing',
    status: 'suno_audio_localizing',
    upstreamStatus: cleanOneLine(upstreamStatus || 'callback_ready', 'callback_ready', 80),
    retryable: true,
    message: 'Suno a rendu l’audio; Vivy rapatrie le MP3 local avant publication.',
    localMaterializationError: detail || undefined,
  };
}

async function materializeVivySunoStatusMedia(media = {}, input = {}, options = {}) {
  const requireLocal = requiresLocalVivySunoAudio(input);
  try {
    const preparedMedia = await materializeVivySunoMedia(
      media,
      buildVivySunoStatusMaterializeOptions({
        ...input,
        ...options,
        requireLocalSunoAudio: requireLocal,
        throwOnFailure: requireLocal,
      })
    );
    return { pending: false, media: preparedMedia };
  } catch (error) {
    if (requireLocal && error?.code === 'vivy_suno_local_materialization_failed') {
      return { pending: true, error };
    }
    throw error;
  }
}

async function getSunoMusicJob(taskId, input = {}, req = null) {
  const safeTaskId = sanitizeSunoTaskId(taskId);
  if (!safeTaskId) {
    const error = new Error('suno_task_missing');
    error.status = 400;
    throw error;
  }
  const cached = readCachedSunoCallback(safeTaskId);
  const cachedApiCode = findSunoApiCode(cached?.payload || {});
  if (cachedApiCode !== null && cachedApiCode !== 200) {
    const detail = findSunoProviderMessage(cached?.payload || {});
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'error',
      status: `suno_api_${cachedApiCode}`,
      message: detail || `Suno a rejeté la génération avec le code ${cachedApiCode}.`,
      providerDetail: detail,
    };
  }
  const cachedMedia = extractSunoMedia(cached?.payload || {}, {
    preferLongForm: wantsVivySunoLongForm(input),
    targetDurationSeconds: normalizeVivySunoTargetDuration(input),
  });
  if (cachedMedia?.url) {
    const materialized = await materializeVivySunoStatusMedia(cachedMedia, input, {
      taskId: safeTaskId,
      preferLongForm: wantsVivySunoLongForm(input),
      targetDurationSeconds: normalizeVivySunoTargetDuration(input),
    });
    if (materialized.pending) return buildVivySunoLocalizingJob(safeTaskId, materialized.error);
    const preparedMedia = materialized.media;
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status: findSunoStatus(cached?.payload || {}) || 'callback_ready',
      audioId: preparedMedia.audioId || preparedMedia.id || cachedMedia.audioId || cachedMedia.id,
      durationSeconds: preparedMedia.durationSeconds || preparedMedia.duration || cachedMedia.durationSeconds || cachedMedia.duration,
      media: { ...preparedMedia, taskId: safeTaskId, jobId: safeTaskId },
    };
  }

  const sunoAccess = getSunoAccess(input, req);
  const apiKey = sunoAccess.apiKey;
  if (!apiKey) throw new Error('suno_music_key_missing');
  if (sunoAccess.adminOnly && !canUseServerSuno(req)) {
    const error = new Error('vivy_music_admin_only');
    error.code = 'vivy_music_admin_only';
    error.status = 403;
    throw error;
  }
  const response = await fetch(`${getSunoBaseUrl()}/generate/record-info?taskId=${encodeURIComponent(safeTaskId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(Number(process.env.VIVY_SUNO_STATUS_TIMEOUT_MS || 15000) || 15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const statusCode = Number(response.status) || 0;
    if ([408, 429, 502, 503, 504, 524].includes(statusCode)) {
      return {
        ok: true,
        provider: 'suno',
        taskId: safeTaskId,
        state: 'processing',
        status: `suno_status_retryable_${statusCode}`,
        retryable: true,
        message: 'Suno répond lentement; Vivy continue de surveiller la chanson.',
      };
    }
    throw new Error(`suno_status_http_${response.status}`);
  }
  const apiCode = findSunoApiCode(payload);
  if (apiCode !== null && apiCode !== 200) {
    const detail = findSunoProviderMessage(payload);
    writeCachedSunoCallback(safeTaskId, payload);
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'error',
      status: `suno_api_${apiCode}`,
      message: detail || `Suno a rejeté la génération avec le code ${apiCode}.`,
      providerDetail: detail,
    };
  }
  const media = extractSunoMedia(payload, {
    preferLongForm: wantsVivySunoLongForm(input),
    targetDurationSeconds: normalizeVivySunoTargetDuration(input),
  });
  const status = findSunoStatus(payload) || 'processing';
  if (media?.url) {
    writeCachedSunoCallback(safeTaskId, payload);
    const materialized = await materializeVivySunoStatusMedia(media, input, {
      taskId: safeTaskId,
      preferLongForm: wantsVivySunoLongForm(input),
      targetDurationSeconds: normalizeVivySunoTargetDuration(input),
    });
    if (materialized.pending) return buildVivySunoLocalizingJob(safeTaskId, materialized.error, status);
    const preparedMedia = materialized.media;
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status,
      audioId: preparedMedia.audioId || preparedMedia.id || media.audioId || media.id,
      durationSeconds: preparedMedia.durationSeconds || preparedMedia.duration || media.durationSeconds || media.duration,
      media: { ...preparedMedia, taskId: safeTaskId, jobId: safeTaskId },
    };
  }
  return {
    ok: true,
    provider: 'suno',
    taskId: safeTaskId,
    state: /fail|error|reject/i.test(status) ? 'error' : 'processing',
    status,
    message: /fail|error|reject/i.test(status)
      ? 'La génération Suno a échoué ou a été rejetée.'
      : 'La chanson Vivy est encore en génération.',
  };
}

async function getVivyMusicJob(taskId, input = {}, req = null) {
  if (parseMurekaTaskRef(taskId)) return getMurekaMusicJob(taskId, input, req);
  return getSunoMusicJob(taskId, input, req);
}

async function buildRealMusicForProduction(mode, input, req) {
  if (mode !== 'song') return null;
  const wantsMusic = input.forceRealMusic === true
    || input.generateMusic === true
    || input.makeSong === true
    || input.song === true
    || envFlag('VIVY_SUNO_AUTO')
    || (envFlag('VIVY_ELEVENLABS_MUSIC_AUTO') && isElevenLabsMusicConfigured());
  if (!wantsMusic) return null;

  const requestedProvider = cleanOneLine(input.musicProvider, '', 40).toLowerCase();
  const providers = requestedProvider ? [requestedProvider] : getConfiguredMusicProviders();
  const explicitElevenLabsPreview = input.previewInstrumental === true
    && !envFlag('VIVY_ELEVENLABS_MUSIC_DISABLED')
    && !envFlag('ELEVENLABS_MUSIC_DISABLED')
    && Boolean(getElevenLabsMusicApiKey());
  const errors = [];
  for (const provider of providers) {
    try {
      if (provider === 'suno' && (isSunoMusicConfigured() || getRequestSessionSunoApiKey(input, req))) return await requestSunoMusic(input, req);
      if (provider === 'mureka' && isMurekaMusicConfigured()) return await requestMurekaMusic(input, req);
      if ((provider === 'elevenlabs' || provider === 'elevenlabs-music') && (isElevenLabsMusicConfigured() || explicitElevenLabsPreview)) {
        return await requestElevenLabsMusic(input, req);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw errors[0];
  return null;
}

function buildVivyPreviewMixArgs(instrumentalPath, voicePath, outputPath) {
  return [
    '-y',
    '-i', instrumentalPath,
    '-i', voicePath,
    '-filter_complex',
    '[0:a]volume=0.55[music];[1:a]highpass=f=90,loudnorm=I=-19:TP=-6:LRA=7[voice];[music][voice]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.95[out]',
    '-map', '[out]',
    '-vn',
    '-map_metadata', '-1',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-write_xing', '1',
    '-id3v2_version', '3',
    outputPath,
  ];
}

function buildVivyMultiVoiceAssemblyArgs(segmentPaths = [], outputPath) {
  const normalizedSegments = segmentPaths
    .filter((segment) => Array.isArray(segment) && segment.length)
    .map((segment) => segment.slice(0, 4));
  const inputs = normalizedSegments.flat();
  const args = ['-y'];
  inputs.forEach((inputPath) => args.push('-i', inputPath));

  const filters = [];
  const segmentLabels = [];
  let inputIndex = 0;
  normalizedSegments.forEach((segment, segmentIndex) => {
    const voiceLabels = segment.map(() => {
      const label = `voice${inputIndex}`;
      filters.push(`[${inputIndex}:a]aresample=44100,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${label}]`);
      inputIndex += 1;
      return `[${label}]`;
    });
    const segmentLabel = `segment${segmentIndex}`;
    if (voiceLabels.length === 1) {
      filters.push(`${voiceLabels[0]}anull[${segmentLabel}]`);
    } else {
      filters.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:duration=longest:normalize=0,volume=0.72,alimiter=limit=0.95[${segmentLabel}]`);
    }
    segmentLabels.push(`[${segmentLabel}]`);
  });

  if (segmentLabels.length === 1) filters.push(`${segmentLabels[0]}anull[out]`);
  else filters.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=0:a=1[out]`);

  return [
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-vn',
    '-map_metadata', '-1',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-write_xing', '1',
    '-id3v2_version', '3',
    outputPath,
  ];
}

function getVivyPreviewAssetFilename(value = '') {
  try {
    const parsed = new URL(String(value || '').trim(), 'https://vivy.local');
    const filename = path.basename(decodeURIComponent(parsed.pathname));
    return /^[a-z0-9_.-]+$/i.test(filename) ? filename : '';
  } catch {
    return '';
  }
}

function resolveVivyPreviewVoicePath(value = '') {
  const filename = getVivyPreviewAssetFilename(value);
  if (/^vivy-multi-voice-.+\.mp3$/i.test(filename)) {
    const candidate = getEmergencyMediaAssetPath(filename);
    return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : '';
  }
  if (!/^(?:tts-out-|a11-voice-|a11-converted-).+\.(?:wav|mp3|ogg)$/i.test(filename)) return '';
  const candidates = [
    path.join(getPublicTtsDir(), filename),
    path.join(getCanonicalTtsDir(), 'out', filename),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

function resolveVivyPreviewInstrumentalPath(value = '') {
  const filename = getVivyPreviewAssetFilename(value);
  if (!/^vivy-music-.+\.mp3$/i.test(filename)) return '';
  const candidate = getEmergencyMediaAssetPath(filename);
  return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : '';
}

function isAllowedVivyRemoteInstrumentalUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const hostname = parsed.hostname.toLowerCase();
    const configuredHosts = String(process.env.VIVY_SUNO_AUDIO_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return hostname === 'tempfile.aiquickdraw.com'
      || hostname === 'musicfile.removeai.ai'
      || hostname === 'suno.ai'
      || hostname.endsWith('.suno.ai')
      || configuredHosts.includes(hostname);
  } catch {
    return false;
  }
}

async function readVivyRemoteAudioBuffer(response, maxBytes) {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('vivy_preview_remote_source_too_large');
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('vivy_preview_remote_source_too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('vivy_preview_remote_source_too_large');
  return buffer;
}

async function materializeVivyPreviewInstrumentalPath(value = '', options = {}) {
  const localPath = resolveVivyPreviewInstrumentalPath(value);
  if (localPath) return localPath;
  if (!isAllowedVivyRemoteInstrumentalUrl(value)) {
    const error = new Error('vivy_preview_remote_source_denied');
    error.status = 400;
    throw error;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = Math.max(1024, Number(options.maxBytes || process.env.VIVY_PREVIEW_REMOTE_MAX_BYTES || 64 * 1024 * 1024));
  const timeoutMs = Math.max(1000, Number(options.fetchTimeoutMs || options.timeoutMs || process.env.VIVY_PREVIEW_REMOTE_TIMEOUT_MS || 45000));
  let currentUrl = String(value || '').trim();
  let response = null;
  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    response = await fetchImpl(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (![301, 302, 303, 307, 308].includes(Number(response?.status))) break;
    const location = response?.headers?.get?.('location');
    const nextUrl = location ? new URL(location, currentUrl).toString() : '';
    if (!nextUrl || !isAllowedVivyRemoteInstrumentalUrl(nextUrl)) {
      const error = new Error('vivy_preview_remote_redirect_denied');
      error.status = 400;
      throw error;
    }
    currentUrl = nextUrl;
  }
  if (!response?.ok) {
    const error = new Error(`vivy_preview_remote_fetch_${response?.status || 'failed'}`);
    error.status = 502;
    throw error;
  }

  const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream' && contentType !== 'binary/octet-stream') {
    const error = new Error('vivy_preview_remote_source_not_audio');
    error.status = 415;
    throw error;
  }
  const buffer = await readVivyRemoteAudioBuffer(response, maxBytes);
  if (!buffer.length) throw new Error('vivy_preview_remote_source_empty');
  const looksLikeMp3 = buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (!looksLikeMp3 && contentType !== 'audio/mpeg' && contentType !== 'audio/mp3') {
    const error = new Error('vivy_preview_remote_source_invalid_audio');
    error.status = 415;
    throw error;
  }

  const digest = crypto.createHash('sha256').update(currentUrl).digest('hex').slice(0, 16);
  const filename = `vivy-music-suno-${digest}.mp3`;
  const filePath = getEmergencyMediaAssetPath(filename);
  if (!filePath) throw new Error('vivy_preview_remote_target_invalid');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  const repair = await repairVivyMp3File(filePath, {
    ...options,
    timeoutMs: options.repairTimeoutMs || options.mp3RepairTimeoutMs || options.timeoutMs,
  });
  console.info(`[Vivy Studio] Suno instrumental materialized host=${new URL(currentUrl).hostname} bytes=${buffer.length} file=${filename} repaired=${repair.ok === true}`);
  return filePath;
}

async function materializeVivySunoMedia(media = {}, options = {}) {
  const sourceUrl = cleanOneLine(media.audioUrl || media.audio_url || media.url, '', 1000);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return media;
  if (envFlag('VIVY_SUNO_LOCAL_MP3_DISABLED')) return media;
  if (!isAllowedVivyRemoteInstrumentalUrl(sourceUrl)) return media;

  const attempts = Math.max(1, Math.min(6, Number(options.attempts || process.env.VIVY_SUNO_AUDIO_FETCH_ATTEMPTS || 3) || 3));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? process.env.VIVY_SUNO_AUDIO_RETRY_DELAY_MS ?? 1200) || 0);
  const sunoOptions = {
    ...options,
    fetchTimeoutMs: options.fetchTimeoutMs || process.env.VIVY_SUNO_AUDIO_FETCH_TIMEOUT_MS || 120000,
    repairTimeoutMs: options.repairTimeoutMs || process.env.VIVY_SUNO_MP3_REPAIR_TIMEOUT_MS || process.env.VIVY_MP3_REPAIR_TIMEOUT_MS || 240000,
    maxBytes: options.maxBytes || process.env.VIVY_SUNO_AUDIO_MAX_BYTES || (128 * 1024 * 1024),
  };
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const filePath = await materializeVivyPreviewInstrumentalPath(sourceUrl, sunoOptions);
      const filename = path.basename(filePath);
      const url = `/api/vivy/studio/assets/${encodeURIComponent(filename)}`;
      return {
        ...media,
        filename,
        path: filePath,
        url,
        audioUrl: url,
        audio_url: url,
        originalAudioUrl: sourceUrl,
        original_audio_url: sourceUrl,
        sourceAudioUrl: sourceUrl,
        source_audio_url: sourceUrl,
        content_type: 'audio/mpeg',
        containerNormalized: true,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }
  const detail = cleanOneLine(lastError?.message || lastError, 'unknown', 240);
  if (options.throwOnFailure === true || options.requireLocalSunoAudio === true || options.sunoLocalAudioRequired === true) {
    const error = new Error(`vivy_suno_local_materialization_failed:${detail}`);
    error.code = 'vivy_suno_local_materialization_failed';
    error.sourceUrl = sourceUrl;
    error.cause = lastError;
    throw error;
  }
  try {
    console.warn('[Vivy Studio] Suno MP3 local materialization failed, keeping provider URL:', detail);
  } catch (_) {}
  return media;
}

function buildVivySunoStatusMaterializeOptions(options = {}) {
  const longForm = options.preferLongForm === true || normalizeVivySunoTargetDuration(options) >= 240;
  const requireLocal = requiresLocalVivySunoAudio(options) || options.throwOnFailure === true;
  const defaultAttempts = requireLocal ? (longForm ? 4 : 3) : (longForm ? 2 : 1);
  const maxAttempts = requireLocal ? 6 : 2;
  const defaultRetryDelayMs = requireLocal ? 3000 : (longForm ? 1500 : 0);
  const defaultFetchTimeoutMs = requireLocal
    ? (longForm ? 180000 : 60000)
    : (longForm ? 60000 : 8000);
  const fetchTimeoutCap = requireLocal
    ? (longForm ? 240000 : 120000)
    : (longForm ? 90000 : 25000);
  const defaultRepairTimeoutMs = requireLocal
    ? (longForm ? 180000 : 90000)
    : (longForm ? 90000 : 12000);
  const repairTimeoutCap = requireLocal
    ? (longForm ? 300000 : 180000)
    : (longForm ? 120000 : 30000);
  return {
    ...options,
    attempts: Math.max(1, Math.min(maxAttempts, Number(
      options.sunoStatusAudioFetchAttempts
      || options.statusAudioFetchAttempts
      || options.audioFetchAttempts
      || options.attempts
      || process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_ATTEMPTS
      || defaultAttempts
    ) || defaultAttempts)),
    retryDelayMs: Math.max(0, Number(
      options.sunoStatusAudioRetryDelayMs
      ?? options.statusAudioRetryDelayMs
      ?? options.audioRetryDelayMs
      ?? options.retryDelayMs
      ?? process.env.VIVY_SUNO_STATUS_AUDIO_RETRY_DELAY_MS
      ?? defaultRetryDelayMs
    ) || 0),
    fetchTimeoutMs: Math.max(1000, Math.min(fetchTimeoutCap, Number(
      options.sunoStatusAudioFetchTimeoutMs
      || options.statusAudioFetchTimeoutMs
      || options.audioFetchTimeoutMs
      || options.fetchTimeoutMs
      || process.env.VIVY_SUNO_STATUS_AUDIO_FETCH_TIMEOUT_MS
      || defaultFetchTimeoutMs
    ) || defaultFetchTimeoutMs)),
    repairTimeoutMs: Math.max(1000, Math.min(repairTimeoutCap, Number(
      options.sunoStatusMp3RepairTimeoutMs
      || options.statusMp3RepairTimeoutMs
      || options.mp3RepairTimeoutMs
      || options.repairTimeoutMs
      || process.env.VIVY_SUNO_STATUS_MP3_REPAIR_TIMEOUT_MS
      || defaultRepairTimeoutMs
    ) || defaultRepairTimeoutMs)),
    requireLocalSunoAudio: requireLocal,
    throwOnFailure: requireLocal || options.throwOnFailure === true,
  };
}

async function runVivyPreviewMix(voiceUrl, instrumentalUrl) {
  const voicePath = resolveVivyPreviewVoicePath(voiceUrl);
  const instrumentalPath = await materializeVivyPreviewInstrumentalPath(instrumentalUrl);
  if (!voicePath || !instrumentalPath) {
    const error = new Error('vivy_preview_source_invalid');
    error.status = 400;
    throw error;
  }
  const digest = crypto.createHash('sha1')
    .update(`${voicePath}\n${instrumentalPath}\n${Date.now()}`)
    .digest('hex')
    .slice(0, 10);
  const filename = `vivy-preview-mix-${Date.now()}-${digest}.mp3`;
  const outputPath = getEmergencyMediaAssetPath(filename);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const ffmpeg = String(process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
  const args = buildVivyPreviewMixArgs(instrumentalPath, voicePath, outputPath);

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('vivy_preview_mix_timeout'));
    }, 120000);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk || '')}`.slice(-2400);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !fs.existsSync(outputPath)) {
        reject(new Error(stderr.trim() || `vivy_preview_mix_exit_${code}`));
        return;
      }
      const url = `/api/vivy/studio/assets/${encodeURIComponent(filename)}`;
      resolve({
        ok: true,
        kind: 'audio',
        provider: 'vivy-voice-instrumental-mix',
        filename,
        url,
        audioUrl: url,
        audio_url: url,
        content_type: 'audio/mpeg',
      });
      console.info(`[Vivy Studio] Preview mix ready file=${filename}`);
    });
  });
}

function runVivyMultiVoiceAssembly(rawSegments = []) {
  if (!Array.isArray(rawSegments) || rawSegments.length < 1 || rawSegments.length > 20) {
    const error = new Error('vivy_multi_voice_segments_invalid');
    error.status = 400;
    throw error;
  }
  const segmentPaths = rawSegments.map((segment) => {
    const audioUrls = Array.isArray(segment?.audioUrls) ? segment.audioUrls : [];
    if (audioUrls.length < 1 || audioUrls.length > 4) {
      const error = new Error('vivy_multi_voice_segment_sources_invalid');
      error.status = 400;
      throw error;
    }
    const paths = audioUrls.map((audioUrl) => resolveVivyPreviewVoicePath(audioUrl));
    if (paths.some((voicePath) => !voicePath)) {
      const error = new Error('vivy_multi_voice_source_invalid');
      error.status = 400;
      throw error;
    }
    return paths;
  });
  const digest = crypto.createHash('sha1')
    .update(`${segmentPaths.flat().join('\n')}\n${Date.now()}`)
    .digest('hex')
    .slice(0, 10);
  const filename = `vivy-multi-voice-${Date.now()}-${digest}.mp3`;
  const outputPath = getEmergencyMediaAssetPath(filename);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const ffmpeg = String(process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
  const args = buildVivyMultiVoiceAssemblyArgs(segmentPaths, outputPath);

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('vivy_multi_voice_assembly_timeout'));
    }, 240000);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk || '')}`.slice(-2400);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !fs.existsSync(outputPath)) {
        reject(new Error(stderr.trim() || `vivy_multi_voice_assembly_exit_${code}`));
        return;
      }
      const url = `/api/vivy/studio/assets/${encodeURIComponent(filename)}`;
      resolve({
        ok: true,
        kind: 'audio',
        provider: 'vivy-multi-voice-preview',
        filename,
        url,
        audioUrl: url,
        audio_url: url,
        content_type: 'audio/mpeg',
      });
    });
  });
}

function createVivyStudioRouter({ verifyJWT, creativeCapabilityService = null } = {}) {
  const router = express.Router();
  const resolveCreativeAuthorization = (req) => {
    if (!creativeCapabilityService || typeof creativeCapabilityService.verifyCapabilityToken !== 'function') return null;
    const token = cleanOneLine(req.headers?.['x-a11-creative-capability'], '', 4096);
    if (!token) return null;
    return creativeCapabilityService.verifyCapabilityToken(token, req.user || {});
  };
  const optionalAuth = (req, res, next) => {
    if (typeof verifyJWT !== 'function' || !extractRequestAuthToken(req)) return next();
    return verifyJWT(req, res, next);
  };
  const requireAuth = (req, res, next) => {
    if (typeof verifyJWT !== 'function') {
      return res.status(503).json({
        ok: false,
        error: 'vivy_auth_not_configured',
        message: 'Connexion Vivy indisponible: garde serveur manquant.',
      });
    }
    return verifyJWT(req, res, next);
  };

  router.get('/assets/:filename', async (req, res) => {
    try {
      const filePath = getEmergencyMediaAssetPath(req.params.filename);
      if (!filePath) {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      const extension = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const contentType = contentTypes[extension];
      if (!contentType) {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(contentType);
      return res.sendFile(filePath);
    } catch {
      return res.status(404).json({ ok: false, error: 'asset_not_found' });
    }
  });

  // Sub-directory variant: /assets/:subdir/:filename (e.g. covers/ville.png).
  // The subdirectory name is restricted to [a-z0-9_-] and the filename to
  // [a-z0-9_.-]; path traversal is rejected inside getEmergencyMediaAssetSubpath.
  router.get('/assets/:subdir/:filename', async (req, res) => {
    try {
      const filePath = getEmergencyMediaAssetSubpath(`${req.params.subdir}/${req.params.filename}`);
      if (!filePath) {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      const extension = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const contentType = contentTypes[extension];
      if (!contentType) {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(contentType);
      return res.sendFile(filePath);
    } catch {
      return res.status(404).json({ ok: false, error: 'asset_not_found' });
    }
  });

  router.get('/health', (_req, res) => {
    const localContext = buildVivyLocalContextSnapshot('');
    res.json({
      ok: true,
      service: 'vivy-studio',
      modes: Array.from(MODES),
      mediaAgentRoles: getMediaAgentRoleMatrix(),
      pipelines: {
        voice: buildMediaPipeline('audio', { withAudio: true }),
        song: buildMediaPipeline('song', { withAudio: true }),
        share: buildMediaPipeline('share', { withAudio: true }),
      },
      tokenStored: false,
      writesByDefault: false,
      conversationalAi: {
        enabled: Boolean(createVivyOpenAIClient()),
        memory: 'episodic-private',
        files: true,
        localContext: true,
      },
      vision: {
        janus: localContext.janus,
        fallbackModel: getVivyVisionModel(getVivyOpenAIConfig().baseURL),
      },
      localContext: serializeVivyLocalContext(localContext),
      emergencyMedia: {
        audio: String(process.env.VIVY_STUDIO_ENABLE_PLACEHOLDER_MEDIA || '').trim() === '1',
        video: String(process.env.VIVY_STUDIO_ENABLE_PLACEHOLDER_MEDIA || '').trim() === '1',
        placeholderOnly: true,
      },
      musicGeneration: {
        provider: getConfiguredMusicProviders()[0] || 'suno',
        providers: {
          suno: isSunoMusicConfigured(),
          mureka: isMurekaMusicConfigured(),
          elevenlabs: isElevenLabsMusicConfigured(),
        },
        configured: isSunoMusicConfigured() || isMurekaMusicConfigured() || isElevenLabsMusicConfigured(),
        adminOnly: !envFlag('VIVY_MUSIC_ALLOW_NON_ADMIN'),
        sessionSunoKeySupported: true,
        suno: getVivySunoRuntimeStatus(),
      },
    });
  });

  router.get('/sessions', requireAuth, async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const sessions = listVivyChatSessionsForUser(userId);
      res.json({ ok: true, sessions });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_sessions_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.get('/sessions/:sessionId', requireAuth, async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const sessionId = normalizeVivyChatSessionId(req.params.sessionId);
      const sessions = listVivyChatSessionsForUser(userId);
      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session && sessionId !== 'default') {
        return res.status(404).json({ ok: false, error: 'vivy_session_not_found', sessionId });
      }
      const resolvedSession = session
        || ensureVivySessionEntry(new Map(), {
          sessionId,
          conversationId: buildVivyConversationIdForSession(sessionId),
          name: sessionId === 'default' ? 'Session principale' : `Session ${sessionId}`,
        });
      res.json({ ok: true, session: resolvedSession });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_session_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/sessions', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, req.body || {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const context = resolveVivyInputSession({
        sessionId: req.body?.sessionId || `s${Date.now().toString(36)}`,
        sessionName: req.body?.name || req.body?.sessionName,
        conversationId: req.body?.conversationId,
      });
      rememberVivyChatSession(userId, context);
      const sessions = listVivyChatSessionsForUser(userId);
      const session = sessions.find((entry) => entry.id === context.sessionId) || {
        ...context,
        id: context.sessionId,
        name: context.sessionName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        messageCount: 0,
      };
      res.json({ ok: true, session });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_session_create_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/sessions/:sessionId/messages', requireAuth, express.json({ limit: '128kb' }), async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, req.body || {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const result = rememberVivyChatSessionMessage(userId, {
        ...(req.body || {}),
        sessionId: req.params.sessionId,
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || 'vivy_message_sync_failed' });
      }
      const sessions = listVivyChatSessionsForUser(userId);
      const sessionId = normalizeVivyChatSessionId(req.params.sessionId);
      const session = sessions.find((entry) => entry.id === sessionId) || null;
      return res.json({ ok: true, message: result.message, session });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'vivy_message_sync_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const sessionId = normalizeVivyChatSessionId(req.params.sessionId);
      const conversationId = buildVivyConversationIdForSession(sessionId);
      const sessions = listVivyChatSessionsForUser(userId);
      const existing = sessions.find((entry) => entry.id === sessionId);
      const targetConversationId = existing?.conversationId || conversationId;
      const result = clearUserEpisodes(userId, {
        conversationId: targetConversationId,
        typePrefix: 'vivy_',
      });
      res.json({ ok: true, sessionId, conversationId: targetConversationId, cleared: result?.removed ?? 0 });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_session_delete_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.get('/workspace', requireAuth, async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const workspace = getVivyWorkspaceForUser(userId, {
        sessionId: req.query?.sessionId,
        sessionName: req.query?.sessionName,
        conversationId: req.query?.conversationId,
      });
      return res.json({
        ok: true,
        workspace,
        access: buildVivyWorkspaceToolAccess(req),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'vivy_workspace_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.put('/workspace', requireAuth, express.json({ limit: '96kb' }), async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, req.body || {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const result = saveVivyWorkspaceForUser(userId, req.body || {});
      return res.json({
        ok: result.ok,
        workspace: result.workspace,
        memoryStored: result.memoryStored,
        episodeId: result.episodeId,
        access: buildVivyWorkspaceToolAccess(req),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'vivy_workspace_save_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.get('/jobs/:taskId', requireAuth, async (req, res) => {
    try {
      if (!canUseServerSuno(req) && !getRequestSessionSunoApiKey({}, req)) {
        return res.status(403).json({
          ok: false,
          error: 'vivy_music_admin_only',
          message: 'Génération musicale réservée aux comptes Famille/Premium/Fondateur, sauf clé Suno personnelle de session.',
        });
      }
      res.json(await getSunoMusicJob(req.params.taskId, req.query || {}, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_music_job_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/suno/extend', requireAuth, express.json({ limit: '32kb' }), async (req, res) => {
    try {
      if (!canUseServerSuno(req) && !getRequestSessionSunoApiKey(req.body || {}, req)) {
        return res.status(403).json({
          ok: false,
          error: 'vivy_music_admin_only',
          message: 'Génération musicale réservée aux comptes Famille/Premium/Fondateur, sauf clé Suno personnelle de session.',
        });
      }
      const media = await requestSunoMusicExtension(req.body || {}, req);
      if (media?.state === 'processing' && media?.taskId) {
        return res.json({
          ok: true,
          provider: 'suno',
          mediaStatus: {
            state: 'processing',
            provider: 'suno',
            taskId: media.taskId,
            jobId: media.jobId || media.taskId,
            status: media.status || 'submitted',
            extension: true,
            sourceAudioId: media.sourceAudioId,
            uploadExtend: media.uploadExtend === true,
            model: media.model,
            message: 'Vivy a lancé une extension Suno pour laisser respirer le morceau.',
          },
          musicJob: {
            provider: 'suno',
            taskId: media.taskId,
            jobId: media.jobId || media.taskId,
            state: 'processing',
            status: media.status || 'submitted',
            extension: true,
            sourceAudioId: media.sourceAudioId,
            uploadExtend: media.uploadExtend === true,
            model: media.model,
          },
        });
      }
      return res.json({
        ok: true,
        provider: 'suno',
        media,
        audioUrl: media?.audioUrl,
        audio_url: media?.audio_url,
        musicJob: {
          provider: 'suno',
          taskId: media?.taskId,
          jobId: media?.jobId || media?.taskId,
          state: 'done',
          extension: true,
          sourceAudioId: media?.sourceAudioId,
          uploadExtend: media?.uploadExtend === true,
          model: media?.model,
        },
      });
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_suno_extension_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/mix-preview', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const media = await runVivyPreviewMix(req.body?.voiceUrl, req.body?.instrumentalUrl);
      return res.json({ ok: true, media, ...media });
    } catch (error) {
      return res.status(error?.status || 500).json({
        ok: false,
        error: 'vivy_preview_mix_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/assemble-voice-preview', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const media = await runVivyMultiVoiceAssembly(req.body?.segments);
      return res.json({ ok: true, media, ...media });
    } catch (error) {
      return res.status(error?.status || 500).json({
        ok: false,
        error: 'vivy_multi_voice_assembly_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/suno/callback', express.json({ limit: '512kb' }), async (req, res) => {
    try {
      const expected = cleanOneLine(process.env.VIVY_SUNO_CALLBACK_TOKEN || process.env.SUNO_CALLBACK_TOKEN, '', 180);
      if (expected && cleanOneLine(req.query?.t, '', 180) !== expected) {
        return res.status(403).json({ ok: false, error: 'suno_callback_denied' });
      }
      const taskId = findSunoTaskId(req.body || {});
      if (!taskId) return res.status(400).json({ ok: false, error: 'suno_task_missing' });
      const stored = writeCachedSunoCallback(taskId, req.body || {});
      return res.json({ ok: true, taskId, stored });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'suno_callback_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/produce', requireAuth, express.json({ limit: '96kb' }), async (req, res) => {
    try {
      const input = req.body || {};
      const creativeAuthorization = resolveCreativeAuthorization(req);
      const payload = buildVivyStudioProduction({
        ...input,
        language: resolveVivyResponseLanguage(input, req),
        shareToken: undefined,
        sessionSunoApiKey: undefined,
        sunoApiKey: undefined,
        personalSunoApiKey: undefined,
      });
      if (creativeAuthorization) payload.creativeAuthorization = creativeAuthorization;
      let media = null;
      let mediaError = null;
      try {
        media = await buildRealMusicForProduction(payload.mode, input, req);
      } catch (error) {
        mediaError = error;
      }
      if (media?.state === 'processing' && media?.taskId) {
        payload.mediaStatus = {
          state: 'processing',
          provider: media.provider,
          taskId: media.taskId,
          jobId: media.jobId || media.taskId,
          status: media.status || 'submitted',
          voiceMode: media.voiceMode,
          selectedVoicePreserved: media.selectedVoicePreserved === true,
          message: 'Vivy a lancé une vraie génération Suno. La chanson arrive en MP3 dès que le job est terminé.',
        };
        payload.musicJob = {
          provider: media.provider,
          taskId: media.taskId,
          jobId: media.jobId || media.taskId,
          state: 'processing',
          status: media.status || 'submitted',
          voiceMode: media.voiceMode,
          selectedVoicePreserved: media.selectedVoicePreserved === true,
        };
        payload.summary = `${payload.summary} Génération musicale Suno lancée.`;
        return res.json(payload);
      }
      // Skip emergency placeholder when user explicitly requested real music.
      // Without this guard, a missing Suno key silently returns a placeholder WAV.
      const wantedRealMusic = Boolean(input.forceRealMusic || input.generateMusic || input.makeSong || input.song);
      if (!media?.url && !wantedRealMusic) {
        media = await buildEmergencyMediaForProduction(payload.mode, input, req);
      }
      if (media?.url) {
        payload.media = { ...media, isEmergency: Boolean(media.emergencyFallback) };
        if (media.kind === 'audio') {
          payload.audio_url = media.audio_url;
          payload.audioUrl = media.audioUrl;
        }
        if (media.kind === 'video') {
          payload.video_url = media.video_url;
          payload.videoUrl = media.videoUrl;
        }
        payload.assistant = appendMediaToAssistant(payload.assistant, media);
        payload.brief = appendMediaToAssistant(payload.brief, media);
        payload.summary = media.emergencyFallback
          ? `${payload.summary} Média de secours prêt.`
          : `${payload.summary} Chanson audio générée.`;
      } else if (wantedRealMusic) {
        const notConfigured = !mediaError;
        payload.mediaStatus = {
          state: notConfigured ? 'not_configured' : 'error',
          isEmergency: false,
          reason: mediaError?.code || mediaError?.message || 'real_music_provider_not_connected',
          provider: getConfiguredMusicProviders()[0] || 'suno',
          message: notConfigured
            ? 'Suno/ElevenLabs non configuré sur ce serveur. Copie le prompt Suno ci-dessous et colle-le sur suno.com.'
            : `La génération musicale a échoué : ${mediaError?.message || 'erreur inconnue'}. Aucun audio de secours ajouté.`,
          sunoPromptAvailable: Boolean(payload.sunoPrompt || payload.musicPrompt || payload.publicLyrics),
          lyricsPack: true,
        };
        payload.summary = notConfigured
          ? 'Pack Suno prêt. Clé Suno non configurée côté serveur — utilise le prompt directement sur suno.com.'
          : `Paroles prêtes. Génération audio échouée : ${mediaError?.message || 'provider non connecté'}.`;
      } else {
        payload.mediaStatus = {
          state: 'not_configured',
          isEmergency: false,
          reason: mediaError?.code || mediaError?.message || 'real_music_provider_not_connected',
          message: mediaError
            ? `Brief prêt. La génération musicale réelle n’a pas abouti; aucun faux WAV ajouté automatiquement.`
            : 'Brief prêt. Aucun faux WAV ajouté; utilise le bouton musique admin ou prompt + voix active selon le besoin.',
        };
      }
      res.json(payload);
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_studio_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/chat', requireAuth, express.json({ limit: '512kb' }), async (req, res) => {
    try {
      const creativeAuthorization = resolveCreativeAuthorization(req);
      const payload = await buildVivyAiChat({
        ...(req.body || {}),
        shareToken: undefined,
      }, req);
      if (creativeAuthorization) payload.creativeAuthorization = creativeAuthorization;
      res.json(payload);
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_chat_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/djeff/chat', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.json(await buildDjeffAiChat(req.body || {}, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'djeff_chat_failed',
        message: error?.message || String(error),
      });
    }
  });

  // Chemin interne pour le worker MCP (dialogue-only). Auth par token de
  // service dédié, jamais l'auth publique. Si le token n'est pas configuré,
  // la route est fermée (503) — pas de bypass silencieux.
  router.post('/djeff/engine-reply', express.json({ limit: '128kb' }), async (req, res) => {
    const expected = String(process.env.A11_DJEFF_ENGINE_INTERNAL_TOKEN || '').trim();
    const provided = String(req.get('x-djeff-engine-token') || '').trim();
    if (!expected || !provided || provided !== expected) {
      return res.status(expected ? 401 : 503).json({ ok: false, error: 'djeff_engine_token_invalid' });
    }
    try {
      const result = await buildDjeffAiChat({
        message: req.body?.message,
        history: req.body?.history,
        maxTokens: 700,
      }, req);
      return res.json({ ok: true, reply: result.reply, provider: result.provider, model: result.model });
    } catch (error) {
      return res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'djeff_engine_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/nossen-intent', requireAuth, express.json({ limit: '128kb' }), async (req, res) => {
    try {
      res.json(await buildVivyNossenIntentPlan(req.body || {}, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_nossen_intent_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/nossen-route', requireAuth, express.json({ limit: '128kb' }), async (req, res) => {
    try {
      res.json(await buildVivyNossenRoutingPlan(req.body || {}, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_nossen_routing_failed',
        message: error?.message || String(error),
      });
    }
  });

  // POST /nossen-status - preflight: check provider before songwriting
  router.post('/nossen-status', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const input = req.body || {};
      const provider = String(input.musicProvider || '').trim().toLowerCase();

      if (provider === 'mureka') {
        const authorized = canUseServerSuno(req);
        if (!authorized) { return res.status(403).json({ ok: false, error: 'mureka_not_authorized', message: 'Mureka reserve aux comptes Famille/Premium/Fondateur.' }); }
        const configured = isMurekaMusicConfigured();
        if (!configured) { return res.status(503).json({ ok: false, error: 'mureka_not_configured', message: 'La cle serveur Mureka est absente.' }); }
        return res.json({ ok: true, provider: 'mureka', configured: true, authorized: true });
      }

      if (provider === 'suno') {
        const sessionKey = getRequestSessionSunoApiKey(input, req);
        if (sessionKey) { return res.json({ ok: true, provider: 'suno', configured: true, authorized: true, personalSessionKey: true }); }
        const authorized = canUseServerSuno(req);
        if (!authorized) { return res.status(403).json({ ok: false, error: 'suno_not_authorized', message: 'Suno serveur reserve aux comptes Famille/Premium/Fondateur.' }); }
        const configured = isSunoMusicConfigured();
        if (!configured) { return res.status(503).json({ ok: false, error: 'suno_not_configured', message: 'La cle serveur Suno est absente.' }); }
        return res.json({ ok: true, provider: 'suno', configured: true, authorized: true, personalSessionKey: false });
      }

      return res.status(400).json({ ok: false, error: 'unknown_music_provider', message: 'Fournisseur inconnu: ' + (provider || '(vide)') });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'vivy_nossen_status_failed', message: error?.message || String(error) });
    }
  });


  // DELETE /memory - efface les episodes memoire de l'utilisateur (reset chat backend)
  router.delete('/memory', requireAuth, async (req, res) => {
    try {
      const userId = resolveVivyMemoryUser(req, req.body || {});
      if (!userId) return res.status(401).json({ ok: false, error: 'vivy_auth_required' });
      const conversationId = cleanOneLine(req.query?.conversationId || req.body?.conversationId, '', 120);
      const result = clearUserEpisodes(userId, {
        conversationId,
        typePrefix: 'vivy_',
      });
      res.json({ ok: true, cleared: result?.removed ?? 0 });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'vivy_memory_clear_failed', message: String(error?.message || error) });
    }
  });

  return router;
}

module.exports = {
  createVivyStudioRouter,
  buildVivyStudioProduction,
  buildRealMusicForProduction,
  buildVivyMultiVoiceAssemblyArgs,
  buildVivyPreviewMixArgs,
  resolveVivyPreviewVoicePath,
  buildVivyMp3RepairArgs,
  repairVivyMp3File,
  materializeVivyPreviewInstrumentalPath,
  materializeVivySunoMedia,
  buildVivyMusicPrompt,
  buildVivyChat,
  buildVivyAiChat,
  buildDjeffAiChat,
  buildDjeffModeSystemPrompt,
  isDjeffCypherRequest,
  isDjeffTechnicalAuditRequest,
  hasDjeffTechnicalGroundingViolation,
  buildDjeffGroundedAuditFallback,
  resolveDjeffTokenBudget,
  masterVivyMusicFile,
  buildVivyConversationIdForSession,
  resolveVivyInputSession,
  listVivyChatSessionsForUser,
  normalizeVivyChatHistory,
  getVivyOpenAIConfig,
  getVivyLocalOllamaConfig,
  getVivyLocalOllamaConfigs,
  getVivyCloudProviderConfig,
  getVivyCloudConfigs,
  getVivyOllamaCloudConfig,
  getVivyCerbereSongConfig,
  getVivyLlmConfigs,
  createVivyOpenAIClientFromConfig,
  countVivyChorusSections,
  buildVivyMemoryContext,
  buildVivySystemPrompt,
  buildVivyDirectSongReply,
  buildVivyVisualCreativeDirectionReply,
  buildVivyPromptAuthorityReply,
  isVivyPromptAuthorityRequest,
  buildVivyPublicLyrics,
  buildVivyNossenIntentPlan,
  inferVivyNossenIntentPlan,
  parseVivyNossenIntentPlan,
  buildVivyNossenRoutingPlan,
  inferVivyNossenRoutingPlan,
  parseVivyNossenRoutingPlan,
  strengthenVivyNossenRoutingPlan,
  enforceVivyNossenVoiceSemantics,
  sanitizeVivyNossenRoutingPlanForRequest,
  buildVivySunoPayload,
  clampVivySunoLyricsLength,
  buildVivyMurekaPayload,
  extractSunoMedia,
  scoreVivySunoDirectorTrack,
  selectVivySunoDirectorTrack,
  getVivySunoRuntimeStatus,
  requestSunoMusicExtension,
  requestMurekaMusic,
  getMurekaMusicJob,
  getVivyMusicJob,
  buildVivyWebSearchQuery,
  postProcessVivyAssistantText,
  sanitizeVivyPublicText,
  isDirectSongwritingRequest,
  shouldVivyAutoWebSearch,
  looksLikeWeakSongwritingReply,
  isVivyWorkspaceToolRequest,
  isVivyVisualCreativeDirectionRequest,
  buildVivyWorkspaceToolAccess,
  getVivyWorkspaceForUser,
  saveVivyWorkspaceForUser,
  isVivyMcpNeo4jQuestion,
  isVivyToolCapabilityQuestion,
  isVivyZenSelfManagementQuestion,
  buildVivyZenSelfManagementReply,
  getVivyZenRuntimeStatus,
  getSunoMusicJob,
  buildEmergencyMediaForProduction,
};
