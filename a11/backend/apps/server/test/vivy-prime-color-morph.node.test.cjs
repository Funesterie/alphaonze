const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSonicMorph,
  chooseSonicSignature,
  describeSonicPalette,
  paletteAvecTeinteReelle,
  teinteDepuisHex,
  deriveSonicSignature,
} = require('../src/music/vivy-prime-color.cjs');

test('la teinte se calcule depuis le hex, pas depuis le champ declare', () => {
  // Releve du 02/08 : le champ `hue` est faux sur 4 entrees. Interpoler dessus
  // ferait tourner le morphing dans le mauvais sens.
  const palette = paletteAvecTeinteReelle();
  const fausses = palette.filter((c) => c.hueFausse).map((c) => c.name);

  assert.equal(fausses.length, 4, `attendu 4 teintes fausses, trouve ${fausses.length} : ${fausses}`);
  assert.deepEqual(fausses.sort(), ['DeepBlue', 'PurpleShadow', 'ToxicGreen', 'Violet']);
  // Et les justes le restent.
  assert.equal(Math.round(palette.find((c) => c.name === 'DORE').hueReelle), 60);
});

test('teinteDepuisHex rend les angles connus', () => {
  assert.equal(Math.round(teinteDepuisHex('0x8a0a0a')), 0);
  assert.equal(Math.round(teinteDepuisHex('0x0a8a8a')), 180);
  assert.equal(teinteDepuisHex('pas un hex'), null);
});

test('le morphing traverse les sections au lieu de tenir une couleur', () => {
  const m = buildSonicMorph('NOSSEN', { stops: ['DeepBlue', 'BloodRed', 'DORE'] });

  assert.equal(m.chosenBy, 'vivy');
  assert.equal(m.sections.length, 5);
  const teintes = m.sections.map((s) => s.hue);
  assert.ok(new Set(teintes).size > 1, 'le morphing ne bouge pas');
  // Premiere et derniere section collent aux arrets extremes.
  assert.equal(m.sections[0].dominante, 'DeepBlue');
  assert.equal(m.sections[m.sections.length - 1].dominante, 'DORE');
});

test('l interpolation prend le plus court chemin sur l anneau', () => {
  // DeepBlue 210 -> BloodRed 0 : le court chemin monte par 285, il ne redescend
  // pas par 105. Un morphing qui repart en arriere s entend.
  const m = buildSonicMorph('x', { stops: ['DeepBlue', 'BloodRed'], sections: ['a', 'b', 'c'] });
  assert.ok(m.sections[1].hue > 210 || m.sections[1].hue < 30, `passage par ${m.sections[1].hue}deg`);
});

test('les sections sont personnalisables', () => {
  const m = buildSonicMorph('x', { stops: ['Cyan', 'Magenta'], sections: ['intro', 'drop'] });
  assert.deepEqual(m.sections.map((s) => s.section), ['intro', 'drop']);
});

test('sans arret, on retombe sur la couleur derivee et c est annonce', () => {
  const m = buildSonicMorph('NOSSEN', {});
  assert.equal(m.chosenBy, 'derive');
  assert.equal(m.sections.length, 0);
  assert.ok(m.line.length > 0);
});

test('une couleur hors palette est signalee, jamais avalee en silence', () => {
  const m = buildSonicMorph('x', { stops: ['Cyan', 'BleuQuiNExistePas', 'DORE'] });
  assert.deepEqual(m.couleursInconnues, ['BleuQuiNExistePas']);
  assert.equal(m.stops.length, 2);

  const s = chooseSonicSignature('x', { color: 'PasUneCouleur' });
  assert.equal(s.couleurInconnue, 'PasUneCouleur');
  assert.equal(s.chosenBy, 'derive');
});

test('le menu presente au modele reste dans le canon de la palette', () => {
  const menu = describeSonicPalette();
  assert.ok(menu.length >= 10);
  assert.ok(menu.every((c) => c.name && Number.isFinite(c.gamma)));
});

test('la derivation reste disponible et deterministe', () => {
  const a = deriveSonicSignature('NOSSEN');
  const b = deriveSonicSignature('NOSSEN');
  assert.equal(a.color.name, b.color.name);
  assert.equal(a.chosenBy, 'derive');
});

// --- Cube trinaire ------------------------------------------------------------

const {
  buildCubeMorph,
  cheminTrinaire,
  enTrinaire,
  hexDepuisTrits,
  NIVEAUX_CUBE,
} = require('../src/music/vivy-prime-color.cjs');

test('le cube n a que trois niveaux par canal — d ou le trinaire', () => {
  assert.deepEqual(NIVEAUX_CUBE, [0x0a, 0x4a, 0x8a]);
  const niveaux = new Set();
  for (const c of describeSonicPalette()) {
    const t = enTrinaire(paletteAvecTeinteReelle().find((p) => p.name === c.name).hex);
    t.trits.forEach((v) => niveaux.add(v));
  }
  assert.deepEqual([...niveaux].sort(), [0, 1, 2]);
});

test('chaque couleur est un nombre a trois chiffres en base 3', () => {
  const t = enTrinaire('0x0a4a8a');
  assert.deepEqual(t.trits, [0, 1, 2]);
  assert.equal(t.base3, '012');
  assert.equal(t.rang, 5); // 0*9 + 1*3 + 2
  assert.equal(t.position, 'arete');

  assert.equal(enTrinaire('0x8a0a0a').position, 'coin');
  assert.equal(enTrinaire('0x4a4a4a').position, 'centre');
  assert.equal(enTrinaire('0x4a4a4a').rang, 13); // le milieu exact de 0..26
});

test('hexDepuisTrits fait l aller-retour', () => {
  for (const trits of [[0, 0, 0], [1, 2, 0], [2, 2, 2]]) {
    assert.deepEqual(enTrinaire(hexDepuisTrits(trits)).trits, trits);
  }
});

test('le chemin trinaire ne bouge qu un seul trit par pas', () => {
  const pas = cheminTrinaire([0, 1, 2], [2, 2, 0]);
  assert.deepEqual(pas[0].trits, [0, 1, 2]);
  assert.deepEqual(pas[pas.length - 1].trits, [2, 2, 0]);

  for (let i = 1; i < pas.length; i += 1) {
    const diff = pas[i].trits.filter((t, k) => t !== pas[i - 1].trits[k]).length;
    assert.equal(diff, 1, `pas ${i} change ${diff} trits au lieu d un`);
  }
});

test('chaque etape est un point reel du treillis, pas un fondu', () => {
  for (const p of cheminTrinaire([0, 0, 0], [2, 2, 2])) {
    assert.ok(p.trits.every((t) => [0, 1, 2].includes(t)));
    assert.match(p.hex, /^0x[0-9a-f]{6}$/);
  }
});

test('le morphing cube traverse l interieur au lieu de longer le bord', () => {
  const m = buildCubeMorph('NOSSEN', { stops: ['DeepBlue', 'BloodRed', 'DORE'] });
  assert.equal(m.chosenBy, 'vivy');
  assert.equal(m.sections.length, 5);
  // Le chemin doit passer par au moins un point qui n'est pas un coin :
  // c'est precisement ce que le morphing circulaire ne pouvait pas faire.
  assert.ok(m.chemin.some((p) => enTrinaire(p.hex).position !== 'coin'));
  assert.equal(m.sections[0].nom, 'DeepBlue');
});

test('un seul arret ne fait pas un morphing — repli annonce', () => {
  const m = buildCubeMorph('NOSSEN', { stops: ['DORE'] });
  assert.equal(m.chosenBy, 'derive');
  assert.equal(m.sections.length, 0);
});

test('les couleurs hors palette sont signalees ici aussi', () => {
  const m = buildCubeMorph('x', { stops: ['Cyan', 'PasUneCouleur', 'DORE'] });
  assert.deepEqual(m.couleursInconnues, ['PasUneCouleur']);
});

test('8/4/2 pese, 9/3/1 adresse — les deux coexistent', () => {
  // Djeff : « c est 8 4 2 par bit ». Ce n est pas une adresse ratee, c est une
  // ponderation de mixage : deux couleurs ont le droit d y peser pareil.
  const { memePoids, POIDS_CANAUX } = require('../src/music/vivy-prime-color.cjs');
  assert.deepEqual(POIDS_CANAUX, [8, 4, 2]);

  const plein = enTrinaire('0x8a8a8a');
  assert.equal(plein.rang, 26);   // adresse : 2*9 + 2*3 + 2
  assert.equal(plein.poids, 28);  // masse   : 2*8 + 2*4 + 2*2

  // Les trois paires de meme masse dans la palette.
  assert.deepEqual(memePoids('0x0a8a4a'), ['Violet']);       // ToxicGreen
  assert.deepEqual(memePoids('0x8a4a0a'), ['Magenta']);      // FireOrange
  assert.equal(memePoids('0x8a8a0a').length, 0);             // DORE est seule
});

test('l adresse reste unique la ou la masse ne l est pas', () => {
  const palette = paletteAvecTeinteReelle();
  const rangs = palette.map((c) => enTrinaire(c.hex).rang);
  const poids = palette.map((c) => enTrinaire(c.hex).poids);
  assert.equal(new Set(rangs).size, palette.length, 'deux couleurs partagent une adresse');
  assert.ok(new Set(poids).size < palette.length, 'aucune masse partagee, la ponderation ne sert a rien');
});
