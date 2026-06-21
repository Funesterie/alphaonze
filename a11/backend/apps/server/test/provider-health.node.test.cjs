'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../src/providers/provider-health.cjs');

test('provider health probes Groq and ElevenLabs without returning secrets', async () => {
  assert.equal(fs.existsSync(modulePath), true, 'provider health module must exist');
  const { getProviderHealth } = require(modulePath);
  const fetchImpl = async (url) => {
    if (String(url).includes('groq.com')) {
      return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      tier: 'creator',
      character_count: 250,
      character_limit: 1000,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await getProviderHealth({
    probe: true,
    fetchImpl,
    env: {
      GROQ_API_KEY: 'groq-secret-value',
      A11_ELEVENLABS_API_KEY: 'eleven-secret-value',
      VIVY_GROQ_MODEL: 'llama-3.3-70b-versatile',
    },
  });

  const groq = result.providers.find((provider) => provider.id === 'groq');
  const elevenlabs = result.providers.find((provider) => provider.id === 'elevenlabs');
  assert.equal(groq.available, true);
  assert.equal(groq.modelAvailable, true);
  assert.equal(elevenlabs.available, true);
  assert.equal(elevenlabs.credits.remaining, 750);
  assert.doesNotMatch(JSON.stringify(result), /groq-secret-value|eleven-secret-value/);
});

test('account settings exposes a click-to-test provider table', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../../../../frontend/apps/web/src/App.tsx'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/account\/provider-status', verifyJWT/);
  assert.match(serverSource, /app\.get\('\/api\/media\/download', verifyJWT/);
  assert.match(appSource, /Fournisseurs IA/);
  assert.match(appSource, /Tester les fournisseurs/);
  assert.match(appSource, /fetchProviderHealth/);
});
