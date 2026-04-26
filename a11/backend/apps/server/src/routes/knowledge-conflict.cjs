/**
 * knowledge-conflict.cjs
 *
 * Routes API pour le Knowledge Conflict Resolver (KCR).
 *
 * POST /api/knowledge/resolve     — Résoudre un conflit entre sources
 * POST /api/knowledge/resolve-batch — Résoudre plusieurs conflits en batch
 */

const { Router } = require('express');
const {
  resolveKnowledgeConflict,
  resolveMultipleConflicts,
  SOURCE_WEIGHTS,
} = require('../../lib/knowledge-conflict-resolver.cjs');

function createKnowledgeConflictRouter({ verifyJWT }) {
  const router = Router();

  /**
   * GET /api/knowledge/sources
   * Retourne les types de sources disponibles et leurs poids de base
   */
  router.get('/knowledge/sources', verifyJWT, (_req, res) => {
    return res.json({
      sources: Object.entries(SOURCE_WEIGHTS).map(([type, meta]) => ({
        type,
        label: meta.label,
        baseWeight: meta.base,
      })),
    });
  });

  /**
   * POST /api/knowledge/resolve
   * Résoudre un conflit entre plusieurs sources de connaissances
   *
   * Body: {
   *   sources: [{ type, fact, confidence?, timestamp? }],
   *   queryType?: 'factual' | 'subjective' | 'mixed',
   *   userPreference?: 'recent' | 'reliable' | null
   * }
   */
  router.post('/knowledge/resolve', verifyJWT, (req, res) => {
    const { sources, queryType, userPreference } = req.body || {};

    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'sources doit être un tableau non vide' });
    }

    if (sources.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 sources par résolution' });
    }

    // Valider chaque source
    for (const [i, source] of sources.entries()) {
      if (!source.type || !SOURCE_WEIGHTS[source.type]) {
        return res.status(400).json({
          error: `Source[${i}] : type invalide "${source.type}"`,
          validTypes: Object.keys(SOURCE_WEIGHTS),
        });
      }
      if (!source.fact || typeof source.fact !== 'string') {
        return res.status(400).json({ error: `Source[${i}] : fact manquant ou invalide` });
      }
    }

    const validQueryTypes = ['factual', 'subjective', 'mixed'];
    const resolvedQueryType = validQueryTypes.includes(queryType) ? queryType : 'mixed';

    const validPreferences = ['recent', 'reliable', null, undefined];
    const resolvedPreference = validPreferences.includes(userPreference) ? userPreference : null;

    try {
      const result = resolveKnowledgeConflict({
        sources,
        queryType: resolvedQueryType,
        userPreference: resolvedPreference,
      });

      return res.json(result);
    } catch (err) {
      console.error('[KCR] Erreur résolution:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la résolution du conflit' });
    }
  });

  /**
   * POST /api/knowledge/resolve-batch
   * Résoudre plusieurs groupes de conflits en une seule requête
   *
   * Body: {
   *   groups: [{ topic?, sources, queryType?, userPreference? }],
   *   globalOptions?: { queryType?, userPreference? }
   * }
   */
  router.post('/knowledge/resolve-batch', verifyJWT, (req, res) => {
    const { groups, globalOptions } = req.body || {};

    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: 'groups doit être un tableau non vide' });
    }

    if (groups.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 groupes par batch' });
    }

    try {
      const results = resolveMultipleConflicts(groups, globalOptions || {});
      return res.json({ ok: true, results, count: results.length });
    } catch (err) {
      console.error('[KCR] Erreur batch:', err.message);
      return res.status(500).json({ error: 'Erreur lors de la résolution batch' });
    }
  });

  return router;
}

module.exports = createKnowledgeConflictRouter;
