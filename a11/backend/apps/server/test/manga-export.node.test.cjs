'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  dimensionsPng,
  resolveClipIdFromPublicName,
  resolveMangaSource,
  buildMangaExport,
} = require('../src/clips/manga-export.cjs');

// De vraies images : pdfkit refuse (a raison) un PNG sans donnees.
const sharp = require('sharp');
const cache = new Map();
function pngFactice(largeur, hauteur) {
  const cle = `${largeur}x${hauteur}`;
  if (!cache.has(cle)) {
    cache.set(cle, sharp({ create: { width: largeur, height: hauteur, channels: 3, background: '#202020' } }).png().toBuffer());
  }
  return cache.get(cle);
}

async function ecrirePng(chemin, largeur, hauteur) {
  fs.writeFileSync(chemin, await pngFactice(largeur, hauteur));
}
async function chapitreFactice(nomPublic, nbCases) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-export-'));
  const clipId = `clip-${Date.now()}-abcd1234`;
  const clipDir = path.join(racine, 'clips', clipId);
  fs.mkdirSync(clipDir, { recursive: true });
  for (let i = 0; i < nbCases; i += 1) {
    await ecrirePng(path.join(clipDir, `panel_${String(i).padStart(2, '0')}.png`), 256, 256);
  }
  const nom = nomPublic.replace('<id>', clipId.slice('clip-'.length));
  return { racine, clipId, clipDir, nom };
}

test('le dossier de travail est retrouve meme quand l identifiant contient des tirets', async () => {
  const { racine, clipId, nom } = await chapitreFactice('Elio-chapitre-1-<id>.png', 3);
  assert.equal(resolveClipIdFromPublicName(nom, { runtimeRoot: racine }), clipId);
  // Un nom qui tente de sortir du dossier ne resout rien.
  assert.equal(resolveClipIdFromPublicName('../../etc/passwd', { runtimeRoot: racine }), '');
  const source = resolveMangaSource(nom, { runtimeRoot: racine });
  assert.equal(source.panels.length, 3);
  assert.equal(source.titre, 'Elio-chapitre-1');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('le PDF a une page par case, a la taille de la case', async () => {
  const { racine, nom } = await chapitreFactice('Elio-chapitre-1-<id>.png', 4);
  const source = resolveMangaSource(nom, { runtimeRoot: racine });
  const { buffer, contentType, extension } = await buildMangaExport('pdf', source.pages, { titre: source.titre });
  assert.equal(contentType, 'application/pdf');
  assert.equal(extension, 'pdf');
  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');
  assert.equal((buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 4);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('le CBZ est une archive qui contient les cases numerotees', async () => {
  const { racine, nom } = await chapitreFactice('Elio-chapitre-1-<id>.png', 3);
  const source = resolveMangaSource(nom, { runtimeRoot: racine });
  const { buffer, contentType } = await buildMangaExport('cbz', source.pages, { titre: source.titre });
  assert.equal(contentType, 'application/vnd.comicbook+zip');
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
  const noms = new (require('adm-zip'))(buffer).getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(noms, ['Elio-chapitre-1-001.png', 'Elio-chapitre-1-002.png', 'Elio-chapitre-1-003.png']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('sans case, la planche-contact fait un document d une page ; un format inconnu est refuse', async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-export-vide-'));
  const board = path.join(racine, 'Elio-chapitre-1-clip9999.png');
  await ecrirePng(board, 256, 2048);
  const source = resolveMangaSource('Elio-chapitre-1-clip9999.png', { runtimeRoot: racine, boardPath: board });
  assert.equal(source.panels.length, 0);
  assert.equal(source.pages.length, 1);
  const { buffer } = await buildMangaExport('pdf', source.pages, { titre: 'Elio-chapitre-1' });
  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');

  await assert.rejects(buildMangaExport('docx', source.pages, {}), /format_inconnu/);
  await assert.rejects(buildMangaExport('pdf', [], {}), /manga_sans_page/);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('les dimensions sont lues dans l entete PNG', async () => {
  assert.deepEqual(dimensionsPng(await pngFactice(800, 1200)), { width: 800, height: 1200 });
  assert.equal(dimensionsPng(Buffer.from('pas une image')), null);
});
