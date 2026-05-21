'use strict';

const express = require('express');
const {
  callMcpTool,
  getMcpConfig,
} = require('../mcp-client.cjs');

const DEFAULT_COCKPIT_ADMIN_EMAILS = [
  'cellaurojeffrey@gmail.com',
  'funesterie38@gmail.com',
];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

function getCockpitAdminEmails(env = process.env) {
  return new Set([
    ...DEFAULT_COCKPIT_ADMIN_EMAILS,
    ...splitList(env.FUNESTERIE_COCKPIT_ADMINS),
    ...splitList(env.CP_FUNESTERIE_ADMINS),
    ...splitList(env.A11_MCP_COCKPIT_ADMINS),
  ]);
}

function isAllowedCockpitAdmin(user = {}, env = process.env) {
  const email = normalizeEmail(user.email);
  if (email && getCockpitAdminEmails(env).has(email)) return true;

  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return !isProduction && user.localBypass === true;
}

function publicUser(user = {}) {
  return {
    id: user.id || '',
    username: user.username || '',
    email: normalizeEmail(user.email),
    provider: user.provider || '',
  };
}

function jsonError(res, status, error, message) {
  return res.status(status).json({
    ok: false,
    error,
    message,
  });
}

function parseToolText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function unwrapMcpToolPayload(payload) {
  const result = payload?.result ?? payload;
  if (!result) return null;
  const parsedText = parseToolText(result?.content?.[0]?.text);
  return parsedText || result;
}

async function safeToolCall(callTool, name, args, config) {
  try {
    const payload = await callTool(name, args || {}, { config });
    return unwrapMcpToolPayload(payload);
  } catch {
    return null;
  }
}

function cleanAgentName(agent) {
  const raw = String(agent?.name || agent?.id || '').trim();
  if (!raw) return null;
  if (/neo4j|mcp|qflush|diagnostic|port|token|secret/i.test(raw)) return 'Agent';
  return raw.slice(0, 34);
}

function isJapaneseVariant(state) {
  const raw = [
    state?.game,
    state?.windowTitle,
    state?.launcher?.title,
    state?.kiro?.summary,
  ].filter(Boolean).join(' ');
  return /japanese|japan|jpn|\(j\)|\[j\]|\bjp\b/i.test(raw);
}

function summarizePitchingThreads(value) {
  const threads = Array.isArray(value?.discussions) ? value.discussions : [];
  const items = threads.slice(0, 6).map((thread) => {
    const pitching = thread?.pitching || thread?.pitch || {};
    const requiredAnswered = Number(pitching.requiredAnswered || 0);
    const requiredTotal = Number(pitching.requiredTotal || 0);
    const expectedAnswered = Number(pitching.expectedAnswered || 0);
    const expectedTotal = Number(pitching.expectedTotal || 0);
    return {
      title: String(thread?.title || 'Rendez-vous agents').slice(0, 80),
      ready: !!pitching.ready,
      requiredAnswered,
      requiredTotal,
      expectedAnswered,
      expectedTotal,
      deadlineSoftPassed: !!pitching.deadlineSoftPassed,
    };
  });
  return {
    total: threads.length,
    ready: items.filter((item) => item.ready).length,
    items,
  };
}

function buildCockpitSummary({
  a11,
  kaen44,
  presence,
  jobs,
  romstation,
  controller,
  pitchingThreads,
}) {
  const agents = Array.isArray(presence?.presence?.agents) ? presence.presence.agents : [];
  const jobList = Array.isArray(jobs?.jobs?.jobs) ? jobs.jobs.jobs : [];
  const gameState = romstation?.state || null;
  const controllerStatus = controller?.status || null;
  const activeAgents = Number(presence?.presence?.activeCount || agents.filter((agent) => agent?.active).length || 0);
  const totalAgents = Number(presence?.presence?.totalCount || agents.length || 0);

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    a11: {
      ok: !!a11?.status?.ok,
    },
    kaen44: {
      ok: !!kaen44?.status?.ok,
    },
    agents: {
      active: activeAgents,
      total: totalAgents,
      names: agents
        .filter((agent) => agent?.active)
        .map(cleanAgentName)
        .filter(Boolean)
        .map((name, index) => name === 'Agent' ? `Agent ${index + 1}` : name)
        .slice(0, 8),
    },
    jobs: {
      total: jobList.length,
      ready: jobList.filter((job) => job?.status === 'ready').length,
      running: jobList.filter((job) => job?.status === 'running').length,
    },
    game: {
      source: 'RomStation',
      ready: !!gameState?.available && !isJapaneseVariant(gameState),
      phase: String(gameState?.phase || 'waiting').slice(0, 40),
      japaneseIgnored: !isJapaneseVariant(gameState),
    },
    controller: {
      ready: !!controllerStatus?.ok,
      recentCount: Array.isArray(controllerStatus?.recent) ? controllerStatus.recent.length : 0,
      target: 'RomStation',
    },
    pitching: summarizePitchingThreads(pitchingThreads),
  };
}

function createMcpCockpitRouter({
  verifyJWT,
  callTool = callMcpTool,
  env = process.env,
} = {}) {
  if (typeof verifyJWT !== 'function') {
    throw new Error('createMcpCockpitRouter requires verifyJWT');
  }

  const router = express.Router();

  function requireCockpitAdmin(req, res, next) {
    return verifyJWT(req, res, () => {
      if (isAllowedCockpitAdmin(req.user || {}, env)) return next();
      return jsonError(
        res,
        403,
        'admin_required',
        'Cockpit MCP reserve aux comptes admin Funesterie.'
      );
    });
  }

  router.get('/me', requireCockpitAdmin, (req, res) => {
    return res.json({
      ok: true,
      admin: true,
      user: publicUser(req.user || {}),
    });
  });

  router.get('/status', requireCockpitAdmin, async (_req, res) => {
    const config = getMcpConfig(env);
    const [
      a11,
      kaen44,
      presence,
      jobs,
      romstation,
      controller,
      pitchingThreads,
    ] = await Promise.all([
      safeToolCall(callTool, 'a11_status', {}, config),
      safeToolCall(callTool, 'kaen44_status', {}, config),
      safeToolCall(callTool, 'agent_presence', { includeIdle: true }, config),
      safeToolCall(callTool, 'agent_jobs', {}, config),
      safeToolCall(callTool, 'romstation_state', {}, config),
      safeToolCall(callTool, 'qflush_gamepad_status', {}, config),
      safeToolCall(callTool, 'discussion_list', { status: 'pitching', limit: 10 }, config),
    ]);

    return res.json(buildCockpitSummary({
      a11,
      kaen44,
      presence,
      jobs,
      romstation,
      controller,
      pitchingThreads,
    }));
  });

  return router;
}

module.exports = createMcpCockpitRouter;
module.exports.DEFAULT_COCKPIT_ADMIN_EMAILS = DEFAULT_COCKPIT_ADMIN_EMAILS;
module.exports.buildCockpitSummary = buildCockpitSummary;
module.exports.getCockpitAdminEmails = getCockpitAdminEmails;
module.exports.isAllowedCockpitAdmin = isAllowedCockpitAdmin;
