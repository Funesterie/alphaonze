'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.NOSSEN_CLIPS_DIR = process.env.NOSSEN_CLIPS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-animate-'));

const { animateMangaClip } = require('../src/clips/clip-generator-v2.cjs');

process.env.MCP_BRIDGE_INTERNAL_KEY = process.env.MCP_BRIDGE_INTERNAL_KEY || 'test-internal-key-32-characters-minimum';

// Malcolm sur le TROISIEME chemin de rendu (23/09/2026, Djeff : "on a pensé
// à tout ?" -> non, animateMangaClip/animateOnePanel -- manga déjà généré
// qu'on anime en vidéo -- n'avait aucun branchement). Cette suite couvre le
// CABLAGE (journal, resoumission, toile, checkpoint, interrupteur), pas le
// jugement lui-même (déjà couvert par malcolm-continuity.node.test.cjs).
function writeManifest(filename, overrides = {}) {
  const manifest = {
    title: 'Mon Manga Animé',
    lieu: 'Un garage',
    identityPrompt: 'Djeff, barbe courte, tee-shirt à feuilles de palmier',
    panels: [
      { index: 0, promptId: 'panel-prompt-0', name: 'Case 1', visual: 'A precise manga panel, wide shot' },
      { index: 1, promptId: 'panel-prompt-1', name: 'Case 2', visual: 'A precise manga panel, close shot' },
    ],
    ...overrides,
  };
  fs.writeFileSync(path.join(process.env.NOSSEN_CLIPS_DIR, filename), JSON.stringify(manifest));
  return manifest;
}

function animateDeps(overrides = {}) {
  return {
    materializeMedia: async (_value, destination) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, 'media');
    },
    animatePanelImpl: async () => 'https://cloud.comfy.org/scene.mp4',
    execFileSyncImpl: (_command, args) => {
      fs.writeFileSync(args.at(-1), 'assembled');
      return Buffer.alloc(0);
    },
    ...overrides,
  };
}

test('Malcolm juge chaque scène animée à partir d\'un manga et écrit sa toile', async () => {
  writeManifest('source-coherent.panels.json');
  const judged = [];
  const deps = animateDeps({
    judgeContinuityImpl: async (payload) => {
      judged.push(payload);
      return { ok: true, planIndex: payload.planIndex, verdict: { verdict: 'coherent' } };
    },
    buildToileSvgImpl: (entries) => `<svg data-entries="${entries.length}"></svg>`,
    nowImpl: () => 800001,
    randomBytesImpl: () => Buffer.from('aa11bb22', 'hex'),
  });
  const result = await animateMangaClip({ sourcePng: '/clips/source-coherent.png' }, deps);
  assert.equal(result.kind, 'anime');
  assert.equal(result.scenes, 2);
  assert.equal(judged.length, 2, 'un jugement par scène réellement téléchargée');
  assert.equal(judged[0].castLabels[0], 'Djeff, barbe courte, tee-shirt à feuilles de palmier');
  assert.deepEqual(result.malcolm, { coherent: 2, rupture_acceptee: 0, rejete: 0, skipped: 0 });

  const clipDir = path.join(process.env.NOSSEN_CLIPS_DIR, 'clip-800001-aa11bb22');
  const toile = fs.readFileSync(path.join(clipDir, 'malcolm-toile.svg'), 'utf8');
  assert.match(toile, /data-entries="2"/);
});

test('Malcolm rejette une scène animée, un seul nouvel essai sur le MÊME promptId de planche', async () => {
  writeManifest('source-rejete.panels.json');
  const callsByIndex = new Map();
  const promptIdsSeen = new Map();
  const judgeCallsByIndex = new Map();
  const deps = animateDeps({
    animatePanelImpl: async (_prompt, panelPromptId, index) => {
      callsByIndex.set(index, (callsByIndex.get(index) || 0) + 1);
      const seen = promptIdsSeen.get(index) || [];
      seen.push(panelPromptId);
      promptIdsSeen.set(index, seen);
      return 'https://cloud.comfy.org/scene.mp4';
    },
    judgeContinuityImpl: async (payload) => {
      const n = (judgeCallsByIndex.get(payload.planIndex) || 0) + 1;
      judgeCallsByIndex.set(payload.planIndex, n);
      if (payload.planIndex === 0 && n === 1) {
        return { ok: true, planIndex: 0, verdict: { verdict: 'rejete', raison_changement: 'le décor a changé', suite_possible: 'garder le même garage' } };
      }
      return { ok: true, planIndex: payload.planIndex, verdict: { verdict: 'coherent' } };
    },
  });
  const result = await animateMangaClip({ sourcePng: '/clips/source-rejete.png' }, deps);
  assert.equal(callsByIndex.get(0), 2, 'la scène rejetée est resoumise une seule fois');
  assert.equal(callsByIndex.get(1), 1, 'une scène cohérente ne déclenche aucune resoumission');
  // La resoumission anime la MÊME planche source, pas une autre.
  assert.deepEqual(promptIdsSeen.get(0), ['panel-prompt-0', 'panel-prompt-0']);
  assert.deepEqual(result.malcolm, { coherent: 2, rupture_acceptee: 0, rejete: 0, skipped: 0 });
});

test('Malcolm désactivé n\'anime aucun jugement et n\'écrit ni toile ni checkpoint', async () => {
  writeManifest('source-desactive.panels.json');
  let judgeCalled = false;
  let checkpointCalled = false;
  const previous = process.env.NOSSEN_MALCOLM_ENABLED;
  process.env.NOSSEN_MALCOLM_ENABLED = 'false';
  try {
    const deps = animateDeps({
      judgeContinuityImpl: async () => { judgeCalled = true; return { ok: true, verdict: { verdict: 'coherent' } }; },
      writeMalcolmCheckpointImpl: async () => { checkpointCalled = true; },
      nowImpl: () => 800002,
      randomBytesImpl: () => Buffer.from('cc33dd44', 'hex'),
    });
    const result = await animateMangaClip({ sourcePng: '/clips/source-desactive.png' }, deps);
    assert.equal(judgeCalled, false);
    assert.equal(checkpointCalled, false);
    assert.equal(result.malcolm, null);
    const clipDir = path.join(process.env.NOSSEN_CLIPS_DIR, 'clip-800002-cc33dd44');
    assert.equal(fs.existsSync(path.join(clipDir, 'malcolm-toile.svg')), false);
  } finally {
    if (previous === undefined) delete process.env.NOSSEN_MALCOLM_ENABLED;
    else process.env.NOSSEN_MALCOLM_ENABLED = previous;
  }
});

test('une panne Malcolm sur une scène animée se journalise sans jamais casser l\'anime', async () => {
  writeManifest('source-en-panne.panels.json');
  const deps = animateDeps({
    judgeContinuityImpl: async () => { throw new Error('malcolm_vision_unavailable'); },
  });
  const result = await animateMangaClip({ sourcePng: '/clips/source-en-panne.png' }, deps);
  assert.equal(result.ok, true, 'une panne de Malcolm ne doit jamais faire échouer l\'anime');
  assert.equal(result.scenes, 2);
  assert.deepEqual(result.malcolm, { coherent: 0, rupture_acceptee: 0, rejete: 0, skipped: 2 });
});

test('le checkpoint Neo4j reçoit render:"manga-anime" pour ce troisième chemin', async () => {
  writeManifest('source-checkpoint.panels.json');
  const calls = [];
  const deps = animateDeps({
    judgeContinuityImpl: async (payload) => ({ ok: true, planIndex: payload.planIndex, verdict: { verdict: 'coherent' } }),
    writeMalcolmCheckpointImpl: async (checkpoint) => { calls.push(checkpoint); },
  });
  await animateMangaClip({ sourcePng: '/clips/source-checkpoint.png' }, deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].render, 'manga-anime');
  assert.equal(calls[0].title, 'Mon Manga Animé');
  assert.equal(calls[0].malcolmLog.length, 2);
});

test('un writeMalcolmCheckpointImpl qui rejette ne casse pas l\'anime', async () => {
  writeManifest('source-checkpoint-ko.panels.json');
  const deps = animateDeps({
    judgeContinuityImpl: async () => ({ ok: true, verdict: { verdict: 'coherent' } }),
    writeMalcolmCheckpointImpl: async () => { throw new Error('neo4j hors ligne'); },
  });
  const result = await animateMangaClip({ sourcePng: '/clips/source-checkpoint-ko.png' }, deps);
  assert.equal(result.ok, true);
});
