'use strict';

/**
 * Route du Jukebox NUMA — le levier extérieur du passeur.
 *
 * C'est la frontière: jusqu'ici Vivy possédait un système de permissions, à partir
 * d'ici elle agit sur le Drive. Trois principes tiennent la porte.
 *
 * 1. La route n'accepte JAMAIS une URL. Elle accepte une cassette, une zone et un
 *    nom de fichier, et c'est le passeur qui fabrique l'adresse. Une route qui
 *    relaie une URL fournie par l'appelant est un proxy ouvert avec les
 *    identifiants du serveur — la faille classique.
 * 2. Deux temps, deux requêtes: on demande une pièce, puis on l'échange. On
 *    pourrait tout faire d'un coup, mais alors la décision de Cerbère et l'usage
 *    seraient indissociables dans les traces, et une pièce ne serait jamais
 *    observable avant d'être consommée.
 * 3. La pièce voyage par le corps de la requête, jamais par l'URL. Une URL finit
 *    dans les journaux d'accès, l'historique et le referer.
 */

const express = require('express');

const { buildCerbereMegaState } = require('../security/cerbere-mega.cjs');
const { createJukebox, listCassettes } = require('../security/jukebox-numa.cjs');

// Anti-rejeu partagé par le processus. Borné: une pièce vit au plus 300 s, garder
// les nonces au-delà ne protège de rien et fuirait en mémoire.
const NONCES_MAX = 5000;
const noncesVus = new Set();
function retenirNonce(valeur) {
  if (noncesVus.size >= NONCES_MAX) {
    const premier = noncesVus.values().next();
    if (!premier.done) noncesVus.delete(premier.value);
  }
  noncesVus.add(valeur);
}
const registreNonces = {
  has: (n) => noncesVus.has(n),
  add: (n) => retenirNonce(n),
};

function texteCourt(valeur, max = 200) {
  return String(valeur ?? '').trim().slice(0, max);
}

function createVivyDriveRouter({ db = null, vault = null, trace = null, env = process.env } = {}) {
  const router = express.Router();
  const jukebox = createJukebox({ vault, trace, seenNonces: registreNonces, env });
  const corpsJson = express.json({ limit: '256kb' });

  /** Ce que Vivy peut demander. Aucune adresse, aucun identifiant de disque. */
  router.get('/cassettes', (req, res) => {
    return res.json({ ok: true, cassettes: listCassettes() });
  });

  /** Premier temps: Cerbère tranche, la pièce est forgée. */
  router.post('/coin', corpsJson, async (req, res) => {
    try {
      const state = await buildCerbereMegaState({ user: req.user || {}, req, db, env });
      const resultat = await jukebox.requestCoin({
        agent: texteCourt(req.body?.agent || 'vivy', 60),
        drive: texteCourt(req.body?.drive, 60),
        zone: texteCourt(req.body?.zone, 240),
        action: texteCourt(req.body?.action, 20),
        ttlSeconds: Number(req.body?.ttlSeconds) || undefined,
      }, { cerbereState: state });

      if (!resultat.ok) {
        // 403 quand c'est un refus de droit, 400 quand la demande est malformée.
        const refusDeDroit = /session_required|admin_required|family_required|cerbere_denied/.test(String(resultat.error));
        return res.status(refusDeDroit ? 403 : 400).json(resultat);
      }
      return res.json({ ok: true, coin: resultat.coin });
    } catch (error) {
      console.warn('[VivyDrive] coin failed:', String(error?.message || error).slice(0, 140));
      return res.status(500).json({ ok: false, error: 'vivy_drive_coin_failed' });
    }
  });

  /**
   * Second temps: la pièce est échangée contre une action précise.
   *
   * `op` est un verbe fermé, pas un chemin d'API. On ne relaie pas de méthode HTTP
   * choisie par l'appelant: `list` lit un dossier, `read` lit un fichier, `write`
   * écrit un fichier nommé. Rien d'autre n'est atteignable.
   */
  router.post('/exchange', corpsJson, async (req, res) => {
    const coin = req.body?.coin;
    const op = texteCourt(req.body?.op, 20).toLowerCase();
    const drive = texteCourt(req.body?.drive, 60);
    const zone = texteCourt(req.body?.zone, 240);
    const nom = texteCourt(req.body?.name, 160);

    if (!coin?.payload || !coin?.signature) {
      return res.status(400).json({ ok: false, error: 'vivy_drive_coin_missing' });
    }
    if (!['list', 'read', 'write'].includes(op)) {
      return res.status(400).json({ ok: false, error: 'vivy_drive_unknown_op' });
    }
    // Un nom de fichier ne traverse pas de dossier: la zone est déjà le périmètre.
    if (nom && (nom.includes('/') || nom.includes('\\') || nom.includes('..'))) {
      return res.status(400).json({ ok: false, error: 'vivy_drive_bad_name' });
    }
    if ((op === 'read' || op === 'write') && !nom) {
      return res.status(400).json({ ok: false, error: 'vivy_drive_name_required' });
    }

    const sortie = await jukebox.withDrive(
      coin,
      { drive, zone, action: op === 'read' ? 'read' : (op === 'list' ? 'list' : 'write') },
      async ({ appeler }) => {
        if (op === 'list') {
          const r = await appeler(':/children');
          const corps = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error('graph'), { code: `graph_${r.status}` });
          // On ne renvoie que de quoi se repérer, pas la réponse Graph brute: elle
          // contient des URL signées et des identifiants d'utilisateur.
          return (Array.isArray(corps?.value) ? corps.value : []).map((e) => ({
            name: String(e?.name || '').slice(0, 160),
            size: Number(e?.size) || 0,
            folder: Boolean(e?.folder),
            lastModified: String(e?.lastModifiedDateTime || ''),
          }));
        }
        if (op === 'read') {
          const r = await appeler(`${encodeURIComponent(nom)}:/content`);
          if (!r.ok) throw Object.assign(new Error('graph'), { code: `graph_${r.status}` });
          const texte = await r.text();
          return { name: nom, size: texte.length, content: texte.slice(0, 200000) };
        }
        const contenu = String(req.body?.content ?? '');
        const r = await appeler(`${encodeURIComponent(nom)}:/content`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: contenu,
        });
        if (!r.ok) throw Object.assign(new Error('graph'), { code: `graph_${r.status}` });
        return { name: nom, written: contenu.length };
      },
      { sessionId: req.user?.sid || req.user?.sessionId || null }
    );

    if (!sortie.ok) {
      const refus = String(sortie.error || '');
      const statut = refus.startsWith('SCENTGATE_') ? 403
        : (refus === 'jukebox_no_credential' || refus === 'jukebox_drive_not_configured') ? 503
          : 400;
      return res.status(statut).json({ ok: false, error: refus });
    }
    return res.json({ ok: true, result: sortie.result });
  });

  return router;
}

module.exports = createVivyDriveRouter;
