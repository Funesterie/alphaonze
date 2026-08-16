'use strict';

/**
 * jukebox-ticket.cjs — Le droit d'ecouter, pas le fichier.
 *
 * CE QUE CE MODULE NE FAIT PAS, ET NE PEUT PAS FAIRE
 *
 * Empecher quelqu'un de repartir avec la video. Ce qui se joue se capture : au
 * pire on filme l'ecran. Toute promesse contraire est un mensonge, et un
 * mensonge couteux, parce qu'il fait baisser la garde ailleurs.
 *
 * CE QU'IL FAIT
 *
 * Deux choses, et elles suffisent :
 *
 *   1. Un lien copie-colle est MORT a l'arrivee. Le ticket vaut pour UN clip et
 *      UN spectateur, quelques minutes. Colle sur un forum, il ne joue rien.
 *   2. Si un clip ressort quand meme, on sait PAR QUI. Le ticket porte l'identite
 *      du spectateur, et c'est elle qu'on grave dans le filigrane.
 *
 * POURQUOI PAS UN CONTROLE DU REFERER
 *
 * L'ancien garde laissait passer quiconque envoyait un en-tete `Referer`
 * contenant « funesterie ». Un en-tete se falsifie en une ligne : la regle
 * n'arretait donc que ceux qui n'essayaient pas, et bloquait Safari en
 * navigation privee, qui n'en envoie aucun. Un controle qui punit les honnetes
 * et laisse passer les autres est pire que pas de controle : il donne
 * l'impression d'etre protege.
 *
 * On inverse : on ne devine plus qui est un voleur, on ne sert qu'a qui s'est
 * identifie. C'est le sens de la connexion Drive -- l'identite devient la cle.
 *
 * FORME DU TICKET
 *
 *   <charge utile en base64url>.<signature HMAC-SHA256 en base64url>
 *
 * La charge utile est lisible : elle ne contient aucun secret, seulement de quoi
 * dire « ce spectateur, ce clip, jusqu'a telle heure ». La signature est ce qui
 * la rend infalsifiable. Chiffrer serait du theatre : le spectateur connait deja
 * son identite et le clip qu'il regarde.
 */

const crypto = require('node:crypto');

const SCHEMA = 'funesterie.jukebox-ticket.v1';

/**
 * Dix minutes. Assez pour lancer la lecture et pour qu'un lecteur relance une
 * requete Range apres une pause; trop court pour qu'un lien partage serve a
 * quelqu'un d'autre. Le ticket couvre le DROIT d'ouvrir le flux, pas la duree
 * du visionnage : une lecture deja commencee n'est pas coupee.
 */
const TTL_DEFAUT_SECONDES = 600;
const TTL_MAX_SECONDES = 3600;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function nettoyer(valeur, max = 120) {
  return String(valeur == null ? '' : valeur).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function resoudreSecret(explicite, env = process.env) {
  const s = nettoyer(explicite || env.JUKEBOX_TICKET_SECRET || '', 400);
  // Pas de secret par defaut. Un defaut code en dur signifie que n'importe qui
  // ayant lu le depot peut fabriquer des tickets valides -- c'est la meme faute
  // que le `funesterie-default-salt-change-me` retire de quinte-key.cjs.
  if (s.length < 16) {
    throw new Error('JUKEBOX_TICKET_SECRET manquant ou trop court (16 caracteres minimum)');
  }
  return s;
}

function signer(charge, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(charge).digest());
}

/**
 * Fabrique un ticket.
 *
 * `viewerId` est l'identite issue de la connexion Drive. C'est elle qui
 * remontera dans le filigrane : sans elle, un clip qui fuite ne se rattache a
 * personne et le filigrane ne sert a rien.
 */
function emettreTicket({ clipId, viewerId, ttlSeconds = TTL_DEFAUT_SECONDES, secret, now = Date.now() } = {}, env = process.env) {
  const clip = nettoyer(clipId, 200);
  const viewer = nettoyer(viewerId, 120);
  if (!clip) throw new Error('clipId requis');
  if (!viewer) throw new Error('viewerId requis : un ticket anonyme ne se rattache a personne');

  const ttl = Math.min(TTL_MAX_SECONDES, Math.max(30, Math.round(Number(ttlSeconds) || TTL_DEFAUT_SECONDES)));
  const charge = b64url(JSON.stringify({
    s: SCHEMA,
    c: clip,
    v: viewer,
    // Secondes et non millisecondes : le ticket voyage dans une URL.
    exp: Math.floor(now / 1000) + ttl,
    // Rend deux tickets distincts meme emis dans la meme seconde pour le meme
    // spectateur. Sert a tracer une fuite jusqu'a UNE lecture precise.
    n: crypto.randomBytes(9).toString('base64url'),
  }));

  return `${charge}.${signer(charge, resoudreSecret(secret, env))}`;
}

/**
 * Verifie un ticket.
 *
 * Rend toujours un objet, jamais d'exception sur un ticket invalide : c'est une
 * entree venue du reseau, et une exception par requete malformee serait un levier
 * de deni de service.
 */
function verifierTicket(ticket, { secret, clipId = '', now = Date.now() } = {}, env = process.env) {
  const brut = nettoyer(ticket, 800);
  const point = brut.indexOf('.');
  if (point <= 0) return { ok: false, raison: 'forme_invalide' };

  const charge = brut.slice(0, point);
  const signature = brut.slice(point + 1);

  let attendue;
  try {
    attendue = signer(charge, resoudreSecret(secret, env));
  } catch {
    return { ok: false, raison: 'secret_absent' };
  }

  // Comparaison a temps constant. Un `===` sur des chaines s'arrete au premier
  // octet different : le temps de reponse revele alors combien de caracteres
  // sont justes, et une signature se reconstruit octet par octet.
  const a = Buffer.from(signature);
  const b = Buffer.from(attendue);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, raison: 'signature_invalide' };
  }

  let donnees;
  try {
    donnees = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, raison: 'charge_illisible' };
  }
  if (donnees?.s !== SCHEMA) return { ok: false, raison: 'schema_inconnu' };

  // L'expiration se verifie APRES la signature : repondre « expire » sur un
  // ticket non signe apprendrait a l'attaquant que sa charge a ete lue.
  if (Math.floor(now / 1000) > Number(donnees.exp || 0)) {
    return { ok: false, raison: 'expire' };
  }

  // Un ticket vaut pour UN clip. Sans ce controle, un ticket obtenu sur un extrait
  // gratuit ouvrirait tout le catalogue.
  const attenduClip = nettoyer(clipId, 200);
  if (attenduClip && donnees.c !== attenduClip) {
    return { ok: false, raison: 'autre_clip' };
  }

  return {
    ok: true,
    raison: '',
    clipId: donnees.c,
    viewerId: donnees.v,
    nonce: donnees.n,
    expiresAt: new Date(Number(donnees.exp) * 1000).toISOString(),
  };
}

/**
 * Le texte a graver dans le filigrane pour cette lecture.
 *
 * Court, parce qu'il doit rester lisible incruste sur une image; et suffisant
 * pour remonter a une lecture unique via le nonce du ticket.
 */
function marqueDeLecture(verdict) {
  if (!verdict?.ok) return '';
  const empreinte = crypto.createHash('sha256')
    .update(`${verdict.viewerId}|${verdict.nonce}`)
    .digest('hex')
    .slice(0, 10);
  return `NOSSEN · ${verdict.viewerId} · ${empreinte}`;
}

module.exports = {
  SCHEMA,
  TTL_DEFAUT_SECONDES,
  TTL_MAX_SECONDES,
  emettreTicket,
  verifierTicket,
  marqueDeLecture,
};
