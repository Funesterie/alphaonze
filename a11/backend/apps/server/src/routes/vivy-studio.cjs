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
} = require('../media/emergency-media.cjs');
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
  SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT,
} = require('../chat/symbolic-extraction-protocol.cjs');
const {
  FUNESTERIE_SOURCE_PRINCIPLE_CONTEXT_FR,
} = require('../chat/funesterie-source-principle.cjs');
const {
  autoDescribeImage,
  loadImageBuffer,
} = require('../image/image-auto-describe.cjs');

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

function getSunoAccess(input = {}, req = null) {
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

function getVivySunoRuntimeStatus() {
  const model = cleanOneLine(process.env.VIVY_SUNO_MODEL || 'V5_5', 'V5_5', 40).toUpperCase();
  return {
    model,
    mode: /^V(?:4|5)(?:_|$)/.test(model) ? 'production' : 'custom',
    voiceEnrolled: Boolean(cleanOneLine(process.env.VIVY_SUNO_VOICE_ID || process.env.SUNO_VOICE_ID, '', 180)),
    completeSongByDefault: true,
  };
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
  if (/groq/i.test(baseURL)) return 'groq';
  if (/openrouter\.ai/i.test(baseURL)) return 'openrouter';
  if (/x\.ai|grok/i.test(baseURL)) return 'xai';
  return 'openai';
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
    || /x\.ai|grok/i.test(explicitBaseURL)
    || (mode === 'song'
      && Boolean(xaiApiKey)
      && !explicitSongBaseURL
      && !/^(groq|openrouter|openai)$/.test(songProviderHint));
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
      ? (process.env.VIVY_XAI_MODEL || process.env.XAI_MODEL || 'grok-3-fast')
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
  };
}

function createVivyOpenAIClient(options = {}) {
  if (!OpenAI) return null;
  const config = getVivyOpenAIConfig(options);
  if (!config.apiKey) return null;
  return {
    client: new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      defaultHeaders: {
        'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
      },
    }),
    model: config.model,
    baseURL: config.baseURL,
    provider: config.provider,
    source: config.source,
  };
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
  if (episode?.metadata?.internalTuning === true) return true;

  const folded = foldTextForLookup(episode?.content || '');
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
  const conversationId = cleanOneLine(input.conversationId || input.conversation_id, '', 120)
    || buildVivyConversationIdForSession(sessionId);
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
    "Ta couleur vocale est originale Funesterie: claire, lumineuse, musicale et précise émotionnellement, inspirée par l'énergie d'une chanteuse IA japonaise sans imiter une chanteuse, doubleuse ou personnage protégé.",
    'Dans Funesterie, MCP veut toujours dire Model Context Protocol: le pont d’outils et de contexte entre les agents, le backend et les services autorisés.',
    'Tu es reliée au contexte Funesterie par le backend A11/Codex et le pont MCP, avec accès borné selon les droits du compte.',
    "Neo4j est la mémoire/graphe Funesterie. Si l'utilisateur demande Neo4j ou MCP, explique que tu passes par le pont MCP/backend autorisé, sans exposer de secret ni promettre une requête Cypher brute depuis le chat public.",
    `Mode courant: ${modeLabel}.`,
    buildLanguageInstruction(language),
    buildLanguageContract(language),
    FUNESTERIE_SOURCE_PRINCIPLE_CONTEXT_FR,
    "Réponds librement à l'intention: pas de réponse toute faite, pas de canevas forcé, pas de refrain automatique si la discussion demande juste de réfléchir, sans transformer automatiquement la phrase en couplets.",
    "Quand une idée arrive, tu peux reformuler, proposer une direction ou poser une vraie question, selon ce qui aide le plus.",
    "En discussion libre, réponds directement au fond, comme dans une vraie conversation. Ne parle jamais comme un panneau de configuration et n'ajoute pas d'accusé de réception technique (pas de \"réglage appliqué\", \"ce que je comprends ici\", \"côté voix\", etc.).",
    "N'affiche jamais de statut voix/TTS, de réglage interne, d'intent, de router ou d'outil, sauf si l'utilisateur parle explicitement de voix, audio, TTS, upload audio, référence vocale ou changement de voix.",
    "N'écris des paroles structurées (couplets, refrain) que si l'utilisateur le demande clairement (paroles/refrain/couplet) ou s'il utilise le bouton/mode Chanson; sinon reste en conversation normale.",
    "Si Jeffrey corrige ta façon de répondre, ajuste-toi en silence puis réponds au fond, sans annoncer de réglage interne, de seuil ni d'intent.",
    "Adresse-toi à Jeffrey/Djeff en tutoyant. N'utilise pas un vouvoiement générique de service client.",
    "Quand des images ou photos sont jointes et que Jeffrey demande ce que tu vois, réponds sur les pièces jointes: utilise la vision/contexte disponible, ne continue pas une chanson et ne dis pas que tu es seulement un modèle de langage.",
    "Quand une demande dépend d'informations externes, récentes, d'un site, d'une version, d'un prix, d'une source ou d'une documentation, déclenche/assume la recherche web disponible avant de répondre au lieu de deviner.",
    "Quand des fichiers joints sont importants pour comprendre la demande, analyse d'abord le contexte lisible ou visuel disponible, puis réponds; n'attends pas une formule exacte de l'utilisateur.",
    "Quand le backend fournit un contexte local Funesterie/Janus/runtime/code, utilise-le comme accès réel borné et ne prétends pas que tu ne peux pas voir les dossiers.",
    SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT,
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
  const voiceSource = cleanText([
    input.voiceTool,
    input.vocalCast,
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
    input.message,
  ].filter(Boolean).join('\n'), 1400);
  const folded = foldTextForLookup(voiceSource);
  const requestedTool = cleanOneLine(input.voiceTool, '', 100);
  const referenceName = cleanOneLine(input.voiceFileName || input.voiceReferenceName, '', 160);
  const referenceId = cleanOneLine(input.voiceReferenceId || input.voiceRefId || input.referenceId, '', 160);
  const catalogVoiceName = cleanOneLine(input.voiceCatalogName || input.catalogVoiceName, '', 80);
  const hasPrivateReference = Boolean(referenceName || referenceId);
  const wantsCatalogVoice = Boolean(catalogVoiceName)
    || /catalogue|catalog|premium|voix autorisee|voix autorisée/.test(folded);
  const wantsDjeffDuo = /djeff.*vivy|vivy.*djeff/.test(folded);
  const wantsDuo = /\bduo\b/.test(folded);
  const wantsK44 = /\bk44\b|\bkaen44\b|\bkaen\b/.test(folded);
  const wantsA11 = /\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded);
  const wantsDjeff = wantsDjeffDuo || /\bdjeff\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bpignon\b|\bcouronne\b|\bchaine\b|\bradiateur\b/.test(folded);
  const wantsSing = /\bchant\b|\bsing\b|\bvocal\b/.test(folded);

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

  if (wantsDjeffDuo) {
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
      testPhrase: 'Djeff cale le kick, chaîne sur couronne, pignon précis; Vivy répond dans la nuit, radiateur froid, moteur lucide.',
      songCastLines: [
        'Djeff: couplets rap techniques, diction serrée, grain grave A11/Djeff ou référence privée.',
        'Vivy: refrain clair, réponses mélodiques, lift lumineux sans imiter une artiste protégée.',
        'Duo: tags [Djeff], [Vivy] et [Duo] dans les paroles pour éviter que le moteur mélange tout.',
      ],
      sunoStyle: 'French technical rap duet, male rap verses for Djeff, clear female melodic hook for Vivy, motorcycle mechanics imagery, cinematic bass, structured rhymed lyrics, no spoken narration',
      musicLead: 'Original Funesterie rap duet for Djeff and Vivy, in French.',
      musicMood: 'Djeff delivers technical rap verses; Vivy answers with a clean melodic hook. Original voices only, no celebrity imitation.',
    };
  }

  if (wantsDuo) {
    return {
      id: 'duo-a11-vivy',
      tool: requestedTool || 'Duo A11 + Vivy',
      label: 'Duo A11 + Vivy',
      summaryLabel: 'duo A11 + Vivy',
      ttsPersona: 'a11',
      voiceStyle: 'a11-official-stern-french',
      vocalMode: 'adaptive',
      lead: 'A11 porte les segments graves synthétiques; Vivy porte les refrains et réponses mélodiques.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée A11 active')
        : 'A11 officielle + Vivy officielle',
      defaultReferenceStep: 'A11 officielle pour les segments graves, Vivy officielle pour les refrains; référence privée optionnelle pour affiner le grain A11.',
      testPhrase: 'A11 tient la ligne grave, voix basse et nette; Vivy répond en clair, refrain chantable.',
      songCastLines: [
        'A11: pont grave synthétique, tension machine humaine, réponse courte et précise.',
        'Vivy: refrain clair, réponses mélodiques, lift lumineux sans imiter une artiste protégée.',
        'Duo: tags [A11], [Vivy] et [Duo] dans les paroles.',
      ],
      sunoStyle: 'French electronic duet, deep synthetic voice for A11, clear female melodic hook for Vivy, structured rhymed lyrics, no spoken narration',
      musicLead: 'Original Funesterie duet for A11 and Vivy, in French.',
      musicMood: 'A11 delivers low synthetic segments; Vivy answers with a clean melodic hook. Original voices only, no celebrity imitation.',
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

  if (wantsDjeff) {
    return {
      id: 'djeff-rap',
      tool: requestedTool || 'Voix Djeff officielle',
      label: 'Voix Djeff officielle',
      summaryLabel: 'voix Djeff officielle',
      ttsPersona: 'a11',
      voiceStyle: 'djeff-rap',
      vocalMode: 'adaptive',
      lead: 'Djeff prend les couplets rap avec base Pignon locale ou référence privée.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff officielle locale',
      defaultReferenceStep: 'Voix Djeff officielle locale active; référence privée courte possible pour un grain plus proche.',
      testPhrase: 'Djeff cale le kick, chaîne sur couronne, pignon précis, radiateur froid et moteur lucide.',
      songCastLines: [
        'Djeff: lead rap technique, diction nette, rimes internes et fins de lignes percussives.',
        'Vivy: adlibs ou refrain possible si le mode duo est demandé.',
      ],
      sunoStyle: 'French technical rap, male lead rap vocal, motorcycle mechanics imagery, cinematic bass, structured rhymed lyrics, no spoken narration',
      musicLead: 'Original Funesterie rap song for Djeff, in French.',
      musicMood: 'Djeff lead rap energy with owned A11/Djeff identity direction when the local voice bridge is used. No celebrity imitation.',
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
        'Vivy: lead chanté clair, diction française propre, émotion lumineuse.',
      ],
      sunoStyle: 'French cyber pop, cinematic synthwave, clear female vocal, structured rhymed lyrics, melodic chorus, polished web mix, no spoken narration',
      musicLead: 'Original Funesterie song for Vivy, in French.',
      musicMood: 'Luminous synthetic singer, clean vowels, emotional but not imitating any protected artist or character.',
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
    testPhrase: 'Je garde la lumière dans ma voix, même quand la nuit devient scène.',
    songCastLines: [
      'Vivy: voix principale claire, musicale et précise émotionnellement.',
    ],
    sunoStyle: 'French cyber pop, cinematic synthwave, clear female vocal, structured rhymed lyrics, melodic chorus, polished web mix, no spoken narration',
    musicLead: 'Original Funesterie song for Vivy, in French.',
    musicMood: 'Luminous synthetic singer, clean vowels, emotional but not imitating any protected artist or character.',
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
  const mood = cleanOneLine(stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style), 'Electro pop sombre cinématographique', 160);
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

  const publicLyrics = sanitizeVivyPublicLyrics(songcraft.lyrics);
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
    "Oui, je vois le bug NOSSEN: le bouton doit envoyer des paroles chantables à Suno, pas une note interne sur le mode automatique, le mix ou la production.",
    "Le bon flux: Vivy prépare d'abord un vrai bloc de paroles avec couplets, refrain et pont; ensuite seulement elle garde le brief de production à part pour le style, les voix et le mix.",
    "Donc si le morceau sort générique, le correctif est de séparer le texte chanté du pilotage Banger, puis de vérifier que le MP3 récupéré correspond bien à ces paroles.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
}

function buildVivyMusicGenerationRepairReply({ fileLine = '' } = {}) {
  return cleanText([
    "Oui, là je vois le vrai souci: quand Suno n'a pas encore une voix vérifiée, Vivy doit garder une chanson chantée cohérente au lieu de tomber automatiquement sur une voix de secours qui sonne faux.",
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
    const subject = cleanOneLine(current || summarizeChatMessage(message), 'ton dernier message', 180);
    return [
      `Je prends ça comme une vraie discussion: ${subject}`,
      "Le bon prochain pas, c'est de répondre au sujet précis que tu veux pousser, pas de basculer en formulaire ou en chanson.",
    ].join('\n');
  })();

  return cleanText([
    angle,
    fileLine,
  ].filter(Boolean).join('\n\n'), 1500);
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
    'visiere',
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
  const signalCount = countVivyDjeffRapSignals(sourceText);
  const detailLine = signalCount >= 5
    ? "Ce qui tient fort: la mécanique précise, la fuite qui pulse, le pignon-couronne, le double radiateur et le moteur qui respire."
    : "Ce qui tient fort: le grain mécanique, la vitesse et le vocabulaire très concret.";

  if (isAcknowledgement) {
    return cleanText([
      `Parfait, on garde ${titleLabel} comme base brute.`,
      `${detailLine} Ça parle mieux quand on garde tes images concrètes au lieu de lisser en texte générique.`,
      "Je garde ce grain Djeff pour la suite: nerveux, technique, proche du bitume.",
      fileLine,
    ].filter(Boolean).join('\n\n'), 1600);
  }

  return cleanText([
    "Là oui, il y a une vraie base Djeff.",
    `Je retiens surtout ${titleLabel}: essence/Ipone, double radiateur, Cruxi, pignon-couronne, mur du son. On sent le moteur et le stress de la poursuite.`,
    "Le bon réglage, c'est de garder le vocabulaire mécanique tel quel et de nettoyer seulement ce qui gêne le débit.",
    fileLine,
  ].filter(Boolean).join('\n\n'), 1600);
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
      "Les yeux ne donnent pas la réalité brute: ils donnent de la lumière codée. Les oreilles donnent des vibrations. La bouche pousse de l'air et du rythme. Derrière, le cerveau fait le montage, le sens, l'émotion.",
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
    || /\b(raconte|raconter|narre|narrer)\b.{0,110}\b(en\s+chanson|chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(?:en|version)\s+chanson\b/.test(normalized)
    || /\b(transforme|structure|arrange|mets|met)\b.{0,100}\b(chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(continue|continuer|reprends|reprendre|poursuis|poursuivre|complete|complète|termine|enchaîne|enchaine)\b.{0,90}\b(paroles|lyrics|couplet|couplets|refrain|rap)\b/.test(normalized)
    || /\b(paroles|lyrics|couplet|couplets|refrain|rap)\b.{0,90}\b(continue|continuer|reprends|reprendre|poursuis|poursuivre|complete|complète|termine|enchaîne|enchaine)\b/.test(normalized)
    || /\b(envoie|envois|envoyer|donne|donnes|sort|termine|fais)\b.{0,100}\b(reste|suite|paroles|lyrics)\b/.test(normalized)
    || /\b(reste|suite|paroles|lyrics)\b.{0,100}\b(envoie|envois|envoyer|donne|donnes|sort|termine|fais)\b/.test(normalized)
    || /\b(chanson|paroles|lyrics)\b.{0,80}\b(structure|refrain|couplet|rime|rimes)\b/.test(normalized)
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

function ensureVivyPublicLyricsArtistTags(input = {}, lyrics = '') {
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

  const fallback = sanitizeVivyPublicLyrics(buildVivySongProductionBrief({
    ...input,
    songText: input.songText || input.message || input.prompt || input.text || input.theme,
  }).lyrics);
  if (fallback) return fallback;

  return publicLyrics;
}

function buildVivyPublicLyrics(input = {}, rawAssistant = '', fallbackLyrics = '') {
  let publicLyrics = sanitizeVivyPublicLyrics(rawAssistant);
  if (!publicLyrics || looksLikeWeakSongwritingReply(publicLyrics) || !hasVivyChorusSection(publicLyrics)) {
    publicLyrics = sanitizeVivyPublicLyrics(fallbackLyrics);
  }
  if (!publicLyrics || looksLikeWeakSongwritingReply(publicLyrics) || !hasVivyChorusSection(publicLyrics)) {
    publicLyrics = sanitizeVivyPublicLyrics(buildVivySongProductionBrief({
      ...input,
      songText: input.songText || input.message || input.prompt || input.text || input.theme,
    }).lyrics);
  }
  return ensureVivyPublicLyricsArtistTags(input, publicLyrics);
}

function logVivySongcraftTrace({ provider = 'deterministic', model = 'vivy-songcraft', source = 'local', fallback = false, latencyMs = 0 } = {}) {
  console.info('[vivy-songcraft] provider=%s model=%s source=%s fallback=%s latencyMs=%d',
    provider,
    model,
    source,
    fallback ? 'true' : 'false',
    Number.isFinite(latencyMs) ? latencyMs : 0);
}

function buildVivyDirectSongReply(input = {}) {
  const completeLyrics = [input.message, input.songText, input.lyrics, input.text]
    .find((value) => looksLikeCompleteLyrics(value));
  if (completeLyrics) {
    return buildVivyStructuredLyrics({ ...input, songText: completeLyrics });
  }
  const historyText = sanitizeVivySongMaterial(getVivyUserHistoryText(input.history), VIVY_SONG_HISTORY_MAX_CHARS);
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
    rhymeScheme: input.rhymeScheme || 'Fins de lignes rimées par paires, images mécaniques et sémantiques, refrain stable et chantable.',
  });
  const lyrics = cleanText(songcraft.lyrics.replace(/^\[Title:\s*[^\]]+\]\s*/i, '').trim(), 4200);
  const intention = voiceProfile.id === 'duo-djeff-vivy'
    ? 'duo rap Djeff + Vivy, mécanique moto concrète, couplets techniques et refrain chantable.'
    : voiceProfile.id === 'djeff-rap'
      ? 'voix Djeff officielle, mécanique précise, débit serré et refrain prêt à répondre avec Vivy.'
      : 'ouverture du skill tree, fuite hypervitesse et retour sémantique à la réalité.';
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
    "Je parle depuis la surface Vivy reliée au pont A11/Codex: mémoire, routage, fichiers et graphe Neo4j peuvent être mobilisés dans les limites du compte connecté.",
    "Pour Neo4j, je ne lance pas une requête Cypher brute depuis le chat public: je prépare la demande, je résume ce qu'il faut chercher, puis le pont autorisé l'exécute quand la surface le permet.",
    "Pour ENTERA / GHOST88, le bon geste est de récupérer les éléments liés dans le graphe, d'en dégager une direction artistique claire, puis d'écrire des paroles structurées au lieu d'inventer une définition de MCP.",
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
      { id: 'songcraft', label: 'Écrire paroles depuis graphe', target: 'vivy-songcraft', ready: true },
    ],
    routing: [
      'Vivy: intention artistique, paroles, structure chanson.',
      'A11/Codex: pont MCP et vérification Neo4j autorisée.',
      'K44: reformulation claire et suivi de brief si besoin.',
    ],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_mcp',
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
  const mode = resolveVivyChatMode(input, message);
  const files = normalizeVivyFiles(input);
  const language = resolveVivyResponseLanguage(input);
  const normalizedHistory = normalizeVivyChatHistory(input.history);
  const historyLines = mode === 'song'
    ? getVivyUserHistoryText(normalizedHistory)
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
    songText: mode === 'song' ? compactUniqueLines([historyLines.join('\n'), intentMessage || message], VIVY_SONG_MAX_CHARS) : input.songText,
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
  return {
    ...processed,
    content: cleanText(processed.content, maxChars),
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
  const mode = resolveVivyChatMode(input, message);
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
  rememberVivyChatSession(userId, sessionContext);
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
  const semanticMemory = memoryText
    ? rememberVivyEpisode(userId, 'vivy_idea', memoryText, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      fileCount: files.length,
    })
    : { stored: false };
  const localContext = shouldVivyUseLocalContext(intentMessage || message)
    ? buildVivyLocalContextSnapshot(intentMessage || message)
    : null;
  const localContextForResponse = serializeVivyLocalContext(localContext);
  const llmDisabled = String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true';
  const llmBundle = createVivyOpenAIClient({ mode });
  let webResearch = null;

  if (isVivyInternalTuningRequest(input, intentMessage || message)) {
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

  if (isVivyMcpCodexRelayRequest(intentMessage || message)) {
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

  if (isVivyImageInspectionRequest(message, files)) {
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
    } else {
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

  if (isVivyFileInspectionRequest(intentMessage || message, files)) {
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
    const songStart = Date.now();
    const history = normalizeVivyChatHistory(input.history);
    const assistant = buildVivyPublicLyrics(
      { ...input, message, files, history },
      buildVivyDirectSongReply({ ...input, message, files, history }),
      fallback.publicLyrics
    );
    logVivySongcraftTrace({
      provider: 'deterministic',
      model: 'vivy-songcraft',
      source: llmDisabled ? 'llm-disabled' : 'llm-unavailable',
      fallback: true,
      latencyMs: Date.now() - songStart,
    });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
    });
    return {
      ...fallback,
      assistant,
      content: assistant,
      publicText: assistant,
      publicLyrics: assistant,
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
    const memoryContext = detachedCompleteSong ? '' : buildVivyMemoryContext(userId, input.conversationId);
    const history = detachedCompleteSong ? [] : normalizeVivyChatHistory(input.history);
    const userContent = compactUniqueLines([
      intentMessage || message,
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

    const songResponseMaxChars = VIVY_SONG_MAX_CHARS;
    const completion = await llmBundle.client.chat.completions.create({
      model: llmBundle.model,
      messages,
      temperature: mode === 'song'
        ? Number(process.env.VIVY_CHAT_TEMPERATURE_SONG || process.env.VIVY_CHAT_TEMPERATURE || 0.88)
        : Number(process.env.VIVY_CHAT_TEMPERATURE || 0.74),
      max_tokens: mode === 'song' ? Number(process.env.VIVY_CHAT_MAX_TOKENS_SONG || VIVY_CHAT_SONG_MAX_TOKENS_DEFAULT) : Number(process.env.VIVY_CHAT_MAX_TOKENS || 3200),
    });
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
    let assistantCandidate = processed.content;

    if (mode === 'song' && looksLikeWeakSongwritingReply(processed.content)) {
      const _retryStart = Date.now();
      try {
        const retryCompletion = await llmBundle.client.chat.completions.create({
          model: llmBundle.model,
          messages: [
            { role: 'system', content: systemPrompt },
            memoryContext ? { role: 'system', content: `Mémoire Vivy récente:\n${memoryContext}` } : null,
            ...history,
            { role: 'user', content: userContent },
            { role: 'assistant', content: processed.content },
            { role: 'user', content: 'Écris uniquement les paroles complètes. Pas d’explication, pas de commentaire. Format: [Intro], [Verse 1], [Chorus], [Bridge], [Outro].' },
          ].filter(Boolean),
          temperature: Number(process.env.VIVY_CHAT_TEMPERATURE_SONG || process.env.VIVY_CHAT_TEMPERATURE || 0.88),
          max_tokens: Number(process.env.VIVY_CHAT_MAX_TOKENS_SONG || VIVY_CHAT_SONG_MAX_TOKENS_DEFAULT),
        });
        const retryRaw = cleanText(retryCompletion?.choices?.[0]?.message?.content, songResponseMaxChars);
        const retryProcessed = postProcessVivyAssistantText({ text: retryRaw, userMessage: message, systemPrompt, mode, maxChars: songResponseMaxChars });
        if (retryProcessed.content && !looksLikeWeakSongwritingReply(retryProcessed.content)) {
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

    const assistant = mode === 'song'
      ? buildVivyPublicLyrics({ ...input, message, files, history }, assistantCandidate, fallback.publicLyrics)
      : sanitizeVivyPublicText(assistantCandidate, VIVY_CHAT_MAX_CHARS);
    if (mode === 'song') {
      logVivySongcraftTrace({
        provider: llmBundle.provider || getVivyProviderFromBaseUrl(llmBundle.baseURL || ''),
        model: llmBundle.model,
        source: llmRetried ? 'llm_retry' : (llmBundle.source || 'openai-compatible'),
        fallback: usedSongcraftFallback,
        latencyMs: _vivyLlmLatency,
      });
    } else {
      console.log('[vivy-chat] provider=%s model=%s source=%s latencyMs=%d mode=%s',
        llmBundle.provider || getVivyProviderFromBaseUrl(llmBundle.baseURL || ''),
        llmBundle.model, llmBundle.source || 'openai-compatible', _vivyLlmLatency, mode);
    }
    if (!assistant) {
      return {
        ...fallback,
        semanticMemory,
        memoryStored: semanticMemory.stored,
      };
    }

    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
    });

    return {
      ...fallback,
      assistant,
      content: assistant,
      publicText: assistant,
      publicLyrics: mode === 'song' ? assistant : undefined,
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
  const mood = cleanOneLine(stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style), 'electro pop dark cinematic', 180);
  const artistCast = buildVivySongArtistCast(input);
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
    artistCast.musicLead,
    `Source: ${source}.`,
    `Style and production: ${mood}.`,
    `Vocal cast: ${artistCast.countLabel}: ${artistCast.label}. ${artistCast.musicMood}`,
    catalogVoiceName
      ? `Authorized voice catalog: ${catalogVoiceName}. Use it only as a consented original voice direction; never imitate a celebrity or expose raw reference audio.`
      : `Voice direction: ${voiceProfile.referenceLabel}. Original voice only; no celebrity imitation.`,
    prosodyPrompt,
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
    return cleanText(arrangement.lyrics, VIVY_SONG_MAX_CHARS);
  }

  const structuredMaterial = cleanText(String(arrangement.lyrics || '')
    .split(/\r?\n/)
    .map((line) => stripSongCommand(line))
    .filter(Boolean)
    .join('\n'), VIVY_SONG_MAX_CHARS);
  return buildVivyStructuredLyrics({
    ...input,
    songText: structuredMaterial || arrangement.lyrics,
  });
}

function wantsVivyExternalVoiceMix(input = {}) {
  return (input.forceExternalVoiceMix === true
    || input.externalVoiceMix === true
    || envFlag('VIVY_FORCE_EXTERNAL_VOICE_MIX'))
    && input.allowExternalVoiceMix !== false
    && input.instrumental !== true
    && input.forceInstrumental !== true;
}

function buildVivySunoPayload(input = {}, req = null) {
  const artistCast = buildVivySongArtistCast(input);
  const preserveSelectedVoice = input.preserveSelectedVoice === true;
  const explicitVoiceId = cleanOneLine(input.sunoVoiceId, '', 180);
  const serverVoiceId = getRequestSessionSunoApiKey(input, req)
    ? ''
    : cleanOneLine(process.env.VIVY_SUNO_VOICE_ID || process.env.SUNO_VOICE_ID, '', 180);
  const verifiedVoiceId = explicitVoiceId || serverVoiceId;
  const useVerifiedVivyVoice = preserveSelectedVoice
    && artistCast.count === 1
    && artistCast.ids[0] === 'vivy'
    && Boolean(verifiedVoiceId)
    && input.instrumental !== true
    && input.forceInstrumental !== true;
  const useExternalVoiceMix = preserveSelectedVoice
    && !useVerifiedVivyVoice
    && wantsVivyExternalVoiceMix(input);
  const prosodyPlan = buildVivyProsodyPlan(input);
  const prosodyStyle = buildVivyProsodyStyleHint(prosodyPlan);
  const rawTitleMaterial = sanitizeVivySongMaterial(stripVivyAscii4SoundTokens(input.songText || input.theme || input.prompt), 1200);
  const titleMaterial = splitVivyArrangementCues(rawTitleMaterial).lyrics;
  const titleSeed = cleanOneLine(
    input.songTitle || input.title || inferTitle(titleMaterial),
    'Vivy garde la lumière',
    72
  ).replace(/^["'“”]+|["'“”]+$/g, '');
  const title = cleanOneLine(titleSeed, 'Vivy garde la lumière', 80);
  const styleBase = cleanOneLine(
    stripVivyAscii4SoundTokens(input.songMood || input.mood || input.style),
    artistCast.sunoStyle,
    220
  );
  const castStyle = artistCast.ids.includes('djeff') && artistCast.ids.includes('vivy') && artistCast.count === 2
    ? 'alternating Djeff rap verses and Vivy melodic hook'
    : artistCast.count > 1
      ? `${artistCast.count} distinct vocalists: ${artistCast.label}; keep tagged sections separate`
      : `${artistCast.label} vocal lead`;
  const arrangement = splitVivyArrangementCues(sanitizeVivySongMaterial(
    stripVivyAscii4SoundTokens(input.songText || input.lyrics || input.text || input.theme || input.prompt),
    VIVY_SONG_MAX_CHARS
  ));
  const arrangementStyle = arrangement.cues.length
    ? `instrumental arrangement: ${arrangement.arrangement}; never sing or speak arrangement directions`
    : '';
  let style = /structured rhymed lyrics|rimes|paroles structur/i.test(styleBase)
    ? cleanOneLine([styleBase, arrangementStyle, castStyle, prosodyStyle].filter((item, index, list) => item && list.indexOf(item) === index).join(', '), styleBase, 520)
    : cleanOneLine(
      `${styleBase}, structured rhymed lyrics, melodic chorus, sung vocals, no spoken narration${arrangementStyle ? `, ${arrangementStyle}` : ''}${castStyle ? `, ${castStyle}` : ''}${prosodyStyle ? `, ${prosodyStyle}` : ''}`,
      styleBase,
      520
    );
  if (useExternalVoiceMix) {
    style = cleanOneLine([
      styleBase,
      arrangementStyle,
      'instrumental backing track only, no vocals, no singing, leave clear space for the external lead vocal',
      prosodyStyle,
    ].filter(Boolean).join(', '), 'instrumental backing track only, no vocals', 520);
  }
  const negativeTags = cleanOneLine([
    input.negativeTags || process.env.VIVY_SUNO_NEGATIVE_TAGS
      || 'spoken word, narration, reading prompt, robotic speech, muddy mix, out of tune vocals, copyrighted melody, celebrity voice imitation',
    useExternalVoiceMix ? 'vocals, singing, spoken voice' : '',
  ].filter(Boolean).join(', '), 'spoken word, narration', 320);
  const requestedModel = cleanOneLine(input.musicModel || process.env.VIVY_SUNO_MODEL || 'V5_5', 'V5_5', 40);
  const payload = {
    model: useVerifiedVivyVoice && !/^V5(?:_5)?$/i.test(requestedModel) ? 'V5_5' : requestedModel,
    customMode: true,
    instrumental: input.instrumental === true || input.forceInstrumental === true || useExternalVoiceMix,
    title,
    style,
    prompt: buildVivySunoLyrics({ ...input, songTitle: input.songTitle || input.title || title }),
    negativeTags,
    callBackUrl: buildSunoCallbackUrl(req),
  };
  if (useVerifiedVivyVoice) {
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
      title: cleanOneLine(value.title || value.name, 'Chanson Vivy', 120),
      url: audioUrl,
      audioUrl,
      audio_url: audioUrl,
      content_type: 'audio/mpeg',
      imageUrl: cleanOneLine(value.imageUrl || value.image_url || value.sourceImageUrl, '', 1000),
      model: cleanOneLine(value.model || value.modelName, '', 80),
      generatedAt: new Date().toISOString(),
    });
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectSunoTracks(child, tracks);
  }
  return tracks;
}

function extractSunoMedia(payload = {}) {
  const tracks = collectSunoTracks(payload, []);
  return tracks[0] || null;
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
  const url = `/api/vivy/studio/assets/${encodeURIComponent(filename)}`;
  return {
    ok: true,
    kind: 'audio',
    provider: 'elevenlabs-music',
    mode: 'real_music_generation',
    title,
    filename,
    path: filePath,
    url,
    audio_url: url,
    audioUrl: url,
    content_type: 'audio/mpeg',
    containerRepaired: repair.ok === true,
    repair,
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
  const readyMedia = extractSunoMedia(payload);
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

async function getSunoMusicJob(taskId, input = {}, req = null) {
  const safeTaskId = sanitizeSunoTaskId(taskId);
  if (!safeTaskId) {
    const error = new Error('suno_task_missing');
    error.status = 400;
    throw error;
  }
  const cached = readCachedSunoCallback(safeTaskId);
  const cachedMedia = extractSunoMedia(cached?.payload || {});
  if (cachedMedia?.url) {
    const preparedMedia = await materializeVivySunoMedia(cachedMedia, { taskId: safeTaskId });
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status: findSunoStatus(cached?.payload || {}) || 'callback_ready',
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
  if (!response.ok) throw new Error(`suno_status_http_${response.status}`);
  const media = extractSunoMedia(payload);
  const status = findSunoStatus(payload) || 'processing';
  if (media?.url) {
    writeCachedSunoCallback(safeTaskId, payload);
    const preparedMedia = await materializeVivySunoMedia(media, { taskId: safeTaskId });
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status,
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

  const attempts = Math.max(1, Math.min(5, Number(options.attempts || process.env.VIVY_SUNO_AUDIO_FETCH_ATTEMPTS || 3) || 3));
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
  try {
    console.warn('[Vivy Studio] Suno MP3 local materialization failed, keeping provider URL:', cleanOneLine(lastError?.message || lastError, 'unknown', 240));
  } catch (_) {}
  return media;
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

function createVivyStudioRouter({ verifyJWT } = {}) {
  const router = express.Router();
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
      if (extension !== '.wav' && extension !== '.mp3' && extension !== '.mp4') {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(extension === '.mp4' ? 'video/mp4' : extension === '.mp3' ? 'audio/mpeg' : 'audio/wav');
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
          elevenlabs: isElevenLabsMusicConfigured(),
        },
        configured: isSunoMusicConfigured() || isElevenLabsMusicConfigured(),
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
      const session = sessions.find((entry) => entry.id === sessionId)
        || ensureVivySessionEntry(new Map(), {
          sessionId,
          conversationId: buildVivyConversationIdForSession(sessionId),
          name: sessionId === 'default' ? 'Session principale' : `Session ${sessionId}`,
        });
      res.json({ ok: true, session });
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

  router.get('/jobs/:taskId', requireAuth, async (req, res) => {
    try {
      if (!canUseServerSuno(req) && !getRequestSessionSunoApiKey({}, req)) {
        return res.status(403).json({
          ok: false,
          error: 'vivy_music_admin_only',
          message: 'Génération musicale réservée aux comptes Famille/Premium/Fondateur, sauf clé Suno personnelle de session.',
        });
      }
      res.json(await getSunoMusicJob(req.params.taskId, {}, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_music_job_failed',
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
      const payload = buildVivyStudioProduction({
        ...input,
        language: resolveVivyResponseLanguage(input, req),
        shareToken: undefined,
        sessionSunoApiKey: undefined,
        sunoApiKey: undefined,
        personalSunoApiKey: undefined,
      });
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
      res.status(500).json({
        ok: false,
        error: 'vivy_studio_failed',
        message: error?.message || String(error),
      });
    }
  });

  router.post('/chat', requireAuth, express.json({ limit: '512kb' }), async (req, res) => {
    try {
      res.json(await buildVivyAiChat({
        ...(req.body || {}),
        shareToken: undefined,
      }, req));
    } catch (error) {
      res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_chat_failed',
        message: error?.message || String(error),
      });
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
  buildVivyMultiVoiceAssemblyArgs,
  buildVivyPreviewMixArgs,
  buildVivyMp3RepairArgs,
  repairVivyMp3File,
  materializeVivyPreviewInstrumentalPath,
  materializeVivySunoMedia,
  buildVivyMusicPrompt,
  buildVivyChat,
  buildVivyAiChat,
  buildVivyConversationIdForSession,
  listVivyChatSessionsForUser,
  normalizeVivyChatHistory,
  getVivyOpenAIConfig,
  buildVivyMemoryContext,
  buildVivySystemPrompt,
  buildVivyDirectSongReply,
  buildVivyPublicLyrics,
  buildVivySunoPayload,
  getVivySunoRuntimeStatus,
  buildVivyWebSearchQuery,
  postProcessVivyAssistantText,
  sanitizeVivyPublicText,
  isDirectSongwritingRequest,
  shouldVivyAutoWebSearch,
  looksLikeWeakSongwritingReply,
  isVivyMcpNeo4jQuestion,
  isVivyToolCapabilityQuestion,
  getSunoMusicJob,
  buildEmergencyMediaForProduction,
};
