'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jukebox-retire-test-'));
process.env.A11_RUNTIME_ROOT = root;
const { rememberHistoryTracks, readHistoryTracks, applyHistoryEnhancements } = require('../src/music/jukebox-history.cjs');
const { aRetirer } = require('../scripts/retire-jukebox-sans-paroles.cjs');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const piste = (nom, title, lyrics = '') => ({ title, trackUrl: `/api/vivy/studio/assets/${nom}.mp3`, createdAt: '2026-08-01T00:00:00Z', lyrics });

test('seules les pistes sans paroles au titre technique sont retenues (decision du 13/09/2026)', () => {
  assert.equal(aRetirer(piste('a', 'vivy-song-vivy-studio-handoff-4de4d93fd5.wav')), 'nom_de_fichier');
  assert.equal(aRetirer(piste('b', 'djeff-vivy-song-intro-djeff-f0a1db5ce8')), 'nom_de_fichier');
  assert.equal(aRetirer(piste('c', 'Session principale')), 'titre_generique');
  assert.equal(aRetirer(piste('d', 'Intro Chalumeau Allume Flamme')), '', 'sans paroles mais un vrai titre : gardee');
  assert.equal(aRetirer(piste('e', 'vivy-song-handoff-1234abcd.wav', 'des paroles')), '', 'avec paroles : titrable, jamais retiree');
});

test('une piste retiree disparait du jukebox, sans rien effacer, et revient quand on efface le retrait', () => {
  const dir = path.join(root, 'archive');
  rememberHistoryTracks([
    piste('garde', 'La Batte Perce le Noir', 'paroles'),
    piste('retiree', 'vivy-song-vivy-studio-handoff-4de4d93fd5.wav'),
  ], dir);
  const cle = crypto.createHash('sha256').update('/api/vivy/studio/assets/retiree.mp3').digest('hex');
  fs.mkdirSync(dir + '-retired', { recursive: true });
  const retrait = path.join(dir + '-retired', cle + '.json');
  fs.writeFileSync(retrait, JSON.stringify({ sourceTrackUrl: '/api/vivy/studio/assets/retiree.mp3', reason: 'nom_de_fichier' }));

  const visibles = applyHistoryEnhancements(readHistoryTracks(dir), dir).map((t) => t.title);
  assert.deepEqual(visibles, ['La Batte Perce le Noir']);
  assert.equal(readHistoryTracks(dir).length, 2, 'la fiche retiree reste dans l historique');

  fs.rmSync(retrait);
  fs.utimesSync(dir + '-retired', new Date(), new Date(Date.now() + 10000));
  assert.equal(applyHistoryEnhancements(readHistoryTracks(dir), dir).length, 2, 'effacer le retrait rend la piste');
});
