'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { CONSIGNE_ANTI_FRANCHISE } = require('../src/clips/clip-vivy-director.cjs');

// Le fournisseur video refuse le rendu APRES generation quand il ressemble a une
// oeuvre protegee: le calcul est consomme, le segment perdu. Constate deux fois
// le 09/09/2026 sur "FIGHTERZ CLUB", ou Sol avait fabrique le lieu "underground
// fight club" a partir du titre. Reecrire le style ne corrigeait rien.
test('la consigne interdit les quatre sources de rejet constatees', () => {
  const c = CONSIGNE_ANTI_FRANCHISE.toLowerCase();
  assert.match(c, /mots du titre/, 'le titre est ce qui a contamine les 26 plans');
  assert.match(c, /film|jeu|serie|marque/, 'les franchises');
  assert.match(c, /logo|texte lisible/, 'le texte a l ecran');
  assert.match(c, /personnage connu/, 'les costumes identifiables');
});

test('la consigne se termine par une separation, elle ne colle pas au bloc suivant', () => {
  assert.ok(CONSIGNE_ANTI_FRANCHISE.endsWith('\n\n'), 'sinon elle se fond dans la consigne suivante');
});

// Sol ecrit les plans, Djeff Engine les REECRIT juste apres. Une contrainte posee
// au seul premier serait defaite par le second.
test('les deux etapes qui ecrivent des plans recoivent la contrainte', () => {
  const source = fs.readFileSync(require.resolve('../src/clips/clip-vivy-director.cjs'), 'utf8');
  const usages = source.split('CONSIGNE_ANTI_FRANCHISE').length - 1;
  assert.ok(usages >= 4, 'definition + Sol + Djeff Engine + export, trouve ' + usages);
  const avantSol = source.indexOf('Tu es chef opérateur');
  const avantDjeff = source.indexOf('RÈGLES DJEFF');
  assert.ok(source.slice(avantSol, avantSol + 400).includes('CONSIGNE_ANTI_FRANCHISE'), 'Sol');
  assert.ok(source.slice(avantDjeff - 400, avantDjeff).includes('CONSIGNE_ANTI_FRANCHISE'), 'Djeff Engine');
});
