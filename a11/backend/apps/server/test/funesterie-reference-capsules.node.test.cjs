'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildReferenceCapsuleContext,
  inferReferenceTraits,
  loadReferenceCapsuleState,
} = require('../src/chat/funesterie-reference-capsules.cjs');
const {
  buildAgentsPersonaContext,
  resetDjeffPersonaCache,
} = require('../src/persona/persona-engine.cjs');

function withTempRefRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-ref-capsules-'));
  try {
    fs.mkdirSync(path.join(root, 'ref-pool'), { recursive: true });
    fs.mkdirSync(path.join(root, 'detente-humour'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ref-quota-config.json'), JSON.stringify({
      dailyQuota: 12,
      pickBatch: 3,
      maxStored: 600,
    }, null, 2));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      active: true,
      familyDirective: 'Bibliothèque détente/humour: utiliser le timing et la ténacité, jamais la copie.',
    }, null, 2));
    fs.writeFileSync(path.join(root, 'ref-pool', 'daily-2026-07-08.json'), JSON.stringify({
      day: '2026-07-08',
      dailyQuota: 12,
      available: 10,
      refs: [
        {
          id: 'tpb-sub-s01e01-en-0',
          source: 'trailer-park-boys',
          title: 'Dialogue s01e01 (en)',
          body: 'Put your gun away, there are people everywhere.',
          tags: ['tpb', 'subtitle', 'dialogue'],
          status: 'available',
        },
        {
          id: 'tpb-sub-s12e09-fr-1',
          source: 'trailer-park-boys',
          title: 'Dialogue s12e09 (fr)',
          body: "Je suis entre le marteau et l'enclume, mais je n'abandonne pas mon commerce de bière.",
          tags: ['tpb', 'subtitle', 'dialogue'],
          status: 'picked',
        },
      ],
    }, null, 2));
    fs.writeFileSync(path.join(root, 'stored-refs.jsonl'), [
      JSON.stringify({
        id: 'stored-one',
        source: 'funesterie',
        title: 'Inspirer pas plagier',
        body: 'Réutiliser la mécanique comique, pas les dialogues.',
        tags: ['ethique', 'creation'],
      }),
    ].join('\n'));
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Funesterie reference capsules summarize script refs without leaking raw dialogue', () => withTempRefRoot((root) => {
  const env = { ...process.env, FUNESTERIE_REFERENCE_ROOT: root };
  const state = loadReferenceCapsuleState(env);
  const context = buildReferenceCapsuleContext(env);

  assert.equal(state.ok, true);
  assert.equal(state.quota.dailyQuota, 12);
  assert.equal(state.quota.pickBatch, 3);
  assert.match(context, /Funesterie reference capsules/i);
  assert.match(context, /quota 3\/12/i);
  assert.match(context, /répartie sèche|repartie seche/i);
  assert.match(context, /petite combine|objet trivial|autorité ridicule|inspiration sans copie/i);
  assert.doesNotMatch(context, /Put your gun away/i);
  assert.doesNotMatch(context, /marteau et l'enclume/i);
  assert.doesNotMatch(context, /commerce de bière/i);
}));

test('Funesterie reference capsules are injected into persona context as abstract refs', () => withTempRefRoot((root) => {
  const env = {
    ...process.env,
    FUNESTERIE_REFERENCE_ROOT: root,
    A11_PERSONA_DOCS_DIR: path.join(root, 'empty-docs'),
  };
  fs.mkdirSync(env.A11_PERSONA_DOCS_DIR, { recursive: true });
  resetDjeffPersonaCache();
  const context = buildAgentsPersonaContext(env, { force: true });

  assert.match(context, /RÉFÉRENCES FUNESTERIE|REFERENCES FUNESTERIE/i);
  assert.match(context, /capsules abstraites/i);
  assert.doesNotMatch(context, /Put your gun away/i);
  assert.doesNotMatch(context, /commerce de bière/i);
}));

test('reference trait inference maps raw lines to reusable abstract mechanics', () => {
  const traits = inferReferenceTraits({
    source: 'trailer-park-boys',
    body: 'the dream is real and the money starts tomorrow',
    tags: ['tpb'],
  });

  assert.ok(traits.includes('rêve absurde transformé en plan concret'));
  assert.ok(traits.includes('petite combine traitée comme grand business'));
});
