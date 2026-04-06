/**
 * Process Supervision Integration for A11
 * Currently manages: Cerbère (LLM Router), TTS Service
 * TODO: Add llama-server when needed
 */

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { A11Supervisor } = require('./a11-supervisor.cjs');
const {
  DEFAULT_TTS_MODEL,
  findTTSScript,
  getCanonicalTtsDir,
  getTtsBinaryPathCandidates,
  getTtsEspeakPathCandidates,
} = require('../lib/tts-paths.cjs');

// Always available since we have our own implementation
const qflushAvailable = true;

// Helper: check if a TCP port is already in use
function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      try { srv.close(); } catch {}
      resolve(err.code === 'EADDRINUSE');
    });
    srv.once('listening', () => {
      try { srv.close(); } catch {}
      resolve(false);
    });
    srv.listen(port, host);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFirstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getLlmRootCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const roots = [
    process.env.A11_LLM_ROOT,
    process.env.LLM_ROOT,
    path.join(__dirname, '..', '..', '..', '..', 'llm'),
    path.join(__dirname, '..', '..', '..', '..', 'a11llm'),
    'D:\\funesterie\\a11\\llm',
    'D:\\funesterie\\a11\\a11llm',
    home ? path.join(home, 'Desktop', 'LLM') : null,
    'C:\\Users\\cella\\Desktop\\LLM',
  ];

  return [...new Set(roots.filter(Boolean))];
}

function getListeningPid(port) {
  try {
    const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    const output = String(result.stdout || '');
    const line = output
      .split(/\r?\n/)
      .find((entry) => new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, 'i').test(entry));
    if (!line) return null;
    const match = line.match(/LISTENING\s+(\d+)\s*$/i);
    return match?.[1] ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function killProcessTree(pid) {
  if (!pid) return false;
  try {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function ensureLogDir(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function spawnDetachedProcess(definition, logDir) {
  ensureLogDir(logDir);
  const logFile = path.join(logDir, `${definition.name}.log`);
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(definition.command, definition.args || [], {
    cwd: definition.cwd || process.cwd(),
    env: { ...process.env, ...(definition.env || {}) },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function getBackendPort() {
  return Number(process.env.PORT || 3000);
}

function getTtsPort() {
  return Number(process.env.TTS_PORT || 5002);
}

function getLlmPort() {
  return Number(process.env.LLAMA_PORT || process.env.LOCAL_LLM_PORT || 8080);
}

function isServiceEnabled(name) {
  if (name === 'cerbere') return process.env.MANAGE_CERBERE !== 'false';
  if (name === 'tts') return process.env.MANAGE_TTS !== 'false';
  if (name === 'llama-server') return process.env.MANAGE_LLAMA_SERVER !== 'false';
  return true;
}

function findLlamaExe() {
  const serverRoot = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    process.env.A11_LLM_EXE,
    process.env.LLAMA_SERVER_EXE,
  ];

  for (const root of getLlmRootCandidates()) {
    candidates.push(path.join(root, 'llm', 'server', 'llama-server.exe'));
    candidates.push(path.join(root, 'server', 'llama-server.exe'));
  }

  candidates.push(
    path.join(serverRoot, '..', 'llm', 'llm', 'server', 'llama-server.exe'),
    path.join(serverRoot, '..', '..', 'llm', 'llm', 'server', 'llama-server.exe'),
    path.join(serverRoot, '..', 'a11llm', 'llm', 'server', 'llama-server.exe'),
    path.join(serverRoot, '..', '..', 'a11llm', 'llm', 'server', 'llama-server.exe'),
    'D:\\funesterie\\a11\\llm\\llm\\server\\llama-server.exe',
    'D:\\funesterie\\a11\\a11llm\\llm\\server\\llama-server.exe',
  );

  return findFirstExistingPath(candidates);
}

function findLlamaModel() {
  const serverRoot = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    process.env.A11_LLM_MODEL,
    process.env.LLAMA_MODEL,
    process.env.DEFAULT_MODEL,
  ];

  for (const root of getLlmRootCandidates()) {
    candidates.push(path.join(root, 'llm', 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'));
    candidates.push(path.join(root, 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'));
  }

  candidates.push(
    path.join(serverRoot, '..', 'llm', 'llm', 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    path.join(serverRoot, '..', '..', 'llm', 'llm', 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    path.join(serverRoot, '..', 'a11llm', 'llm', 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    path.join(serverRoot, '..', '..', 'a11llm', 'llm', 'models', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    'D:\\funesterie\\a11\\llm\\llm\\models\\Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    'D:\\funesterie\\a11\\a11llm\\llm\\models\\Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  );

  return findFirstExistingPath(candidates);
}

function buildKnownServiceRegistry() {
  const serverDir = path.resolve(__dirname, '..');
  const llmPort = getLlmPort();
  const ttsPort = getTtsPort();
  const backendPort = getBackendPort();
  const ttsScript = findTTSScript(true);
  const ttsDir = getCanonicalTtsDir();
  const ttsModelPath = findFirstExistingPath([
    process.env.TTS_MODEL_PATH,
    process.env.MODEL_PATH,
    path.join(ttsDir, DEFAULT_TTS_MODEL),
  ]);
  const ttsPiperPath = findFirstExistingPath([
    process.env.TTS_PIPER_PATH,
    process.env.PIPER_PATH,
    ...getTtsBinaryPathCandidates(),
  ]);
  const ttsEspeakPath = findFirstExistingPath([
    process.env.ESPEAK_DATA_PATH,
    ...getTtsEspeakPathCandidates(),
  ]);
  const llamaExe = findLlamaExe();
  const llamaModel = findLlamaModel();
  const cerbereScript = path.join(serverDir, 'llm-router-runner.cjs');

  return {
    cerbere: {
      name: 'cerbere',
      port: 4545,
      available: isServiceEnabled('cerbere') && fs.existsSync(cerbereScript),
      command: process.execPath,
      args: [cerbereScript],
      cwd: path.dirname(cerbereScript),
      env: {
        PORT: '4545',
        LLM_ROUTER_PORT: '4545',
        LOCAL_LLM_PORT: String(llmPort),
        LLAMA_PORT: String(llmPort),
        LOCAL_LLM_URL: `http://127.0.0.1:${llmPort}`,
        LLAMA_BASE: `http://127.0.0.1:${llmPort}`,
      },
      autoRestart: true,
    },
    tts: {
      name: 'tts',
      port: ttsPort,
      available: isServiceEnabled('tts') && Boolean(ttsScript),
      command: ttsScript && ttsScript.endsWith('.py') ? 'python' : 'node',
      args: ttsScript ? [ttsScript] : [],
      cwd: ttsDir,
      env: {
        PORT: String(ttsPort),
        TTS_PORT: String(ttsPort),
        BASE_URL: `http://127.0.0.1:${ttsPort}`,
        MODEL_PATH: ttsModelPath || '',
        PIPER_PATH: ttsPiperPath || '',
        ESPEAK_DATA_PATH: ttsEspeakPath || '',
        A11_AVATAR_UPDATE_URL: `http://127.0.0.1:${backendPort}/api/avatar/update`,
      },
      autoRestart: true,
    },
    'llama-server': {
      name: 'llama-server',
      port: llmPort,
      available: isServiceEnabled('llama-server') && Boolean(llamaExe && llamaModel),
      command: llamaExe || '',
      args: llamaExe && llamaModel ? ['-m', llamaModel, '--port', String(llmPort), '--host', '127.0.0.1'] : [],
      cwd: llamaExe ? path.dirname(llamaExe) : process.cwd(),
      env: {},
      autoRestart: true,
    },
  };
}

function isRegisteredInSupervisor(supervisor, processName) {
  return Boolean(supervisor?.processes && typeof supervisor.processes.has === 'function' && supervisor.processes.has(processName));
}

function isActivelyManagedBySupervisor(supervisor, processName) {
  if (!isRegisteredInSupervisor(supervisor, processName)) return false;
  const entry = supervisor.processes.get(processName);
  return Boolean(entry?.status === 'running' && entry?.pid);
}

/**
 * Register a process for supervision
 * @param {A11Supervisor} supervisor - Supervisor instance
 * @param {Object} processConfig - Process configuration
 * @returns {boolean} Success status
 */
function registerProcess(supervisor, processConfig) {
  if (!supervisor) {
    console.warn('[Supervisor] Cannot register process: supervisor not initialized');
    return false;
  }

  try {
    supervisor.register(processConfig);
    return true;
  } catch (e) {
    console.error('[Supervisor] Process registration failed:', e.message);
    return false;
  }
}

/**
 * Start supervised process
 * @param {A11Supervisor} supervisor - Supervisor instance
 * @param {string} processName - Name of the process to start
 * @returns {boolean} Success status
 */
async function startProcess(supervisor, processName) {
  try {
    const definition = buildKnownServiceRegistry()[processName];
    if (definition?.port) {
      const existingPid = getListeningPid(definition.port);
      if (existingPid) {
        console.warn(`[Supervisor] ${processName} already running on ${definition.port} (PID ${existingPid})`);
        return true;
      }
    }

    if (supervisor && isRegisteredInSupervisor(supervisor, processName)) {
      supervisor.start(processName);
      return true;
    }

    if (!definition || !definition.available || !definition.command) {
      console.warn(`[Supervisor] Cannot start ${processName}: no runnable definition`);
      return false;
    }

    const logDir = supervisor?.config?.logDir || path.resolve(__dirname, '../../logs/supervisor');
    spawnDetachedProcess(definition, logDir);
    await sleep(800);
    return true;
  } catch (e) {
    console.error('[Supervisor] Failed to start process:', e.message);
    return false;
  }
}

/**
 * Stop supervised process
 * @param {A11Supervisor} supervisor - Supervisor instance
 * @param {string} processName - Name of the process to stop
 * @returns {boolean} Success status
 */
async function stopProcess(supervisor, processName) {
  try {
    if (supervisor && isActivelyManagedBySupervisor(supervisor, processName)) {
      supervisor.stop(processName);
      await sleep(1000);
      return true;
    }

    const definition = buildKnownServiceRegistry()[processName];
    if (!definition?.port) {
      console.warn(`[Supervisor] Cannot stop ${processName}: unknown target`);
      return false;
    }

    const pid = getListeningPid(definition.port);
    if (!pid) {
      console.warn(`[Supervisor] ${processName} is already stopped`);
      return true;
    }

    const killed = killProcessTree(pid);
    await sleep(700);
    return killed || !getListeningPid(definition.port);
  } catch (e) {
    console.error('[Supervisor] Failed to stop process:', e.message);
    return false;
  }
}

/**
 * Restart supervised process
 * @param {A11Supervisor} supervisor - Supervisor instance
 * @param {string} processName - Name of the process to restart
 * @returns {boolean} Success status
 */
async function restartProcess(supervisor, processName) {
  try {
    if (supervisor && isActivelyManagedBySupervisor(supervisor, processName)) {
      supervisor.restart(processName);
      await sleep(1200);
      return true;
    }

    await stopProcess(supervisor, processName);
    return await startProcess(supervisor, processName);
  } catch (e) {
    console.error('[Supervisor] Failed to restart process:', e.message);
    return false;
  }
}

/**
 * Get status of supervised processes
 * @param {A11Supervisor} supervisor - Supervisor instance
 * @returns {Object} Status information
 */
function getStatus(supervisor) {
  const registry = buildKnownServiceRegistry();
  const processes = {};
  let available = false;
  let baseStatus = {};

  try {
    if (supervisor && typeof supervisor.getStatus === 'function') {
      baseStatus = supervisor.getStatus() || {};
      available = true;
      Object.assign(processes, baseStatus.processes || {});
    } else if (supervisor?.processes && typeof supervisor.processes.forEach === 'function') {
      available = true;
      supervisor.processes.forEach((entry, name) => {
        const uptime = entry.startTime && entry.status === 'running'
          ? ((Date.now() - entry.startTime) / 1000).toFixed(2)
          : null;
        processes[name] = {
          status: entry.status || 'unknown',
          pid: entry.pid || null,
          restarts: entry.restarts || 0,
          uptime,
          autoRestart: entry.config ? entry.config.autoRestart : undefined,
        };
      });
    }
  } catch (e) {
    console.error('[Supervisor] Failed to get base status:', e.message);
  }

  for (const definition of Object.values(registry)) {
    if (!definition.available) continue;
    const existing = processes[definition.name] ? { ...processes[definition.name] } : {
      status: 'registered',
      pid: null,
      restarts: 0,
      uptime: null,
      autoRestart: definition.autoRestart,
    };
    const pid = getListeningPid(definition.port);
    if (pid) {
      existing.status = 'running';
      existing.pid = pid;
      existing.source = existing.source || (isRegisteredInSupervisor(supervisor, definition.name) ? 'supervisor' : 'port-detect');
    }
    processes[definition.name] = existing;
    available = true;
  }

  return {
    available,
    supervisor: baseStatus.supervisor || { config: supervisor?.config || {} },
    processes,
  };
}

/**
 * Setup supervisor for A11 services
 * Currently manages: Cerbère (LLM Router) and TTS Service
 * @returns {A11Supervisor} Configured supervisor instance
 */
async function setupA11Supervisor() {
  const supervisor = await initQflush({
    maxRestarts: 3,
    restartDelay: 3000,
    logDir: path.resolve(__dirname, '../../logs/supervisor')
  });

  if (!supervisor) {
    return null;
  }

  const registry = buildKnownServiceRegistry();
  for (const definition of Object.values(registry)) {
    if (!definition.available) continue;
    registerProcess(supervisor, definition);
  }

  return supervisor;
}

/**
 * Initialize supervisor
 * @param {Object} options - Configuration options
 * @returns {A11Supervisor} Supervisor instance
 */
async function initQflush(options = {}) {
  try {
    const config = {
      maxRestarts: options.maxRestarts || 3,
      restartDelay: options.restartDelay || 3000,
      logDir: options.logDir || path.resolve(__dirname, '../../logs/supervisor'),
      ...options
    };

    console.log('[Supervisor] Initializing A11 supervisor...');
    const supervisor = new A11Supervisor(config);
    return supervisor;
  } catch (e) {
    console.error('[Supervisor] Initialization failed:', e.message);
    return null;
  }
}

/**
 * Run a QFLUSH flow (pipeline) with given arguments
 * @param {string} flow - Flow name
 * @param {object} payload - Arguments for the flow
 * @returns {Promise<object>} Result of the flow
 */
function getQflushRemoteToken() {
  return String(
    process.env.NEZ_ADMIN_TOKEN ||
    process.env.QFLUSH_TOKEN ||
    process.env.NPZ_ADMIN_TOKEN ||
    ''
  ).trim();
}

function getDragonApiUrl() {
  return String(process.env.DRAGON_API_URL || '').trim();
}

function getRemoteFlowBaseUrl() {
  return getDragonApiUrl() || String(process.env.QFLUSH_URL || process.env.QFLUSH_REMOTE_URL || '').trim();
}

function shouldUseRemoteFlow(flow) {
  const normalizedFlow = String(flow || '').trim().toLowerCase();
  return normalizedFlow.startsWith('a11.');
}

async function runQflushFlow(flow, payload, options = {}) {
  const dragonApiUrl = getDragonApiUrl();
  const remoteUrl = getRemoteFlowBaseUrl();
  if (remoteUrl && shouldUseRemoteFlow(flow)) {
    // Route A11 flows through Dragon when a remote compat endpoint is configured.
    // We intentionally avoid the legacy /run endpoint.
    try {
      const remoteToken = getQflushRemoteToken();
      const endpointPath = '/api/admin/run';
      const headers = {
        'Content-Type': 'application/json',
      };
      if (remoteToken) {
        headers['Authorization'] = `Bearer ${remoteToken}`;
        headers['x-qflush-token'] = remoteToken;
      }
      const response = await fetch(`${String(remoteUrl).replace(/\/+$/, '')}${endpointPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          flow,
          payload,
          admin: options.admin === true,
          target: dragonApiUrl ? 'dragon' : 'qflush',
        })
      });
      if (!response.ok) {
        throw new Error(`Remote flow error: ${response.status} ${response.statusText}`);
      }
      const rawText = await response.text();
      try {
        return rawText ? JSON.parse(rawText) : {};
      } catch {
        return { ok: true, raw: rawText };
      }
    } catch (e) {
      console.error('[QFLUSH] Remote call failed:', e.message);
      throw e;
    }
  }

  // Try canonical Node module entrypoints before falling back to an executable.
  const moduleCandidates = [
    '@funeste38/qflush',
    '@funeste38/qflush/dist/daemon/qflushd.js',
  ];

  for (const specifier of moduleCandidates) {
    try {
      const mod = await import(specifier);
      const candidate =
        (typeof mod?.run === 'function' && mod.run)
        || (typeof mod?.default?.run === 'function' && mod.default.run)
        || (typeof mod?.runFlow === 'function' && ((request) => mod.runFlow(request.flow, request.payload || {})))
        || (typeof mod?.default?.runFlow === 'function' && ((request) => mod.default.runFlow(request.flow, request.payload || {})));

      if (typeof candidate === 'function') {
        return await candidate({ flow, payload });
      }
    } catch (e) {
      console.warn(`[QFLUSH] Module candidate failed (${specifier}):`, e.message);
    }
  }

  // Fallback to EXE
  const exe = globalThis.__QFLUSH_PATH || process.env.QFLUSH_EXE_PATH;
  if (!exe) throw new Error('No qflush executable or compatible module found');
  const { spawn } = require('child_process');
  const args = ['run', flow, '--input', JSON.stringify(payload)];
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', d => (out += d.toString()));
    p.stderr.on('data', d => (err += d.toString()));
    p.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`qflush exit ${code}: ${err}`));
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ ok: true, raw: out });
      }
    });
  });
}

module.exports = {
  qflushAvailable,
  initQflush, // version asynchrone unique
  registerProcess,
  startProcess,
  stopProcess,
  restartProcess,
  getStatus,
  setupA11Supervisor,
  // Export helper for external use
  findTTSScript,
  runQflushFlow
};
