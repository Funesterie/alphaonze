'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('prononciation Suno : la devise de Djeff part conjuguee, le reste ne bouge pas', () => {
  const { prononcerPourSuno } = require('../src/music/suno-prononciation.cjs');
  assert.equal(prononcerPourSuno('Connecter, comprendre, créer, c\'est tout ce qu\'il reste à faire'),
    'Je connecte, je comprends, je crée, c\'est tout ce qu\'il reste à faire');
  assert.equal(prononcerPourSuno('on doit connecter comprendre et creer'), 'on doit je connecte, je comprends, je crée');
  assert.equal(prononcerPourSuno('Je veux connecter les fils'), 'Je veux connecter les fils');
  assert.equal(prononcerPourSuno(''), '');
});

test('prononciation Suno : appliquee au texte envoye, pas a la plume', () => {
  process.env.VIVY_SUNO_API_KEY = process.env.VIVY_SUNO_API_KEY || 'test-key';
  const { buildVivySunoPayload } = require('../src/routes/vivy-studio.cjs');
  const paroles = '[Verse 1]\nLe moteur tourne encore, la nuit tombe\nJe tiens la route sans un bruit\n\n[Chorus]\nConnecter, comprendre, créer\nC\'est tout ce qu\'il reste à faire\n\n[Verse 2]\nLa forge chauffe dans la nuit\nEt je garde le feu en vie\n';
  const payload = buildVivySunoPayload({ songTitle: 'Devise', songArtists: ['djeff'], cleanLyrics: paroles });
  assert.match(payload.prompt, /Je connecte, je comprends, je crée/);
  assert.doesNotMatch(payload.prompt, /Connecter, comprendre, créer/);
});
