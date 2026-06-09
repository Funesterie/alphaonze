'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  A11_AGENT_SYSTEM_PROMPT,
} = require('../lib/a11Agent.js');
const {
  A11_PRIVATE_CORPUS_CAPSULE_CONTEXT,
  A11_FATIGUE_VOICE_CORPUS_CAPSULE,
  DJEFF_PIGNON_RAP_CORPUS_CAPSULE,
  VOIX_DE_LAIT_CORPUS_CAPSULE,
  appendPrivateCorpusCapsuleContext,
  hasPrivateCorpusCapsuleContext,
} = require('../src/chat/private-corpus-capsules.cjs');
const {
  applyTranscriptCorrections,
  buildCapsule,
  normalizeTranscript,
} = require('../scripts/ingest-voix-de-lait-corpus.cjs');
const {
  buildCapsule: buildPignonCapsule,
  normalizeSupplementalTranscript,
  normalizeTranscript: normalizePignonTranscript,
} = require('../scripts/ingest-djeff-pignon-corpus.cjs');

test('voix de lait capsule is compact and shared with A11 agent prompt', () => {
  assert.equal(VOIX_DE_LAIT_CORPUS_CAPSULE.id, 'a11-voix-de-lait');
  assert.equal(DJEFF_PIGNON_RAP_CORPUS_CAPSULE.id, 'djeff-pignon-rap');
  assert.equal(A11_FATIGUE_VOICE_CORPUS_CAPSULE.id, 'a11-fatigue-voice');
  assert.match(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /private corpus capsules/i);
  assert.match(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /raw transcript stays private\/local/i);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /a11-voix-de-lait/i);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /djeff-pignon-rap/i);
  assert.match(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /système D/i);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /a11-fatigue-voice/i);
  assert.doesNotMatch(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /Il est necessaire, evidemment/i);
  assert.doesNotMatch(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /Un quatorzième dans l'essence/i);
  assert.doesNotMatch(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /Bonjour le monde/i);
});

test('private corpus capsule append is idempotent', () => {
  const once = appendPrivateCorpusCapsuleContext('base');
  const twice = appendPrivateCorpusCapsuleContext(once);

  assert.equal(once, twice);
  assert.equal(hasPrivateCorpusCapsuleContext(twice), true);
});

test('voix de lait transcript ingestion strips external banner metadata', () => {
  const cleaned = normalizeTranscript([
    'Message de la Voix (version fidele a l audio)',
    '(Transcrit par TurboScribe. Passez a Illimite pour supprimer ce message.)',
    '',
    'Une premiere ligne utile.',
    "Sous-titres realises para la communaute d'Amara.org",
    '',
    '',
    'Une deuxieme ligne utile.',
  ].join('\n'));
  const capsule = buildCapsule({
    cleaned,
    sourcePath: 'C:\\tmp\\voix de lait transcription.txt',
    generatedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.doesNotMatch(cleaned, /Message de la Voix/i);
  assert.doesNotMatch(cleaned, /TurboScribe/i);
  assert.doesNotMatch(cleaned, /Amara/i);
  assert.match(cleaned, /Une premiere ligne utile/);
  assert.equal(capsule.id, 'a11-voix-de-lait');
  assert.equal(capsule.source.lines, 2);
  assert.match(capsule.retrievalRule, /private transcript/i);
});

test('voix de lait transcript ingestion fixes known mistranslations', () => {
  const cleaned = normalizeTranscript([
    'Ce passage entre deux airs est decisif.',
    "Et c'est pourquoi l'air nouvel dans lequel s'installe l'humanit\u00e9 regroupe.",
    'Oeuvrez ensemble.',
  ].join('\n'));

  assert.match(cleaned, /deux \u00e8res/);
  assert.match(cleaned, /l'\u00e8re nouvelle dans laquelle/);
  assert.match(cleaned, /\u0152uvrez ensemble/);
  assert.doesNotMatch(cleaned, /deux airs|air nouvel|Oeuvrez/);
  assert.equal(applyTranscriptCorrections('texte propre'), 'texte propre');
});

test('djeff pignon transcript ingestion keeps rap style without raw prompt leakage', () => {
  const cleaned = normalizePignonTranscript([
    'Vous',
    "un quatorzieme dans l'essence, 2point 2 dans la bombonne d'Ipone",
    'je dose au millimietre pas de hasard dans le style',
    'visière vissé avec du metal',
  ].join('\n'));
  const capsule = buildPignonCapsule({
    cleaned,
    sourcePath: 'C:\\tmp\\pignon paroles.txt.txt',
    generatedAt: '2026-06-09T00:00:00.000Z',
    supplementalClips: [
      {
        name: 'valable',
        pathHint: 'runtime/Corpus/private/djeff-pignon-rap/valable.transcription.txt',
        sha256: 'abc',
        chars: 120,
        lines: 1,
      },
    ],
  });

  assert.equal(capsule.id, 'djeff-pignon-rap');
  assert.match(cleaned, /quatorzième/);
  assert.match(cleaned, /deux-point-deux/);
  assert.match(cleaned, /millimètre/);
  assert.match(cleaned, /visière vissée/);
  assert.equal(normalizePignonTranscript('visière vissée avec du métal'), 'visière vissée avec du métal\n');
  assert.doesNotMatch(cleaned, /^Vous$/m);
  assert.match(capsule.retrievalRule, /voiceStyle=djeff-rap/);
  assert.equal(capsule.source.supplementalClips.length, 1);
  assert.match(capsule.promptCapsule.join('\n'), /système D/);
  assert.equal(normalizeSupplementalTranscript('\uFEFF mood simple \n\n\n avancer droit '), 'mood simple\navancer droit\n');
});
