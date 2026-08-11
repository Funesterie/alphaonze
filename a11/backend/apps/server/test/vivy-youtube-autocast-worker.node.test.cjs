'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildPostingDesire,
  loadYoutubeCredentials,
  maybeRecordPostingDesire,
  parseRandomThemes,
} = require('../scripts/vivy-youtube-autocast-worker.cjs');

test('YouTube autocast refuses the Social Connect OAuth clients without exposing their id', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vivy-youtube-autocast-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const tokenFile = path.join(tempRoot, 'legacy-token.json');
  const sharedClientId = 'shared-client-id.apps.googleusercontent.com';
  fs.writeFileSync(tokenFile, JSON.stringify({
    refresh_token: 'legacy-refresh-token',
    client_id: sharedClientId,
    client_secret: 'legacy-client-secret',
  }));

  for (const envName of ['SOCIAL_YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_ID']) {
    assert.throws(
      () => loadYoutubeCredentials(tokenFile, { [envName]: sharedClientId }),
      (error) => {
        assert.equal(error.code, 'youtube_autocast_social_connect_client_forbidden');
        assert.equal(error.message, 'youtube_autocast_social_connect_client_forbidden');
        assert.equal(error.message.includes(sharedClientId), false);
        return true;
      },
    );
  }

  assert.doesNotThrow(() => loadYoutubeCredentials(tokenFile, {
    SOCIAL_YOUTUBE_CLIENT_ID: sharedClientId.toUpperCase(),
    YOUTUBE_CLIENT_ID: `${sharedClientId}-other`,
  }));
});

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
