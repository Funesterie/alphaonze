'use strict';

// Portier devant ComfyUI, a exposer a la place de ComfyUI.
//
// ComfyUI n'a AUCUNE authentification. Le tunneliser tel quel donnerait a
// quiconque trouve l'URL le droit de faire tourner des graphes arbitraires sur
// la carte de la machine — et certains noeuds lisent ou ecrivent des fichiers.
// Une URL Cloudflare n'est pas un secret : elle apparait dans les journaux, les
// historiques, les captures d'ecran.
//
// Ce proxy impose donc trois choses :
//   1. un jeton porteur sur CHAQUE requete, compare en temps constant ;
//   2. une liste blanche de chemins — le strict necessaire pour generer ;
//   3. un plafond de taille de corps, pour qu'un graphe ne serve pas de vecteur.
//
// Il ne remplace pas Cloudflare Access, il le complete : si le jeton fuit, Access
// reste la seconde porte ; si Access est mal configure, le jeton reste la premiere.

const http = require('node:http');
const crypto = require('node:crypto');

const CIBLE_DEFAUT = 'http://127.0.0.1:8188';
const TAILLE_MAX = 8 * 1024 * 1024; // un graphe JSON, pas un televersement de modele

// Le minimum pour soumettre un travail et en recuperer le resultat. Tout le
// reste — /userdata, /internal, l'interface — reste inaccessible depuis dehors.
const CHEMINS_AUTORISES = [
  { methode: 'GET', motif: /^\/system_stats$/ },
  { methode: 'GET', motif: /^\/object_info(\/[^/]+)?$/ },
  { methode: 'GET', motif: /^\/history\/[\w-]+$/ },
  { methode: 'GET', motif: /^\/view\?/ },
  { methode: 'POST', motif: /^\/prompt$/ },
  { methode: 'POST', motif: /^\/upload\/image$/ },
];

function cheminAutorise(methode, url) {
  return CHEMINS_AUTORISES.some((r) => r.methode === methode && r.motif.test(url));
}

// Comparaison en temps constant : une comparaison naive laisse deviner le jeton
// octet par octet en mesurant le temps de reponse.
function jetonValide(fourni, attendu) {
  const a = Buffer.from(String(fourni || ''), 'utf8');
  const b = Buffer.from(String(attendu || ''), 'utf8');
  if (a.length !== b.length || !b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extraireJeton(req) {
  const entete = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(entete)) return entete.replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-comfy-token'] || '').trim();
}

function createGatekeeper(options = {}) {
  const env = options.env || process.env;
  const jeton = String(options.token || env.COMFYUI_TUNNEL_TOKEN || '').trim();
  const cible = new URL(String(options.target || env.COMFYUI_BASE_URL || CIBLE_DEFAUT));
  const journal = options.log || (() => {});

  if (!jeton || jeton.length < 24) {
    throw new Error('comfyui-gatekeeper: COMFYUI_TUNNEL_TOKEN absent ou trop court (24 signes minimum)');
  }

  const serveur = http.createServer((req, res) => {
    const refus = (code, raison) => {
      journal({ niveau: 'refus', code, raison, url: req.url, methode: req.method });
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: raison }));
    };

    if (!jetonValide(extraireJeton(req), jeton)) return refus(401, 'jeton invalide');
    if (!cheminAutorise(req.method, req.url || '')) return refus(403, 'chemin non autorise');

    // Le jeton ne doit pas etre transmis a ComfyUI, mais une entete a `undefined`
    // fait lever http.request de facon synchrone : il faut supprimer la cle.
    const entetes = { ...req.headers, host: cible.host };
    delete entetes.authorization;
    delete entetes['x-comfy-token'];

    const amont = http.request(
      {
        hostname: cible.hostname,
        port: cible.port || 80,
        path: req.url,
        method: req.method,
        headers: entetes,
      },
      (rep) => {
        res.writeHead(rep.statusCode || 502, rep.headers);
        rep.pipe(res);
      }
    );

    amont.on('error', (erreur) => {
      journal({ niveau: 'erreur', message: erreur.message });
      if (!res.headersSent) refus(502, `ComfyUI injoignable : ${erreur.message}`);
    });

    let recu = 0;
    req.on('data', (bloc) => {
      recu += bloc.length;
      if (recu > TAILLE_MAX) {
        req.destroy();
        amont.destroy();
        if (!res.headersSent) refus(413, 'corps trop volumineux');
      }
    });
    req.pipe(amont);
  });

  return {
    serveur,
    ecouter(port = Number(env.COMFYUI_GATEKEEPER_PORT) || 8189) {
      return new Promise((resolve) => {
        // 127.0.0.1 seulement : c'est cloudflared qui sort, pas le reseau local.
        // On rend le port REELLEMENT attribue : avec 0, le systeme en choisit un,
        // et rendre le 0 demande enverrait l'appelant dans le vide.
        serveur.listen(port, '127.0.0.1', () => resolve(serveur.address().port));
      });
    },
    fermer() {
      return new Promise((resolve) => serveur.close(resolve));
    },
  };
}

module.exports = { CHEMINS_AUTORISES, TAILLE_MAX, cheminAutorise, createGatekeeper, jetonValide };
