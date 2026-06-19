const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolated runtime root so the placeholder WAV files land in a temp dir.
const tmpRoot = path.join(os.tmpdir(), `vivy-voice-routing-${process.pid}`);
process.env.A11_RUNTIME_ROOT = path.join(tmpRoot, 'runtime');
process.env.VIVY_CHAT_DISABLE_LLM = 'true';
// Make sure the env opt-in is NOT what enables the placeholder in these tests.
delete process.env.VIVY_STUDIO_ENABLE_PLACEHOLDER_MEDIA;

const { buildEmergencyMediaForProduction } = require('../src/routes/vivy-studio.cjs');

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// BUG 3 — multi-voice audio routing.
// The emergency placeholder must reflect the selected casting voice. The
// `a11-emergency-*` provider is reserved for the A11 persona only; it must never
// silently stand in for Vivy/K44/Djeff/catalog voices.

function songInput(extra = {}) {
  return {
    mode: 'song',
    // Force the opt-in placeholder generator on for the test.
    allowEmergencyMedia: '1',
    songText: 'Une chanson de test pour le routage du casting.',
    songMood: 'electro pop dark',
    ...extra,
  };
}

test('BUG3: casting Vivy routes the placeholder to a Vivy asset, not a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ songArtists: ['vivy'] }), null);
  assert.ok(media, 'expected a placeholder asset');
  assert.equal(media.kind, 'audio');
  assert.equal(media.persona, 'vivy');
  assert.equal(media.provider, 'vivy-emergency-wav');
  assert.equal(media.isA11Emergency, false);
  assert.doesNotMatch(media.provider, /^a11-emergency/);
  assert.match(media.filename, /^vivy-song-/);
});

test('BUG3: casting K44 routes to a K44 asset, not a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ songArtists: ['k44'] }), null);
  assert.equal(media.persona, 'k44');
  assert.equal(media.provider, 'k44-emergency-wav');
  assert.equal(media.isA11Emergency, false);
  assert.doesNotMatch(media.provider, /^a11-emergency/);
});

test('BUG3: casting Djeff routes to a Djeff asset, not a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ songArtists: ['djeff'] }), null);
  assert.equal(media.persona, 'djeff');
  assert.equal(media.provider, 'djeff-emergency-wav');
  assert.equal(media.isA11Emergency, false);
  assert.doesNotMatch(media.provider, /^a11-emergency/);
});

test('BUG3: casting A11 keeps the a11-emergency placeholder (reserved for A11)', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ songArtists: ['a11'] }), null);
  assert.equal(media.persona, 'a11');
  assert.equal(media.provider, 'a11-emergency-wav');
  assert.equal(media.isA11Emergency, true);
});

test('BUG3: catalog voice routes to a catalog asset, not a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ catalogVoiceName: 'Lumen Premium' }), null);
  assert.equal(media.persona, 'catalog');
  assert.equal(media.provider, 'catalog-emergency-wav');
  assert.equal(media.isA11Emergency, false);
  assert.equal(media.voice, 'Lumen Premium');
});

test('BUG3: duo Djeff + Vivy routes to a combined asset, never a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput({ songArtists: ['djeff', 'vivy'] }), null);
  assert.equal(media.persona, 'djeff-vivy');
  assert.equal(media.provider, 'djeff-vivy-emergency-wav');
  assert.equal(media.isA11Emergency, false);
});

test('BUG3: no casting defaults to the Vivy studio context, not a11-emergency', async () => {
  const media = await buildEmergencyMediaForProduction('song', songInput(), null);
  assert.equal(media.persona, 'vivy');
  assert.equal(media.provider, 'vivy-emergency-wav');
  assert.equal(media.isA11Emergency, false);
});

test('BUG3: the placeholder stays opt-in (no flag returns no media)', async () => {
  const media = await buildEmergencyMediaForProduction(
    'song',
    { mode: 'song', songArtists: ['vivy'], songText: 'pas de placeholder ici' },
    null,
  );
  assert.equal(media, null);
});
