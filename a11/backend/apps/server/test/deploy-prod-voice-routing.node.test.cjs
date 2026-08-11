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

test('prod deploy preserves Suno persona voice ids across blue-green refreshes', () => {
  const script = readDeployScript();

  assert.match(script, /VIVY_SUNO_DJEFF_VOICE_ID\s*=\s*\$\(if \(\$env:VIVY_SUNO_DJEFF_VOICE_ID\)[\s\S]+?\$envMap\["SUNO_DJEFF_VOICE_ID"\][\s\S]+?\$envMap\["A11_SUNO_DJEFF_VOICE_ID"\]/);
  assert.match(script, /VIVY_SUNO_MARVIN_VOICE_ID\s*=\s*\$\(if \(\$env:VIVY_SUNO_MARVIN_VOICE_ID\)[\s\S]+?\$envMap\["VIVY_SUNO_FRERE_VOICE_ID"\][\s\S]+?\$envMap\["SUNO_MARVIN_VOICE_ID"\][\s\S]+?\$envMap\["A11_SUNO_MARVIN_VOICE_ID"\]/);
  assert.match(script, /VIVY_SUNO_A11_VOICE_ID\s*=\s*\$\(if \(\$env:VIVY_SUNO_A11_VOICE_ID\)[\s\S]+?\$envMap\["SUNO_A11_VOICE_ID"\][\s\S]+?\$envMap\["A11_SUNO_A11_VOICE_ID"\]/);
  assert.match(script, /VIVY_SUNO_K44_VOICE_ID\s*=\s*\$\(if \(\$env:VIVY_SUNO_K44_VOICE_ID\)[\s\S]+?\$envMap\["VIVY_SUNO_KAEN44_VOICE_ID"\][\s\S]+?\$envMap\["SUNO_KAEN44_VOICE_ID"\][\s\S]+?\$envMap\["A11_SUNO_K44_VOICE_ID"\]/);
  assert.match(script, /managed_keys='[^']*VIVY_SUNO_DJEFF_VOICE_ID/);
  assert.match(script, /managed_keys='[^']*VIVY_SUNO_MARVIN_VOICE_ID/);
  assert.match(script, /managed_keys='[^']*SUNO_MARVIN_VOICE_ID/);
  assert.match(script, /managed_keys='[^']*SUNO_DJEFF_VOICE_ID/);
  assert.match(script, /managed_keys='[^']*A11_SUNO_DJEFF_VOICE_ID/);
  assert.match(script, /suno_djeff_voice_id="\$\(read_first_env_value VIVY_SUNO_DJEFF_VOICE_ID\)"/);
  assert.match(script, /suno_marvin_voice_id="\$\(read_first_env_value VIVY_SUNO_MARVIN_VOICE_ID\)"/);
  assert.match(script, /printf 'VIVY_SUNO_DJEFF_VOICE_ID=%s\\n' "\$suno_djeff_voice_id"/);
  assert.match(script, /printf 'VIVY_SUNO_MARVIN_VOICE_ID=%s\\n' "\$suno_marvin_voice_id"/);
  assert.match(script, /printf 'VIVY_SUNO_KAEN44_VOICE_ID=%s\\n' "\$suno_k44_voice_id"/);
});

test('prod deploy proves Caddy health and the exact blue-green build before switching traffic', () => {
  const script = readDeployScript();

  assert.equal(countNeedle(script, 'caddy_health_ok=0'), 2, 'both deploy paths must initialize the Caddy health result');
  assert.equal(countNeedle(script, 'caddy_health_ok=1'), 2, 'both deploy paths must record a successful Caddy probe');
  assert.equal(
    countNeedle(script, 'if [ "`$caddy_health_ok" != "1" ]; then'),
    2,
    'both deploy paths must check the final Caddy health result'
  );
  assert.equal(countNeedle(script, 'Caddy healthcheck failed after 30 attempts'), 2);
  assert.equal(countNeedle(script, 'exit 43'), 2, 'both deploy paths must return a non-zero status after exhausting retries');
  assert.match(script, /\$BuildCommit -notmatch '\^\[0-9a-fA-F\]\{40\}\$'/);
  assert.match(script, /\$BuildCommitBase64 = \[Convert\]::ToBase64String\(\[Text\.Encoding\]::ASCII\.GetBytes\(\$BuildCommit\)\)/);
  assert.match(script, /expected_build_commit_b64='__EXPECTED_BUILD_COMMIT_B64__'/);
  assert.match(script, /expected_build_commit="`\$\(printf '%s' "`\$expected_build_commit_b64" \| base64 -d\)"/);
  assert.match(script, /\$remoteDeploy = \$remoteDeploy\.Replace\('__EXPECTED_BUILD_COMMIT_B64__', \$BuildCommitBase64\)/);
  assert.equal(countNeedle(script, "curl -fsS -H 'Host: a11.funesterie.me' http://127.0.0.1/api/build"), 1);
  assert.equal(countNeedle(script, 'caddy_build_ok=0'), 1);
  assert.equal(countNeedle(script, 'caddy_build_ok=1'), 1);
  assert.equal(countNeedle(script, 'Caddy build probe failed: /api/build did not return the expected commit'), 1);

  const blueGreenMatch = script.match(/if \(\$BlueGreen\) \{\r?\n\s+\$cleanOldFlag[\s\S]*?\r?\n"@\r?\n\} else \{/);
  assert.ok(blueGreenMatch, 'blue-green remote deploy block must exist');
  const blueGreen = blueGreenMatch[0];
  assert.equal(countNeedle(blueGreen, 'exit 44'), 1, 'the blue-green path must fail hard on a stale Caddy fallback');
  const probeIndex = blueGreen.indexOf('echo "__A11_HEALTH__"');
  const failureExitIndex = blueGreen.indexOf('exit 43', probeIndex);
  const buildProbeIndex = blueGreen.indexOf('http://127.0.0.1/api/build', probeIndex);
  const exactBuildIndex = blueGreen.indexOf('if [ "`$caddy_build_commit" = "`$expected_build_commit" ]; then', buildProbeIndex);
  const buildFailureExitIndex = blueGreen.indexOf('exit 44', exactBuildIndex);
  const activeColorIndex = blueGreen.indexOf('bluegreen/active-color', probeIndex);
  const cleanupIndex = blueGreen.indexOf('docker rm -f "a11-backend-', probeIndex);

  assert.ok(probeIndex >= 0, 'blue-green path must run the final Caddy probe');
  assert.ok(failureExitIndex > probeIndex, 'blue-green path must fail hard after the final Caddy probe');
  assert.ok(buildProbeIndex > probeIndex, 'blue-green path must query /api/build through Caddy');
  assert.ok(exactBuildIndex > buildProbeIndex, 'the Caddy response commit must equal the packaged commit');
  assert.ok(buildFailureExitIndex > exactBuildIndex, 'a stale fallback build must fail hard');
  assert.ok(activeColorIndex > buildFailureExitIndex, 'active-color must only change after health and exact-build probes succeed');
  assert.ok(cleanupIndex > activeColorIndex, 'old-color cleanup must only run after the active marker changes');
  assert.doesNotMatch(
    blueGreen.slice(0, probeIndex),
    /bluegreen\/active-color|docker rm -f "a11-backend-/,
    'the old marker and containers must remain untouched before the final Caddy probe'
  );
});
