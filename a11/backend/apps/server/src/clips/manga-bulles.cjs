'use strict';

// Les bulles de dialogue sont POSEES sur la case, elles ne sont pas dessinees
// par le modele d'image.
//
// Djeff, 20/09/2026 : sur le premier chapitre, la seule bulle produite par le
// modele etait en anglais. Un modele d'image ne sait ni orthographier ni tenir
// une langue ; en revanche le texte de K44, lui, est juste. On genere donc des
// cases MUETTES, puis on ecrit la replique par-dessus, avec une vraie police.

const CARACTERES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function echapperXml(texte = '') {
  return String(texte).replace(/[&<>"']/g, (c) => CARACTERES[c]);
}

// Coupe une replique en lignes qui tiennent dans la bulle. Largeur estimee a
// 0,52 em par caractere : DejaVu Sans est large, et une bulle trop juste
// deborde sur le dessin.
function couperEnLignes(texte = '', taillePolice = 26, largeurMax = 520) {
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean);
  const parLigne = Math.max(8, Math.floor(largeurMax / (taillePolice * 0.52)));
  const lignes = [];
  let courante = '';
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (essai.length > parLigne && courante) {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = essai;
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

// La bulle en SVG : un rectangle arrondi blanc, contour noir, une petite queue
// vers le bas, et le nom du locuteur en gras au-dessus de la replique.
function construireBulleSvg({
  texte,
  locuteur = '',
  largeurImage = 1024,
  hauteurImage = 1024,
  position = 'haut',
}) {
  const taillePolice = Math.round(largeurImage * 0.026);
  const marge = Math.round(largeurImage * 0.04);
  const largeurBulle = Math.round(largeurImage * 0.62);
  const lignes = couperEnLignes(texte, taillePolice, largeurBulle - taillePolice * 2);
  const nom = String(locuteur || '').trim();
  const interligne = Math.round(taillePolice * 1.35);
  const hauteurTexte = lignes.length * interligne + (nom ? interligne : 0);
  const hauteurBulle = hauteurTexte + taillePolice * 1.8;
  const x = position === 'droite' ? largeurImage - largeurBulle - marge : marge;
  const y = position === 'bas' ? hauteurImage - hauteurBulle - marge * 2 : marge;
  const queueX = x + largeurBulle * 0.3;
  const queueY = y + hauteurBulle;

  const lignesSvg = lignes.map((ligne, i) => {
    const decalage = y + taillePolice * 1.6 + (nom ? interligne : 0) + i * interligne;
    return `<text x="${x + largeurBulle / 2}" y="${decalage}" font-family="DejaVu Sans" font-size="${taillePolice}" `
      + `fill="#111111" text-anchor="middle">${echapperXml(ligne)}</text>`;
  }).join('');

  const nomSvg = nom
    ? `<text x="${x + largeurBulle / 2}" y="${y + taillePolice * 1.5}" font-family="DejaVu Sans" font-size="${Math.round(taillePolice * 0.8)}" `
      + `font-weight="bold" fill="#444444" text-anchor="middle">${echapperXml(nom.toUpperCase())}</text>`
    : '';

  // Ordre de dessin : le corps de la bulle, PUIS la queue par-dessus, PUIS un
  // trait blanc qui efface le contour sous la queue. Dans l'autre sens la queue
  // passait derriere et restait invisible (constate le 20/09/2026).
  const queueLargeur = taillePolice * 1.3;
  return `<svg width="${largeurImage}" height="${hauteurImage}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="${x}" y="${y}" width="${largeurBulle}" height="${hauteurBulle}" rx="${Math.round(hauteurBulle / 3)}" `
    + 'fill="#ffffff" stroke="#111111" stroke-width="3"/>'
    + `<path d="M ${queueX} ${queueY} L ${queueX + queueLargeur} ${queueY} L ${queueX + queueLargeur * 0.25} ${queueY + taillePolice * 1.6} Z" `
    + 'fill="#ffffff" stroke="#111111" stroke-width="3" stroke-linejoin="round"/>'
    + `<line x1="${queueX + 3}" y1="${queueY}" x2="${queueX + queueLargeur - 3}" y2="${queueY}" stroke="#ffffff" stroke-width="5"/>`
    + nomSvg + lignesSvg
    + '</svg>';
}

// « Mère : Il n'est pas question… » avec MÈRE deja ecrit au-dessus : le nom
// sortait deux fois (constate le 20/09/2026). On retire le prefixe quand il
// repete le locuteur, ou quand il ressemble a un nom suivi de deux points.
function retirerPrefixeLocuteur(texte = '', locuteur = '') {
  const replique = String(texte || '').trim();
  const nom = String(locuteur || '').trim();
  if (nom) {
    const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const avecNom = new RegExp(`^${echappe}\\s*[:\\-–]\\s*`, 'i');
    if (avecNom.test(replique)) return replique.replace(avecNom, '').trim();
  }
  return replique.replace(/^[A-ZÀ-ÖØ-Þ][\wÀ-ÿ' -]{1,20}\s*:\s+/u, '').trim();
}

// Pose la bulle sur la case. Sans replique, la case ressort inchangee : une
// case muette est un choix de mise en scene, pas un echec.
async function poserBulle(cheminImage, { texte = '', locuteur = '', position = 'haut', sharpImpl = null } = {}) {
  const replique = retirerPrefixeLocuteur(texte, locuteur);
  if (!replique) return false;
  const sharp = sharpImpl || require('sharp');
  const image = sharp(cheminImage);
  const meta = await image.metadata();
  const svg = construireBulleSvg({
    texte: replique,
    locuteur,
    largeurImage: meta.width || 1024,
    hauteurImage: meta.height || 1024,
    position,
  });
  const composee = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  require('node:fs').writeFileSync(cheminImage, composee);
  return true;
}

module.exports = {
  couperEnLignes,
  retirerPrefixeLocuteur,
  construireBulleSvg,
  poserBulle,
};
