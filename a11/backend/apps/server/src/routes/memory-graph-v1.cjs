'use strict';

const express = require('express');
const {
  buildMemoryGraph,
  explainAgentContext,
  findRecentIncidents,
  traceService,
} = require('../knowledge/a11-memory-graph-v1.cjs');

function createMemoryGraphV1Router({ verifyJWT } = {}) {
  const router = express.Router();
  const auth = typeof verifyJWT === 'function' ? verifyJWT : (_req, _res, next) => next();

  router.get('/api/memory-graph/v1', auth, (req, res) => {
    try {
      const graph = buildMemoryGraph();
      const includeFull = String(req.query.include || '').trim().toLowerCase() === 'full';
      return res.json({
        ok: true,
        schema: graph.schema,
        generatedAt: graph.generatedAt,
        sourcePolicy: graph.sourcePolicy,
        summary: graph.summary,
        ...(includeFull ? { nodes: graph.nodes, relationships: graph.relationships } : {}),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'memory_graph_build_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.get('/api/memory-graph/v1/trace-service', auth, (req, res) => {
    try {
      const service = String(req.query.service || req.query.name || req.query.q || '').trim();
      if (!service) {
        return res.status(400).json({
          ok: false,
          error: 'missing_service',
          message: 'service, name or q is required',
        });
      }
      return res.json(traceService(service, {
        depth: req.query.depth,
        limit: req.query.limit,
      }));
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'trace_service_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.get('/api/memory-graph/v1/recent-incidents', auth, (req, res) => {
    try {
      return res.json(findRecentIncidents({ limit: req.query.limit }));
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'recent_incidents_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.get('/api/memory-graph/v1/explain-agent-context', auth, (req, res) => {
    try {
      const agent = String(req.query.agent || 'a11').trim();
      return res.json(explainAgentContext(agent, { limit: req.query.limit }));
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'explain_agent_context_failed',
        message: String(error?.message || error),
      });
    }
  });

  return router;
}

module.exports = createMemoryGraphV1Router;
