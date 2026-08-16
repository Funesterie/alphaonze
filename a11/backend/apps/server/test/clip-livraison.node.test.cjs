'use strict';

const test = require('node:test');
const assert = require('node:assert');

const l = require('../src/clips/clip-livraison.cjs');
const fq = require('../src/clips/filigrane-quaternion.cjs');

const SECRET = 'secret-de-livraison-assez-long-42';

test('la matrice est une vraie rotation : orthogonale, determinant 1', () => {
  const q = fq.rotationDepuisMarque('NOSSEN · drive:djeff', SECRET);
  const m = l.matriceDepuisRotation(q);

  // Colonnes orthonormees.
  for (let i = 0; i < 3; i += 1) {
    const norme = Math.hypot(m[0][i], m[1][i], m[2][i]);
    assert.ok(Math.abs(norme - 1) < 1e-9, `colonne ${i} de norme ${norme}`);
  }
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  assert.ok(Math.abs(det - 1) < 1e-9, `determinant ${det} (une symetrie donnerait -1)`);
});

test('LE test qui compte : la matrice ffmpeg fait la meme chose que le quaternion', () => {
  // Si ces deux chemins divergent, on marque les videos avec une rotation et on
  // les cherche avec une autre : plus aucune identification ne fonctionne, et
  // rien ne le signale.
  const q = fq.rotationDepuisMarque('NOSSEN · drive:vivy', SECRET);
  const m = l.matriceDepuisRotation(q);

  for (const [r, g, b] of [[10, 20, 30], [128, 128, 128], [250, 5, 90], [0, 0, 0], [255, 255, 255]]) {
    const parQuaternion = fq.tournerPixel(r, g, b, q);
    const parMatrice = {
      r: Math.max(0, Math.min(255, Math.round(m[0][0] * r + m[0][1] * g + m[0][2] * b))),
      g: Math.max(0, Math.min(255, Math.round(m[1][0] * r + m[1][1] * g + m[1][2] * b))),
      b: Math.max(0, Math.min(255, Math.round(m[2][0] * r + m[2][1] * g + m[2][2] * b))),
    };
    assert.deepStrictEqual(parMatrice, parQuaternion, `divergence sur (${r},${g},${b})`);
  }
});

test('le filtre invisible force le RGB avant la matrice', () => {
  // Sans format=rgb24, ffmpeg applique la matrice en YUV : la marque est posee
  // mais introuvable.
  const f = l.filtreInvisible('NOSSEN · drive:djeff', SECRET);
  assert.ok(f.startsWith('format=rgb24,'), `chaine de filtres : ${f.slice(0, 40)}`);
  assert.match(f, /colorchannelmixer=rr=/);
  assert.strictEqual((f.match(/rr=|rg=|rb=|gr=|gg=|gb=|br=|bg=|bb=/g) || []).length, 9);
});

test('deux acheteurs recoivent des filtres differents', () => {
  const a = l.filtreInvisible(l.marquePourAcheteur('clip1.mp4', 'drive:djeff'), SECRET);
  const b = l.filtreInvisible(l.marquePourAcheteur('clip1.mp4', 'drive:kiro'), SECRET);
  assert.notStrictEqual(a, b);
});

test('le nom de fichier ne revele pas l acheteur', () => {
  const nom = l.nomPourAcheteur('nossen-001.mp4', 'djeff@funesterie.me', SECRET);
  assert.ok(!nom.includes('djeff'), `identite en clair dans ${nom}`);
  assert.ok(!nom.includes('@'), `courriel en clair dans ${nom}`);
  assert.match(nom, /^nossen-001__[a-f0-9]{16}\.mp4$/);
});

test('le nom est stable pour un acheteur, different d un autre', () => {
  const a = l.nomPourAcheteur('c.mp4', 'drive:djeff', SECRET);
  assert.strictEqual(a, l.nomPourAcheteur('c.mp4', 'drive:djeff', SECRET));
  assert.notStrictEqual(a, l.nomPourAcheteur('c.mp4', 'drive:kiro', SECRET));
});

test('pas de secret faible pour nommer un fichier', () => {
  assert.throws(() => l.nomPourAcheteur('c.mp4', 'a', 'court'), /16 caracteres/);
});

test('drawtext echappe ce qui casserait sa syntaxe', () => {
  const t = l.echapperTexte("Djeff: l'ami\\du 16:9");
  assert.ok(!/(?<!\\):/.test(t), `deux-points non echappe dans ${t}`);
  assert.ok(!/(?<!\\)'/.test(t), `apostrophe non echappee dans ${t}`);
});

test('les arguments ffmpeg tiennent debout', () => {
  const a = l.argumentsFfmpeg({
    source: '/in/nossen-001.mp4', destination: '/out/x.mp4',
    clipId: 'nossen-001.mp4', buyerId: 'drive:djeff', secret: SECRET,
  });
  assert.strictEqual(a[a.length - 1], '/out/x.mp4');
  assert.ok(a.includes('-i') && a[a.indexOf('-i') + 1] === '/in/nossen-001.mp4');

  const vf = a[a.indexOf('-vf') + 1];
  assert.ok(vf.includes('colorchannelmixer'), 'marque invisible absente');
  assert.ok(vf.includes('drawtext'), 'marque visible absente');
  assert.ok(vf.indexOf('colorchannelmixer') < vf.indexOf('drawtext'),
    'le texte doit etre incruste APRES la rotation, sinon il tourne avec');

  // L audio n est jamais re-encode : le filigrane est visuel.
  assert.strictEqual(a[a.indexOf('-c:a') + 1], 'copy');
});

test('le plan de livraison garde la marque exacte', () => {
  const p = l.planDeLivraison({ clipId: 'nossen-001.mp4', buyerId: 'drive:djeff', secret: SECRET, dossierSortie: '/livraisons' });
  assert.strictEqual(p.marque, l.marquePourAcheteur('nossen-001.mp4', 'drive:djeff'));
  assert.ok(p.chemin.startsWith('/livraisons'));
  assert.ok(p.fichier.endsWith('.mp4'));
});

test('bout en bout : une fuite designe le bon acheteur', () => {
  // On simule la chaine complete sur des pixels : marque posee a l achat, image
  // re-encodee, puis recherche parmi les acheteurs connus.
  const px = new Uint8Array(48 * 48 * 3);
  for (let i = 0; i < px.length; i += 1) px[i] = (i * 7) % 256;

  const acheteurs = ['drive:djeff', 'drive:kiro', 'drive:vivy'];
  const coupable = 'drive:kiro';
  const marques = acheteurs.map((a) => l.marquePourAcheteur('nossen-001.mp4', a));

  const livre = fq.marquerImage(px, l.marquePourAcheteur('nossen-001.mp4', coupable), SECRET);
  const reencode = new Uint8Array(livre.length);
  for (let i = 0; i < livre.length; i += 1) reencode[i] = Math.round(livre[i] / 3) * 3;

  const r = fq.identifierMarque(px, reencode, marques, SECRET);
  assert.strictEqual(r.marque, l.marquePourAcheteur('nossen-001.mp4', coupable));
});
