'use strict';

const express = require('express');
const {
  callMcpTool,
  checkMcpHealth,
  getMcpConfig,
  listMcpTools,
  publicMcpConfig,
} = require('../mcp-client.cjs');

function toMcpErrorPayload(error_) {
  const status = Number.isFinite(Number(error_?.status)) ? Number(error_.status) : 502;
  return {
    status,
    body: {
      ok: false,
      error: String(error_?.error || 'mcp_client_failed'),
      message: String(error_?.message || error_),
      upstream: error_?.upstream || undefined,
    },
  };
}

function decorateToolsForA11(tools, config) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => ({
    ...tool,
    a11Allowed: config.allowAllTools || config.allowedTools.has(tool?.name),
  }));
}

function createMcpClientRouter() {
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    const config = getMcpConfig();
    try {
      const health = await checkMcpHealth({ config });
      return res.status(health.ok ? 200 : 502).json({
        ok: health.ok,
        mcp: publicMcpConfig(config),
        health,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json({
        ...payload.body,
        mcp: publicMcpConfig(config),
      });
    }
  });

  router.get('/tools/list', async (req, res) => {
    const config = getMcpConfig();
    try {
      const result = await listMcpTools({ config });
      const tools = decorateToolsForA11(result?.result?.tools || [], config);
      const allowedOnly = ['1', 'true', 'yes'].includes(String(req.query.allowedOnly || '').trim().toLowerCase());
      return res.json({
        ok: true,
        mcp: publicMcpConfig(config),
        tools: allowedOnly ? tools.filter((tool) => tool.a11Allowed) : tools,
        raw: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/tools/call', express.json({ limit: '2mb' }), async (req, res) => {
    const config = getMcpConfig();
    try {
      const name = String(req.body?.name || req.body?.tool || req.body?.toolName || '').trim();
      const args = req.body?.arguments || req.body?.args || req.body?.params || {};
      const result = await callMcpTool(name, args, { config });
      return res.json({
        ok: true,
        tool: name,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.get('/romstation/state', async (_req, res) => {
    const config = getMcpConfig();
    try {
      const result = await callMcpTool('romstation_state', {}, { config });
      return res.json({
        ok: true,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/romstation/mouse', express.json({ limit: '64kb' }), async (req, res) => {
    const config = getMcpConfig();
    try {
      const result = await callMcpTool('romstation_mouse', req.body || {}, { config });
      return res.json({
        ok: true,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/romstation/keyboard', express.json({ limit: '64kb' }), async (req, res) => {
    const config = getMcpConfig();
    try {
      const result = await callMcpTool('romstation_keyboard', req.body || {}, { config });
      return res.json({
        ok: true,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  return router;
}

module.exports = createMcpClientRouter;
