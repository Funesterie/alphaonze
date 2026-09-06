'use strict';

const test = require('node:test');
const assert = require('node:assert');

const dj = require('../src/music/auto-dj.cjs');

/** Profil vocal type, dans l'unite de verifier-voix-persona.cjs (dB relatifs). */
function profil(brillance, corps, fond, densite) {
  return { brillance, corps, fond, densite };
}

function voixDeTest(name, p, extra = {}) {
  return {
    name,
    label: name,
    voiceId: 'a'.repeat(32),
    consentBy: 'genere-funesterie',
    active: true,
    profil: p,
    ...extra,
  };
}

const SECTIONS = [
  { startSeconds: 0, endSeconds: 30, label: 'intro', energy: 0.2, medium: 0.3, grave: 0.5, aigu: 0.2 },
  { startSeconds: 30, endSeconds: 60, label: 'couplet', energy: 0.6, medium: 0.7, grave: 0.4, aigu: 0.4 },
  { startSeconds: 60, endSeconds: 95, label: 'refrain', energy: 0.9, medium: 0.8, grave: 0.7, aigu: 0.8 },
  { startSeconds: 95, endSeconds: 130, label: 'pont', energy: 0.4, medium: 0.5, grave: 0.3, aigu: 0.6 },
];

const CASTING = [
  voixDeTest('djeff', profil(-9.1, -4.2, -12.0, -8.0)),
  voixDeTest('vivy', profil(-6.0, -3.0, -18.0, -11.0)),
  voixDeTest('codex', profil(-14.0, -3.5, -9.0, -7.0)),
  voixDeTest('kaen44', profil(-5.0, -6.0, -20.0, -13.0)),
];

test('un quaternion produit est unitaire', () => {
  const q = dj.quaternionDeSection(SECTIONS[2]);
  assert.ok(Math.abs(Math.hypot(q.w, q.x, q.y, q.z) - 1) < 1e-9);
});

test('quatre zeros donnent l identite, pas NaN', () => {
  const q = dj.quaternionDeSection({ energy: 0, medium: 0, grave: 0, aigu: 0 });
  assert.deepStrictEqual(q, { w: 1, x: 0, y: 0, z: 0 });
});

test('la rotation conserve la norme', () => {
  const q = dj.quaternionDeSection(SECTIONS[1]);
  const u = dj.rotationDeSection(2, 5);
  const r = dj.rotation(q, u);
  assert.ok(Math.abs(Math.hypot(r.w, r.x, r.y, r.z) - 1) < 1e-9);
});

// Tolerance 1e-7 et pas 1e-9 : la derivee d'acos diverge en 1, donc une distance
// nulle ressort autour de 5e-9 au lieu de 0. C'est une propriete d'acos, pas un
// defaut du module — et c'est sans effet sur le classement, dont les marges se
// jouent a 1e-4.
const PRECISION_ACOS = 1e-7;

test('une voix est a distance nulle d elle-meme', () => {
  const q = dj.quaternionDeVoix(CASTING[0].profil);
  assert.ok(dj.distance(q, q) < PRECISION_ACOS);
});

test('q et -q designent la meme voix', () => {
  const q = dj.quaternionDeVoix(CASTING[0].profil);
  const oppose = { w: -q.w, x: -q.x, y: -q.y, z: -q.z };
  assert.ok(dj.distance(q, oppose) < PRECISION_ACOS);
});

test('une persona expiree est ecartee', () => {
  const v = voixDeTest('mort', profil(-9, -4, -12, -8), { personaExpired: true });
  assert.strictEqual(dj.estEligible(v).ok, false);
  assert.strictEqual(dj.estEligible(v).raison, 'persona-expiree');
});

test('une voix sans consentement est ecartee', () => {
  const v = voixDeTest('anonyme', profil(-9, -4, -12, -8), { consentBy: '' });
  assert.strictEqual(dj.estEligible(v).ok, false);
  assert.strictEqual(dj.estEligible(v).raison, 'consentement-absent');
});

test('une intention de voix sans id Suno est ecartee', () => {
  const v = voixDeTest('gemini', profil(-9, -4, -12, -8), { voiceId: '', idHash: '' });
  assert.strictEqual(dj.estEligible(v).ok, false);
  assert.strictEqual(dj.estEligible(v).raison, 'aucun-id-suno');
});

test('jamais deux sections d affilee par la meme voix', () => {
  const r = dj.choisirVoix({ sections: SECTIONS, voix: CASTING });
  for (let i = 1; i < r.choix.length; i += 1) {
    assert.notStrictEqual(r.choix[i].voix, r.choix[i - 1].voix,
      `section ${i} reprend ${r.choix[i].voix}`);
  }
});

test('everybody need somebody : plusieurs voix chantent', () => {
  const r = dj.choisirVoix({ sections: SECTIONS, voix: CASTING });
  assert.ok(r.voixDistinctes > 1, `une seule voix a chante : ${r.voixDistinctes}`);
});

test('sur un morceau homogene, la faim finit par sortir tout le casting', () => {
  // Toutes les sections identiques : sans la faim et sans la rotation, la
  // meilleure voix prendrait tout. C'est le cas qui a motive les deux regles.
  const plates = Array.from({ length: 12 }, (_, i) => ({
    startSeconds: i * 10, endSeconds: (i + 1) * 10,
    energy: 0.5, medium: 0.5, grave: 0.5, aigu: 0.5,
  }));
  const r = dj.choisirVoix({ sections: plates, voix: CASTING });
  assert.strictEqual(r.voixDistinctes, CASTING.length,
    `attendu ${CASTING.length} voix, obtenu ${r.voixDistinctes}`);
});

test('une voix absente du bus est retrogradee, pas exclue', () => {
  // Personne n'est present sauf une seule voix : les autres doivent quand meme
  // chanter, sinon un bus en panne ferait taire tout le casting.
  const r = dj.choisirVoix({ sections: SECTIONS, voix: CASTING, presents: ['djeff'] });
  const noms = new Set(r.choix.map((c) => c.voix));
  assert.ok(noms.size > 1, 'seule la voix presente a chante');
  assert.ok(r.choix.some((c) => c.absente), 'aucune voix absente n a ete retenue');
});

test('une seule voix eligible chante quand meme toutes les sections', () => {
  const r = dj.choisirVoix({ sections: SECTIONS, voix: [CASTING[0]] });
  assert.strictEqual(r.choix.length, SECTIONS.length);
  assert.ok(r.choix.every((c) => c.voix === 'djeff'));
});

test('un catalogue vide previent au lieu de planter', () => {
  const r = dj.choisirVoix({ sections: SECTIONS, voix: [] });
  assert.deepStrictEqual(r.choix, []);
  assert.match(r.avertissement, /aucune voix eligible/);
});

test('le choix est deterministe', () => {
  const a = dj.choisirVoix({ sections: SECTIONS, voix: CASTING });
  const b = dj.choisirVoix({ sections: SECTIONS, voix: CASTING });
  assert.deepStrictEqual(a.choix, b.choix);
});
