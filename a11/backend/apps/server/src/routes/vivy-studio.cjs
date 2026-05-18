'use strict';

const express = require('express');
const path = require('node:path');
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

const MODES = new Set(['voice', 'song', 'share']);

function cleanText(value, max = 2000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function cleanOneLine(value, fallback = '', max = 160) {
  return cleanText(value, max).replace(/\s+/g, ' ') || fallback;
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

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    lines.push(value);
  }

  return cleanText(lines.join('\n\n'), max);
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
      ? `Reference audio recue: ${referenceName}. La garder privee et l'utiliser comme repere de timbre.`
      : 'Ajouter une reference audio avant calibration fine.',
    `Chaine cible: ${tool}.`,
    instruction
      ? `Direction: ${instruction}`
      : 'Definir proximite micro, energie, diction, souffle, saturation et limites de transformation.',
    'Phrase test: "Je garde la lumiere dans ma voix, meme quand la nuit devient scene."',
    'Verifier trois passes: voix parlee claire, voix chantee courte, voix chuchotee controlee.',
  ];

  return {
    title: 'Calibration voix Vivy',
    summary: 'Profil vocal et chaine de calibration prets pour module voix.',
    brief: [
      'VIVY_VOICE_CALIBRATION',
      `Outil: ${tool}`,
      `Reference: ${referenceName || 'a fournir'}`,
      '',
      'Plan:',
      lineList(steps),
      '',
      'Limites:',
      lineList([
        'Ne pas publier la reference brute.',
        'Ne pas stocker de token ou cle dans le brief.',
        'Garder une sortie claire et reversible: original, voix generee, voix convertie.',
      ]),
    ].join('\n'),
    actions: [
      { id: 'upload_reference', label: 'Envoyer reference a A11', target: '/api/tts/references', ready: Boolean(referenceName) },
      { id: 'tts_test', label: 'Generer phrase test', target: '/api/tts/piper', ready: true },
      { id: 'voice_convert', label: 'Convertir vers reference', target: '/api/voice/convert', ready: Boolean(referenceName) },
    ],
  };
}

function buildSongProduction(input) {
  const source = cleanOneLine(input.songSource || input.source, 'Theme', 80);
  const mood = cleanOneLine(input.songMood || input.mood || input.style, 'Electro pop dark cinematographique', 160);
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
    : 'Donne-moi un theme, quelques paroles ou une intention pour produire une chanson complete.';

  const briefLines = [
    'VIVY_SONG_PRODUCTION',
    `Source: ${source}`,
    `Direction sonore: ${mood}`,
    `Titre de travail: ${title}`,
    '',
    'Structure proposee:',
    lineList([
      'Intro: texture sombre, respiration vocale courte, motif synth discret.',
      'Couplet 1: voix proche, diction nette, tension contenue.',
      'Pre-refrain: montee harmonique, percussion legere, ouverture stereo.',
      `Refrain guide: ${chorus}`,
      'Pont: silence, basse tenue, voix doublee en arriere-plan.',
      'Final: retour du motif, sortie courte pour clip ou short.',
    ]),
    '',
    'Assets a produire:',
    lineList([
      'Paroles finalisees',
      'Voix guide TTS ou reference chantee',
      'Image/miniature par A11',
      'Clip court si scene-partage est active',
    ]),
  ];

  return {
    title: `Chanson Vivy - ${title}`,
    summary: hasMaterial
      ? 'Pack composition pret: structure, direction, refrain guide et assets.'
      : 'Pack incomplet: ajoute theme, texte ou paroles pour generer une chanson utile.',
    brief: briefLines.join('\n'),
    actions: [
      { id: 'lyrics_refine', label: 'Finaliser paroles', target: '/api/chat', ready: hasMaterial },
      { id: 'voice_guide', label: 'Creer voix guide', target: '/api/tts/piper', ready: hasMaterial },
      { id: 'cover_image', label: 'Creer miniature A11', target: '/api/tools/generate_sd', ready: hasMaterial },
      { id: 'clip_video', label: 'Creer clip A11', target: '/api/video/generate', ready: hasMaterial },
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
    `Lien cible: ${url || 'a fournir'}`,
    `Token fourni dans UI: ${tokenPresent ? 'oui, non envoye au serveur' : 'non'}`,
    '',
    'Plan publication:',
    lineList([
      instruction || 'Preparer titre, description, tags, miniature et format clip.',
      'Creer une version courte verticale 20-40 secondes.',
      'Generer miniature A11 avec lisibilite mobile.',
      'Verifier droits audio et credits Funesterie.',
      'Utiliser OAuth ou coffre local pour publication, jamais un token colle en clair.',
    ]),
    '',
    'Sortie attendue:',
    lineList([
      'Titre public',
      'Description courte',
      'Tags',
      'Checklist OBS/upload',
      'Lien equipe partageable',
    ]),
  ].join('\n');

  return {
    title: `Scene Vivy - ${target}`,
    summary: 'Plan de clip et publication pret sans exposer de secret.',
    brief,
    actions: [
      { id: 'render_clip', label: 'Generer clip A11', target: '/api/video/generate', ready: Boolean(instruction || url) },
      { id: 'make_thumbnail', label: 'Generer miniature', target: '/api/tools/generate_sd', ready: true },
      { id: 'publish_oauth', label: 'Publier via OAuth', target: target.toLowerCase().includes('youtube') ? '/api/auth/youtube' : 'external-oauth', ready: false },
      { id: 'team_link', label: 'Partager a l equipe', target: 'system-share', ready: true },
    ],
  };
}

function inferVivyChatMode(message = '') {
  const normalized = String(message || '').toLowerCase();
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
  if (!cleaned) return 'on part sur une intention musicale a preciser.';
  return cleaned.replace(/\s+/g, ' ');
}

function buildVivyChat(input) {
  const message = cleanText(input.message || input.prompt || input.songText || input.text, 1800);
  const mode = MODES.has(String(input.mode || '').trim()) ? parseMode(input.mode) : inferVivyChatMode(message);
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
  const modeLabel = mode === 'voice' ? 'voix' : mode === 'share' ? 'scene / partage' : 'composition';
  const assistant = [
    'Je suis Vivy. Je pars de ton message.',
    `Lecture: ${summarizeChatMessage(message)}`,
    `Direction: ${modeLabel}. ${production.summary}`,
    readyActions.length ? `Actions pretes: ${readyActions.join(', ')}.` : 'Action prete: clarifier le theme et preparer le brief.',
    mode === 'voice'
      ? 'Envoie-moi une intention de timbre, une phrase test ou une reference vocale, et je te fais une calibration propre.'
      : mode === 'share'
        ? 'Donne-moi le canal, le format et la contrainte de publication, et je prepare le plan de scene.'
        : 'Donne-moi un theme, une phrase ou une ambiance, et je transforme ca en chanson exploitable.',
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
  };
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
    ? 'Clip video de secours'
    : 'Maquette audio Vivy';
  return [
    assistant,
    '',
    'Media pret:',
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
      prompt: input.shareInstruction || input.prompt || input.theme || input.songText || 'Vivy scene partage Funesterie',
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

function createVivyStudioRouter() {
  const router = express.Router();

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
        payload.summary = `${payload.summary} Media de secours pret.`;
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

  router.post('/chat', express.json({ limit: '96kb' }), async (req, res) => {
    try {
      res.json(buildVivyChat({
        ...(req.body || {}),
        shareToken: undefined,
      }));
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
};
