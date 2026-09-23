'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CATEGORY_BY_VERDICT,
  buildCheckpointNotes,
  resolveMalcolmNeo4jConfig,
  writeMalcolmCheckpoint,
} = require('../src/clips/malcolm-checkpoints.cjs');

function coherentEntry(planIndex) {
  return { planIndex, planName: `Plan ${planIndex}`, skipped: false, verdict: { verdict: 'coherent', personnages: [], vehicules: [], autres_incoherences: [] } };
}

test('un plan cohérent ne produit aucune note de terrain', () => {
  const notes = buildCheckpointNotes([coherentEntry(0), coherentEntry(1)]);
  assert.deepEqual(notes, []);
});

test('une entrée sautée (skipped) ne produit aucune note', () => {
  const notes = buildCheckpointNotes([{ planIndex: 0, planName: 'Plan', skipped: true, reason: 'malcolm_error', verdict: null }]);
  assert.deepEqual(notes, []);
});

test('un personnage incohérent devient une note "à éviter"', () => {
  const notes = buildCheckpointNotes([{
    planIndex: 2,
    planName: 'Plan 3',
    skipped: false,
    verdict: {
      verdict: 'rejete',
      personnages: [{ nom: 'Djeff', coherent: false, details: 'la veste a changé de couleur' }],
      vehicules: [],
      autres_incoherences: [],
      raison_changement: 'derive de rendu',
      suite_possible: 'reprendre la reference precedente',
    },
  }]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].category, 'a_eviter');
  assert.equal(notes[0].entityType, 'personnage');
  assert.equal(notes[0].entityName, 'Djeff');
  assert.match(notes[0].conseil, /veste a changé de couleur/);
  assert.equal(notes[0].planIndex, 2);
});

test('un véhicule incohérent devient sa propre note, séparée du personnage', () => {
  const notes = buildCheckpointNotes([{
    planIndex: 5,
    planName: 'Plan 6',
    skipped: false,
    verdict: {
      verdict: 'rejete',
      personnages: [{ nom: 'Djeff', coherent: true, details: 'ok' }],
      vehicules: [{ nom: 'Beta RR 50', coherent: false, details: 'rétroviseur droit disparu' }],
      autres_incoherences: [],
    },
  }]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].category, 'a_eviter');
  assert.equal(notes[0].entityType, 'vehicule');
  assert.equal(notes[0].entityName, 'Beta RR 50');
  assert.match(notes[0].conseil, /rétroviseur droit disparu/);
});

test('une rupture acceptée sans entité en cause devient une note "à améliorer" sur le plan', () => {
  const notes = buildCheckpointNotes([{
    planIndex: 4,
    planName: 'Bridge',
    skipped: false,
    verdict: {
      verdict: 'rupture_acceptee',
      personnages: [],
      vehicules: [],
      autres_incoherences: [],
      raison_changement: 'montée d\'intensité voulue par le morceau',
      suite_possible: 'garder le même cadrage au plan suivant pour ancrer la transition',
    },
  }]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].category, 'a_ameliorer');
  assert.equal(notes[0].entityType, 'plan');
  assert.equal(notes[0].entityName, '');
  assert.match(notes[0].conseil, /montée d'intensité voulue/);
  assert.match(notes[0].conseil, /garder le même cadrage/);
});

test('CATEGORY_BY_VERDICT ne couvre que les deux verdicts problématiques', () => {
  assert.deepEqual(CATEGORY_BY_VERDICT, { rejete: 'a_eviter', rupture_acceptee: 'a_ameliorer' });
});

// 23/09/2026 : premier vrai smoke test en prod, tombé sur "Graph not found:
// aa4680d2" — resolveRouterConfig() traite un NEO4J_URI non-loopback (le cas
// réel en prod, bolt://a11-neo4j:7687, un Neo4j auto-hébergé) comme "aura" et
// retombe sur un ID d'instance Aura morte comme nom de base par défaut.
test('resolveMalcolmNeo4jConfig force la base "neo4j" plutôt que la vieille instance Aura morte', () => {
  const config = resolveMalcolmNeo4jConfig({
    NEO4J_URI: 'bolt://a11-neo4j:7687',
    NEO4J_USER: 'neo4j',
    NEO4J_PASSWORD: 'prod-secret',
  });
  assert.equal(config.aura.database, 'neo4j');
  assert.notEqual(config.aura.database, 'aa4680d2');
});

test('resolveMalcolmNeo4jConfig respecte NEO4J_DATABASE quand il est fourni explicitement', () => {
  const config = resolveMalcolmNeo4jConfig({
    NEO4J_URI: 'neo4j+s://real-instance.databases.neo4j.io',
    NEO4J_USER: 'user',
    NEO4J_PASSWORD: 'pass',
    NEO4J_DATABASE: 'ma-vraie-base',
  });
  assert.equal(config.aura.database, 'ma-vraie-base');
});

test('writeMalcolmCheckpoint écrit un checkpoint et ses notes via runWriteImpl', async () => {
  const calls = [];
  const result = await writeMalcolmCheckpoint({
    clipId: 'clip-test-1',
    title: 'Mon Clip',
    render: 'video',
    malcolmLog: [{
      planIndex: 0,
      planName: 'Plan 1',
      skipped: false,
      verdict: { verdict: 'rejete', personnages: [{ nom: 'Djeff', coherent: false, details: 'barbe disparue' }], vehicules: [], autres_incoherences: [] },
    }],
    malcolmSummary: { coherent: 0, rupture_acceptee: 0, rejete: 1, skipped: 0 },
  }, {
    runWriteImpl: async (cypher, params) => { calls.push({ cypher, params }); return { ok: true }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.notes, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].cypher, /MERGE \(c:MalcolmCheckpoint/);
  assert.match(calls[0].cypher, /UNWIND \$notes AS note/);
  assert.equal(calls[0].params.checkpointId, 'malcolm-checkpoint:clip-test-1');
  assert.equal(calls[0].params.checkpoint.clipId, 'clip-test-1');
  assert.equal(calls[0].params.checkpoint.rejete, 1);
  assert.equal(calls[0].params.checkpoint.noteCount, 1);
  assert.equal(calls[0].params.notes.length, 1);
  assert.equal(calls[0].params.notes[0].category, 'a_eviter');
  assert.equal(calls[0].params.notes[0].clipId, 'clip-test-1');
});

test('un clip entièrement cohérent écrit quand même le checkpoint, sans note', async () => {
  const calls = [];
  const result = await writeMalcolmCheckpoint({
    clipId: 'clip-test-2',
    title: 'Clip propre',
    malcolmLog: [coherentEntry(0), coherentEntry(1)],
    malcolmSummary: { coherent: 2, rupture_acceptee: 0, rejete: 0, skipped: 0 },
  }, {
    runWriteImpl: async (cypher, params) => { calls.push(params); return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.notes, 0);
  assert.deepEqual(calls[0].notes, []);
  assert.equal(calls[0].checkpoint.noteCount, 0);
});

test('Neo4j indisponible ne fait jamais échouer writeMalcolmCheckpoint', async () => {
  const result = await writeMalcolmCheckpoint({
    clipId: 'clip-test-3',
    malcolmLog: [coherentEntry(0)],
  }, {
    runWriteImpl: async () => { throw new Error('ECONNREFUSED neo4j://aura'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('une écriture qui tient dans le délai réussit normalement', async () => {
  const result = await writeMalcolmCheckpoint({
    clipId: 'clip-test-4',
    malcolmLog: [coherentEntry(0)],
  }, {
    runWriteImpl: () => new Promise((resolve) => setTimeout(resolve, 20)),
    env: { NOSSEN_MALCOLM_CHECKPOINT_TIMEOUT_MS: '2000' },
  });
  assert.equal(result.ok, true);
});

test('un délai plus court que l\'écriture réelle déclenche le repli sans jamais lever', async () => {
  const result = await writeMalcolmCheckpoint({
    clipId: 'clip-test-6',
    malcolmLog: [coherentEntry(0)],
  }, {
    runWriteImpl: () => new Promise((resolve) => setTimeout(resolve, 300)),
    env: { NOSSEN_MALCOLM_CHECKPOINT_TIMEOUT_MS: '50' },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /malcolm_checkpoint_timeout/);
});
