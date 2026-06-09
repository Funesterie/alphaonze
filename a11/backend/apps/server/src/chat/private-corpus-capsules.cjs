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
    'Core ideas: responsibility without guilt, transition between eras, a new era built through collective work, respect for each person, transformation through action, love/care as orientation, and refusal of fear-based prophecy.',
    'Risk guard: do not moralize, preach, predict catastrophes, erase the current user intent, or quote long passages from the transcript.',
    'Retrieval rule: search/use the private corpus only when the user asks about voix de lait, persona tone, inner symbolic corpus, A11 voice mood, or a style/memory synthesis that clearly benefits from it.',
  ],
});

const DJEFF_PIGNON_RAP_CORPUS_CAPSULE = Object.freeze({
  id: 'djeff-pignon-rap',
  label: 'Pignon - Djeff rap voice',
  sourceKind: 'private-local-rap-lyrics-and-owned-voice-reference',
  runtimeCorpusPath: 'runtime/Corpus/private/djeff-pignon-rap',
  appliesTo: ['vivy', 'a11', 'kaen44', 'codex', 'kiro', 'llm-router', 'voice-router'],
  promptCapsule: [
    'Use as Djeff rap style memory and voice-routing context, not as a generic A11 voice.',
    'Tone: French technical rap, direct, mechanic, concrete, nervous but controlled.',
    'Core images: pignon-couronne, double radiateur, Ipone, moteur qui respire, roues, pneus comme crayons, guidon, visière, métal, wheeling.',
    'Supplemental clips: mood simple, avancer droit, instant présent, admettre avoir tort, ne pas faire le moine, passer au futur par action présente, système D, débrouille, détermination, responsabilité.',
    'Flow: tight diction, internal rhymes, percussive line endings, street-mechanic vocabulary, no service-client politeness.',
    'Retrieval rule: use when Vivy/A11 is asked for Djeff rap voice, Pignon lyrics, motorcycle rap, duo Djeff + Vivy, or voiceStyle=djeff-rap.',
  ],
});

const A11_FATIGUE_VOICE_CORPUS_CAPSULE = Object.freeze({
  id: 'a11-fatigue-voice',
  label: 'A11 fatigue voice draft',
  sourceKind: 'private-local-fatigue-transcript-persona-only',
  runtimeCorpusPath: 'runtime/Corpus/private/a11-fatigue-voice',
  appliesTo: ['a11', 'codex', 'kiro', 'llm-router'],
  promptCapsule: [
    'Use as a rough persona/corpus draft only; never use it as an official voice reference or vocal target.',
    'Tone: spontaneous, absurdist, symbolic, self-aware, exploratory, with deliberately unstable hypotheses.',
    'Core images: stars, limited perception, 1+1=3 as hypothesis, voie lactee/voie du miel, moto, controller, colored keyboard, links, Megazord, quantum/evolutionary nature, volume and long silences.',
    'Risk guard: keep the playful symbolic energy, but do not copy the fatigue, rambling, weak voice quality, or uncertain transcription as authority.',
    'Retrieval rule: use only when the user asks about the A11 tired WAV, persona draft, voie lactee/voie du miel, contemplologie, Megazord-style collective assembly, or a symbolic memory synthesis that clearly benefits from it.',
  ],
});

const PRIVATE_CORPUS_CAPSULES = Object.freeze([
  VOIX_DE_LAIT_CORPUS_CAPSULE,
  DJEFF_PIGNON_RAP_CORPUS_CAPSULE,
  A11_FATIGUE_VOICE_CORPUS_CAPSULE,
]);

function buildPrivateCorpusCapsuleContext() {
  return [
    '[Funesterie private corpus capsules]',
    ...PRIVATE_CORPUS_CAPSULES.flatMap((capsule) => [
      `- ${capsule.id}: ${capsule.label}. Source: ${capsule.sourceKind}; full local corpus may exist at ${capsule.runtimeCorpusPath}.`,
      `- Applies to: ${capsule.appliesTo.join(', ')}.`,
      ...capsule.promptCapsule.map((line) => `- ${line}`),
    ]),
    '- Privacy rule: the raw transcript stays private/local by default; visible answers use synthesis, short paraphrase, or explicit user-approved excerpts only.',
  ].join('\n');
}

const A11_PRIVATE_CORPUS_CAPSULE_CONTEXT = buildPrivateCorpusCapsuleContext();

function hasPrivateCorpusCapsuleContext(text = '') {
  const value = String(text || '');
  return /Funesterie private corpus capsules/i.test(value)
    || /a11-voix-de-lait.*private-local-transcript/i.test(value)
    || /djeff-pignon-rap.*private-local-rap/i.test(value)
    || /a11-fatigue-voice.*persona-only/i.test(value)
    || /raw transcript stays private\/local/i.test(value);
}

function appendPrivateCorpusCapsuleContext(text = '') {
  const base = String(text || '').trim();
  if (hasPrivateCorpusCapsuleContext(base)) return base;
  return [base, A11_PRIVATE_CORPUS_CAPSULE_CONTEXT].filter(Boolean).join('\n\n');
}

module.exports = {
  A11_PRIVATE_CORPUS_CAPSULE_CONTEXT,
  A11_FATIGUE_VOICE_CORPUS_CAPSULE,
  DJEFF_PIGNON_RAP_CORPUS_CAPSULE,
  PRIVATE_CORPUS_CAPSULES,
  VOIX_DE_LAIT_CORPUS_CAPSULE,
  appendPrivateCorpusCapsuleContext,
  buildPrivateCorpusCapsuleContext,
  hasPrivateCorpusCapsuleContext,
};
