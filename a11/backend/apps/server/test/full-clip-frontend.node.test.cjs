'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'frontend', 'apps', 'web', 'src', 'lib', 'api.ts'),
  'utf8'
);
const appSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'frontend', 'apps', 'web', 'src', 'App.tsx'),
  'utf8'
);

test('Full Clip frontend polls the durable job and surfaces HTTP failures', () => {
  const block = apiSource.slice(
    apiSource.indexOf('export async function produceFullClip'),
    apiSource.indexOf('export type VivyGenerationStats')
  );
  assert.match(block, /buildAuthHeaders\("application\/json"\)/);
  assert.match(block, /if \(!res\.ok \|\| payload\?\.ok === false\)/);
  assert.match(block, /payload\?\.statusUrl/);
  assert.match(block, /job\?\.status === "done"/);
  assert.match(block, /\["error", "cancelled"\]/);
});

test('Vivy chat renders and refreshes the 24 hour lyrics/full clip counter', () => {
  assert.match(apiSource, /export async function fetchVivyGenerationStats/);
  assert.match(appSource, /fetchVivyGenerationStats\(24\)/);
  assert.match(appSource, /Compteur 24 h/);
  assert.match(appSource, /lyricsGenerationStats\?\.attempts/);
  assert.match(appSource, /fullClipGenerationStats\?\.active/);
  assert.match(appSource, /window\.setInterval\(\(\) => \{ void refreshGenerationStats\(\); \}, 60_000\)/);
});
