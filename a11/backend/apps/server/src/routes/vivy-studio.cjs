'use strict';

const express = require('express');
const crypto = require('node:crypto');
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

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

const MODES = new Set(['voice', 'song', 'share']);

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

  const conversationId = cleanOneLine(input.conversationId, '', 120);
  if (conversationId) return `vivy-public:${hashShort(conversationId)}`;

  const token = extractRequestAuthToken(req);
  if (token) return `vivy-token:${hashShort(token)}`;

  const requestHint = [
    req?.ip,
    req?.socket?.remoteAddress,
    req?.headers?.['user-agent'],
  ].join('|');
  return `vivy-session:${hashShort(requestHint || 'anonymous')}`;
}

function normalizeVivyFileAttachment(file) {
  if (!file || typeof file !== 'object') return null;
  const filename = cleanOneLine(file.filename || file.name || file.originalName, '', 180);
  if (!filename) return null;

  const contentType = cleanOneLine(file.contentType || file.type, 'application/octet-stream', 120);
  const size = Number(file.sizeBytes ?? file.size ?? 0);
  return {
    id: cleanOneLine(file.id || file.storageKey || filename, filename, 180),
    filename,
    contentType,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : 0,
    url: cleanOneLine(file.url || file.downloadUrl, '', 800),
    description: cleanText(file.description || file.summary, 900),
    textPreview: cleanText(file.textPreview || file.preview || file.excerpt, 1800),
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
      file.textPreview ? `extrait:\n${file.textPreview}` : '',
    ].filter(Boolean);
    return details.join('\n');
  }).join('\n\n');
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
  const modeLabel = mode === 'voice' ? 'voix' : mode === 'share' ? 'scène/publication' : 'chanson/idée';
  return [
    'Tu es Vivy, une IA musicale et créative de Funesterie.',
    "Tu n'es pas une boîte à ordres : tu dialogues, tu comprends l'intention, tu aides à faire évoluer les idées et tu les ranges en mémoire sémantique privée.",
    `Mode courant: ${modeLabel}.`,
    buildLanguageInstruction(language),
    "Quand une idée arrive, reformule ce que tu as compris, propose une direction exploitable et ajoute une petite suite concrète.",
    "Si l'utilisateur veut changer ta voix, demande un court fichier audio de référence et rappelle qu'il reste privé pour son compte.",
    'Si des fichiers sont joints, intègre-les comme contexte, cite leur nom seulement si utile, et demande le contenu manquant si tu ne peux pas le lire.',
    'Ne révèle jamais de secret, token, chemin privé sensible ou configuration interne.',
  ].join('\n');
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
  const intent = mode === 'voice' ? 'audio' : mode === 'share' ? 'share' : 'song';
  return buildRoutingLines(intent, { withAudio: true });
}

function buildVoiceProduction(input) {
  const tool = cleanOneLine(input.voiceTool, 'A11 Voice + Voicemod', 80);
  const instruction = cleanText(input.voiceInstruction, 900);
  const referenceName = cleanOneLine(input.voiceFileName || input.voiceReferenceName, '', 160);

  const steps = [
    referenceName
      ? `Référence audio reçue: ${referenceName}. La garder privée et l'utiliser comme repère de timbre.`
      : 'Ajouter une référence audio avant calibration fine.',
    `Chaîne cible: ${tool}.`,
    instruction
      ? `Direction: ${instruction}`
      : 'Définir proximité micro, énergie, diction, souffle, saturation et limites de transformation.',
    'Phrase test: "Je garde la lumière dans ma voix, même quand la nuit devient scène."',
    'Vérifier trois passes: voix parlée claire, voix chantée courte, voix chuchotée contrôlée.',
  ];

  return {
    title: 'Calibration voix Vivy',
    summary: 'Profil vocal et chaîne de calibration prêts pour module voix.',
    brief: [
      'VIVY_VOICE_CALIBRATION',
      `Outil: ${tool}`,
      `Référence: ${referenceName || 'à fournir'}`,
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
      { id: 'upload_reference', label: 'Envoyer référence à A11', target: '/api/tts/references', ready: Boolean(referenceName) },
      { id: 'tts_test', label: 'Générer phrase test', target: '/api/tts/piper', ready: true },
      { id: 'voice_convert', label: 'Convertir vers référence', target: '/api/voice/convert', ready: Boolean(referenceName) },
    ],
  };
}

function buildSongProduction(input) {
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

  const titleSeed = hasMaterial
    ? material.split(/\n|[.!?]/).find(Boolean) || material
    : mood;
  const title = cleanOneLine(titleSeed, 'Echoes of Vivy', 46)
    .replace(/^["'“”]+|["'“”]+$/g, '');

  const chorus = hasMaterial
    ? material.split(/\n+/).slice(0, 4).join(' / ')
    : 'Donne-moi un thème, quelques paroles ou une intention pour produire une chanson complète.';

  const briefLines = [
    'VIVY_SONG_PRODUCTION',
    `Source: ${source}`,
    `Direction sonore: ${mood}`,
    `Titre de travail: ${title}`,
    '',
    'Structure proposée:',
    lineList([
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
      'Voix guide TTS ou référence chantée',
      'Image/miniature par A11',
      'Clip court si scène-partage est active',
    ]),
  ];

  return {
    title: `Chanson Vivy - ${title}`,
    summary: hasMaterial
      ? 'Pack composition prêt: structure, direction, refrain guide et assets.'
      : 'Pack incomplet: ajoute thème, texte ou paroles pour générer une chanson utile.',
    brief: briefLines.join('\n'),
    actions: [
      { id: 'lyrics_refine', label: 'Finaliser paroles', target: '/api/chat', ready: hasMaterial },
      { id: 'voice_guide', label: 'Créer voix guide', target: '/api/tts/piper', ready: hasMaterial },
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
  if (/\b(voix|voice|chanter|chant|timbre|micro|rvc|voicemod|parle|speech)\b/i.test(normalized)) {
    return 'voice';
  }
  if (/\b(publie|publier|youtube|clip|short|scene|partage|upload|description|tags|miniature)\b/i.test(normalized)) {
    return 'share';
  }
  return 'song';
}

function summarizeChatMessage(message = '') {
  const cleaned = cleanText(message, 360);
  if (!cleaned) return 'on part sur une intention musicale à préciser.';
  return cleaned.replace(/\s+/g, ' ');
}

function buildVivyChat(input) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, 1800);
  const mode = MODES.has(String(input.mode || '').trim()) ? parseMode(input.mode) : inferVivyChatMode(message);
  const files = normalizeVivyFiles(input);
  const language = detectVivyInputLanguage({ ...input, files });
  const history = Array.isArray(input.history)
    ? input.history
      .slice(-6)
      .map((entry) => `${cleanOneLine(entry?.role, 'user', 24)}: ${cleanText(entry?.content, 260)}`)
      .filter(Boolean)
    : [];

  const production = buildVivyStudioProduction({
    ...input,
    mode,
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
  const assistant = [
    `Je te suis. Je garde cette idée dans le fil Vivy et je pars sur ${modeLabel}.`,
    `Ce que je comprends: ${summarizeChatMessage(message)}`,
    fileLine,
    production.summary,
    readyActions.length ? `Je peux déjà préparer: ${readyActions.join(', ')}.` : 'Je peux clarifier le thème et préparer une première direction.',
    mode === 'voice'
      ? 'Envoie-moi une intention de timbre, une phrase test ou une référence vocale, et je te fais une calibration propre.'
      : mode === 'share'
        ? 'Donne-moi le canal, le format et la contrainte de publication, et je prépare le plan de scène.'
        : 'Donne-moi un thème, une phrase ou une ambiance, et je transforme ça en chanson exploitable.',
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
    aiMode: 'fallback',
    language,
    files,
  };
}

async function buildVivyAiChat(input, req) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, 2600);
  const mode = MODES.has(String(input.mode || '').trim()) ? parseMode(input.mode) : inferVivyChatMode(message);
  const files = normalizeVivyFiles(input);
  const language = detectVivyInputLanguage({ ...input, files });
  const fallback = buildVivyChat({ ...input, files, mode });
  const userId = resolveVivyMemoryUser(req, input);
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

    const messages = [
      { role: 'system', content: buildVivySystemPrompt(mode, language) },
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
    const assistant = cleanText(completion?.choices?.[0]?.message?.content, 3200);
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

async function buildEmergencyMediaForProduction(mode, input, req) {
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

function createVivyStudioRouter({ verifyJWT } = {}) {
  const router = express.Router();
  const optionalAuth = (req, res, next) => {
    if (typeof verifyJWT !== 'function' || !extractRequestAuthToken(req)) return next();
    return verifyJWT(req, res, next);
  };

  router.get('/assets/:filename', async (req, res) => {
    try {
      const filePath = getEmergencyMediaAssetPath(req.params.filename);
      if (!filePath) {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      const extension = path.extname(filePath).toLowerCase();
      if (extension !== '.wav' && extension !== '.mp4') {
        return res.status(404).json({ ok: false, error: 'asset_not_found' });
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(extension === '.mp4' ? 'video/mp4' : 'audio/wav');
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
        audio: true,
        video: true,
      },
    });
  });

  router.post('/produce', express.json({ limit: '96kb' }), async (req, res) => {
    try {
      const input = req.body || {};
      const payload = buildVivyStudioProduction({
        ...input,
        shareToken: undefined,
      });
      const media = await buildEmergencyMediaForProduction(payload.mode, input, req);
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
        payload.summary = `${payload.summary} Média de secours prêt.`;
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

  router.post('/chat', optionalAuth, express.json({ limit: '512kb' }), async (req, res) => {
    try {
      res.json(await buildVivyAiChat({
        ...(req.body || {}),
        shareToken: undefined,
      }, req));
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_chat_failed',
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
};
