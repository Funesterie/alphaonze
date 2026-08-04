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
