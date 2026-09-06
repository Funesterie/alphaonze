'use strict';

const express = require('express');
const {
  callMcpTool,
  getMcpConfig,
  publicMcpConfig,
} = require('../mcp-client.cjs');
const {
  buildA11McpIntentCapabilities,
  executeMcpIntent,
  planMcpIntent,
  sanitizeIntentText,
} = require('../../lib/mcp-intent-router.cjs');

function safeErrorPayload(error_) {
  const status = Number.isFinite(Number(error_?.status)) ? Number(error_.status) : 500;
  return {
    status,
    body: {
      ok: false,
      error: String(error_?.error || 'mcp_intent_failed'),
      message: sanitizeIntentText(String(error_?.message || error_ || 'MCP intent failed.'), 600),
    },
  };
}

function requestActor(req) {
  return req.user?.username
    || req.user?.email
    || req.user?.id
    || req.auth?.userId
    || 'a11-user';
}

function inputFromRequest(req, overrides = {}) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return {
    ...body,
    ...overrides,
    actor: body.actor || body.from || requestActor(req),
    source: body.source || body.client || 'vivy',
  };
}

function createMcpIntentRouter({
  env = process.env,
  mcp = {
    callMcpTool,
    getMcpConfig,
    publicMcpConfig,
  },
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  function getConfig() {
    return typeof mcp.getMcpConfig === 'function' ? mcp.getMcpConfig(env) : undefined;
  }

  router.get('/capabilities', (req, res) => {
    const config = getConfig();
    return res.json({
      ok: true,
      capabilities: buildA11McpIntentCapabilities({ mcpConfig: config }),
      mcp: typeof mcp.publicMcpConfig === 'function' && config
        ? mcp.publicMcpConfig(config)
        : undefined,
    });
  });

  router.post('/dry-run', (req, res) => {
    const config = getConfig();
    const plan = planMcpIntent(inputFromRequest(req, { dryRun: true }), { env, mcpConfig: config });
    return res.json({
      ok: true,
      mode: 'dry-run',
      plan,
    });
  });

  router.post('/execute', async (req, res) => {
    try {
      const config = getConfig();
      const result = await executeMcpIntent(inputFromRequest(req, { dryRun: false }), {
        env,
        mcp,
        mcpConfig: config,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (error_) {
      const payload = safeErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/', async (req, res) => {
    const shouldExecute = req.body?.execute === true || req.body?.mode === 'execute';
    if (!shouldExecute) {
      const config = getConfig();
      const plan = planMcpIntent(inputFromRequest(req, { dryRun: true }), { env, mcpConfig: config });
      return res.json({
        ok: true,
        mode: 'dry-run',
        plan,
      });
    }

    try {
      const config = getConfig();
      const result = await executeMcpIntent(inputFromRequest(req, { dryRun: false }), {
        env,
        mcp,
        mcpConfig: config,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (error_) {
      const payload = safeErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  return router;
}

module.exports = createMcpIntentRouter;
