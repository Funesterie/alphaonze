'use strict';

/**
 * vivy-copilote-capture.cjs — L'agent local qui regarde l'écran de Djeff.
 *
 * Il tourne sur SON PC, pas sur le serveur : le serveur ne voit pas son écran.
 * C'est le premier étage de la chaîne du copilote, et le seul qui ne pouvait pas
 * vivre en Finlande.
 *
 *   capture fenêtre  →  empreinte  →  cadence  →  serveur (vision)  →  Vivy parle
 *   [ce fichier]        [ce fichier]  [partagé]    [déjà en place]
 *
 * L'ASTUCE QUI REND L'EMPREINTE GRATUITE. On ne capture pas une image pour la
 * comparer : on demande à ffmpeg de la réduire à 8×8 en niveaux de gris, ce qui
 * rend 64 octets. Comparer deux empreintes coûte alors moins qu'un battement de
 * cil, et l'image pleine n'est capturée QUE si la cadence l'autorise. Sans ça, on
 * paierait la capture complète juste pour découvrir qu'il ne s'est rien passé.
 *
 * Pourquoi gdigrab et le fenêtré sans bordure : la capture d'une fenêtre en
 * exclusivité plein écran est bloquée par le pilote sur la plupart des machines.
 * En fenêtré sans bordure l'image est identique à l'œil, et elle se capture.
 *
 * Usage :
 *   node scripts/vivy-copilote-capture.cjs --fenetre "Genshin Impact" --url https://a11.funesterie.me --jeton XXX
 *   node scripts/vivy-copilote-capture.cjs --fenetre "Genshin Impact" --sec        (essai a blanc, rien n'est envoye)
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const { creerCadence } = require(path.join(__dirname, '../src/music/vivy-vision-cadence.cjs'));

const TAILLE_EMPREINTE = 8; // 8x8 = 64 octets

function lireArguments(argv = process.argv.slice(2)) {
  const o = { fenetre: 'Genshin Impact', url: '', jeton: '', sec: false, tick: 500, ffmpeg: 'ffmpeg' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sec') o.sec = true;
    else if (a === '--fenetre') o.fenetre = String(argv[++i] || o.fenetre);
    else if (a === '--url') o.url = String(argv[++i] || '');
    else if (a === '--jeton') o.jeton = String(argv[++i] || '');
    else if (a === '--tick') o.tick = Math.max(100, Number(argv[++i]) || 500);
    else if (a === '--ffmpeg') o.ffmpeg = String(argv[++i] || 'ffmpeg');
  }
  return o;
}

/** Lance ffmpeg et rend sa sortie binaire. Rejette si la fenetre n'existe pas. */
function capturer(ffmpegBin, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin, args, { windowsHide: true });
    const morceaux = [];
    let erreur = '';
    const minuteur = setTimeout(() => { p.kill(); reject(new Error('capture_timeout')); }, timeoutMs);
    p.stdout.on('data', (d) => morceaux.push(d));
    p.stderr.on('data', (d) => { erreur += d.toString(); });
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      const sortie = Buffer.concat(morceaux);
      if (code !== 0 || !sortie.length) {
        // « Could not find window » quand le jeu n'est pas lance : ce n'est pas
        // une panne, c'est une absence. On le distingue pour ne pas alarmer.
        const absente = /could not find window|failed to capture/i.test(erreur);
        return reject(new Error(absente ? 'fenetre_absente' : `ffmpeg_${code}: ${erreur.slice(-200)}`));
      }
      resolve(sortie);
    });
  });
}

/**
 * Cible gdigrab. « desktop » capture l'ecran entier — c'est le repli si Djeff
 * reste en exclusivite plein ecran, ou la fenetre n'est pas capturable. Vivy voit
 * alors aussi ce qui deborde du jeu, mais elle voit.
 */
function cibleGdigrab(fenetre) {
  const nom = String(fenetre || '').trim();
  return (!nom || nom.toLowerCase() === 'desktop' || nom.toLowerCase() === 'bureau')
    ? 'desktop'
    : `title=${nom}`;
}

/** 64 octets de gris : l'empreinte la moins chere possible. */
function argsEmpreinte(fenetre) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'gdigrab', '-framerate', '1', '-i', cibleGdigrab(fenetre),
    '-frames:v', '1',
    '-vf', `scale=${TAILLE_EMPREINTE}:${TAILLE_EMPREINTE},format=gray`,
    '-f', 'rawvideo', '-',
  ];
}

/** L'image pleine, seulement quand la cadence l'a autorisee. */
function argsImage(fenetre, largeur = 960) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'gdigrab', '-framerate', '1', '-i', cibleGdigrab(fenetre),
    '-frames:v', '1',
    '-vf', `scale=${largeur}:-2`,
    '-f', 'mjpeg', '-q:v', '6', '-',
  ];
}

/** Empreinte lisible et comparable : un chiffre hexa par pixel. */
function empreinteDe(buffer) {
  const attendu = TAILLE_EMPREINTE * TAILLE_EMPREINTE;
  if (!buffer || buffer.length < attendu) return '';
  let somme = 0;
  for (let i = 0; i < attendu; i += 1) somme += buffer[i];
  const moyenne = somme / attendu;
  // Quantification sur 16 niveaux autour de la moyenne : robuste au bruit de
  // compression, sensible a un vrai changement de scene.
  let sortie = '';
  for (let i = 0; i < attendu; i += 1) {
    const ecart = Math.max(-1, Math.min(1, (buffer[i] - moyenne) / 64));
    sortie += Math.round((ecart + 1) * 7.5).toString(16);
  }
  return sortie;
}

async function envoyer(url, jeton, image, empreinte) {
  const reponse = await fetch(`${url.replace(/\/+$/, '')}/api/vivy/copilote/observer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/octet-stream',
      'X-Empreinte': empreinte,
    },
    body: image,
    signal: AbortSignal.timeout(15000),
  });
  if (!reponse.ok) throw new Error(`serveur_${reponse.status}`);
  return reponse.json().catch(() => ({}));
}

async function main() {
  const o = lireArguments();
  if (!o.sec && (!o.url || !o.jeton)) {
    console.error('Il faut --url et --jeton, ou --sec pour un essai a blanc.');
    process.exit(2);
  }

  const cadence = creerCadence();
  let tourne = true;
  let fenetreAbsenteDepuis = 0;
  process.on('SIGINT', () => { tourne = false; });

  console.log(`fenetre  : "${o.fenetre}"`);
  console.log(`cadence  : ${o.tick} ms entre deux empreintes`);
  console.log(o.sec ? 'mode     : ESSAI A BLANC, rien n est envoye' : `serveur  : ${o.url}`);
  console.log('Ctrl+C pour arreter.\n');

  while (tourne) {
    const debut = Date.now();
    try {
      const brut = await capturer(o.ffmpeg, argsEmpreinte(o.fenetre));
      const empreinte = empreinteDe(brut);
      fenetreAbsenteDepuis = 0;

      const verdict = cadence.doitAnalyser(empreinte);
      if (verdict.analyser) {
        const image = await capturer(o.ffmpeg, argsImage(o.fenetre), 12000);
        if (o.sec) {
          console.log(`analyse : ${Math.round(image.length / 1024)} Ko  budget ${verdict.budgetRestant}`);
        } else {
          const r = await envoyer(o.url, o.jeton, image, empreinte);
          if (r?.phrase) console.log(`Vivy : ${r.phrase}`);
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (message === 'fenetre_absente') {
        // Le jeu n'est pas lance. On attend sans rien dire, sauf une fois.
        if (!fenetreAbsenteDepuis) console.log(`en attente de la fenetre "${o.fenetre}"…`);
        fenetreAbsenteDepuis = fenetreAbsenteDepuis || Date.now();
      } else {
        console.error(`capture : ${message}`);
      }
    }
    const reste = o.tick - (Date.now() - debut);
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
  }

  const e = cadence.etat();
  console.log(`\nvues ${e.vues}  analysees ${e.analysees}  economie ${(e.economie * 100).toFixed(1)} %`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { argsEmpreinte, argsImage, cibleGdigrab, empreinteDe, lireArguments, TAILLE_EMPREINTE };
