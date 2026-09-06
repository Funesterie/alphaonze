'use strict';

/**
 * Jukebox NUMA — le passeur entre Vivy et les disques.
 *
 * Design de Djeff (09/08/2026): chaque Drive est une cassette. Vivy ne reçoit
 * jamais le jeton OAuth, seulement une pièce temporaire — cet agent, ce disque,
 * cette zone, cette action, ce temps. Cerbère décide, ScentGate signe, le coffre
 * garde les vraies clés, BLOOP trace ce qui a été fait sans jamais noter la clé.
 *
 * Le choix de conception qui porte tout le reste: `withDrive` ne REND PAS le jeton.
 * Une fonction qui renverrait la clé après vérification aurait déplacé le problème
 * d'un cran, pas résolu: l'appelant la garderait en mémoire, la journaliserait un
 * jour, la passerait à un tiers. Le passeur exécute donc l'appel lui-même et ne
 * prête qu'un `fetch` déjà borné à la zone. La clé ne quitte pas ce module.
 *
 * Le choix du slot est une table bête et déterministe. C'est délibéré: si une
 * énigme NUMA choisissait le disque, une mauvaise résolution ne serait pas une
 * faille, ce serait Vivy qui écrit un master chez quelqu'un d'autre — un bug
 * silencieux et pénible. ZEN et NUMA gardent leur place sur le stockage au repos
 * et la présentation, jamais entre la demande et la décision.
 */

// @nossen/scentgate est en ESM pur. Le conteneur de prod tourne sur Node 20, qui ne
// sait pas require() un module ESM -- cette capacite n'arrive qu'en Node 22.12. Un
// require() ici passe en local (Node 24) et casse en production. On charge donc en
// import dynamique, une seule fois, la promesse etant mise en cache.
let scentgatePromesse = null;
function chargerScentGate() {
  if (!scentgatePromesse) scentgatePromesse = import('@nossen/scentgate');
  return scentgatePromesse;
}

const fs = require('node:fs');
const path = require('node:path');

const { authorizeCerbereMega } = require('./cerbere-mega.cjs');

/**
 * Table des cassettes. Déterministe, explicite, relue d'un coup d'oeil.
 * `capability` est la permission Cerbère exigée pour obtenir une pièce.
 */
/**
 * Deux modes d'authentification, et ils ne se mélangent pas.
 *
 *   delegated   — jeton de session de l'utilisateur, pris dans le coffre. Il a un
 *                 /me, donc /me/drive fonctionne.
 *   application — jeton client_credentials du serveur. Il n'a AUCUN /me: sans
 *                 utilisateur, il n'y a pas de « moi ». Toute URL doit passer par
 *                 un driveId explicite, sinon Graph rend 400 sur chaque appel.
 *
 * Cette distinction a coûté un bug: la première version du passeur écrivait
 * /me/drive pour les deux, alors que la documentation de la sonde disait déjà
 * l'inverse deux fichiers plus loin.
 */
const CASSETTES = Object.freeze({
  perso: Object.freeze({
    label: 'OneDrive personnel (session utilisateur)',
    auth: 'delegated',
    provider: 'microsoft',
    capability: 'oauth:microsoft:personal',
    base: () => 'https://graph.microsoft.com/v1.0/me/drive/root:',
  }),
  entra: Object.freeze({
    label: 'Bibliothèque du locataire Entra (app-only)',
    auth: 'application',
    provider: 'microsoft',
    capability: 'files:own',
    // Le driveId est configuré, jamais deviné: le découvrir à chaud ferait dépendre
    // une écriture d'un listing qui peut changer d'ordre.
    base: (env) => {
      const id = String(env.JUKEBOX_ENTRA_DRIVE_ID || '').trim();
      return id ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(id)}/root:` : '';
    },
  }),
  // Compartiment réservé pour plus tard: un site SharePoint dédié à K44, afin de
  // séparer les rôles au lieu de donner à tout le monde le même coffre. Inerte tant
  // que JUKEBOX_K44_DRIVE_ID n'est pas posé.
  k44: Object.freeze({
    label: 'SharePoint K44 (compartiment dédié)',
    auth: 'application',
    provider: 'microsoft',
    capability: 'files:own',
    base: (env) => {
      const id = String(env.JUKEBOX_K44_DRIVE_ID || '').trim();
      return id ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(id)}/root:` : '';
    },
  }),
  google: Object.freeze({
    label: 'Google Drive (session utilisateur)',
    auth: 'delegated',
    provider: 'google',
    capability: 'oauth:google:personal',
    base: () => 'https://www.googleapis.com/drive/v3',
  }),
});

function listCassettes() {
  return Object.entries(CASSETTES).map(([cle, c]) => ({ drive: cle, label: c.label, provider: c.provider }));
}

function resolveCassette(drive) {
  const cle = String(drive || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CASSETTES, cle) ? { cle, ...CASSETTES[cle] } : null;
}

/**
 * Secret de signature. Jamais de valeur par défaut: pas de secret, pas de pièce.
 *
 * Le fichier prime sur la variable, comme partout ailleurs dans Funesterie
 * (azure_client_secret, suno_api_key): un secret en variable d'environnement se
 * retrouve dans `docker inspect`, dans les journaux de démarrage et dans tout
 * `env` lancé par curiosité.
 */
function resolveSigningSecret(env = process.env) {
  const fichiers = [
    env.JUKEBOX_CAPABILITY_SECRET_FILE,
    '/app/runtime/secrets/jukebox_capability_secret',
  ].filter(Boolean);
  for (const chemin of fichiers) {
    try {
      const valeur = fs.readFileSync(path.resolve(chemin), 'utf8').trim();
      if (valeur) return valeur;
    } catch (_) {
      // fichier optionnel: on tente le suivant
    }
  }
  return String(env.JUKEBOX_CAPABILITY_SECRET || env.SCENTGATE_SIGNAL_SECRET || '').trim();
}

/**
 * Fabrique un passeur.
 *
 * @param {object} o
 * @param {object} o.vault      coffre OAuth (getSessionProviderTokens)
 * @param {Function} [o.trace]  ({event, agent, drive, zone, action, outcome}) => void — BLOOP
 * @param {Set} [o.seenNonces]  anti-rejeu partagé; fourni par l'appelant, jamais global
 */
function createJukebox({ vault, trace = null, seenNonces = new Set(), env = process.env } = {}) {
  const secret = resolveSigningSecret(env);
  const audience = String(env.JUKEBOX_AUDIENCE || 'a11-backend').trim();
  const issuer = String(env.JUKEBOX_ISSUER || 'jukebox-numa').trim();

  function tracer(evenement) {
    if (typeof trace !== 'function') return;
    try {
      // BLOOP garde la trace de l'usage, jamais de la clé ni de la pièce entière.
      trace({ ...evenement, at: new Date().toISOString() });
    } catch (_) {
      // Une trace qui casse ne doit jamais empêcher — ni autoriser — un accès.
    }
  }

  /**
   * Cerbère décide, puis on forge. Dans cet ordre: forger d'abord reviendrait à
   * fabriquer un droit avant de savoir s'il est dû.
   */
  async function requestCoin({ agent, drive, zone, action, ttlSeconds } = {}, { cerbereState } = {}) {
    if (!secret) {
      return { ok: false, error: 'jukebox_secret_missing', message: 'Aucun secret de signature configuré.' };
    }
    const { createScentGateCapability, SCENT_GATE_CAPABILITY_ACTIONS } = await chargerScentGate();
    const cassette = resolveCassette(drive);
    if (!cassette) {
      return { ok: false, error: 'jukebox_unknown_drive', message: `Cassette inconnue: ${drive}` };
    }
    const acte = String(action || '').trim().toLowerCase();
    if (!SCENT_GATE_CAPABILITY_ACTIONS.includes(acte)) {
      return { ok: false, error: 'jukebox_unknown_action', message: `Action non délivrable: ${action}` };
    }

    const verdict = authorizeCerbereMega(cerbereState || {}, cassette.capability);
    if (!verdict?.allowed) {
      tracer({ event: 'capability.denied', agent, drive: cassette.cle, zone, action: acte, outcome: verdict?.error || 'refuse' });
      return { ok: false, error: verdict?.error || 'cerbere_denied', message: verdict?.message || 'Refusé par Cerbère.' };
    }

    try {
      const piece = createScentGateCapability(
        { agent, drive: cassette.cle, zone, action: acte, issuer, audience, ttlSeconds },
        { secret }
      );
      tracer({ event: 'capability.granted', agent, drive: cassette.cle, zone: piece.payload.zone, action: acte, outcome: 'ok' });
      return { ok: true, coin: piece };
    } catch (error) {
      // Une zone refusée est une erreur d'appelant, pas un incident: on la nomme.
      return {
        ok: false,
        error: String(error?.code || 'jukebox_forge_failed'),
        message: String(error?.message || 'Forge impossible.').slice(0, 200),
      };
    }
  }

  /**
   * Échange une pièce contre un accès borné, le temps d'une fonction.
   *
   * `fn` reçoit `{ appeler }`, où `appeler(cheminRelatif, init)` fait la requête
   * autorisee. Le jeton n'est ni retourne, ni passe en argument, ni journalise.
   */
  async function withDrive(coin, requested, fn, { sessionId } = {}) {
    if (typeof fn !== 'function') throw new TypeError('withDrive attend une fonction');
    if (!secret) return { ok: false, error: 'jukebox_secret_missing' };

    const { verifyScentGateCapability } = await chargerScentGate();
    const verdict = verifyScentGateCapability(coin, {
      secret,
      expectedAudience: audience,
      seenNonces,
      requested,
    });
    if (!verdict.ok) {
      tracer({
        event: 'capability.rejected',
        drive: requested?.drive, zone: requested?.zone, action: requested?.action,
        outcome: verdict.error,
      });
      return { ok: false, error: verdict.error };
    }

    const payload = verdict.payload;
    const cassette = resolveCassette(payload.drive);
    if (!cassette) return { ok: false, error: 'jukebox_unknown_drive' };

    // L'URL de base doit exister AVANT de chercher une clef: une cassette
    // applicative sans driveId configuré ne mène nulle part, autant le dire tout de
    // suite plutot que d'aller chercher un jeton pour rien.
    const racine = typeof cassette.base === 'function' ? cassette.base(env) : String(cassette.base || '');
    if (!racine) {
      tracer({ event: 'capability.no_route', agent: payload.agent, drive: payload.drive, zone: payload.zone, action: payload.action, outcome: 'drive_id_absent' });
      return { ok: false, error: 'jukebox_drive_not_configured' };
    }

    let jeton = '';
    try {
      if (cassette.auth === 'application') {
        // Jeton serveur: pas d'utilisateur, donc pas de session a fournir.
        const { getGraphToken } = require('../auth/azure-graph-client.cjs');
        const resultat = await getGraphToken(env);
        jeton = String(typeof resultat === 'string' ? resultat : (resultat?.accessToken || '')).trim();
      } else {
        const tokens = await vault?.getSessionProviderTokens?.({ sessionId, provider: cassette.provider });
        jeton = String(tokens?.accessToken || tokens?.access_token || '').trim();
      }
    } catch (_) {
      jeton = '';
    }
    if (!jeton) {
      tracer({ event: 'capability.no_key', agent: payload.agent, drive: payload.drive, zone: payload.zone, action: payload.action, outcome: 'coffre_vide' });
      return { ok: false, error: 'jukebox_no_credential' };
    }

    // Le fetch prêté est borné deux fois: par la zone de la pièce, et par la
    // cassette. Un chemin absolu ou remontant est refusé ici aussi — la
    // vérification de la pièce ne protège que ce qu'on lui a déclaré.
    const appeler = async (cheminRelatif = '', init = {}) => {
      const suffixe = String(cheminRelatif || '').replace(/^\/+/, '');
      if (suffixe.includes('..') || suffixe.includes('\0')) {
        throw Object.assign(new Error('chemin hors zone'), { code: 'jukebox_path_escape' });
      }
      const cible = `${racine}${payload.zone}${suffixe ? `/${suffixe}` : ''}`;
      const entetes = { ...(init.headers || {}), authorization: `Bearer ${jeton}` };
      return fetch(cible, { ...init, headers: entetes });
    };

    try {
      const resultat = await fn({ appeler, zone: payload.zone, drive: payload.drive });
      tracer({ event: 'capability.used', agent: payload.agent, drive: payload.drive, zone: payload.zone, action: payload.action, outcome: 'ok' });
      return { ok: true, result: resultat };
    } catch (error) {
      tracer({ event: 'capability.failed', agent: payload.agent, drive: payload.drive, zone: payload.zone, action: payload.action, outcome: String(error?.code || 'erreur') });
      return { ok: false, error: String(error?.code || 'jukebox_call_failed') };
    } finally {
      // On ne peut pas effacer une chaîne en JS, mais on coupe la référence: le
      // jeton ne survit pas à la portée de l'échange.
      jeton = '';
    }
  }

  return { requestCoin, withDrive, listCassettes };
}

module.exports = {
  createJukebox,
  listCassettes,
  resolveCassette,
  CASSETTES,
};
