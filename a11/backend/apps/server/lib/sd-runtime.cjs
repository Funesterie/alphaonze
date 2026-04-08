const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.join(SERVER_ROOT, '..', '..', '..');
const CANONICAL_A11LLM_ROOT = path.join(A11_ROOT, 'llm');
const LEGACY_A11LLM_ROOT = path.join(A11_ROOT, 'a11llm');
const VENDORED_SD_SCRIPT = path.join(SERVER_ROOT, 'tools', 'sd', 'generate_sd_image.py');
const CANONICAL_SD_SCRIPT = path.join(CANONICAL_A11LLM_ROOT, 'scripts', 'generate_sd_image.py');
const CANONICAL_SD_VENV = path.join(
  CANONICAL_A11LLM_ROOT,
  'scripts',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);
const LAUNCHER_DIST_SD_VENV = path.join(
  A11_ROOT,
  'launchers',
  'dist',
  'a11-local',
  'llm',
  'scripts',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);
const DESKTOP_RESOURCES_SD_VENV = path.join(
  A11_ROOT,
  'a11desktoptauri',
  'resources',
  'a11-local',
  'llm',
  'scripts',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);
const LEGACY_SD_SCRIPT = path.join(LEGACY_A11LLM_ROOT, 'scripts', 'generate_sd_image.py');
const LEGACY_SD_VENV = path.join(
  LEGACY_A11LLM_ROOT,
  'scripts',
  'venv',
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
);

function isWindowsDrivePath(value = '') {
  return /^[a-zA-Z]:[\\/]/.test(String(value || '').trim());
}

function isWindowsUncPath(value = '') {
  return /^\\\\[^\\]+\\[^\\]+/.test(String(value || '').trim());
}

function isForeignAbsolutePath(value = '', platform = process.platform) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (platform === 'win32') {
    return false;
  }
  return isWindowsDrivePath(raw) || isWindowsUncPath(raw);
}

function normalizeCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isForeignAbsolutePath(raw)) return '';
  return path.resolve(raw);
}

function uniqueCandidates(values) {
  return [...new Set(values.map(normalizeCandidate).filter(Boolean))];
}

function isProductionRuntime(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldAllowLocalSdFallback(env = process.env) {
  if (String(env.A11_SD_ALLOW_LOCAL_FALLBACK || '').trim() !== '') {
    return toBoolean(env.A11_SD_ALLOW_LOCAL_FALLBACK);
  }
  if (!isProductionRuntime(env)) {
    return true;
  }

  if (toBoolean(env.ENABLE_SD)) {
    return true;
  }

  if (toBoolean(env.A11_LOCAL_MODE) || String(env.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local') {
    return true;
  }

  if (String(env.SD_SCRIPT_PATH || '').trim() || String(env.SD_PYTHON_PATH || '').trim()) {
    return true;
  }

  return false;
}

function resolveSdProxyUrl() {
  return [
    process.env.A11_SD_PROXY_URL,
    process.env.SD_PROXY_URL,
  ].map((value) => String(value || '').trim()).find(Boolean) || '';
}

function resolveSdScriptPath() {
  const explicit = normalizeCandidate(process.env.SD_SCRIPT_PATH || '');
  const allowLocalFallback = shouldAllowLocalSdFallback(process.env);
  const candidates = uniqueCandidates([
    ...(allowLocalFallback ? [
      explicit,
      VENDORED_SD_SCRIPT,
      CANONICAL_SD_SCRIPT,
      LEGACY_SD_SCRIPT,
      'D:\\funesterie\\a11\\llm\\scripts\\generate_sd_image.py',
      'D:\\funesterie\\a11\\a11llm\\scripts\\generate_sd_image.py',
    ] : [explicit]),
  ]);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (!allowLocalFallback) {
    return explicit || '';
  }

  return explicit || normalizeCandidate(VENDORED_SD_SCRIPT) || VENDORED_SD_SCRIPT;
}

function resolveSdPythonBin(scriptPath = '') {
  const explicit = normalizeCandidate(process.env.SD_PYTHON_PATH || '');
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  if (!shouldAllowLocalSdFallback(process.env)) {
    return explicit || '';
  }

  const scriptDir = scriptPath && fs.existsSync(scriptPath) ? path.dirname(scriptPath) : '';
  const adjacentVenv = scriptDir
    ? (process.platform === 'win32'
      ? path.join(scriptDir, 'venv', 'Scripts', 'python.exe')
      : path.join(scriptDir, 'venv', 'bin', 'python'))
    : '';

  const candidates = uniqueCandidates([
    explicit,
    adjacentVenv,
    LAUNCHER_DIST_SD_VENV,
    DESKTOP_RESOURCES_SD_VENV,
    CANONICAL_SD_VENV,
    LEGACY_SD_VENV,
  ]);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return explicit || (process.platform === 'win32' ? 'python' : 'python3');
}

function sanitizeProxyHeaders(headers = {}) {
  const forwarded = {};
  for (const headerName of ['authorization', 'x-nez-admin', 'x-nez-token']) {
    const value = headers?.[headerName];
    if (typeof value === 'string' && value.trim()) {
      forwarded[headerName] = value;
    }
  }
  return forwarded;
}

async function invokeSdProxy(payload = {}, options = {}) {
  const proxyUrl = resolveSdProxyUrl();
  if (!proxyUrl) {
    return { ok: false, skipped: true, error: 'sd_proxy_unconfigured' };
  }
  if (typeof fetch !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...sanitizeProxyHeaders(options.headers || {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    body,
    proxyUrl,
  };
}

function runSdScript(payload = {}, options = {}) {
  const scriptPath = options.scriptPath || resolveSdScriptPath();
  const pythonBin = options.pythonBin || resolveSdPythonBin(scriptPath);
  const outputPath = String(payload.output || payload.outputPath || '').trim();
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return Promise.resolve({ ok: false, error: 'sd_unavailable', scriptPath });
  }
  if (!outputPath) {
    return Promise.resolve({ ok: false, error: 'missing_output_path', scriptPath });
  }

  const args = [
    scriptPath,
    '--prompt', String(payload.prompt || '').trim(),
    '--num_inference_steps', String(Number(payload.num_inference_steps || payload.numInferenceSteps || 35) || 35),
    '--guidance_scale', String(Number(payload.guidance_scale || payload.guidanceScale || 8.0) || 8.0),
    '--width', String(Number(payload.width || 768) || 768),
    '--height', String(Number(payload.height || 768) || 768),
    '--output', outputPath,
  ];

  if (payload.seed !== undefined && payload.seed !== null && String(payload.seed).trim() !== '') {
    args.push('--seed', String(payload.seed).trim());
  }

  return new Promise((resolve) => {
    const py = spawn(pythonBin, args, { cwd: path.dirname(scriptPath) });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);

    py.stdout.on('data', (data) => { stdout = Buffer.concat([stdout, data]); });
    py.stderr.on('data', (data) => { stderr = Buffer.concat([stderr, data]); });
    py.on('error', (error_) => {
      resolve({
        ok: false,
        error: 'python_spawn_failed',
        message: String(error_?.message || error_),
        scriptPath,
        pythonBin,
      });
    });
    py.on('close', (code) => {
      if (code !== 0) {
        return resolve({
          ok: false,
          error: 'python_failed',
          message: stderr.toString() || `python_exit_${code}`,
          stderr: stderr.toString(),
          stdout: stdout.toString(),
          scriptPath,
          pythonBin,
        });
      }
      try {
        const parsed = JSON.parse(stdout.toString() || '{}');
        return resolve({
          ...parsed,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          scriptPath,
          pythonBin,
        });
      } catch (error_) {
        return resolve({
          ok: false,
          error: 'bad_python_output',
          message: String(error_?.message || error_),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          scriptPath,
          pythonBin,
        });
      }
    });
  });
}

module.exports = {
  resolveSdProxyUrl,
  resolveSdScriptPath,
  resolveSdPythonBin,
  invokeSdProxy,
  runSdScript,
  sanitizeProxyHeaders,
  VENDORED_SD_SCRIPT,
  shouldAllowLocalSdFallback,
  isForeignAbsolutePath,
};
