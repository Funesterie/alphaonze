const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const buildTtsReadableText = require('../src/tts/build-tts-readable-text.cjs');
const { extractRequestAuthToken } = require('../src/middleware/jwt-auth.cjs');
const { buildStorageQuotaPayload } = require('../src/storage/account-storage-quota.cjs');
const {
  buildVoicePersonaInstruction,
  OFFICIAL_PERSONAS,
  PROVIDERS,
  resolveVoiceProvider,
} = require('../src/tts/voice-provider-manifest.cjs');
const {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  compareAudioBuffers,
  deleteVoiceReference,
  findVoiceReference,
  isAllowedAudioUpload,
  listLibraryVoiceReferences,
  listVoiceReferences,
  resolveVoiceReferenceForRequest,
  saveVoiceReference,
} = require('../src/tts/voice-reference-store.cjs');
const {
  DEFAULT_TTS_MODEL_NAME,
  firstExistingPath,
  getBackendRoot,
  getCanonicalTtsDir,
  getPublicTtsDir,
  getTtsBinaryPathCandidates,
  getTtsEspeakPathCandidates,
  getTtsModelDirCandidates,
} = require('../lib/tts-paths.cjs');

const commandAvailabilityCache = new Map();
let configuredVerifyJWT = null;
const ttsAsyncJobs = new Map();
const TTS_ASYNC_JOB_TTL_MS = Number(process.env.A11_TTS_ASYNC_JOB_TTL_MS || 15 * 60 * 1000);
const TTS_ASYNC_JOB_MAX_AGE_MS = Number(process.env.A11_TTS_ASYNC_JOB_MAX_AGE_MS || 30 * 60 * 1000);

function configureTtsRouter(options = {}) {
  if (typeof options.verifyJWT === 'function') {
    configuredVerifyJWT = options.verifyJWT;
  }
  return router;
}

function runOptionalJwt(req, res, next) {
  if (!configuredVerifyJWT || !extractRequestAuthToken(req)) return next();
  return configuredVerifyJWT(req, res, next);
}

function requireJwt(req, res, next) {
  if (!configuredVerifyJWT) {
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: 'Authentification indisponible sur ce runtime TTS.',
    });
  }
  return configuredVerifyJWT(req, res, next);
}

const voiceReferenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 2,
  },
  fileFilter(_req, file, cb) {
    if (isAllowedAudioUpload(file)) return cb(null, true);
    return cb(new Error(`Type de fichier audio non supporte: ${file.mimetype || 'unknown'}`));
  },
});

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function shouldPreferHttpTts() {
  const explicit = String(process.env.ENABLE_PIPER_HTTP || '').trim();
  if (explicit) return envBool('ENABLE_PIPER_HTTP', false);
  return Boolean(String(
    process.env.A11_VOICE_MODULE_URL ||
    process.env.TTS_URL ||
    process.env.TTS_HOST ||
    process.env.TTS_BASE_URL ||
    process.env.TTS_PUBLIC_BASE_URL ||
    ''
  ).trim());
}

function isCommandAvailable(command) {
  const key = String(command || '').trim();
  if (!key) return false;
  if (commandAvailabilityCache.has(key)) return commandAvailabilityCache.get(key);

  const checker = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(checker, [key], { stdio: 'ignore' });
  const ok = probe.status === 0;
  commandAvailabilityCache.set(key, ok);
  return ok;
}

function parseHttpUrl(value, fallback) {
  const input = String(value || '').trim();
  if (!input) return fallback;
  try {
    return new URL(input.includes('://') ? input : `http://${input}`);
  } catch {
    return fallback;
  }
}

function getUrlOriginWithFallback(url, fallbackPort) {
  if (!url) return `http://127.0.0.1:${fallbackPort}`;
  if (url.origin && url.origin !== 'null') return url.origin;
  const hostname = url.hostname || '127.0.0.1';
  return `${url.protocol || 'http:'}//${hostname}:${fallbackPort}`;
}

function getLocalTtsConfig() {
  const fallback = new URL('http://127.0.0.1:5002');
  const requestUrl =
    parseHttpUrl(process.env.A11_VOICE_MODULE_URL, null) ||
    parseHttpUrl(process.env.TTS_URL, null) ||
    parseHttpUrl(process.env.TTS_HOST, null) ||
    parseHttpUrl(process.env.TTS_BASE_URL, null) ||
    fallback;
  const publicUrl =
    parseHttpUrl(process.env.TTS_PUBLIC_BASE_URL, null) ||
    parseHttpUrl(process.env.TTS_BASE_URL, null) ||
    requestUrl;

  const selected = requestUrl;
  const hostname = selected.hostname || '127.0.0.1';
  const defaultPort = selected.protocol === 'https:' ? 443 : 80;
  const selectedPort = Number(
    selected.port ||
    process.env.TTS_PORT ||
    ((hostname === '127.0.0.1' || hostname === 'localhost') ? 5002 : defaultPort)
  );
  const port = Number.isFinite(selectedPort) && selectedPort > 0 ? selectedPort : 5002;

  return {
    host: hostname,
    port,
    baseUrl: getUrlOriginWithFallback(selected, port),
    requestBaseUrl: getUrlOriginWithFallback(selected, port),
    publicBaseUrl: getUrlOriginWithFallback(publicUrl, publicUrl?.protocol === 'https:' ? 443 : port),
  };
}

function getRemoteTtsBaseUrls(ttsConfig = getLocalTtsConfig()) {
  const candidates = [
    String(ttsConfig?.requestBaseUrl || ttsConfig?.baseUrl || '').trim(),
    String(ttsConfig?.publicBaseUrl || '').trim(),
  ]
    .map((value) => value.replace(/\/$/, ''))
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

function uniqueBaseUrls(values = []) {
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim().replace(/\/$/, ''))
      .filter(Boolean)
  ));
}

function isAllowedTtsCorsOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)) {
      return true;
    }
    return [
      'a11.funesterie.me',
      'funesterie.me',
      'www.funesterie.me',
      'k44.funesterie.me',
      'kaen44.funesterie.me',
      'vivy.funesterie.me',
      'music.funesterie.me',
    ].includes(hostname);
  } catch {
    return false;
  }
}

function setTtsCorsHeaders(req, res) {
  const origin = String(req?.headers?.origin || '').trim();
  if (isAllowedTtsCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function getDirectXttsRvcBaseUrls(options = {}) {
  const explicitBridgeCandidates = [
    process.env.A11_VOICE_XTTS_RVC_URL,
    process.env.A11_XTTS_RVC_URL,
    process.env.A11_VOICE_CONVERSION_URL,
  ];
  const fallbackModuleCandidates = [
    process.env.A11_VOICE_MODULE_URL,
  ];
  const autodetect = String(process.env.A11_LOCAL_XTTS_RVC_AUTODETECT || '1').trim().toLowerCase();
  const allowAutodetect = options.autodetect !== false;
  const candidates = [...explicitBridgeCandidates];
  if (allowAutodetect && !['0', 'false', 'no', 'off'].includes(autodetect)) {
    candidates.push('http://a11-xtts-rvc:5000');
    if (process.platform === 'win32') {
      candidates.push('http://127.0.0.1:5000');
    }
    candidates.push('http://a11-voice:5002');
    if (process.platform === 'win32') candidates.push('http://127.0.0.1:5002');
  }
  candidates.push(...fallbackModuleCandidates);
  return uniqueBaseUrls(candidates);
}

function hasExplicitXttsRvcBridgeConfig() {
  return uniqueBaseUrls([
    process.env.A11_VOICE_XTTS_RVC_URL,
    process.env.A11_XTTS_RVC_URL,
  ]).length > 0;
}

function getVoiceConversionBaseUrls(ttsConfig = getLocalTtsConfig()) {
  return uniqueBaseUrls([
    ...getDirectXttsRvcBaseUrls({ autodetect: false }),
    process.env.A11_VOICE_CONVERSION_URL,
    ...getRemoteTtsBaseUrls(ttsConfig),
  ]);
}

function getRequestedVoiceReferenceId(req = {}) {
  return String(
    req?.body?.voiceReferenceId
    || req?.body?.voiceRefId
    || req?.body?.referenceId
    || ''
  ).trim();
}

function parseOptionalBoolean(value, fallback = null) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(raw)) return false;
  return fallback;
}

function wantsDefaultVoiceReference(req = {}) {
  const body = req?.body || req || {};
  return parseOptionalBoolean(
    body.useDefaultVoiceReference
    ?? body.defaultVoiceReference
    ?? body.usePersonaVoiceReference,
    false
  ) === true;
}

function requiresReferenceVoice(req = {}) {
  const body = req?.body || req || {};
  return parseOptionalBoolean(
    body.voiceReferenceRequired
    ?? body.requireVoiceReference
    ?? body.referenceVoiceRequired,
    false
  ) === true;
}

function wantsAsyncTtsJob(body = {}) {
  return parseOptionalBoolean(
    body.ttsAsync
    ?? body.asyncTts
    ?? body.backgroundTts
    ?? body.async,
    false
  ) === true;
}

function pruneTtsAsyncJobs(now = Date.now()) {
  for (const [id, job] of ttsAsyncJobs.entries()) {
    const finishedAt = Number(job?.finishedAt || 0);
    const createdAt = Number(job?.createdAt || 0);
    if (finishedAt && now - finishedAt > TTS_ASYNC_JOB_TTL_MS) {
      ttsAsyncJobs.delete(id);
    } else if (createdAt && now - createdAt > TTS_ASYNC_JOB_MAX_AGE_MS) {
      ttsAsyncJobs.delete(id);
    }
  }
}

function createTtsAsyncJobId() {
  return `ttsjob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildBatRomeTtsOrchestrator(body = {}) {
  const outputFormat = normalizeTtsAudioFormat(body, 'mp3');
  return {
    mode: 'bat-rome',
    family: 'vivy-audio',
    queue: 'media.audio',
    bat: {
      role: 'request-control',
      capabilities: ['async timer', 'sleep guard', 'retry/noise scoring'],
    },
    rome: {
      role: 'workspace runner',
      capabilities: ['job routing', 'duo/trio async', 'safe process handoff'],
    },
    stages: [
      'queued',
      'prepare_reference',
      'normalize_reference_wav',
      'xtts',
      'rvc',
      'normalize_audio',
      'publish_web_audio',
    ],
    formats: {
      acceptedInput: ['wav', 'mp3', 'm4a', 'mov'],
      internalReference: 'wav mono 16/24k',
      output: outputFormat,
      clip: 'mp4',
    },
    discord: {
      role: 'optional_notification',
      engine: false,
    },
  };
}

function publicTtsAsyncJob(job = {}) {
  const payload = {
    ok: job.state !== 'failed',
    async: true,
    jobId: job.id || null,
    kind: job.kind || 'tts.speak',
    queue: job.queue || 'media.audio',
    state: job.state || 'queued',
    status: job.state || 'queued',
    statusCode: job.statusCode || null,
    statusUrl: job.id ? `${job.statusUrlBase || '/api/tts/jobs'}/${encodeURIComponent(job.id)}` : null,
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    orchestrator: job.orchestrator || null,
    formats: job.orchestrator?.formats || null,
    pollIntervalMs: job.pollIntervalMs || 1500,
  };
  if (job.result && (job.state === 'done' || job.state === 'failed')) {
    payload.result = job.result;
    payload.audioUrl = job.result.audioUrl || job.result.audio_url || job.result.url || null;
    payload.audio_url = payload.audioUrl || null;
    payload.provider = job.result.provider || job.result.via || null;
    payload.via = job.result.via || null;
  }
  if (job.error) {
    payload.ok = false;
    payload.error = job.error;
    payload.message = job.message || job.error;
  }
  return payload;
}

function createTtsJobResponseCapture(job) {
  const capture = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name || '').toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[String(name || '').toLowerCase()];
    },
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      job.statusCode = this.statusCode;
      job.result = payload || {};
      job.state = this.statusCode >= 400 || payload?.ok === false ? 'failed' : 'done';
      job.error = job.state === 'failed' ? String(payload?.message || payload?.error || `tts_job_failed_${this.statusCode}`) : null;
      job.message = job.error;
      job.finishedAt = Date.now();
      return payload;
    },
    send(payload) {
      job.statusCode = this.statusCode;
      if (Buffer.isBuffer(payload)) {
        job.result = {
          ok: true,
          contentType: String(this.headers['content-type'] || 'audio/wav'),
          note: 'audio_buffer_response',
        };
      } else {
        job.result = payload || {};
      }
      job.state = this.statusCode >= 400 ? 'failed' : 'done';
      job.error = job.state === 'failed' ? `tts_job_failed_${this.statusCode}` : null;
      job.message = job.error;
      job.finishedAt = Date.now();
      return payload;
    },
    end() {
      if (job.state === 'running') {
        job.statusCode = this.statusCode;
        job.state = this.statusCode >= 400 ? 'failed' : 'done';
        job.finishedAt = Date.now();
      }
      return null;
    },
  };
  return capture;
}

function buildAsyncTtsJobBody(body = {}) {
  return {
    ...body,
    ttsAsync: false,
    asyncTts: false,
    backgroundTts: false,
    async: false,
    stream: false,
    returnAudioBuffer: false,
  };
}

function isInteractiveTtsRequest(req = {}) {
  const body = req?.body || req || {};
  const raw = String(
    body.latencyMode
    || body.ttsLatencyMode
    || body.playbackMode
    || body.modeHint
    || ''
  ).trim().toLowerCase();
  return ['interactive', 'realtime', 'real-time', 'live', 'fast'].includes(raw);
}

function normalizeTtsAudioFormat(body = {}, fallback = '') {
  const raw = String(
    body?.audioFormat
    || body?.responseFormat
    || body?.response_format
    || body?.ttsFormat
    || fallback
    || process.env.A11_TTS_RESPONSE_FORMAT
    || process.env.OPENAI_TTS_RESPONSE_FORMAT
    || 'mp3'
  ).trim().toLowerCase();
  if (raw === 'mpeg' || raw === 'audio/mpeg') return 'mp3';
  if (raw === 'wave' || raw === 'audio/wav' || raw === 'x-wav') return 'wav';
  if (raw === 'mp3' || raw === 'wav') return raw;
  return 'mp3';
}

function resolveVoiceConversionStrength(body = {}) {
  const value = body?.voiceConversionStrength ?? body?.strength ?? body?.conversionStrength;
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0.05, Math.min(1, numeric));
}

function resolveVoiceF0Shift(body = {}) {
  const value = body?.f0Shift ?? body?.voiceF0Shift;
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(-12, Math.min(12, numeric));
}

function shouldTryVoiceConversion(req = {}, vocalMode = 'speech') {
  const body = req?.body || {};
  const explicitBody = parseOptionalBoolean(
    body.voiceConversion ?? body.convertVoice ?? body.morphVoice ?? body.rvc,
    null
  );
  if (explicitBody === false) return false;

  const explicitEnv = parseOptionalBoolean(process.env.A11_VOICE_CONVERSION_ENABLED, null);
  if (explicitEnv === false) return false;

  const hasVoiceModule = Boolean(String(
    process.env.A11_VOICE_MODULE_URL
    || process.env.A11_VOICE_CONVERSION_URL
    || process.env.A11_VOICE_XTTS_RVC_URL
    || process.env.A11_XTTS_RVC_URL
    || process.env.TTS_URL
    || process.env.TTS_BASE_URL
    || ''
  ).trim()) || getVoiceConversionBaseUrls().length > 0;
  if (!hasVoiceModule) return false;
  if (explicitBody === true || explicitEnv === true) return true;
  if (isInteractiveTtsRequest(req)) return false;

  const requestedId = getRequestedVoiceReferenceId(req);
  return vocalMode === 'adaptive'
    || vocalMode === 'sing'
    || Boolean(requestedId)
    || wantsDefaultVoiceReference(req)
    || requiresReferenceVoice(req);
}

function ensurePublicTtsDir() {
  const ttsDir = getPublicTtsDir();
  fs.mkdirSync(ttsDir, { recursive: true });
  pruneOldTtsAssets();
  return ttsDir;
}

function resolvePiperBinary() {
  const backendRoot = getBackendRoot();
  const configured = String(process.env.PIPER_BIN || process.env.PIPER_EXE || process.env.PIPER_PATH || '').trim();
  const candidates = [
    configured,
    ...getTtsBinaryPathCandidates(),
    'piper'
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = process.platform !== 'win32' && /\.exe$/i.test(candidate)
      ? candidate.replace(/\.exe$/i, '')
      : candidate;
    if (normalizedCandidate !== candidate && fs.existsSync(path.resolve(normalizedCandidate))) {
      const resolved = path.resolve(normalizedCandidate);
      if (fs.statSync(resolved).isFile()) {
        return { command: resolved, cwd: path.dirname(resolved) };
      }
    }

    // Command name on PATH (for example "piper")
    if (!candidate.includes(path.sep) && !candidate.includes('/')) {
      if (isCommandAvailable(candidate)) {
        return { command: candidate, cwd: backendRoot };
      }
      continue;
    }

    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return { command: resolved, cwd: path.dirname(resolved) };
    }
  }

  return null;
}

function resolveEspeakBinary() {
  const backendRoot = getBackendRoot();
  const configured = String(process.env.ESPEAK_BIN || process.env.ESPEAK_PATH || '').trim();
  const candidates = [
    configured,
    '/usr/bin/espeak-ng',
    '/usr/local/bin/espeak-ng',
    'espeak-ng',
    'espeak',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) && !candidate.includes('/')) {
      if (isCommandAvailable(candidate)) {
        return { command: candidate, cwd: backendRoot };
      }
      continue;
    }

    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return { command: resolved, cwd: path.dirname(resolved) };
    }
  }

  return null;
}

function resolvePiperModel(requestedModel) {
  const explicitModelPath = String(process.env.TTS_MODEL_PATH || process.env.PIPER_MODEL_PATH || process.env.MODEL_PATH || '').trim();
  const modelsDirEnv = String(process.env.TTS_MODELS_DIR || process.env.PIPER_MODELS_DIR || '').trim();

  function addModelCandidate(target, value) {
    const raw = String(value || '').trim();
    if (!raw) return;
    if (!target.includes(raw)) target.push(raw);
    if (!raw.toLowerCase().endsWith('.onnx')) {
      const withExt = `${raw}.onnx`;
      if (!target.includes(withExt)) target.push(withExt);
    }
  }

  const modelCandidates = [];
  addModelCandidate(modelCandidates, requestedModel);
  addModelCandidate(modelCandidates, explicitModelPath);
  // Prefer SIWIS when no explicit model is requested.
  addModelCandidate(modelCandidates, DEFAULT_TTS_MODEL_NAME);
  addModelCandidate(modelCandidates, 'fr_FR-medium');

  const baseDirs = [
    modelsDirEnv,
    ...getTtsModelDirCandidates(),
  ].filter(Boolean);

  for (const candidate of modelCandidates) {
    if (!candidate) continue;

    const looksAbsolute = path.isAbsolute(candidate) || /^[A-Za-z]:\\/.test(candidate);
    if (looksAbsolute && fs.existsSync(candidate)) {
      return candidate;
    }

    for (const dir of baseDirs) {
      const modelPath = path.join(dir, candidate);
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }
  }

  return null;
}

const LANGUAGE_TTS_VOICES = Object.freeze({
  fr: DEFAULT_TTS_MODEL_NAME,
  en: 'en_US-lessac-medium',
  it: 'it_IT-paola-medium',
  es: 'es_ES-sharvard-medium',
  de: 'de_DE-thorsten-medium',
});

function normalizeTtsLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('it')) return 'it';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('de')) return 'de';
  return '';
}

function resolveVoiceForRequest(body = {}) {
  const explicit = String(body?.voice || body?.model || '').trim();
  if (explicit) return explicit;
  const shouldFollowLanguage = parseOptionalBoolean(
    body?.forceLanguageVoice
    ?? body?.ttsForceLanguageVoice
    ?? process.env.A11_TTS_FORCE_LANGUAGE_VOICE,
    false
  ) === true;
  if (!shouldFollowLanguage) return '';
  const language = normalizeTtsLanguage(
    body?.language
    || body?.lang
    || body?.locale
    || body?.speechLanguage
    || body?.speech_language
  );
  return language ? LANGUAGE_TTS_VOICES[language] : '';
}

function ensurePiperModelSidecars(modelPath) {
  const resolvedModelPath = String(modelPath || '').trim();
  if (!resolvedModelPath || !fs.existsSync(resolvedModelPath)) {
    return { modelJsonPath: null, modelJsonExists: false };
  }

  const preferred = `${resolvedModelPath}.json`;
  const legacy = resolvedModelPath.replace(/\.onnx$/i, '.json');
  const existing = [preferred, legacy].find((candidate) => fs.existsSync(candidate)) || null;

  if (fs.existsSync(preferred) && fs.existsSync(legacy)) {
    return { modelJsonPath: preferred, modelJsonExists: true };
  }

  if (existing) {
    const missing = preferred === existing ? legacy : preferred;
    try {
      fs.copyFileSync(existing, missing);
    } catch (error_) {
      console.warn('[TTS][Piper] failed to mirror model sidecar:', error_.message);
    }
    return {
      modelJsonPath: fs.existsSync(preferred) ? preferred : existing,
      modelJsonExists: fs.existsSync(preferred) || fs.existsSync(legacy),
    };
  }

  return { modelJsonPath: null, modelJsonExists: false };
}

function getSpawnReadiness(requestedModel) {
  const piper = resolvePiperBinary();
  const modelPath = resolvePiperModel(requestedModel);
  const modelJsonCandidates = modelPath
    ? [
        `${modelPath}.json`,
        modelPath.replace(/\.onnx$/i, '.json'),
      ]
    : [];
  const ensuredSidecar = ensurePiperModelSidecars(modelPath);
  const modelJsonPath = ensuredSidecar.modelJsonPath || modelJsonCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  const modelJsonExists = ensuredSidecar.modelJsonExists || Boolean(modelJsonPath);
  return {
    ready: Boolean(piper && modelPath && modelJsonExists),
    piperCommand: piper?.command || null,
    modelPath: modelPath || null,
    requestedModel: requestedModel || null,
    modelJsonCandidates,
    modelJsonPath,
    modelJsonExists,
  };
}

function listOnnxFiles(modelsDir) {
  const results = [];
  function walk(dir, relative = '') {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      const rel = path.join(relative, it.name);
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        walk(full, rel);
      } else if (it.isFile() && it.name.toLowerCase().endsWith('.onnx')) {
        results.push(rel.replaceAll('\\', '/'));
      }
    }
  }
  try {
    walk(modelsDir);
  } catch {
    return [];
  }
  return results;
}

function parseJsonMaybe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isTtsOutPath(pathname = '') {
  const normalized = String(pathname || '').replace(/\\/g, '/');
  return normalized.startsWith('/out/') || normalized.startsWith('/api/tts/out/');
}

function buildBackendTtsOutPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let pathname = '';
  try {
    pathname = new URL(raw, 'http://127.0.0.1').pathname;
  } catch {
    pathname = raw;
  }
  if (!isTtsOutPath(pathname)) return null;
  const filename = path.posix.basename(decodeURIComponent(pathname));
  if (!filename || filename === '.' || filename === '..') return null;
  return `/api/tts/out/${encodeURIComponent(filename)}`;
}

function resolveLocalTtsAssetPath(value = '') {
  const normalized = buildBackendTtsOutPath(value);
  if (!normalized) return null;
  const filename = path.posix.basename(decodeURIComponent(new URL(normalized, 'http://127.0.0.1').pathname));
  return [
    path.join(getPublicTtsDir(), filename),
    path.join(getCanonicalTtsDir(), 'out', filename),
  ].find((candidate) => fs.existsSync(candidate)) || null;
}

async function loadTtsAudioBuffer(value = '', options = {}) {
  const localPath = resolveLocalTtsAssetPath(value);
  if (localPath) {
    const buffer = fs.readFileSync(localPath);
    if (options.consume === true) {
      deleteGeneratedTtsAsset(localPath);
    }
    return {
      buffer,
      source: 'local',
      contentType: contentTypeForTtsAsset(localPath),
    };
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  let fetchUrl = '';
  try {
    const parsed = new URL(raw, 'http://127.0.0.1');
    if (parsed.pathname.startsWith('/api/tts/out/')) {
      const filename = path.posix.basename(decodeURIComponent(parsed.pathname));
      const ttsConfig = getLocalTtsConfig();
      fetchUrl = `${String(ttsConfig.requestBaseUrl || ttsConfig.baseUrl || '').replace(/\/$/, '')}/out/${encodeURIComponent(filename)}${options.consume === true ? '?consume=1' : ''}`;
    } else if (parsed.pathname.startsWith('/out/')) {
      if (options.consume === true) {
        parsed.searchParams.set('consume', '1');
      }
      fetchUrl = parsed.toString();
    } else if (/^https?:$/i.test(parsed.protocol)) {
      fetchUrl = parsed.toString();
    }
  } catch {
    fetchUrl = '';
  }

  if (!fetchUrl) return null;
  const response = await fetch(fetchUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    source: 'remote',
    contentType: String(response.headers?.get?.('content-type') || 'audio/wav'),
  };
}

function normalizeVocalMode(body = {}) {
  const raw = String(body?.vocalMode || body?.voiceMode || body?.mode || '').trim().toLowerCase();
  if (body?.sing === true || body?.singMode === true || raw === 'sing' || raw === 'chant' || raw === 'song') {
    return 'sing';
  }
  if (raw === 'adaptive' || raw === 'adapt' || raw === 'reference') return 'adaptive';
  return 'speech';
}

function shapeTextForVocalMode(text = '', vocalMode = 'speech') {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (vocalMode !== 'sing') return raw;
  return raw
    .replace(/([.!?])\s+/g, '$1\n')
    .replace(/,\s+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function enrichTtsPayloadWithAudioModule(payload, req, vocalMode) {
  const user = req?.user || null;
  const requestedId = getRequestedVoiceReferenceId(req);
  const reference = resolveVoiceReferenceForRequest({
    user,
    requestedId,
    preferredLabel: getPreferredVoiceReferenceLabel(req),
  });

  const baseModule = {
    ok: true,
    vocalMode,
    reference: reference
      ? {
          id: reference.id,
          label: reference.label,
          scope: reference.scope,
          analysis: reference.analysis || null,
        }
      : null,
    comparison: null,
  };

  if (requestedId && !reference) {
    return {
      ...payload,
      audioModule: {
        ...baseModule,
        ok: false,
        error: 'voice_reference_unavailable',
        message: 'Reference vocale introuvable ou non autorisee.',
      },
    };
  }

  if (!reference?.filePath || !fs.existsSync(reference.filePath)) {
    return {
      ...payload,
      audioModule: {
        ...baseModule,
        note: 'Aucune reference vocale active pour comparer la sortie.',
      },
    };
  }

  const audioUrl = String(payload?.audioUrl || payload?.audio_url || '').trim();
  if (!audioUrl) {
    return {
      ...payload,
      audioModule: {
        ...baseModule,
        ok: false,
        error: 'generated_audio_missing',
      },
    };
  }

  try {
    const generated = await loadTtsAudioBuffer(audioUrl);
    if (!generated?.buffer?.length) {
      return {
        ...payload,
        audioModule: {
          ...baseModule,
          ok: false,
          error: 'generated_audio_unavailable',
        },
      };
    }
    const referenceBuffer = fs.readFileSync(reference.filePath);
    const comparison = compareAudioBuffers({
      generatedBuffer: generated.buffer,
      referenceBuffer,
      generatedFile: { mimetype: generated.contentType || 'audio/wav' },
      referenceFile: { mimetype: reference.mimeType || 'audio/wav' },
    });

    return {
      ...payload,
      audioModule: {
        ...baseModule,
        comparison,
      },
    };
  } catch (error_) {
    return {
      ...payload,
      audioModule: {
        ...baseModule,
        ok: false,
        error: 'comparison_failed',
        message: String(error_?.message || error_),
      },
    };
  }
}

async function requestVoiceConversionWithModule(payload, req, vocalMode) {
  if (payload?.provider === PROVIDERS.XTTS_RVC && payload?.voiceConversion?.ok === true) {
    return payload;
  }

  if (!shouldTryVoiceConversion(req, vocalMode)) return payload;

  const user = req?.user || null;
  const requestedId = getRequestedVoiceReferenceId(req);
  const reference = resolveVoiceReferenceForRequest({
    user,
    requestedId,
    preferredLabel: getPreferredVoiceReferenceLabel(req),
  });
  const audioUrl = String(payload?.audioUrl || payload?.audio_url || '').trim();

  if (!audioUrl || !reference?.filePath || !fs.existsSync(reference.filePath)) {
    return {
      ...payload,
      voiceConversion: {
        ok: false,
        skipped: true,
        reason: !audioUrl ? 'generated_audio_missing' : 'voice_reference_missing',
      },
    };
  }

  try {
    const generated = await loadTtsAudioBuffer(audioUrl);
    if (!generated?.buffer?.length) {
      return {
        ...payload,
        voiceConversion: {
          ok: false,
          skipped: true,
          reason: 'generated_audio_unavailable',
        },
      };
    }

    const referenceBuffer = fs.readFileSync(reference.filePath);
    const buildConversionForm = () => {
      const generatedBlob = new Blob([generated.buffer], { type: generated.contentType || 'audio/wav' });
      const referenceBlob = new Blob([referenceBuffer], { type: reference.mimeType || 'audio/wav' });
      const form = new FormData();
      form.append('generated', generatedBlob, 'generated.wav');
      form.append('reference', referenceBlob, reference.originalName || 'reference.wav');
      form.append('mode', vocalMode || 'adaptive');
      form.append('engine', String(req?.body?.voiceConversionEngine || req?.body?.conversionEngine || 'auto').trim() || 'auto');
      form.append('text', String(req?.body?.text || req?.body?.prompt || '').slice(0, 4096));
      form.append('persona', String(req?.body?.voicePersona || req?.body?.ttsPersona || req?.body?.persona || req?.body?.surface || '').slice(0, 120));
      form.append('voiceStyle', String(getPreferredVoiceReferenceLabel(req) || '').slice(0, 120));
      if (req?.body?.voiceConversionStrength !== undefined) {
        form.append('strength', String(req.body.voiceConversionStrength));
      }
      if (req?.body?.f0Shift !== undefined || req?.body?.voiceF0Shift !== undefined) {
        form.append('f0Shift', String(req?.body?.f0Shift ?? req?.body?.voiceF0Shift));
      }
      return form;
    };

    const ttsConfig = getLocalTtsConfig();
    const conversionBaseUrls = getVoiceConversionBaseUrls(ttsConfig);
    let lastError = null;
    for (const baseUrl of conversionBaseUrls) {
      try {
        const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/api/voice/convert`, {
          method: 'POST',
          body: buildConversionForm(),
          signal: AbortSignal.timeout(Number(process.env.A11_VOICE_CONVERSION_TIMEOUT_MS || 90000) || 90000),
        });

        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        if (response.ok && (contentType.startsWith('audio/') || contentType === 'application/octet-stream')) {
          const convertedUrl = saveProviderAudioBuffer(
            Buffer.from(await response.arrayBuffer()),
            'xtts-rvc'
          );
          if (!convertedUrl) throw new Error('voice_conversion_empty_audio');
          await loadTtsAudioBuffer(audioUrl, { consume: true }).catch(() => null);
          return {
            ...payload,
            originalAudioUrl: audioUrl,
            original_audio_url: audioUrl,
            audioUrl: convertedUrl,
            audio_url: convertedUrl,
            provider: PROVIDERS.XTTS_RVC,
            via: `${payload?.via || payload?.provider || 'tts'}+xtts-rvc`,
            providerCapabilities: {
              ...(payload?.providerCapabilities || {}),
              referenceVoice: true,
            },
            voiceConversion: {
              ok: true,
              module: 'funesterie-xtts-rvc-bridge',
              provider: PROVIDERS.XTTS_RVC,
              engine: response.headers?.get?.('x-a11-voice-engine') || 'xtts-rvc',
              strength: null,
              durationMs: null,
              voiceStyle: response.headers?.get?.('x-a11-voice-style') || getPreferredVoiceReferenceLabel(req) || null,
              attemptedEngines: [PROVIDERS.XTTS_RVC],
              reference: {
                id: reference.id,
                label: reference.label,
                scope: reference.scope,
              },
            },
          };
        }

        const textBody = await response.text();
        const parsed = parseJsonMaybe(textBody);
        if (!response.ok || parsed?.ok === false) {
          throw new Error(parsed?.detail || parsed?.message || parsed?.error || `voice_conversion_http_${response.status}`);
        }
        const convertedUrl = normalizeRemoteAssetUrl(baseUrl, parsed?.audio_url || parsed?.audioUrl || parsed?.url || '');
        if (!convertedUrl) throw new Error('voice_conversion_missing_audio_url');
        await loadTtsAudioBuffer(audioUrl, { consume: true }).catch(() => null);
        return {
          ...payload,
          originalAudioUrl: audioUrl,
          original_audio_url: audioUrl,
          audioUrl: convertedUrl,
          audio_url: convertedUrl,
          provider: parsed?.provider || parsed?.engine || PROVIDERS.XTTS_RVC,
          via: `${payload?.via || payload?.provider || 'tts'}+voice-convert`,
          providerCapabilities: {
            ...(payload?.providerCapabilities || {}),
            referenceVoice: true,
          },
          voiceConversion: {
            ok: true,
            module: parsed?.module || 'a11-voice-module',
            provider: parsed?.provider || parsed?.engine || 'voice-module',
            engine: parsed?.engine || null,
            strength: parsed?.strength ?? null,
            durationMs: parsed?.duration_ms ?? parsed?.durationMs ?? null,
            voiceStyle: parsed?.voiceStyle || null,
            attemptedEngines: Array.isArray(parsed?.attemptedEngines) ? parsed.attemptedEngines : [],
            reference: {
              id: reference.id,
              label: reference.label,
              scope: reference.scope,
            },
          },
        };
      } catch (error_) {
        lastError = error_;
      }
    }

    throw lastError || new Error('voice_conversion_unreachable');
  } catch (error_) {
    return {
      ...payload,
      voiceConversion: {
        ok: false,
        error: 'voice_conversion_failed',
        message: String(error_?.message || error_).slice(0, 500),
      },
    };
  }
}

async function finalizeTtsPayload(payload, req, vocalMode) {
  const converted = await requestVoiceConversionWithModule(payload, req, vocalMode);
  return enrichTtsPayloadWithAudioModule(converted, req, vocalMode);
}

function isReferenceAwareTtsPayload(payload = {}) {
  if (payload?.voiceConversion?.ok === true) return true;
  if (payload?.referenceVoice?.ok === true) return true;
  if (payload?.providerCapabilities?.referenceVoice === true) return true;
  if (payload?.provider === 'openai' && payload?.voiceReference?.id) return true;
  return false;
}

function buildReferenceVoiceUnavailablePayload(payload = {}) {
  return {
    ok: false,
    error: 'voice_reference_tts_unavailable',
    message: 'La voix de référence est requise, mais le runtime voix n’a pas pu la produire. Lecture brute bloquée.',
    provider: payload?.provider || null,
    via: payload?.via || null,
    audioModule: payload?.audioModule || null,
    voiceConversion: payload?.voiceConversion || null,
  };
}

function shouldProxyTtsAsset(baseUrl = '', value = '') {
  const assetUrl = String(value || '').trim();
  if (!assetUrl) return false;

  try {
    const parsed = new URL(assetUrl);
    return isTtsOutPath(parsed.pathname);
  } catch {}

  try {
    const parsedBase = new URL(baseUrl);
    return isTtsOutPath(new URL(assetUrl, parsedBase).pathname);
  } catch {
    return false;
  }
}

function normalizeRemoteAssetUrl(baseUrl, value) {
  const assetUrl = String(value || '').trim();
  if (!assetUrl) return null;
  if (shouldProxyTtsAsset(baseUrl, assetUrl)) {
    return buildBackendTtsOutPath(assetUrl);
  }
  if (/^https?:\/\//i.test(assetUrl)) return assetUrl;
  return new URL(assetUrl.replace(/^\.\//, ''), `${String(baseUrl).replace(/\/$/, '')}/`).toString();
}

async function requestRemoteTts(payload) {
  const ttsConfig = getLocalTtsConfig();
  const preferredPublicBaseUrl = String(ttsConfig.publicBaseUrl || ttsConfig.requestBaseUrl || ttsConfig.baseUrl || '').replace(/\/$/, '');
  const candidateBaseUrls = getRemoteTtsBaseUrls(ttsConfig);
  let lastError = new Error('remote_tts_unreachable');

  for (const candidateBaseUrl of candidateBaseUrls) {
    try {
      const response = await fetch(`${candidateBaseUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      const textBody = await response.text();
      const parsed = parseJsonMaybe(textBody);

      if (!response.ok) {
        throw new Error(`http_${response.status}: ${String(textBody).slice(0, 300)}`);
      }

      const assetBaseUrl = preferredPublicBaseUrl || candidateBaseUrl;
      if (typeof parsed === 'string' && parsed.endsWith('.wav')) {
        const audioUrl = normalizeRemoteAssetUrl(assetBaseUrl, parsed);
        return {
          audio_url: audioUrl,
          audioUrl,
          via: 'http-string',
          requestBaseUrl: candidateBaseUrl,
          publicBaseUrl: assetBaseUrl,
        };
      }

      const audioUrl = parsed?.audio_url || parsed?.audioUrl || parsed?.url || parsed?.path || parsed?.file || parsed?.wav || null;
      if (!audioUrl) {
        throw new Error(`invalid_http_tts_response: ${String(textBody).slice(0, 300)}`);
      }

      const normalizedAudioUrl = normalizeRemoteAssetUrl(assetBaseUrl, audioUrl);
      const normalizedGifUrl = normalizeRemoteAssetUrl(assetBaseUrl, parsed?.gif_url || parsed?.gifUrl || null);
      return {
        audio_url: normalizedAudioUrl,
        audioUrl: normalizedAudioUrl,
        gif_url: normalizedGifUrl,
        gifUrl: normalizedGifUrl,
        gif_duration_ms: parsed?.gif_duration_ms ?? parsed?.gifDurationMs ?? null,
        via: 'http',
        requestBaseUrl: candidateBaseUrl,
        publicBaseUrl: assetBaseUrl,
      };
    } catch (error_) {
      lastError = error_;
    }
  }

  throw lastError;
}

function getOpenAiTtsApiKey() {
  const fileCandidates = [
    process.env.OPENAI_TTS_API_KEY_FILE,
    process.env.A11_OPENAI_TTS_API_KEY_FILE,
    '/app/runtime/secrets/openai_tts_key',
  ].filter(Boolean);
  for (const candidate of fileCandidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Secret file is optional.
    }
  }
  return String(
    process.env.OPENAI_TTS_API_KEY
    || process.env.A11_OPENAI_TTS_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.A11_OPENAI_API_KEY
    || ''
  ).trim();
}

function getRequestedTtsProvider(body = {}) {
  return String(body?.ttsProvider || body?.provider || '').trim().toLowerCase();
}

function isNeutralTtsProvider(provider = '') {
  return ['piper', 'local', 'spawn', 'espeak', 'espeak-ng'].includes(String(provider || '').trim().toLowerCase());
}

function isExplicitOpenAiProvider(provider = '') {
  return String(provider || '').trim().toLowerCase() === 'openai';
}

function wantsOfficialIdentityVoice(body = {}) {
  const requestedProvider = getRequestedTtsProvider(body);
  const vocalMode = normalizeVocalMode(body);
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const explicitlyNeutral = body?.identityVoice === false
    || body?.useIdentityVoice === false
    || body?.neutralVoice === true;
  if (OFFICIAL_PERSONAS.has(explicitPersona) && !explicitlyNeutral) return true;
  return requestedProvider === PROVIDERS.XTTS_RVC
    || requiresReferenceVoice(body)
    || wantsDefaultVoiceReference(body)
    || vocalMode === 'adaptive'
    || vocalMode === 'sing';
}

function shouldBlockNeutralVoiceFallback(body = {}) {
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const requestedProvider = getRequestedTtsProvider(body);
  if (!OFFICIAL_PERSONAS.has(explicitPersona)) return false;
  if (isNeutralTtsProvider(requestedProvider)) return wantsOfficialIdentityVoice(body);
  if (requiresReferenceVoice(body) || wantsDefaultVoiceReference(body)) return true;
  return wantsOfficialIdentityVoice(body) && !isExplicitOpenAiProvider(requestedProvider);
}

function resolveTtsProviderForRequest(body = {}) {
  const persona = getTtsPersonaFromBody(body);
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const requestedProvider = getRequestedTtsProvider(body);
  if (isExplicitOpenAiProvider(requestedProvider)) {
    return {
      provider: 'openai',
      configured: shouldTryOpenAiTts(body),
      note: 'Explicit OpenAI TTS request.',
      diagnostic: shouldTryOpenAiTts(body) ? null : 'openai_tts_unavailable',
    };
  }

  if (!explicitPersona) {
    if (requestedProvider === PROVIDERS.XTTS_RVC) {
      return resolveVoiceProvider(persona, {
        explicitProvider: requestedProvider,
        allowRvc: true,
      });
    }
    if (isNeutralTtsProvider(requestedProvider)) {
      return resolveVoiceProvider(persona, {
        explicitProvider: requestedProvider,
        allowRvc: false,
      });
    }
    return {
      provider: PROVIDERS.PIPER,
      configured: true,
      note: 'Neutral TTS for generic speech request.',
    };
  }

  if (OFFICIAL_PERSONAS.has(explicitPersona) && wantsOfficialIdentityVoice(body)) {
    const bridgeAvailable = getDirectXttsRvcBaseUrls().length > 0;
    return {
      provider: bridgeAvailable ? PROVIDERS.XTTS_RVC : 'unavailable',
      configured: bridgeAvailable,
      note: bridgeAvailable
        ? 'Official persona uses XTTS/RVC bridge before any neutral fallback.'
        : 'Official persona voice bridge unavailable.',
      diagnostic: bridgeAvailable ? null : 'identity_voice_unavailable',
    };
  }

  if (isNeutralTtsProvider(requestedProvider)) {
    return resolveVoiceProvider(persona, {
      explicitProvider: requestedProvider,
      allowRvc: false,
    });
  }

  if (OFFICIAL_PERSONAS.has(explicitPersona) && !wantsOfficialIdentityVoice(body)) {
    return {
      provider: PROVIDERS.PIPER,
      configured: true,
      note: 'Neutral TTS for non-identity speech request.',
    };
  }

  const explicitProvider = requestedProvider && requestedProvider !== 'auto'
    ? requestedProvider
    : undefined;
  return resolveVoiceProvider(persona, {
    explicitProvider,
    allowRvc: explicitProvider === PROVIDERS.XTTS_RVC,
  });
}

function shouldTryOpenAiTts(body = {}) {
  const disabled = String(process.env.A11_OPENAI_TTS_ENABLED || process.env.OPENAI_TTS_ENABLED || '').trim().toLowerCase();
  if (disabled === '0' || disabled === 'false' || disabled === 'off') return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider === 'piper' || requestedProvider === 'local' || requestedProvider === 'espeak') return false;
  return Boolean(getOpenAiTtsApiKey());
}

function shouldPreferOpenAiTtsFirst(body = {}, vocalMode = 'speech') {
  const provider = getRequestedTtsProvider(body);
  if (provider === 'openai') return shouldTryOpenAiTts(body);
  if (provider === 'piper' || provider === 'local' || provider === 'espeak') return false;

  const explicit = String(process.env.A11_OPENAI_TTS_FIRST || process.env.OPENAI_TTS_FIRST || '').trim().toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes' || explicit === 'on') {
    return shouldTryOpenAiTts(body);
  }
  if (explicit === '0' || explicit === 'false' || explicit === 'no' || explicit === 'off') {
    return false;
  }

  const hasReference = Boolean(String(body?.voiceReferenceId || body?.voiceRefId || body?.referenceId || '').trim())
    || wantsDefaultVoiceReference(body)
    || requiresReferenceVoice(body);
  return shouldTryOpenAiTts(body) && (vocalMode === 'adaptive' || vocalMode === 'sing' || hasReference);
}

function getOpenAiTtsBaseUrl() {
  return String(
    process.env.OPENAI_TTS_BASE_URL
    || process.env.A11_OPENAI_TTS_BASE_URL
    || 'https://api.openai.com/v1'
  ).trim().replace(/\/$/, '');
}

function normalizeOpenAiTtsVoice(value = '', vocalMode = 'speech') {
  const supported = new Set([
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx',
    'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
  ]);
  const raw = String(value || '').trim().toLowerCase();
  if (supported.has(raw)) return raw;
  if (vocalMode === 'sing') return String(process.env.OPENAI_TTS_SING_VOICE || 'ballad').trim() || 'ballad';
  return String(process.env.OPENAI_TTS_VOICE || process.env.A11_OPENAI_TTS_VOICE || 'coral').trim() || 'coral';
}

function normalizeTtsPersona(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'vivy' || raw === 'vivi') return 'vivy';
  if (raw === 'kaen44' || raw === 'k44' || raw === 'kaen') return 'kaen44';
  return 'a11';
}

function getTtsPersonaFromBody(body = {}, fallback = '') {
  return normalizeTtsPersona(
    body?.voicePersona
    || body?.ttsPersona
    || body?.persona
    || body?.surface
    || fallback
  );
}

function getExplicitTtsPersonaFromBody(body = {}) {
  const raw = String(
    body?.voicePersona
    || body?.ttsPersona
    || body?.persona
    || body?.surface
    || ''
  ).trim();
  return raw ? normalizeTtsPersona(raw) : '';
}

function getPreferredVoiceReferenceLabelForPersona(persona = 'a11') {
  const normalized = normalizeTtsPersona(persona);
  if (normalized === 'vivy') return 'vivy';
  if (normalized === 'kaen44') return 'donna';
  return 'terminator';
}

function getPreferredVoiceReferenceLabel(req = {}) {
  const persona = getTtsPersonaFromBody(req?.body || {});
  return getPreferredVoiceReferenceLabelForPersona(persona);
}

function saveProviderAudioBuffer(buffer, provider = 'tts', extension = 'wav') {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) return null;
  const safeProvider = String(provider || 'tts').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'tts';
  const safeExtension = String(extension || 'wav').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'wav';
  const ttsDir = ensurePublicTtsDir();
  const outFileName = `tts-out-${Date.now()}-${safeProvider}.${safeExtension}`;
  fs.writeFileSync(path.join(ttsDir, outFileName), buffer);
  return buildBackendTtsOutPath(`/out/${outFileName}`);
}

function audioExtensionFromContentType(contentType = '', fallback = 'wav') {
  const raw = String(contentType || '').trim().toLowerCase();
  if (raw.includes('mpeg') || raw.includes('mp3')) return 'mp3';
  if (raw.includes('ogg')) return 'ogg';
  if (raw.includes('wav') || raw.includes('wave')) return 'wav';
  return fallback;
}

async function requestDirectXttsRvc(text, body = {}, options = {}) {
  const baseUrls = getDirectXttsRvcBaseUrls();
  if (!baseUrls.length) throw new Error('xtts_rvc_url_missing');
  const vocalMode = normalizeVocalMode({ ...(body || {}), ...(options || {}) });
  const persona = getTtsPersonaFromBody(body || {}, options?.persona || options?.surface || '');
  const voiceStyle = getPreferredVoiceReferenceLabelForPersona(persona);
  const audioFormat = normalizeTtsAudioFormat(body, isInteractiveTtsRequest(body) ? 'mp3' : 'wav');
  const conversionStrength = resolveVoiceConversionStrength(body);
  const f0Shift = resolveVoiceF0Shift(body);
  const timeoutMs = Number(
    isInteractiveTtsRequest(body)
      ? (process.env.A11_VOICE_XTTS_RVC_INTERACTIVE_TIMEOUT_MS || 22000)
      : (process.env.A11_VOICE_XTTS_RVC_TIMEOUT_MS || 240000)
  ) || (isInteractiveTtsRequest(body) ? 22000 : 240000);
  let lastError = null;

  for (const baseUrl of baseUrls) {
    try {
      const synthesizeResponse = await fetch(`${String(baseUrl).replace(/\/$/, '')}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: String(text || '').slice(0, 4096),
          persona,
          surface: body?.surface || options?.surface || persona,
          voicePersona: body?.voicePersona || persona,
          voiceStyle,
          vocalMode: vocalMode || 'adaptive',
          engine: body?.engine || body?.voiceEngine || 'auto',
          audioFormat,
          responseFormat: audioFormat,
          strength: conversionStrength,
          f0Shift,
          useDefaultVoiceReference: true,
          defaultVoiceReference: true,
          voiceReferenceRequired: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const synthesizeText = await synthesizeResponse.text();
      const synthesizePayload = parseJsonMaybe(synthesizeText);
      if (synthesizeResponse.ok && synthesizePayload?.ok !== false) {
        const remoteAudioUrl = normalizeRemoteAssetUrl(
          baseUrl,
          synthesizePayload?.audio_url || synthesizePayload?.audioUrl || synthesizePayload?.url || ''
        );
        const referenceAware = synthesizePayload?.voiceConversion?.ok === true
          || synthesizePayload?.providerCapabilities?.referenceVoice === true
          || synthesizePayload?.voiceReference?.id;
        if (remoteAudioUrl && referenceAware) {
          return {
            ...(synthesizePayload && typeof synthesizePayload === 'object' ? synthesizePayload : {}),
            success: true,
            provider: PROVIDERS.XTTS_RVC,
            via: synthesizePayload?.via || 'a11-voice-module-persona',
            text,
            vocalMode,
            audio_url: remoteAudioUrl,
            audioUrl: remoteAudioUrl,
            providerCapabilities: {
              ...(synthesizePayload?.providerCapabilities || {}),
              referenceVoice: true,
            },
            voiceConversion: {
              ok: true,
              module: synthesizePayload?.module || 'a11-voice-module',
              provider: synthesizePayload?.voiceConversion?.provider || synthesizePayload?.provider || PROVIDERS.XTTS_RVC,
              engine: synthesizePayload?.voiceConversion?.engine || synthesizePayload?.engine || 'persona-voice',
              voiceStyle: synthesizePayload?.voiceConversion?.voiceStyle || synthesizePayload?.voiceStyle || voiceStyle || null,
              rvcModel: synthesizePayload?.voiceConversion?.rvcModel || synthesizePayload?.providerCapabilities?.rvcModel || null,
              rvcIndex: synthesizePayload?.voiceConversion?.rvcIndex || synthesizePayload?.providerCapabilities?.rvcIndex || null,
              direction: buildVoicePersonaInstruction(persona),
              attemptedEngines: Array.isArray(synthesizePayload?.voiceConversion?.attemptedEngines)
                ? synthesizePayload.voiceConversion.attemptedEngines
                : [synthesizePayload?.engine || 'persona-voice'],
              reference: synthesizePayload?.voiceConversion?.reference || synthesizePayload?.voiceReference || {
                id: voiceStyle,
                label: voiceStyle,
                scope: 'voice-library',
              },
            },
          };
        }
      } else if (synthesizePayload?.detail || synthesizePayload?.error || synthesizePayload?.message) {
        lastError = new Error(
          synthesizePayload?.detail?.message
          || synthesizePayload?.detail?.error
          || synthesizePayload?.error
          || synthesizePayload?.message
          || `voice_synthesize_http_${synthesizeResponse.status}`
        );
      }
    } catch (error_) {
      lastError = error_;
    }

    try {
      const form = new FormData();
      form.append('text', String(text || '').slice(0, 4096));
      form.append('persona', persona);
      form.append('voiceStyle', voiceStyle);
      form.append('styleInstruction', buildVoicePersonaInstruction(persona));
      form.append('mode', vocalMode || 'adaptive');
      form.append('audioFormat', audioFormat);
      if (conversionStrength !== undefined) {
        form.append('strength', String(conversionStrength));
      }
      if (f0Shift !== undefined) {
        form.append('f0Shift', String(f0Shift));
      }

      const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/api/voice/convert`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (response.ok && (contentType.startsWith('audio/') || contentType === 'application/octet-stream')) {
        const extension = audioExtensionFromContentType(contentType, audioFormat || 'wav');
        const audioUrl = saveProviderAudioBuffer(Buffer.from(await response.arrayBuffer()), 'xtts-rvc', extension);
        if (!audioUrl) throw new Error('xtts_rvc_empty_audio');
        const rvcModel = response.headers?.get?.('x-a11-rvc-model') || '';
        const rvcIndex = response.headers?.get?.('x-a11-rvc-index') || '';
        return {
          success: true,
          provider: PROVIDERS.XTTS_RVC,
          via: 'xtts-rvc-direct',
          text,
          vocalMode,
          audioFormat: extension,
          audio_url: audioUrl,
          audioUrl,
          providerCapabilities: { referenceVoice: true },
          voiceConversion: {
            ok: true,
            module: 'funesterie-xtts-rvc-bridge',
            provider: PROVIDERS.XTTS_RVC,
            engine: response.headers?.get?.('x-a11-voice-engine') || 'xtts-rvc',
            voiceStyle: response.headers?.get?.('x-a11-voice-style') || voiceStyle || null,
            rvcModel: rvcModel || null,
            rvcIndex: rvcIndex || null,
            direction: buildVoicePersonaInstruction(persona),
            attemptedEngines: [PROVIDERS.XTTS_RVC],
            reference: {
              id: voiceStyle,
              label: voiceStyle,
              scope: 'bridge',
            },
          },
        };
      }

      const textBody = await response.text();
      const parsed = parseJsonMaybe(textBody);
      if (!response.ok || parsed?.ok === false) {
        throw new Error(parsed?.detail || parsed?.message || parsed?.error || `xtts_rvc_http_${response.status}`);
      }
      const remoteAudioUrl = normalizeRemoteAssetUrl(baseUrl, parsed?.audio_url || parsed?.audioUrl || parsed?.url || '');
      if (!remoteAudioUrl) throw new Error('xtts_rvc_missing_audio_url');
      return {
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
        success: true,
        provider: PROVIDERS.XTTS_RVC,
        via: parsed?.via || 'xtts-rvc-direct',
        text,
        vocalMode,
        audio_url: remoteAudioUrl,
        audioUrl: remoteAudioUrl,
        providerCapabilities: {
          ...(parsed?.providerCapabilities || {}),
          referenceVoice: true,
        },
        voiceConversion: {
          ok: true,
          module: parsed?.module || 'funesterie-xtts-rvc-bridge',
          provider: PROVIDERS.XTTS_RVC,
          engine: parsed?.voiceConversion?.engine || parsed?.engine || 'xtts-rvc',
          voiceStyle: parsed?.voiceConversion?.voiceStyle || parsed?.voiceStyle || voiceStyle || null,
          rvcModel: parsed?.voiceConversion?.rvcModel || parsed?.providerCapabilities?.rvcModel || null,
          rvcIndex: parsed?.voiceConversion?.rvcIndex || parsed?.providerCapabilities?.rvcIndex || null,
          direction: buildVoicePersonaInstruction(persona),
          attemptedEngines: Array.isArray(parsed?.attemptedEngines) ? parsed.attemptedEngines : [PROVIDERS.XTTS_RVC],
          reference: {
            id: voiceStyle,
            label: voiceStyle,
            scope: 'bridge',
          },
        },
      };
    } catch (error_) {
      lastError = error_;
    }
  }

  throw lastError || new Error('xtts_rvc_unreachable');
}

async function requestDirectXttsRvcWithRetry(text, body = {}, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(process.env.A11_VOICE_XTTS_RVC_RETRIES || 2) || 2));
  const retryDelayMs = Math.max(0, Math.min(5000, Number(process.env.A11_VOICE_XTTS_RVC_RETRY_DELAY_MS || 1200) || 1200));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestDirectXttsRvc(text, body, options);
    } catch (error_) {
      lastError = error_;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw lastError || new Error('xtts_rvc_unreachable');
}

function buildOpenAiTtsInstructions({ vocalMode = 'speech', reference = null, persona = 'a11' } = {}) {
  const normalizedPersona = normalizeTtsPersona(persona);
  const base = [buildVoicePersonaInstruction(normalizedPersona)];
  if (vocalMode === 'sing') {
    base.push('Donne une prosodie melodique et chantonnee, avec rythme doux, sans surjouer.');
  } else if (vocalMode === 'adaptive') {
    base.push('Adapte le rythme et lintonation au texte, en gardant une presence stable.');
  }
  if (reference?.analysis?.ok) {
    base.push('Garde un volume stable et une articulation comparable a la reference sonore selectionnee.');
  }
  return base.join(' ');
}

async function requestOpenAiTts(text, body = {}, options = {}) {
  const apiKey = getOpenAiTtsApiKey();
  if (!apiKey) throw new Error('openai_tts_key_missing');

  const vocalMode = normalizeVocalMode({ ...(body || {}), ...(options || {}) });
  const persona = getTtsPersonaFromBody(body || {}, options?.persona || options?.surface || '');
  const reference = resolveVoiceReferenceForRequest({
    user: options.user || null,
    requestedId: String(body?.voiceReferenceId || body?.voiceRefId || body?.referenceId || '').trim(),
    preferredLabel: getPreferredVoiceReferenceLabelForPersona(persona),
  });
  const officialPersonaStyleFallback = !reference
    && isInteractiveTtsRequest(body)
    && OFFICIAL_PERSONAS.has(persona);
  const model = String(
    body?.ttsModel
    || process.env.OPENAI_TTS_MODEL
    || process.env.A11_OPENAI_TTS_MODEL
    || 'gpt-4o-mini-tts'
  ).trim();
  const modelFallbacks = Array.from(new Set([
    model,
    'tts-1',
  ].filter(Boolean)));
  const voice = normalizeOpenAiTtsVoice(body?.openAiVoice || body?.ttsVoice || body?.voice, vocalMode);
  const responseFormat = normalizeTtsAudioFormat(body, isInteractiveTtsRequest(body) ? 'mp3' : '');
  let response = null;
  let resolvedModel = modelFallbacks[0];
  let lastStatus = null;
  for (const candidateModel of modelFallbacks) {
    response = await fetch(`${getOpenAiTtsBaseUrl()}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: candidateModel,
        voice,
        input: String(text || '').slice(0, 4096),
        instructions: buildOpenAiTtsInstructions({ vocalMode, reference, persona }),
        response_format: responseFormat,
      }),
      signal: AbortSignal.timeout(Number(process.env.OPENAI_TTS_TIMEOUT_MS || 18000) || 18000),
    });
    if (response.ok) {
      resolvedModel = candidateModel;
      break;
    }
    lastStatus = response.status;
    await response.arrayBuffer().catch(() => null);
    response = null;
  }

  if (!response?.ok) {
    throw new Error(`openai_tts_http_${lastStatus || 'failed'}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('openai_tts_empty_audio');
  const audioUrl = saveProviderAudioBuffer(audioBuffer, 'openai', responseFormat);
  return {
    success: true,
    provider: 'openai',
    model: resolvedModel,
    voice,
    audioFormat: responseFormat,
    content_type: responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
    persona,
    voiceReference: reference
      ? {
          id: reference.id,
          label: reference.label,
          scope: reference.scope,
        }
      : officialPersonaStyleFallback
        ? {
            id: `${persona}-interactive-style`,
            label: getPreferredVoiceReferenceLabelForPersona(persona),
            scope: 'interactive-style',
          }
        : null,
    referenceVoiceFallback: officialPersonaStyleFallback,
    providerCapabilities: {
      referenceVoice: Boolean(reference) || officialPersonaStyleFallback,
      styleVoice: true,
    },
    audioUrl,
    audio_url: audioUrl,
  };
}

async function probeSinglePiperHttpHealth(baseUrl, enabled) {
  const candidates = ['/health', '/api/tts', '/', '/synthesize', '/tts'];
  let lastHttpStatus = null;
  let lastBody = '';
  let lastError = null;

  if (!enabled) {
    return {
      ok: false,
      statusCode: null,
      path: null,
      body: null,
      lastHttpStatus,
      lastBody,
      lastError,
    };
  }

  for (const candidatePath of candidates) {
    try {
      const response = await fetch(`${baseUrl}${candidatePath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      const raw = await response.text();
      if (response.ok) {
        return {
          ok: true,
          statusCode: response.status,
          path: candidatePath,
          body: parseJsonMaybe(raw),
          lastHttpStatus,
          lastBody,
          lastError,
        };
      }
      lastHttpStatus = response.status;
      lastBody = raw;
    } catch (error_) {
      lastError = error_;
    }
  }

  return {
    ok: false,
    statusCode: null,
    path: null,
    body: null,
    lastHttpStatus,
    lastBody,
    lastError,
  };
}

async function probePiperHttpHealth(ttsConfig, enabled) {
  const triedBaseUrls = getRemoteTtsBaseUrls(ttsConfig);
  let lastProbe = {
    ok: false,
    statusCode: null,
    path: null,
    body: null,
    lastHttpStatus: null,
    lastBody: '',
    lastError: null,
    baseUrl: null,
    triedBaseUrls,
  };

  if (!enabled) {
    return lastProbe;
  }

  for (const baseUrl of triedBaseUrls) {
    const probe = await probeSinglePiperHttpHealth(baseUrl, enabled);
    if (probe.ok) {
      return {
        ...probe,
        baseUrl,
        triedBaseUrls,
      };
    }
    lastProbe = {
      ...probe,
      baseUrl,
      triedBaseUrls,
    };
  }

  return lastProbe;
}

// Try to call a local Piper HTTP service. Tries several common paths.
async function callPiperHttp(text, model) {
  if (!text) throw new Error('missing_text');

  const { requestBaseUrl } = getLocalTtsConfig();
  const candidates = ['/', '/synthesize', '/api/tts', '/tts', '/generate'];
  let lastError = null;

  for (const p of candidates) {
    try {
      const response = await fetch(`${requestBaseUrl}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model }),
        signal: AbortSignal.timeout(10000),
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = new Error(`piper_http_error ${response.status} ${response.statusText || ''} ${String(raw).slice(0, 200)}`);
        continue;
      }
      return { path: p, body: parseJsonMaybe(raw) };
    } catch (error_) {
      lastError = error_;
    }
  }

  if (lastError?.name === 'TimeoutError') {
    throw new Error('piper_timeout');
  }
  throw new Error('piper_unreachable: ' + String(lastError?.message || lastError || 'unknown_error'));
}

function resolveEspeakData() {
  const fromEnv = String(process.env.ESPEAK_DATA_PATH || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const localEspeak = firstExistingPath(getTtsEspeakPathCandidates());
  if (localEspeak) return localEspeak;

  // piper-tts pip package bundles espeak-ng-data inside piper_phonemize
  const pythonVersions = ['python3.11', 'python3.12', 'python3.10', 'python3'];
  const venvRoots = ['/opt/venv', '/usr/local', '/usr'];
  for (const root of venvRoots) {
    for (const pyver of pythonVersions) {
      const candidate = path.join(root, 'lib', pyver, 'site-packages', 'piper_phonemize', 'espeak-ng-data');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function spawnPiperLocal(text, model) {
  return new Promise((resolve, reject) => {
    try {
      const piper = resolvePiperBinary();
      const modelPath = resolvePiperModel(model);
      ensurePiperModelSidecars(modelPath);

      if (!piper) {
        return reject(new Error('piper binary not found (set PIPER_BIN)'));
      }
      if (!modelPath) {
        return reject(new Error('piper model not found (set TTS_MODEL_PATH or TTS_MODELS_DIR)'));
      }

      const ttsDir = ensurePublicTtsDir();
      try {
        if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir, { recursive: true });
      } catch (error_) {
        console.warn('[TTS][Piper] failed to prepare output directory:', error_.message);
      }

      const ts = Date.now();
      const outFileName = `tts-out-${ts}.wav`;
      const outFile = path.join(ttsDir, outFileName);

      // Resolve espeak-ng-data directory (piper-tts pip bundles it inside piper_phonemize)
      const espeak = resolveEspeakData();
      const args = [
        '--model', modelPath,
        '--output_file', outFile,
        ...(espeak ? ['--espeak_data', espeak] : []),
      ];

      let stderr = '';
      let stdout = '';

      const p = spawn(piper.command, args, {
        cwd: piper.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      p.stdout.on('data', (chunk) => {
        stdout += String(chunk || '');
      });

      p.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });

      p.stdin.write(text);
      p.stdin.end();

      let responded = false;

      p.on('close', (code) => {
        if (responded) return;
        responded = true;
        if (code === 0) {
          if (fs.existsSync(outFile)) {
            return resolve({ success: true, audioUrl: buildBackendTtsOutPath(`/out/${outFileName}`) });
          }
          return reject(new Error(`tts_failed_no_file${stderr ? ': ' + stderr.trim().slice(0, 500) : ''}`));
        }
        const details = stderr.trim() || stdout.trim();
        return reject(new Error(`tts_failed_exit_${code}${details ? ': ' + details.slice(0, 500) : ''}`));
      });

      p.on('error', (err) => {
        if (responded) return;
        responded = true;
        const details = stderr.trim() || stdout.trim();
        return reject(new Error(`tts_spawn_error: ${String(err?.message)}${details ? ' :: ' + details.slice(0, 500) : ''}`));
      });

    } catch (err) {
      return reject(err);
    }
  });
}

function normalizeEspeakVoice(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.includes('fr_fr') || raw.includes('siwis') || raw === 'fr') return 'fr-fr';
  if (/^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(raw)) return raw.replace('_', '-');
  return 'fr-fr';
}

function spawnEspeakLocal(text, voice, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const espeak = resolveEspeakBinary();
      if (!espeak) {
        return reject(new Error('espeak-ng binary not found (install espeak-ng or set ESPEAK_BIN)'));
      }

      const ttsDir = ensurePublicTtsDir();
      const ts = Date.now();
      const outFileName = `tts-out-${ts}-espeak.wav`;
      const outFile = path.join(ttsDir, outFileName);
      const vocalMode = normalizeVocalMode(options);
      const speed = vocalMode === 'sing'
        ? Number(process.env.TTS_ESPEAK_SING_SPEED || 118)
        : Number(process.env.TTS_ESPEAK_SPEED || 160);
      const pitch = vocalMode === 'sing'
        ? Number(process.env.TTS_ESPEAK_SING_PITCH || 72)
        : Number(process.env.TTS_ESPEAK_PITCH || 50);
      const amplitude = vocalMode === 'sing'
        ? Number(process.env.TTS_ESPEAK_SING_AMPLITUDE || 150)
        : Number(process.env.TTS_ESPEAK_AMPLITUDE || 120);
      const args = [
        '-v', normalizeEspeakVoice(voice),
        '-s', String(speed || 160),
        '-p', String(pitch || 50),
        '-a', String(amplitude || 120),
        '-w', outFile,
        text,
      ];

      let stderr = '';
      let stdout = '';
      const p = spawn(espeak.command, args, {
        cwd: espeak.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      p.stdout.on('data', (chunk) => {
        stdout += String(chunk || '');
      });
      p.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
      p.on('close', (code) => {
        if (code === 0 && fs.existsSync(outFile)) {
          return resolve({
            success: true,
            audioUrl: buildBackendTtsOutPath(`/out/${outFileName}`),
            audio_url: buildBackendTtsOutPath(`/out/${outFileName}`),
            provider: 'espeak-ng',
          });
        }
        const details = stderr.trim() || stdout.trim();
        return reject(new Error(`espeak_failed_exit_${code}${details ? ': ' + details.slice(0, 500) : ''}`));
      });
      p.on('error', (err) => {
        const details = stderr.trim() || stdout.trim();
        return reject(new Error(`espeak_spawn_error: ${String(err?.message)}${details ? ' :: ' + details.slice(0, 500) : ''}`));
      });
    } catch (err) {
      return reject(err);
    }
  });
}


// GET /api/tts/health -> probe local Piper service (try multiple endpoints)
router.get('/tts/health', async (req, res) => {
  const ttsConfig = getLocalTtsConfig();
  const { host, port, requestBaseUrl, publicBaseUrl } = ttsConfig;
  const preferHttpTts = shouldPreferHttpTts();
  const rawRequestedVoice = req.query && typeof req.query === 'object'
    ? (req.query.voice ?? req.query.model ?? '')
    : '';
  const requestedVoice = typeof rawRequestedVoice === 'string' ? (rawRequestedVoice.trim() || null) : null;
  const httpProbe = await probePiperHttpHealth(ttsConfig, preferHttpTts);
  const { lastHttpStatus, lastBody, lastError } = httpProbe;

  if (httpProbe.ok) {
    return res.json({
      ok: true,
      mode: 'http',
      statusCode: httpProbe.statusCode,
      path: httpProbe.path,
      body: httpProbe.body,
      activeBaseUrl: httpProbe.baseUrl || requestBaseUrl,
      triedBaseUrls: httpProbe.triedBaseUrls,
      requestBaseUrl,
      publicBaseUrl,
    });
  }

  const spawn = getSpawnReadiness(requestedVoice || DEFAULT_TTS_MODEL_NAME);
  const espeak = resolveEspeakBinary();
  let httpWarning = null;
  if (preferHttpTts) {
    if (lastError?.name === 'TimeoutError') {
      httpWarning = 'piper_http_timeout';
    } else {
      httpWarning = 'piper_http_unreachable';
    }
  }
  if (spawn.ready) {
    return res.json({
      ok: true,
      mode: preferHttpTts ? 'spawn-fallback' : 'spawn-ready',
      warning: httpWarning,
      host,
      port,
      requestBaseUrl,
      publicBaseUrl,
      requestedModel: spawn.requestedModel,
      piperCommand: spawn.piperCommand,
      modelPath: spawn.modelPath,
      modelJsonPath: spawn.modelJsonPath,
      espeakData: resolveEspeakData(),
      openAiTtsConfigured: Boolean(getOpenAiTtsApiKey()),
      voiceConversionConfigured: parseOptionalBoolean(process.env.A11_VOICE_CONVERSION_ENABLED, false) === true,
    });
  }

  if (espeak) {
    return res.json({
      ok: true,
      mode: 'espeak-ready',
      warning: spawn.piperCommand ? 'piper_not_ready' : 'piper_binary_missing',
      host,
      port,
      requestBaseUrl,
      publicBaseUrl,
      requestedModel: spawn.requestedModel,
      piperCommand: spawn.piperCommand,
      modelPath: spawn.modelPath,
      modelJsonPath: spawn.modelJsonPath,
      espeakCommand: espeak.command,
      openAiTtsConfigured: Boolean(getOpenAiTtsApiKey()),
      voiceConversionConfigured: parseOptionalBoolean(process.env.A11_VOICE_CONVERSION_ENABLED, false) === true,
    });
  }

  if (spawn.modelPath && !spawn.modelJsonExists) {
    return res.status(503).json({
      ok: false,
      error: 'model_json_missing',
      requestBaseUrl,
      publicBaseUrl,
      requestedModel: spawn.requestedModel,
      modelPath: spawn.modelPath,
      modelJsonCandidates: spawn.modelJsonCandidates,
      modelJsonPath: spawn.modelJsonPath,
    });
  }

  if (preferHttpTts) {
    const fallbackStatus = lastError?.name === 'TimeoutError' ? 504 : (lastHttpStatus || 503);
    return res.status(fallbackStatus).json({
      ok: false,
      error: httpWarning || 'piper_http_unreachable',
      host,
      port,
      activeBaseUrl: httpProbe.baseUrl || null,
      triedBaseUrls: httpProbe.triedBaseUrls,
      requestBaseUrl,
      publicBaseUrl,
      statusCode: lastHttpStatus || null,
      body: lastBody ? String(lastBody).slice(0, 300) : null,
      message: String(lastError?.message || 'remote_tts_unreachable'),
    });
  }

  if (!spawn.piperCommand) {
    return res.status(503).json({
      ok: false,
      error: 'piper_binary_missing',
      requestedModel: spawn.requestedModel,
      message: 'No piper executable found (set PIPER_BIN or install piper in PATH).',
    });
  }

  if (!spawn.modelPath) {
    return res.status(503).json({
      ok: false,
      error: 'model_missing',
      requestedModel: spawn.requestedModel,
      message: 'No model file found (set TTS_MODEL_PATH or TTS_MODELS_DIR).',
    });
  }

  if (lastHttpStatus) {
    return res.status(502).json({ ok: false, error: 'piper_unhealthy', statusCode: lastHttpStatus, body: String(lastBody).slice(0, 300), host, port });
  }
  if (lastError?.name === 'TimeoutError') {
    return res.status(504).json({ ok: false, error: 'tts_timeout', host, port });
  }
  return res.status(503).json({ ok: false, error: 'tts_unreachable', message: String(lastError?.message || 'unknown_error'), host, port });
});

// GET /api/tts/models -> list available models under piper/models
router.get('/tts/models', (req, res) => {
  try {
    const configuredDir = String(process.env.TTS_MODELS_DIR || process.env.PIPER_MODELS_DIR || '').trim();
    const modelsDir = configuredDir || firstExistingPath(getTtsModelDirCandidates());
    if (!modelsDir || !fs.existsSync(modelsDir)) return res.json({ models: [] });
    const models = listOnnxFiles(modelsDir);
    return res.json({ models, modelsDir });
  } catch (err) {
    console.error('[TTS][Piper] list models error', err);
    return res.status(500).json({ error: 'list_models_failed' });
  }
});

router.get('/tts/sound/status', requireJwt, (_req, res) => {
  const library = listLibraryVoiceReferences();
  return res.json({
    ok: true,
    module: 'a11-sound-reference',
    supportedUploads: {
      mimeTypes: Array.from(AUDIO_MIME_TYPES),
      extensions: Array.from(AUDIO_EXTENSIONS),
      maxBytes: 25 * 1024 * 1024,
    },
    modes: ['speech', 'adaptive', 'sing'],
    comparison: 'wav_pcm_features',
    conversion: {
      enabled: parseOptionalBoolean(process.env.A11_VOICE_CONVERSION_ENABLED, false) === true,
      endpoint: '/api/voice/convert',
      provider: String(process.env.A11_VOICE_CONVERTER_PROVIDER || 'ffmpeg-morph').trim(),
    },
    library: {
      enabled: true,
      count: library.length,
      references: library.map((ref) => ({
        id: ref.id,
        label: ref.label,
        scope: ref.scope,
        source: ref.source,
        analysis: ref.analysis || null,
      })),
    },
  });
});

router.get('/tts/references', requireJwt, (req, res) => {
  try {
    return res.json({
      ok: true,
      references: listVoiceReferences({ user: req.user }),
    });
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'voice_reference_list_failed',
      message: String(error_?.message || error_),
    });
  }
});

router.post('/tts/references', requireJwt, voiceReferenceUpload.any(), (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const file = files.find((entry) => entry?.buffer?.length) || null;
    if (!file) {
      return res.status(400).json({
        ok: false,
        error: 'missing_audio',
        message: 'Envoie un fichier audio dans un champ voiceReference, audio ou file.',
      });
    }

    const reference = saveVoiceReference({
      user: req.user,
      file,
      label: req.body?.label || req.body?.name || file.originalname,
      scope: req.body?.scope || 'private',
    });

    return res.status(201).json({
      ok: true,
      reference,
      references: listVoiceReferences({ user: req.user }),
    });
  } catch (error_) {
    const message = String(error_?.message || error_);
    if (error_?.code === 'account_storage_quota_exceeded') {
      return res.status(error_?.status || 413).json(buildStorageQuotaPayload(error_));
    }
    const status = message.startsWith('unsupported_audio_type') ? 415 : 500;
    return res.status(status).json({
      ok: false,
      error: status === 415 ? 'unsupported_audio_type' : 'voice_reference_save_failed',
      message,
    });
  }
});

router.get('/tts/references/:id/audio', requireJwt, (req, res) => {
  try {
    const reference = findVoiceReference({ user: req.user, id: req.params?.id, includePath: true });
    if (!reference?.filePath || !fs.existsSync(reference.filePath)) {
      return res.status(404).json({ ok: false, error: 'voice_reference_not_found' });
    }
    res.setHeader('Content-Type', reference.mimeType || contentTypeForTtsAsset(reference.filePath));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(reference.filePath);
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'voice_reference_read_failed',
      message: String(error_?.message || error_),
    });
  }
});

router.delete('/tts/references/:id', requireJwt, (req, res) => {
  try {
    const deleted = deleteVoiceReference({ user: req.user, id: req.params?.id });
    if (!deleted) return res.status(404).json({ ok: false, error: 'voice_reference_not_found' });
    return res.json({
      ok: true,
      deleted: true,
      references: listVoiceReferences({ user: req.user }),
    });
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'voice_reference_delete_failed',
      message: String(error_?.message || error_),
    });
  }
});

router.post('/tts/sound/compare', requireJwt, voiceReferenceUpload.any(), (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const generated = files.find((file) => /generated|output|audio/i.test(file.fieldname || '')) || files[0] || null;
    const referenceUpload = files.find((file) => /reference|ref|voice/i.test(file.fieldname || '') && file !== generated) || files[1] || null;
    const referenceId = String(req.body?.voiceReferenceId || req.body?.voiceRefId || req.body?.referenceId || '').trim();
    const storedReference = referenceId
      ? findVoiceReference({ user: req.user, id: referenceId, includePath: true })
      : null;

    if (!generated?.buffer?.length) {
      return res.status(400).json({ ok: false, error: 'missing_generated_audio' });
    }

    let referenceBuffer = referenceUpload?.buffer || null;
    let referenceFile = referenceUpload || null;
    let reference = null;
    if (!referenceBuffer && storedReference?.filePath && fs.existsSync(storedReference.filePath)) {
      referenceBuffer = fs.readFileSync(storedReference.filePath);
      referenceFile = { mimetype: storedReference.mimeType || 'audio/wav' };
      reference = {
        id: storedReference.id,
        label: storedReference.label,
        scope: storedReference.scope,
      };
    }
    if (!referenceBuffer) {
      return res.status(400).json({ ok: false, error: 'missing_reference_audio' });
    }

    return res.json({
      ok: true,
      reference,
      comparison: compareAudioBuffers({
        generatedBuffer: generated.buffer,
        referenceBuffer,
        generatedFile: generated,
        referenceFile,
      }),
    });
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'sound_compare_failed',
      message: String(error_?.message || error_),
    });
  }
});

router.use(['/tts/references', '/tts/sound/compare'], (err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      error: 'file_too_large',
      message: 'Fichier audio trop grand (max 25 MB).',
    });
  }
  return res.status(400).json({
    ok: false,
    error: 'upload_error',
    message: err?.message || 'Erreur upload audio.',
  });
});

function contentTypeForTtsAsset(filename = '') {
  const ext = path.extname(String(filename || '').trim()).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function parseTtsStreamPreference(body = {}) {
  const raw = String(
    body?.stream
    ?? body?.audioStream
    ?? body?.consumeAudio
    ?? process.env.A11_TTS_STREAM_BY_DEFAULT
    ?? ''
  ).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'stream', 'consume'].includes(raw);
}

function isInsideDirectory(parent, candidate) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isGeneratedTtsAssetPath(filePath = '') {
  const resolved = path.resolve(filePath);
  const filename = path.basename(resolved);
  if (!/^(tts-out-|a11-voice-|a11-converted-).+\.(wav|mp3|ogg)$/i.test(filename)) {
    return false;
  }
  return isInsideDirectory(getPublicTtsDir(), resolved)
    || isInsideDirectory(path.join(getCanonicalTtsDir(), 'out'), resolved);
}

function deleteGeneratedTtsAsset(filePath = '') {
  try {
    if (!isGeneratedTtsAssetPath(filePath)) return false;
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function pruneOldTtsAssets(maxAgeMs = Number(process.env.A11_TTS_ASSET_MAX_AGE_MS || 10 * 60 * 1000)) {
  const dirs = [getPublicTtsDir(), path.join(getCanonicalTtsDir(), 'out')];
  const now = Date.now();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const filePath = path.join(dir, entry);
        if (!isGeneratedTtsAssetPath(filePath)) continue;
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          deleteGeneratedTtsAsset(filePath);
        }
      }
    } catch {
      // Cleanup is opportunistic.
    }
  }
}

async function sendTtsPayloadResponse(req, res, payload) {
  if (!parseTtsStreamPreference(req?.body || {})) {
    return res.json(payload);
  }

  const audioUrl = String(payload?.audioUrl || payload?.audio_url || '').trim();
  if (!audioUrl) return res.json(payload);

  try {
    const audio = await loadTtsAudioBuffer(audioUrl, { consume: true });
    if (!audio?.buffer?.length) return res.json(payload);
    res.setHeader('Content-Type', audio.contentType || 'audio/wav');
    res.setHeader('Content-Length', String(audio.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-A11-TTS-Stream', 'consumed');
    return res.send(audio.buffer);
  } catch (error_) {
    console.warn('[TTS] stream response failed, returning JSON payload:', error_?.message || error_);
    return res.json(payload);
  }
}

function buildVivyTtsJobBody(body = {}) {
  const text = String(
    body.text
    || body.prompt
    || body.lyrics
    || body.brief
    || body.message
    || ''
  ).trim();
  const isSong = parseOptionalBoolean(body.song || body.isSong || body.makeSong, false) === true
    || /\b(song|chanson|refrain|couplet|lyrics|paroles)\b/i.test(String(body.kind || body.mode || body.vocalMode || body.prompt || ''));
  const requestedStrength = resolveVoiceConversionStrength(body);
  const requestedF0Shift = resolveVoiceF0Shift(body);
  const vivyVoiceStrength = requestedStrength ?? (isSong ? 0.32 : 0.24);
  const vivyF0Shift = requestedF0Shift ?? (isSong ? -0.35 : -0.8);
  return {
    ...body,
    text,
    voice: body.voice || 'vivy',
    provider: body.provider || PROVIDERS.XTTS_RVC,
    ttsProvider: body.ttsProvider || body.provider || PROVIDERS.XTTS_RVC,
    persona: body.persona || 'vivy',
    voicePersona: body.voicePersona || 'vivy',
    surface: body.surface || 'vivy',
    vocalMode: body.vocalMode || (isSong ? 'sing' : 'adaptive'),
    voiceConversion: body.voiceConversion ?? true,
    useDefaultVoiceReference: body.useDefaultVoiceReference ?? !body.voiceReferenceId,
    defaultVoiceReference: body.defaultVoiceReference ?? !body.voiceReferenceId,
    voiceReferenceRequired: body.voiceReferenceRequired ?? true,
    referenceVoiceRequired: body.referenceVoiceRequired ?? true,
    allowBrowserSpeechFallback: false,
    audioFormat: normalizeTtsAudioFormat(body, 'mp3'),
    responseFormat: normalizeTtsAudioFormat(body, 'mp3'),
    voiceConversionStrength: vivyVoiceStrength,
    strength: vivyVoiceStrength,
    f0Shift: vivyF0Shift,
    jobKind: body.jobKind || (isSong ? 'vivy.song.xtts-rvc' : 'vivy.xtts-rvc'),
  };
}

router.options(['/tts/piper', '/tts/speak', '/tts/jobs/:jobId', '/vivy/jobs', '/vivy/jobs/:jobId', '/tts/out/:filename'], (req, res) => {
  setTtsCorsHeaders(req, res);
  return res.status(204).end();
});

async function handleTtsSpeakRequest(req, res) {
  try {
    const text = String(req.body?.text || '').trim();
    const vocalMode = normalizeVocalMode(req.body || {});
    const readableText = shapeTextForVocalMode(buildTtsReadableText(text), vocalMode);
    const voice = resolveVoiceForRequest(req.body || {});
    const preferHttpTts = shouldPreferHttpTts();

    if (!readableText) {
      return res.status(400).json({ error: 'missing_text' });
    }

    let remoteError = null;
    const preparedBody = {
      ...(req.body || {}),
      text: readableText,
      voice,
      model: voice || req.body?.model,
      vocalMode,
    };
    let openAiTtsErrorMessage = null;
    const resolvedProvider = resolveTtsProviderForRequest(preparedBody);
    const strictOfficialVoice = shouldBlockNeutralVoiceFallback(preparedBody);
    const canUseOpenAiIdentityFallback = shouldTryOpenAiTts(preparedBody);
    const interactiveTts = isInteractiveTtsRequest(preparedBody);
    const hasDirectIdentityBridge = resolvedProvider.provider === PROVIDERS.XTTS_RVC
      && resolvedProvider.configured !== false;
    const hasExplicitDirectIdentityBridge = hasExplicitXttsRvcBridgeConfig();
    const preferOpenAiTtsFirst = shouldPreferOpenAiTtsFirst(preparedBody, vocalMode)
      || (interactiveTts && canUseOpenAiIdentityFallback)
      || (strictOfficialVoice && canUseOpenAiIdentityFallback && !hasDirectIdentityBridge);
    const preferOpenAiBeforeDirectBridge = preferOpenAiTtsFirst
      && (!hasDirectIdentityBridge || interactiveTts || !hasExplicitDirectIdentityBridge);
    const sendFinalizedPayload = async (basePayload) => {
      const payload = await finalizeTtsPayload(basePayload, req, vocalMode);
      if (requiresReferenceVoice(req) && !isReferenceAwareTtsPayload(payload)) {
        return res.status(424).json(buildReferenceVoiceUnavailablePayload(payload));
      }
      return sendTtsPayloadResponse(req, res, payload);
    };

    if (preferOpenAiBeforeDirectBridge) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] preferred voice failed:', openAiTtsErrorMessage);
        if (strictOfficialVoice && isExplicitOpenAiProvider(getRequestedTtsProvider(preparedBody))) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: OpenAI TTS n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: 'openai',
            diagnostic: 'openai_tts_failed',
          });
        }
      }
    }

    if (resolvedProvider.provider === PROVIDERS.XTTS_RVC) {
      try {
        const directVoice = await requestDirectXttsRvcWithRetry(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        return sendFinalizedPayload(directVoice);
      } catch (xttsRvcError) {
        const message = String(xttsRvcError?.message || xttsRvcError);
        console.warn('[TTS][XTTS/RVC] official voice failed:', message);
        if (strictOfficialVoice && !canUseOpenAiIdentityFallback) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: le runtime XTTS/RVC n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: PROVIDERS.XTTS_RVC,
            diagnostic: 'xtts_rvc_failed',
          });
        }
      }
    } else if (strictOfficialVoice && resolvedProvider.configured === false && !canUseOpenAiIdentityFallback) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider de voix identitaire n’est configure. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: resolvedProvider.diagnostic || 'identity_voice_unavailable',
      });
    }

    if (preferOpenAiTtsFirst && !openAiTtsErrorMessage) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] preferred voice failed:', openAiTtsErrorMessage);
        if (strictOfficialVoice && isExplicitOpenAiProvider(getRequestedTtsProvider(preparedBody))) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: OpenAI TTS n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: 'openai',
            diagnostic: 'openai_tts_failed',
          });
        }
      }
    }

    if (preferHttpTts) {
      try {
        const remote = await requestRemoteTts(preparedBody);
        return sendFinalizedPayload({ ...remote, text: readableText, vocalMode });
      } catch (error_) {
        remoteError = String(error_?.message || error_);
        console.warn('[TTS] HTTP backend unavailable:', remoteError);
        if (strictOfficialVoice) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: le module voix n’a pas repondu avec une voix identitaire. Piper est bloque pour cette voix.',
            provider: resolvedProvider.provider || null,
            diagnostic: 'voice_module_failed',
          });
        }
      }
    }

    let spawnErrorMessage = null;
    if (strictOfficialVoice) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider identitaire n’a produit d’audio. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: 'neutral_fallback_blocked',
      });
    }

    try {
      const local = await spawnPiperLocal(readableText, voice || null);
      const absoluteAudioUrl = String(local.audioUrl || local.audio_url || '').trim();
      return sendFinalizedPayload({
        ...local,
        via: 'spawn',
        text: readableText,
        vocalMode,
        audio_url: absoluteAudioUrl || null,
        audioUrl: absoluteAudioUrl || null,
      });
    } catch (spawnError) {
      spawnErrorMessage = String(spawnError?.message || spawnError);
    }

    if (!preferOpenAiTtsFirst && shouldTryOpenAiTts(preparedBody)) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          piperError: spawnErrorMessage,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] speech fallback failed, trying espeak:', openAiTtsErrorMessage);
      }
    }

    try {
      const fallback = await spawnEspeakLocal(readableText, voice || null, { vocalMode });
      const absoluteAudioUrl = String(fallback.audioUrl || fallback.audio_url || '').trim();
      return sendFinalizedPayload({
        ...fallback,
        via: 'espeak',
        text: readableText,
        vocalMode,
        piperError: spawnErrorMessage,
        openAiTtsError: openAiTtsErrorMessage,
        audio_url: absoluteAudioUrl || null,
        audioUrl: absoluteAudioUrl || null,
      });
    } catch (espeakError) {
      return res.status(503).json({
        error: 'tts_unavailable',
        remoteError,
        localError: spawnErrorMessage,
        openAiTtsError: openAiTtsErrorMessage,
        fallbackError: String(espeakError?.message || espeakError),
      });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

function startTtsAsyncJob(req, res, options = {}) {
  pruneTtsAsyncJobs();
  const body = buildAsyncTtsJobBody(req.body || {});
  const job = {
    id: createTtsAsyncJobId(),
    kind: String(options.kind || body.jobKind || body.kind || 'tts.speak').trim() || 'tts.speak',
    queue: String(options.queue || body.queue || 'media.audio').trim() || 'media.audio',
    statusUrlBase: String(options.statusUrlBase || '/api/tts/jobs').trim() || '/api/tts/jobs',
    orchestrator: buildBatRomeTtsOrchestrator(body),
    pollIntervalMs: Number(options.pollIntervalMs || 1500),
    state: 'queued',
    statusCode: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    userId: req.user?.id || req.user?.sub || null,
    body,
    result: null,
    error: null,
    message: null,
  };
  ttsAsyncJobs.set(job.id, job);

  const headers = { ...(req.headers || {}), 'x-a11-internal-tts-job': '1' };
  setImmediate(() => {
    Promise.resolve().then(async () => {
      job.state = 'running';
      job.startedAt = Date.now();
      const capture = createTtsJobResponseCapture(job);
      const internalReq = {
        ...req,
        body: job.body,
        headers,
        user: req.user || null,
      };
      await handleTtsSpeakRequest(internalReq, capture);
      if (job.state === 'running' || job.state === 'queued') {
        job.state = 'done';
        job.statusCode = capture.statusCode || 200;
        job.finishedAt = Date.now();
      }
    }).catch((error_) => {
      job.state = 'failed';
      job.statusCode = 500;
      job.error = 'tts_job_failed';
      job.message = String(error_?.message || error_);
      job.result = { ok: false, error: job.error, message: job.message };
      job.finishedAt = Date.now();
    });
  });

  return res.status(202).json(publicTtsAsyncJob(job));
}

router.get('/tts/jobs/:jobId', runOptionalJwt, (req, res) => {
  setTtsCorsHeaders(req, res);
  pruneTtsAsyncJobs();
  const jobId = String(req.params?.jobId || '').trim();
  const job = ttsAsyncJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  const requestUserId = req.user?.id || req.user?.sub || null;
  if (job.userId && requestUserId && job.userId !== requestUserId) {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  return res.json(publicTtsAsyncJob(job));
});

router.post('/vivy/jobs', runOptionalJwt, async (req, res) => {
  setTtsCorsHeaders(req, res);
  const body = buildVivyTtsJobBody(req.body || {});
  if (!body.text) {
    return res.status(400).json({ ok: false, error: 'missing_text' });
  }
  req.body = body;
  return startTtsAsyncJob(req, res, {
    kind: body.jobKind || 'vivy.xtts-rvc',
    queue: 'media.audio',
    statusUrlBase: '/api/vivy/jobs',
    pollIntervalMs: 1500,
  });
});

router.get('/vivy/jobs/:jobId', runOptionalJwt, (req, res) => {
  setTtsCorsHeaders(req, res);
  pruneTtsAsyncJobs();
  const jobId = String(req.params?.jobId || '').trim();
  const job = ttsAsyncJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  const requestUserId = req.user?.id || req.user?.sub || null;
  if (job.userId && requestUserId && job.userId !== requestUserId) {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  return res.json(publicTtsAsyncJob({ ...job, statusUrlBase: '/api/vivy/jobs' }));
});

router.get('/tts/out/:filename', async (req, res) => {
  setTtsCorsHeaders(req, res);
  pruneOldTtsAssets();
  const filename = path.basename(String(req.params?.filename || '').trim());
  if (!filename || filename === '.' || filename === '..') {
    return res.status(400).json({ ok: false, error: 'invalid_tts_asset' });
  }

  const ttsConfig = getLocalTtsConfig();
  const remoteBaseUrls = uniqueBaseUrls([
    ...getDirectXttsRvcBaseUrls(),
    String(ttsConfig.requestBaseUrl || ttsConfig.baseUrl || ''),
  ]);

  for (const remoteBaseUrl of remoteBaseUrls) {
    const remoteUrl = `${remoteBaseUrl}/out/${encodeURIComponent(filename)}?consume=1`;
    try {
      const response = await fetch(remoteUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const contentType = String(response.headers?.get?.('content-type') || contentTypeForTtsAsset(filename)).trim();
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buffer);
      }
    } catch {
      // Try the next configured voice service, then fall back to local files.
    }
  }

  const localPath = [
    path.join(getPublicTtsDir(), filename),
    path.join(getCanonicalTtsDir(), 'out', filename),
  ].find((candidate) => fs.existsSync(candidate));
  if (!localPath) {
    return res.status(404).json({ ok: false, error: 'tts_asset_not_found' });
  }

  res.setHeader('Content-Type', contentTypeForTtsAsset(filename));
  res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => {
    deleteGeneratedTtsAsset(localPath);
  });
  return res.sendFile(localPath);
});

router.post(['/tts/piper', '/tts/speak'], runOptionalJwt, async (req, res) => {
  setTtsCorsHeaders(req, res);
  if (wantsAsyncTtsJob(req.body || {}) && String(req.headers?.['x-a11-internal-tts-job'] || '') !== '1') {
    return startTtsAsyncJob(req, res);
  }
  try {
    const text = String(req.body?.text || '').trim();
    const vocalMode = normalizeVocalMode(req.body || {});
    const readableText = shapeTextForVocalMode(buildTtsReadableText(text), vocalMode);
    const voice = resolveVoiceForRequest(req.body || {});
    const preferHttpTts = shouldPreferHttpTts();

    if (!readableText) {
      return res.status(400).json({ error: 'missing_text' });
    }

    let remoteError = null;
    const preparedBody = {
      ...(req.body || {}),
      text: readableText,
      voice,
      model: voice || req.body?.model,
      vocalMode,
    };
    let openAiTtsErrorMessage = null;
    const resolvedProvider = resolveTtsProviderForRequest(preparedBody);
    const strictOfficialVoice = shouldBlockNeutralVoiceFallback(preparedBody);
    const canUseOpenAiIdentityFallback = shouldTryOpenAiTts(preparedBody);
    const interactiveTts = isInteractiveTtsRequest(preparedBody);
    const hasDirectIdentityBridge = resolvedProvider.provider === PROVIDERS.XTTS_RVC
      && resolvedProvider.configured !== false;
    const hasExplicitDirectIdentityBridge = hasExplicitXttsRvcBridgeConfig();
    const preferOpenAiTtsFirst = shouldPreferOpenAiTtsFirst(preparedBody, vocalMode)
      || (interactiveTts && canUseOpenAiIdentityFallback)
      || (strictOfficialVoice && canUseOpenAiIdentityFallback && !hasDirectIdentityBridge);
    const preferOpenAiBeforeDirectBridge = preferOpenAiTtsFirst
      && (!hasDirectIdentityBridge || interactiveTts || !hasExplicitDirectIdentityBridge);
    const sendFinalizedPayload = async (basePayload) => {
      const payload = await finalizeTtsPayload(basePayload, req, vocalMode);
      if (requiresReferenceVoice(req) && !isReferenceAwareTtsPayload(payload)) {
        return res.status(424).json(buildReferenceVoiceUnavailablePayload(payload));
      }
      return sendTtsPayloadResponse(req, res, payload);
    };

    if (preferOpenAiBeforeDirectBridge) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] preferred voice failed:', openAiTtsErrorMessage);
        if (strictOfficialVoice && isExplicitOpenAiProvider(getRequestedTtsProvider(preparedBody))) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: OpenAI TTS n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: 'openai',
            diagnostic: 'openai_tts_failed',
          });
        }
      }
    }

    if (resolvedProvider.provider === PROVIDERS.XTTS_RVC) {
      try {
        const directVoice = await requestDirectXttsRvcWithRetry(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        return sendFinalizedPayload(directVoice);
      } catch (xttsRvcError) {
        const message = String(xttsRvcError?.message || xttsRvcError);
        console.warn('[TTS][XTTS/RVC] official voice failed:', message);
        if (strictOfficialVoice && !canUseOpenAiIdentityFallback) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: le runtime XTTS/RVC n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: PROVIDERS.XTTS_RVC,
            diagnostic: 'xtts_rvc_failed',
          });
        }
      }
    } else if (strictOfficialVoice && resolvedProvider.configured === false && !canUseOpenAiIdentityFallback) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider de voix identitaire n’est configure. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: resolvedProvider.diagnostic || 'identity_voice_unavailable',
      });
    }

    if (preferOpenAiTtsFirst && !openAiTtsErrorMessage) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] preferred voice failed:', openAiTtsErrorMessage);
        if (strictOfficialVoice && isExplicitOpenAiProvider(getRequestedTtsProvider(preparedBody))) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: OpenAI TTS n’a pas produit la voix demandee. Piper est bloque pour cette voix.',
            provider: 'openai',
            diagnostic: 'openai_tts_failed',
          });
        }
      }
    }

    if (preferHttpTts) {
      try {
        const remote = await requestRemoteTts(preparedBody);
        return sendFinalizedPayload({ ...remote, text: readableText, vocalMode });
      } catch (error_) {
        remoteError = String(error_?.message || error_);
        console.warn('[TTS] HTTP backend unavailable:', remoteError);
        if (strictOfficialVoice) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: 'Voix officielle indisponible: le module voix n’a pas repondu avec une voix identitaire. Piper est bloque pour cette voix.',
            provider: resolvedProvider.provider || null,
            diagnostic: 'voice_module_failed',
          });
        }
      }
    }

    let spawnErrorMessage = null;
    if (strictOfficialVoice) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider identitaire n’a produit d’audio. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: 'neutral_fallback_blocked',
      });
    }

    try {
      const local = await spawnPiperLocal(readableText, voice || null);
      const absoluteAudioUrl = String(local.audioUrl || local.audio_url || '').trim();
      return sendFinalizedPayload({
        ...local,
        via: 'spawn',
        text: readableText,
        vocalMode,
        audio_url: absoluteAudioUrl || null,
        audioUrl: absoluteAudioUrl || null,
      });
    } catch (spawnError) {
      spawnErrorMessage = String(spawnError?.message || spawnError);
    }

    if (!preferOpenAiTtsFirst && shouldTryOpenAiTts(preparedBody)) {
      try {
        const openAiTts = await requestOpenAiTts(readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(openAiTts.audioUrl || openAiTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...openAiTts,
          via: 'openai-tts',
          text: readableText,
          vocalMode,
          piperError: spawnErrorMessage,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (openAiTtsError) {
        openAiTtsErrorMessage = String(openAiTtsError?.message || openAiTtsError);
        console.warn('[TTS][OpenAI] speech fallback failed, trying espeak:', openAiTtsErrorMessage);
      }
    }

    try {
      const fallback = await spawnEspeakLocal(readableText, voice || null, { vocalMode });
      const absoluteAudioUrl = String(fallback.audioUrl || fallback.audio_url || '').trim();
      return sendFinalizedPayload({
        ...fallback,
        via: 'espeak',
        text: readableText,
        vocalMode,
        piperError: spawnErrorMessage,
        openAiTtsError: openAiTtsErrorMessage,
        audio_url: absoluteAudioUrl || null,
        audioUrl: absoluteAudioUrl || null,
      });
    } catch (espeakError) {
      return res.status(503).json({
        error: 'tts_unavailable',
        remoteError,
        localError: spawnErrorMessage,
        openAiTtsError: openAiTtsErrorMessage,
        fallbackError: String(espeakError?.message || espeakError),
      });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


module.exports = router;
module.exports.configureTtsRouter = configureTtsRouter;
