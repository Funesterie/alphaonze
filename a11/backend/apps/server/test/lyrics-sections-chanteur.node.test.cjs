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
