'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  A11_AGENT_SYSTEM_PROMPT,
} = require('../lib/a11Agent.js');
const {
  A11_PRIVATE_CORPUS_CAPSULE_CONTEXT,
  VOIX_DE_LAIT_CORPUS_CAPSULE,
  appendPrivateCorpusCapsuleContext,
  hasPrivateCorpusCapsuleContext,
} = require('../src/chat/private-corpus-capsules.cjs');
const {
  buildCapsule,
  normalizeTranscript,
} = require('../scripts/ingest-voix-de-lait-corpus.cjs');

test('voix de lait capsule is compact and shared with A11 agent prompt', () => {
  assert.equal(VOIX_DE_LAIT_CORPUS_CAPSULE.id, 'a11-voix-de-lait');
  assert.match(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /private corpus capsules/i);
  assert.match(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /raw transcript stays private\/local/i);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /a11-voix-de-lait/i);
  assert.doesNotMatch(A11_PRIVATE_CORPUS_CAPSULE_CONTEXT, /Il est necessaire, evidemment/i);
});

test('private corpus capsule append is idempotent', () => {
  const once = appendPrivateCorpusCapsuleContext('base');
  const twice = appendPrivateCorpusCapsuleContext(once);

  assert.equal(once, twice);
  assert.equal(hasPrivateCorpusCapsuleContext(twice), true);
});

test('voix de lait transcript ingestion strips external banner metadata', () => {
  const cleaned = normalizeTranscript([
    '(Transcrit par TurboScribe. Passez a Illimite pour supprimer ce message.)',
    '',
    'Une premiere ligne utile.',
    '',
    '',
    'Une deuxieme ligne utile.',
  ].join('\n'));
  const capsule = buildCapsule({
    cleaned,
    sourcePath: 'C:\\tmp\\voix de lait transcription.txt',
    generatedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.doesNotMatch(cleaned, /TurboScribe/i);
  assert.match(cleaned, /Une premiere ligne utile/);
  assert.equal(capsule.id, 'a11-voix-de-lait');
  assert.equal(capsule.source.lines, 2);
  assert.match(capsule.retrievalRule, /private transcript/i);
});
