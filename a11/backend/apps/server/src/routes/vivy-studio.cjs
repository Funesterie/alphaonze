'use strict';

const express = require('express');

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

function buildRouting() {
  return [
    'Vivy: je porte la voix, les paroles, la composition et l intention audio.',
    'A11: je demande a A11 les images, la video, le montage et les assets.',
    'Kaen44: je passe par Kaen44 pour l interface client, le suivi et le partage avec les personnes qui bossent dessus.',
  ];
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

function buildVivyStudioProduction(input) {
  const mode = parseMode(input.mode);
  const production =
    mode === 'voice'
      ? buildVoiceProduction(input)
      : mode === 'share'
        ? buildShareProduction(input)
        : buildSongProduction(input);

  const routing = buildRouting();
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
    tokenStored: false,
  };
}

function createVivyStudioRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'vivy-studio',
      modes: Array.from(MODES),
      tokenStored: false,
      writesByDefault: false,
    });
  });

  router.post('/produce', express.json({ limit: '96kb' }), (req, res) => {
    try {
      const input = req.body || {};
      const payload = buildVivyStudioProduction({
        ...input,
        shareToken: undefined,
      });
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'vivy_studio_failed',
        message: error?.message || String(error),
      });
    }
  });

  return router;
}

module.exports = {
  createVivyStudioRouter,
  buildVivyStudioProduction,
};
