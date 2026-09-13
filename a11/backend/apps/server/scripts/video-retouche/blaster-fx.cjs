'use strict';
// Dessine les tirs de blaster sur les 81 images : guide visuel pour VACE (voir README.md).
// Usage : node blaster-fx.cjs <dossier-images> <dossier-sortie>
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const [src, dst] = process.argv.slice(2);
const W = 480, H = 832;

// Centroide des pixels qui passent le filtre, dans une zone donnee.
async function centroide(file, zone, filtre) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let sx = 0, sy = 0, n = 0;
  for (let y = zone.y0; y < zone.y1; y += 2) {
    for (let x = zone.x0; x < zone.x1; x += 2) {
      const i = (y * info.width + x) * info.channels;
      if (filtre(data[i], data[i + 1], data[i + 2])) { sx += x; sy += y; n += 1; }
    }
  }
  return n > 20 ? { x: sx / n, y: sy / n, n } : null;
}
const orange = (r, g, b) => r > 190 && g > 100 && g < 185 && b < 90;       // turbine du pistolet
const rouge = (r, g, b) => r > 120 && g < 70 && b < 70 && r - g > 70;      // chemise de la figurine

// Trois salves : 4 images de trajet, puis 4 images d'impact.
const SALVES = [12, 36, 60];
function phase(i) {
  for (const s of SALVES) {
    if (i >= s && i < s + 4) return { type: 'tir', t: (i - s + 1) / 4 };
    if (i >= s + 4 && i < s + 8) return { type: 'impact', t: (i - s - 3) / 4 };
  }
  return null;
}

function svgTir(a, b, t) {
  // Segment lumineux qui avance du canon vers la cible.
  const x1 = a.x + (b.x - a.x) * Math.max(0, t - 0.45), y1 = a.y + (b.y - a.y) * Math.max(0, t - 0.45);
  const x2 = a.x + (b.x - a.x) * t, y2 = a.y + (b.y - a.y) * t;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter></defs>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0a4dff" stroke-width="42" stroke-linecap="round" filter="url(#g)" opacity="1"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2f8cff" stroke-width="18" stroke-linecap="round"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e8f6ff" stroke-width="6" stroke-linecap="round"/>
  <circle cx="${a.x}" cy="${a.y}" r="${40 * (1 - t) + 12}" fill="#3a8dff" filter="url(#g)" opacity="${0.95 * (1 - t) + 0.3}"/>
</svg>`;
}

function svgImpact(b, t) {
  const r = 30 + 70 * t;
  const eclats = Array.from({ length: 10 }, (_, k) => {
    const ang = (k / 10) * Math.PI * 2 + t;
    const d1 = r * 0.6, d2 = r * (1.1 + 0.4 * ((k * 7) % 3) / 2);
    return `<line x1="${b.x + Math.cos(ang) * d1}" y1="${b.y + Math.sin(ang) * d1}" x2="${b.x + Math.cos(ang) * d2}" y2="${b.y + Math.sin(ang) * d2}" stroke="#cfeeff" stroke-width="3" stroke-linecap="round" opacity="${1 - t * 0.7}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter></defs>
  <circle cx="${b.x}" cy="${b.y}" r="${r}" fill="#3d8bff" filter="url(#g)" opacity="${0.95 - t * 0.6}"/>
  <circle cx="${b.x}" cy="${b.y}" r="${r * 0.45}" fill="#ffffff" opacity="${0.9 - t * 0.7}"/>
  ${eclats}
</svg>`;
}

(async () => {
  const fichiers = fs.readdirSync(src).filter((f) => f.endsWith('.png')).sort();
  let dernierCanon = { x: 360, y: 470 }, derniereCible = { x: 255, y: 330 };
  const journal = [];
  for (const [i, f] of fichiers.entries()) {
    const file = path.join(src, f);
    const canon = await centroide(file, { x0: 200, x1: 480, y0: 300, y1: 640 }, orange) || dernierCanon;
    // La couleur ne suffit pas (le chapeau et la petite voiture jaunes l'emportent) :
    // positions reperees a l'oeil sur les images, interpolees entre les reperes.
    const REPERES = [[0, 255, 325], [10, 250, 340], [40, 240, 355], [50, 232, 365], [80, 222, 362]];
    const k = REPERES.findIndex(([n]) => n >= i);
    const [n1, x1, y1] = REPERES[Math.max(0, k - 1)], [n2, x2, y2] = REPERES[k < 0 ? REPERES.length - 1 : k];
    const u = n2 === n1 ? 0 : (i - n1) / (n2 - n1);
    const cible = { x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u };
    dernierCanon = canon; derniereCible = cible;
    const p = phase(i);
    const couche = p ? (p.type === 'tir' ? svgTir(canon, cible, p.t) : svgImpact(cible, p.t)) : null;
    const img = sharp(file);
    // « over » et non « screen » : sur un fond clair, screen effacait le bleu.
    await (couche ? img.composite([{ input: Buffer.from(couche), blend: 'over' }]) : img).png().toFile(path.join(dst, f));
    if (i % 10 === 0 || p) journal.push(`${i}:${p ? p.type : '-'} canon(${Math.round(canon.x)},${Math.round(canon.y)}) cible(${Math.round(cible.x)},${Math.round(cible.y)})`);
  }
  console.log(journal.join('\n'));
})();
