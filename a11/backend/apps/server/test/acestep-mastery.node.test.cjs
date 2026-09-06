'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendAceStepMasteryEvent,
  buildAceStepMasteryHints,
  hashActor,
  readAceStepMasteryEvents,
  summarizeAceStepMastery,
} = require('../src/music/acestep-mastery.cjs');

test('la memoire ACE separe les utilisateurs par hash et ne stocke pas leur identite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acestep-mastery-'));
  const env = { A11_RUNTIME_ROOT: root };
  try {
    const actor = 'user:djeff@example.test';
    appendAceStepMasteryEvent(actor, {
      type: 'feedback',
      promptId: 'dcaaef9a-d6e1-4ddb-8dc7-cda0dc5e2272',
      verdict: 'rejected',
      defects: ['crackle', 'simple_arrangement', 'duo_not_distinct', 'not_allowed'],
      notes: 'Le son gresille et le duo ne change pas de timbre.',
    }, { env });

    const files = fs.readdirSync(path.join(root, 'acestep-mastery'));
    assert.deepEqual(files, [`${hashActor(actor)}.jsonl`]);
    const raw = fs.readFileSync(path.join(root, 'acestep-mastery', files[0]), 'utf8');
    assert.equal(raw.includes(actor), false, 'identite brute absente du journal');
    assert.equal(raw.includes('not_allowed'), false, 'defauts non reconnus ignores');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('les retours explicites deviennent des garde-fous de generation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acestep-mastery-'));
  const env = { A11_RUNTIME_ROOT: root };
  const actor = 'user:fondateur';
  try {
    appendAceStepMasteryEvent(actor, {
      type: 'submitted',
      promptId: 'prompt-123456',
      castCount: 2,
      castMode: 'guided_multi_timbre',
      durationSeconds: 300,
      tags: 'French dual vocal production',
    }, { env });
    appendAceStepMasteryEvent(actor, {
      type: 'completed',
      promptId: 'prompt-123456',
      sourceFormat: 'flac',
      singlePassMaster: true,
    }, { env });
    appendAceStepMasteryEvent(actor, {
      type: 'feedback',
      promptId: 'prompt-123456',
      verdict: 'rejected',
      defects: ['crackle', 'bass_heavy', 'simple_arrangement', 'duo_not_distinct'],
    }, { env });

    const events = readAceStepMasteryEvents(actor, { env });
    assert.equal(events.length, 3);
    const summary = summarizeAceStepMastery(actor, { env });
    assert.equal(summary.generations, 1);
    assert.equal(summary.completions, 1);
    assert.equal(summary.feedbackCount, 1);
    assert.equal(summary.verdictCounts.rejected, 1);
    const hints = buildAceStepMasteryHints(summary).join(' ');
    assert.match(hints, /no crackle/i);
    assert.match(hints, /controlled sub-bass/i);
    assert.match(hints, /evolving arrangement/i);
    assert.match(hints, /contrasting vocal timbres/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
