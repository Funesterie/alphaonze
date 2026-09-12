'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Djeff, 12/09/2026 : « pas un vieux gpt-4o, on court a la catastrophe ». Il en
// restait deux en prod : Sol, fige par le script de deploiement, et A11, fige
// dans le code du Director. Ce test empeche le retour silencieux de l un ou
// l autre par defaut.
delete process.env.NOSSEN_SEQUENCE_MODEL;
delete process.env.NOSSEN_MONTAGE_MODEL;
const { SEQUENCE_MODEL, MONTAGE_MODEL } = require('../src/clips/clip-vivy-director.cjs');

test('aucun role du Director ne retombe sur gpt-4o par defaut', () => {
  for (const [role, modele] of [['Sol', SEQUENCE_MODEL], ['A11', MONTAGE_MODEL]]) {
    assert.doesNotMatch(String(modele), /gpt-4o/i, role + ' est retombe sur ' + modele);
  }
});

test('les modeles choisis par Djeff sont ceux qui s appliquent', () => {
  assert.equal(SEQUENCE_MODEL, 'gpt-6-astra');
  assert.equal(MONTAGE_MODEL, 'gpt-5.6-terra');
});

test('le relecteur du montage ne partage pas le cerveau de l auteur', () => {
  assert.notEqual(MONTAGE_MODEL, SEQUENCE_MODEL);
});
