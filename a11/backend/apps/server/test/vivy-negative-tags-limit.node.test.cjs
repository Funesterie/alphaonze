'use strict';

/**
 * Limite des tags negatifs Suno.
 *
 * « suno_music_api_400: The length of music negativeTags cannot exceed 500 characters ».
 * En ajoutant les negatifs « une seule voix » le 27/07, la somme des tags a depasse la
 * limite et toute la generation echouait -- une regression que j'ai introduite.
 *
 * Le nettoyeur autorisait 720 caracteres, soit plus que ce que Suno accepte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  boundVivySunoTagList,
  buildCatalogVoiceNegativeTags,
} = require('../src/routes/vivy-studio.cjs');

test('une liste courte passe sans etre touchee', () => {
  assert.equal(boundVivySunoTagList('female vocals, choir, duet', 500), 'female vocals, choir, duet');
});

test('au-dela de la limite, on retire des tags entiers', () => {
  const long = Array.from({ length: 40 }, (_, i) => `tag numero ${i} assez long`).join(', ');
  const borne = boundVivySunoTagList(long, 500);
  assert.ok(borne.length <= 500, `${borne.length} caracteres, limite 500`);
  // Aucun tag coupe en deux: chacun doit se retrouver tel quel dans l'entree.
  for (const tag of borne.split(',').map((t) => t.trim())) {
    assert.ok(long.includes(tag), `tag tronque: ${tag}`);
  }
});

test('les premiers tags sont conserves, ce sont les plus importants', () => {
  const long = `interdit absolu, ${Array.from({ length: 60 }, (_, i) => `remplissage ${i}`).join(', ')}`;
  assert.match(boundVivySunoTagList(long, 500), /^interdit absolu/);
});

test('une entree vide ne casse rien', () => {
  assert.equal(boundVivySunoTagList('', 500), '');
  assert.equal(boundVivySunoTagList(null, 500), '');
});

test('les negatifs du catalogue tiennent seuls sous la limite', () => {
  // Ils ne sont qu'une partie de l'assemblage, mais s'ils depassaient a eux seuls,
  // le bornage sacrifierait tout le reste.
  for (const genre of ['homme', 'femme', '']) {
    const tags = buildCatalogVoiceNegativeTags(genre);
    assert.ok(tags.length < 400, `genre "${genre}": ${tags.length} caracteres, trop pour laisser place au reste`);
  }
});
