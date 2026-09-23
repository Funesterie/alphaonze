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
  // Formulation revue le 12/09 (a05698f55) : le titre garde son sujet mais ne
  // devient jamais un nom de franchise ou d'enseigne.
  assert.match(c, /titre comme nom de franchise/, 'le titre est ce qui a contamine les 26 plans');
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

// 23/09/2026 : A11 (montage) et K44 (scenario) peuvent tous deux REECRIRE
// scenes[i].visual via applyReview, exactement comme Sol et Djeff Engine — mais ne
// recevaient pas la meme contrainte. Une correction de montage ou de scenario
// pouvait donc reintroduire silencieusement ce que la consigne existe pour
// empecher. Memes fonctions dans script-director.cjs (K44 et A11 y sont auteurs
// primaires, pas relecteurs : sans la consigne des l'ecriture, rien ne les
// protege dans ce pipeline).
test('A11-montage et K44-scenario recoivent aussi la contrainte', () => {
  const source = fs.readFileSync(require.resolve('../src/clips/clip-vivy-director.cjs'), 'utf8');
  const avantA11 = source.indexOf('Tu es A11, responsable du montage. Tu relis un découpage de clip.');
  const avantK44 = source.indexOf('Tu es K44, garante du scénario et de la clarté pour le public.');
  assert.ok(avantA11 >= 0 && avantK44 >= 0, 'les deux prompts existent toujours');
  assert.ok(source.slice(avantA11, avantA11 + 400).includes('CONSIGNE_ANTI_FRANCHISE'), 'A11 montage');
  assert.ok(source.slice(avantA11, avantA11 + 400).includes('CONSIGNE_FIDELITE_CHANSON'), 'A11 montage, fidelite');
  assert.ok(source.slice(avantK44, avantK44 + 400).includes('CONSIGNE_ANTI_FRANCHISE'), 'K44 scenario');
  assert.ok(source.slice(avantK44, avantK44 + 400).includes('CONSIGNE_FIDELITE_CHANSON'), 'K44 scenario, fidelite');
});

test('le pipeline script/manga (K44 et A11 auteurs primaires) recoit la contrainte', () => {
  const source = fs.readFileSync(require.resolve('../src/clips/script-director.cjs'), 'utf8');
  const avantK44 = source.indexOf('Tu es K44, scénariste et garante de la clarté pour le public.');
  const avantA11 = source.indexOf('Tu es A11, responsable du montage et de la cohérence.');
  assert.ok(avantK44 >= 0 && avantA11 >= 0, 'les deux prompts existent toujours');
  assert.ok(source.slice(avantK44, avantK44 + 200).includes('director.CONSIGNE_ANTI_FRANCHISE'), 'K44 ecrit le scenario');
  assert.ok(source.slice(avantA11, avantA11 + 200).includes('director.CONSIGNE_ANTI_FRANCHISE'), 'A11 decoupe les plans');
});
