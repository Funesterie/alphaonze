'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MENTION_LEGALE,
  CATALOGUE,
  lienValide,
  listerPartenaires,
  partenairesInvalides,
} = require('../src/partners/partenaires.cjs');

test('sans variable renseignee, aucun partenaire n est servi', () => {
  // Le cas normal au demarrage: pas de lien mort, pas de lien nu qui ne
  // rapporterait a personne.
  assert.deepEqual(listerPartenaires({}), []);
});

test('un lien de suivi renseigne apparait avec sa mention de remuneration', () => {
  const liste = listerPartenaires({ A11_PARTNER_COMFY_URL: 'https://comfy.org/?via=funesterie' });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].id, 'comfy-cloud');
  assert.equal(liste[0].remunere, true);
  assert.equal(liste[0].mention, MENTION_LEGALE);
});

test('la mention nomme explicitement la remuneration', () => {
  // Un lien remunere presente comme un conseil neutre est de la fumee, et la
  // divulgation est une obligation, pas une politesse.
  assert.match(MENTION_LEGALE, /rémunéré/i);
});

test('aucune URL n est codee en dur dans le catalogue', () => {
  for (const entree of CATALOGUE) {
    assert.equal(Object.prototype.hasOwnProperty.call(entree, 'url'), false, `${entree.id} porte une URL en dur`);
    assert.match(entree.env, /^A11_PARTNER_/);
  }
});

test('un lien non https ou malforme est refuse, pas servi a moitie', () => {
  assert.equal(lienValide('http://comfy.org/?via=x'), false);
  assert.equal(lienValide('comfy.org/?via=x'), false);
  assert.equal(lienValide(''), false);
  assert.equal(lienValide('https://comfy.org/?via=x'), true);

  assert.deepEqual(listerPartenaires({ A11_PARTNER_COMFY_URL: 'comfy.org/via' }), []);
});

test('une saisie invalide est signalee au diagnostic', () => {
  const invalides = partenairesInvalides({ A11_PARTNER_SUNO_URL: 'pas une url' });
  assert.equal(invalides.length, 1);
  assert.equal(invalides[0].id, 'suno');
  assert.equal(invalides[0].env, 'A11_PARTNER_SUNO_URL');
});

test('chaque partenaire dit a quoi il sert chez nous', () => {
  // Regle 1: on ne refere que ce qu'on utilise. Le champ `usage` est ce qui
  // rend la regle verifiable par quelqu'un qui relit la liste.
  for (const entree of CATALOGUE) {
    assert.ok(String(entree.usage || '').length > 10, `${entree.id} n'explique pas son usage`);
  }
});
