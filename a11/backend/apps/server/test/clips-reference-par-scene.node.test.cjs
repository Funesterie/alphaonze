'use strict';

/**
 * Une reference d'image par plan, pas une pour tout le clip.
 *
 * `referenceImageUrls` etait un tableau depuis l'origine, mais le generateur ne
 * lisait que l'indice 0, et le reutilisait pour chaque segment. Un clip mettant
 * en scene plusieurs personnages -- ou le meme a trois ages, ce que Djeff veut
 * pour la fusion -- sortait avec un seul visage sur tous les plans.
 *
 * Le repli sur l'indice 0 est conserve: un clip a un seul personnage, ou une
 * scene qui ne dit rien, doit se comporter exactement comme avant.
 */

process.env.NOSSEN_CLIPS_DIR = '/tmp/clips-test-ref';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveReferenceImage } = require('../src/clips/clip-generator-v2.cjs');

const ENFANT = 'https://cdn/djeff-enfant.png';
const ADO = 'https://cdn/djeff-ado.png';
const ZED = 'https://cdn/djeff-z.png';

const identite = {
  identityIds: ['djeff-enfant', 'djeff-ado', 'djeff-z'],
  referenceImageUrls: [ENFANT, ADO, ZED],
};

test('sans indication, la scene garde la premiere reference', () => {
  assert.equal(resolveReferenceImage(identite, { visual: 'plan large' }), ENFANT);
  assert.equal(resolveReferenceImage(identite, null), ENFANT);
});

test('une scene peut nommer son personnage', () => {
  assert.equal(resolveReferenceImage(identite, { identityId: 'djeff-enfant' }), ENFANT);
  assert.equal(resolveReferenceImage(identite, { identityId: 'djeff-ado' }), ADO);
  assert.equal(resolveReferenceImage(identite, { identityId: 'djeff-z' }), ZED);
});

test('une scene peut designer un indice', () => {
  assert.equal(resolveReferenceImage(identite, { referenceIndex: 0 }), ENFANT);
  assert.equal(resolveReferenceImage(identite, { referenceIndex: 2 }), ZED);
});

test('une scene peut porter directement son URL', () => {
  const fusion = 'https://cdn/djeff-fusion.png';
  assert.equal(resolveReferenceImage(identite, { referenceImageUrl: fusion }), fusion);
});

test('un indice hors bornes retombe sur la premiere, jamais sur rien', () => {
  // Perdre la reference ferait basculer le plan en text-to-video et changerait
  // le visage au milieu du clip: c'est pire qu'un mauvais age.
  for (const i of [3, 99, -1]) {
    assert.equal(resolveReferenceImage(identite, { referenceIndex: i }), ENFANT, `indice ${i}`);
  }
});

test('un identifiant inconnu retombe sur la premiere', () => {
  assert.equal(resolveReferenceImage(identite, { identityId: 'personne' }), ENFANT);
});

test('sans aucune reference, on ne renvoie rien et le plan passera en t2v', () => {
  assert.equal(resolveReferenceImage({ referenceImageUrls: [] }, { identityId: 'djeff-z' }), null);
  assert.equal(resolveReferenceImage({}, { referenceIndex: 1 }), null);
  assert.equal(resolveReferenceImage(null, { referenceIndex: 1 }), null);
});

test('la fusion a trois ages produit bien trois visages differents', () => {
  const plans = [
    { identityId: 'djeff-enfant' },
    { identityId: 'djeff-enfant' },
    { identityId: 'djeff-ado' },
    { identityId: 'djeff-z' },
  ];
  const choisies = plans.map((p) => resolveReferenceImage(identite, p));
  assert.deepEqual(choisies, [ENFANT, ENFANT, ADO, ZED]);
  assert.equal(new Set(choisies).size, 3, 'trois references distinctes attendues');
});
