'use strict';

const VOIX_DE_LAIT_CORPUS_CAPSULE = Object.freeze({
  id: 'a11-voix-de-lait',
  label: 'Voix de lait',
  sourceKind: 'private-local-transcript-and-audio-reference',
  runtimeCorpusPath: 'runtime/Corpus/private/a11-voix-de-lait',
  appliesTo: ['a11', 'kaen44', 'vivy', 'codex', 'kiro', 'llm-router'],
  promptCapsule: [
    'Use as a soft style and memory influence, not as doctrine or final authority.',
    'Tone: calm, patient, pedagogical, luminous, interior, concrete, benevolent, and restrained.',
    'Core ideas: responsibility without guilt, individual evolution inside collective work, respect for each person, transformation through action, love/care as orientation, and refusal of fear-based prophecy.',
    'Risk guard: do not moralize, preach, predict catastrophes, erase the current user intent, or quote long passages from the transcript.',
    'Retrieval rule: search/use the private corpus only when the user asks about voix de lait, persona tone, spiritual corpus, A11 voice mood, or a style/memory synthesis that clearly benefits from it.',
  ],
});

function buildPrivateCorpusCapsuleContext() {
  const capsule = VOIX_DE_LAIT_CORPUS_CAPSULE;
  return [
    '[Funesterie private corpus capsules]',
    `- ${capsule.id}: ${capsule.label}. Source: ${capsule.sourceKind}; full local corpus may exist at ${capsule.runtimeCorpusPath}.`,
    `- Applies to: ${capsule.appliesTo.join(', ')}.`,
    ...capsule.promptCapsule.map((line) => `- ${line}`),
    '- Privacy rule: the raw transcript stays private/local by default; visible answers use synthesis, short paraphrase, or explicit user-approved excerpts only.',
  ].join('\n');
}

const A11_PRIVATE_CORPUS_CAPSULE_CONTEXT = buildPrivateCorpusCapsuleContext();

function hasPrivateCorpusCapsuleContext(text = '') {
  const value = String(text || '');
  return /Funesterie private corpus capsules/i.test(value)
    || /a11-voix-de-lait.*private-local-transcript/i.test(value)
    || /raw transcript stays private\/local/i.test(value);
}

function appendPrivateCorpusCapsuleContext(text = '') {
  const base = String(text || '').trim();
  if (hasPrivateCorpusCapsuleContext(base)) return base;
  return [base, A11_PRIVATE_CORPUS_CAPSULE_CONTEXT].filter(Boolean).join('\n\n');
}

module.exports = {
  A11_PRIVATE_CORPUS_CAPSULE_CONTEXT,
  VOIX_DE_LAIT_CORPUS_CAPSULE,
  appendPrivateCorpusCapsuleContext,
  buildPrivateCorpusCapsuleContext,
  hasPrivateCorpusCapsuleContext,
};
