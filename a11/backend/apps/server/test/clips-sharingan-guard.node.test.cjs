'use strict';

/**
 * Sharingan Guard: ne pas trollier sa propre production.
 *
 * Le lot du 16 aout a mis ffmpeg, node-fetch et "pas de User-Agent" dans la liste
 * des pirates, puis a fait cette detection AVANT de regarder si l'appel etait
 * interne. Or la chaine de production telecharge les clips avec exactement ces
 * clients: elle recevait donc sharingan_troll.mp4 a la place du clip, sans erreur
 * ni log cote appelant. Ces tests fixent l'ordre des controles et verifient que
 * les trois fichiers de la route parlent bien du meme dossier.
 */

process.env.NOSSEN_CLIPS_DIR = '/tmp/clips-test';
process.env.NOSSEN_INTERNAL_TOKEN = 'jeton-interne-de-test';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/clips/clips-config.cjs');
const mountClipsRoute = require('../clips-addon.cjs');

/** Recupere le handler que clips-addon enregistre sur l'app. */
function handlerDeLaRoute() {
  let handler = null;
  mountClipsRoute({ get(chemin, fn) { handler = fn; } });
  assert.ok(handler, 'la route /clips/:filename doit etre enregistree');
  return handler;
}

/** Requete minimale: seuls les entetes et le nom de fichier comptent ici. */
function requete({ ua = 'Mozilla/5.0', filename = 'clip.mp4', entetes = {}, user = null } = {}) {
  const headers = { 'user-agent': ua, ...entetes };
  return { headers, params: { filename }, user };
}

/** Reponse qui note ce qu'on lui demande au lieu d'ecrire sur une socket. */
function reponse() {
  const vu = { fichier: null, redirection: null, code: null, corps: null };
  const res = {
    headersSent: false,
    sendFile(chemin) { vu.fichier = chemin; return res; },
    redirect(code, url) { vu.redirection = url; return res; },
    status(code) { vu.code = code; return res; },
    json(corps) { vu.corps = corps; return res; },
  };
  return { res, vu };
}

function appeler(handler, req) {
  const { res, vu } = reponse();
  handler(req, res);
  return vu;
}

test('un appel interne en ffmpeg recoit le clip, pas la video troll', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({
    ua: 'Lavf/60.16.100 ffmpeg',
    entetes: { [config.INTERNAL_HEADER]: 'jeton-interne-de-test' },
  }));
  assert.equal(vu.fichier, '/tmp/clips-test/clip.mp4');
  assert.equal(vu.redirection, null, 'pas de redirection paywall pour un interne');
});

test('un appel interne sans User-Agent recoit le clip', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({
    ua: '',
    entetes: { [config.INTERNAL_HEADER]: 'jeton-interne-de-test' },
  }));
  assert.equal(vu.fichier, '/tmp/clips-test/clip.mp4');
});

test('un utilisateur authentifie en ffmpeg recoit le clip', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({ ua: 'ffmpeg/6.1', user: { id: 'u-42' } }));
  assert.equal(vu.fichier, '/tmp/clips-test/clip.mp4');
});

test('un ripper anonyme recoit toujours la video troll', () => {
  const handler = handlerDeLaRoute();
  for (const ua of ['yt-dlp/2024.03.10', 'ffmpeg/6.1', 'wget/1.21', '']) {
    const vu = appeler(handler, requete({ ua }));
    assert.equal(vu.fichier, '/tmp/clips-test/sharingan_troll.mp4', `UA rejete: ${ua || '(vide)'}`);
  }
});

test('un jeton interne faux ne vaut pas mieux qu aucun jeton', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({
    ua: 'ffmpeg/6.1',
    entetes: { [config.INTERNAL_HEADER]: 'mauvais-jeton' },
  }));
  assert.equal(vu.fichier, '/tmp/clips-test/sharingan_troll.mp4');
});

test('un hotlink externe sans session part au paiement', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }));
  assert.equal(vu.fichier, null);
  assert.ok(vu.redirection && vu.redirection.includes('stripe'), 'redirection vers Stripe attendue');
});

test('le lecteur de nos propres pages passe', () => {
  const handler = handlerDeLaRoute();
  const vu = appeler(handler, requete({
    ua: 'Mozilla/5.0 (Windows NT 10.0)',
    entetes: { referer: 'https://a11.funesterie.me/nossen' },
  }));
  assert.equal(vu.fichier, '/tmp/clips-test/clip.mp4');
});

test('un nom de fichier avec separateur ou mauvaise extension est refuse', () => {
  const handler = handlerDeLaRoute();
  const interne = { [config.INTERNAL_HEADER]: 'jeton-interne-de-test' };

  const traversee = appeler(handler, requete({ filename: '../secret.mp4', entetes: interne }));
  assert.equal(traversee.code, 400);
  assert.equal(traversee.fichier, null);

  const extension = appeler(handler, requete({ filename: 'passwords.env', entetes: interne }));
  assert.equal(extension.code, 403);
  assert.equal(extension.fichier, null);
});

test('lecteurs et producteurs de clips designent le meme dossier', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const racine = path.join(__dirname, '..');
  // Cote lecture: la route et ses deux injecteurs.
  // Cote ecriture: le generateur et le suivi des jobs. Un producteur qui ecrit
  // ailleurs que la ou le serveur lit produit des clips introuvables.
  const fichiers = [
    'clips-addon.cjs',
    'patch-clips-route.cjs',
    'src/clips/sharingan-clips-guard.cjs',
    'src/clips/clip-generator-v2.cjs',
    'src/clips/clip-jobs.cjs',
  ];
  for (const f of fichiers) {
    const source = fs.readFileSync(path.join(racine, f), 'utf8');
    assert.ok(!source.includes("'/agent-bus/clips'"),
      `${f} code encore l'ancien dossier en dur`);
  }
});

test('le generateur et le serveur lisent la meme constante', () => {
  const { CLIPS_DIR } = require('../src/clips/clips-config.cjs');
  assert.equal(CLIPS_DIR, '/tmp/clips-test',
    'CLIPS_DIR doit suivre NOSSEN_CLIPS_DIR pour tous les consommateurs');
});
