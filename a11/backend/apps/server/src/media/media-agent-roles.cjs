'use strict';

const DEFAULT_ROLE_MATRIX = Object.freeze({
  prompt: Object.freeze({
    stage: 'prompt',
    primary: 'kaen44',
    title: 'Prompt + intention',
    responsibility: 'clarifier le besoin, cadrer le brief, enrichir les contraintes et preparer le handoff',
    fallbacks: Object.freeze(['a11', 'codex', 'prompt-review']),
  }),
  image: Object.freeze({
    stage: 'image',
    primary: 'a11',
    title: 'Image + assets visuels',
    responsibility: 'generer les images, frames, miniatures, covers et assets visuels',
    fallbacks: Object.freeze(['stable-diffusion', 'huggingface', 'replicate', 'openai', 'pollinations', 'synthetic-frame']),
  }),
  audio: Object.freeze({
    stage: 'audio',
    primary: 'vivy',
    title: 'Son + voix + musique',
    responsibility: 'porter la voix, les paroles, la composition, la direction sonore et les references audio',
    fallbacks: Object.freeze(['a11-voice', 'tts-piper', 'sfx-engine', 'silent-track']),
  }),
  video: Object.freeze({
    stage: 'video',
    primary: 'a11',
    title: 'Video + assemblage',
    responsibility: 'assembler les frames, monter le rendu, exporter gif/mp4 et publier les assets',
    helpers: Object.freeze(['kaen44', 'vivy', 'pink-ward', 'ekko']),
    fallbacks: Object.freeze(['gif-frame-sequence', 'mp4-cpu-ffmpeg', 'static-cover']),
  }),
  vision_qa: Object.freeze({
    stage: 'vision_qa',
    primary: 'pink-ward',
    title: 'Controle reel image/video',
    responsibility: 'comparer ce qui est produit avec l intention et signaler les ecarts visuels',
    fallbacks: Object.freeze(['janus', 'a11-reality-check', 'manual-review']),
  }),
  audio_qa: Object.freeze({
    stage: 'audio_qa',
    primary: 'ekko',
    title: 'Controle audio',
    responsibility: 'ecouter le rendu, verifier le timing, detecter anomalies et coherence sonore',
    fallbacks: Object.freeze(['vivy-manual-check', 'metadata-only']),
  }),
  client_handoff: Object.freeze({
    stage: 'client_handoff',
    primary: 'kaen44',
    title: 'Interface + partage',
    responsibility: 'preparer la restitution utilisateur, les documents, le suivi et le partage propre',
    fallbacks: Object.freeze(['a11', 'static-brief']),
  }),
});

const PIPELINES = Object.freeze({
  image: Object.freeze(['prompt', 'image', 'vision_qa', 'client_handoff']),
  audio: Object.freeze(['prompt', 'audio', 'audio_qa', 'client_handoff']),
  voice: Object.freeze(['prompt', 'audio', 'audio_qa', 'client_handoff']),
  song: Object.freeze(['prompt', 'audio', 'image', 'audio_qa', 'vision_qa', 'client_handoff']),
  video: Object.freeze(['prompt', 'image', 'video', 'vision_qa', 'client_handoff']),
  clip: Object.freeze(['prompt', 'audio', 'image', 'video', 'audio_qa', 'vision_qa', 'client_handoff']),
  share: Object.freeze(['prompt', 'client_handoff', 'image', 'video', 'vision_qa']),
});

function cloneRole(role) {
  const next = {
    ...role,
    fallbacks: Array.isArray(role.fallbacks) ? role.fallbacks.slice() : [],
  };
  if (Array.isArray(role.helpers)) next.helpers = role.helpers.slice();
  return next;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envKeyForStage(stage, suffix) {
  return `A11_MEDIA_ROLE_${String(stage || '').toUpperCase()}_${suffix}`;
}

function applyEnvOverrides(role, env = process.env) {
  const stage = role.stage;
  const primary = String(env?.[envKeyForStage(stage, 'PRIMARY')] || '').trim();
  const fallbacks = splitList(env?.[envKeyForStage(stage, 'FALLBACKS')]);
  const helpers = splitList(env?.[envKeyForStage(stage, 'HELPERS')]);

  return {
    ...role,
    ...(primary ? { primary } : {}),
    ...(fallbacks.length ? { fallbacks } : {}),
    ...(helpers.length ? { helpers } : {}),
  };
}

function getMediaAgentRoleMatrix(env = process.env) {
  return Object.fromEntries(
    Object.entries(DEFAULT_ROLE_MATRIX).map(([stage, role]) => [
      stage,
      applyEnvOverrides(cloneRole(role), env),
    ])
  );
}

function normalizeIntent(intent = 'media') {
  const normalized = String(intent || '').trim().toLowerCase();
  if (normalized.includes('clip')) return 'clip';
  if (normalized.includes('song') || normalized.includes('music')) return 'song';
  if (normalized.includes('voice') || normalized.includes('audio')) return 'audio';
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('share')) return 'share';
  if (normalized.includes('image') || normalized.includes('cover') || normalized.includes('thumbnail')) return 'image';
  return 'video';
}

function buildMediaPipeline(intent = 'media', options = {}) {
  const matrix = getMediaAgentRoleMatrix(options.env || process.env);
  const normalizedIntent = normalizeIntent(intent);
  let stages = (PIPELINES[normalizedIntent] || PIPELINES.video).slice();

  if (normalizedIntent === 'video' && options.withAudio) {
    stages = ['prompt', 'audio', 'image', 'video', 'audio_qa', 'vision_qa', 'client_handoff'];
  }
  if (options.withoutHandoff) {
    stages = stages.filter((stage) => stage !== 'client_handoff');
  }

  return stages
    .map((stage, index) => {
      const role = matrix[stage];
      if (!role) return null;
      return {
        order: index + 1,
        stage,
        primary: role.primary,
        title: role.title,
        responsibility: role.responsibility,
        helpers: Array.isArray(role.helpers) ? role.helpers.slice() : [],
        fallbacks: Array.isArray(role.fallbacks) ? role.fallbacks.slice() : [],
      };
    })
    .filter(Boolean);
}

function buildRoutingLines(intent = 'media', options = {}) {
  return buildMediaPipeline(intent, options).map((entry) => {
    const fallbackText = entry.fallbacks.length ? ` Fallback: ${entry.fallbacks.join(' -> ')}.` : '';
    const helperText = entry.helpers.length ? ` Helpers: ${entry.helpers.join(', ')}.` : '';
    return `${entry.primary}: ${entry.title} - ${entry.responsibility}.${helperText}${fallbackText}`;
  });
}

function attachMediaAgentRoles(payload = {}, intent = 'media', options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const mediaAgentRoles = getMediaAgentRoleMatrix(options.env || process.env);
  const mediaPipeline = buildMediaPipeline(intent, options);
  return {
    ...payload,
    mediaAgentRoles,
    mediaPipeline,
    orchestration: {
      mode: 'funesterie-media-roles-v1',
      intent: normalizeIntent(intent),
      promptOwner: mediaAgentRoles.prompt.primary,
      imageOwner: mediaAgentRoles.image.primary,
      audioOwner: mediaAgentRoles.audio.primary,
      videoOwner: mediaAgentRoles.video.primary,
      visionQaOwner: mediaAgentRoles.vision_qa.primary,
      audioQaOwner: mediaAgentRoles.audio_qa.primary,
      clientHandoffOwner: mediaAgentRoles.client_handoff.primary,
      ...(options.providerOrder ? { imageProviderOrder: options.providerOrder } : {}),
    },
  };
}

module.exports = {
  DEFAULT_ROLE_MATRIX,
  attachMediaAgentRoles,
  buildMediaPipeline,
  buildRoutingLines,
  getMediaAgentRoleMatrix,
  normalizeIntent,
};
