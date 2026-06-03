'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const DEFAULT_GAMES_ROOT = 'C:\\Users\\Djeff\\Desktop\\jeux';
const DEFAULT_STATUS_PATH = 'E:\\Funesterie\\match-arena\\local-match-arena-worker-status.json';
const DEFAULT_EXPORT_ROOT = 'E:\\Funesterie\\match-arena\\sessions';
const DEFAULT_RETROARCH_COMMAND = 'E:\\Funesterie\\RetroArch\\retroarch.exe';
const DEFAULT_LOCAL_STREAM_PORT = 6080;
const DEFAULT_STREAM_CANDIDATES = [
  'http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale&view_only=false',
  'http://localhost:6080/vnc.html?autoconnect=true&resize=scale&view_only=false',
  'http://127.0.0.1:6081/vnc.html?autoconnect=true&resize=scale&view_only=false',
  'http://localhost:6081/vnc.html?autoconnect=true&resize=scale&view_only=false',
  'http://127.0.0.1:8080/',
  'http://localhost:8080/',
];
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
let localStreamBridge = null;

function env(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function envBool(name, fallback = false) {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(raw);
}

function envNumber(name, fallback) {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function fileExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

function resolveRetroarchCommand() {
  const configured = env('A11_MATCH_ARENA_RETROARCH_COMMAND');
  if (configured && (fileExists(configured) || commandAvailable(configured))) return configured;
  if (commandAvailable('retroarch')) return 'retroarch';
  if (fileExists(DEFAULT_RETROARCH_COMMAND)) return DEFAULT_RETROARCH_COMMAND;
  if (fileExists('C:\\RetroArch-Win64\\retroarch.exe')) return 'C:\\RetroArch-Win64\\retroarch.exe';
  return '';
}

function resolveRetroarchCore(playablePath, game, capabilities = null) {
  const explicit = env('A11_MATCH_ARENA_RETROARCH_CORE');
  if (explicit && fileExists(explicit)) {
    return { corePath: explicit, coreName: path.basename(explicit), source: 'env' };
  }

  const command = capabilities?.retroarchCommand || resolveRetroarchCommand();
  const inferredCoreDir = command && path.isAbsolute(command)
    ? path.join(path.dirname(command), 'cores')
    : '';
  const coreDir = env('A11_MATCH_ARENA_RETROARCH_CORE_DIR', inferredCoreDir);
  if (!coreDir) return null;

  const ext = path.extname(playablePath || '').toLowerCase();
  const label = `${game?.title || ''} ${path.basename(playablePath || '')}`.toLowerCase();
  let candidates = [];
  if (['.smc', '.sfc'].includes(ext) || (ext === '.zip' && /(snes|super nintendo|killer instinct|mortal kombat|street fighter|donkey kong|kirby|dragon ball)/i.test(label))) {
    candidates = ['snes9x_libretro.dll', 'bsnes_libretro.dll'];
  } else if (['.gb', '.gbc'].includes(ext)) {
    candidates = ['gambatte_libretro.dll', 'sameboy_libretro.dll'];
  } else if (ext === '.gba') {
    candidates = ['mgba_libretro.dll'];
  } else if (ext === '.nes') {
    candidates = ['nestopia_libretro.dll', 'fceumm_libretro.dll'];
  } else if (['.md', '.gen', '.gg', '.sms'].includes(ext)) {
    candidates = ['genesis_plus_gx_libretro.dll'];
  } else if (['.n64', '.z64', '.v64'].includes(ext)) {
    candidates = ['mupen64plus_next_libretro.dll'];
  }

  for (const coreName of candidates) {
    const corePath = path.join(coreDir, coreName);
    if (fileExists(corePath)) return { corePath, coreName, source: 'inferred' };
  }
  return null;
}

function ffmpegAvailable() {
  return Boolean(env('A11_MATCH_ARENA_FFMPEG_COMMAND')) || commandAvailable('ffmpeg');
}

function getLocalStreamPort() {
  return Math.max(1, Math.min(65535, envNumber('A11_MATCH_ARENA_STREAM_PORT', DEFAULT_LOCAL_STREAM_PORT)));
}

function getLocalStreamUrl() {
  const port = getLocalStreamPort();
  return `http://127.0.0.1:${port}/vnc.html?autoconnect=true&resize=scale&view_only=false`;
}

function writeJsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload || {}));
}

function localStreamHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Funesterie Match Arena</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #020817; color: #e2e8f0; font-family: system-ui, sans-serif; overflow: hidden; }
    .stage { position: fixed; inset: 0; display: grid; place-items: center; background: radial-gradient(circle at 50% 45%, #102033, #020817 72%); }
    img { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
    .badge { position: fixed; left: 12px; bottom: 12px; padding: 6px 9px; border: 1px solid rgba(56,189,248,.5); border-radius: 7px; background: rgba(2,8,23,.72); color: #bae6fd; font-size: 12px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="stage"><img src="/screen.mjpg" alt="Flux local Match Arena"></div>
  <div class="badge">Match Arena - flux local</div>
</body>
</html>`;
}

function buildFfmpegCaptureArgs() {
  const fps = String(Math.max(1, Math.min(30, envNumber('A11_MATCH_ARENA_STREAM_FPS', 10))));
  const width = Math.max(320, Math.min(1920, envNumber('A11_MATCH_ARENA_STREAM_WIDTH', 1280)));
  const quality = String(Math.max(2, Math.min(15, envNumber('A11_MATCH_ARENA_STREAM_QUALITY', 8))));
  if (process.platform === 'win32') {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'gdigrab',
      '-framerate',
      fps,
      '-i',
      env('A11_MATCH_ARENA_STREAM_SOURCE', 'desktop'),
      '-vf',
      `scale=${width}:-1`,
      '-q:v',
      quality,
      '-f',
      'mjpeg',
      'pipe:1',
    ];
  }
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'x11grab',
    '-framerate',
    fps,
    '-i',
    env('DISPLAY', ':0.0'),
    '-vf',
    `scale=${width}:-1`,
    '-q:v',
    quality,
    '-f',
    'mjpeg',
    'pipe:1',
  ];
}

function serveMjpegStream(req, res) {
  const command = env('A11_MATCH_ARENA_FFMPEG_COMMAND', 'ffmpeg');
  const args = buildFfmpegCaptureArgs();
  res.writeHead(200, {
    'content-type': 'multipart/x-mixed-replace; boundary=frame',
    'cache-control': 'no-store',
    connection: 'close',
  });
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buffer = Buffer.alloc(0);
  let closed = false;
  const closeChild = () => {
    if (closed) return;
    closed = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // Best effort.
    }
  };
  req.on('close', closeChild);
  child.on('exit', () => {
    if (!res.writableEnded) res.end();
  });
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 4) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        buffer = Buffer.alloc(0);
        return;
      }
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        if (start > 0) buffer = buffer.subarray(start);
        return;
      }
      const frame = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    }
  });
}

function startLocalStreamBridge() {
  if (!envBool('A11_MATCH_ARENA_AUTOSTREAM', true)) return null;
  if (!ffmpegAvailable()) return null;
  if (localStreamBridge?.server) return localStreamBridge;

  const port = getLocalStreamPort();
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if (requestUrl.pathname === '/health') {
      return writeJsonResponse(res, 200, {
        ok: true,
        schema: 'funesterie.match-arena.local-stream.v1',
        mode: 'local-ffmpeg-mjpeg',
      });
    }
    if (requestUrl.pathname === '/screen.mjpg') {
      return serveMjpegStream(req, res);
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(localStreamHtml());
  });
  localStreamBridge = {
    server,
    url: getLocalStreamUrl(),
    source: 'local-ffmpeg',
    mode: 'local-ffmpeg-mjpeg',
    reachable: true,
    listening: false,
  };
  server.on('listening', () => {
    localStreamBridge.listening = true;
    localStreamBridge.reachable = true;
  });
  server.on('error', (error) => {
    localStreamBridge.error = String(error?.message || error);
    localStreamBridge.reachable = false;
  });
  server.listen(port, '127.0.0.1');
  return localStreamBridge;
}

async function urlResponds(url, timeoutMs = 900) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function parseStreamCandidates() {
  const raw = env('A11_MATCH_ARENA_STREAM_CANDIDATES');
  const configured = raw
    ? raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)
    : [];
  const port = env('A11_MATCH_ARENA_NOVNC_PORT');
  if (port) {
    configured.push(`http://127.0.0.1:${port}/vnc.html?autoconnect=true&resize=scale&view_only=false`);
    configured.push(`http://localhost:${port}/vnc.html?autoconnect=true&resize=scale&view_only=false`);
  }
  return Array.from(new Set([...configured, ...DEFAULT_STREAM_CANDIDATES]));
}

async function resolveStreamUrl() {
  const explicit = env('A11_MATCH_ARENA_STREAM_URL', env('A11_MATCH_ARENA_NOVNC_URL'));
  if (explicit) {
    return {
      url: explicit,
      source: 'configured',
      reachable: await urlResponds(explicit, 1200),
    };
  }
  if (localStreamBridge?.url && await urlResponds(localStreamBridge.url, 900)) {
    return {
      url: localStreamBridge.url,
      source: localStreamBridge.source || 'local-ffmpeg',
      reachable: true,
    };
  }
  for (const candidate of parseStreamCandidates()) {
    if (await urlResponds(candidate)) {
      return {
        url: candidate,
        source: 'auto-detected',
        reachable: true,
      };
    }
  }
  const localBridge = startLocalStreamBridge();
  if (localBridge?.url) {
    return {
      url: localBridge.url,
      source: localBridge.source,
      reachable: localBridge.reachable !== false,
    };
  }
  return { url: '', source: 'none', reachable: false };
}

async function detectCapabilities() {
  const stream = await resolveStreamUrl();
  const retroarchCommand = resolveRetroarchCommand();
  const retroarchAvailable = Boolean(retroarchCommand);
  const dockerAvailable = commandAvailable('docker');
  const podmanAvailable = commandAvailable('podman');
  const streamMode = env('A11_MATCH_ARENA_STREAM_MODE', stream.url ? (stream.source === 'local-ffmpeg' ? 'local-ffmpeg-mjpeg' : 'novnc') : 'waiting-novnc');
  return {
    retroarchAvailable,
    retroarchCommand,
    dockerAvailable,
    podmanAvailable,
    streamReady: Boolean(stream.url),
    streamUrl: stream.url || '',
    streamSource: stream.source,
    streamReachable: stream.reachable,
    streamMode,
    inputMode: env('A11_MATCH_ARENA_INPUT_MODE', 'queued-json'),
    autolaunch: envBool('A11_MATCH_ARENA_AUTOLAUNCH', false),
    capabilities: [
      'local-rom-inventory',
      'priority-claim',
      'drive-export',
      'input-event-pull',
      retroarchAvailable ? 'retroarch' : null,
      dockerAvailable ? 'docker' : null,
      podmanAvailable ? 'podman' : null,
      stream.url ? `browser-stream-url:${stream.source}` : null,
      stream.source === 'local-ffmpeg' ? 'local-ffmpeg-mjpeg' : null,
    ].filter(Boolean),
  };
}

function buildStreamDescriptor(capabilities) {
  const url = capabilities.streamUrl || '';
  return {
    ready: Boolean(url),
    mode: capabilities.streamMode || (url ? 'novnc' : 'waiting-novnc'),
    url: url || null,
    embedUrl: url || null,
    message: url
      ? 'Pont video publie par le worker local.'
      : 'Worker pret cote commandes; aucun pont video noVNC/WebRTC detectable pour l instant.',
  };
}

function resolvePlayablePath(session, inventory) {
  const root = inventory.gamesRoot;
  const game = inventory.games.find((candidate) => candidate.id === session.gameId) || session.game || null;
  const relative = game?.playableFiles?.[0]?.relativePath;
  if (!root || !relative) return { game, playablePath: null };
  const fullPath = path.resolve(root, game.title || '', relative);
  const safe = safeRelative(root, fullPath);
  if (!safe) return { game, playablePath: null };
  return { game, playablePath: fs.existsSync(fullPath) ? fullPath : null };
}

function buildRuntimeDescriptor(capabilities, playablePath) {
  const stream = buildStreamDescriptor(capabilities);
  return {
    playable: Boolean(playablePath && capabilities.streamReady && (capabilities.retroarchAvailable || capabilities.dockerAvailable || capabilities.podmanAvailable)),
    emulator: capabilities.retroarchAvailable ? 'retroarch' : 'retroarch/libretro container-ready',
    transport: 'local-worker-pull',
    stream: stream.mode,
    input: capabilities.inputMode,
    capabilities: capabilities.capabilities,
  };
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

function appendJsonl(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
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

function writeSessionManifest(session, inventory, capabilities) {
  const exportRoot = env('A11_MATCH_ARENA_EXPORT_ROOT', DEFAULT_EXPORT_ROOT);
  const sessionDir = path.join(exportRoot, session.id);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'replays'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'saves'), { recursive: true });
  const { game, playablePath } = resolvePlayablePath(session, inventory);
  const retroarchCore = resolveRetroarchCore(playablePath, game, capabilities);
  const stream = buildStreamDescriptor(capabilities);
  const runtime = buildRuntimeDescriptor(capabilities, playablePath);
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
    launch: {
      localPlayablePath: playablePath,
      autolaunch: capabilities.autolaunch,
      retroarchCommand: capabilities.retroarchCommand || null,
      retroarchCore: retroarchCore?.corePath || null,
      containerImage: env('A11_MATCH_ARENA_CONTAINER_IMAGE') || null,
    },
    stream,
    input: {
      mode: capabilities.inputMode,
      eventsFile: path.join(sessionDir, 'inputs', 'events.jsonl'),
    },
    runtime,
    worker: {
      id: env('A11_MATCH_ARENA_WORKER_ID', `${os.hostname()}-match-arena`),
      retroarchAvailable: capabilities.retroarchAvailable,
      dockerAvailable: capabilities.dockerAvailable,
      podmanAvailable: capabilities.podmanAvailable,
      streamMode: stream.mode,
    },
    next: [
      'Keep RetroArch focused while the local desktop stream is published',
      'Map input events to RetroArch controls',
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

  return { manifestPath, sessionDir, drivePath, stream, runtime, playablePath, game, retroarchCore };
}

function launchRetroarchSession(session, game, playablePath, capabilities, sessionDir) {
  if (!capabilities.autolaunch) return { launched: false, reason: 'autolaunch_disabled' };
  if (!playablePath) return { launched: false, reason: 'playable_missing' };
  const command = capabilities.retroarchCommand || resolveRetroarchCommand();
  if (!command) return { launched: false, reason: 'retroarch_missing' };

  const core = resolveRetroarchCore(playablePath, game, capabilities);
  const allowCoreless = envBool('A11_MATCH_ARENA_RETROARCH_ALLOW_CORELESS', false);
  if (!core && !allowCoreless) {
    return {
      launched: false,
      reason: 'core_missing',
      playablePath,
      hint: 'Install a matching libretro core or set A11_MATCH_ARENA_RETROARCH_CORE.',
    };
  }

  const args = [];
  if (core?.corePath) args.push('-L', core.corePath);
  args.push(playablePath);
  const logPath = path.join(sessionDir, 'logs', 'retroarch-launch.json');
  const child = spawn(command, args, {
    cwd: path.isAbsolute(command) ? path.dirname(command) : undefined,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  const launch = {
    launched: true,
    pid: child.pid || null,
    command,
    args,
    core: core?.coreName || null,
    playablePath,
    sessionId: session.id,
    gameTitle: game?.title || session.gameTitle || null,
  };
  try {
    fs.writeFileSync(logPath, JSON.stringify({ schema: 'funesterie.match-arena.retroarch-launch.v1', createdAt: new Date().toISOString(), ...launch }, null, 2), 'utf8');
  } catch {
    // Launch logging is best effort.
  }
  return launch;
}

async function pollActiveSessionInputs(activeSessions, token) {
  for (const [sessionId, active] of activeSessions.entries()) {
    try {
      const result = await postJson(
        buildUrl(active.remoteBaseUrl, `/api/match-arena/local-worker/sessions/${encodeURIComponent(sessionId)}/input-events`),
        token,
        { afterSeq: active.lastSeq || 0 },
        10000
      );
      const events = Array.isArray(result.events) ? result.events : [];
      for (const event of events) {
        appendJsonl(path.join(active.sessionDir, 'inputs', 'events.jsonl'), event);
        active.lastSeq = Math.max(Number(active.lastSeq || 0), Number(event.seq || 0));
      }
      if (['done', 'failed'].includes(String(result.state || '').toLowerCase())) {
        activeSessions.delete(sessionId);
      }
    } catch {
      active.failures = Number(active.failures || 0) + 1;
      if (active.failures > 20) activeSessions.delete(sessionId);
    }
  }
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
  const activeSessions = new Map();

  writeStatus({ ok: true, state: 'starting', workerId, remoteBaseUrls, games: cachedInventory.games.length, processed, failed });

  while (true) {
    try {
      const now = Date.now();
      const capabilities = await detectCapabilities();
      await pollActiveSessionInputs(activeSessions, token);
      if (!lastInventoryAt || now - lastInventoryAt > 60000) {
        cachedInventory = scanGames();
        for (const remoteBaseUrl of remoteBaseUrls) {
          await postJson(buildUrl(remoteBaseUrl, '/api/match-arena/local-worker/inventory'), token, {
            workerId,
            gamesRootAvailable: cachedInventory.gamesRootAvailable,
            retroarchAvailable: capabilities.retroarchAvailable,
            dockerAvailable: capabilities.dockerAvailable,
            podmanAvailable: capabilities.podmanAvailable,
          streamReady: capabilities.streamReady,
          streamMode: capabilities.streamMode,
          streamSource: capabilities.streamSource,
          inputMode: capabilities.inputMode,
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
            retroarchAvailable: capabilities.retroarchAvailable,
            dockerAvailable: capabilities.dockerAvailable,
            podmanAvailable: capabilities.podmanAvailable,
            streamReady: capabilities.streamReady,
            streamMode: capabilities.streamMode,
            streamSource: capabilities.streamSource,
            inputMode: capabilities.inputMode,
            activeSessions: activeSessions.size,
            processed,
            failed,
          }, 15000);
          const candidate = await postJson(buildUrl(remoteBaseUrl, '/api/match-arena/local-worker/claim'), token, {
            workerId,
            streamReady: capabilities.streamReady,
            streamMode: capabilities.streamMode,
            streamSource: capabilities.streamSource,
            inputMode: capabilities.inputMode,
          }, 30000);
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
          capabilities: capabilities.capabilities,
          streamReady: capabilities.streamReady,
          streamMode: capabilities.streamMode,
          streamSource: capabilities.streamSource,
          activeSessions: activeSessions.size,
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
        const exported = writeSessionManifest(session, cachedInventory, capabilities);
        const retroarchLaunch = launchRetroarchSession(session, exported.game, exported.playablePath, capabilities, exported.sessionDir);
        activeSessions.set(session.id, {
          remoteBaseUrl: claimedRemoteBaseUrl,
          sessionDir: exported.sessionDir,
          lastSeq: Number(session.input?.sequence || 0),
          failures: 0,
        });
        const readyMessage = exported.stream.ready
          ? (retroarchLaunch.launched
              ? 'Session prete: RetroArch est lance, le stream worker est publie et les commandes navigateur sont en file active.'
              : `Session prete: le stream worker est publie, mais RetroArch n a pas ete lance automatiquement (${retroarchLaunch.reason || 'raison inconnue'}). Choisis un jeu SNES ou installe le core adapte.`)
          : 'Session prete cote worker: commandes en file active; le flux video apparaitra automatiquement quand le pont noVNC/WebRTC sera detecte.';
        await postJson(buildUrl(claimedRemoteBaseUrl, `/api/match-arena/local-worker/sessions/${encodeURIComponent(session.id)}/complete`), token, {
          workerId,
          state: 'ready',
          stream: exported.stream,
          runtime: exported.runtime,
          launch: retroarchLaunch,
          input: { mode: capabilities.inputMode },
          streamMode: exported.stream.mode,
          streamUrl: exported.stream.url,
          localExportPath: exported.sessionDir,
          drivePath: exported.drivePath,
          message: readyMessage,
        }, 30000);
        processed += 1;
        writeStatus({
          ok: true,
          state: 'prepared',
          workerId,
          remoteBaseUrl: claimedRemoteBaseUrl,
          sessionId: session.id,
          localExportPath: exported.sessionDir,
          drivePath: exported.drivePath,
          playablePath: exported.playablePath,
          retroarchLaunch,
          stream: exported.stream,
          runtime: exported.runtime,
          activeSessions: activeSessions.size,
          processed,
          failed,
        });
      } catch (error) {
        activeSessions.delete(session.id);
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
