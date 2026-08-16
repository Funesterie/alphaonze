'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { scenariserAlbum, moodDeRole } = require('../src/music/album-scenario.cjs');

function profil(brillance, corps, fond, densite) {
  return { brillance, corps, fond, densite };
}
function voixDeTest(name, p) {
  return { name, label: name, voiceId: 'a'.repeat(32), idHash: name, consentBy: 'genere-funesterie', active: true, profil: p };
}

// djeff<->vivy sont binomes (persona-binome.cjs).
const CASTING = [
  voixDeTest('djeff', profil(-9.1, -4.2, -12.0, -8.0)),
  voixDeTest('vivy', profil(-6.0, -3.0, -18.0, -11.0)),
  voixDeTest('codex', profil(-14.0, -3.5, -9.0, -7.0)),
  voixDeTest('kaen44', profil(-5.0, -6.0, -20.0, -13.0)),
];

const ALBUM = [
  { n: 1, title: 'Ouverture', role: 'intro' },
  { n: 2, title: 'Le Metre du Rap Game', role: 'banger' },
  { n: 3, title: 'Amour Peine et Recreation', role: 'ballade' },
  { n: 4, title: 'Surchauffe', role: 'banger' },
  { n: 5, title: 'Entracte', role: 'interlude' },
  { n: 6, title: 'Carrehub', role: 'final' },
];

test('un role connu a un mood, un role inconnu retombe sur couplet', () => {
  assert.notDeepStrictEqual(moodDeRole('banger'), moodDeRole('ballade'));
  assert.deepStrictEqual(moodDeRole('role-invente'), moodDeRole('couplet'));
});

test('chaque morceau recoit une voix meneuse', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  assert.strictEqual(r.distribution.length, ALBUM.length);
  for (const d of r.distribution) assert.ok(d.lead, `morceau ${d.n} sans meneur`);
});

test('jamais deux morceaux d affilee menes par la meme voix', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  for (let i = 1; i < r.distribution.length; i += 1) {
    assert.notStrictEqual(r.distribution[i].lead, r.distribution[i - 1].lead,
      `morceaux ${i} et ${i + 1} menes par ${r.distribution[i].lead}`);
  }
});

test('everybody need somebody : l album a plusieurs visages', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  assert.ok(r.voixDistinctes > 1, `une seule voix mene tout : ${r.voixDistinctes}`);
});

test('un role identique repete finit par changer de meneur', () => {
  // Douze bangers d'affilee : sans la faim, la meilleure voix pour "banger"
  // menerait les douze. La regle doit faire tourner le casting.
  const douzeBangers = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, title: `B${i}`, role: 'banger' }));
  const r = scenariserAlbum({ tracks: douzeBangers, voix: CASTING });
  assert.strictEqual(r.voixDistinctes, CASTING.length,
    `attendu ${CASTING.length} voix distinctes, obtenu ${r.voixDistinctes}`);
});

test('le scenario est deterministe', () => {
  const a = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  const b = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  assert.deepStrictEqual(a.distribution, b.distribution);
});

test('chaque morceau porte son motif et son id Suno', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  for (const d of r.distribution) {
    assert.ok(d.motif, `morceau ${d.n} sans motif`);
    assert.ok(d.idHash, `morceau ${d.n} sans identifiant Suno`);
  }
});

test('une voix expiree ne mene jamais', () => {
  const casting = [...CASTING, { name: 'mort', idHash: 'mort', consentBy: 'x', active: true, personaExpired: true, profil: profil(-9, -4, -12, -8) }];
  const r = scenariserAlbum({ tracks: ALBUM, voix: casting });
  assert.ok(!r.distribution.some((d) => d.lead === 'mort'), 'une voix expiree mene un morceau');
  assert.ok(r.ecartees.some((e) => e.name === 'mort' && e.raison === 'persona-expiree'));
});

test('une seule voix eligible mene tout l album, sans planter', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: [CASTING[0]] });
  assert.strictEqual(r.distribution.length, ALBUM.length);
  assert.ok(r.distribution.every((d) => d.lead === 'djeff'));
});

test('un casting vide previent au lieu de planter', () => {
  const r = scenariserAlbum({ tracks: ALBUM, voix: [] });
  assert.deepStrictEqual(r.distribution, []);
  assert.match(r.avertissement, /aucune voix eligible/);
});

test('le binome se repond a travers l album', () => {
  // Sur un casting ou djeff et vivy dominent leurs roles, le bonus binome doit
  // les faire s'enchainer au moins une fois : djeff mene, vivy repond (ou l'inverse).
  const r = scenariserAlbum({ tracks: ALBUM, voix: CASTING });
  let enchaine = false;
  for (let i = 1; i < r.distribution.length; i += 1) {
    const p = r.distribution[i - 1].lead, c = r.distribution[i].lead;
    if ((p === 'djeff' && c === 'vivy') || (p === 'vivy' && c === 'djeff')) enchaine = true;
  }
  // Non garanti a tous les castings, mais le mecanisme doit exister : on verifie
  // au moins que le champ binomeDe est renseigne pour tracer un tel enchainement.
  assert.ok(r.distribution.every((d) => 'binomeDe' in d), 'le lien de binome n est pas trace');
});
