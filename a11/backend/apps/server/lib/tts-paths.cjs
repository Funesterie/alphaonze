const path = require('node:path');
const fs = require('node:fs');
const {
  getA11Root,
  getAppsRoot,
  getBackendRoot,
  getCanonicalRuntimeRoot,
  getRepoRoot,
  getRuntimeRootCandidates,
  getServerRoot,
  resolveRuntimePath,
} = require('./runtime-root.cjs');

const backendRoot = getBackendRoot();
const appsRoot = getAppsRoot();
const serverRoot = getServerRoot();
const canonicalTtsDir = path.join(appsRoot, 'tts');
const publicTtsDir = path.join(backendRoot, 'public', 'tts');

const DEFAULT_TTS_MODEL = 'fr_FR-siwis-medium.onnx';
const DEFAULT_TTS_MODEL_NAME = 'fr_FR-siwis-medium';

function firstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function getCanonicalTtsDir() {
  return canonicalTtsDir;
}

function getPublicTtsDir() {
  return publicTtsDir;
}

function getTtsScriptCandidates() {
  return [
    path.join(canonicalTtsDir, 'siwis.py'),
    path.join(canonicalTtsDir, 'serve.py'),
    path.join(canonicalTtsDir, 'server.py'),
  ];
}

function findTTSScript(quiet = false) {
  const configured = String(process.env.TTS_SCRIPT_PATH || process.env.A11_TTS_SCRIPT || '').trim();
  const script = firstExistingPath([
    configured,
    ...getTtsScriptCandidates(),
  ]);

  if (script && !quiet) {
    console.log('[Supervisor] Found TTS script at:', script);
  }

  return script;
}

function getTtsBinaryPathCandidates() {
  const linuxCandidates = [
    path.join(canonicalTtsDir, 'piper'),
    path.join(canonicalTtsDir, 'piper', 'piper'),
    path.join(backendRoot, 'piper', 'piper'),
    '/app/apps/tts/piper',
    '/app/apps/tts/piper/piper',
    '/app/tts/piper',
    '/app/tts/piper/piper',
  ];
  const windowsCandidates = [
    path.join(canonicalTtsDir, 'piper.exe'),
    path.join(canonicalTtsDir, 'piper', 'piper.exe'),
    path.join(backendRoot, 'piper', 'piper.exe'),
    '/app/apps/tts/piper.exe',
    '/app/apps/tts/piper/piper.exe',
    '/app/tts/piper.exe',
    '/app/tts/piper/piper.exe',
  ];

  return process.platform === 'win32'
    ? [...windowsCandidates, ...linuxCandidates]
    : [...linuxCandidates, ...windowsCandidates];
}

function getTtsModelDirCandidates() {
  return [
    canonicalTtsDir,
    path.join(backendRoot, 'piper', 'models'),
    path.join(backendRoot, 'tts'),
    '/app/apps/tts',
    '/app/tts',
    '/data/tts',
  ];
}

function getTtsEspeakPathCandidates() {
  return [
    path.join(canonicalTtsDir, 'espeak-ng-data'),
    path.join(canonicalTtsDir, 'piper', 'espeak-ng-data'),
    path.join(backendRoot, 'piper', 'espeak-ng-data'),
    '/app/apps/tts/espeak-ng-data',
    '/app/apps/tts/piper/espeak-ng-data',
    '/app/tts/espeak-ng-data',
    '/app/tts/piper/espeak-ng-data',
  ];
}

module.exports = {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_MODEL_NAME,
  findTTSScript,
  firstExistingPath,
  getA11Root,
  getAppsRoot,
  getBackendRoot,
  getCanonicalRuntimeRoot,
  getCanonicalTtsDir,
  getRepoRoot,
  getPublicTtsDir,
  getRuntimeRootCandidates,
  getServerRoot,
  getTtsBinaryPathCandidates,
  getTtsEspeakPathCandidates,
  getTtsModelDirCandidates,
  getTtsScriptCandidates,
  resolveRuntimePath,
};
