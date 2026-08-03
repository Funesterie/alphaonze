'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  TAILLE_EMPREINTE,
  argsEmpreinte,
  argsImage,
  cibleGdigrab,
  empreinteDe,
  lireArguments,
} = require(path.join(__dirname, '../scripts/vivy-copilote-capture.cjs'));

test('l empreinte tient en 64 octets — c est tout l interet', () => {
  // On ne capture pas une image pour la comparer : ffmpeg la reduit a 8x8 en gris.
  // Comparer deux empreintes doit couter moins que l appel qu on cherche a eviter.
  assert.equal(TAILLE_EMPREINTE, 8);
  const args = argsEmpreinte('Genshin Impact').join(' ');
  assert.match(args, /scale=8:8,format=gray/);
  assert.match(args, /-f rawvideo/);
  assert.equal(empreinteDe(Buffer.alloc(64, 128)).length, 64, 'un caractere par pixel');
});

test('une image uniforme et une image contrastee ont des empreintes distinctes', () => {
  const uniforme = empreinteDe(Buffer.alloc(64, 128));
  const contraste = empreinteDe(Buffer.from(Array.from({ length: 64 }, (_, i) => (i < 32 ? 20 : 230))));
  assert.notEqual(uniforme, contraste);
  assert.match(uniforme, /^8+$/, 'sans contraste, tout est au milieu de l echelle');
});

test('une capture tronquee ne produit pas une fausse empreinte', () => {
  // Rendre une empreinte partielle ferait croire a un changement, ou pire a une
  // stabilite, sur des donnees incompletes.
  assert.equal(empreinteDe(Buffer.alloc(10)), '');
  assert.equal(empreinteDe(null), '');
  assert.equal(empreinteDe(Buffer.alloc(0)), '');
});

test('l empreinte resiste au bruit mais voit un changement de scene', () => {
  const base = Array.from({ length: 64 }, (_, i) => (i < 32 ? 60 : 200));
  const bruitee = base.map((v) => v + (Math.random() < 0.5 ? -3 : 3));
  const autreScene = base.map((v) => 255 - v);
  assert.equal(empreinteDe(Buffer.from(base)), empreinteDe(Buffer.from(bruitee)), 'le bruit ne doit pas compter');
  assert.notEqual(empreinteDe(Buffer.from(base)), empreinteDe(Buffer.from(autreScene)));
});

test('le plein ecran reste possible en repli', () => {
  // La capture d une fenetre en exclusivite plein ecran est bloquee par le pilote
  // sur la plupart des machines. « desktop » capture tout l ecran : Vivy voit
  // aussi ce qui deborde du jeu, mais elle voit.
  assert.equal(cibleGdigrab('desktop'), 'desktop');
  assert.equal(cibleGdigrab('Bureau'), 'desktop');
  assert.equal(cibleGdigrab(''), 'desktop');
  assert.equal(cibleGdigrab('Genshin Impact'), 'title=Genshin Impact');
});

test('l image pleine n est demandee qu en qualite raisonnable', () => {
  // Elle part sur le reseau a chaque analyse : inutile de l envoyer en 4K.
  const args = argsImage('Genshin Impact').join(' ');
  assert.match(args, /scale=960:-2/);
  assert.match(args, /-f mjpeg/);
  assert.match(args, /-q:v 6/);
});

test('sans serveur ni jeton, seul l essai a blanc est permis', () => {
  const sec = lireArguments(['--fenetre', 'Genshin Impact', '--sec']);
  assert.equal(sec.sec, true);
  assert.equal(sec.url, '');
  const reel = lireArguments(['--url', 'https://a11.test', '--jeton', 'abc', '--tick', '250']);
  assert.equal(reel.url, 'https://a11.test');
  assert.equal(reel.jeton, 'abc');
  assert.equal(reel.tick, 250);
});

test('la cadence de capture ne descend pas sous un plancher', () => {
  // Interroger l ecran toutes les 10 ms saturerait le CPU pour rien : l empreinte
  // est bon marche, pas gratuite.
  assert.equal(lireArguments(['--tick', '5']).tick, 100);
  assert.equal(lireArguments(['--tick', 'nawak']).tick, 500);
});
