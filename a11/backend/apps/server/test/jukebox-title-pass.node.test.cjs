'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { titreGenerique, choisirGroupes, clePiste, SEUIL_DOUBLONS } = require('../src/music/jukebox-title-pass.cjs');

test('les titres par defaut et les bouts de consigne sont reperes, pas les vrais titres', () => {
  // Cas reels de l'inventaire du 13/09/2026.
  for (const t of ['Session principale', 'Titre non retrouvé', '', 'Title Suis Vivy Verse', 'Couplet Vivy',
    'Oui je voudrais faire un son pour la psychiatrie où je suis actuelleme',
    'FIGHTERZ CLUB Sous-sol beton, un neon qui grelotte Deux types se regar',
    'Plus vivant que jamais, banger dance-pop électro. Quelqu’un sort d’une']) {
    assert.ok(titreGenerique(t), `aurait du etre repere : ${t}`);
  }
  for (const t of ['La Batte Perce le Noir', 'De la joie, de l’aventure et de l’amour', 'Bon Contact / Danger Constant',
    'Essence Pure Éclat', 'Cette voix est la mienne', 'Jessy Tient Debout',
    // Ecartes a tort par la premiere passe du 13/09 (regles « fais » et « oui »).
    'Fais vibrer la lumière', 'Oui Tu Lui as Répondu']) {
    assert.equal(titreGenerique(t), '', `vrai titre pris pour du generique : ${t}`);
  }
});

function piste(id, title, lyrics, extra = {}) {
  return { trackUrl: `/api/vivy/studio/assets/${id}.mp3`, title, lyrics, available: true, ...extra };
}

test('une chanson = un groupe (memes paroles), les versions en double se titrent ensemble', () => {
  const { groupes, sansParoles, raisons } = choisirGroupes([
    piste('a1', 'Session principale', 'paroles A'),
    piste('a2', 'Session principale', 'paroles A'),            // autre version, memes paroles
    piste('b', 'Session principale', 'paroles B'),
    piste('c', 'Session principale', ''),                        // pas de paroles : impossible a titrer
    piste('d', 'La Batte Perce le Noir', 'paroles D'),
  ]);
  assert.equal(groupes.length, 2);
  assert.equal(groupes.find((g) => g.paroles === 'paroles A').pistes.length, 2);
  assert.equal(sansParoles, 1);
  assert.equal(raisons.generique, 3);
});

test('un meme titre sur plusieurs chansons differentes devient un titre a refaire', () => {
  const pistes = Array.from({ length: SEUIL_DOUBLONS }, (_, i) => piste(`s${i}`, 'Signal Funesterie', `paroles ${i}`));
  pistes.push(piste('v1', 'Cosmos du matin', 'meme chanson'), piste('v2', 'Cosmos du matin', 'meme chanson'));
  const { groupes } = choisirGroupes(pistes);
  assert.equal(groupes.length, SEUIL_DOUBLONS, 'Signal Funesterie : une par chanson ; Cosmos : une seule chanson, garde son titre');
  assert.ok(groupes.every((g) => g.raison === 'doublon'));
});

test('une piste deja titree par Claude, masterisee ou non, n est jamais repayee', () => {
  const master = piste('m', 'Session principale', 'paroles M', { originalTrackUrl: '/api/vivy/studio/assets/original-m.mp3', trackUrl: '/api/vivy/studio/assets/m-v11pan.mp3' });
  const deja = new Set([clePiste(master)]);
  assert.equal(choisirGroupes([master], deja).groupes.length, 0);
  assert.equal(clePiste(master), clePiste({ trackUrl: '/api/vivy/studio/assets/original-m.mp3' }), 'la cle suit l URL source, pas le master');
  assert.equal(choisirGroupes([{ ...master, available: false }]).groupes.length, 0, 'une piste indisponible est ignoree');
});
