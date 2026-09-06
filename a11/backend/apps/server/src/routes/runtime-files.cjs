'use strict';
/**
 * Runtime Files Route — /api/agent/runtime/files
 *
 * Donne à A11 la capacité de gérer les fichiers dans le dossier runtime :
 *   - Renommer un fichier ou dossier
 *   - Lister les fichiers d'un sous-dossier
 *   - Supprimer un fichier (avec confirmation explicite)
 *
 * Sécurité :
 *   - JWT requis (monté via verifyJWT dans server.cjs)
 *   - Toutes les opérations sont strictement confinées à PUBLIC_RUNTIME_ROOT
 *   - Path traversal bloqué (résolution + vérification du préfixe)
 *   - Pas d'accès en dehors du runtime, même avec "../../../"
 *
 * Endpoints :
 *   POST   /api/agent/runtime/files/rename   — renommer un fichier/dossier
 *   GET    /api/agent/runtime/files/list     — lister un sous-dossier du runtime
 *   DELETE /api/agent/runtime/files/delete   — supprimer un fichier (non-récursif)
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('../../lib/structured-logger.cjs');
const { getFamilyAdminEmails, normalizeEmail } = require('../config/family-accounts.cjs');

const logger = getLogger({ component: 'runtime-files' });

/**
 * Identifiant de dossier pour un compte. On prefere l'id au courriel: il ne change
 * pas quand l'adresse change, et il ne met pas d'adresse en clair sur le disque.
 */
function resolveAccountSlug(user = {}) {
  const raw = String(user?.id || user?.email || '').trim().toLowerCase();
  return raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function isFamilyAdminRequest(req) {
  const email = normalizeEmail(req?.user?.email);
  if (!email) return false;
  const admins = getFamilyAdminEmails();
  return Array.isArray(admins) ? admins.includes(email) : Boolean(admins?.has?.(email));
}

// ─── Sécurité : confinement au runtime ───────────────────────────────────────

/**
 * Résout un chemin relatif dans le runtime et vérifie qu'il reste bien
 * à l'intérieur de runtimeRoot. Lève une erreur si path traversal détecté.
 */
function resolveRuntimePath(runtimeRoot, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Chemin invalide ou manquant');
  }

  // Nettoyer les séquences dangereuses évidentes
  const cleaned = String(relativePath).trim();
  if (!cleaned) throw new Error('Chemin vide');

  const resolved = path.resolve(runtimeRoot, cleaned);

  // Vérification stricte du préfixe — bloque tout path traversal
  const normalizedRoot = path.normalize(runtimeRoot + path.sep);
  const normalizedResolved = path.normalize(resolved + path.sep);

  if (!normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error(`Accès refusé : chemin hors du runtime (${resolved})`);
  }

  return resolved;
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createRuntimeFilesRouter({ runtimeRoot } = {}) {
  const router = express.Router();

  // runtimeRoot est injecté depuis server.cjs (PUBLIC_RUNTIME_ROOT)
  // Fallback sur la variable d'env si non fourni
  function getRoot() {
    return runtimeRoot
      || process.env.A11_RUNTIME_ROOT
      || path.resolve(__dirname, '..', '..', '..', '..', '..', 'runtime');
  }

  /**
   * Racine de travail d'une requete.
   *
   * Le confinement au runtime bloquait bien la traversee de chemin, mais rien de plus:
   * tout compte connecte pouvait lister et supprimer n'importe quoi dans un runtime
   * partage de plusieurs gigaoctets, qui contient `secrets/`, `auth/`, les personas et
   * les albums de tout le monde. Chaque compte travaille desormais dans son propre
   * sous-arbre. Fondateurs et famille gardent la vue complete, mais seulement en le
   * demandant explicitement -- jamais par defaut.
   */
  function resolveScopedRoot(req) {
    const shared = getRoot();
    const demandePartage = String(req?.query?.scope || req?.body?.scope || '').trim() === 'shared';
    if (demandePartage && isFamilyAdminRequest(req)) {
      return { root: shared, partage: true };
    }
    const slug = resolveAccountSlug(req?.user);
    if (!slug) return null;
    return { root: path.join(shared, 'accounts', slug), partage: false };
  }

  // ── POST /api/agent/runtime/files/rename ──────────────────────────────────
  router.post('/rename', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const { from, to } = req.body || {};

      if (!from || !to) {
        return res.status(400).json({
          ok: false,
          error: 'missing_params',
          message: 'Les champs "from" (chemin actuel) et "to" (nouveau nom/chemin) sont requis.',
        });
      }

      const scope = resolveScopedRoot(req);
      if (!scope) return res.status(401).json({ ok: false, error: 'missing_user' });
      const root = scope.root;
      const fromPath = resolveRuntimePath(root, from);
      const toPath = resolveRuntimePath(root, to);

      // Vérifier que la source existe
      if (!fs.existsSync(fromPath)) {
        return res.status(404).json({
          ok: false,
          error: 'not_found',
          message: `Fichier source introuvable : ${from}`,
        });
      }

      // Vérifier que la destination n'existe pas déjà (sauf si c'est le même fichier)
      if (fs.existsSync(toPath) && fromPath !== toPath) {
        return res.status(409).json({
          ok: false,
          error: 'destination_exists',
          message: `Un fichier existe déjà à la destination : ${to}`,
        });
      }

      // S'assurer que le dossier parent de la destination existe
      const toDir = path.dirname(toPath);
      if (!fs.existsSync(toDir)) {
        fs.mkdirSync(toDir, { recursive: true });
      }

      fs.renameSync(fromPath, toPath);

      logger.info('Runtime file renamed', { userId, from: fromPath, to: toPath });

      return res.json({
        ok: true,
        from: path.relative(root, fromPath),
        to: path.relative(root, toPath),
        message: `Renommé avec succès : ${path.basename(fromPath)} → ${path.basename(toPath)}`,
      });

    } catch (err) {
      logger.error('Runtime rename error', { error: err.message });
      const status = err.message.includes('Accès refusé') ? 403 : 500;
      return res.status(status).json({ ok: false, error: 'rename_failed', message: err.message });
    }
  });

  // ── GET /api/agent/runtime/files/list ─────────────────────────────────────
  router.get('/list', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const subdir = String(req.query?.path || '').trim() || '.';
      const scope = resolveScopedRoot(req);
      if (!scope) return res.status(401).json({ ok: false, error: 'missing_user' });
      const root = scope.root;
      const targetPath = resolveRuntimePath(root, subdir);

      // Un compte qui n'a encore rien stocke n'a pas de dossier: c'est un espace
      // vide, pas une erreur.
      if (!fs.existsSync(targetPath)) {
        if (path.resolve(targetPath) === path.resolve(root)) {
          return res.json({ ok: true, path: '.', entries: [], total: 0, scope: scope.partage ? 'shared' : 'account' });
        }
        return res.status(404).json({
          ok: false,
          error: 'not_found',
          message: `Dossier introuvable : ${subdir}`,
        });
      }

      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({
          ok: false,
          error: 'not_a_directory',
          message: `Le chemin n'est pas un dossier : ${subdir}`,
        });
      }

      const entries = fs.readdirSync(targetPath, { withFileTypes: true }).map((dirent) => {
        const entryPath = path.join(targetPath, dirent.name);
        let size = null;
        let mtime = null;
        try {
          const s = fs.statSync(entryPath);
          size = s.size;
          mtime = s.mtime.toISOString();
        } catch (_) {}

        return {
          name: dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
          path: path.relative(root, entryPath).replace(/\\/g, '/'),
          size,
          mtime,
        };
      });

      return res.json({
        ok: true,
        path: path.relative(root, targetPath).replace(/\\/g, '/') || '.',
        entries,
        total: entries.length,
        scope: scope.partage ? 'shared' : 'account',
      });

    } catch (err) {
      logger.error('Runtime list error', { error: err.message });
      const status = err.message.includes('Accès refusé') ? 403 : 500;
      return res.status(status).json({ ok: false, error: 'list_failed', message: err.message });
    }
  });

  // ── DELETE /api/agent/runtime/files/delete ────────────────────────────────
  // Supprime un fichier unique (pas de dossier, pas de récursif)
  router.delete('/delete', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const filePath = String(req.body?.path || '').trim();
      if (!filePath) {
        return res.status(400).json({
          ok: false,
          error: 'missing_path',
          message: 'Le champ "path" est requis.',
        });
      }

      const scope = resolveScopedRoot(req);
      if (!scope) return res.status(401).json({ ok: false, error: 'missing_user' });
      const root = scope.root;
      const resolved = resolveRuntimePath(root, filePath);

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({
          ok: false,
          error: 'not_found',
          message: `Fichier introuvable : ${filePath}`,
        });
      }

      const stat = fs.statSync(resolved);

      // Refuser la suppression récursive de dossiers
      if (stat.isDirectory()) {
        return res.status(400).json({
          ok: false,
          error: 'is_directory',
          message: 'Suppression de dossiers non supportée via cette route. Utilise /rename pour déplacer.',
        });
      }

      fs.unlinkSync(resolved);

      logger.info('Runtime file deleted', { userId, path: resolved });

      return res.json({
        ok: true,
        path: path.relative(root, resolved).replace(/\\/g, '/'),
        message: `Fichier supprimé : ${path.basename(resolved)}`,
      });

    } catch (err) {
      logger.error('Runtime delete error', { error: err.message });
      const status = err.message.includes('Accès refusé') ? 403 : 500;
      return res.status(status).json({ ok: false, error: 'delete_failed', message: err.message });
    }
  });

  return router;
}

module.exports = createRuntimeFilesRouter;
