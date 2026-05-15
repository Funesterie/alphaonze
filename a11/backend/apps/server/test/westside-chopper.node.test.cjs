'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assembleChopper,
  buildChopperStatus,
  chopperJsonPath,
  chopperMarkdownPath,
} = require('../lib/westside-chopper.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function withTempRuntime(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-westside-chopper-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function withTempRuntimeAsync(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-westside-chopper-'));
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
      name: id === 'corpus' || id === 'linguistic-core' || id === 'mask' ? id : `@funeste38/${id}`,
      version: '1.0.0',
      dependencies: id === 'qflush' ? { '@funeste38/rome': '^1.0.0', '@funeste38/beam': '^1.0.0' } : {},
    });
    return {
      id,
      name: id,
      installed: true,
      minimumRequired: ['rome', 'corpus', 'linguistic-core'].includes(id),
      source: id.startsWith('@') ? `npm:${id}` : 'test-index',
      version: '1.0.0',
      entrypoints: {
        packageJson,
        mirror: path.join(runtimeRoot, 'modules', id === 'corpus' ? 'Corpus' : id),
      },
      capabilities: ['test-capability'],
    };
  });

  for (const moduleInfo of modules) {
    fs.mkdirSync(moduleInfo.entrypoints.mirror, { recursive: true });
  }

  writeJson(path.join(runtimeRoot, 'knowledge-graph', 'a11-runtime-module-index.json'), {
    ok: true,
    schema: 'a11.runtime-modules.v1',
    generatedAt: new Date().toISOString(),
    runtimeRoot,
    minimumRequired: ['rome', 'corpus', 'linguistic-core'],
    modules,
  });
}

test('WestSide Chopper builds a secure capability graph from the runtime index', () => withTempRuntime((runtimeRoot) => {
  seedRuntimeIndex(runtimeRoot);
  const status = buildChopperStatus({ runtimeRoot });

  assert.equal(status.ok, true);
  assert.equal(status.schema, 'funesterie.westside-chopper.v1');
  assert.equal(status.summary.requiredMissing, 0);
  assert.ok(status.modules.some((moduleInfo) => moduleInfo.id === 'rome' && moduleInfo.lane === 'routing'));
  assert.ok(status.modules.some((moduleInfo) => moduleInfo.id === 'corpus' && moduleInfo.lane === 'memory'));
  assert.ok(status.links.some((link) => link.from === 'corpus' && link.to === 'rome'));
  assert.equal(status.rumbleBalls.length, 3);
  assert.equal(status.rumbleCombinations.length, 7);
  assert.equal(status.summary.rumbleReady, 7);
  assert.equal(status.recipes.length, 6);
  assert.equal(status.summary.rumbleRecipesReady, 6);
  assert.equal(status.doctor.status, 'guarded');
  assert.equal(status.doctor.summary.blocked, 0);
  assert.ok(status.recipes.some((recipe) => recipe.id === 'operation-bb' && recipe.ready));
  assert.ok(status.rumbleCombinations.some((combo) => combo.name === 'Monster Point' && combo.level === 3));
  assert.ok(status.gates.policies.some((gate) => gate.id === 'no-shell-free-for-all'));
  assert.ok(status.mcpContract.allowedWorkerIds.includes('identity-archivist-dry-run'));
  assert.ok(status.mcpContract.allowedWorkerIds.includes('westside-chopper-doctor'));
  assert.ok(status.mcpContract.allowedWorkerIds.includes('westside-chopper-assemble'));
}));

test('WestSide Chopper assemble writes JSON and Markdown artifacts', async () => {
  await withTempRuntimeAsync(async (runtimeRoot) => {
    seedRuntimeIndex(runtimeRoot);
    const result = await assembleChopper({ runtimeRoot, refreshIndex: false });

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(chopperJsonPath(runtimeRoot)), true);
    assert.equal(fs.existsSync(chopperMarkdownPath(runtimeRoot)), true);
    const written = JSON.parse(fs.readFileSync(chopperJsonPath(runtimeRoot), 'utf8'));
    assert.equal(written.id, 'westside-chopper');
    assert.equal(written.rumbleCombinations.length, 7);
    assert.equal(written.recipes.some((recipe) => recipe.id === 'operation-bb'), true);
    assert.equal(written.doctor.summary.blocked, 0);
    assert.equal(fs.readFileSync(chopperMarkdownPath(runtimeRoot), 'utf8').includes('WestSide Chopper'), true);
    assert.equal(fs.readFileSync(chopperMarkdownPath(runtimeRoot), 'utf8').includes('Rumble Recipes'), true);
  });
});
