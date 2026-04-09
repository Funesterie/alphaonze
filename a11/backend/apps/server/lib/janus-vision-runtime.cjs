const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const TOOLS_VISION_ROOT = path.join(SERVER_ROOT, 'tools', 'vision');
const DEFAULT_WORKER_SCRIPT = path.join(TOOLS_VISION_ROOT, 'janus_vision_worker.py');
const DEFAULT_MODEL_DIR = path.join(TOOLS_VISION_ROOT, 'models', 'Janus-Pro-1B');
const DEFAULT_MODEL_ID = 'deepseek-ai/Janus-Pro-1B';
const DEFAULT_VISION_PYTHON = path.join(
  TOOLS_VISION_ROOT,
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);
const DEFAULT_CONTAINER_VISION_PYTHON = process.platform === 'win32'
  ? ''
  : path.join('/opt', 'janus-venv', 'bin', 'python');
const FALLBACK_SD_PYTHON = path.join(
  SERVER_ROOT,
  'tools',
  'sd',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeCandidate(value = '') {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : '';
}

function uniqueCandidates(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeCandidate).filter(Boolean))];
}

function isLocalRuntime(env = process.env) {
  if (toBoolean(env.A11_LOCAL_MODE)) return true;
  return String(env.NODE_ENV || '').trim().toLowerCase() !== 'production';
}

function hasLocalJanusAssets(env = process.env) {
  const explicitModelDir = normalizeCandidate(env.A11_JANUS_MODEL_DIR || env.A11_LOCAL_VISION_MODEL_DIR || '');
  if (explicitModelDir && fs.existsSync(explicitModelDir)) return true;
  return fs.existsSync(DEFAULT_MODEL_DIR);
}

function resolveVisionProvider(overrides = {}) {
  const explicit = String(
    overrides.provider
    || process.env.A11_VISION_PROVIDER
    || ''
  ).trim().toLowerCase();

  if (['janus', 'local-janus', 'janus-local'].includes(explicit)) return 'janus';
  if (['remote', 'openai', 'http'].includes(explicit)) return 'remote';
  if (['none', 'off', 'disabled'].includes(explicit)) return 'none';

  const janusRequested = toBoolean(process.env.A11_JANUS_ENABLED)
    || Boolean(String(process.env.A11_JANUS_MODEL_ID || process.env.A11_JANUS_MODEL_DIR || '').trim())
    || hasLocalJanusAssets(process.env);
  const remoteBaseUrl = String(
    process.env.A11_VISION_BASE_URL
    || process.env.A11_OPENAI_BASE_URL
    || process.env.OPENAI_BASE_URL
    || ''
  ).trim();

  if (janusRequested && isLocalRuntime(process.env)) return 'janus';
  if (remoteBaseUrl) return 'remote';
  if (janusRequested) return 'janus';
  return 'none';
}

function resolveJanusWorkerScript() {
  const explicit = normalizeCandidate(process.env.A11_JANUS_SCRIPT_PATH || '');
  const candidates = uniqueCandidates([explicit, DEFAULT_WORKER_SCRIPT]);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return explicit || DEFAULT_WORKER_SCRIPT;
}

function resolveJanusPythonBin() {
  const explicit = normalizeCandidate(
    process.env.A11_JANUS_PYTHON_PATH
    || process.env.A11_VISION_PYTHON_PATH
    || process.env.SD_PYTHON_PATH
    || ''
  );
  const candidates = uniqueCandidates([
    explicit,
    DEFAULT_CONTAINER_VISION_PYTHON,
    DEFAULT_VISION_PYTHON,
    FALLBACK_SD_PYTHON,
  ]);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return explicit || (process.platform === 'win32' ? 'python' : 'python3');
}

function resolveJanusModelRef() {
  const explicitDir = normalizeCandidate(process.env.A11_JANUS_MODEL_DIR || process.env.A11_LOCAL_VISION_MODEL_DIR || '');
  if (explicitDir && fs.existsSync(explicitDir)) return explicitDir;
  if (fs.existsSync(DEFAULT_MODEL_DIR)) return DEFAULT_MODEL_DIR;
  return String(process.env.A11_JANUS_MODEL_ID || DEFAULT_MODEL_ID).trim();
}

function resolveJanusVisionConfig(overrides = {}) {
  return {
    provider: 'janus',
    pythonBin: normalizeCandidate(overrides.pythonBin || '') || resolveJanusPythonBin(),
    workerScript: normalizeCandidate(overrides.workerScript || '') || resolveJanusWorkerScript(),
    modelRef: String(overrides.modelRef || '').trim() || resolveJanusModelRef(),
    device: String(overrides.device || process.env.A11_JANUS_DEVICE || 'cuda').trim() || 'cuda',
    torchDtype: String(overrides.torchDtype || process.env.A11_JANUS_TORCH_DTYPE || 'auto').trim() || 'auto',
    maxNewTokens: Math.max(64, Number(overrides.maxNewTokens || process.env.A11_JANUS_MAX_NEW_TOKENS || 320) || 320),
    timeoutMs: Math.max(5_000, Number(overrides.timeoutMs || process.env.A11_JANUS_TIMEOUT_MS || 180_000) || 180_000),
  };
}

let workerState = null;
let requestCounter = 0;

function resetWorkerState(errorMessage = 'janus_worker_unavailable') {
  if (!workerState) return;
  const pending = workerState.pending || new Map();
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(errorMessage));
  }
  pending.clear();
  if (workerState.process && !workerState.process.killed) {
    try {
      workerState.process.kill();
    } catch {}
  }
  workerState = null;
}

function handleWorkerStdout(chunk) {
  if (!workerState) return;
  workerState.stdoutBuffer += String(chunk || '');
  const parts = workerState.stdoutBuffer.split(/\r?\n/);
  workerState.stdoutBuffer = parts.pop() || '';

  for (const line of parts) {
    const raw = String(line || '').trim();
    if (!raw) continue;
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      workerState.lastStdoutLine = raw;
      continue;
    }
    if (!payload || typeof payload !== 'object') continue;
    if (payload.type === 'ready') {
      workerState.ready = true;
      continue;
    }
    const id = String(payload.id || '').trim();
    if (!id) continue;
    const pending = workerState.pending.get(id);
    if (!pending) continue;
    clearTimeout(pending.timeout);
    workerState.pending.delete(id);
    if (payload.ok === false) {
      pending.reject(new Error(String(payload.error || payload.message || 'janus_request_failed')));
      continue;
    }
    pending.resolve(payload);
  }
}

function ensureJanusWorker(config = {}) {
  const normalizedConfig = resolveJanusVisionConfig(config);
  const workerKey = JSON.stringify({
    pythonBin: normalizedConfig.pythonBin,
    workerScript: normalizedConfig.workerScript,
    modelRef: normalizedConfig.modelRef,
    device: normalizedConfig.device,
    torchDtype: normalizedConfig.torchDtype,
  });

  if (workerState && workerState.key === workerKey && workerState.process && !workerState.process.killed) {
    return workerState;
  }

  resetWorkerState('janus_worker_restarting');

  const child = spawn(
    normalizedConfig.pythonBin,
    [normalizedConfig.workerScript, '--model', normalizedConfig.modelRef, '--device', normalizedConfig.device, '--dtype', normalizedConfig.torchDtype],
    {
      cwd: path.dirname(normalizedConfig.workerScript),
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  workerState = {
    key: workerKey,
    config: normalizedConfig,
    process: child,
    pending: new Map(),
    stdoutBuffer: '',
    stderrBuffer: '',
    lastStdoutLine: '',
    ready: false,
  };

  child.stdout.on('data', (chunk) => handleWorkerStdout(chunk));
  child.stderr.on('data', (chunk) => {
    if (!workerState) return;
    const next = `${workerState.stderrBuffer || ''}${String(chunk || '')}`;
    workerState.stderrBuffer = next.slice(-4000);
  });
  child.on('error', (error_) => {
    resetWorkerState(String(error_?.message || error_ || 'janus_worker_spawn_failed'));
  });
  child.on('exit', (code, signal) => {
    const message = `janus_worker_exited:${code ?? 'null'}:${signal ?? 'null'}`;
    resetWorkerState(message);
  });

  return workerState;
}

async function callJanusVisionText({
  imageBuffer,
  contentType = 'image/png',
  prompt = '',
  requestId = '',
  maxNewTokens,
  timeoutMs,
  temperature,
  modelRef,
  device,
  torchDtype,
} = {}) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error('janus_missing_image_buffer');
  }

  const config = resolveJanusVisionConfig({
    modelRef,
    device,
    torchDtype,
    maxNewTokens,
    timeoutMs,
  });
  const worker = ensureJanusWorker(config);
  const id = `janus-${Date.now()}-${++requestCounter}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (worker.pending.has(id)) {
        worker.pending.delete(id);
      }
      reject(new Error(`janus_request_timeout:${config.timeoutMs}`));
    }, config.timeoutMs);

    worker.pending.set(id, { resolve, reject, timeout });
    worker.process.stdin.write(`${JSON.stringify({
      id,
      action: 'vision_text',
      prompt: String(prompt || '').trim(),
      request_id: String(requestId || '').trim(),
      content_type: String(contentType || 'image/png').trim() || 'image/png',
      image_base64: imageBuffer.toString('base64'),
      max_new_tokens: config.maxNewTokens,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
    })}\n`);
  });
}

function shutdownJanusVisionWorker() {
  resetWorkerState('janus_worker_shutdown');
}

module.exports = {
  callJanusVisionText,
  resolveJanusPythonBin,
  resolveJanusVisionConfig,
  resolveJanusWorkerScript,
  resolveVisionProvider,
  shutdownJanusVisionWorker,
};
