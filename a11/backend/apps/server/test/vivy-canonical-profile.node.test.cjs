'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  VIVY_CANONICAL_PROFILE,
  VIVY_CANONICAL_SOURCE_SHA256,
  installCanonicalVivyProfile,
} = require('../src/persona/vivy-canonical-profile.cjs');
const {
  buildPersonaSystemPrompt,
  loadPersonaState,
  resetDjeffPersonaCache,
} = require('../src/persona/persona-engine.cjs');

test('the recovered Vivy profile keeps persona ADN separate from song sonic direction', () => {
  assert.equal(VIVY_CANONICAL_PROFILE.active, true);
  assert.equal(VIVY_CANONICAL_PROFILE.source.sha256, VIVY_CANONICAL_SOURCE_SHA256);
  assert.match(VIVY_CANONICAL_PROFILE.injectable_brief, /demande technique appelle une réponse technique/i);
  assert.match(VIVY_CANONICAL_PROFILE.injectable_brief, /couleur sonore.*contrats séparés/i);
  assert.match(VIVY_CANONICAL_PROFILE.boundaries.song_sonic_direction, /vide.*matière.*sans décor sonore par défaut/i);
  assert.doesNotMatch(JSON.stringify(VIVY_CANONICAL_PROFILE), /sombre[- ]néon|doom metal|boom bap 90s/i);
});

test('the canonical installer activates an absent Vivy profile without overwriting an existing one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vivy-canonical-profile-'));
  const env = { ...process.env, A11_RUNTIME_ROOT: root };
  try {
    const first = installCanonicalVivyProfile(env);
    assert.equal(first.action, 'installed');
    resetDjeffPersonaCache();
    const state = loadPersonaState('vivy', env, { force: true });
    assert.equal(state.active, true);
    assert.equal(state.source, 'profile');
    assert.match(buildPersonaSystemPrompt('vivy', env), /réponse technique directe/i);

    const custom = { active: false, status: 'review-required', injectable_brief: 'Révision humaine locale.' };
    fs.writeFileSync(first.target, JSON.stringify(custom));
    const second = installCanonicalVivyProfile(env);
    assert.equal(second.action, 'preserved');
    assert.deepEqual(JSON.parse(fs.readFileSync(first.target, 'utf8')), custom);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    resetDjeffPersonaCache();
  }
});

test('backend startup installs the canonical profile before starting the server', () => {
  const startup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'start-with-workers.cjs'), 'utf8');
  const installAt = startup.indexOf("install-vivy-canonical-profile.cjs");
  const serverAt = startup.indexOf('startServer();');
  assert.ok(installAt >= 0 && serverAt > installAt);
});
