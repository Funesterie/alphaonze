'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {
  canUseMcpPermission,
  resolveMcpAccountProfile,
  TIERS,
} = require('../src/auth/mcp-account-tier.cjs');

const DEFAULT_WINDOWS_GAMES_ROOT = 'C:\\Users\\Djeff\\Desktop\\jeux';
const DEFAULT_LINUX_GAMES_ROOT = '/app/runtime/match-arena/games';
const DEFAULT_WORKER_TOKEN_FILE = '/app/runtime/secrets/match_arena_worker_token';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const WORKER_STALE_MS = 2 * 60 * 1000;
const WORKER_LEASE_MS = 10 * 60 * 1000;
const MAX_INPUT_EVENTS = 240;
const MAX_SCAN_FILES = 5000;
const MATCH_ARENA_MODES = Object.freeze({
  USER_VS_A11: 'user-vs-a11',
  USER_WITH_A11: 'user-with-a11',
  USER_VS_PLAYER: 'user-vs-player',
});
const PLAYABLE_EXTENSIONS = new Set([
  '.zip',
  '.7z',
  '.smc',
  '.sfc',
  '.nes',
  '.gb',
  '.gbc',
  '.gba',
  '.n64',
  '.z64',
  '.v64',
  '.cue',
  '.iso',
  '.chd',
  '.bin',
  '.md',
  '.gen',
  '.gg',
  '.sms',
  '.pce',
  '.ngp',
  '.ngc',
  '.nds',
  '.pbp',
  '.m3u',
]);

const sessions = new Map();
let workerInventory = {
  workerId: null,
  receivedAt: null,
  games: [],
  source: 'none',
};
let lastWorkerHeartbeat = null;

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(raw);
}

function getGamesRoot() {
  const explicit = String(process.env.A11_MATCH_ARENA_GAMES_ROOT || '').trim();
  if (explicit) return explicit;
  return process.platform === 'win32' ? DEFAULT_WINDOWS_GAMES_ROOT : DEFAULT_LINUX_GAMES_ROOT;
}

function getWorkerToken() {
  const fileCandidates = [
    process.env.A11_MATCH_ARENA_WORKER_TOKEN_FILE,
    DEFAULT_WORKER_TOKEN_FILE,
  ].filter(Boolean);
  for (const candidate of fileCandidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Optional secret file.
    }
  }
  return String(process.env.A11_MATCH_ARENA_WORKER_TOKEN || '').trim();
}

function timingSafeEqualText(left = '', right = '') {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getWorkerRequestToken(req = {}) {
  const header = String(req.headers?.['x-a11-worker-token'] || '').trim();
  if (header) return header;
  const auth = String(req.headers?.authorization || '').trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireWorkerAuth(req, res, next) {
  const expected = getWorkerToken();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'match_arena_worker_token_missing',
      message: 'Worker Match Arena non configure sur ce runtime.',
    });
  }
  if (!timingSafeEqualText(getWorkerRequestToken(req), expected)) {
    return res.status(401).json({ ok: false, error: 'match_arena_worker_unauthorized' });
  }
  return next();
}

function slugify(value) {
  const raw = String(value || 'game').trim().toLowerCase();
  const normalized = raw.normalize ? raw.normalize('NFKD') : raw;
  return normalized
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || 'game';
}

function stableId(prefix, value) {
  const hash = crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
  return `${prefix}-${slugify(value)}-${hash}`;
}

function safeRelativePath(root, filePath) {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

function scanFiles(root, current, result) {
  if (result.scanned >= MAX_SCAN_FILES) return;
  let entries = [];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.scanned >= MAX_SCAN_FILES) return;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|__MACOSX)$/i.test(entry.name)) continue;
      scanFiles(root, fullPath, result);
      continue;
    }
    if (!entry.isFile()) continue;
    result.scanned += 1;
    const extension = path.extname(entry.name).toLowerCase();
    result.extensions[extension || '(none)'] = (result.extensions[extension || '(none)'] || 0) + 1;
    const relative = safeRelativePath(root, fullPath);
    if (!relative) continue;
    if (/images\/cover\.(png|jpg|jpeg|webp)$/i.test(relative)) {
      result.hasCover = true;
    }
    if (PLAYABLE_EXTENSIONS.has(extension)) {
      let size = null;
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        size = null;
      }
      result.playableFiles.push({
        name: entry.name,
        relativePath: relative,
        extension: extension.replace(/^\./, ''),
        size,
      });
    }
  }
}

function scanGameDirectory(gamesRoot, entry) {
  const fullPath = path.join(gamesRoot, entry.name);
  const result = {
    scanned: 0,
    extensions: {},
    playableFiles: [],
    hasCover: false,
  };
  scanFiles(fullPath, fullPath, result);
  if (!result.playableFiles.length) return null;
  return {
    id: stableId('game', entry.name),
    title: entry.name,
    source: 'local-scan',
    rootLabel: path.basename(gamesRoot),
    playableCount: result.playableFiles.length,
    extensions: result.extensions,
    hasCover: result.hasCover,
    playableFiles: result.playableFiles.slice(0, 12),
    note: 'Fichiers fournis localement par le proprietaire; aucun fichier de jeu n est publie par l API.',
  };
}

function scanLocalGameCatalog() {
  const gamesRoot = getGamesRoot();
  const catalog = {
    source: 'local-scan',
    rootAvailable: false,
    rootLabel: path.basename(gamesRoot),
    generatedAt: new Date().toISOString(),
    games: [],
  };
  if (!gamesRoot || !fs.existsSync(gamesRoot)) return catalog;
  catalog.rootAvailable = true;
  let entries = [];
  try {
    entries = fs.readdirSync(gamesRoot, { withFileTypes: true });
  } catch {
    return catalog;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const game = scanGameDirectory(gamesRoot, entry);
    if (game) catalog.games.push(game);
  }
  catalog.games.sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr'));
  return catalog;
}

function sanitizeWorkerGame(game = {}) {
  const title = String(game.title || game.name || '').trim().slice(0, 160);
  if (!title) return null;
  const sourceId = String(game.id || title).trim().slice(0, 180);
  const playableFiles = Array.isArray(game.playableFiles) ? game.playableFiles : [];
  const sanitizedFiles = playableFiles.slice(0, 20).map((file) => ({
    name: String(file?.name || '').trim().slice(0, 180),
    relativePath: String(file?.relativePath || file?.relative || '').replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 400),
    extension: String(file?.extension || '').replace(/^\./, '').trim().toLowerCase().slice(0, 20),
    size: Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
  })).filter((file) => file.name && file.relativePath);
  return {
    id: sourceId || stableId('game', title),
    title,
    source: 'local-worker',
    workerId: String(game.workerId || workerInventory.workerId || '').trim().slice(0, 120) || null,
    rootLabel: String(game.rootLabel || '').trim().slice(0, 80) || 'jeux',
    playableCount: Number.isFinite(Number(game.playableCount)) ? Number(game.playableCount) : sanitizedFiles.length,
    extensions: game.extensions && typeof game.extensions === 'object' ? game.extensions : {},
    hasCover: Boolean(game.hasCover),
    playableFiles: sanitizedFiles,
    note: 'Inventaire signale par le worker local; chemins absolus masques.',
  };
}

function setWorkerInventory(workerId, games) {
  const sanitized = (Array.isArray(games) ? games : [])
    .map((game) => sanitizeWorkerGame({ ...game, workerId }))
    .filter(Boolean)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr'));
  workerInventory = {
    workerId,
    receivedAt: new Date().toISOString(),
    games: sanitized,
    source: 'local-worker',
  };
  return workerInventory;
}

function getMergedCatalog() {
  const localCatalog = scanLocalGameCatalog();
  const byId = new Map();
  for (const game of localCatalog.games) byId.set(game.id, game);
  for (const game of workerInventory.games || []) byId.set(game.id, game);
  const games = Array.from(byId.values()).sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr'));
  return {
    schema: 'funesterie.match-arena.catalog.v1',
    generatedAt: new Date().toISOString(),
    rootAvailable: localCatalog.rootAvailable,
    localRootLabel: localCatalog.rootLabel,
    workerInventoryAt: workerInventory.receivedAt,
    sources: {
      localScan: localCatalog.games.length,
      localWorker: workerInventory.games.length,
    },
    games,
  };
}

function normalizeMatchArenaMode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if ([
    'user-with-a11',
    'with-a11',
    'a11-with-user',
    'coop-a11',
    'co-op-a11',
    'a11-copilot',
    'copilot-a11',
  ].includes(raw)) return MATCH_ARENA_MODES.USER_WITH_A11;
  if ([
    'user-vs-player',
    'player-vs-player',
    'versus-player',
    'pvp',
    'online-player',
  ].includes(raw)) return MATCH_ARENA_MODES.USER_VS_PLAYER;
  if ([
    'user-vs-a11',
    'user-vs-ai',
    'a11-vs-user',
    'vs-a11',
    'versus-a11',
    'ai',
  ].includes(raw)) return MATCH_ARENA_MODES.USER_VS_A11;
  return MATCH_ARENA_MODES.USER_VS_A11;
}

function buildA11ModeDescriptor(mode, profile = null) {
  if (mode === MATCH_ARENA_MODES.USER_VS_PLAYER) {
    return {
      enabled: false,
      role: 'none',
      label: 'Joueur en ligne',
      requiredTier: null,
      permissions: [],
    };
  }
  const role = mode === MATCH_ARENA_MODES.USER_WITH_A11 ? 'copilot' : 'opponent';
  return {
    enabled: true,
    role,
    label: role === 'copilot' ? 'Avec A11' : 'Contre A11',
    requiredTier: TIERS.FOUNDER,
    permissions: ['romstationControl', 'localRuntimeControl'],
    accountTier: profile?.tier || TIERS.BASIC,
  };
}

function canUseA11MatchMode(profile) {
  return canUseMcpPermission(profile, 'romstationControl')
    && canUseMcpPermission(profile, 'localRuntimeControl');
}

function a11MatchPermissionDenied(profile, mode) {
  const descriptor = buildA11ModeDescriptor(mode, profile);
  return {
    ok: false,
    error: 'match_arena_a11_mode_forbidden',
    message: 'Le mode Match Arena contre/avec A11 est reserve aux comptes Fondateur ou Admin famille.',
    required: {
      minimumTier: TIERS.FOUNDER,
      permissions: descriptor.permissions,
    },
    account: profile ? {
      tier: profile.tier,
      label: profile.label,
      permissions: {
        romstationControl: profile.permissions?.romstationControl === true,
        localRuntimeControl: profile.permissions?.localRuntimeControl === true,
      },
    } : null,
  };
}

function resolvePriorityLane(req = {}, body = {}, profile = null) {
  const raw = String(body.priorityTier || body.priority || body.audience || body.accessTier || '').trim().toLowerCase();
  const roles = [
    req.user?.role,
    ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
    req.user?.tier,
    req.user?.plan,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  const isAdmin = req.user?.isAdmin === true
    || req.user?.admin === true
    || req.user?.fullAccess === true
    || roles.some((role) => ['admin', 'owner', 'founder', 'fondateur', 'djeff'].includes(role))
    || profile?.tier === TIERS.ADMIN_FAMILY;
  const isFounder = profile?.tier === TIERS.FOUNDER || canUseA11MatchMode(profile);
  const isPremium = profile?.tier === TIERS.PREMIUM;
  if (isAdmin || isFounder) {
    if (raw === 'family' || raw === 'famille') return { tier: 'family', score: 60, label: 'Famille' };
    if (raw === 'public') return { tier: 'public', score: 10, label: 'Public' };
    return { tier: 'admin', score: 100, label: isFounder && !isAdmin ? 'Fondateur' : 'Admin' };
  }
  if (isPremium) {
    if (raw === 'public') return { tier: 'public', score: 10, label: 'Public' };
    return { tier: 'family', score: 60, label: 'Famille' };
  }
  return { tier: 'public', score: 10, label: 'Public' };
}

function createSessionId() {
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.slice(0, 900);
}

function sanitizeStreamDescriptor(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const url = sanitizeUrl(source.url || source.streamUrl || source.embedUrl || source.playerUrl);
  const embedUrl = sanitizeUrl(source.embedUrl || source.url || source.streamUrl || source.playerUrl);
  const controlUrl = sanitizeUrl(source.controlUrl);
  const mode = String(source.mode || source.streamMode || (url ? 'novnc' : 'waiting-worker-stream'))
    .trim()
    .toLowerCase()
    .slice(0, 80) || 'waiting-worker-stream';
  return {
    ready: source.ready === true || Boolean(url),
    mode,
    url,
    embedUrl,
    controlUrl,
    message: String(source.message || '').trim().slice(0, 280) || null,
  };
}

function buildInputDescriptor(session = {}) {
  const sessionId = String(session.id || '').trim();
  return {
    ready: true,
    mode: 'queued-json',
    endpoint: sessionId ? `/api/match-arena/sessions/${encodeURIComponent(sessionId)}/input` : null,
    claimEndpoint: sessionId ? `/api/match-arena/local-worker/sessions/${encodeURIComponent(sessionId)}/input-events` : null,
    sequence: Number(session.inputSeq || 0),
    accepted: ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'start', 'select', 'l', 'r', 'coin'],
  };
}

function getRequestUserId(req = {}) {
  return req.user?.id || req.user?.sub || req.user?.email || null;
}

function getRequestDisplayName(req = {}) {
  return String(req.user?.displayName || req.user?.name || req.user?.email || 'Joueur').trim().slice(0, 80) || 'Joueur';
}

function getSessionPlayers(session = {}) {
  return Array.isArray(session.players) ? session.players : [];
}

function getRequestPlayer(session = {}, req = {}) {
  const requestUserId = getRequestUserId(req);
  const players = getSessionPlayers(session);
  if (requestUserId) {
    const existing = players.find((player) => player.userId && player.userId === requestUserId);
    if (existing) return existing;
  }
  if (!session.userId || (requestUserId && session.userId === requestUserId)) {
    return players.find((player) => Number(player.slot || 0) === 1) || { slot: 1, role: 'host' };
  }
  return null;
}

function requestCanSeeSession(req, session = {}) {
  const requestUserId = getRequestUserId(req);
  if (!session.userId || (requestUserId && session.userId === requestUserId)) return true;
  if (getRequestPlayer(session, req)) return true;
  return session.visibility === 'public';
}

function sanitizeRuntimeDescriptor(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const capabilities = Array.isArray(source.capabilities) ? source.capabilities : fallback.capabilities;
  return {
    playable: source.playable === true || fallback.playable === true || false,
    emulator: String(source.emulator || fallback.emulator || 'retroarch/libretro').trim().slice(0, 120),
    transport: String(source.transport || fallback.transport || 'local-worker-pull').trim().slice(0, 120),
    stream: String(source.stream || fallback.stream || 'waiting-worker-stream').trim().slice(0, 120),
    input: String(source.input || fallback.input || 'queued-json').trim().slice(0, 120),
    capabilities: (Array.isArray(capabilities) ? capabilities : [])
      .map((value) => String(value || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 24),
  };
}

function publicSession(session = {}, req = null) {
  const player = req ? getRequestPlayer(session, req) : null;
  const players = getSessionPlayers(session)
    .map((entry) => ({
      slot: Number(entry.slot || 0),
      label: String(entry.label || `Joueur ${entry.slot || ''}`).trim().slice(0, 80),
      role: String(entry.role || '').trim().slice(0, 40) || null,
      automated: entry.automated === true,
      joinedAt: entry.joinedAt || null,
    }))
    .filter((entry) => entry.slot > 0)
    .sort((a, b) => a.slot - b.slot);
  return {
    id: session.id,
    state: session.state,
    status: session.state,
    gameId: session.gameId,
    gameTitle: session.gameTitle,
    mode: session.mode,
    opponent: session.opponent,
    a11Mode: session.a11Mode || buildA11ModeDescriptor(session.mode),
    visibility: session.visibility || 'private',
    priorityTier: session.priorityTier,
    priorityLabel: session.priorityLabel,
    createdAt: session.createdAt,
    startedAt: session.startedAt || null,
    finishedAt: session.finishedAt || null,
    workerId: session.workerId || null,
    leasedAt: session.leasedAt || null,
    stream: session.stream || null,
    input: session.input || buildInputDescriptor(session),
    runtime: session.runtime || sanitizeRuntimeDescriptor(),
    export: session.export || null,
    error: session.error || null,
    message: session.message || null,
    plan: session.plan || null,
    lastInputAt: session.lastInputAt || null,
    players,
    playerSlot: player ? Number(player.slot || 1) : null,
    joinable: session.visibility === 'public'
      && !['failed', 'done'].includes(String(session.state || '').toLowerCase())
      && players.length < 4,
  };
}

function requestOwnsSession(req, session = {}) {
  const requestUserId = getRequestUserId(req);
  if (!session.userId || !requestUserId) return true;
  return session.userId === requestUserId;
}

function pruneSessions(now = Date.now()) {
  for (const [id, session] of sessions.entries()) {
    if (session.createdAtMs && now - session.createdAtMs > SESSION_TTL_MS) {
      sessions.delete(id);
    } else if (session.state === 'leased' && session.leasedAtMs && now - session.leasedAtMs > WORKER_LEASE_MS) {
      session.state = 'queued';
      session.workerId = null;
      session.leasedAt = null;
      session.leasedAtMs = null;
      session.leaseExpiredCount = Number(session.leaseExpiredCount || 0) + 1;
    }
  }
}

function sessionHasUsableStream(session = {}) {
  return session.stream?.ready === true
    || Boolean(session.stream?.url)
    || Boolean(session.stream?.embedUrl);
}

function findClaimableSession(options = {}) {
  pruneSessions();
  const workerCanRefreshStream = options.streamReady === true;
  return Array.from(sessions.values())
    .filter((session) => {
      if (session.state === 'queued') return true;
      return workerCanRefreshStream
        && session.state === 'ready'
        && !sessionHasUsableStream(session);
    })
    .sort((a, b) => {
      const priorityDelta = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
      if (priorityDelta) return priorityDelta;
      return Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0);
    })[0] || null;
}

function buildQueueStatus() {
  pruneSessions();
  const list = Array.from(sessions.values());
  const states = list.reduce((acc, session) => {
    const state = String(session.state || 'unknown');
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
  const priorities = list.reduce((acc, session) => {
    const tier = String(session.priorityTier || 'public');
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});
  return {
    total: list.length,
    active: list.filter((session) => ['queued', 'leased', 'ready', 'running'].includes(session.state)).length,
    states,
    priorities,
  };
}

function resolvePlayerSlotForInput(session = {}, body = {}, req = {}) {
  const player = getRequestPlayer(session, req);
  if (player) return Math.max(1, Math.min(4, Number(player.slot || 1)));
  return Number.isFinite(Number(body.player)) ? Math.max(1, Math.min(4, Number(body.player))) : 1;
}

function recordInputEvent(session, body = {}, req = {}) {
  const control = String(body.control || body.button || body.key || body.action || '').trim().toLowerCase().slice(0, 40);
  if (!control) return { error: 'missing_control' };
  const action = String(body.action || body.type || 'press').trim().toLowerCase().slice(0, 40) || 'press';
  const now = new Date().toISOString();
  const event = {
    seq: Number(session.inputSeq || 0) + 1,
    at: now,
    source: 'browser',
    player: resolvePlayerSlotForInput(session, body, req),
    control,
    action,
    value: Number.isFinite(Number(body.value)) ? Number(body.value) : (action === 'release' ? 0 : 1),
    durationMs: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.min(5000, Number(body.durationMs))) : null,
    clientId: String(req.headers?.['x-a11-client-id'] || '').trim().slice(0, 80) || null,
  };
  session.inputSeq = event.seq;
  session.lastInputAt = now;
  session.inputEvents = Array.isArray(session.inputEvents) ? session.inputEvents : [];
  session.inputEvents.push(event);
  if (session.inputEvents.length > MAX_INPUT_EVENTS) {
    session.inputEvents.splice(0, session.inputEvents.length - MAX_INPUT_EVENTS);
  }
  session.input = buildInputDescriptor(session);
  if (session.state === 'ready') session.state = 'running';
  return { event };
}

function createMatchArenaRouter(options = {}) {
  const router = express.Router();
  const verifyJWT = typeof options.verifyJWT === 'function' ? options.verifyJWT : null;
  const db = options.db || null;
  const env = options.env || process.env;

  function requireUser(req, res, next) {
    if (!verifyJWT) return next();
    return verifyJWT(req, res, next);
  }

  async function resolveMatchArenaProfile(req) {
    if (req.matchArenaAccount) return req.matchArenaAccount;
    if (!verifyJWT) {
      req.matchArenaAccount = {
        ok: true,
        tier: TIERS.ADMIN_FAMILY,
        label: 'Dev local',
        permissions: {
          romstationControl: true,
          localRuntimeControl: true,
        },
      };
      return req.matchArenaAccount;
    }
    req.matchArenaAccount = await resolveMcpAccountProfile(req, { db, env });
    return req.matchArenaAccount;
  }

  router.use(express.json({ limit: '1mb' }));

  router.get('/status', requireUser, async (req, res) => {
    const account = await resolveMatchArenaProfile(req);
    const catalog = getMergedCatalog();
    const workerSeenAt = lastWorkerHeartbeat?.seenAtMs || (workerInventory.receivedAt ? Date.parse(workerInventory.receivedAt) : 0);
    const workerAgeMs = workerSeenAt ? Math.max(0, Date.now() - workerSeenAt) : null;
    res.json({
      ok: true,
      schema: 'funesterie.match-arena.status.v1',
      enabled: envBool('A11_MATCH_ARENA_ENABLED', true),
      generatedAt: new Date().toISOString(),
      gamesRoot: {
        configured: Boolean(String(process.env.A11_MATCH_ARENA_GAMES_ROOT || '').trim()),
        localRootLabel: catalog.localRootLabel,
        localRootAvailable: catalog.rootAvailable,
      },
      catalog: {
        count: catalog.games.length,
        sources: catalog.sources,
        workerInventoryAt: catalog.workerInventoryAt,
      },
      queue: buildQueueStatus(),
      access: {
        accountTier: account.tier,
        accountLabel: account.label,
        a11MatchAllowed: canUseA11MatchMode(account),
        modes: [
          buildA11ModeDescriptor(MATCH_ARENA_MODES.USER_VS_A11, account),
          buildA11ModeDescriptor(MATCH_ARENA_MODES.USER_WITH_A11, account),
          buildA11ModeDescriptor(MATCH_ARENA_MODES.USER_VS_PLAYER, account),
        ],
      },
      worker: {
        configured: Boolean(getWorkerToken()),
        lastSeenAt: workerSeenAt ? new Date(workerSeenAt).toISOString() : null,
        ageMs: workerAgeMs,
        online: workerAgeMs !== null && workerAgeMs <= WORKER_STALE_MS,
        heartbeat: lastWorkerHeartbeat?.payload || null,
      },
      architecture: {
        screen: 'Session navigateur active: le worker publie WebRTC/noVNC quand son pont RetroArch est disponible',
        input: 'Commandes clavier/manette envoyees en queue; le worker local les recupere sans port entrant',
        storage: 'Drive/OneDrive/R2 reserves aux exports: saves, replays, logs, configs',
        games: 'Fichiers locaux fournis par le proprietaire; non publies par l API',
      },
    });
  });

  router.get('/games', requireUser, (_req, res) => {
    res.json({ ok: true, ...getMergedCatalog() });
  });

  router.post('/sessions', requireUser, async (req, res) => {
    pruneSessions();
    if (!envBool('A11_MATCH_ARENA_ENABLED', true)) {
      return res.status(503).json({ ok: false, error: 'match_arena_disabled' });
    }
    const catalog = getMergedCatalog();
    const gameId = String(req.body?.gameId || '').trim();
    const game = catalog.games.find((candidate) => candidate.id === gameId);
    if (!game) {
      return res.status(404).json({
        ok: false,
        error: 'game_not_found',
        message: 'Jeu introuvable dans l inventaire local.',
      });
    }
    const account = await resolveMatchArenaProfile(req);
    const requestedMode = normalizeMatchArenaMode(req.body?.mode || 'user-vs-a11');
    if (requestedMode !== MATCH_ARENA_MODES.USER_VS_PLAYER && !canUseA11MatchMode(account)) {
      return res.status(403).json(a11MatchPermissionDenied(account, requestedMode));
    }
    const lane = resolvePriorityLane(req, req.body || {}, account);
    const now = Date.now();
    const a11Mode = buildA11ModeDescriptor(requestedMode, account);
    const requestedVisibility = String(req.body?.visibility || '').trim().toLowerCase();
    const visibility = (requestedMode === MATCH_ARENA_MODES.USER_VS_PLAYER && requestedVisibility !== 'private')
      ? 'public'
      : 'private';
    const requestUserId = getRequestUserId(req);
    const session = {
      id: createSessionId(),
      state: 'queued',
      createdAtMs: now,
      createdAt: new Date(now).toISOString(),
      startedAt: null,
      finishedAt: null,
      gameId: game.id,
      gameTitle: game.title,
      game,
      mode: requestedMode,
      opponent: String(req.body?.opponent || (a11Mode.role === 'copilot' ? 'a11-copilot' : a11Mode.role === 'opponent' ? 'a11' : 'public-player')).trim().slice(0, 80) || 'a11',
      a11Mode,
      visibility,
      priorityTier: lane.tier,
      priorityScore: lane.score,
      priorityLabel: lane.label,
      userId: requestUserId,
      players: [{
        slot: 1,
        userId: requestUserId,
        label: getRequestDisplayName(req),
        role: 'host',
        joinedAt: new Date(now).toISOString(),
      }].concat(a11Mode.enabled ? [{
        slot: 2,
        userId: 'a11-agent',
        label: 'A11',
        role: a11Mode.role === 'copilot' ? 'a11-copilot' : 'a11-opponent',
        joinedAt: new Date(now).toISOString(),
        automated: true,
      }] : []),
      workerId: null,
      leasedAt: null,
      leasedAtMs: null,
      stream: {
        ready: false,
        mode: 'waiting-worker-stream',
        url: null,
        embedUrl: null,
        controlUrl: null,
        message: 'Session creee. Le worker prepare l emulateur et publiera l image ici; aucun telechargement cote joueur.',
      },
      input: {
        ready: true,
        mode: 'queued-json',
        endpoint: null,
        claimEndpoint: null,
        sequence: 0,
        accepted: ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'start', 'select', 'l', 'r', 'coin'],
      },
      runtime: {
        playable: false,
        emulator: 'retroarch/libretro',
        transport: 'local-worker-pull',
        stream: 'waiting-worker-stream',
        input: 'queued-json',
        capabilities: [
          'priority-queue',
          'local-rom-inventory',
          'drive-export',
          'input-queue',
          ...(a11Mode.enabled ? ['romstation-control', 'a11-match-mode', a11Mode.role === 'copilot' ? 'a11-copilot' : 'a11-opponent'] : []),
        ],
      },
      export: {
        ready: false,
        localPath: null,
        drivePath: null,
        manifestUrl: null,
      },
      plan: {
        engine: 'retroarch/libretro worker',
        input: 'browser controls -> backend queue -> local worker pull',
        video: 'worker capture -> WebRTC/noVNC URL when configured',
        a11: a11Mode.enabled
          ? `${a11Mode.label}: A11 utilise les outils autorises de la session pour ${a11Mode.role === 'copilot' ? 'assister le joueur' : 'jouer le second camp'}.`
          : 'Mode joueur en ligne sans agent A11.',
        storage: ['save states', 'replays', 'configs', 'logs'],
      },
      inputEvents: [],
      inputSeq: 0,
      lastInputAt: null,
      error: null,
      message: null,
    };
    session.input = buildInputDescriptor(session);
    sessions.set(session.id, session);
    return res.status(202).json({ ok: true, session: publicSession(session, req) });
  });

  router.get('/sessions', requireUser, (req, res) => {
    pruneSessions();
    const list = Array.from(sessions.values())
      .filter((session) => requestCanSeeSession(req, session))
      .filter((session) => ['queued', 'leased', 'ready', 'running'].includes(String(session.state || '').toLowerCase()))
      .sort((a, b) => {
        const priorityDelta = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
        if (priorityDelta) return priorityDelta;
        return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
      })
      .slice(0, 24)
      .map((session) => publicSession(session, req));
    return res.json({
      ok: true,
      schema: 'funesterie.match-arena.sessions.v1',
      sessions: list,
      queue: buildQueueStatus(),
    });
  });

  router.get('/sessions/:sessionId', requireUser, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    if (!requestCanSeeSession(req, session)) {
      return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    }
    return res.json({ ok: true, session: publicSession(session, req) });
  });

  router.post('/sessions/:sessionId/join', requireUser, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    if (session.visibility !== 'public') {
      return res.status(403).json({
        ok: false,
        error: 'match_session_private',
        message: 'Cette session Match Arena n est pas publique.',
      });
    }
    if (['failed', 'done'].includes(String(session.state || '').toLowerCase())) {
      return res.status(409).json({
        ok: false,
        error: 'match_session_closed',
        message: 'Cette session Match Arena est terminee.',
      });
    }

    const currentPlayer = getRequestPlayer(session, req);
    if (currentPlayer) {
      return res.json({ ok: true, playerSlot: currentPlayer.slot, session: publicSession(session, req) });
    }

    const players = getSessionPlayers(session);
    const usedSlots = new Set(players.map((player) => Number(player.slot || 0)));
    const slot = [2, 3, 4].find((candidate) => !usedSlots.has(candidate));
    if (!slot) {
      return res.status(409).json({
        ok: false,
        error: 'match_session_full',
        message: 'Cette session Match Arena est deja complete.',
      });
    }
    players.push({
      slot,
      userId: getRequestUserId(req),
      label: getRequestDisplayName(req),
      role: 'guest',
      joinedAt: new Date().toISOString(),
    });
    session.players = players;
    session.opponent = slot === 2 ? 'player-2' : session.opponent;
    session.mode = session.mode === 'user-vs-ai' ? 'user-vs-player' : session.mode;
    session.message = `Joueur ${slot} connecte.`;
    return res.json({ ok: true, playerSlot: slot, session: publicSession(session, req) });
  });

  router.post('/sessions/:sessionId/input', requireUser, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session || !requestCanSeeSession(req, session)) {
      return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    }
    if (['failed', 'done'].includes(session.state)) {
      return res.status(409).json({
        ok: false,
        error: 'match_session_closed',
        message: 'Cette session Match Arena est terminee.',
      });
    }
    const recorded = recordInputEvent(session, req.body || {}, req);
    if (recorded.error) {
      return res.status(400).json({ ok: false, error: recorded.error });
    }
    return res.json({
      ok: true,
      eventSeq: recorded.event.seq,
      session: publicSession(session, req),
    });
  });

  router.post('/local-worker/heartbeat', requireWorkerAuth, (req, res) => {
    const workerId = String(req.body?.workerId || req.body?.id || `${os.hostname()}-match-worker`).trim().slice(0, 120);
    lastWorkerHeartbeat = {
      workerId,
      seenAtMs: Date.now(),
      payload: {
        workerId,
        state: String(req.body?.state || 'online').trim().slice(0, 80),
        retroarchAvailable: req.body?.retroarchAvailable === true,
        dockerAvailable: req.body?.dockerAvailable === true,
        podmanAvailable: req.body?.podmanAvailable === true,
        streamReady: req.body?.streamReady === true,
        streamMode: String(req.body?.streamMode || '').trim().slice(0, 80) || null,
        streamSource: String(req.body?.streamSource || '').trim().slice(0, 80) || null,
        inputMode: String(req.body?.inputMode || '').trim().slice(0, 80) || null,
        gamesRootAvailable: req.body?.gamesRootAvailable === true,
        processed: Number.isFinite(Number(req.body?.processed)) ? Number(req.body.processed) : null,
        failed: Number.isFinite(Number(req.body?.failed)) ? Number(req.body.failed) : null,
        activeSessions: Number.isFinite(Number(req.body?.activeSessions)) ? Number(req.body.activeSessions) : null,
      },
    };
    const claimable = findClaimableSession({ streamReady: req.body?.streamReady === true });
    res.json({
      ok: true,
      enabled: envBool('A11_MATCH_ARENA_ENABLED', true),
      workerId,
      nextSessionId: claimable?.id || null,
      queue: buildQueueStatus(),
    });
  });

  router.post('/local-worker/inventory', requireWorkerAuth, (req, res) => {
    const workerId = String(req.body?.workerId || req.body?.id || `${os.hostname()}-match-worker`).trim().slice(0, 120);
    const inventory = setWorkerInventory(workerId, req.body?.games || []);
    lastWorkerHeartbeat = {
      workerId,
      seenAtMs: Date.now(),
      payload: {
        workerId,
        state: 'inventory',
        retroarchAvailable: req.body?.retroarchAvailable === true,
        dockerAvailable: req.body?.dockerAvailable === true,
        podmanAvailable: req.body?.podmanAvailable === true,
        streamReady: req.body?.streamReady === true,
        streamMode: String(req.body?.streamMode || '').trim().slice(0, 80) || null,
        streamSource: String(req.body?.streamSource || '').trim().slice(0, 80) || null,
        inputMode: String(req.body?.inputMode || '').trim().slice(0, 80) || null,
        gamesRootAvailable: req.body?.gamesRootAvailable === true,
        processed: null,
        failed: null,
      },
    };
    res.json({
      ok: true,
      workerId,
      received: inventory.games.length,
      catalog: {
        count: getMergedCatalog().games.length,
        workerInventoryAt: inventory.receivedAt,
      },
    });
  });

  router.post('/local-worker/claim', requireWorkerAuth, (req, res) => {
    if (!envBool('A11_MATCH_ARENA_ENABLED', true)) {
      return res.json({ ok: true, enabled: false, session: null, pollIntervalMs: 2500 });
    }
    const session = findClaimableSession({ streamReady: req.body?.streamReady === true });
    if (!session) {
      return res.json({
        ok: true,
        enabled: true,
        session: null,
        pollIntervalMs: 1500,
        queue: buildQueueStatus(),
      });
    }
    const workerId = String(req.body?.workerId || req.body?.id || `${os.hostname()}-match-worker`).trim().slice(0, 120);
    const now = Date.now();
    session.state = 'leased';
    session.startedAt = session.startedAt || new Date(now).toISOString();
    session.leasedAt = new Date(now).toISOString();
    session.leasedAtMs = now;
    session.workerId = workerId;
    return res.json({
      ok: true,
      enabled: true,
      leaseMs: WORKER_LEASE_MS,
      session: {
        ...publicSession(session),
        game: session.game,
      },
    });
  });

  router.post('/local-worker/sessions/:sessionId/live', requireWorkerAuth, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    const requestedState = String(req.body?.state || 'running').trim().toLowerCase();
    session.state = ['ready', 'running', 'leased'].includes(requestedState) ? requestedState : 'running';
    session.startedAt = session.startedAt || new Date().toISOString();
    session.workerId = String(req.body?.workerId || session.workerId || '').trim().slice(0, 120) || session.workerId;
    session.stream = sanitizeStreamDescriptor(req.body?.stream || req.body || {});
    session.runtime = sanitizeRuntimeDescriptor(req.body?.runtime || {}, session.runtime);
    session.input = {
      ...buildInputDescriptor(session),
      mode: String(req.body?.input?.mode || session.input?.mode || 'queued-json').trim().slice(0, 80),
    };
    session.message = String(req.body?.message || session.message || 'Session Match Arena active.').slice(0, 800);
    session.error = null;
    return res.json({ ok: true, session: publicSession(session) });
  });

  router.post('/local-worker/sessions/:sessionId/input-events', requireWorkerAuth, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    const afterSeq = Number.isFinite(Number(req.body?.afterSeq ?? req.body?.lastSeq))
      ? Number(req.body?.afterSeq ?? req.body?.lastSeq)
      : 0;
    const events = (Array.isArray(session.inputEvents) ? session.inputEvents : [])
      .filter((event) => Number(event.seq || 0) > afterSeq)
      .slice(0, 80);
    return res.json({
      ok: true,
      sessionId,
      state: session.state,
      events,
      lastSeq: events.length ? events[events.length - 1].seq : Number(session.inputSeq || afterSeq || 0),
    });
  });

  router.post('/local-worker/sessions/:sessionId/complete', requireWorkerAuth, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    const nextState = String(req.body?.state || 'ready').trim().toLowerCase();
    session.state = nextState === 'done' ? 'done' : nextState === 'running' ? 'running' : 'ready';
    session.finishedAt = session.state === 'done' ? new Date().toISOString() : null;
    session.stream = sanitizeStreamDescriptor(req.body?.stream || req.body || {});
    session.runtime = sanitizeRuntimeDescriptor(req.body?.runtime || {}, session.runtime);
    session.input = {
      ...buildInputDescriptor(session),
      mode: String(req.body?.input?.mode || session.input?.mode || 'queued-json').trim().slice(0, 80),
    };
    session.export = {
      ready: true,
      localPath: String(req.body?.localExportPath || req.body?.export?.localPath || '').trim() || null,
      drivePath: String(req.body?.drivePath || req.body?.export?.drivePath || '').trim() || null,
      manifestUrl: String(req.body?.manifestUrl || req.body?.export?.manifestUrl || '').trim() || null,
    };
    session.message = String(req.body?.message || 'Session Match Arena preparee par le worker local.').slice(0, 800);
    session.error = null;
    return res.json({ ok: true, session: publicSession(session) });
  });

  router.post('/local-worker/sessions/:sessionId/fail', requireWorkerAuth, (req, res) => {
    pruneSessions();
    const sessionId = String(req.params?.sessionId || '').trim();
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'match_session_not_found' });
    session.state = 'failed';
    session.finishedAt = new Date().toISOString();
    session.error = String(req.body?.error || 'match_worker_failed').slice(0, 160);
    session.message = String(req.body?.message || req.body?.error || 'Le worker Match Arena a echoue.').slice(0, 800);
    return res.json({ ok: true, session: publicSession(session) });
  });

  return router;
}

module.exports = createMatchArenaRouter;
module.exports._private = {
  scanLocalGameCatalog,
  sanitizeWorkerGame,
  resolvePriorityLane,
};
