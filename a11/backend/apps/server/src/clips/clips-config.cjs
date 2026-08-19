'use strict';

/**
 * Source unique de verite pour la route /clips et le Sharingan Guard.
 *
 * Contexte: le lot du 16 aout a introduit trois fichiers qui decident chacun
 * de leur cote ou vivent les clips et qui a le droit de les lire. Les valeurs
 * par defaut ont diverge (/agent-bus/clips contre /app/runtime/clips) et la
 * detection de rippers, faite au User-Agent, attrapait la production elle-meme:
 * ffmpeg et node-fetch sont dans la liste des pirates, et ce sont exactement les
 * clients qu'utilise la chaine interne. Resultat: nos propres appels recevaient
 * la video troll a la place du clip.
 *
 * Ce module centralise le chemin, l'URL de paiement et la reconnaissance des
 * appels internes, pour que les trois fichiers ne puissent plus diverger.
 */

const crypto = require('node:crypto');

// Chemin du volume partage. Aligne sur f93916b, qui est le dernier a avoir
// tranche: /app/runtime/clips. Les autres fichiers pointaient encore sur
// /agent-bus/clips, herite d'avant le passage au volume partage.
const CLIPS_DIR = process.env.NOSSEN_CLIPS_DIR || '/app/runtime/clips';

const TROLL_VIDEO = 'sharingan_troll.mp4';

const CHECKOUT_URL = process.env.NOSSEN_CLIP_CHECKOUT_URL
  || 'https://checkout.stripe.com/c/pay/cs_live_a14rOvdZoDl6OYYaz0pK4pIbAjPbQyiN4n1vfvJSk6UFJaimfP7wUYNgm7';

// Entete par laquelle un service interne se declare. On compare a un secret
// partage plutot qu'a un User-Agent: un UA se falsifie en une ligne, donc il ne
// peut ni prouver qu'un appel est interne, ni prouver le contraire.
const INTERNAL_HEADER = 'x-funesterie-internal';

function secretsEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Liste d'User-Agents explicitement autorises, pour les clients internes qui ne
 * peuvent pas poser d'entete (un ffmpeg lance en ligne de commande, par exemple).
 * Vide par defaut: c'est une derogation, pas le mecanisme principal.
 */
function allowedUserAgents() {
  return String(process.env.NOSSEN_INTERNAL_USER_AGENTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Un appel est interne si le serveur l'a deja marque comme tel, s'il presente le
 * secret partage, ou si son User-Agent figure dans la derogation explicite.
 *
 * Volontairement, l'adresse IP n'entre pas dans la decision: derriere un reverse
 * proxy toutes les requetes arrivent depuis une adresse privee, et se fier a
 * l'IP desactiverait le paywall pour tout le monde.
 */
function isInternalRequest(req) {
  if (!req) return false;
  if (req.internalService) return true;

  const token = process.env.NOSSEN_INTERNAL_TOKEN;
  const presented = req.headers ? req.headers[INTERNAL_HEADER] : null;
  if (token && presented && secretsEqual(presented, token)) return true;

  const allow = allowedUserAgents();
  if (allow.length) {
    const ua = String((req.headers && req.headers['user-agent']) || '').toLowerCase();
    if (ua && allow.some((frag) => ua.includes(frag))) return true;
  }

  return false;
}

/** Un porteur de session valide n'est jamais traite comme un pirate. */
function isAuthenticated(req) {
  if (!req) return false;
  if (req.user && req.user.id) return true;
  if (req.cookies && req.cookies.session) return true;
  return false;
}

/** Le lecteur de nos propres pages: referer sur un domaine funesterie. */
function isOwnSiteReferer(req) {
  const ref = String((req && req.headers && (req.headers.referer || req.headers.origin)) || '');
  return ref.includes('funesterie');
}

module.exports = {
  CLIPS_DIR,
  TROLL_VIDEO,
  CHECKOUT_URL,
  INTERNAL_HEADER,
  isInternalRequest,
  isAuthenticated,
  isOwnSiteReferer,
};
