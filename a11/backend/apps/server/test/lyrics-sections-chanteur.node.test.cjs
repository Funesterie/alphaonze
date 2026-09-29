'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const REFRAIN = 'Le moteur répond quand la ville s\'éteint\nOn trace notre chemin\nPas besoin de lumière\nC\'est nous qui tenons le son';

test('sections deduites : blocs balises par le seul chanteur (gemma4, 27/09)', () => {
  const { nommerSectionsParChanteur } = require('../src/music/lyrics-sections-chanteur.cjs');
  const brut = [
    '[Djeff]', 'Trois heures du mat\'', 'Le quartier dort',
    '[Djeff]', 'L\'huile coule sur le béton', 'La clé tourne dans ma main', 'Le piston cogne', 'Je réveille la nuit',
    '[Djeff]', REFRAIN,
    '[Djeff]', 'Les voisins rêvent encore', 'Moi je serre les boulons', 'La lampe grésille', 'Je tiens la ligne',
    '[Djeff]', REFRAIN,
    '[Djeff]', 'Un silence, une étincelle', 'Et tout repart',
    '[Djeff]', REFRAIN,
    '[Djeff]', 'Le moteur s\'éteint',
  ].join('\n');
  const sortie = nommerSectionsParChanteur(brut);
  const balises = sortie.split('\n').filter((l) => /^\[/.test(l));
  assert.deepEqual(balises, [
    '[Intro - Djeff]', '[Verse 1 - Djeff]', '[Chorus - Djeff]', '[Verse 2 - Djeff]',
    '[Chorus - Djeff]', '[Bridge - Djeff]', '[Chorus - Djeff]', '[Outro - Djeff]',
  ]);
  const { hasVivyChorusSection } = require('../src/music/vivy-songcraft.cjs');
  assert.equal(hasVivyChorusSection(sortie), true);
});

test('sections deduites : un texte qui a deja ses sections ne bouge pas', () => {
  const { nommerSectionsParChanteur } = require('../src/music/lyrics-sections-chanteur.cjs');
  const deja = '[Verse 1 - Djeff]\nUn vers\n[Chorus - Djeff]\nDeux vers\n[Djeff]\nTrois';
  assert.equal(nommerSectionsParChanteur(deja), deja);
  assert.equal(nommerSectionsParChanteur('[Djeff]\nun\n[Djeff]\ndeux'), '[Djeff]\nun\n[Djeff]\ndeux');
});

test('sections deduites : un dernier bloc court apres le refrain est une outro, pas un couplet', () => {
  const { nommerSectionsParChanteur } = require('../src/music/lyrics-sections-chanteur.cjs');
  const v = (n) => Array.from({ length: n }, (_, i) => `vers ${n}-${i} de la nuit`).join('\n');
  const brut = ['[Djeff]', v(8), '[Djeff]', REFRAIN, '[Djeff]', v(6), '[Djeff]', REFRAIN, '[Djeff]', 'Le moteur s\'arrête\nLe silence retombe\nLa ville s\'éveille'].join('\n');
  const balises = nommerSectionsParChanteur(brut).split('\n').filter((l) => /^\[/.test(l));
  assert.deepEqual(balises, ['[Verse 1 - Djeff]', '[Chorus - Djeff]', '[Verse 2 - Djeff]', '[Chorus - Djeff]', '[Outro - Djeff]']);
});

test('en-tetes entre parentheses (gemma4 avec le brief NOSSEN) : deviennent des balises', () => {
  const { nommerSectionsParChanteur } = require('../src/music/lyrics-sections-chanteur.cjs');
  const brut = ['[Djeff]', '(Intro)', 'Trois heures', '(Couplet 1)', 'vers un', 'vers deux', '(Pré-refrain)', 'ça monte',
    '(Refrain)', 'le moteur répond', '(Pont)', 'le silence', '(Montée finale)', 'encore', '(Refrain)', 'le moteur répond',
    '(Outro)', 'fin', '(Bruit de clé à choc qui s\'arrête net)'].join('\n');
  const balises = nommerSectionsParChanteur(brut).split('\n').filter((l) => /^\[/.test(l));
  assert.deepEqual(balises, ['[Intro - Djeff]', '[Verse 1 - Djeff]', '[Pre-Chorus - Djeff]', '[Chorus - Djeff]', '[Bridge - Djeff]', '[Pre-Chorus - Djeff]', '[Chorus - Djeff]', '[Outro - Djeff]']);
  assert.match(nommerSectionsParChanteur(brut), /\(Bruit de clé à choc qui s'arrête net\)/);
  assert.equal(nommerSectionsParChanteur('Moi j\'note mentalement:\nun vers'), 'Moi j\'note mentalement:\nun vers');
});

test('fautes de frappe dans un nom de section : (Refrance), [Coupelt 2] deviennent des balises', () => {
  const { nommerSectionsParChanteur } = require('../src/music/lyrics-sections-chanteur.cjs');
  const brut = ['[Verse 1]', 'un vers', '(Refrance)', 'le refrain', '[Coupelt 2]', 'un autre vers', '[Refrain]', 'le refrain', '(Intro - Drone grave, pulsations lentes)', '[Djeff]', '(Bruit de clé à choc)'].join('\n');
  const sortie = nommerSectionsParChanteur(brut).split('\n');
  assert.ok(sortie.some((l) => /^\[Chorus( - Djeff)?\]$/.test(l)), sortie.join(' | '));
  assert.ok(sortie.some((l) => /^\[Verse 2( - Djeff)?\]$/.test(l)), sortie.join(' | '));
  assert.ok(sortie.includes('[Refrain]'), 'un nom juste entre crochets ne bouge pas');
  assert.ok(sortie.includes('(Intro - Drone grave, pulsations lentes)'), 'une indication sonore ne bouge pas');
  assert.ok(sortie.includes('(Bruit de clé à choc)'));
  assert.ok(!sortie.some((l) => /refrance|coupelt/i.test(l)));
});
