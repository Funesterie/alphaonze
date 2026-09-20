'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FICHES,
  normalizeCharacterId,
  renderCharacterSheet,
  condenseCharacterForShot,
} = require('../src/vivy/character-sheets.cjs');
const { IDENTITY_DEFINITIONS } = require('../src/vivy/visual-identities.cjs');
const { NOSSEN_SCENARIO_BIBLE } = require('../src/persona/nossen-scenario-bible.cjs');

// Elio et Lena sont des ENFANTS REELS de la famille de Djeff (20/09/2026). Leur
// identite visuelle ne porte donc aucune photo de reference, contrairement aux
// adultes du registre : la chaine image ne doit pas chercher leur ressemblance.
test('aucune photo de reference pour les enfants', () => {
  for (const id of ['elio', 'lena']) {
    const definition = IDENTITY_DEFINITIONS.find((d) => d.id === id);
    assert.ok(definition, `${id}: identite visuelle absente`);
    assert.equal(definition.envRefs, undefined, `${id}: envRefs interdit`);
    assert.equal(definition.defaultRefs, undefined, `${id}: defaultRefs interdit`);
  }
});

test('leur age est verrouille dans les deux sens : texte et derives interdites', () => {
  const elio = IDENTITY_DEFINITIONS.find((d) => d.id === 'elio');
  const lena = IDENTITY_DEFINITIONS.find((d) => d.id === 'lena');
  assert.match(elio.videoPrompt, /7-year-old boy/);
  assert.match(lena.videoPrompt, /3-year-old girl/);
  for (const definition of [elio, lena]) {
    const interdits = definition.negative.join(' ').toLowerCase();
    for (const mot of ['teenage', 'adult', 'aged-up', 'revealing']) {
      assert.ok(interdits.includes(mot), `${definition.id}: « ${mot} » doit rester interdit`);
    }
    assert.match(definition.videoPrompt, /child proportions|toddler proportions/);
  }
});

test('les fiches se rendent et repondent aux noms accentues', () => {
  assert.equal(normalizeCharacterId('Léna'), 'lena');
  assert.equal(normalizeCharacterId('ELIO'), 'elio');
  assert.equal(FICHES.elio.nom, 'Elio');
  const fiche = renderCharacterSheet('lena');
  assert.match(fiche, /petite s(?:œ|oe)ur d’Elio/);
  assert.match(fiche, /Non fixé, ne pas inventer/);
  assert.match(condenseCharacterForShot('elio'), /Elio, a 7-year-old boy/);
});

test('K44 recoit Elio et Lena dans la bible NOSSEN', () => {
  for (const attendu of ['Elio, 7 ans', 'Lena, 3 ans', 'morphologie d\'enfant']) {
    assert.ok(NOSSEN_SCENARIO_BIBLE.includes(attendu), `manque dans la bible : ${attendu}`);
  }
});
