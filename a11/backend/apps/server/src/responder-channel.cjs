'use strict';

const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');

const VALID_RESPONDER_MODES = new Set(['off', 'always', 'heuristic']);

function normalizeResponderMode(value, fallback = 'off') {
  const normalized = String(value || '').trim().toLowerCase();
  if (VALID_RESPONDER_MODES.has(normalized)) return normalized;
  return VALID_RESPONDER_MODES.has(String(fallback || '').trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : 'off';
}

function normalizeBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeToken(value) {
  return String(value || '').trim();
}

function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return (
    !normalized
    || normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
  );
}

function extractBearerToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : raw;
}

function extractRequestToken(req) {
  return normalizeToken(
    extractBearerToken(req.headers?.authorization)
    || req.headers?.['x-a11-responder-token']
    || req.headers?.['x-nez-admin']
    || req.headers?.['x-qflush-token']
  );
}

function createResponderState(options = {}) {
  const mode = normalizeResponderMode(options.mode, 'off');
  const now = new Date().toISOString();
  return {
    mode,
    createdAt: now,
    updatedAt: now,
    requestCount: 0,
    repliedCount: 0,
    ignoredCount: 0,
    lastMessageAt: null,
    lastDecision: null,
    lastResponseAt: null,
    lastResponsePreview: '',
    lastError: '',
    lastErrorAt: null,
    lastModeSource: 'startup',
  };
}

function setResponderMode(state, nextMode, source = 'api') {
  const normalizedMode = normalizeResponderMode(nextMode, state?.mode || 'off');
  const updatedAt = new Date().toISOString();
  state.mode = normalizedMode;
  state.updatedAt = updatedAt;
  state.lastModeSource = String(source || 'api').trim() || 'api';
  return normalizedMode;
}

function buildHeuristicDecision(message, body = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return {
      shouldReply: false,
      reason: 'missing_message',
      confidence: 0,
    };
  }

  if (
    body.forceReply === true
    || body.expectReply === true
    || body.expectsReply === true
    || body.needsReply === true
  ) {
    return {
      shouldReply: true,
      reason: 'explicit_expectation',
      confidence: 1,
    };
  }

  if (/\b(a11|a-11|alpha[\s-]*11|alphaonze|assistant)\b/i.test(text)) {
    return {
      shouldReply: true,
      reason: 'direct_mention',
      confidence: 0.96,
    };
  }

  if (/[?？]\s*$/.test(text)) {
    return {
      shouldReply: true,
      reason: 'question',
      confidence: 0.82,
    };
  }

  if (/^(salut|bonjour|hello|hey)\b/i.test(text) && /\b(a11|assistant)\b/i.test(text)) {
    return {
      shouldReply: true,
      reason: 'greeting_mention',
      confidence: 0.8,
    };
  }

  if (/\b(peux-tu|peux tu|tu peux|réponds|reponds|explique|montre-moi|montre moi|aide-moi|aide moi)\b/i.test(text)) {
    return {
      shouldReply: true,
      reason: 'direct_request',
      confidence: 0.76,
    };
  }

  return {
    shouldReply: false,
    reason: 'heuristic_skip',
    confidence: 0.2,
  };
}

function buildResponderDecision(mode, message, body = {}) {
  const modeUsed = normalizeResponderMode(mode, 'off');
  if (modeUsed === 'off') {
    return {
      shouldReply: false,
      reason: 'mode_off',
      confidence: 1,
      modeUsed,
    };
  }
  if (modeUsed === 'always') {
    return {
      shouldReply: true,
      reason: 'mode_always',
      confidence: 1,
      modeUsed,
    };
  }
  return {
    ...buildHeuristicDecision(message, body),
    modeUsed,
  };
}

function buildPreview(value, maxLength = 180) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function getResponderStatusSnapshot(state, config = {}) {
  return {
    ok: true,
    enabled: normalizeBoolean(config.enabled, false),
    channel: String(config.channelName || 'a11-responder-3002').trim() || 'a11-responder-3002',
    host: String(config.host || '').trim() || null,
    port: Number(config.port || 0) || null,
    mode: normalizeResponderMode(state?.mode, 'off'),
    tokenRequired: Boolean(normalizeToken(config.token)),
    createdAt: state?.createdAt || null,
    updatedAt: state?.updatedAt || null,
    lastModeSource: state?.lastModeSource || null,
    requestCount: Number(state?.requestCount || 0),
    repliedCount: Number(state?.repliedCount || 0),
    ignoredCount: Number(state?.ignoredCount || 0),
    lastMessageAt: state?.lastMessageAt || null,
    lastDecision: state?.lastDecision || null,
    lastResponseAt: state?.lastResponseAt || null,
    lastResponsePreview: state?.lastResponsePreview || '',
    lastError: state?.lastError || '',
    lastErrorAt: state?.lastErrorAt || null,
  };
}

async function startResponderChannel(options = {}) {
  const enabled = normalizeBoolean(options.enabled, false);
  const host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
  const requestedPort = options.port === undefined || options.port === null || options.port === ''
    ? 3002
    : Number(options.port);
  const port = Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 3002;
  const token = normalizeToken(options.token);
  const mode = normalizeResponderMode(options.mode, 'off');
  const logger = options.logger || console;
  const channelName = String(options.channelName || 'a11-responder-3002').trim() || 'a11-responder-3002';
  const invokeChat = options.invokeChat;
  const state = options.state || createResponderState({ mode });

  setResponderMode(state, mode, 'startup');

  if (!enabled) {
    return {
      enabled: false,
      host,
      port,
      state,
      server: null,
      close: async () => {},
      getStatus: () => getResponderStatusSnapshot(state, { enabled: false, host, port, token, channelName }),
    };
  }

  if (typeof invokeChat !== 'function') {
    throw new Error('startResponderChannel requires invokeChat');
  }

  if (!isLoopbackHost(host) && !token) {
    throw new Error('A11_RESPONDER_TOKEN is required when binding the responder channel beyond loopback');
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  function enforceToken(req, res, next) {
    if (!token) return next();
    const provided = extractRequestToken(req);
    if (provided && provided === token) return next();
    return res.status(401).json({
      ok: false,
      error: 'responder_auth_required',
      message: 'Missing or invalid responder token.',
    });
  }

  app.get('/health', (_req, res) => {
    return res.json({
      ok: true,
      service: channelName,
      mode: state.mode,
      status: 'ok',
    });
  });

  app.get('/status', (_req, res) => {
    return res.json(getResponderStatusSnapshot(state, {
      enabled: true,
      host,
      port,
      token,
      channelName,
    }));
  });

  app.post('/mode', enforceToken, (req, res) => {
    const nextMode = normalizeResponderMode(req.body?.mode, state.mode || mode);
    setResponderMode(state, nextMode, 'channel_api');
    return res.json(getResponderStatusSnapshot(state, {
      enabled: true,
      host,
      port,
      token,
      channelName,
    }));
  });

  app.post(['/', '/message', '/answer'], enforceToken, async (req, res) => {
    const requestId = String(req.headers?.['x-request-id'] || '').trim() || crypto.randomUUID();
    const message = String(req.body?.message || req.body?.prompt || '').trim();
    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'missing_message',
        message: 'message or prompt is required.',
      });
    }

    const modeOverride = req.body?.mode;
    const effectiveMode = normalizeResponderMode(
      typeof modeOverride === 'string' && modeOverride.trim() ? modeOverride : state.mode,
      state.mode
    );

    state.requestCount += 1;
    state.lastMessageAt = new Date().toISOString();

    const decision = buildResponderDecision(effectiveMode, message, req.body || {});
    state.lastDecision = {
      ...decision,
      requestId,
      at: state.lastMessageAt,
      preview: buildPreview(message, 140),
    };
    state.updatedAt = state.lastMessageAt;

    if (!decision.shouldReply) {
      state.ignoredCount += 1;
      return res.json({
        ok: true,
        channel: channelName,
        requestId,
        replied: false,
        decision: state.lastDecision,
      });
    }

    try {
      const assistant = String(await invokeChat({
        ...(req.body || {}),
        message,
        prompt: message,
        requestId,
        responderMode: effectiveMode,
        responderChannel: channelName,
      }) || '').trim();

      if (!assistant) {
        throw new Error('empty_responder_reply');
      }

      state.repliedCount += 1;
      state.lastResponseAt = new Date().toISOString();
      state.lastResponsePreview = buildPreview(assistant);
      state.lastError = '';
      state.lastErrorAt = null;
      state.updatedAt = state.lastResponseAt;

      return res.json({
        ok: true,
        channel: channelName,
        requestId,
        replied: true,
        decision: state.lastDecision,
        assistant,
      });
    } catch (error_) {
      const messageText = String(error_?.message || error_).trim() || 'responder_failed';
      state.lastError = messageText;
      state.lastErrorAt = new Date().toISOString();
      state.updatedAt = state.lastErrorAt;
      logger.warn?.(`[A11][responder] request failed: ${messageText}`);
      return res.status(Number(error_?.status || error_?.statusCode || 502)).json({
        ok: false,
        channel: channelName,
        requestId,
        replied: false,
        error: 'responder_failed',
        message: messageText,
        decision: state.lastDecision,
      });
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    const onError = (error_) => {
      server.off('listening', onListening);
      reject(error_);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.listen(port, host, onListening);
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  logger.log?.(`[A11][responder] ${channelName} listening on http://${host}:${boundPort} mode=${state.mode}`);

  return {
    enabled: true,
    host,
    port: boundPort,
    state,
    server,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error_) => (error_ ? reject(error_) : resolve()));
      });
    },
    getStatus: () => getResponderStatusSnapshot(state, {
      enabled: true,
      host,
      port: boundPort,
      token,
      channelName,
    }),
  };
}

module.exports = {
  VALID_RESPONDER_MODES,
  normalizeResponderMode,
  createResponderState,
  setResponderMode,
  buildResponderDecision,
  getResponderStatusSnapshot,
  startResponderChannel,
};
