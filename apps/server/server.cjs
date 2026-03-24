// --- .env first ---
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const fs = require('node:fs');
const dotenv = require('dotenv');

// A11Host (VSIX + headless)
const {
  registerA11HostRoutes,
  setHeadlessConfig
} = require('./a11host.cjs'); // adapte le chemin si besoin

// Prevent DeprecationWarning for util._extend by replacing it early with Object.assign
try {
  const coreUtil = require('util');
  if (coreUtil && typeof coreUtil._extend !== 'undefined') coreUtil._extend = Object.assign;
} catch (e) {
  // ignore
}

// Prefer server-local env (.env.local) for dev, fallback to repo root .env
const localEnvPath = path.resolve(__dirname, '.env.local');
const repoEnvPath = path.resolve(__dirname, '../../.env');
let envSource = null;
if (fs.existsSync(localEnvPath)) {
  console.log('[A11] Chargement des variables d\'environnement depuis', localEnvPath);
  dotenv.config({ path: localEnvPath });
  envSource = localEnvPath;
} else if (fs.existsSync(repoEnvPath)) {
  console.log('[A11] Chargement des variables d\'environnement depuis', repoEnvPath);
  dotenv.config({ path: repoEnvPath });
  envSource = repoEnvPath;
} else {
  console.log('[A11] Aucun fichier .env trouvé (cherche .env.local puis ../../.env)');
  envSource = 'ENVIRONMENT ONLY';
}

// DEBUG: log Nez env vars
console.log('[NEZ ENV] NEZ_TOKENS=', process.env.NEZ_TOKENS);
console.log('[NEZ ENV] NEZ_ADMIN_TOKEN=', process.env.NEZ_ADMIN_TOKEN);
console.log('[NEZ ENV] NEZ_ALLOWED_TOKEN=', process.env.NEZ_ALLOWED_TOKEN);

// Ensure runtime configuration defaults are set to avoid ReferenceErrors
const CTX_SIZE = Number(process.env.CTX_SIZE) || 8192;
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 4096;
const PARALLEL = Number(process.env.PARALLEL) || 8;
const HOST_BIND = process.env.HOST_SERVER || '127.0.0.1';

// -------------------

// --- Compilation automatique de openai.ts ---
const { execSync } = require('node:child_process');
const tsPath = path.resolve(__dirname, 'providers', 'openai.ts');
const jsPath = path.resolve(__dirname, 'providers', 'openai.js');
try {
  const tsMtime = fs.existsSync(tsPath) ? fs.statSync(tsPath).mtimeMs : 0;
  const jsMtime = fs.existsSync(jsPath) ? fs.statSync(jsPath).mtimeMs : 0;
  if (tsMtime > jsMtime || !fs.existsSync(jsPath)) {
    console.log('[A11] Compilation automatique de openai.ts...');
    execSync("npx tsc \"" + tsPath + "\" --outDir \"" + path.dirname(tsPath) + "\"");
    console.log('[A11] Compilation terminée.');
  }
} catch (e) {
  console.warn('[A11] Erreur compilation openai.ts:', e.message);
}
// -------------------

// Import all required modules at the top
const { spawn } = require('node:child_process');
const express = require('express');
const { Router } = require('express');
const { registerOpenAIRoutes } = require('./src/routes/llm-openai');
const cors = require('cors');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
// OpenAI SDK (CommonJS)
let OpenAI;
try {
  OpenAI = require('openai');
} catch (e) {
  OpenAI = null;
}

const openaiClient = OpenAI ? new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || (process.env.UPSTREAM_ORIGIN || 'https://api.funesterie.me') + '/v1',
  apiKey: process.env.OPENAI_API_KEY || 'dummy',
  defaultHeaders: {
    'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro'
  }
}) : null;
const multer = require('multer');
const open = require('open');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { nezAuth, getNezAccessLog, TOKENS, MODE } = require('./src/middleware/nezAuth');
let qflushIntegration = null;
try {
  qflushIntegration = require('./src/qflush-integration.cjs');
} catch (e) {
  console.warn('[QFLUSH] qflush integration helper unavailable:', e && e.message);
}

const BASE = path.resolve(__dirname);
const LLAMA_DIR = path.join(BASE, 'llama.cpp');
const BIN_DIR_REL = path.join('build', 'bin', 'Release');
const BIN_DIR_FALLBACK = path.join('build', 'bin');

// qflush supervisor integration: detect if available (try module first, then local exe)
let QFLUSH_AVAILABLE = false;
let QFLUSH_MODULE = null;
let QFLUSH_PATH = null;
try {
  // Avoid requiring 'qflush' at top-level because the package may auto-run its pipeline on require()
  // Instead detect presence of the package and defer requiring it to the qflush-integration helper
  const qflushModuleDir = path.join(BASE, 'node_modules', '@funeste38', 'qflush');
  if (fs.existsSync(qflushModuleDir)) {
    QFLUSH_AVAILABLE = true;
    console.log('[QFLUSH] qflush module found in node_modules; will initialize via integration helper');
  } else {
    // fallback: check for a local qflush executable in project folders
    const qflushCandidates = [
      path.join(BASE, '.qflush', 'qflush.exe'),
      path.join(BASE, 'qflush', 'qflush.exe'),
      path.join(BASE, 'bin', 'qflush.exe')
    ];
    for (const candidate of qflushCandidates) {
      try {
        if (fs.existsSync(candidate)) {
          QFLUSH_PATH = candidate;
          QFLUSH_AVAILABLE = true;
          console.log('[QFLUSH] Found local qflush executable at', candidate);
          break;
        }
      } catch (ee) { }
    }
    if (!QFLUSH_AVAILABLE) {
      console.log('[QFLUSH] qflush integration not available. Skipping.');
    }
  }
} catch (e) {
  console.log('[QFLUSH] qflush detection failed:', e && e.message);
}

if (!QFLUSH_AVAILABLE && qflushIntegration && qflushIntegration.qflushAvailable) {
  QFLUSH_AVAILABLE = true;
  QFLUSH_MODULE = qflushIntegration;
  console.log('[QFLUSH] Using local qflush integration helper');
}

// export for other modules to check
globalThis.__QFLUSH_AVAILABLE = QFLUSH_AVAILABLE;
globalThis.__QFLUSH_MODULE = QFLUSH_MODULE;
globalThis.__QFLUSH_PATH = QFLUSH_PATH;

async function bootstrapQflushSupervisor() {
  if (!QFLUSH_AVAILABLE || !qflushIntegration || typeof qflushIntegration.setupA11Supervisor !== 'function') {
    return null;
  }
  try {
    const supervisor = await qflushIntegration.setupA11Supervisor();
    if (!supervisor) return null;
    globalThis.__A11_QFLUSH_SUPERVISOR = supervisor;

    const autoStart = String(process.env.QFLUSH_AUTO_START || 'true').toLowerCase() !== 'false';
    if (autoStart && typeof qflushIntegration.startProcess === 'function') {
      await qflushIntegration.startProcess(supervisor, 'cerbere');
      if (String(process.env.MANAGE_TTS || '').toLowerCase() === 'true') {
        await qflushIntegration.startProcess(supervisor, 'tts');
      }
    }

    return supervisor;
  } catch (err) {
    console.error('[QFLUSH] Supervisor bootstrap failed:', err && err.message);
    return null;
  }
}

// --- Mémoire persistante A-11 (conversations) ---
const fsMem = require('node:fs');
const pathMem = require('node:path');

const A11_WORKSPACE_ROOT =
  process.env.A11_WORKSPACE_ROOT ||
  pathMem.resolve(__dirname, '..', '..'); // ex: D:\A11

const A11_MEMORY_ROOT = pathMem.join(A11_WORKSPACE_ROOT, 'a11_memory');
const A11_CONV_DIR = pathMem.join(A11_MEMORY_ROOT, 'conversations');

function ensureConvDir() {
  try {
    if (!fsMem.existsSync(A11_CONV_DIR)) {
      fsMem.mkdirSync(A11_CONV_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn('[A11][memory] mkdir failed:', e && e.message);
  }
}

function appendConversationLog(entry) {
  try {
    ensureConvDir();
    const ts = new Date();
    const day = ts.toISOString().slice(0, 10).replace(/-/g, '');
    const file = pathMem.join(A11_CONV_DIR, `${day}.jsonl`);
    const payload = { ts: ts.toISOString(), ...entry };
    fsMem.appendFileSync(file, JSON.stringify(payload) + '\n', 'utf8');
  } catch (e) {
    console.warn('[A11][memory] append failed:', e && e.message);
  }
}
// --- Fin bloc mémoire persistante ---

// --- Mémoire persistante A-11 : MEMOS JSON ---
const A11_MEMO_DIR    = pathMem.join(A11_MEMORY_ROOT, 'memos');
const A11_MEMO_INDEX  = pathMem.join(A11_MEMO_DIR, 'memo_index.jsonl');

function ensureMemoDir() {
  try {
    fsMem.mkdirSync(A11_MEMO_DIR, { recursive: true });
  } catch (e) {
    console.warn('[A11][memo] mkdir failed:', e && e.message);
  }
}

function saveMemo(type, data) {
  try {
    ensureMemoDir();
    const ts = new Date().toISOString();
    const id = `memo_${type}_${Date.now()}`;

    const memoFile = pathMem.join(A11_MEMO_DIR, `${id}.json`);
    const entry = { id, ts, type, data };

    // Fichier mémo complet
    fsMem.writeFileSync(memoFile, JSON.stringify(entry, null, 2), 'utf8');

    // Index JSONL (append)
    fsMem.appendFileSync(A11_MEMO_INDEX, JSON.stringify(entry) + '\n', 'utf8');

    return entry;
  } catch (e) {
    console.warn('[A11][memo] save failed:', e && e.message);
    return null;
  }
}

function loadAllMemos() {
  try {
    ensureMemoDir();
    if (!fsMem.existsSync(A11_MEMO_INDEX)) return [];

    const raw = fsMem.readFileSync(A11_MEMO_INDEX, 'utf8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    const entries = [];
    for (const l of lines) {
      try { entries.push(JSON.parse(l)); } catch {}
    }

    entries.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

    return entries;
  } catch (e) {
    console.warn('[A11][memo] load failed:', e && e.message);
    return [];
  }
}
// --- FIN MEMOS JSON ---

// === Upload (OCR) - use memory storage to avoid disk writes ===
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
const { WebSocketServer } = require('ws');

const app = express();
const router = Router();

// Racine de travail (doit pointer sur D:\A12 chez toi en .env)
const WORKSPACE_ROOT = process.env.A11_WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');

// Exposer le workspace en lecture seule sous /files
app.use('/files', express.static(WORKSPACE_ROOT, {
  dotfiles: 'ignore',
  maxAge: '1d'
}));
console.log('[A11] Static /files ->', WORKSPACE_ROOT);

// Config headless A11Host (active même sans Visual Studio/VSIX)
setHeadlessConfig({
  // Racine du workspace : adapte si besoin (ex: D:\A11, D:\A12, etc.)
  workspaceRoot: process.env.A11_WORKSPACE_ROOT || path.resolve(__dirname, '..', '..'),
  // Commande de build par défaut en mode headless
  // (tu peux mettre "dotnet build", "npm run build", etc.)
  buildCommand: process.env.A11_BUILD_COMMAND || null,
  // Répertoire courant pour ExecuteShell (sinon workspaceRoot)
  shellCwd: process.env.A11_SHELL_CWD || null
});

// Last generated GIF path (absolute on disk)
let lastGifPath = null;

function _find_idle_asset() {
  // try server local public assets, then web public assets
  const cand = [
    path.join(__dirname, 'public', 'assets', 'a11_static.png'),
    path.join(__dirname, 'public', 'assets', 'A11_idle.png'),
    path.resolve(__dirname, '..', 'web', 'public', 'assets', 'a11_static.png'),
    path.resolve(__dirname, '..', 'web', 'public', 'assets', 'A11_idle.png'),
    path.resolve(__dirname, '..', 'web', 'public', 'assets', 'A11_talking_smooth_8s.gif')
  ];
  for (const p of cand) {
    try { if (fs.existsSync(p)) return p; } catch {};
  }
  return null;
}

// CORS configuration: allow local dev origins and production origin
const defaultCorsOrigins = ['http://127.0.0.1:3000', 'http://localhost:5173', 'http://localhost:3000', 'https://funesterie.pro', 'https://alphaonze.netlify.app'];
const CORS_ORIGINS = (process.env.CORS_ORIGINS && process.env.CORS_ORIGINS.split(',')) || defaultCorsOrigins;

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (e.g., curl, mobile clients)
    if (!origin) return callback(null, true);
    if (CORS_ORIGINS.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('CORS origin denied'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-NEZ-TOKEN', 'X-NEZ-ADMIN']
};

// Use CORS middleware globally
app.use(cors(corsOptions));
// Ensure preflight requests are handled
app.options('*', cors(corsOptions));

// Ajout express.json AVANT les proxies pour garantir le body POST
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/tts', express.static(path.join(__dirname, '../../public/tts')));

// SUPPRESSION des premiers express.json / express.urlencoded
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// Routes OpenAI / LLM classiques
registerOpenAIRoutes(router);

// Routes A11Host (VSIX + headless)
registerA11HostRoutes(router);

// Monter le router principal sous /api
app.use('/api', router);

// Monter les routes TTS (Piper) sous /api aussi
try {
  const ttsRouter = require('./routes/tts.cjs');   // ← c'est déjà un express.Router()
  app.use('/api', ttsRouter);
  console.log('[Server] TTS routes mounted under /api');
} catch (e) {
  console.warn('[Server] Failed to register TTS routes:', e && e.message);
}

// Auth Nez (si tu veux la garder pour le reste)
app.use('/api', nezAuth);

// Serve system prompt for legacy frontend (public, no auth)
app.get('/api/system-prompt', (_req, res) => {
  try {
    const promptPath = path.join(__dirname, 'system_prompt.txt');
    if (!fs.existsSync(promptPath)) {
      return res.status(404).json({ ok: false, error: 'system_prompt_not_found' });
    }
    const text = fs.readFileSync(promptPath, 'utf8');
    return res.json({ ok: true, systemPrompt: text });
  } catch (err) {
    console.error('[A11] Failed to read system_prompt:', err && err.message);
    return res.status(500).json({ ok: false, error: (err && err.message) || 'read_error' });
  }
});

app.get('/api/qflush/status', (_req, res) => {
  try {
    if (!QFLUSH_AVAILABLE || !qflushIntegration) {
      return res.json({ available: false, initialized: false, message: 'QFlush not available' });
    }

    const supervisor = globalThis.__A11_QFLUSH_SUPERVISOR;
    if (!supervisor) {
      return res.json({ available: true, initialized: false, message: 'Supervisor not initialized' });
    }

    if (typeof qflushIntegration.getStatus === 'function') {
      const status = qflushIntegration.getStatus(supervisor);
      return res.json({ available: true, initialized: true, ...status });
    }

    return res.json({ available: true, initialized: true, message: 'Status API unavailable' });
  } catch (err) {
    return res.status(500).json({ available: true, initialized: false, error: err && err.message });
  }
});

// Proxy /api/llm/stats to the configured LLM router (Cerbère) or DEFAULT_UPSTREAM
let __stats_cache = null;
let __stats_cache_ts = 0;
const STATS_CACHE_MS = Number(process.env.STATS_CACHE_MS) || 5000; // cache stats for 5s by default
let __last_probe_log = 0;

app.get('/api/llm/stats', async (req, res) => {
  try {
    const now = Date.now();
    // serve cached value if fresh
    if (__stats_cache && (now - __stats_cache_ts) < STATS_CACHE_MS) {
      // minimal log to indicate cached hit
      if (now - __last_probe_log > 60000) {
        console.log('[A11] /api/llm/stats - serving cached result');
        __last_probe_log = now;
      }
      return res.json(__stats_cache);
    }

    const upstreamHost = (process.env.LLM_ROUTER_URL && process.env.LLM_ROUTER_URL.trim()) ? process.env.LLM_ROUTER_URL.trim() : (DEFAULT_UPSTREAM || 'http://127.0.0.1:4545');
    const probeUrl = String(upstreamHost).replace(/\/$/, '') + '/api/stats';
    console.log('[A11] Proxying /api/llm/stats ->', probeUrl);

    const r = await fetch(probeUrl, { method: 'GET' });
    if (!r.ok) {
      const txt = await r.text().catch(() => null);
      const payload = { ok: false, error: 'upstream_error', detail: txt };
      __stats_cache = payload; __stats_cache_ts = Date.now();
      return res.status(r.status).json(payload);
    }
    const json = await r.json().catch(() => null) || { ok: true };

    __stats_cache = json; __stats_cache_ts = Date.now();

    // --- MEMO AUTO: snapshot LLM stats ---
    try {
      saveMemo('llm_stats', {
        ts: Date.now(),
        stats: json
      });
    } catch (e) {
      console.warn('[A11][memo] llm_stats save failed:', e && e.message);
    }
    // -------------------------------------

    return res.json(json);
  } catch (e) {
    console.error('[A11] /api/llm/stats proxy error:', e && e.message);
    return res.status(502).json({ ok: false, error: 'upstream_unreachable', message: String(e && e.message) });
  }
});

// Ajout helmet et cookieParser AVANT les routes
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());

// Serve frontend static files from the canonical web public folder only (not server/public_legacy)
const webPublic = path.resolve(__dirname, '..', 'web', 'public');
try {
  const serveStatic = (process.env.SERVE_STATIC && process.env.SERVE_STATIC.toLowerCase() === 'true') || (process.env.NODE_ENV === 'production');
  if (serveStatic) {
    if (fs.existsSync(webPublic)) {
      app.use(express.static(webPublic, { maxAge: '1d' }));
      console.log('[A11] Serving frontend static from', webPublic);
    } else {
      console.log('[A11] Frontend public folder not found at', webPublic);
    }
  } else {
    console.log('[A11] Skipping static middleware for web public (DEV mode or SERVE_STATIC!=true)');
  }
} catch (e) {
  console.warn('[A11] Could not initialize static middleware for web public:', e && e.message);
}

// Serve legacy-prefixed URLs from the canonical web public folder as well
try {
  const serveLegacy = (process.env.SERVE_STATIC && process.env.SERVE_STATIC.toLowerCase() === 'true') || (process.env.NODE_ENV === 'production');
  if (serveLegacy) {
    if (fs.existsSync(webPublic)) {
      app.use('/legacy', express.static(webPublic, { maxAge: '1d' }));
      console.log('[A11] Also serving web public under /legacy ->', webPublic);
    }
  } else {
    console.log('[A11] Skipping /legacy static middleware (DEV mode)');
  }
} catch (e) {
  console.warn('[A11] Could not initialize /legacy static middleware for web public:', e && e.message);
}

// Ajout des routes /healthz et / (404)
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/', (_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// Explicit route to support legacy OpenAI-style completions endpoint
app.all('/v1/chat/completions', async (req, res) => {
  // Only POST is supported
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed', allowed: 'POST' });
  }

  if (!DEFAULT_UPSTREAM) {
    return res.status(502).json({ ok: false, error: 'no_upstream_configured' });
  }

  // Prefer a local LLM router (Cerbère) if available on 4545 for dev setups
  let resolvedUpstream = DEFAULT_UPSTREAM;
  try {
    // If LLM_ROUTER_URL env is set, prefer it (DEFAULT_UPSTREAM already handles that),
    // otherwise probe the common dev router port 4545 (Cerbère).
    if (!process.env.LLM_ROUTER_URL) {
      const probeUrl = 'http://127.0.0.1:4545/api/stats';
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 800);
      try {
        const p = await fetch(probeUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(id);
        if (p && p.ok) {
          resolvedUpstream = 'http://127.0.0.1:4545';
          console.log('[A11] Detected local LLM router at 127.0.0.1:4545, using it as upstream for /v1/chat/completions');
        }
      } catch (e) {
        // ignore probe errors, keep DEFAULT_UPSTREAM
      }
    }
  } catch (e) { /* ignore */ }

  const upstreamUrl = (String(resolvedUpstream).replace(/\/$/, '')) + '/v1/chat/completions';
  try {
    const forwardHeaders = Object.assign({}, req.headers);
    // Remove host header to avoid conflicts
    delete forwardHeaders.host;

    const upstreamRes = await axios({
      method: 'post',
      url: upstreamUrl,
      headers: forwardHeaders,
      data: req.body && Object.keys(req.body).length ? req.body : undefined,
      responseType: 'stream',
      timeout: 60000,
    });

    // Forward status and headers
    res.status(upstreamRes.status);
    Object.entries(upstreamRes.headers || {}).forEach(([k, v]) => {
      try { res.setHeader(k, v); } catch (e) { /* ignore */ }
    });
    // Pipe response stream
    upstreamRes.data.pipe(res);
  } catch (err) {
    console.error('[A11] Error proxying /v1/chat/completions ->', upstreamUrl, err && (err.message || err.toString()));
    if (err.response && err.response.data) {
      // try to forward error body
      try {
        const buf = await streamToBuffer(err.response.data);
        res.status(err.response.status || 502).send(buf);
      } catch (e) {
        res.status(err.response.status || 502).json({ ok: false, error: 'upstream_error', message: String(err.message) });
      }
    } else {
      res.status(502).json({ ok: false, error: 'upstream_unreachable', message: String(err && err.message) });
    }
  }
});

// Proxy endpoint used by the frontend for simple chat requests
app.post('/api/llm/chat', async (req, res) => {
  if (!DEFAULT_UPSTREAM) {
    return res.status(502).json({ ok: false, error: 'no_upstream_configured' });
  }

  const upstreamHost = (process.env.LLM_ROUTER_URL && process.env.LLM_ROUTER_URL.trim()) ? process.env.LLM_ROUTER_URL.trim() : DEFAULT_UPSTREAM;
  const upstreamUrl = String(upstreamHost).replace(/\/$/, '') + '/v1/chat/completions';
  console.log('[A11] Proxying /api/llm/chat ->', upstreamUrl);

  try {
    const forwardHeaders = Object.assign({}, req.headers);
    delete forwardHeaders.host;
    forwardHeaders['content-type'] = 'application/json';

    const upstreamRes = await axios({
      method: 'post',
      url: upstreamUrl,
      headers: forwardHeaders,
      data: req.body && Object.keys(req.body).length ? req.body : undefined,
      timeout: 60000,
    });

    const data = upstreamRes.data;

    // --- MEMOIRE: log du tour de conversation ---
    try {
      const body = req.body || {};
      const convId =
        body.conversationId ||
        body.convId ||
        body.sessionId ||
        'default';
      const messages = Array.isArray(body.messages) ? body.messages : [];
      appendConversationLog({
        type: 'chat_turn',
        conversationId: convId,
        request: {
          model: body.model || 'llama3.2:latest',
          messages
        },
        response: data
      });
    } catch (e) {
      console.warn('[A11][memory] log chat_turn failed:', e && e.message);
    }
    // --------------------------------------------

    res.status(upstreamRes.status).json(data);
  } catch (err) {
    console.error('[A11] Error proxying /api/llm/chat ->', upstreamUrl, err && (err.message || err.toString()));
    if (err.response && err.response.data) {
      try {
        return res.status(err.response.status || 502).json(err.response.data);
      } catch (e) { /* ignore */ }
    }
    return res.status(502).json({ ok: false, error: 'upstream_unreachable', message: String(err && err.message) });
  }
});

// helper to collect stream into buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (e) => reject(e));
  });
}

// Global runtime flags and port (single source of truth)
let LISTENING = false;
if (globalThis.__A11_PORT === undefined) {
  globalThis.__A11_PORT = Number(process.env.PORT) || 3000;
}
const PORT = globalThis.__A11_PORT;
console.log(`[A11] PORT utilisé: ${ PORT } (source: ${ envSource }, env: ${ process.env.PORT || 'non défini'})`);

// Single DEFAULT_UPSTREAM: prefer LLAMA_BASE if set, otherwise use localhost (11434)
if (globalThis.__A11_DEFAULT_UPSTREAM === undefined) {
  const host = '127.0.0.1';
  // default to llama-server port 8000 when LLAMA_BASE is not set
  const port = process.env.LLAMA_PORT || '8000';
  // If a local LLM router is configured, prefer it as the default upstream
  if (process.env.LLM_ROUTER_URL && process.env.LLM_ROUTER_URL.trim()) {
    globalThis.__A11_DEFAULT_UPSTREAM = process.env.LLM_ROUTER_URL.trim();
    console.log('[Alpha Onze] Using LLM router as DEFAULT_UPSTREAM =', globalThis.__A11_DEFAULT_UPSTREAM);
  } else {
    globalThis.__A11_DEFAULT_UPSTREAM = (process.env.LLAMA_BASE && process.env.LLAMA_BASE.trim()) ? process.env.LLAMA_BASE : `http://${host}:${port}`;
  }
}
const DEFAULT_UPSTREAM = globalThis.__A11_DEFAULT_UPSTREAM;

// Determine backend mode from environment. Defaults to 'local' for LLaMA usage.
// Expose configured backend and LLAMA_BASE for diagnostics.
const LLAMA_BASE_ENV = process.env.LLAMA_BASE && process.env.LLAMA_BASE.trim();
const RAW_BACKEND = String(process.env.BACKEND || '').trim().toLowerCase();
const BACKEND = (LLAMA_BASE_ENV ? 'local' : (RAW_BACKEND || 'local'));
if (LLAMA_BASE_ENV && RAW_BACKEND !== 'local') {
    console.log(`[Alpha Onze] Notice: LLAMA_BASE is set -> forcing BACKEND='local' (was '${RAW_BACKEND || 'unset'}').`);
}

// Intégration automatique des modules power1, power2, power3
let power1, power2, power3;
try {
  power1 = require('./dist/a11/power1');
} catch (e) {
  console.warn('[A11] power1 non chargé:', e && e.message);
}
try {
  power2 = require('./dist/a11/power2');
} catch (e) {
  console.warn('[A11] power2 non chargé:', e && e.message);
}
try {
  power3 = require('./dist/a11/power3');
} catch (e) {
  console.warn('[A11] power3 non chargé:', e && e.message);
}
globalThis.power1 = power1;
globalThis.power2 = power2;
globalThis.power3 = power3;

// Fallback: ensure server starts
if (!LISTENING) {
  try {
    bootstrapQflushSupervisor().catch((e) => {
      console.error('[QFLUSH] Bootstrap error:', e && e.message);
    });
    app.listen(PORT, HOST_BIND, () => {
      LISTENING = true;
      console.log(`[A11] Server listening on http://${HOST_BIND}:${PORT}`);
    });
  } catch (e) {
    console.error('[A11] Failed to start server:', e && e.message);
    process.exit(1);
  }
}

// Ajout des routes pour le pont QFlush et l'agent A-11
const { runQflushTool } = require("./lib/qflushTools");
const { callA11AgentLLM } = require("./lib/a11Agent"); // à créer ou adapter

app.use(express.json());

app.post("/api/tools/run", async (req, res) => {
  try {
    const { tool, input } = req.body || {};
    if (!tool) {
      return res.status(400).json({ ok: false, error: "Missing 'tool' field" });
    }
    const result = await runQflushTool(tool, input || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const { A11_AGENT_SYSTEM_PROMPT, A11_AGENT_DEV_PROMPT } = require('./lib/a11Agent.js');
const { runAction } = require('./src/a11/tools-dispatcher.cjs');

async function callA11LLM(messages) {
  const backend = BACKENDS.llama_local;
  const upstreamUrl = `${backend.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model: 'llama3.2:latest',
    messages: [
      { role: 'system', content: A11_AGENT_SYSTEM_PROMPT },
      { role: 'system', content: A11_AGENT_DEV_PROMPT },
      ...messages
    ],
    stream: false
  };
  const res = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`A11 LLM error: ${res.status} – ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.delta?.content ?? '';
  return content.toString().trim();
}

// --- Helpers Cerbère -> A-11 ---
function summarizeCerbereResults(cerbere) {
  try {
    if (!cerbere) return 'Actions exécutées par Cerbère.';
    const actions =
      Array.isArray(cerbere.results)
        ? cerbere.results
        : Array.isArray(cerbere.actions)
          ? cerbere.actions
          : [];
    const parts = actions.map((a) => {
      const ok = a?.result?.ok ?? a?.ok;
      const tool = a?.name || a?.tool || 'action';
      const status = ok ? 'ok' : 'erreur';
      return `• ${tool} → ${status}`;
    });
    if (!parts.length) return 'Actions exécutées par Cerbère.';
    return ['Actions exécutées par Cerbère :', ...parts].join('\n');
  } catch {
    return 'Actions exécutées par Cerbère.';
  }
}

function extractImagePathFromCerbere(cerbere) {
  const actions =
    cerbere && Array.isArray(cerbere.results)
      ? cerbere.results
      : cerbere && Array.isArray(cerbere.actions)
        ? cerbere.actions
        : [];
  for (const a of actions) {
    const tool = a?.name || a?.tool;
    const r = a?.result || {};
    const p = r.outputPath || r.path || r.savedAs || r.filePath;
    if (tool === 'download_file' && typeof p === 'string' && p.length > 0) {
      return p;
    }
  }
  return null;
}

app.post('/api/agent', express.json(), async (req, res) => {
  try {
    const { envelope } = req.body || {};
    if (!envelope) {
      return res.status(400).json({
        ok: false,
        error: 'Missing "envelope" in request body'
      });
    }

    // 1) Exécution des actions par Cerbère
    const cerbere = await runActionsEnvelope(envelope);

    // 2) Résumé texte
    let explanation = summarizeCerbereResults(cerbere);

    // 3) Extraction éventuelle d’un chemin d’image
    const relativeImagePath = extractImagePathFromCerbere(cerbere); // ex: "docs/camembert.jpg"
    let publicImageUrl = null;

    if (relativeImagePath) {
      // chemin absolu sur disque pour info/log
      const absPath = path.isAbsolute(relativeImagePath)
        ? relativeImagePath
        : path.join(WORKSPACE_ROOT, relativeImagePath);

      // chemin relatif par rapport au workspace pour /files
      const relFromRoot = path.relative(WORKSPACE_ROOT, absPath).replace(/\\/g, '/');
      publicImageUrl = `/files/${relFromRoot}`;

      // On enrichit le message avec le markdown de l’image
      explanation += `\n\nVoici l'image téléchargée :\n\n![image](${publicImageUrl})`;
    }

    // --- MEMOIRE: log de l'action agent ---
    try {
      appendConversationLog({
        type: 'agent_actions',
        conversationId: envelope.conversationId || 'dev-agent',
        envelope,
        explanation,
        imagePath: publicImageUrl,
        cerbere
      });
    } catch (e) {
      console.warn('[A11][memory] log agent_actions failed:', e && e.message);
    }
    // ---------------------------------------

    return res.json({
      ok: true,
      mode: 'dev',
      explanation,
      imagePath: publicImageUrl,
      cerbere
    });
  } catch (e) {
    console.error('[A11][agent] error:', e);
    return res.status(500).json({
      ok: false,
      error: String(e && e.message)
    });
  }
});

// ─────────────────────────────────────────────
// API: lecture de la mémoire des conversations
// ─────────────────────────────────────────────
app.get('/api/a11/memory/conversations', (req, res) => {
  try {
    ensureConvDir();

    // Si le dossier n'existe toujours pas → pas d'erreur, juste vide
    if (!fsMem.existsSync(A11_CONV_DIR)) {
      return res.json({ ok: true, entries: [] });
    }

    const files = fsMem
      .readdirSync(A11_CONV_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
      .map((d) => d.name);

    const entries = [];

    for (const f of files) {
      const full = pathMem.join(A11_CONV_DIR, f);
      let raw;
      try {
        raw = fsMem.readFileSync(full, 'utf8');
      } catch (e) {
        console.warn('[A11][memory] read file failed:', full, e && e.message);
        continue;
      }
      const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch (e) {
          console.warn('[A11][memory] JSON parse error in', full, e && e.message);
        }
      }
    }

    entries.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

    res.json({ ok: true, entries });
  } catch (e) {
    console.error('[A11][memory] read failed:', e && e.message);
    res.status(500).json({ ok: false, error: String(e && e.message) });
  }
});
// --- Fin API mémoire ---

// --- MEMO API: créer un mémo ---
app.post('/api/a11/memo', express.json(), (req, res) => {
  const { type, data } = req.body || {};

  if (!type || data === undefined) {
    return res.status(400).json({ ok: false, error: 'Missing type or data' });
  }

  const entry = saveMemo(type, data);
  if (!entry) {
    return res.status(500).json({ ok: false, error: 'Failed to save memo' });
  }

  return res.json({ ok: true, memo: entry });
});

// --- MEMO API: récupérer tous les mémos ---
app.get('/api/a11/memo/all', (req, res) => {
  const entries = loadAllMemos();
  return res.json({ ok: true, entries });
});

// --- MEMO API: récupérer un mémo complet par ID ---
app.get('/api/a11/memo/:id', (req, res) => {
  const id = req.params.id;
  const file = path.join(A11_MEMO_DIR, `${id}.json`);

  if (!fs.existsSync(file)) {
    return res.status(404).json({ ok: false, error: 'Memo not found' });
  }

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const memo = JSON.parse(raw);
    return res.json({ ok: true, memo });
  } catch (e) {
    console.error('[A11][memo] read memo failed:', e && e.message);
    return res.status(500).json({ ok: false, error: e && e.message });
  }
});

// --- MEMOS AUTO: snapshot au démarrage ---
function snapshotOnStartup() {
  try {
    const safeEnv = {};
    const keys = [
      'NODE_ENV',
      'BACKEND',
      'LLAMA_BASE',
      'LLAMA_PORT',
      'LLM_ROUTER_URL',
      'PORT',
      'HOST_SERVER'
    ];
    for (const k of keys) {
      if (process.env[k] !== undefined) safeEnv[k] = process.env[k];
    }

    const qflushInfo = {
      available: !!globalThis.__QFLUSH_AVAILABLE,
      module: !!globalThis.__QFLUSH_MODULE,
      exePath: globalThis.__QFLUSH_PATH || null
    };

    saveMemo('env_snapshot', {
      ts: Date.now(),
      env: safeEnv,
      qflush: qflushInfo
    });
    console.log('[A11][memo] env_snapshot saved on startup');
  } catch (e) {
    console.warn('[A11][memo] env_snapshot failed:', e && e.message);
  }
}
snapshotOnStartup();

// Ajout de la route POST /api/a11/memo/snapshot/qflush pour snapshot QFlush à la demande dans server.cjs.
app.post('/api/a11/memo/snapshot/qflush', async (req, res) => {
  try {
    const info = {
      available: !!globalThis.__QFLUSH_AVAILABLE,
      exePath: globalThis.__QFLUSH_PATH || null,
      module: !!globalThis.__QFLUSH_MODULE
    };
    const entry = saveMemo('qflush_snapshot', info);
    if (!entry) {
      return res.status(500).json({ ok: false, error: 'saveMemo failed' });
    }
    return res.json({ ok: true, memo: entry });
  } catch (e) {
    console.error('[A11][memo] qflush snapshot failed:', e && e.message);
    return res.status(500).json({ ok: false, error: e && e.message });
  }
});

// --- Mémoire persistante A-11 : key/value ---
const A11_MEMORY_KV_FILE = pathMem.join(A11_MEMORY_ROOT, 'memory.json');

function writeMemoryKeyValue(key, value) {
  try {
    ensureMemoDir(); // pour créer le dossier si besoin
    let data = {};
    if (fsMem.existsSync(A11_MEMORY_KV_FILE)) {
      try {
        data = JSON.parse(fsMem.readFileSync(A11_MEMORY_KV_FILE, 'utf8'));
      } catch {}
    }
    data[key] = value;
    fsMem.writeFileSync(A11_MEMORY_KV_FILE, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, key, value };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

// --- Route API pour a11_memory_write ---
app.post('/api/a11/memory/write', express.json(), (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Missing key' });
  const result = writeMemoryKeyValue(key, value);
  if (!result.ok) return res.status(500).json(result);
  return res.json(result);
});

// Ajout du routeur d'historique des conversations A-11
const a11HistoryRouter = require('./routes/a11-history.cjs');
app.use(a11HistoryRouter);

// Ajout du routeur Cerbère (llm-router.cjs)
const llmRouter = require('./llm-router.cjs');
app.use(llmRouter);
