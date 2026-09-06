'use strict';

/**
 * Donnees d'un compte — /api/account/data
 *
 * Djeff a demande de pouvoir supprimer ce qu'un compte stocke, « ca peut servir a ceux
 * qui tiennent a leur vie privee et a liberer de la place ». Deux besoins distincts:
 * savoir ce qu'on garde, et pouvoir l'effacer.
 *
 * Ce module ne reimplemente pas les suppressions qui existent deja -- l'historique
 * (DELETE /api/a11/history) et le corpus voix (DELETE /api/voice-learning/corpus) ont
 * leur propre logique, transactionnelle et delicate. Il apporte ce qui manquait: un
 * recapitulatif chiffre, et la purge des fichiers du compte.
 *
 * Endpoints:
 *   GET    /api/account/data/summary  — ce que le compte stocke, avec les tailles
 *   DELETE /api/account/data/files    — purge les fichiers du compte (confirmation requise)
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { getLogger } = require('../../lib/structured-logger.cjs');

const logger = getLogger({ component: 'account-data' });

const MAX_WALK_ENTRIES = 20000;

/** Meme regle que le cloisonnement des fichiers runtime: un compte, un sous-arbre. */
function resolveAccountSlug(user = {}) {
  const raw = String(user?.id || user?.email || '').trim().toLowerCase();
  return raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/**
 * Taille et nombre de fichiers d'un dossier. Borne volontairement: un compte qui
 * aurait des dizaines de milliers de fichiers ne doit pas bloquer la reponse.
 */
function mesurerDossier(dir) {
  let fichiers = 0;
  let octets = 0;
  let tronque = false;
  const pile = [dir];

  while (pile.length) {
    const courant = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(courant, { withFileTypes: true }); } catch { continue; }
    for (const entree of entrees) {
      if (fichiers >= MAX_WALK_ENTRIES) { tronque = true; break; }
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) { pile.push(complet); continue; }
      try {
        octets += fs.statSync(complet).size;
        fichiers += 1;
      } catch { /* fichier disparu entre-temps */ }
    }
    if (tronque) break;
  }
  return { fichiers, octets, tronque };
}

function createAccountDataRouter({ verifyJWT, db, runtimeRoot } = {}) {
  const router = express.Router();

  // Meme parti pris que pour la transcription: sans garde fournie, on refuse.
  const garde = typeof verifyJWT === 'function'
    ? verifyJWT
    : (_req, res) => res.status(503).json({ ok: false, error: 'auth_guard_missing' });

  function resolveAccountDir(req) {
    const slug = resolveAccountSlug(req?.user);
    if (!slug) return '';
    const racine = runtimeRoot || process.env.A11_RUNTIME_ROOT || '';
    if (!racine) return '';
    return path.join(racine, 'accounts', slug);
  }

  // ── GET /api/account/data/summary ─────────────────────────────────────────
  router.get('/summary', garde, async (req, res) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

    const resume = {
      ok: true,
      conversations: { disponible: false, conversations: 0, messages: 0 },
      fichiers: { fichiers: 0, octets: 0, tronque: false },
    };

    if (db) {
      try {
        const r = await db.query(
          `SELECT COUNT(DISTINCT COALESCE(conversation_id, 'default')) AS conversations,
                  COUNT(*) AS messages
             FROM messages
            WHERE user_id = $1`,
          [userId]
        );
        const ligne = r?.rows?.[0] || {};
        resume.conversations = {
          disponible: true,
          conversations: Number(ligne.conversations || 0),
          messages: Number(ligne.messages || 0),
        };
      } catch (error) {
        // Une base indisponible ne doit pas priver l'utilisateur du reste du bilan.
        logger.warn('Comptage des conversations impossible', { error: error?.message });
      }
    }

    const dossier = resolveAccountDir(req);
    if (dossier && fs.existsSync(dossier)) {
      resume.fichiers = mesurerDossier(dossier);
    }

    resume.octetsTotal = resume.fichiers.octets;
    return res.json(resume);
  });

  // ── DELETE /api/account/data/files ────────────────────────────────────────
  router.delete('/files', garde, express.json({ limit: '16kb' }), (req, res) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

    // Une suppression definitive ne doit jamais partir d'un clic accidentel.
    if (req.body?.confirm !== true && String(req.query?.confirm || '') !== 'true') {
      return res.status(400).json({
        ok: false,
        error: 'missing_confirmation',
        message: 'Confirmation requise : envoie confirm:true pour supprimer definitivement tes fichiers.',
      });
    }

    const dossier = resolveAccountDir(req);
    if (!dossier) return res.status(500).json({ ok: false, error: 'runtime_root_missing' });

    if (!fs.existsSync(dossier)) {
      return res.json({ ok: true, supprimes: 0, octetsLiberes: 0, message: 'Aucun fichier a supprimer.' });
    }

    const avant = mesurerDossier(dossier);
    try {
      fs.rmSync(dossier, { recursive: true, force: true });
    } catch (error) {
      logger.error('Purge des fichiers du compte impossible', { userId, error: error?.message });
      return res.status(500).json({ ok: false, error: 'purge_failed', message: error?.message });
    }

    logger.info('Fichiers du compte supprimes', { userId, fichiers: avant.fichiers, octets: avant.octets });
    return res.json({
      ok: true,
      supprimes: avant.fichiers,
      octetsLiberes: avant.octets,
      message: `${avant.fichiers} fichier(s) supprimé(s).`,
    });
  });

  return router;
}

module.exports = createAccountDataRouter;
module.exports.mesurerDossier = mesurerDossier;
module.exports.resolveAccountSlug = resolveAccountSlug;
