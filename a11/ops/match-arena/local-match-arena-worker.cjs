'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_GAMES_ROOT = 'C:\\Users\\Djeff\\Desktop\\jeux';
const DEFAULT_STATUS_PATH = 'D:\\agent-bus\\match-arena\\local-match-arena-worker-status.json';
const DEFAULT_EXPORT_ROOT = 'D:\\agent-bus\\match-arena\\sessions';
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
const MAX_SCAN_FILES = 5000;

function env(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableId(prefix, value) {
  const crypto = require('node:crypto');
  const slug = String(value || 'game')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'game';
  const hash = crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
  return `${prefix}-${slug}-${hash}`;
}

function readToken() {
  const candidates = [
    env('A11_MATCH_ARENA_WORKER_TOKEN_FILE'),
    'D:\\projets\\funesterie\\secrets\\match-arena-worker-token.txt',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Optional secret file.
    }
  }
  return env('A11_MATCH_ARENA_WORKER_TOKEN');
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${String(baseUrl || '').replace(/\/$/, '')}/`).toString();
}

function parseRemoteBaseUrls() {
  const raw = env('A11_MATCH_ARENA_REMOTE_URLS', env('A11_MATCH_ARENA_REMOTE_URL', 'https://a11.funesterie.me,https://k44.funesterie.me'));
  const urls = raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(urls.length ? urls : ['https://a11.funesterie.me']));
}

function commandAvailable(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  try {
    const probe = spawnSync(checker, [command], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return probe.status === 0;
  } catch {
    return false;
  }
}

function safeRelative(root, target) {
  const relative = path.relative(root, target);
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
    const ext = path.extname(entry.name).toLowerCase();
    result.extensions[ext || '(none)'] = (result.extensions[ext || '(none)'] || 0) + 1;
    const relativePath = safeRelative(root, fullPath);
    if (!relativePath) continue;
    if (/images\/cover\.(png|jpg|jpeg|webp)$/i.test(relativePath)) result.hasCover = true;
    if (!PLAYABLE_EXTENSIONS.has(ext)) continue;
    let size = null;
    try {
      size = fs.statSync(fullPath).size;
    } catch {
      size = null;
    }
    result.playableFiles.push({
      name: entry.name,
      relativePath,
      extension: ext.replace(/^\./, ''),
      size,
    });
  }
}

function scanGames() {
  const root = env('A11_MATCH_ARENA_GAMES_ROOT', DEFAULT_GAMES_ROOT);
  const games = [];
  if (!fs.existsSync(root)) return { gamesRoot: root, gamesRootAvailable: false, games };
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { gamesRoot: root, gamesRootAvailable: false, games };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    const result = {
      scanned: 0,
      extensions: {},
      playableFiles: [],
      hasCover: false,
    };
    scanFiles(fullPath, fullPath, result);
    if (!result.playableFiles.length) continue;
    games.push({
      id: stableId('game', entry.name),
      title: entry.name,
      rootLabel: path.basename(root),
      playableCount: result.playableFiles.length,
      extensions: result.extensions,
      hasCover: result.hasCover,
      playableFiles: result.playableFiles.slice(0, 20),
    });
  }
  games.sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr'));
  return { gamesRoot: root, gamesRootAvailable: true, games };
}

function writeStatus(status) {
  const statusPath = env('A11_MATCH_ARENA_STATUS_PATH', DEFAULT_STATUS_PATH);
  try {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({
      schema: 'funesterie.local-match-arena-worker.v1',
      updatedAt: new Date().toISOString(),
      ...status,
    }, null, 2), 'utf8');
  } catch {
    // Best effort local status.
  }
}

async function postJson(url, token, payload, timeoutMs = 30000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-a11-worker-token': token,
    },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `http_${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body || {};
}

function buildDriveExportPath(sessionId) {
  const configured = env('A11_MATCH_ARENA_DRIVE_ROOT');
  const candidates = [
    configured,
    'G:\\Mon Drive\\Funesterie\\MatchArena',
    path.join(os.homedir(), 'OneDrive', 'Funesterie', 'MatchArena'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return path.join(candidate, sessionId);
    } catch {
      // Optional drive path.
    }
  }
  return null;
}

function writeSessionManifest(session, inventory) {
  const exportRoot = env('A11_MATCH_ARENA_EXPORT_ROOT', DEFAULT_EXPORT_ROOT);
  const sessionDir = path.join(exportRoot, session.id);
  fs.mkdirSync(sessionDir, { recursive: true });
  const game = inventory.games.find((candidate) => candidate.id === session.gameId) || session.game || null;
  const manifest = {
    schema: 'funesterie.match-arena.session-export.v1',
    createdAt: new Date().toISOString(),
    session: {
      id: session.id,
      gameId: session.gameId,
      gameTitle: session.gameTitle,
      mode: session.mode,
      opponent: session.opponent,
      priorityTier: session.priorityTier,
    },
    game: game ? {
      id: game.id,
      title: game.title,
      playableCount: game.playableCount,
      playableFiles: game.playableFiles,
    } : null,
    worker: {
      id: env('A11_MATCH_ARENA_WORKER_ID', `${os.hostname()}-match-arena`),
      retroarchAvailable: commandAvailable('retroarch'),
      streamMode: 'pending-retroarch-stream',
    },
    next: [
      'Launch RetroArch/libretro container or desktop bridge',
      'Attach browser input to worker input adapter',
      'Publish WebRTC/noVNC stream URL',
      'Mirror save/replay/logs to Drive or OneDrive',
    ],
  };
  const manifestPath = path.join(sessionDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const drivePath = buildDriveExportPath(session.id);
  if (drivePath) {
    try {
      fs.mkdirSync(drivePath, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(drivePath, 'manifest.json'));
    } catch {
      // Drive mirror is optional.
    }
  }

  return { manifestPath, sessionDir, drivePath };
}

async function run() {
  const token = readToken();
  if (!token) throw new Error('match_arena_worker_token_missing');

  const remoteBaseUrls = parseRemoteBaseUrls();
  const workerId = env('A11_MATCH_ARENA_WORKER_ID', `${os.hostname()}-match-arena`).slice(0, 120);
  let processed = 0;
  let failed = 0;
  let lastInventoryAt = 0;
  let cachedInventory = scanGames();

  writeStatus({ ok: true, state: 'starting', workerId, remoteBaseUrls, games: cachedInventory.games.length, processed, failed });

  while (true) {
    try {
      const now = Date.now();
      if (!lastInventoryAt || now - lastInventoryAt > 60000) {
        cachedInventory = scanGames();
        for (const remoteBaseUrl of remoteBaseUrls) {
          await postJson(buildUrl(remoteBaseUrl, '/api/match-arena/local-worker/inventory'), token, {
            workerId,
            gamesRootAvailable: cachedInventory.gamesRootAvailable,
            retroarchAvailable: commandAvailable('retroarch'),
            games: cachedInventory.games,
          }, 30000).catch(() => null);
        }
        lastInventoryAt = now;
      }

      let claim = null;
      let claimedRemoteBaseUrl = null;
      let lastError = null;
      for (const remoteBaseUrl of remoteBaseUrls) {
        try {
          await postJson(buildUrl(remoteBaseUrl, '/api/match-arena/local-worker/heartbeat'), token, {
            workerId,
            state: 'polling',
            gamesRootAvailable: cachedInventory.gamesRootAvailable,
            retroarchAvailable: commandAvailable('retroarch'),
            processed,
            failed,
          }, 15000);
          const candidate = await postJson(buildUrl(remoteBaseUrl, '/api/match-arena/local-worker/claim'), token, { workerId }, 30000);
          if (candidate?.session) {
            claim = candidate;
            claimedRemoteBaseUrl = remoteBaseUrl;
            break;
          }
          if (!claim) {
            claim = candidate;
            claimedRemoteBaseUrl = remoteBaseUrl;
          }
        } catch (error) {
          lastError = error;
        }
      }
      if (!claim && lastError) throw lastError;

      if (!claim?.session) {
        writeStatus({
          ok: true,
          state: 'idle',
          workerId,
          remoteBaseUrls,
          gamesRoot: cachedInventory.gamesRoot,
          gamesRootAvailable: cachedInventory.gamesRootAvailable,
          games: cachedInventory.games.length,
          processed,
          failed,
          remoteQueue: claim?.queue || null,
        });
        await sleep(Number(claim?.pollIntervalMs || 1500) || 1500);
        continue;
      }

      const session = claim.session;
      writeStatus({
        ok: true,
        state: 'preparing',
        workerId,
        remoteBaseUrl: claimedRemoteBaseUrl,
        sessionId: session.id,
        gameTitle: session.gameTitle,
        processed,
        failed,
      });

      try {
        const exported = writeSessionManifest(session, cachedInventory);
        await postJson(buildUrl(claimedRemoteBaseUrl, `/api/match-arena/local-worker/sessions/${encodeURIComponent(session.id)}/complete`), token, {
          workerId,
          state: 'ready',
          streamMode: 'pending-retroarch-stream',
          localExportPath: exported.sessionDir,
          drivePath: exported.drivePath,
          message: 'Inventaire et manifeste prets; le streaming RetroArch/WebRTC reste la prochaine etape.',
        }, 30000);
        processed += 1;
        writeStatus({ ok: true, state: 'prepared', workerId, remoteBaseUrl: claimedRemoteBaseUrl, sessionId: session.id, localExportPath: exported.sessionDir, drivePath: exported.drivePath, processed, failed });
      } catch (error) {
        failed += 1;
        await postJson(buildUrl(claimedRemoteBaseUrl, `/api/match-arena/local-worker/sessions/${encodeURIComponent(session.id)}/fail`), token, {
          workerId,
          error: 'match_arena_worker_failed',
          message: String(error?.message || error).slice(0, 800),
        }, 30000).catch(() => null);
        writeStatus({ ok: false, state: 'session_failed', workerId, remoteBaseUrl: claimedRemoteBaseUrl, sessionId: session.id, error: String(error?.message || error), processed, failed });
      }
    } catch (error) {
      writeStatus({ ok: false, state: 'loop_error', workerId, remoteBaseUrls, error: String(error?.message || error), processed, failed });
      await sleep(5000);
    }
  }
}

run().catch((error) => {
  writeStatus({ ok: false, state: 'fatal', error: String(error?.message || error) });
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
