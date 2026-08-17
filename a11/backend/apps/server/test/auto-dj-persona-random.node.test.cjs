'use strict';

// Mode random + persona-only de l'auto-DJ (demande de Djeff : « le mode random auto
// dj pour les persona, ou encore mieux on garde que les personas »). Non destructif :
// les anciennes voix sont ecartees du CHOIX, jamais du catalogue.

const test = require('node:test');
const assert = require('node:assert');

const { choisirVoix, estPersona, prngDepuis } = require('../src/music/auto-dj.cjs');

function voix(name, extra = {}) {
  return { name, label: name, voiceId: 'a'.repeat(32), idHash: name, consentBy: 'genere-funesterie', active: true, profil: { brillance: -8, corps: -4, fond: -12, densite: -8 }, ...extra };
}
function sections(n) {
  return Array.from({ length: n }, (_, i) => ({ label: `S${i}`, energy: 0.5, medium: 0.5, grave: 0.5, aigu: 0.5, startSeconds: i * 10, endSeconds: i * 10 + 10 }));
}

// Cast : 3 personas + 2 anciennes voix d'echantillon (hors cast).
const CASTING = [
  voix('djeff'), voix('vivy'), voix('marvin'),
  voix('sample-42'), voix('vieille-demo'),
];

test('estPersona distingue le cast des anciennes voix', () => {
  assert.ok(estPersona(voix('djeff')));
  assert.ok(estPersona(voix('Vivy')));
  assert.ok(estPersona({ name: 'x', aliases: ['kaen44'] }));
  assert.ok(!estPersona(voix('sample-42')));
  assert.ok(!estPersona(voix('vieille-demo')));
});

test('personasSeulement : aucune ancienne voix ne chante, et rien n est supprime', () => {
  const r = choisirVoix({ sections: sections(6), voix: CASTING, personasSeulement: true });
  const chantees = new Set(r.choix.map((c) => c.voix));
  assert.ok(!chantees.has('sample-42') && !chantees.has('vieille-demo'), 'une ancienne voix a chante');
  for (const c of r.choix) assert.ok(['djeff', 'vivy', 'marvin'].includes(c.voix));
  // Les ecartees tracent la raison sans que le catalogue d'entree soit modifie.
  assert.ok(r.ecartees.some((e) => e.raison === 'voix-hors-persona'));
  assert.strictEqual(CASTING.length, 5, 'le catalogue d entree ne doit pas etre mute');
});

test('mode aleatoire : rejouable a graine egale, different a graine differente', () => {
  const a = choisirVoix({ sections: sections(8), voix: CASTING, mode: 'aleatoire', graine: 'round-1', personasSeulement: true });
  const b = choisirVoix({ sections: sections(8), voix: CASTING, mode: 'aleatoire', graine: 'round-1', personasSeulement: true });
  const c = choisirVoix({ sections: sections(8), voix: CASTING, mode: 'aleatoire', graine: 'round-2', personasSeulement: true });
  assert.deepStrictEqual(a.choix.map((x) => x.voix), b.choix.map((x) => x.voix), 'meme graine, meme suite');
  assert.notDeepStrictEqual(a.choix.map((x) => x.voix), c.choix.map((x) => x.voix), 'graine differente, suite differente');
  assert.strictEqual(a.mode, 'aleatoire');
});

test('mode aleatoire : jamais deux fois la meme voix d affilee', () => {
  const r = choisirVoix({ sections: sections(12), voix: CASTING, mode: 'aleatoire', graine: 7, personasSeulement: true });
  for (let i = 1; i < r.choix.length; i += 1) {
    assert.notStrictEqual(r.choix[i].voix, r.choix[i - 1].voix, `sections ${i - 1}/${i} identiques`);
  }
});

test('mode aleatoire : plusieurs personas participent', () => {
  const r = choisirVoix({ sections: sections(12), voix: CASTING, mode: 'aleatoire', graine: 3, personasSeulement: true });
  assert.ok(r.voixDistinctes >= 2, `une seule voix a tout pris : ${r.voixDistinctes}`);
});

test('le mode par defaut (timbre) est inchange', () => {
  const r = choisirVoix({ sections: sections(4), voix: CASTING });
  assert.strictEqual(r.mode, 'timbre');
  assert.strictEqual(r.personasSeulement, false);
  // Sans filtre, les anciennes voix restent eligibles comme avant.
  assert.strictEqual(r.eligibles, CASTING.length);
});

test('prngDepuis est deterministe', () => {
  const p1 = prngDepuis('x'); const p2 = prngDepuis('x');
  assert.strictEqual(p1(), p2());
});
