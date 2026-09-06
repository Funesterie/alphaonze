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

function capability(id, label, permission, minimumTier, account, options = {}) {
  const permissions = account?.permissions || {};
  return {
    id,
    label,
    permission,
    minimumTier,
    category: options.category || 'MCP',
    description: options.description || '',
    recommended: options.recommended !== false,
    adjustable: options.adjustable !== false,
    allowed: permissions[permission] === true,
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
      capability('account-inventory', 'Inventaire compte', 'sessionConnectors', TIERS.BASIC, account, {
        category: 'Compte',
        description: 'Conversations, médias et fichiers du compte, exportables depuis la page Compte.',
      }),
      capability('mcp-public-read', 'MCP public lecture', 'publicProxyRead', TIERS.BASIC, account, {
        category: 'MCP',
        description: 'Health, statut public, informations non sensibles et vérifications simples.',
      }),
      capability('vision-image', 'Analyse image', 'publicProxyRead', TIERS.BASIC, account, {
        category: 'Vision',
        description: 'Analyse d’images jointes avec routage vision quand le module est disponible.',
      }),
      capability('mcp-public-call', 'MCP public avancé', 'publicProxyCall', TIERS.PREMIUM, account, {
        category: 'MCP',
        description: 'Appels publics autorisés, sans routes privées ni secrets.',
      }),
      capability('chrome-context', 'Contexte Chrome borné', 'publicProxyCall', TIERS.PREMIUM, account, {
        category: 'MCP',
        description: 'Contexte page/onglet/sélection fourni explicitement par la session, sans contrôle libre du navigateur.',
      }),
      capability('mcp-premium-status', 'Statut MCP premium', 'privateMcpStatus', TIERS.PREMIUM, account, {
        category: 'MCP',
        description: 'Lecture de statut MCP autorisée aux comptes Premium, sans liste d’outils privés ni secrets.',
      }),
      capability('romstation-state', 'RomStation lecture', 'romstationState', TIERS.PREMIUM, account, {
        category: 'Jeu',
        description: 'État session, jeux détectés, préparation match sans contrôle direct.',
      }),
      capability('mcp-private-session', 'MCP privé de session', 'privateMcpProxy', TIERS.FOUNDER, account, {
        category: 'MCP',
        description: 'Pont privé de session, limité au compte courant et sans exposition de secrets.',
      }),
      capability('mcp-tool-list', 'Liste outils privés', 'privateMcpTools', TIERS.FOUNDER, account, {
        category: 'MCP',
        description: 'Inventaire détaillé des outils réellement exposés par le pont.',
      }),
      capability('mcp-tool-call', 'Appels outils privés', 'privateMcpCall', TIERS.FOUNDER, account, {
        category: 'MCP',
        description: 'Appels outillés bornés, journalisés et réservés aux actions autorisées.',
      }),
      capability('romstation-control', 'RomStation contrôle', 'romstationControl', TIERS.FOUNDER, account, {
        category: 'Jeu',
        description: 'Contrôle clavier/manette de session pour match arena et tests de jeu.',
      }),
      capability('operator-assist', 'Assistance ordinateur', 'localRuntimeControl', TIERS.FOUNDER, account, {
        category: 'Assistance',
        description: 'Vision écran, guidage, souris/clavier/terminal bornés après confirmation.',
      }),
      capability('bounded-terminal', 'Terminal borné', 'localRuntimeControl', TIERS.FOUNDER, account, {
        category: 'Assistance',
        description: 'Commandes limitées via opérateur/Qflush, pas de shell libre exposé.',
      }),
      capability('a11-local-install', 'Installation locale A11', 'localRuntimeInstall', TIERS.FOUNDER, account, {
        category: 'Local',
        description: 'Pack local A11 et connecteurs de session sur le poste de l’utilisateur.',
      }),
      capability('admin-infra-ops', 'Opérations infra', 'destructiveActions', TIERS.ADMIN_FAMILY, account, {
        category: 'Admin',
        description: 'Maintenance et opérations sensibles réservées famille/admin.',
        recommended: false,
      }),
      capability('cross-account-support', 'Support cross-compte', 'crossAccountAccess', TIERS.ADMIN_FAMILY, account, {
        category: 'Admin',
        description: 'Support multi-compte réservé famille/admin, jamais activé pour les comptes publics.',
        recommended: false,
      }),
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
