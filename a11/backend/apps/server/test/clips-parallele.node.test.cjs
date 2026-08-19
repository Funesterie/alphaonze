'use strict';

/**
 * Generer les plans a plusieurs de front, sans perdre l'ordre.
 *
 * Le generateur imposait "une video a la fois, jamais parallele", sans que la
 * raison soit ecrite nulle part. En fullDuration un morceau de trois minutes
 * demande une vingtaine de segments, soit une attente tres longue. On borne la
 * concurrence au lieu de l'interdire.
 *
 * Deux choses doivent tenir: l'ordre des plans, dont depend l'assemblage FFmpeg
 * et que le parallele bouscule naturellement; et le traitement du refus pour
 * debit trop eleve, sans lequel paralleliser ne ferait que multiplier les plans
 * perdus.
 */

process.env.NOSSEN_CLIPS_DIR = '/tmp/clips-test-par';

const test = require('node:test');
const assert = require('node:assert/strict');

const { executerEnParallele, estLimiteDeDebit } = require('../src/clips/clip-generator-v2.cjs');

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

test('les resultats sont ranges par indice, pas par ordre d arrivee', async () => {
  // La premiere tache est la plus lente: en parallele elle finit en dernier.
  const durees = [40, 5, 5, 5];
  const taches = durees.map((d, i) => async () => { await dodo(d); return `plan-${i}`; });
  const res = await executerEnParallele(taches, 3);
  assert.deepEqual(res, ['plan-0', 'plan-1', 'plan-2', 'plan-3']);
});

test('la concurrence est respectee et jamais depassee', async () => {
  let enCours = 0;
  let pointe = 0;
  const taches = Array.from({ length: 12 }, (_, i) => async () => {
    enCours += 1;
    pointe = Math.max(pointe, enCours);
    await dodo(5);
    enCours -= 1;
    return i;
  });
  await executerEnParallele(taches, 3);
  assert.ok(pointe <= 3, `pointe observee ${pointe}, maximum autorise 3`);
  assert.ok(pointe > 1, 'le parallele ne s est pas produit');
});

test('une concurrence de 1 execute strictement en sequence', async () => {
  const ordre = [];
  const taches = Array.from({ length: 5 }, (_, i) => async () => {
    ordre.push(`debut-${i}`);
    await dodo(2);
    ordre.push(`fin-${i}`);
    return i;
  });
  await executerEnParallele(taches, 1);
  assert.deepEqual(ordre, [
    'debut-0', 'fin-0', 'debut-1', 'fin-1', 'debut-2', 'fin-2',
    'debut-3', 'fin-3', 'debut-4', 'fin-4',
  ], 'aucun chevauchement attendu avec une concurrence de 1');
});

test('toutes les taches sont executees, une seule fois chacune', async () => {
  const vues = [];
  const taches = Array.from({ length: 17 }, (_, i) => async () => { vues.push(i); return i; });
  const res = await executerEnParallele(taches, 4);
  assert.equal(res.length, 17);
  assert.deepEqual([...vues].sort((a, b) => a - b), Array.from({ length: 17 }, (_, i) => i));
  assert.equal(new Set(vues).size, 17, 'aucune tache ne doit etre executee deux fois');
});

test('un plan abandonne laisse un trou, il ne decale pas les autres', async () => {
  const taches = [
    async () => 'plan-0',
    async () => null,     // abandonne apres ses essais
    async () => 'plan-2',
  ];
  const res = await executerEnParallele(taches, 2);
  assert.deepEqual(res, ['plan-0', null, 'plan-2']);
  assert.deepEqual(res.filter(Boolean), ['plan-0', 'plan-2'], 'l ordre survit au filtrage');
});

test('une concurrence superieure au nombre de taches ne casse rien', async () => {
  const taches = [async () => 'a', async () => 'b'];
  assert.deepEqual(await executerEnParallele(taches, 10), ['a', 'b']);
  assert.deepEqual(await executerEnParallele([], 3), []);
});

test('le refus pour debit est distingue des autres pannes', async () => {
  for (const m of [
    'Submit failed: {"status":429}',
    'Rate limit exceeded',
    'rate_limit_reached',
    'Too many requests, slow down',
    'quota exceeded for this project',
  ]) {
    assert.equal(estLimiteDeDebit(m), true, `non reconnu comme debit: ${m}`);
  }
  for (const m of [
    'Submit failed: {"status":500}',
    'Timeout waiting for video 4',
    'i2v refuse',
    '',
    null,
  ]) {
    assert.equal(estLimiteDeDebit(m), false, `pris a tort pour du debit: ${m}`);
  }
});
