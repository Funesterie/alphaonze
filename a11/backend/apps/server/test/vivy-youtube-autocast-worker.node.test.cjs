'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPostingDesire,
  maybeRecordPostingDesire,
  parseRandomThemes,
} = require('../scripts/vivy-youtube-autocast-worker.cjs');

test('YouTube autocast parses custom random themes with a useful fallback', () => {
  assert.deepEqual(parseRandomThemes('alpha|beta; gamma'), ['alpha', 'beta', 'gamma']);
  assert.ok(parseRandomThemes('').some((theme) => /Vivy|Djeff|Funesterie|Mille Fleurs/i.test(theme)));
});

test('YouTube autocast builds a safe seed-only desire without paid generation', () => {
  const ledger = { startedAt: '2026-07-09T00:00:00.000Z', songs: {}, desires: [] };
  const desire = buildPostingDesire({
    now: '2026-07-09T02:00:00.000Z',
    randomThemes: 'Mille Fleurs matière-source',
    desireCooldownMs: 3600000,
  }, ledger);
  assert.equal(desire.status, 'seed_only');
  assert.equal(desire.paidGeneration, false);
  assert.match(desire.prompt, /^!nossen Mille Fleurs matière-source/);
});

test('YouTube autocast records at most one desire per cooldown window', () => {
  const ledger = { startedAt: '2026-07-09T00:00:00.000Z', songs: {}, desires: [] };
  const opts = {
    desireEnabled: true,
    desireChance: 1,
    now: '2026-07-09T02:00:00.000Z',
    randomThemes: 'Shiryu lame de sang',
    desireCooldownMs: 3600000,
  };
  const first = maybeRecordPostingDesire(ledger, opts);
  const second = maybeRecordPostingDesire(ledger, { ...opts, now: '2026-07-09T02:30:00.000Z' });
  const third = maybeRecordPostingDesire(ledger, { ...opts, now: '2026-07-09T03:01:00.000Z' });
  assert.ok(first);
  assert.equal(second, null);
  assert.ok(third);
  assert.equal(ledger.desires.length, 2);
});
