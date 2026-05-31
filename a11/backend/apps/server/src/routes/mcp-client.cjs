'use strict';

const express = require('express');
const {
  callMcpTool,
  checkMcpHealth,
  getMcpConfig,
  listMcpTools,
  publicMcpConfig,
} = require('../mcp-client.cjs');
const {
  buildMcpPermissionDenied,
  canUseMcpPermission,
  resolveMcpAccountProfile,
  TIER_FEATURES,
  TIER_LABELS,
  TIER_PRICING,
  TIERS,
} = require('../auth/mcp-account-tier.cjs');

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

function buildTierCard(tier) {
  return {
    tier,
    label: TIER_LABELS[tier],
    pricing: TIER_PRICING[tier],
    features: [...(TIER_FEATURES[tier] || [])],
  };
}

function buildConnectorCatalog(account) {
  const permissions = account?.permissions || {};
  const allowed = (permission) => permissions[permission] === true;
  return {
    tiers: [
      buildTierCard(TIERS.BASIC),
      buildTierCard(TIERS.PREMIUM),
      buildTierCard(TIERS.FOUNDER),
      buildTierCard(TIERS.ADMIN_FAMILY),
    ],
    sessionSafety: {
      scopedToOwnSession: true,
      destructiveActions: allowed('destructiveActions'),
      crossAccountAccess: allowed('crossAccountAccess'),
      preservesExistingDataByDefault: !allowed('destructiveActions'),
    },
    capabilities: [
      {
        id: 'mcp-public-read',
        label: 'MCP public lecture',
        permission: 'publicProxyRead',
        minimumTier: TIERS.BASIC,
        allowed: allowed('publicProxyRead'),
      },
      {
        id: 'mcp-public-call',
        label: 'MCP public avance',
        permission: 'publicProxyCall',
        minimumTier: TIERS.PREMIUM,
        allowed: allowed('publicProxyCall'),
      },
      {
        id: 'romstation-state',
        label: 'RomStation lecture',
        permission: 'romstationState',
        minimumTier: TIERS.PREMIUM,
        allowed: allowed('romstationState'),
      },
      {
        id: 'romstation-control',
        label: 'RomStation controle session',
        permission: 'romstationControl',
        minimumTier: TIERS.FOUNDER,
        allowed: allowed('romstationControl'),
      },
      {
        id: 'mcp-private-session',
        label: 'MCP prive de session',
        permission: 'privateMcpProxy',
        minimumTier: TIERS.FOUNDER,
        allowed: allowed('privateMcpProxy'),
      },
      {
        id: 'a11-local-install',
        label: 'Installation locale A11',
        permission: 'localRuntimeInstall',
        minimumTier: TIERS.FOUNDER,
        allowed: allowed('localRuntimeInstall'),
      },
    ],
    connectors: [
      {
        id: 'google',
        label: 'Google',
        permission: 'googleConnect',
        minimumTier: TIERS.BASIC,
        allowed: allowed('googleConnect'),
      },
      {
        id: 'microsoft',
        label: 'Microsoft',
        permission: 'microsoftConnect',
        minimumTier: TIERS.BASIC,
        allowed: allowed('microsoftConnect'),
      },
      {
        id: 'discord321gaming',
        label: 'Discord 321gaming',
        permission: 'discord321Access',
        minimumTier: TIERS.PREMIUM,
        allowed: allowed('discord321Access'),
      },
      {
        id: 'github',
        label: 'GitHub',
        permission: 'githubConnect',
        minimumTier: TIERS.FOUNDER,
        allowed: allowed('githubConnect'),
      },
      {
        id: 'youtube',
        label: 'YouTube',
        permission: 'youtubeConnect',
        minimumTier: TIERS.FOUNDER,
        allowed: allowed('youtubeConnect'),
      },
    ],
  };
}

function buildLocalInstallManifest(account) {
  return {
    id: 'a11-local-runtime',
    label: 'A11 local',
    platform: 'windows',
    minimumTier: TIERS.FOUNDER,
    accountTier: account?.tier || TIERS.BASIC,
    destructive: false,
    preservesExistingData: true,
    installs: [
      'A11 runtime local',
      'pont MCP de session',
      'lanceurs Funesterie',
      'connecteurs utilisateur autorises',
    ],
    boundaries: [
      'ne supprime pas les worktrees existants',
      'ne remplace pas les secrets existants',
      'ne donne pas acces aux autres comptes',
    ],
    nextSteps: [
      'telecharger le pack A11 signe',
      'connecter Google ou Microsoft',
      'activer GitHub/YouTube/Discord selon les droits du compte',
      'lancer le preflight local avant usage',
    ],
  };
}

function createMcpClientRouter({
  db = null,
  env = process.env,
  mcp = {
    callMcpTool,
    checkMcpHealth,
    getMcpConfig,
    listMcpTools,
    publicMcpConfig,
  },
} = {}) {
  const router = express.Router();

  async function resolveProfile(req) {
    if (!req.mcpAccount) {
      req.mcpAccount = await resolveMcpAccountProfile(req, { db, env });
    }
    return req.mcpAccount;
  }

  async function requirePermission(req, res, permission, message) {
    const profile = await resolveProfile(req);
    if (canUseMcpPermission(profile, permission)) return true;
    res.status(403).json(buildMcpPermissionDenied(permission, profile, message));
    return false;
  }

  router.get('/access', async (req, res) => {
    const account = await resolveProfile(req);
    return res.json({
      ok: true,
      account,
      catalog: buildConnectorCatalog(account),
    });
  });

  router.get('/catalog', async (req, res) => {
    const account = await resolveProfile(req);
    return res.json({
      ok: true,
      account,
      catalog: buildConnectorCatalog(account),
    });
  });

  router.get('/connectors/catalog', async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'sessionConnectors',
      'Le catalogue connecteurs demande une session Funesterie connectee.'
    )) return;
    const account = req.mcpAccount;
    return res.json({
      ok: true,
      account,
      connectors: buildConnectorCatalog(account).connectors,
    });
  });

  router.get('/local-install/manifest', async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'localRuntimeInstall',
      'L installation locale A11 est reservee aux comptes Fondateur et Admin famille.'
    )) return;
    const account = req.mcpAccount;
    return res.json({
      ok: true,
      account,
      installer: buildLocalInstallManifest(account),
    });
  });

  router.get('/status', async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'privateMcpStatus',
      'Le statut MCP prive est reserve aux comptes Premium, Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const health = await mcp.checkMcpHealth({ config });
      return res.status(health.ok ? 200 : 502).json({
        ok: health.ok,
        account: req.mcpAccount,
        mcp: mcp.publicMcpConfig(config),
        health,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json({
        ...payload.body,
        account: req.mcpAccount,
        mcp: mcp.publicMcpConfig(config),
      });
    }
  });

  router.get('/tools/list', async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'privateMcpTools',
      'La liste des outils MCP prives est reservee aux comptes Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const result = await mcp.listMcpTools({ config });
      const tools = decorateToolsForA11(result?.result?.tools || [], config);
      const allowedOnly = ['1', 'true', 'yes'].includes(String(req.query.allowedOnly || '').trim().toLowerCase());
      return res.json({
        ok: true,
        account: req.mcpAccount,
        mcp: mcp.publicMcpConfig(config),
        tools: allowedOnly ? tools.filter((tool) => tool.a11Allowed) : tools,
        raw: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/tools/call', express.json({ limit: '2mb' }), async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'privateMcpCall',
      'Les appels outils MCP prives sont reserves aux comptes Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const name = String(req.body?.name || req.body?.tool || req.body?.toolName || '').trim();
      const args = req.body?.arguments || req.body?.args || req.body?.params || {};
      const result = await mcp.callMcpTool(name, args, { config });
      return res.json({
        ok: true,
        account: req.mcpAccount,
        tool: name,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.get('/romstation/state', async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'romstationState',
      'L etat RomStation via MCP est reserve aux comptes Premium, Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const result = await mcp.callMcpTool('romstation_state', {}, { config });
      return res.json({
        ok: true,
        account: req.mcpAccount,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/romstation/mouse', express.json({ limit: '64kb' }), async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'romstationControl',
      'Le controle RomStation via MCP est reserve aux comptes Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const result = await mcp.callMcpTool('romstation_mouse', req.body || {}, { config });
      return res.json({
        ok: true,
        account: req.mcpAccount,
        result: result.result,
      });
    } catch (error_) {
      const payload = toMcpErrorPayload(error_);
      return res.status(payload.status).json(payload.body);
    }
  });

  router.post('/romstation/keyboard', express.json({ limit: '64kb' }), async (req, res) => {
    if (!await requirePermission(
      req,
      res,
      'romstationControl',
      'Le controle RomStation via MCP est reserve aux comptes Fondateur et Admin famille.'
    )) return;
    const config = mcp.getMcpConfig(env);
    try {
      const result = await mcp.callMcpTool('romstation_keyboard', req.body || {}, { config });
      return res.json({
        ok: true,
        account: req.mcpAccount,
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
