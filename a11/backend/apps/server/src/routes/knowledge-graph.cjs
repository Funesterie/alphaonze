// knowledge-graph.cjs
// Routes API pour le graphe de connaissances

const express = require('express');
const { createKnowledgeGraph, extractTriplets } = require('../../lib/knowledge-graph.cjs');

function createKnowledgeGraphRouter({ verifyJWT } = {}) {
  const router = express.Router();

  // POST /api/knowledge-graph/extract - Extraire des triplets d'un texte
  router.post('/api/knowledge-graph/extract', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const text = String(req.body?.text || '').trim();

      if (!userId || !text) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and text are required',
        });
      }

      const triplets = await extractTriplets(text);

      return res.json({
        ok: true,
        text: text.slice(0, 100),
        tripletCount: triplets.length,
        triplets,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph extract failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'extract_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/knowledge-graph/add - Ajouter des triplets au graphe
  router.post('/api/knowledge-graph/add', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const triplets = req.body?.triplets;
      const metadata = req.body?.metadata || {};

      if (!userId || !Array.isArray(triplets)) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and triplets array are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const result = await kg.addTriplets(triplets, metadata);

      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph add failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'add_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/knowledge-graph/extract-and-add - Extraire et ajouter depuis un texte
  router.post('/api/knowledge-graph/extract-and-add', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const text = String(req.body?.text || '').trim();
      const metadata = req.body?.metadata || {};

      if (!userId || !text) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and text are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const result = await kg.extractAndAddFromText(text, metadata);

      return res.json({
        ok: true,
        text: text.slice(0, 100),
        ...result,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph extract-and-add failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'extract_and_add_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/search - Rechercher des entités
  router.get('/api/knowledge-graph/search', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const query = String(req.query.q || req.query.query || '').trim();

      if (!userId || !query) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and query are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const nodes = kg.findNodes(query);

      return res.json({
        ok: true,
        query,
        resultCount: nodes.length,
        nodes,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph search failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'search_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/relations - Obtenir les relations d'une entité
  router.get('/api/knowledge-graph/relations', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const entity = String(req.query.entity || '').trim();
      const direction = String(req.query.direction || 'both').trim();

      if (!userId || !entity) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and entity are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const relations = kg.getRelations(entity, { direction });

      return res.json({
        ok: true,
        entity,
        direction,
        relationCount: relations.length,
        relations,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph relations failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'relations_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/path - Trouver un chemin entre deux entités
  router.get('/api/knowledge-graph/path', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const start = String(req.query.start || '').trim();
      const end = String(req.query.end || '').trim();
      const maxDepth = Math.max(1, Math.min(5, Number(req.query.maxDepth || 3)));

      if (!userId || !start || !end) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId, start, and end are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const path = kg.findPath(start, end, maxDepth);

      return res.json({
        ok: true,
        start,
        end,
        found: path !== null,
        pathLength: path ? path.length : 0,
        path,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph path failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'path_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/context - Obtenir le contexte pour une requête
  router.get('/api/knowledge-graph/context', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const query = String(req.query.q || req.query.query || '').trim();
      const maxRelations = Math.max(1, Math.min(50, Number(req.query.maxRelations || 10)));

      if (!userId || !query) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and query are required',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const context = kg.getContextForQuery(query, { maxRelations });

      return res.json({
        ok: true,
        query,
        found: context.found,
        context: context.context,
        entities: context.entities,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph context failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'context_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/stats - Statistiques du graphe
  router.get('/api/knowledge-graph/stats', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const stats = kg.getStats();

      return res.json({
        ok: true,
        stats,
      });
    } catch (error) {
      req.logger?.error('Knowledge graph stats failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'stats_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/knowledge-graph/export/cypher - Exporter en Cypher (Neo4j)
  router.get('/api/knowledge-graph/export/cypher', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
        });
      }

      const kg = createKnowledgeGraph(userId);
      const cypher = kg.exportToCypher();

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="knowledge-graph-${userId}.cypher"`);
      return res.send(cypher);
    } catch (error) {
      req.logger?.error('Knowledge graph export failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'export_failed',
        message: String(error?.message || error),
      });
    }
  });

  return router;
}

module.exports = createKnowledgeGraphRouter;
