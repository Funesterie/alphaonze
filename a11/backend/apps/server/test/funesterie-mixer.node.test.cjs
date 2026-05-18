'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildMixerRoute,
  buildMixerStatus,
  mixerJsonPath,
  mixerMarkdownPath,
  writeMixerArtifacts,
} = require('../lib/funesterie-mixer.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function withTempRuntime(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-funesterie-mixer-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function withTempRuntimeAsync(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-funesterie-mixer-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedRuntimeIndex(runtimeRoot) {
  const ids = [
    'rome',
    'corpus',
    'linguistic-core',
    'qflush',
    'beam',
    'spyder',
    'bat',
    'mask',
    'morphing',
    'scream',
    'nezlephant',
    'freeland',
    'freeland-bros',
    'allmight',
  ];
  const modules = ids.map((id) => {
    const packageJson = path.join(runtimeRoot, 'fake-packages', id, 'package.json');
    writeJson(packageJson, {
      name: id === 'corpus' || id === 'linguistic-core' || id === 'mask' ? id : `@nossen/${id}`,
      version: '1.0.0',
      dependencies: id === 'qflush' ? { '@nossen/rome': '^1.0.0', '@nossen/beam': '^1.0.0' } : {},
    });
    const mirror = path.join(runtimeRoot, 'modules', id === 'corpus' ? 'Corpus' : id);
    fs.mkdirSync(mirror, { recursive: true });
    return {
      id,
      name: id,
      installed: true,
      minimumRequired: ['rome', 'corpus', 'linguistic-core'].includes(id),
      source: 'test-index',
      version: '1.0.0',
      entrypoints: {
        packageJson,
        mirror,
      },
      capabilities: ['test-capability'],
    };
  });

  writeJson(path.join(runtimeRoot, 'knowledge-graph', 'a11-runtime-module-index.json'), {
    ok: true,
    schema: 'a11.runtime-modules.v1',
    generatedAt: new Date().toISOString(),
    runtimeRoot,
    minimumRequired: ['rome', 'corpus', 'linguistic-core'],
    modules,
  });
}

test('Funesterie Mixer routes media failures to bounded video analysis capabilities', () => withTempRuntime((runtimeRoot) => {
  seedRuntimeIndex(runtimeRoot);
  const route = buildMixerRoute({
    runtimeRoot,
    request: 'A11 a des erreurs 502 video et frame generate, analyse avec Janus et QFlush',
    topN: 10,
  });

  assert.equal(route.ok, true);
  assert.equal(route.schema, 'funesterie.mixer.v1');
  assert.equal(route.intent.primary.id, 'media-analysis');
  assert.equal(route.selection.primaryRecipe.id, 'video-analysis');
  assert.equal(route.selection.executionPlan.commands.includes('npm run test:mcp'), true);
  assert.equal(route.selection.guardrails.includes('secret-redaction'), true);
  assert.ok(route.candidates.some((candidate) => candidate.id === 'video-analysis' && candidate.kind === 'recipe'));
}));

test('Funesterie Mixer exposes a default Operation BB status without launching workers', () => withTempRuntime((runtimeRoot) => {
  seedRuntimeIndex(runtimeRoot);
  const status = buildMixerStatus({ runtimeRoot });

  assert.equal(status.ok, true);
  assert.equal(status.defaultRoute.intent.id, 'worker-repair');
  assert.equal(status.mcpContract.routeTool, 'a11_funesterie_mixer_route');
  assert.equal(status.scoring.candidateKinds.includes('recipe'), true);
  assert.equal(status.defaultRoute.selection.executionPlan.dryRunFirst, true);
}));

test('Funesterie Mixer writes JSON and Markdown artifacts', async () => {
  await withTempRuntimeAsync(async (runtimeRoot) => {
    seedRuntimeIndex(runtimeRoot);
    const route = buildMixerRoute({
      runtimeRoot,
      request: 'Operation BB full repair modules workers MCP corpus',
    });
    const artifacts = await writeMixerArtifacts(route, { runtimeRoot });

    assert.equal(fs.existsSync(mixerJsonPath(runtimeRoot)), true);
    assert.equal(fs.existsSync(mixerMarkdownPath(runtimeRoot)), true);
    assert.equal(artifacts.jsonPath, mixerJsonPath(runtimeRoot));
    const written = JSON.parse(fs.readFileSync(mixerJsonPath(runtimeRoot), 'utf8'));
    assert.equal(written.id, 'funesterie-mixer');
    assert.equal(fs.readFileSync(mixerMarkdownPath(runtimeRoot), 'utf8').includes('Funesterie Mixer'), true);
  });
});
