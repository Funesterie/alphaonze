'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { creerCadence, distance } = require(path.join(__dirname, '../src/music/vivy-vision-cadence.cjs'));

function horlogeFausse(depart = 1000000) {
  let t = depart;
  return { horloge: () => t, avancer: (ms) => { t += ms; } };
}

test('un ecran qui ne change pas ne coute rien', () => {
  // La plupart des images d'un jeu sont quasi identiques a la precedente : on
  // marche, on lit un menu, on attend. Les analyser est de l'argent jete.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge });
  assert.equal(c.doitAnalyser('aaaaaaaa').analyser, true, 'la premiere image doit passer');
  for (let i = 0; i < 30; i += 1) {
    avancer(2000);
    assert.equal(c.doitAnalyser('aaaaaaaa').analyser, false);
  }
  assert.equal(c.etat().analysees, 1);
  assert.ok(c.etat().economie > 0.9, `economie trop faible : ${c.etat().economie}`);
});

test('en combat l ecran change a chaque image — c est l intervalle qui protege', () => {
  // Le verrou qu'on oublie. Un detecteur de changement SEUL se declencherait en
  // continu, precisement au moment le plus couteux.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge, intervalleMinMs: 1200 });
  let analyses = 0;
  for (let i = 0; i < 60; i += 1) {
    avancer(100); // 60 images en 6 s, toutes differentes
    if (c.doitAnalyser(`image-${i}-${'x'.repeat(i % 5)}`.padEnd(16, 'z')).analyser) analyses += 1;
  }
  assert.ok(analyses <= 6, `l intervalle doit limiter a ~5 analyses sur 6 s, vu ${analyses}`);
  assert.ok(c.etat().ecarteesIntervalle > 40);
});

test('le budget plafonne une session longue', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge, intervalleMinMs: 100, appelsParMinute: 10 });
  let analyses = 0;
  for (let i = 0; i < 100; i += 1) {
    avancer(200);
    if (c.doitAnalyser(`differente-${i}`).analyser) analyses += 1;
  }
  // 100 images sur 20 s : le budget par minute doit mordre.
  assert.ok(analyses <= 10, `budget non respecte : ${analyses}`);
  assert.ok(c.etat().ecarteesBudget > 0);
});

test('force passe outre le changement et l intervalle, mais JAMAIS le budget', () => {
  // Un evenement dont on sait deja qu'il compte (entree en donjon, ecran de mort)
  // merite de court-circuiter les deux premiers verrous. Le budget reste le seul
  // garde-fou contre une derive, il ne se force pas.
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge, appelsParMinute: 3 });
  assert.equal(c.doitAnalyser('a'.repeat(8)).analyser, true);
  avancer(10);
  assert.equal(c.doitAnalyser('a'.repeat(8), { force: true }).analyser, true, 'force ignore intervalle et changement');
  avancer(10);
  assert.equal(c.doitAnalyser('a'.repeat(8), { force: true }).analyser, true);
  avancer(10);
  const r = c.doitAnalyser('a'.repeat(8), { force: true });
  assert.equal(r.analyser, false, 'le budget ne se force pas');
  assert.match(r.raison, /budget/);
});

test('un changement franc passe des que l intervalle est ecoule', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge, intervalleMinMs: 1000 });
  c.doitAnalyser('aaaaaaaaaaaaaaaa');
  avancer(1100);
  assert.equal(c.doitAnalyser('bbbbbbbbbbbbbbbb').analyser, true);
});

test('la distance se calcule sur des empreintes bon marche', () => {
  // Comparer deux empreintes ne doit jamais couter plus que l'appel qu'on evite.
  assert.equal(distance('abcd', 'abcd'), 0);
  assert.equal(distance('abcd', 'abce'), 0.25);
  assert.equal(distance('abcd', 'wxyz'), 1);
  assert.equal(distance([0, 0, 0], [0, 0, 0]), 0);
  assert.ok(distance([0, 0, 0], [1, 1, 1]) > 0.9);
  // Formes incompatibles : on considere que ca a change, plutot que de rater un evenement.
  assert.equal(distance('abcd', 'abcde'), 1);
  assert.equal(distance(null, 'abcd'), 1);
});

test('le compteur dit ce qu on a evite de payer', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge });
  c.doitAnalyser('stable');
  for (let i = 0; i < 9; i += 1) { avancer(2000); c.doitAnalyser('stable'); }
  const e = c.etat();
  assert.equal(e.vues, 10);
  assert.equal(e.analysees, 1);
  assert.equal(e.economie, 0.9, 'neuf appels sur dix evites');
});

test('le budget se recharge apres une minute', () => {
  const { horloge, avancer } = horlogeFausse();
  const c = creerCadence({ horloge, intervalleMinMs: 10, appelsParMinute: 2 });
  c.doitAnalyser('a1'); avancer(50); c.doitAnalyser('b2');
  avancer(50);
  assert.equal(c.doitAnalyser('c3').analyser, false);
  avancer(61000);
  assert.equal(c.doitAnalyser('d4').analyser, true);
});
