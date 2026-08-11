#!/usr/bin/env node
'use strict';

/**
 * Lanceur du portier ComfyUI.
 *
 * POURQUOI CE FICHIER EXISTE
 * src/video/comfyui-gatekeeper.cjs est une BIBLIOTHEQUE : elle exporte
 * createGatekeeper() et rien ne l'appelait. Le tunnel a11-local-video-win route
 * comfy.funesterie.me vers localhost:8189 en attendant ce portier, mais aucun
 * processus ne l'ecoutait — d'ou le HTTP 530 / error 1033 cote Cloudflare.
 *
 * LE PIEGE DE NOMMAGE, qui justifie de passer la cible explicitement
 * COMFYUI_BASE_URL a DEUX sens opposes dans ce depot :
 *   - pour le CLIENT backend (comfyui-client.cjs), c'est l'URL a appeler, donc
 *     https://comfy.funesterie.me, la facade publique du portier ;
 *   - pour le PORTIER lui-meme, c'est sa cible AMONT, donc http://127.0.0.1:8188.
 * Lancer le portier avec la valeur du client le ferait proxifier vers lui-meme a
 * travers Cloudflare : boucle, ou 401 puisque le jeton n'est pas reexpedie. On ne
 * lit donc jamais COMFYUI_BASE_URL ici : la cible vient de COMFYUI_UPSTREAM_URL,
 * avec 127.0.0.1:8188 par defaut, et on la passe en option explicite.
 *
 * ComfyUI n'a aucune authentification : ne jamais tunneliser 8188 directement.
 *
 * Usage :
 *   node scripts/start-comfy-gatekeeper.cjs
 *   node scripts/start-comfy-gatekeeper.cjs --port 8189 --upstream http://127.0.0.1:8188
 */

const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const PROFIL_ENV = path.join(RACINE, 'a11', 'backend', 'apps', 'server', 'profiles', 'a11.env');
const { createGatekeeper } = require(path.join(
  RACINE, 'a11', 'backend', 'apps', 'server', 'src', 'video', 'comfyui-gatekeeper.cjs'
));

/**
 * Comble process.env depuis a11.env sans jamais ecraser le lanceur : meme regle
 * que a11mcp/src/env-file.ts. L'environnement fourni a la main gagne toujours.
 */
function comblerDepuisProfil(fichier) {
  let texte;
  try {
    texte = fs.readFileSync(fichier, 'utf8');
  } catch {
    return { lues: 0, ajoutees: 0 };
  }
  let lues = 0;
  let ajoutees = 0;
  for (const brut of texte.split(/\r?\n/)) {
    const ligne = brut.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const eq = ligne.indexOf('=');
    if (eq < 1) continue;
    const cle = ligne.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cle)) continue;
    let valeur = ligne.slice(eq + 1).trim();
    if (valeur.length >= 2) {
      const d = valeur[0];
      const f = valeur[valeur.length - 1];
      if ((d === '"' && f === '"') || (d === "'" && f === "'")) valeur = valeur.slice(1, -1);
    }
    lues += 1;
    if (process.env[cle] === undefined || process.env[cle] === '') {
      process.env[cle] = valeur;
      ajoutees += 1;
    }
  }
  return { lues, ajoutees };
}

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

async function main() {
  const profil = comblerDepuisProfil(PROFIL_ENV);
  console.error(
    `[portier] a11.env : ${profil.lues} variable(s) lue(s), ${profil.ajoutees} ajoutee(s)`
  );

  const amont = argument('upstream', process.env.COMFYUI_UPSTREAM_URL || 'http://127.0.0.1:8188');
  const port = Number(argument('port', process.env.COMFYUI_GATEKEEPER_PORT || '8189'));
  const jeton = String(process.env.COMFYUI_TUNNEL_TOKEN || '').trim();

  if (!jeton || jeton.length < 24) {
    console.error(
      '[portier] ARRET : COMFYUI_TUNNEL_TOKEN absent ou trop court (24 signes minimum).\n' +
        '          Il doit etre le MEME que celui du backend a11, qui le lit sous ce nom\n' +
        '          pour signer chaque requete vers le portier.'
    );
    process.exitCode = 1;
    return;
  }

  // Sonde de vie de l'amont AVANT d'ouvrir le port : un portier qui ecoute devant
  // un ComfyUI eteint donne un tunnel « healthy » qui repond 502 a tout, ce qui
  // envoie chercher le probleme du mauvais cote.
  try {
    const r = await fetch(`${amont.replace(/\/+$/, '')}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const v = j && j.system ? j.system.comfyui_version : '?';
      console.error(`[portier] amont ${amont} : ComfyUI ${v} repond`);
    } else {
      console.error(`[portier] amont ${amont} : HTTP ${r.status} — on ouvre quand meme`);
    }
  } catch (erreur) {
    console.error(
      `[portier] AVERTISSEMENT : amont ${amont} injoignable (${erreur.message}).\n` +
        '          Le portier va ecouter, mais tout repondra 502 tant que ComfyUI\n' +
        "          n'ecoute pas sur ce port. Demarre ComfyUI, pas besoin de relancer ceci."
    );
  }

  const portier = createGatekeeper({
    token: jeton,
    target: amont, // explicite : jamais COMFYUI_BASE_URL, voir l'en-tete
    log: (evenement) => {
      // Les refus sont l'information utile : 401 = jeton absent ou faux,
      // 403 = chemin hors liste blanche. Jamais le jeton lui-meme.
      console.error(`[portier] ${JSON.stringify(evenement)}`);
    },
  });

  const reel = await portier.ecouter(port);
  console.error(
    `[portier] ecoute sur 127.0.0.1:${reel} -> ${amont}\n` +
      '[portier] six chemins autorises seulement : GET /system_stats, /object_info,\n' +
      '          /history/{id}, /view?…  POST /prompt, /upload/image\n' +
      "[portier] c'est cloudflared qui sort ; rien n'est expose au reseau local."
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.error(`[portier] ${signal} recu, fermeture`);
      portier.fermer().then(() => process.exit(0));
    });
  }
}

main().catch((erreur) => {
  console.error(`[portier] echec : ${erreur.message}`);
  process.exitCode = 1;
});
