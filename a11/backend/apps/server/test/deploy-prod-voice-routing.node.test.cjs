'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deployScriptPath = path.resolve(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1');

function readDeployScript() {
  return fs.readFileSync(deployScriptPath, 'utf8');
}

function countNeedle(text, needle) {
  return text.split(needle).length - 1;
}

test('prod deploy keeps official ElevenLabs fallback voice ids distinct', () => {
  const script = readDeployScript();

  assert.match(script, /A11_ELEVENLABS_A11_VOICE_ID\s*=\s*\$\(if \(\$env:A11_ELEVENLABS_A11_VOICE_ID\)[\s\S]+?"pNInz6obpgDQGcFmaJgB"/);
  assert.match(script, /A11_ELEVENLABS_DJEFF_VOICE_ID\s*=\s*\$\(if \(\$env:A11_ELEVENLABS_DJEFF_VOICE_ID\)[\s\S]+?else \{ "" \}/);
  assert.match(script, /A11_ELEVENLABS_KAEN44_VOICE_ID\s*=\s*\$\(if \(\$env:A11_ELEVENLABS_KAEN44_VOICE_ID\)[\s\S]+?"EXAVITQu4vr4xnSDxMaL"/);
  assert.match(script, /A11_ELEVENLABS_K44_VOICE_ID\s*=\s*\$\(if \(\$env:A11_ELEVENLABS_K44_VOICE_ID\)[\s\S]+?"EXAVITQu4vr4xnSDxMaL"/);
  assert.match(script, /A11_ELEVENLABS_VIVY_VOICE_ID\s*=\s*\$\(if \(\$env:A11_ELEVENLABS_VIVY_VOICE_ID\)[\s\S]+?"21m00Tcm4TlvDq8ikWAM"/);
  assert.match(script, /\$envMap\["A11_ELEVENLABS_A11_VOICE_ID"\]/);
  assert.match(script, /\$envMap\["A11_ELEVENLABS_DJEFF_VOICE_ID"\]/);
  assert.match(script, /\$envMap\["A11_ELEVENLABS_KAEN44_VOICE_ID"\]/);
  assert.match(script, /\$envMap\["A11_ELEVENLABS_K44_VOICE_ID"\]/);
  assert.match(script, /\$envMap\["A11_ELEVENLABS_VIVY_VOICE_ID"\]/);

  assert.doesNotMatch(script, /A11_ELEVENLABS_KAEN44_VOICE_ID[^\r\n]+"JBFqnCBsd6RMkjVDRZzb"/);
  assert.doesNotMatch(script, /A11_ELEVENLABS_K44_VOICE_ID[^\r\n]+"JBFqnCBsd6RMkjVDRZzb"/);
  assert.doesNotMatch(script, /A11_ELEVENLABS_VIVY_VOICE_ID[^\r\n]+"JBFqnCBsd6RMkjVDRZzb"/);
  assert.doesNotMatch(script, /A11_ELEVENLABS_DJEFF_VOICE_ID[^\r\n]+"ErXwobaYiN019PkySvjV"/);
});

test('prod deploy injects voice module and XTTS/RVC env into both backend services', () => {
  const script = readDeployScript();
  const requiredBackendLines = [
    'TTS_URL: ${TTS_URL:-http://a11-voice:5002}',
    'VOICE_MODULE_URL: ${VOICE_MODULE_URL:-http://a11-voice:5002}',
    'A11_VOICE_MODULE_URL: ${A11_VOICE_MODULE_URL:-http://a11-voice:5002}',
    'ENABLE_PIPER_HTTP: ${ENABLE_PIPER_HTTP:-true}',
    'A11_TTS_ALLOW_XTTS_RVC_AUTO: ${A11_TTS_ALLOW_XTTS_RVC_AUTO:-true}',
    'A11_VOICE_CONVERSION_ENABLED: ${A11_VOICE_CONVERSION_ENABLED:-true}',
    'A11_VOICE_XTTS_RVC_URL: ${A11_VOICE_XTTS_RVC_URL:-http://a11-xtts-rvc:5000}',
  ];

  for (const line of requiredBackendLines) {
    assert.ok(countNeedle(script, line) >= 2, `${line} must be present in both backend services`);
  }
});

test('prod deploy loads the merged secret env in both backend services', () => {
  const script = readDeployScript();

  assert.ok(
    countNeedle(script, '- /srv/a11/secrets/compose.env') >= 2,
    'both backend services must load the merged compose.env secret store'
  );
  assert.match(script, /Import-OptionalSecretFile\s+\$envMap\s+"A11_ELEVENLABS_API_KEY"/);
  assert.match(script, /keyelevenlabs\.txt/);
});

test('prod deploy preserves remote secrets when the secret file is not directly readable', () => {
  const script = readDeployScript();

  assert.match(script, /bluegreen\/active-color/);
  assert.match(script, /docker inspect "\$container" --format/);
  assert.match(script, /\$existingPgPass = \$null[\s\S]+?Read-RemoteEnvValue "DATABASE_URL"[\s\S]+?Read-RemoteEnvValue "POSTGRES_PASSWORD"/);
  assert.match(script, /\[Uri\]::UnescapeDataString/);
});

test('prod deploy refreshes the explicit Vivy music preview flag when remote secrets are reused', () => {
  const script = readDeployScript();

  assert.match(script, /managed_keys=.*VIVY_ELEVENLABS_MUSIC_DISABLED/);
  assert.match(script, /printf 'VIVY_ELEVENLABS_MUSIC_DISABLED=false\\n'/);
});
