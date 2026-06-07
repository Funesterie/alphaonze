'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
} = require('../../lib/episodic-memory.cjs');
const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  detectTextLanguage,
  buildLanguageInstruction,
} = require('../../lib/language-text.cjs');
const {
  buildVivySongcraftSystemPrompt,
  buildVivySongProductionBrief,
  buildVivyStructuredLyrics,
  buildVivySongArtistCast,
  inferTitle,
  stripSongCommand,
  looksLikeCompleteLyrics,
} = require('../music/vivy-songcraft.cjs');
const {
  postProcessA11AssistantResponse,
} = require('../chat/response-draft-rewriter.cjs');
const {
  autoDescribeImage,
} = require('../image/image-auto-describe.cjs');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

const MODES = new Set(['voice', 'song', 'share']);
const CHAT_MODES = new Set(['chat', 'voice', 'song', 'share']);

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
  if (rawMode) return parseVivyChatMode(rawMode);
  return inferVivyChatMode(message);
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
  return Boolean(getElevenLabsMusicApiKey());
}

function isSunoMusicConfigured() {
  if (envFlag('VIVY_SUNO_DISABLED') || envFlag('SUNO_DISABLED')) return false;
  return Boolean(getSunoApiKey());
}

function getConfiguredMusicProviders() {
  const preferred = cleanOneLine(process.env.VIVY_MUSIC_PROVIDER || process.env.VIVY_MUSIC_PROVIDERS, '', 160)
    .toLowerCase()
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const order = preferred.length ? preferred : ['suno', 'elevenlabs'];
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

function getVivyOpenAIConfig() {
  const baseURL = process.env.VIVY_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const normalizedBaseUrl = String(baseURL || '');
  const apiKey = /groq/i.test(normalizedBaseUrl)
    ? (process.env.VIVY_GROQ_API_KEY || process.env.GROQ_API_KEY || process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
    : (/openrouter\.ai/i.test(normalizedBaseUrl)
      ? (process.env.VIVY_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY)
      : (process.env.VIVY_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.A11_OPENAI_API_KEY));
  const model = cleanOneLine(
    process.env.VIVY_CHAT_MODEL || process.env.A11_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    'gpt-4o-mini',
    80
  );

  return { baseURL, apiKey: String(apiKey || '').trim(), model };
}

function createVivyOpenAIClient() {
  if (!OpenAI) return null;
  const config = getVivyOpenAIConfig();
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

function cleanVivyImageObservation(value = '') {
  return cleanText(value, 900)
    .replace(/^vision avanc[ée]e indisponible;\s*/i, 'Vision avancée indisponible; ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function describeVivyImageFile(file = {}, req) {
  const filename = cleanOneLine(file.filename, 'image', 180);
  const known = cleanText([
    file.visualDescription,
    file.description && !/^fichier joint\b/i.test(file.description) ? file.description : '',
    file.textPreview ? `Texte/OCR visible: ${file.textPreview}` : '',
  ].filter(Boolean).join(' '), 1200);

  if (file.url) {
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
      if (description && vision?.skipped !== true) {
        return {
          filename,
          reliable: vision?.visualReliable !== false && vision?.fallback !== true,
          observation: description,
          provider: cleanOneLine(vision?.provider, '', 80),
        };
      }
    } catch (_) {
      // Vision is best-effort; fallback to uploaded metadata below.
    }
  }

  const metadata = describeVivyImageMetadata(file);
  const fallback = known || (metadata
    ? `Je peux confirmer que le fichier est bien une image (${metadata}), mais je n'ai pas encore de description visuelle fiable de son contenu.`
    : "Je vois bien la pièce jointe image, mais elle n'a pas encore été analysée visuellement.");
  return {
    filename,
    reliable: Boolean(known),
    observation: fallback,
    provider: known ? 'uploaded-context' : 'metadata-only',
  };
}

async function buildVivyImageAttachmentReply(input = {}, req) {
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
  return cleanText(lines.join('\n'), 2400);
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

function shouldVivyAutoWebSearch(message = '', mode = 'chat') {
  const normalized = foldTextForLookup(message);
  if (!normalized) return false;
  if (mode === 'song' && isDirectSongwritingRequest(message) && !/\b(actualite|actualites|recent|recente|dernier|derniere|latest|source|sources|web|internet|site|url|github|npm|docker)\b/.test(normalized)) {
    return false;
  }
  if (looksLikeVivyExternalLookupTarget(message)) return true;

  const explicitWebLookup = /\b(cherche|chercher|recherche|trouve|trouver|verifie|verifier|consulte|regarde)\b.{0,90}\b(web|internet|google|en ligne|source|sources|site|site officiel|documentation|docs|github|npm|docker|docker hub|actualite|actualites)\b/.test(normalized)
    || /\b(web|internet|google|source officielle|sources officielles|site officiel|documentation officielle|docs officielles|github|docker hub|npm)\b/.test(normalized);
  const freshnessLookup = /\b(aujourd hui|maintenant|en ce moment|actuel|actuelle|actuels|actuelles|dernier|derniere|dernieres|latest|recent|recente|recents|recentes|nouveau|nouvelle|news|actualite|actualites|prix|tarif|version|release|mise a jour|changelog|status|statut|ci|workflow)\b/.test(normalized);
  return explicitWebLookup || freshnessLookup;
}

function buildVivyWebSearchQuery(message = '', files = []) {
  const fileHint = files.length
    ? ` ${files.map((file) => file.filename).filter(Boolean).slice(0, 3).join(' ')}`
    : '';
  return cleanOneLine(`${message}${fileHint}`, 'Funesterie Vivy', 260)
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
  const query = buildVivyWebSearchQuery(input.message || input.prompt || input.text || '', files);
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

function buildVivyMemoryContext(userId) {
  const result = getEpisodes(userId, { limit: 8, days: 45 });
  if (!result?.ok || !Array.isArray(result.episodes) || !result.episodes.length) return '';
  return result.episodes
    .filter((episode) => String(episode?.type || '').startsWith('vivy_'))
    .slice(-6)
    .map((episode) => `- ${cleanText(episode.content, 420)}`)
    .filter(Boolean)
    .join('\n');
}

function rememberVivyEpisode(userId, type, content, metadata = {}) {
  try {
    const result = addEpisode(userId, type, cleanText(content, 1800), {
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

function buildVivySystemPrompt(mode, language = 'fr') {
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
    "Réponds librement à l'intention: pas de réponse toute faite, pas de canevas forcé, pas de refrain automatique si la discussion demande juste de réfléchir.",
    "Quand une idée arrive, tu peux reformuler, proposer une direction ou poser une vraie question, selon ce qui aide le plus.",
    "Adresse-toi à Jeffrey/Djeff en tutoyant. N'utilise pas un vouvoiement générique de service client.",
    "Quand des images ou photos sont jointes et que Jeffrey demande ce que tu vois, réponds sur les pièces jointes: utilise la vision/contexte disponible, ne continue pas une chanson et ne dis pas que tu es seulement un modèle de langage.",
    "Quand une demande dépend d'informations externes, récentes, d'un site, d'une version, d'un prix, d'une source ou d'une documentation, déclenche/assume la recherche web disponible avant de répondre au lieu de deviner.",
    "Quand des fichiers joints sont importants pour comprendre la demande, analyse d'abord le contexte lisible ou visuel disponible, puis réponds; n'attends pas une formule exacte de l'utilisateur.",
    "Si l'utilisateur veut changer ta voix, demande un court fichier audio autorisé/licencié/consenti et rappelle qu'il reste privé pour son compte.",
    'Si des fichiers sont joints, intègre-les comme contexte, cite leur nom seulement si utile, et demande le contenu manquant si tu ne peux pas le lire.',
    buildVivySongcraftSystemPrompt(mode),
    'Ne révèle jamais de secret, token, chemin privé sensible ou configuration interne.',
  ].filter(Boolean).join('\n');
}

function normalizeVivyChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-10)
    .map((entry) => {
      const role = String(entry?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
      const content = cleanText(entry?.content, 900);
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
  const hasPrivateReference = Boolean(referenceName || referenceId);
  const wantsDuo = /\bduo\b|djeff.*vivy|vivy.*djeff/.test(folded);
  const wantsK44 = /\bk44\b|\bkaen44\b|\bkaen\b/.test(folded);
  const wantsA11 = /\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded);
  const wantsDjeff = wantsDuo || /\bdjeff\b|\brap\b|\bfraiyeur\b|\bmoto\b|\bmoteur\b|\bpignon\b|\bcouronne\b|\bchaine\b|\bradiateur\b/.test(folded);
  const wantsSing = /\bchant\b|\bsing\b|\bvocal\b/.test(folded);

  if (wantsDuo) {
    return {
      id: 'duo-djeff-vivy',
      tool: requestedTool || 'Duo Djeff + Vivy',
      label: 'Duo Djeff + Vivy',
      summaryLabel: 'duo Djeff rap + Vivy',
      ttsPersona: 'a11',
      vocalMode: 'adaptive',
      lead: 'Djeff rappe les couplets avec grain A11/Djeff; Vivy porte les refrains et réponses mélodiques.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff/A11 officielle locale + Vivy officielle',
      defaultReferenceStep: 'Base Djeff/A11 officielle locale pour les couplets, Vivy officielle pour les refrains; référence privée optionnelle pour affiner le grain Djeff.',
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

  if (wantsK44) {
    return {
      id: 'k44-official',
      tool: requestedTool || 'Voix K44 officielle',
      label: 'Voix K44 officielle',
      summaryLabel: 'voix K44 officielle',
      ttsPersona: 'kaen44',
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
      tool: requestedTool || 'Voix Djeff rap',
      label: 'Voix Djeff rap',
      summaryLabel: 'voix Djeff rap',
      ttsPersona: 'a11',
      vocalMode: 'adaptive',
      lead: 'Djeff prend les couplets rap avec base A11/Djeff officielle ou référence privée.',
      referenceLabel: hasPrivateReference
        ? (referenceName || 'référence privée Djeff active')
        : 'Djeff/A11 officielle locale',
      defaultReferenceStep: 'Voix Djeff/A11 officielle locale active; référence privée courte possible pour un grain rap plus proche.',
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
  const instruction = cleanText(input.voiceInstruction, 900);
  const referenceName = cleanOneLine(input.voiceFileName || input.voiceReferenceName, '', 160);
  const referenceId = cleanOneLine(input.voiceReferenceId || input.voiceRefId || input.referenceId, '', 160);
  const hasPrivateReference = Boolean(referenceName || referenceId);
  const profile = getVivyStudioVoiceProfile(input);

  const steps = [
    hasPrivateReference
      ? `Référence privée active: ${referenceName || 'référence stockée'}. La garder privée et l'utiliser comme repère de timbre.`
      : profile.defaultReferenceStep,
    `Méthode cible: ${tool}.`,
    `Distribution: ${profile.lead}`,
    instruction
      ? `Direction: ${instruction}`
      : 'Définir proximité micro, énergie, diction, souffle, saturation et limites de transformation.',
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
  };
}

function buildSongProduction(input) {
  const voiceProfile = getVivyStudioVoiceProfile(input);
  const artistCast = buildVivySongArtistCast(input);
  const source = cleanOneLine(input.songSource || input.source, 'Thème', 80);
  const mood = cleanOneLine(input.songMood || input.mood || input.style, 'Electro pop sombre cinématographique', 160);
  const material = compactUniqueLines([
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
  ], 2400);
  const hasMaterial = Boolean(material);
  const songcraft = buildVivySongProductionBrief({
    ...input,
    songText: material || input.songText,
    songTitle: input.songTitle || input.title,
  });

  const titleSeed = hasMaterial
    ? songcraft.title || material.split(/\n|[.!?]/).find(Boolean) || material
    : mood;
  const title = cleanOneLine(titleSeed, 'Echoes of Vivy', 46)
    .replace(/^["'“”]+|["'“”]+$/g, '');

  const chorus = hasMaterial
    ? songcraft.lyrics.split(/\n+/).filter((line) => !/^\[/.test(line)).slice(0, 4).join(' / ')
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
  };
}

function buildShareProduction(input) {
  const target = cleanOneLine(input.shareTarget, 'YouTube', 80);
  const url = cleanOneLine(input.shareUrl, '', 500);
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
  const cleaned = cleanText(message, 360);
  if (!cleaned) return 'on part sur une intention musicale à préciser.';
  return cleaned.replace(/\s+/g, ' ');
}

function isDirectSongwritingRequest(message = '') {
  const normalized = foldTextForLookup(message);
  return /\b(fais|fait|ecris|ecrit|compose|genere|genere|cree|crée)\b.{0,80}\b(chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(transforme|structure|arrange|mets|met)\b.{0,100}\b(chanson|musique|son|paroles|lyrics|refrain|couplet)\b/.test(normalized)
    || /\b(chanson|paroles|lyrics)\b.{0,80}\b(structure|refrain|couplet|rime|rimes)\b/.test(normalized)
    || /\b(vivy_intent|instruction)\b.{0,180}\b(chanson|paroles|refrain|couplet|composition)\b/.test(normalized);
}

function looksLikeWeakSongwritingReply(text = '') {
  const content = cleanText(text, 3200);
  if (!content) return true;
  const normalized = foldTextForLookup(content);
  const sectionCount = (content.match(/\[(intro|verse|couplet|pre-chorus|pre-refrain|pré-refrain|chorus|refrain|bridge|pont|outro)\]/ig) || []).length;
  const asksInsteadOfWriting = /(quel est le message|quel est le ton|quels sont les elements|qu en dis tu|n hesite pas|je vais essayer|je comprends mieux|poser quelques questions)/.test(normalized);
  const serviceWrapper = /(je vais continuer|j espere que cela correspond|feedbacks?|modifications si necessaire|vous attendiez|vous avez deja commence)/.test(normalized);
  const genericRapFiller = /(maitres? de la vitesse|rois? de la route|reines? de la nuit|maitres? du son|je suis vivant|je suis en vie|je suis libre|monde de vitesse et de liberte)/.test(normalized);
  const metaInsteadOfLyrics = /(intention\s*:|paroles\s*:|voici une proposition)/.test(normalized)
    && sectionCount < 4
    && content.split(/\n+/).filter((line) => line.trim()).length < 12;
  const brokenRhymeExercise = /(je suis en trousse|avec une rescousse|je trousse|liberte libre|detstresse)/.test(normalized);
  return asksInsteadOfWriting || serviceWrapper || genericRapFiller || metaInsteadOfLyrics || brokenRhymeExercise;
}

function buildVivyDirectSongReply(input = {}) {
  const historyText = getVivyUserHistoryText(input.history);
  const material = compactUniqueLines([
    historyText,
    input.message,
    input.prompt,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
  ], 2600);
  const voiceProfile = getVivyStudioVoiceProfile({ ...input, songText: material || input.songText || input.message });
  const songcraft = buildVivySongProductionBrief({
    ...input,
    songText: material || input.songText || input.message,
    rhymeScheme: input.rhymeScheme || 'Fins de lignes rimées par paires, images mécaniques et sémantiques, refrain stable et chantable.',
  });
  const lyrics = cleanText(songcraft.lyrics.replace(/^\[Title:\s*[^\]]+\]\s*/i, '').trim(), 2600);
  const intention = voiceProfile.id === 'duo-djeff-vivy'
    ? 'duo rap Djeff + Vivy, mécanique moto concrète, couplets techniques et refrain chantable.'
    : voiceProfile.id === 'djeff-rap'
      ? 'voix Djeff rap, mécanique précise, débit serré et refrain prêt à répondre avec Vivy.'
      : 'ouverture du skill tree, fuite hypervitesse et retour sémantique à la réalité.';
  return cleanText([
    `**Titre :** ${songcraft.title}`,
    `**Intention :** ${intention}`,
    '',
    lyrics,
    '',
    `**Rimes / débit :** ${songcraft.rhymeScheme}`,
  ].join('\n'), 3200);
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
    .slice(-6)
    .map((entry) => cleanText(entry?.content, 420))
    .filter(Boolean)
    .join('\n');
}

function getVivyUserHistoryText(history = []) {
  if (!Array.isArray(history)) return '';
  return history
    .slice(-8)
    .filter((entry) => String(entry?.role || '').toLowerCase() !== 'assistant')
    .map((entry) => cleanText(entry?.content, 420))
    .filter(Boolean)
    .join('\n');
}

function isVivyMcpNeo4jQuestion(input = {}, message = '') {
  const current = normalizeVivyCapabilityText(message);
  const recent = normalizeVivyCapabilityText(getVivyHistoryText(input.history));
  if (!current) return false;

  const mentionsMcp = /\bmcp\b|model context protocol/.test(current);
  const mentionsNeo4j = /\bneo4j\b|\bcypher\b|\bgraphe\b|\bgraph\b|\bmemoire\b|\bmemory\b/.test(current);
  const recentMentionsNeo4j = /\bneo4j\b|\bcypher\b|\bgraphe\b|\bgraph\b|\bmemoire\b|\bmemory\b/.test(recent);
  if (!mentionsMcp && !mentionsNeo4j) return false;

  if (/^avec\s+le\s+mcp\b/.test(current) && recentMentionsNeo4j) return true;
  return /(acces|access|connect|branche|relie|utilise|utiliser|outil|tools?|peux|peut|sais|apprend|apprendre|comment|requete|query|chercher|lire|consulter|\?)/.test(current);
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
      'Kaen44: reformulation claire et suivi de brief si besoin.',
    ],
    tokenStored: false,
    writesByDefault: false,
    aiMode: 'deterministic_mcp',
    language,
    files: [],
  };
}

function buildVivyChat(input) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, 1800);
  const mode = resolveVivyChatMode(input, message);
  const files = normalizeVivyFiles(input);
  const language = detectVivyInputLanguage({ ...input, files });
  const history = Array.isArray(input.history)
    ? input.history
      .slice(-6)
      .map((entry) => `${cleanOneLine(entry?.role, 'user', 24)}: ${cleanText(entry?.content, 260)}`)
      .filter(Boolean)
    : [];

  if (mode === 'chat') {
    const fileLine = files.length
      ? `J'ai aussi noté ${files.length} fichier${files.length > 1 ? 's' : ''}: ${files.map((file) => file.filename).join(', ')}.`
      : '';
    const assistant = [
      'Je te suis.',
      `Ce que je comprends: ${summarizeChatMessage(message)}`,
      fileLine,
      "Je garde ça comme discussion et matière de travail, sans le transformer automatiquement en chanson.",
      'Si tu veux une version structurée, clique sur Chanson ou demande clairement des paroles, un refrain ou une composition.',
    ].filter(Boolean).join('\n\n');
    return {
      ok: true,
      service: 'vivy-chat',
      mode,
      assistant,
      content: assistant,
      summary: 'Message rangé dans le fil Vivy sans structure chanson automatique.',
      actions: [],
      routing: buildRouting('song'),
      tokenStored: false,
      writesByDefault: false,
      aiMode: 'fallback_chat',
      language,
      files,
    };
  }

  const production = buildVivyStudioProduction({
    ...input,
    mode: MODES.has(mode) ? mode : 'song',
    songSource: input.songSource || 'Conversation',
    songText: mode === 'song' ? compactUniqueLines([history.join('\n'), message], 2200) : input.songText,
    voiceInstruction: mode === 'voice' ? compactUniqueLines([history.join('\n'), message], 1200) : input.voiceInstruction,
    shareInstruction: mode === 'share' ? compactUniqueLines([history.join('\n'), message], 1200) : input.shareInstruction,
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
  const assistant = mode === 'song'
    ? buildVivyDirectSongReply({ ...input, message, files, history })
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

  return {
    ok: true,
    service: 'vivy-chat',
    mode,
    assistant,
    content: assistant,
    summary: production.summary,
    actions: production.actions,
    routing: production.routing,
    tokenStored: false,
    writesByDefault: false,
    aiMode: mode === 'song' ? 'fallback_songcraft' : 'fallback',
    language,
    files,
  };
}

function postProcessVivyAssistantText({ text = '', userMessage = '', systemPrompt = '' } = {}) {
  const processed = postProcessA11AssistantResponse({
    text,
    userMessage,
    contextText: systemPrompt,
  });
  return {
    ...processed,
    content: cleanText(processed.content, 3200),
  };
}

async function buildVivyAiChat(input, req) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, 2600);
  const mode = resolveVivyChatMode(input, message);
  const files = normalizeVivyFiles(input);
  const language = detectVivyInputLanguage({ ...input, files });
  const fallback = buildVivyChat({ ...input, files, mode });
  const userId = resolveVivyMemoryUser(req, input);
  if (!userId) {
    const error = new Error('vivy_auth_required');
    error.code = 'vivy_auth_required';
    error.status = 401;
    throw error;
  }
  const fileContext = formatVivyFilesForPrompt(files);
  const memoryText = compactUniqueLines([
    message ? `Message: ${message}` : '',
    fileContext ? `Fichiers:\n${fileContext}` : '',
  ], 1800);
  const semanticMemory = memoryText
    ? rememberVivyEpisode(userId, 'vivy_idea', memoryText, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      fileCount: files.length,
    })
    : { stored: false };

  if (isVivyMcpNeo4jQuestion(input, message)) {
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
    const assistant = await buildVivyImageAttachmentReply({ ...input, message, files }, req);
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
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  if (shouldVivyAutoWebSearch(message, mode)) {
    const research = await buildVivyWebResearchReply({ ...input, message, files });
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

  if (isVivyFileInspectionRequest(message, files)) {
    const assistant = buildVivyFileAttachmentReply({ ...input, message, files });
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

  if (mode === 'song') {
    const history = normalizeVivyChatHistory(input.history);
    const assistant = buildVivyDirectSongReply({ ...input, message, files, history });
    rememberVivyEpisode(userId, 'vivy_reply', assistant, {
      mode,
      conversationId: cleanOneLine(input.conversationId, '', 120),
      deterministic: true,
    });
    return {
      ...fallback,
      assistant,
      content: assistant,
      aiMode: 'deterministic_songcraft',
      language,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  const llmBundle = createVivyOpenAIClient();
  if (!llmBundle || String(process.env.VIVY_CHAT_DISABLE_LLM || '').toLowerCase() === 'true') {
    return {
      ...fallback,
      language,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  }

  try {
    const memoryContext = buildVivyMemoryContext(userId);
    const history = normalizeVivyChatHistory(input.history);
    const userContent = compactUniqueLines([
      message,
      fileContext ? `Pièces jointes et contexte fichier:\n${fileContext}` : '',
    ], 4200) || 'Continue la conversation Vivy avec douceur et précision.';

    const systemPrompt = buildVivySystemPrompt(mode, language);
    const messages = [
      { role: 'system', content: systemPrompt },
      memoryContext ? { role: 'system', content: `Mémoire Vivy récente, privée pour cette session:\n${memoryContext}` } : null,
      ...history,
      { role: 'user', content: userContent },
    ].filter(Boolean);

    const completion = await llmBundle.client.chat.completions.create({
      model: llmBundle.model,
      messages,
      temperature: Number(process.env.VIVY_CHAT_TEMPERATURE || 0.74),
      max_tokens: Number(process.env.VIVY_CHAT_MAX_TOKENS || 900),
    });
    const rawAssistant = cleanText(completion?.choices?.[0]?.message?.content, 3200);
    const processed = postProcessVivyAssistantText({
      text: rawAssistant,
      userMessage: message,
      systemPrompt,
    });
    const assistant = mode === 'song'
      && looksLikeWeakSongwritingReply(processed.content)
        ? buildVivyDirectSongReply({ ...input, message, files, history })
        : processed.content;
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
      aiMode: 'llm',
      model: llmBundle.model,
      language,
      semanticMemory,
      memoryStored: semanticMemory.stored,
    };
  } catch (error) {
    return {
      ...fallback,
      language,
      semanticMemory,
      memoryStored: semanticMemory.stored,
      llmError: cleanOneLine(error?.message || error, 'vivy_llm_failed', 180),
    };
  }
}

function buildVivyStudioProduction(input) {
  const mode = parseMode(input.mode);
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

  return {
    ok: true,
    service: 'vivy-studio',
    mode,
    title: production.title,
    summary: production.summary,
    assistant: handoff,
    brief: handoff,
    actions: production.actions,
    routing,
    mediaAgentRoles,
    mediaPipeline,
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
    return createEmergencySongAsset(input, req);
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
  const mood = cleanOneLine(input.songMood || input.mood || input.style, 'electro pop dark cinematic', 180);
  const artistCast = buildVivySongArtistCast(input);
  const lyrics = buildVivyStructuredLyrics(input);
  return [
    artistCast.musicLead,
    `Source: ${source}.`,
    `Style and production: ${mood}.`,
    `Vocal cast: ${artistCast.countLabel}: ${artistCast.label}. ${artistCast.musicMood}`,
    'Lyrics must be sung, not spoken. Use the provided sections as real lyrics.',
    `Lyrics:\n${lyrics}`,
    'Arrangement: intro, verse, pre-chorus, memorable chorus, second verse, bridge, chorus, clean ending. Web-ready, no copyrighted melody.',
  ].join('\n');
}

function buildVivySunoLyrics(input = {}) {
  const material = compactUniqueLines([
    input.lyrics,
    input.songText,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
  ], 2200);
  if (looksLikeCompleteLyrics(material)) {
    return cleanText(material, 2200);
  }

  return buildVivyStructuredLyrics({ ...input, songText: stripSongCommand(material) || material });
}

function buildVivySunoPayload(input = {}, req = null) {
  const artistCast = buildVivySongArtistCast(input);
  const titleSeed = cleanOneLine(
    input.songTitle || input.title || inferTitle(input.songText || input.theme || input.prompt),
    'Vivy garde la lumière',
    72
  ).replace(/^["'“”]+|["'“”]+$/g, '');
  const title = cleanOneLine(titleSeed, 'Vivy garde la lumière', 80);
  const styleBase = cleanOneLine(
    input.songMood || input.mood || input.style,
    artistCast.sunoStyle,
    220
  );
  const castStyle = artistCast.ids.includes('djeff') && artistCast.ids.includes('vivy') && artistCast.count === 2
    ? 'alternating Djeff rap verses and Vivy melodic hook'
    : artistCast.count > 1
      ? `${artistCast.count} distinct vocalists: ${artistCast.label}; keep tagged sections separate`
      : `${artistCast.label} vocal lead`;
  const style = /structured rhymed lyrics|rimes|paroles structur/i.test(styleBase)
    ? cleanOneLine(castStyle && !new RegExp(castStyle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(styleBase)
      ? `${styleBase}, ${castStyle}`
      : styleBase, styleBase, 280)
    : cleanOneLine(
      `${styleBase}, structured rhymed lyrics, melodic chorus, sung vocals, no spoken narration${castStyle ? `, ${castStyle}` : ''}`,
      styleBase,
      280
    );
  const payload = {
    model: cleanOneLine(input.musicModel || process.env.VIVY_SUNO_MODEL || 'V4_5', 'V4_5', 40),
    customMode: true,
    instrumental: input.instrumental === true || input.forceInstrumental === true,
    title,
    style,
    prompt: buildVivySunoLyrics(input),
    negativeTags: cleanOneLine(
      input.negativeTags || process.env.VIVY_SUNO_NEGATIVE_TAGS,
      'spoken word, narration, reading prompt, robotic speech, muddy mix, out of tune vocals, copyrighted melody, celebrity voice imitation',
      260
    ),
    callBackUrl: buildSunoCallbackUrl(req),
  };
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
  const root = cleanOneLine(process.env.A11_RUNTIME_ROOT || process.env.RUNTIME_ROOT, '', 500)
    || path.join(process.cwd(), 'runtime');
  return path.join(root, 'vivy-suno-callbacks');
}

function sanitizeSunoTaskId(value = '') {
  return cleanOneLine(value, '', 120).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120);
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
  ];
  return sanitizeSunoTaskId(candidates.find(Boolean) || '');
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

function collectSunoTracks(value, tracks = []) {
  if (!value || typeof value !== 'object') return tracks;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSunoTracks(item, tracks));
    return tracks;
  }
  const audioUrl = cleanOneLine(
    value.audioUrl || value.audio_url || value.streamAudioUrl || value.stream_audio_url || value.sourceAudioUrl || value.source_audio_url,
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

function saveVivyMusicBuffer(buffer, input = {}, req = null) {
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
    await response.arrayBuffer().catch(() => null);
    throw new Error(`elevenlabs_music_http_${response.status}`);
  }
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('elevenlabs_music_empty_audio');
  const media = saveVivyMusicBuffer(audioBuffer, input, req);
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
  if (!response.ok || payload?.code === 401 || payload?.code === 403) {
    throw new Error(`suno_music_http_${response.status || payload?.code || 'error'}`);
  }

  const taskId = findSunoTaskId(payload);
  const readyMedia = extractSunoMedia(payload);
  if (readyMedia?.url) {
    return {
      ...readyMedia,
      title: readyMedia.title || body.title,
      taskId: taskId || undefined,
      jobId: taskId || undefined,
      prompt: body.prompt,
      style: body.style,
      model: body.model,
    };
  }
  if (!taskId) throw new Error('suno_music_task_missing');

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
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status: findSunoStatus(cached?.payload || {}) || 'callback_ready',
      media: { ...cachedMedia, taskId: safeTaskId, jobId: safeTaskId },
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
    return {
      ok: true,
      provider: 'suno',
      taskId: safeTaskId,
      state: 'done',
      status,
      media: { ...media, taskId: safeTaskId, jobId: safeTaskId },
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
    || envFlag('VIVY_ELEVENLABS_MUSIC_AUTO');
  if (!wantsMusic) return null;

  const errors = [];
  for (const provider of getConfiguredMusicProviders()) {
    try {
      if (provider === 'suno' && (isSunoMusicConfigured() || getRequestSessionSunoApiKey(input, req))) return await requestSunoMusic(input, req);
      if ((provider === 'elevenlabs' || provider === 'elevenlabs-music') && isElevenLabsMusicConfigured()) {
        return await requestElevenLabsMusic(input, req);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw errors[0];
  return null;
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
      },
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
      },
    });
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
          message: 'Vivy a lancé une vraie génération Suno. La chanson arrive en MP3 dès que le job est terminé.',
        };
        payload.musicJob = {
          provider: media.provider,
          taskId: media.taskId,
          jobId: media.jobId || media.taskId,
          state: 'processing',
          status: media.status || 'submitted',
        };
        payload.summary = `${payload.summary} Génération musicale Suno lancée.`;
        return res.json(payload);
      }
      if (!media?.url) {
        media = await buildEmergencyMediaForProduction(payload.mode, input, req);
      }
      if (media?.url) {
        payload.media = media;
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
      } else {
        payload.mediaStatus = {
          state: 'not_configured',
          reason: mediaError?.code || mediaError?.message || 'real_music_provider_not_connected',
          message: mediaError
            ? 'Brief prêt. La génération musicale réelle n’a pas abouti; aucun faux WAV ajouté automatiquement.'
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

  return router;
}

module.exports = {
  createVivyStudioRouter,
  buildVivyStudioProduction,
  buildVivyChat,
  buildVivyAiChat,
  buildVivySystemPrompt,
  buildVivyDirectSongReply,
  buildVivySunoPayload,
  postProcessVivyAssistantText,
  isDirectSongwritingRequest,
  looksLikeWeakSongwritingReply,
  isVivyMcpNeo4jQuestion,
  getSunoMusicJob,
};
