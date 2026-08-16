'use strict';

const test = require('node:test');
const assert = require('node:assert');

const f = require('../src/clips/filigrane-quaternion.cjs');

const SECRET = 'secret-filigrane-assez-long-123456';

/** Image de test deterministe : degrade + texture, comme une vraie image. */
function image(largeur = 64, hauteur = 64) {
  const px = new Uint8Array(largeur * hauteur * 3);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 3;
      px[i] = (x * 4 + y) % 256;
      px[i + 1] = (y * 3 + 40) % 256;
      px[i + 2] = ((x + y) * 2 + 90) % 256;
    }
  }
  return px;
}

/** Quantification grossiere : imite la perte d'un re-encodage video. */
function quantifier(px, pas) {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round(px[i] / pas) * pas));
  }
  return out;
}

function ecartMax(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test('la rotation issue d une marque est unitaire', () => {
  const q = f.rotationDepuisMarque('NOSSEN · drive:djeff · abc123', SECRET);
  assert.ok(Math.abs(Math.hypot(q.w, q.x, q.y, q.z) - 1) < 1e-12);
});

test('deux spectateurs donnent des rotations differentes', () => {
  const a = f.rotationDepuisMarque('drive:djeff', SECRET);
  const b = f.rotationDepuisMarque('drive:kiro', SECRET);
  assert.notStrictEqual(a.x, b.x);
});

test('la meme marque redonne la meme rotation', () => {
  assert.deepStrictEqual(
    f.rotationDepuisMarque('drive:djeff', SECRET),
    f.rotationDepuisMarque('drive:djeff', SECRET)
  );
});

test('un secret court est refuse', () => {
  assert.throws(() => f.rotationDepuisMarque('x', 'court'), /16 caracteres/);
});

test('la marque est invisible : moins de 8 niveaux sur 255', () => {
  const orig = image();
  const marquee = f.marquerImage(orig, 'drive:djeff', SECRET);
  const max = ecartMax(orig, marquee);
  assert.ok(max > 0, 'aucune modification : la marque n a pas ete posee');
  assert.ok(max <= 8, `derive trop visible : ${max} niveaux`);
});

test('la marque ne casse pas les bornes 0-255', () => {
  // Pixels extremes : le noir pur et le blanc pur ne doivent pas deborder.
  const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0]);
  const m = f.marquerImage(px, 'drive:djeff', SECRET);
  for (const v of m) assert.ok(v >= 0 && v <= 255, `valeur hors bornes : ${v}`);
});

test('on retrouve le bon spectateur parmi plusieurs', () => {
  const orig = image();
  const casting = ['drive:djeff', 'drive:kiro', 'drive:vivy', 'drive:codex'];
  for (const coupable of casting) {
    const fuite = f.marquerImage(orig, coupable, SECRET);
    const r = f.identifierMarque(orig, fuite, casting, SECRET);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.marque, coupable, `confondu avec ${r.marque}`);
  }
});

test('la marque survit a un re-encodage (quantification par 4)', () => {
  const orig = image();
  const casting = ['drive:djeff', 'drive:kiro', 'drive:vivy', 'drive:codex'];
  const fuite = quantifier(f.marquerImage(orig, 'drive:vivy', SECRET), 4);
  const r = f.identifierMarque(orig, fuite, casting, SECRET);
  assert.strictEqual(r.marque, 'drive:vivy', `perdu apres quantification : ${r.marque}`);
});

test('une seule marque connue ne conclut jamais', () => {
  // Un seul candidat "gagne" toujours : ca ne prouve rien, et le module doit le
  // dire plutot que de laisser croire a une identification.
  const orig = image();
  const fuite = f.marquerImage(orig, 'drive:djeff', SECRET);
  const r = f.identifierMarque(orig, fuite, ['drive:djeff'], SECRET);
  assert.strictEqual(r.marge, null);
  assert.strictEqual(r.concluant, false);
});

test('une image non marquee ne designe personne de facon concluante', () => {
  const orig = image();
  const r = f.identifierMarque(orig, orig, ['drive:djeff', 'drive:kiro', 'drive:vivy'], SECRET);
  assert.strictEqual(r.concluant, false, 'a accuse quelqu un sur une image vierge');
});

test('des dimensions differentes sont refusees', () => {
  const r = f.identifierMarque(image(8, 8), image(16, 16), ['drive:djeff'], SECRET);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.raison, 'dimensions_differentes');
});

test('sans marque connue, aucune identification', () => {
  const orig = image();
  const r = f.identifierMarque(orig, orig, [], SECRET);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.raison, 'aucune_marque_connue');
});
