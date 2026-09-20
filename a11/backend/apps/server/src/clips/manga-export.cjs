'use strict';

// Sortie manga : PDF et CBZ, fabriques a partir des CASES d'origine.
//
// Demande de Djeff (20/09/2026) : pouvoir garder un chapitre, ou l'envoyer. La
// page NOSSEN ne publiait qu'une planche-contact verticale (webtoon) d'un seul
// tenant — illisible sur une liseuse et lourde a l'ecran. Ici, une case par page.
//
// Les cases vivent a cote du clip (runtime/clips/clip-<id>/panel_01.png...) ; le
// fichier public s'appelle <titre>-<id>.png, d'ou l'on retrouve le dossier.

const fs = require('node:fs');
const path = require('node:path');

const FORMATS = Object.freeze({ pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' });

// Le nom public est <titre>-<suffixe du clip>.png, et ce suffixe contient
// lui-meme des tirets (clip-1789871947950-a7f0fe1e) : on ne le devine pas, on
// cherche le dossier de travail qui correspond a la fin du nom.
function resolveClipIdFromPublicName(filename = '', { runtimeRoot = '/app/runtime' } = {}) {
  const base = String(filename || '').trim();
  if (!base || /[\\/]/.test(base) || base.includes('..')) return '';
  const sansExt = base.replace(/\.png$/i, '');
  let dossiers = [];
  try { dossiers = fs.readdirSync(path.join(runtimeRoot, 'clips')); } catch { dossiers = []; }
  const candidats = dossiers
    .filter((d) => /^clip-[a-zA-Z0-9-]+$/.test(d) && sansExt.endsWith(`-${d.slice('clip-'.length)}`))
    .sort((a, b) => b.length - a.length);
  return candidats[0] || '';
}

// Les cases d'un chapitre, dans l'ordre. Vide si le dossier de travail a ete
// nettoye : dans ce cas l'appelant se rabat sur la planche-contact.
function listPanelFiles(clipDir) {
  let noms = [];
  try { noms = fs.readdirSync(clipDir); } catch { return []; }
  return noms
    .filter((n) => /^panel_\d+\.png$/i.test(n))
    .sort()
    .map((n) => path.join(clipDir, n));
}

function resolveMangaSource(publicFilename, { runtimeRoot = '/app/runtime', boardPath = '' } = {}) {
  const clipId = resolveClipIdFromPublicName(publicFilename, { runtimeRoot });
  const clipDir = clipId ? path.join(runtimeRoot, 'clips', clipId) : '';
  const panels = clipDir ? listPanelFiles(clipDir) : [];
  const suffixe = clipId ? clipId.slice('clip-'.length) : '';
  const titre = String(publicFilename || 'manga')
    .replace(/\.png$/i, '')
    .replace(suffixe ? new RegExp(`-${suffixe}$`) : /-[a-zA-Z0-9]+$/, '') || 'manga';
  // Sans les cases, la planche-contact fait un document d'une seule page.
  const pages = panels.length ? panels : (boardPath && fs.existsSync(boardPath) ? [boardPath] : []);
  return { clipId, clipDir, panels, pages, titre };
}

// Dimensions d'un PNG : elles sont dans l'en-tete IHDR, aux octets 16 a 24.
// Pas de dependance a ajouter pour ca.
function dimensionsPng(buffer) {
  const estPng = buffer.length > 24
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!estPng) return null;
  const largeur = buffer.readUInt32BE(16);
  const hauteur = buffer.readUInt32BE(20);
  return largeur > 0 && hauteur > 0 ? { width: largeur, height: hauteur } : null;
}

// PDF : une case par page, la page prend la taille de l'image (pas de marge
// blanche qui ferait respirer un manga la ou il ne doit pas).
function buildMangaPdf(pages, { titre = 'manga' } = {}) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ autoFirstPage: false, info: { Title: titre } });
  const morceaux = [];
  doc.on('data', (c) => morceaux.push(c));
  const fini = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
  });
  for (const page of pages) {
    const buffer = fs.readFileSync(page);
    const mesure = dimensionsPng(buffer);
    const largeur = mesure?.width || 1024;
    const hauteur = mesure?.height || 1024;
    doc.addPage({ size: [largeur, hauteur], margin: 0 });
    doc.image(buffer, 0, 0, { width: largeur, height: hauteur });
  }
  doc.end();
  return fini;
}

// CBZ : une archive ZIP de cases numerotees, ce que lisent les liseuses de manga.
function buildMangaCbz(pages, { titre = 'manga' } = {}) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  pages.forEach((page, index) => {
    zip.addFile(`${titre}-${String(index + 1).padStart(3, '0')}.png`, fs.readFileSync(page));
  });
  return zip.toBuffer();
}

async function buildMangaExport(format, pages, options = {}) {
  const normalise = String(format || '').trim().toLowerCase();
  if (!FORMATS[normalise]) throw Object.assign(new Error('format_inconnu'), { code: 'format_inconnu', status: 400 });
  if (!pages.length) throw Object.assign(new Error('manga_sans_page'), { code: 'manga_sans_page', status: 404 });
  const buffer = normalise === 'pdf'
    ? await buildMangaPdf(pages, options)
    : buildMangaCbz(pages, options);
  return { buffer, contentType: FORMATS[normalise], extension: normalise };
}

module.exports = {
  FORMATS,
  dimensionsPng,
  resolveClipIdFromPublicName,
  listPanelFiles,
  resolveMangaSource,
  buildMangaPdf,
  buildMangaCbz,
  buildMangaExport,
};
