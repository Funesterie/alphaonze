'use strict';

const ROLE_DEFINITIONS = {
  a11: {
    id: 'a11',
    name: 'A11',
    role: 'media-orchestrator',
    owns: ['image', 'video', 'vision', 'metadata', 'media-ingest', 'publication-package'],
    fallback: ['kaen44', 'vivy', 'qflush'],
  },
  kaen44: {
    id: 'kaen44',
    name: 'K44',
    role: 'client-copilot-and-prompt-steward',
    owns: ['prompt', 'brief', 'document', 'invoice', 'client-flow', 'accessibility', 'planning'],
    fallback: ['a11', 'qflush', 'vivy'],
  },
  vivy: {
    id: 'vivy',
    name: 'Vivy',
    role: 'audio-and-musical-identity',
    owns: ['audio', 'voice', 'music', 'lyrics', 'song', 'sfx', 'composition', 'ekko'],
    fallback: ['a11', 'kaen44', 'qflush'],
  },
  qflush: {
    id: 'qflush',
    name: 'QFlush',
    role: 'runtime-booster-and-automation',
    owns: ['automation', 'queue', 'runtime', 'optimization', 'desktop-control', 'cleanup'],
    fallback: ['a11', 'kaen44'],
  },
  nexus: {
    id: 'nexus',
    name: 'Nexus',
    role: 'system-supervisor',
    owns: ['supervision', 'status', 'routing', 'memory-sync', 'tool-diff'],
    fallback: ['a11', 'qflush', 'kaen44'],
  },
};

const KEYWORDS = [
  { agent: 'vivy', tags: ['audio', 'voice', 'music', 'lyrics', 'song', 'sfx', 'tts', 'ekko', 'sound', 'mix', 'vocal', 'voix', 'son', 'musique', 'paroles', 'chanson'] },
  { agent: 'kaen44', tags: ['prompt', 'brief', 'document', 'invoice', 'facture', 'client', 'accessibility', 'planning', 'admin', 'drive', 'file', 'fichier', 'dossier'] },
  { agent: 'a11', tags: ['image', 'video', 'vision', 'media', 'metadata', 'generation', 'render', 'frame', 'thumbnail', 'ocr', 'analyse image'] },
  { agent: 'qflush', tags: ['automation', 'queue', 'runtime', 'optimize', 'worker', 'hook', 'desktop', 'keyboard', 'mouse', 'qflush', 'janus'] },
  { agent: 'nexus', tags: ['supervision', 'status', 'sync', 'health', 'orchestration', 'mcp', 'neo4j', 'graph', 'tool diff'] },
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+_.:/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreAgent({ taskText, modality = '', requestedAgent = '' } = {}) {
  const scores = Object.fromEntries(Object.keys(ROLE_DEFINITIONS).map((agent) => [agent, 0]));
  const hits = [];
  const normalizedTask = normalizeText(taskText);
  const normalizedModality = normalizeText(modality);
  const normalizedRequestedAgent = normalizeText(requestedAgent);
  const combined = `${normalizedModality} ${normalizedTask}`.trim();

  for (const { agent, tags } of KEYWORDS) {
    for (const tag of tags) {
      const normalizedTag = normalizeText(tag);
      if (!normalizedTag) continue;
      if (combined.includes(normalizedTag)) {
        scores[agent] += normalizedModality.includes(normalizedTag) ? 4 : 2;
        hits.push({ agent, tag });
      }
    }
  }

  if (ROLE_DEFINITIONS[normalizedRequestedAgent]) {
    scores[normalizedRequestedAgent] += 6;
    hits.push({ agent: normalizedRequestedAgent, tag: 'requested-agent' });
  }

  for (const [agent, role] of Object.entries(ROLE_DEFINITIONS)) {
    if (role.owns.some((tag) => normalizeText(modality) === normalizeText(tag))) {
      scores[agent] += 5;
      hits.push({ agent, tag: `modality:${modality}` });
    }
  }

  return { scores, hits };
}

function routeAgentTask(input = {}) {
  const taskText = input.task || input.prompt || input.text || input.description || '';
  const modality = input.modality || input.type || input.kind || '';
  const requestedAgent = input.agent || input.requestedAgent || '';
  const { scores, hits } = scoreAgent({ taskText, modality, requestedAgent });
  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([agent, score]) => ({ agent, score, ...ROLE_DEFINITIONS[agent] }));
  const primary = ranked[0]?.score > 0 ? ranked[0] : ROLE_DEFINITIONS.a11;
  const fallbackIds = Array.from(new Set([
    ...(ROLE_DEFINITIONS[primary.id]?.fallback || []),
    ...ranked.filter((entry) => entry.id !== primary.id && entry.score > 0).map((entry) => entry.id),
  ])).filter((id) => ROLE_DEFINITIONS[id]);
  const confidence = Math.min(0.95, Math.max(0.35, (ranked[0]?.score || 1) / Math.max(10, (ranked[0]?.score || 0) + (ranked[1]?.score || 0) + 2)));

  return {
    ok: true,
    primary: ROLE_DEFINITIONS[primary.id],
    fallbacks: fallbackIds.map((id) => ROLE_DEFINITIONS[id]),
    confidence: Number(confidence.toFixed(2)),
    scores,
    hits,
    policy: {
      safeDefault: true,
      noSecretInPrompt: true,
      noRawRuntimeWriteWithoutScope: true,
      preferBoundedTools: true,
    },
  };
}

module.exports = {
  ROLE_DEFINITIONS,
  routeAgentTask,
};
