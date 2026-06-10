const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const buildTtsReadableText = require('../src/tts/build-tts-readable-text.cjs');
const { extractRequestAuthToken } = require('../src/middleware/jwt-auth.cjs');
const { resolveMcpAccountProfileSync } = require('../src/auth/mcp-account-tier.cjs');
const { buildStorageQuotaPayload } = require('../src/storage/account-storage-quota.cjs');
const {
  buildVoicePersonaInstruction,
  getDefaultVoiceProviderForPersona,
  getReadyVoiceProfile,
  isLegacyCloudTtsProvider,
  isLegacyCloudTtsProviderEnabled,
  isProviderRuntimeConfigured,
  OFFICIAL_PERSONAS,
  PROVIDERS,
  resolveVoiceProvider,
} = require('../src/tts/voice-provider-manifest.cjs');
const {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  VOICE_CATALOG_CONSENT,
  compareAudioBuffers,
  deleteVoiceReference,
  findVoiceReference,
  isAllowedAudioUpload,
  isVoiceCatalogScope,
  listVoiceCatalogReferences,
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
const xttsRvcQueue = [];
let xttsRvcActive = 0;
const TTS_ASYNC_JOB_TTL_MS = Number(process.env.A11_TTS_ASYNC_JOB_TTL_MS || 15 * 60 * 1000);
const TTS_ASYNC_JOB_MAX_AGE_MS = Number(process.env.A11_TTS_ASYNC_JOB_MAX_AGE_MS || 30 * 60 * 1000);
const TTS_ASYNC_DEFAULT_QUEUE_MAX = 50;
const TTS_XTTS_RVC_DEFAULT_CONCURRENCY = 1;
const TTS_XTTS_RVC_DEFAULT_QUEUE_MAX = 24;
const LOCAL_GPU_WORKER_DEFAULT_MAX_ACTIVE = 1;
const LOCAL_GPU_WORKER_DEFAULT_MAX_LEASE_EXPIRIES = 1;
const TTS_PRIORITY_SCORES = {
  admin: 100,
  family: 60,
  public: 10,
};
const OFFICIAL_VOICE_SAMPLE_FILES = {
  a11: 'a11-official-stern-french.wav',
  djeff: 'djeff-rap.wav',
  kaen44: 'kaen44-official-french-narrator.wav',
  k44: 'kaen44-official-french-narrator.wav',
  vivy: 'vivy-official-french-conversational.wav',
};
const OWNED_OFFICIAL_REFERENCE_PERSONAS = new Set(['a11', 'kaen44', 'vivy']);
const BASIC_OWNED_OFFICIAL_REFERENCE_PERSONAS = new Set(['a11', 'kaen44']);

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

function positiveIntFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function getXttsRvcQueueConcurrency() {
  return Math.max(1, Math.min(4, positiveIntFromEnv('A11_TTS_XTTS_RVC_CONCURRENCY', TTS_XTTS_RVC_DEFAULT_CONCURRENCY)));
}

function getXttsRvcQueueMax() {
  return Math.max(1, Math.min(100, positiveIntFromEnv('A11_TTS_XTTS_RVC_QUEUE_MAX', TTS_XTTS_RVC_DEFAULT_QUEUE_MAX)));
}

function getTtsAsyncQueueMax() {
  return Math.max(1, Math.min(250, positiveIntFromEnv('A11_TTS_ASYNC_QUEUE_MAX', TTS_ASYNC_DEFAULT_QUEUE_MAX)));
}

function createXttsRvcQueueError() {
  const error = new Error('xtts_rvc_queue_saturated');
  error.code = 'xtts_rvc_queue_saturated';
  error.statusCode = 429;
  return error;
}

function drainXttsRvcQueue() {
  const concurrency = getXttsRvcQueueConcurrency();
  while (xttsRvcActive < concurrency && xttsRvcQueue.length > 0) {
    const item = xttsRvcQueue.shift();
    xttsRvcActive += 1;
    Promise.resolve()
      .then(item.work)
      .then(item.resolve, item.reject)
      .finally(() => {
        xttsRvcActive = Math.max(0, xttsRvcActive - 1);
        drainXttsRvcQueue();
      });
  }
}

function enqueueXttsRvcWork(work) {
  if (xttsRvcQueue.length >= getXttsRvcQueueMax()) {
    return Promise.reject(createXttsRvcQueueError());
  }
  return new Promise((resolve, reject) => {
    xttsRvcQueue.push({
      work,
      resolve,
      reject,
      queuedAt: Date.now(),
    });
    drainXttsRvcQueue();
  });
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

function isActiveTtsAsyncJob(job = {}) {
  return ['queued', 'leased', 'running'].includes(job?.state);
}

function pruneTtsAsyncJobs(now = Date.now()) {
  releaseStaleLocalGpuWorkerLeases(now);
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

function getLocalGpuWorkerToken() {
  const fileCandidates = [
    process.env.A11_LOCAL_GPU_WORKER_TOKEN_FILE,
    process.env.A11_TTS_LOCAL_WORKER_TOKEN_FILE,
    '/app/runtime/secrets/local_gpu_worker_token',
  ].filter(Boolean);
  for (const candidate of fileCandidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Optional secret file.
    }
  }
  return String(
    process.env.A11_LOCAL_GPU_WORKER_TOKEN
    || process.env.A11_TTS_LOCAL_WORKER_TOKEN
    || ''
  ).trim();
}

function timingSafeEqualText(left = '', right = '') {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getLocalGpuWorkerRequestToken(req = {}) {
  const workerHeader = String(req.headers?.['x-a11-worker-token'] || '').trim();
  if (workerHeader) return workerHeader;
  const auth = String(req.headers?.authorization || '').trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireLocalGpuWorkerAuth(req, res, next) {
  const expected = getLocalGpuWorkerToken();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'local_gpu_worker_token_missing',
      message: 'Worker GPU local non configure sur ce runtime.',
    });
  }
  const provided = getLocalGpuWorkerRequestToken(req);
  if (!timingSafeEqualText(provided, expected)) {
    return res.status(401).json({ ok: false, error: 'local_gpu_worker_unauthorized' });
  }
  return next();
}

function localGpuWorkerEnabled() {
  return envBool('A11_TTS_LOCAL_GPU_WORKER_ENABLED', false)
    || envBool('A11_LOCAL_GPU_WORKER_ENABLED', false);
}

function getLocalGpuWorkerLeaseMs() {
  return Math.max(30_000, Math.min(20 * 60_000, Number(process.env.A11_LOCAL_GPU_WORKER_LEASE_MS || 6 * 60_000) || 6 * 60_000));
}

function getLocalGpuWorkerMaxActive() {
  return Math.max(1, Math.min(8, positiveIntFromEnv('A11_LOCAL_GPU_WORKER_MAX_ACTIVE', LOCAL_GPU_WORKER_DEFAULT_MAX_ACTIVE)));
}

function getLocalGpuWorkerMaxLeaseExpiries() {
  return Math.max(1, Math.min(5, positiveIntFromEnv('A11_LOCAL_GPU_WORKER_MAX_LEASE_EXPIRIES', LOCAL_GPU_WORKER_DEFAULT_MAX_LEASE_EXPIRIES)));
}

function getLocalGpuWorkerFallbackMs() {
  const value = Number(process.env.A11_LOCAL_GPU_WORKER_FALLBACK_MS || 45_000);
  if (!Number.isFinite(value)) return 45_000;
  return Math.max(0, Math.min(5 * 60_000, value));
}

function fallbackLocalGpuJobToServer(job, reason = 'local_gpu_worker_fallback') {
  if (!job || job.worker !== 'local-gpu') return false;
  job.worker = 'server';
  job.state = 'queued';
  job.statusCode = null;
  job.error = null;
  job.message = null;
  job.workerFallbackAt = Date.now();
  job.workerFallbackReason = reason;
  job.workerId = null;
  job.leasedAt = null;
  job.result = null;
  job.finishedAt = null;
  runInternalTtsAsyncJob(job, {
    body: job.body || {},
    headers: {},
    user: job.userId ? { id: job.userId } : null,
  }, { 'x-a11-internal-tts-job': '1' });
  return true;
}

function isPrivilegedTtsUser(user = {}) {
  const roles = [
    user?.role,
    user?.tier,
    user?.plan,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return user?.isAdmin === true
    || user?.admin === true
    || user?.fullAccess === true
    || roles.some((role) => ['admin', 'owner', 'founder', 'fondateur', 'djeff'].includes(role));
}

function resolveTtsAccountProfile(req = {}) {
  try {
    return resolveMcpAccountProfileSync(req?.user || {});
  } catch {
    return {
      tier: isPrivilegedTtsUser(req?.user || {}) ? 'admin_family' : 'basic',
      label: isPrivilegedTtsUser(req?.user || {}) ? 'Admin famille' : 'Basic',
    };
  }
}

function canUsePaidTtsVoice(req = {}) {
  if (isPrivilegedTtsUser(req?.user || {})) return true;
  const tier = String(resolveTtsAccountProfile(req)?.tier || 'basic').trim().toLowerCase();
  return ['admin_family', 'founder', 'premium'].includes(tier);
}

function canUseSharedVoiceCatalog(req = {}) {
  return canUsePaidTtsVoice(req);
}

function getOwnedOfficialReferencePersona(body = {}) {
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  return OWNED_OFFICIAL_REFERENCE_PERSONAS.has(explicitPersona) ? explicitPersona : '';
}

function shouldUseOwnedOfficialReferenceForBasic(body = {}) {
  const explicitPersona = getOwnedOfficialReferencePersona(body);
  if (!explicitPersona) return false;
  if (!BASIC_OWNED_OFFICIAL_REFERENCE_PERSONAS.has(explicitPersona)) return false;
  if (body?.identityVoice === false || body?.useIdentityVoice === false || body?.neutralVoice === true) {
    return false;
  }
  return wantsOfficialIdentityVoice(body);
}

function allowsExplicitOwnedOfficialCloudVoice(body = {}) {
  const explicitPersona = getOwnedOfficialReferencePersona(body);
  if (!explicitPersona) return false;
  const provider = getRequestedTtsProvider(body);
  if (isCloudTtsProvider(provider)) return true;
  const explicitCloudOverride = parseOptionalBoolean(
    body?.allowOfficialCloudVoice
    ?? body?.forceOfficialCloudVoice
    ?? body?.allowIdentityCloudVoice
    ?? body?.forceIdentityCloudVoice
    ?? (explicitPersona === 'a11' ? (body?.allowA11CloudVoice ?? body?.forceA11CloudVoice) : undefined)
    ?? (explicitPersona === 'kaen44' ? (body?.allowKaen44CloudVoice ?? body?.forceKaen44CloudVoice ?? body?.allowK44CloudVoice ?? body?.forceK44CloudVoice) : undefined)
    ?? body?.forceCloudTts
    ?? body?.useReadyMadeCloudVoice,
    false
  ) === true;
  if (!explicitCloudOverride) return false;
  if (isCloudTtsProvider(provider)) return true;
  return parseOptionalBoolean(
    body?.forceCloudTts
    ?? body?.useReadyMadeCloudVoice,
    false
  ) === true;
}

function wantsSpecificLocalVoiceReference(body = {}) {
  return Boolean(String(
    body?.voiceReferenceId
    || body?.voiceRefId
    || body?.referenceId
    || body?.voiceStyle
    || body?.voice_style
    || body?.voiceReferenceName
    || body?.voiceReferenceLabel
    || body?.referenceVoiceStyle
    || ''
  ).trim());
}

function shouldUseDefaultCloudVoiceForPersona(body = {}) {
  const explicitPersona = getOwnedOfficialReferencePersona(body);
  if (!explicitPersona) return false;
  if (!allowsPaidTtsVoiceForBody(body)) return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider && requestedProvider !== 'auto') return false;
  if (wantsSpecificLocalVoiceReference(body)) return false;
  const defaultProvider = getDefaultVoiceProviderForPersona(explicitPersona);
  return isCloudTtsProvider(defaultProvider) && isProviderRuntimeConfigured(defaultProvider);
}

function shouldUseA11OfficialReferenceVoice(body = {}) {
  const explicitPersona = getOwnedOfficialReferencePersona(body);
  if (!explicitPersona) return false;
  if (body?.identityVoice === false || body?.useIdentityVoice === false || body?.neutralVoice === true) {
    return false;
  }
  if (allowsExplicitOwnedOfficialCloudVoice(body)) return false;
  if (shouldUseDefaultCloudVoiceForPersona(body)) return false;
  const costPolicy = String(body?.ttsCostPolicy || '').trim().toLowerCase();
  return costPolicy === `basic_${explicitPersona}_official_reference`
    || costPolicy === `${explicitPersona}_official_reference`
    || wantsOfficialIdentityVoice(body)
    || requiresReferenceVoice(body)
    || wantsDefaultVoiceReference(body);
}

function normalizeA11OfficialReferenceRequest(body = {}) {
  if (!shouldUseA11OfficialReferenceVoice(body)) return body;
  const persona = getOwnedOfficialReferencePersona(body) || 'a11';
  const piperProfile = getReadyVoiceProfile(persona, PROVIDERS.PIPER);
  const piperVoice = String(piperProfile?.piperVoice || 'fr_FR-tom-medium').trim() || 'fr_FR-tom-medium';
  const vocalMode = normalizeVocalMode(body);
  return {
    ...(body || {}),
    provider: PROVIDERS.XTTS_RVC,
    ttsProvider: PROVIDERS.XTTS_RVC,
    engine: body?.engine || body?.voiceEngine || PROVIDERS.XTTS_RVC,
    voiceEngine: body?.voiceEngine || body?.engine || PROVIDERS.XTTS_RVC,
    voiceConversionEngine: body?.voiceConversionEngine || body?.conversionEngine || PROVIDERS.XTTS_RVC,
    conversionEngine: body?.conversionEngine || body?.voiceConversionEngine || PROVIDERS.XTTS_RVC,
    voice: body?.voice || piperVoice,
    model: body?.model || piperVoice,
    piperVoice,
    persona,
    voicePersona: persona,
    surface: body?.surface || persona,
    vocalMode: vocalMode === 'speech' ? 'adaptive' : vocalMode,
    voiceConversion: true,
    convertVoice: true,
    morphVoice: true,
    rvc: true,
    voiceReferenceRequired: true,
    requireVoiceReference: true,
    referenceVoiceRequired: true,
    useDefaultVoiceReference: true,
    defaultVoiceReference: true,
    usePersonaVoiceReference: true,
    identityVoice: true,
    useIdentityVoice: true,
    neutralVoice: false,
    allowRvc: true,
    allowXttsRvc: true,
    allowLegacyVoiceBridge: true,
    xttsRvcOptIn: true,
    audioFormat: normalizeTtsAudioFormat(body, 'mp3'),
    responseFormat: normalizeTtsAudioFormat(body, 'mp3'),
    ttsCostPolicy: String(body?.ttsCostPolicy || '').trim() || `${persona}_official_reference`,
  };
}

function enforceBasicTtsCostPolicy(req = {}, body = {}) {
  if (canUsePaidTtsVoice(req)) return body;
  if (shouldUseOwnedOfficialReferenceForBasic(body)) {
    const persona = getOwnedOfficialReferencePersona(body) || 'a11';
    const piperProfile = getReadyVoiceProfile(persona, PROVIDERS.PIPER);
    const piperVoice = String(piperProfile?.piperVoice || 'fr_FR-upmc-medium').trim() || 'fr_FR-upmc-medium';
    const vocalMode = normalizeVocalMode(body);
    return {
      ...(body || {}),
      provider: PROVIDERS.PIPER,
      ttsProvider: PROVIDERS.PIPER,
      engine: body?.engine || body?.voiceEngine || PROVIDERS.XTTS_RVC,
      voiceEngine: body?.voiceEngine || body?.engine || PROVIDERS.XTTS_RVC,
      voiceConversionEngine: body?.voiceConversionEngine || body?.conversionEngine || PROVIDERS.XTTS_RVC,
      conversionEngine: body?.conversionEngine || body?.voiceConversionEngine || PROVIDERS.XTTS_RVC,
      voice: body?.voice || piperVoice,
      model: body?.model || piperVoice,
      piperVoice,
      persona,
      voicePersona: persona,
      surface: body?.surface || persona,
      vocalMode: vocalMode === 'speech' ? 'adaptive' : vocalMode,
      voiceConversion: true,
      convertVoice: true,
      morphVoice: true,
      rvc: true,
      voiceReferenceRequired: true,
      requireVoiceReference: true,
      referenceVoiceRequired: true,
      useDefaultVoiceReference: true,
      defaultVoiceReference: true,
      usePersonaVoiceReference: true,
      identityVoice: true,
      useIdentityVoice: true,
      neutralVoice: false,
      allowRvc: true,
      allowXttsRvc: true,
      allowLegacyVoiceBridge: true,
      xttsRvcOptIn: true,
      audioFormat: normalizeTtsAudioFormat(body, 'mp3'),
      responseFormat: normalizeTtsAudioFormat(body, 'mp3'),
      ttsCostPolicy: `basic_${persona}_official_reference`,
    };
  }
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const explicitIdentityRequest = OFFICIAL_PERSONAS.has(explicitPersona)
    && !isExplicitNeutralVoiceRequest(body)
    && (
      requiresReferenceVoice(body)
      || body?.identityVoice === true
      || body?.useIdentityVoice === true
      || body?.neutralVoice === false
    );
  if (explicitIdentityRequest) {
    return {
      ...(body || {}),
      identityVoice: true,
      useIdentityVoice: true,
      neutralVoice: false,
      allowPaidTtsVoice: false,
      paidTtsAllowed: false,
      allowCloudTts: false,
      allowReadyMadeCloudVoice: false,
      ttsCostPolicy: `basic_${explicitPersona}_identity_blocked`,
    };
  }
  const provider = getRequestedTtsProvider(body);
  const explicitlyNeutral = body?.identityVoice === false
    || body?.useIdentityVoice === false
    || body?.neutralVoice === true;
  const alreadyNeutral = Boolean(provider)
    && isNeutralTtsProvider(provider)
    && explicitlyNeutral
    && !requiresReferenceVoice(body)
    && !wantsDefaultVoiceReference(body);
  if (alreadyNeutral && normalizeVocalMode(body) === 'speech') return body;
  return {
    ...(body || {}),
    provider: PROVIDERS.PIPER,
    ttsProvider: PROVIDERS.PIPER,
    voice: 'fr_FR-siwis-medium',
    model: 'fr_FR-siwis-medium',
    piperVoice: 'fr_FR-siwis-medium',
    vocalMode: 'speech',
    voiceConversion: false,
    voiceReferenceRequired: false,
    requireVoiceReference: false,
    referenceVoiceRequired: false,
    useDefaultVoiceReference: false,
    defaultVoiceReference: false,
    usePersonaVoiceReference: false,
    identityVoice: false,
    useIdentityVoice: false,
    neutralVoice: true,
    allowRvc: false,
    allowXttsRvc: false,
    allowLegacyVoiceBridge: false,
    xttsRvcOptIn: false,
    ttsCostPolicy: 'basic_siwis_only',
  };
}

function resolveTtsPriorityLane(req = {}, body = {}) {
  const raw = String(
    body.priorityTier
    || body.ttsPriorityTier
    || body.priority
    || body.audience
    || body.accessTier
    || ''
  ).trim().toLowerCase();
  const privileged = isPrivilegedTtsUser(req.user || {});
  if (privileged) {
    return { tier: 'admin', score: TTS_PRIORITY_SCORES.admin, label: 'Admin' };
  }
  if (canUsePaidTtsVoice(req) && ['family', 'famille', 'premium', 'founder', 'fondateur'].includes(raw)) {
    return { tier: 'family', score: TTS_PRIORITY_SCORES.family, label: 'Famille' };
  }
  return { tier: 'public', score: TTS_PRIORITY_SCORES.public, label: 'Public' };
}

function releaseStaleLocalGpuWorkerLeases(now = Date.now()) {
  const leaseMs = getLocalGpuWorkerLeaseMs();
  for (const job of ttsAsyncJobs.values()) {
    if (job?.worker !== 'local-gpu') continue;
    if (job.state !== 'leased') continue;
    if (!job.leasedAt || now - job.leasedAt <= leaseMs) continue;
    job.leaseExpiredCount = Number(job.leaseExpiredCount || 0) + 1;
    job.state = 'queued';
    job.statusCode = null;
    job.workerId = null;
    job.leaseExpiredAt = now;
    job.leasedAt = null;
    if (job.leaseExpiredCount >= getLocalGpuWorkerMaxLeaseExpiries()) {
      fallbackLocalGpuJobToServer(job, 'local_gpu_worker_lease_expired');
    }
  }
}

function hasConfiguredCloudTtsForBody(body = {}) {
  try {
    if (shouldUseA11OfficialReferenceVoice(body)) return false;
    const resolved = resolveTtsProviderForRequest(body);
    if (isCloudTtsProvider(resolved?.provider) && resolved?.configured === true) return true;
    return getCloudTtsProviderOrder(body, resolved).length > 0;
  } catch {
    return false;
  }
}

function shouldRouteTtsJobToLocalGpuWorker(body = {}) {
  if (body?.disableLocalGpuWorker === true || body?.localGpuWorker === false || body?.useLocalGpuWorker === false) return false;
  if (!localGpuWorkerEnabled()) return false;
  if (shouldUseA11OfficialReferenceVoice(body)) return true;
  const provider = getRequestedTtsProvider(body);
  if (isCloudTtsProvider(provider) && !allowsXttsRvcForBody(body)) return false;
  if (provider !== PROVIDERS.XTTS_RVC && hasConfiguredCloudTtsForBody(body)) return false;
  return provider === PROVIDERS.XTTS_RVC
    || wantsOfficialIdentityVoice(body)
    || requiresReferenceVoice(body)
    || wantsDefaultVoiceReference(body);
}

function publicLocalGpuWorkerJob(job = {}) {
  return {
    id: job.id,
    kind: job.kind,
    queue: job.queue,
    priorityTier: job.priorityTier || 'public',
    priorityScore: Number(job.priorityScore || TTS_PRIORITY_SCORES.public),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    leasedAt: job.leasedAt || null,
    body: job.body || {},
    orchestrator: job.orchestrator || null,
    formats: job.orchestrator?.formats || null,
  };
}

function findClaimableLocalGpuWorkerJob(now = Date.now()) {
  releaseStaleLocalGpuWorkerLeases(now);
  const jobs = Array.from(ttsAsyncJobs.values())
    .filter((job) => job?.worker === 'local-gpu' && job.state === 'queued')
    .sort((a, b) => {
      const priorityDelta = Number(b.priorityScore || TTS_PRIORITY_SCORES.public) - Number(a.priorityScore || TTS_PRIORITY_SCORES.public);
      if (priorityDelta) return priorityDelta;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
  return jobs[0] || null;
}

function publicTtsAsyncJob(job = {}) {
  const leaseExpiresAt = job.leasedAt
    ? Number(job.leasedAt) + getLocalGpuWorkerLeaseMs()
    : null;
  const payload = {
    ok: job.state !== 'failed',
    async: true,
    jobId: job.id || null,
    kind: job.kind || 'tts.speak',
    queue: job.queue || 'media.audio',
    priorityTier: job.priorityTier || 'public',
    priorityLabel: job.priorityLabel || null,
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
    worker: job.worker || null,
    workerId: job.workerId || null,
    leasedAt: job.leasedAt || null,
    leaseExpiresAt,
    leaseExpiredCount: Number(job.leaseExpiredCount || 0),
    workerFallbackAt: job.workerFallbackAt || null,
    workerFallbackReason: job.workerFallbackReason || null,
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

function countLocalGpuWorkerLeases() {
  return Array.from(ttsAsyncJobs.values())
    .filter((job) => job?.worker === 'local-gpu' && ['leased', 'running'].includes(job.state))
    .length;
}

function buildTtsQueueSnapshot(now = Date.now()) {
  const jobs = Array.from(ttsAsyncJobs.values());
  const countsByState = jobs.reduce((acc, job) => {
    const state = String(job?.state || 'unknown');
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
  const countsByPriority = jobs.reduce((acc, job) => {
    const tier = String(job?.priorityTier || 'public');
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});
  const localJobs = jobs.filter((job) => job?.worker === 'local-gpu');
  const leaseMs = getLocalGpuWorkerLeaseMs();
  const activeAsync = jobs.filter(isActiveTtsAsyncJob);
  const localQueued = localJobs.filter((job) => job.state === 'queued');
  const localLeased = localJobs.filter((job) => ['leased', 'running'].includes(job.state));
  const staleLeases = localLeased.filter((job) => job.leasedAt && now - Number(job.leasedAt) > leaseMs);
  const oldestQueuedAt = activeAsync
    .filter((job) => job.state === 'queued')
    .map((job) => Number(job.createdAt || 0))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;
  const maxActive = getLocalGpuWorkerMaxActive();

  return {
    schema: 'funesterie.tts.queue-status.v1',
    generatedAt: new Date(now).toISOString(),
    asyncJobs: {
      total: jobs.length,
      active: activeAsync.length,
      max: getTtsAsyncQueueMax(),
      states: countsByState,
      priorities: countsByPriority,
      oldestQueuedAgeMs: oldestQueuedAt ? Math.max(0, now - oldestQueuedAt) : null,
    },
    localGpu: {
      enabled: localGpuWorkerEnabled(),
      queued: localQueued.length,
      leased: localLeased.length,
      active: localJobs.filter(isActiveTtsAsyncJob).length,
      maxActive,
      availableSlots: Math.max(0, maxActive - localLeased.length),
      staleLeases: staleLeases.length,
      leaseMs,
      fallbackMs: getLocalGpuWorkerFallbackMs(),
      maxLeaseExpiries: getLocalGpuWorkerMaxLeaseExpiries(),
    },
    xttsRvc: {
      queued: xttsRvcQueue.length,
      active: xttsRvcActive,
      concurrency: getXttsRvcQueueConcurrency(),
      max: getXttsRvcQueueMax(),
    },
  };
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
  const rawLatencyMode = String(
    body.latencyMode
    || body.ttsLatencyMode
    || body.playbackMode
    || body.modeHint
    || ''
  ).trim().toLowerCase();
  const latencyMode = ['interactive', 'realtime', 'real-time', 'live', 'fast'].includes(rawLatencyMode)
    ? 'background'
    : (body.latencyMode || body.ttsLatencyMode || body.playbackMode || body.modeHint || 'background');
  return {
    ...body,
    ttsAsync: false,
    asyncTts: false,
    backgroundTts: false,
    async: false,
    latencyMode,
    ttsLatencyMode: 'background',
    playbackMode: 'background',
    modeHint: 'background',
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
  const persona = getExplicitTtsPersonaFromBody(body);
  if (OFFICIAL_PERSONAS.has(persona)) {
    const profile = getReadyVoiceProfile(persona, PROVIDERS.PIPER);
    const personaVoice = String(
      body?.piperVoice
      || body?.piperModel
      || getPersonaScopedEnvValue('A11_PIPER', persona, ['VOICE', 'MODEL'])
      || getPersonaScopedEnvValue('PIPER', persona, ['VOICE', 'MODEL'])
      || profile?.piperVoice
      || profile?.providerLabels?.[PROVIDERS.PIPER]
      || ''
    ).trim();
    if (personaVoice) return personaVoice;
  }
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
    let canMirror = false;
    try {
      fs.accessSync(path.dirname(missing), fs.constants.W_OK);
      canMirror = true;
    } catch (error_) {
      canMirror = false;
    }
    if (canMirror) {
      try {
        fs.copyFileSync(existing, missing);
      } catch (error_) {
        console.warn('[TTS][Piper] failed to mirror model sidecar:', error_.message);
      }
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

function errorMessageFromPayload(value, fallback = '') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === 'object') {
    for (const key of ['message', 'error', 'detail', 'reason', 'code']) {
      if (value[key] != null && value[key] !== value) {
        const nested = errorMessageFromPayload(value[key], '');
        if (nested) return nested;
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback || 'unknown_error';
    }
  }
  return String(value || fallback || 'unknown_error');
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
    includeCatalog: canUseSharedVoiceCatalog(req),
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
    includeCatalog: canUseSharedVoiceCatalog(req),
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
          const requestedFormat = normalizeTtsAudioFormat(req?.body || {}, audioExtensionFromContentType(contentType, 'wav'));
          const convertedUrl = await saveProviderAudioBufferForFormat(
            Buffer.from(await response.arrayBuffer()),
            'xtts-rvc',
            requestedFormat,
            contentType
          );
          if (!convertedUrl) throw new Error('voice_conversion_empty_audio');
          await loadTtsAudioBuffer(audioUrl, { consume: true }).catch(() => null);
          return {
            ...payload,
            originalAudioUrl: audioUrl,
            original_audio_url: audioUrl,
            audioUrl: convertedUrl,
            audio_url: convertedUrl,
            audioFormat: /\.mp3(?:[?#].*)?$/i.test(convertedUrl) ? 'mp3' : audioExtensionFromContentType(contentType, requestedFormat),
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
          throw new Error(errorMessageFromPayload(parsed?.detail ?? parsed?.message ?? parsed?.error, `voice_conversion_http_${response.status}`));
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
        message: errorMessageFromPayload(error_, 'voice_conversion_failed').slice(0, 500),
      },
    };
  }
}

async function finalizeTtsPayload(payload, req, vocalMode) {
  if (isReferenceAwareTtsPayload(payload)) {
    return enrichTtsPayloadWithAudioModule(payload, req, vocalMode);
  }
  const converted = await requestVoiceConversionWithModule(payload, req, vocalMode);
  return enrichTtsPayloadWithAudioModule(converted, req, vocalMode);
}

function isReferenceAwareTtsPayload(payload = {}) {
  if (payload?.voiceConversion?.ok === true) return true;
  if (payload?.referenceVoice?.ok === true) return true;
  if (payload?.providerCapabilities?.referenceVoice === true) return true;
  if (payload?.audioModule?.reference?.id || payload?.audioModule?.reference?.label) return true;
  if (payload?.audioModule?.comparison?.ok === true) return true;
  if (payload?.provider === 'openai' && payload?.voiceReference?.id) return true;
  return false;
}

function isFfmpegMorphVoicePayload(payload = {}) {
  const conversion = payload?.voiceConversion || {};
  const values = [
    payload?.provider,
    payload?.engine,
    conversion?.provider,
    conversion?.engine,
    ...(Array.isArray(conversion?.attemptedEngines) ? conversion.attemptedEngines : []),
    ...(Array.isArray(payload?.attemptedEngines) ? payload.attemptedEngines : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return values.some((value) => ['ffmpeg', 'ffmpeg-morph', 'morph'].includes(value));
}

function isOwnedOfficialReferenceRequest(req = {}) {
  const body = req?.body || req || {};
  return Boolean(getOwnedOfficialReferencePersona(body)) && shouldUseA11OfficialReferenceVoice(body);
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

function hasUsableReferenceVoicePayload(payload = {}) {
  if (payload?.voiceConversion?.ok === true) return true;
  if (payload?.referenceVoice?.ok === true) return true;
  if (payload?.providerCapabilities?.referenceVoice === true) return true;
  if (payload?.provider === 'openai' && payload?.voiceReference?.id) return true;
  return false;
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

function resolveRemoteTtsAssetFetchUrl(baseUrl, value) {
  const assetUrl = String(value || '').trim();
  if (!assetUrl) return null;
  if (/^https?:\/\//i.test(assetUrl)) return assetUrl;
  try {
    const parsed = new URL(assetUrl.replace(/^\.\//, ''), `${String(baseUrl).replace(/\/$/, '')}/`);
    if (parsed.pathname.startsWith('/api/tts/out/')) {
      const filename = path.posix.basename(decodeURIComponent(parsed.pathname));
      if (filename && filename !== '.' && filename !== '..') {
        parsed.pathname = `/out/${encodeURIComponent(filename)}`;
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
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

function readFirstSecretValue(fileCandidates = [], envCandidates = []) {
  for (const candidate of fileCandidates.filter(Boolean)) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // Secret file is optional.
    }
  }
  for (const name of envCandidates.filter(Boolean)) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getCartesiaTtsApiKey() {
  return readFirstSecretValue(
    [
      process.env.A11_CARTESIA_API_KEY_FILE,
      process.env.CARTESIA_API_KEY_FILE,
      '/app/runtime/secrets/cartesia_api_key',
    ],
    ['A11_CARTESIA_API_KEY', 'CARTESIA_API_KEY', 'CARTESIA_TOKEN']
  );
}

function getElevenLabsTtsApiKey() {
  return readFirstSecretValue(
    [
      process.env.A11_ELEVENLABS_API_KEY_FILE,
      process.env.ELEVENLABS_API_KEY_FILE,
      '/app/runtime/secrets/elevenlabs_api_key',
    ],
    ['A11_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY', 'XI_API_KEY']
  );
}

function getAzureSpeechKey() {
  return readFirstSecretValue(
    [
      process.env.A11_AZURE_SPEECH_KEY_FILE,
      process.env.AZURE_SPEECH_KEY_FILE,
      '/app/runtime/secrets/azure_speech_key',
    ],
    ['A11_AZURE_SPEECH_KEY', 'AZURE_SPEECH_KEY', 'SPEECH_KEY']
  );
}

function getAzureSpeechEndpoint() {
  const explicit = String(
    process.env.A11_AZURE_SPEECH_ENDPOINT
    || process.env.AZURE_SPEECH_ENDPOINT
    || process.env.SPEECH_ENDPOINT
    || ''
  ).trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const region = String(
    process.env.A11_AZURE_SPEECH_REGION
    || process.env.AZURE_SPEECH_REGION
    || process.env.SPEECH_REGION
    || ''
  ).trim();
  return region ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : '';
}

function getRequestedTtsProvider(body = {}) {
  const raw = String(body?.ttsProvider || body?.provider || '').trim().toLowerCase();
  if (['official', 'voix-officielle', 'voix_officielle', 'official-local', 'local-official'].includes(raw)) {
    return PROVIDERS.XTTS_RVC;
  }
  return raw;
}

function isNeutralTtsProvider(provider = '') {
  return ['piper', 'local', 'spawn', 'espeak', 'espeak-ng'].includes(String(provider || '').trim().toLowerCase());
}

function isExplicitOpenAiProvider(provider = '') {
  return String(provider || '').trim().toLowerCase() === 'openai';
}

function isCloudTtsProvider(provider = '') {
  return [PROVIDERS.ELEVENLABS, PROVIDERS.CARTESIA, PROVIDERS.AZURE, PROVIDERS.OPENAI]
    .includes(String(provider || '').trim().toLowerCase());
}

function allowsPaidTtsVoiceForBody(body = {}) {
  const explicit = parseOptionalBoolean(
    body?.allowPaidTtsVoice
    ?? body?.paidTtsAllowed
    ?? body?.allowCloudTts
    ?? body?.allowReadyMadeCloudVoice,
    null
  );
  if (explicit === false) return false;
  const costPolicy = String(body?.ttsCostPolicy || '').trim().toLowerCase();
  if (costPolicy.startsWith('basic_')) return false;
  return true;
}

function allowsXttsRvcForBody(body = {}) {
  const requestedProvider = getRequestedTtsProvider(body);
  const explicitBody = parseOptionalBoolean(
    body.allowRvc
    ?? body.allowXttsRvc
    ?? body.allowLegacyVoiceBridge
    ?? body.xttsRvcOptIn,
    null
  );
  if (explicitBody === true) return true;
  if (explicitBody === false) return false;
  return requestedProvider === PROVIDERS.XTTS_RVC
    && envBool('A11_TTS_ALLOW_EXPLICIT_XTTS_RVC', false);
}

function wantsOfficialIdentityVoice(body = {}) {
  const requestedProvider = getRequestedTtsProvider(body);
  const vocalMode = normalizeVocalMode(body);
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const explicitlyNeutral = isExplicitNeutralVoiceRequest(body);
  if (OFFICIAL_PERSONAS.has(explicitPersona) && !explicitlyNeutral) return true;
  return requestedProvider === PROVIDERS.XTTS_RVC
    || requiresReferenceVoice(body)
    || wantsDefaultVoiceReference(body)
    || vocalMode === 'adaptive'
    || vocalMode === 'sing';
}

function isExplicitNeutralVoiceRequest(body = {}) {
  return body?.identityVoice === false
    || body?.useIdentityVoice === false
    || body?.neutralVoice === true;
}

function shouldBlockNeutralVoiceFallback(body = {}) {
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const requestedProvider = getRequestedTtsProvider(body);
  if (!OFFICIAL_PERSONAS.has(explicitPersona)) return false;
  if (isExplicitNeutralVoiceRequest(body)) return false;
  if (requiresReferenceVoice(body) || wantsDefaultVoiceReference(body)) return true;
  if (wantsOfficialIdentityVoice(body)) return true;
  return !isNeutralTtsProvider(requestedProvider);
}

function resolveTtsProviderForRequest(body = {}) {
  const persona = getTtsPersonaFromBody(body);
  const explicitPersona = getExplicitTtsPersonaFromBody(body);
  const requestedProvider = getRequestedTtsProvider(body);
  const allowPaidVoice = allowsPaidTtsVoiceForBody(body);
  const defaultProvider = getDefaultVoiceProviderForPersona(explicitPersona || persona);
  if (shouldUseA11OfficialReferenceVoice(body)) {
    const ownedPersona = getOwnedOfficialReferencePersona(body) || persona;
    return {
      provider: PROVIDERS.XTTS_RVC,
      configured: true,
      note: `${ownedPersona} official owned WAV reference routed through XTTS/RVC.`,
      diagnostic: null,
    };
  }
  if (isLegacyCloudTtsProvider(requestedProvider)) {
    if (!allowPaidVoice || !isLegacyCloudTtsProviderEnabled(requestedProvider)) {
      return resolveVoiceProvider(persona, { explicitProvider: requestedProvider, allowCloud: false, allowRvc: false });
    }
    return {
      provider: requestedProvider,
      configured: isProviderRuntimeConfigured(requestedProvider),
      note: `Explicit ${requestedProvider} legacy cloud voice request.`,
      diagnostic: isProviderRuntimeConfigured(requestedProvider) ? null : `${requestedProvider}_tts_unavailable`,
    };
  }
  if (requestedProvider === PROVIDERS.AZURE) {
    if (!allowPaidVoice) {
      return resolveVoiceProvider(persona, { explicitProvider: PROVIDERS.PIPER, allowCloud: false, allowRvc: false });
    }
    return {
      provider: PROVIDERS.AZURE,
      configured: isProviderRuntimeConfigured(PROVIDERS.AZURE),
      note: 'Explicit Azure Speech ready-made voice request.',
      diagnostic: isProviderRuntimeConfigured(PROVIDERS.AZURE) ? null : 'azure_tts_unavailable',
    };
  }
  if (isExplicitOpenAiProvider(requestedProvider)) {
    if (!allowPaidVoice) {
      return resolveVoiceProvider(persona, { explicitProvider: PROVIDERS.PIPER, allowCloud: false, allowRvc: false });
    }
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
    if ((!requestedProvider || requestedProvider === 'auto') && allowPaidVoice && isCloudTtsProvider(defaultProvider)) {
      const configured = isProviderRuntimeConfigured(defaultProvider);
      return {
        provider: defaultProvider,
        configured,
        note: `Default ${explicitPersona} privileged ready-made voice request.`,
        diagnostic: configured ? null : `${defaultProvider}_tts_unavailable`,
      };
    }
    if (requestedProvider === PROVIDERS.XTTS_RVC) {
      return resolveVoiceProvider(persona, {
        explicitProvider: requestedProvider,
        allowRvc: allowsXttsRvcForBody(body),
      });
    }
    return resolveVoiceProvider(persona, {
      explicitProvider: requestedProvider && requestedProvider !== 'auto' && !isNeutralTtsProvider(requestedProvider)
        ? requestedProvider
        : undefined,
      allowRvc: allowsXttsRvcForBody(body),
      allowCloud: allowPaidVoice,
    });
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
    allowCloud: allowPaidVoice,
  });
}

function shouldTryOpenAiTts(body = {}) {
  if (shouldUseA11OfficialReferenceVoice(body)) return false;
  if (!allowsPaidTtsVoiceForBody(body)) return false;
  const disabled = String(process.env.A11_OPENAI_TTS_ENABLED || process.env.OPENAI_TTS_ENABLED || '').trim().toLowerCase();
  if (disabled === '0' || disabled === 'false' || disabled === 'off') return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider === 'piper' || requestedProvider === 'local' || requestedProvider === 'espeak') return false;
  return Boolean(getOpenAiTtsApiKey());
}

function shouldTryCartesiaTts(body = {}) {
  if (shouldUseA11OfficialReferenceVoice(body)) return false;
  if (!allowsPaidTtsVoiceForBody(body)) return false;
  if (!isLegacyCloudTtsProviderEnabled(PROVIDERS.CARTESIA)) return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider !== PROVIDERS.CARTESIA) return false;
  return Boolean(getCartesiaTtsApiKey());
}

function shouldTryElevenLabsTts(body = {}) {
  if (shouldUseA11OfficialReferenceVoice(body)) return false;
  if (!allowsPaidTtsVoiceForBody(body)) return false;
  if (!isLegacyCloudTtsProviderEnabled(PROVIDERS.ELEVENLABS)) return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider && requestedProvider !== 'auto' && requestedProvider !== PROVIDERS.ELEVENLABS) return false;
  if (!requestedProvider || requestedProvider === 'auto') {
    const persona = getTtsPersonaFromBody(body);
    if (!['a11', 'vivy'].includes(persona)) return false;
  }
  return Boolean(getElevenLabsTtsApiKey());
}

function shouldTryAzureTts(body = {}) {
  if (shouldUseA11OfficialReferenceVoice(body)) return false;
  if (!allowsPaidTtsVoiceForBody(body)) return false;
  const requestedProvider = getRequestedTtsProvider(body);
  if (requestedProvider && requestedProvider !== 'auto' && requestedProvider !== PROVIDERS.AZURE) return false;
  return Boolean(getAzureSpeechKey() && getAzureSpeechEndpoint());
}

function shouldPreferOpenAiTtsFirst(body = {}, vocalMode = 'speech') {
  if (shouldUseA11OfficialReferenceVoice(body)) return false;
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

function getCloudTtsProviderOrder(body = {}, resolvedProvider = {}) {
  if (shouldUseA11OfficialReferenceVoice(body)) return [];
  if (!allowsPaidTtsVoiceForBody(body)) return [];
  const requestedProvider = getRequestedTtsProvider(body);
  if (isLegacyCloudTtsProvider(requestedProvider) && !isLegacyCloudTtsProviderEnabled(requestedProvider)) return [];
  if (isCloudTtsProvider(requestedProvider)) return [requestedProvider];

  const persona = getExplicitTtsPersonaFromBody(body);
  const wantsIdentity = OFFICIAL_PERSONAS.has(persona) && wantsOfficialIdentityVoice(body);
  if (!wantsIdentity) return [];

  const configured = [];
  if (shouldTryElevenLabsTts(body)) configured.push(PROVIDERS.ELEVENLABS);
  if (shouldTryCartesiaTts(body)) configured.push(PROVIDERS.CARTESIA);
  if (shouldTryAzureTts(body)) configured.push(PROVIDERS.AZURE);
  if (shouldTryOpenAiTts(body)) configured.push(PROVIDERS.OPENAI);
  const resolved = String(resolvedProvider?.provider || '').trim().toLowerCase();
  return Array.from(new Set([
    isCloudTtsProvider(resolved) && resolvedProvider?.configured === true ? resolved : null,
    ...configured,
  ].filter(Boolean)));
}

async function requestCloudTtsProvider(provider, text, body = {}, options = {}) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (isLegacyCloudTtsProvider(normalized) && !isLegacyCloudTtsProviderEnabled(normalized)) {
    throw new Error(`legacy_cloud_tts_disabled_${normalized}`);
  }
  if (normalized === PROVIDERS.ELEVENLABS) return requestElevenLabsTts(text, body, options);
  if (normalized === PROVIDERS.CARTESIA) return requestCartesiaTts(text, body, options);
  if (normalized === PROVIDERS.AZURE) return requestAzureTts(text, body, options);
  if (normalized === PROVIDERS.OPENAI) return requestOpenAiTts(text, body, options);
  throw new Error(`unsupported_cloud_tts_provider_${normalized || 'unknown'}`);
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

function getPersonaEnvAliases(persona = 'a11') {
  const normalized = normalizeTtsPersona(persona);
  if (normalized === 'kaen44') return ['KAEN44', 'K44'];
  if (normalized === 'vivy') return ['VIVY'];
  return ['A11'];
}

function getPersonaScopedEnvValue(prefix, persona, suffixes = []) {
  const aliases = getPersonaEnvAliases(persona);
  const candidates = [];
  for (const alias of aliases) {
    for (const suffix of suffixes) {
      candidates.push(`${prefix}_${alias}_${suffix}`);
      candidates.push(`${alias}_${suffix}`);
    }
  }
  for (const name of candidates) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getOfficialVoiceStyleLabel(persona = 'a11', provider = '') {
  const profile = getReadyVoiceProfile(persona, provider);
  return String(profile?.label || profile?.displayName || profile?.styleId || `${normalizeTtsPersona(persona)}-official`).trim();
}

function getOfficialVoiceStyleId(persona = 'a11') {
  const profile = getReadyVoiceProfile(persona);
  return String(profile?.styleId || `${normalizeTtsPersona(persona)}-official`).trim();
}

function normalizeRequestedOfficialVoiceStyle(value = '', persona = 'a11') {
  const normalizedPersona = normalizeTtsPersona(persona);
  const fallback = getOfficialVoiceStyleId(normalizedPersona);
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const compact = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

  if (normalizedPersona === 'a11' && [
    'a11-voix-de-lait',
    'voix-de-lait',
    'voix-de-lait-a11',
    'lait',
    'milk',
  ].includes(compact)) {
    return 'a11-voix-de-lait';
  }
  if ([
    'djeff',
    'djeff-rap',
    'rap-djeff',
    'pignon',
    'pignon-rap',
    'jeff',
    'jeffrey',
    'moto-rap',
  ].includes(compact)) {
    return 'djeff-rap';
  }
  if (compact === fallback.toLowerCase()) return fallback;
  return fallback;
}

function normalizeTtsPersona(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  const known = normalizeKnownTtsPersona(raw);
  if (known) return known;
  return 'a11';
}

function normalizeKnownTtsPersona(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'a11' || raw === 'alphaonze' || raw === 'alpha-onze') return 'a11';
  if (raw === 'vivy' || raw === 'vivi') return 'vivy';
  if (raw === 'kaen44' || raw === 'k44' || raw === 'kaen') return 'kaen44';
  return '';
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
  return raw ? normalizeKnownTtsPersona(raw) : '';
}

function getPreferredVoiceReferenceLabelForPersona(persona = 'a11') {
  return getOfficialVoiceStyleId(persona);
}

function getPreferredVoiceReferenceLabelFromBody(body = {}, persona = 'a11') {
  return normalizeRequestedOfficialVoiceStyle(
    body?.voiceStyle
    || body?.voice_style
    || body?.voiceReferenceName
    || body?.voiceReferenceLabel
    || body?.referenceVoiceStyle
    || '',
    persona
  );
}

function getPreferredVoiceReferenceLabel(req = {}) {
  const persona = getTtsPersonaFromBody(req?.body || {});
  return getPreferredVoiceReferenceLabelFromBody(req?.body || {}, persona);
}

function isDjeffRapVoiceStyle(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
  return ['djeff', 'djeff-rap', 'rap-djeff', 'pignon', 'pignon-rap', 'moto-rap', 'jeff', 'jeffrey'].includes(normalized);
}

function shouldResolveLocalVoiceReference(body = {}, voiceStyle = '', requestedReferenceId = '') {
  if (requestedReferenceId) return true;
  if (!voiceStyle) return false;
  return wantsDefaultVoiceReference(body)
    || requiresReferenceVoice(body)
    || wantsSpecificLocalVoiceReference(body)
    || allowsXttsRvcForBody(body);
}

function serializeVoiceReferenceForPayload(ref = null, fallbackLabel = '') {
  if (!ref) {
    return {
      id: fallbackLabel || null,
      label: fallbackLabel || null,
      scope: fallbackLabel ? 'voice-library' : null,
    };
  }
  return {
    id: ref.id || fallbackLabel || null,
    label: ref.label || fallbackLabel || null,
    scope: ref.scope || ref.source || 'voice-library',
    source: ref.source || null,
    originalName: ref.originalName || null,
    bytes: ref.bytes || 0,
  };
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

function getAudioFfmpegBinary() {
  return String(process.env.A11_AUDIO_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function buildTtsOutputAudioFilter() {
  return String(
    process.env.A11_TTS_OUTPUT_AUDIO_FILTER
    || 'highpass=f=70,lowpass=f=12000,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=120,loudnorm=I=-16:LRA=8:TP=-1.2'
  ).trim();
}

async function transcodeAudioBuffer(buffer, targetFormat = 'mp3') {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) return null;
  const format = String(targetFormat || '').toLowerCase();
  if (format !== 'mp3') return null;
  const ttsDir = ensurePublicTtsDir();
  const tempBase = `tts-transcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(ttsDir, `${tempBase}.input`);
  const outputPath = path.join(ttsDir, `${tempBase}.mp3`);
  fs.writeFileSync(inputPath, buffer);
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(getAudioFfmpegBinary(), [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-vn',
        ...(buildTtsOutputAudioFilter() ? ['-af', buildTtsOutputAudioFilter()] : []),
        '-ac',
        '1',
        '-ar',
        '44100',
        '-b:a',
        '160k',
        outputPath,
      ], { windowsHide: true });
      let stderr = '';
      proc.stderr?.on?.('data', (chunk) => { stderr += String(chunk || ''); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
        reject(new Error(`ffmpeg_audio_transcode_failed:${code}:${stderr.slice(0, 300)}`));
      });
    });
    return fs.readFileSync(outputPath);
  } finally {
    for (const item of [inputPath, outputPath]) {
      try {
        if (fs.existsSync(item)) fs.unlinkSync(item);
      } catch {}
    }
  }
}

async function saveProviderAudioBufferForFormat(buffer, provider = 'tts', requestedFormat = 'wav', sourceContentType = '') {
  const targetFormat = normalizeTtsAudioFormat({ audioFormat: requestedFormat }, 'wav');
  const sourceExtension = audioExtensionFromContentType(sourceContentType, 'wav');
  if (targetFormat === 'mp3' && sourceExtension !== 'mp3') {
    try {
      const converted = await transcodeAudioBuffer(buffer, 'mp3');
      if (converted?.length) return saveProviderAudioBuffer(converted, provider, 'mp3');
    } catch (error_) {
      console.warn('[TTS] audio transcode to mp3 failed, keeping source format:', error_?.message || error_);
    }
  }
  return saveProviderAudioBuffer(buffer, provider, sourceExtension || targetFormat || 'wav');
}

async function materializeTtsAudioUrlForFormat(audioUrl, requestedFormat = 'wav', provider = 'tts') {
  const targetFormat = normalizeTtsAudioFormat({ audioFormat: requestedFormat }, 'wav');
  if (targetFormat !== 'mp3') return null;
  const raw = String(audioUrl || '').trim();
  if (!raw || /\.mp3(?:[?#].*)?$/i.test(raw)) return null;
  try {
    const audio = await loadTtsAudioBuffer(raw);
    if (!audio?.buffer?.length) return null;
    return await saveProviderAudioBufferForFormat(audio.buffer, provider, 'mp3', audio.contentType || 'audio/wav');
  } catch (error_) {
    console.warn('[TTS] materialize mp3 failed, keeping remote source:', error_?.message || error_);
    return null;
  }
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
  const voiceStyle = getPreferredVoiceReferenceLabelFromBody(body || {}, persona);
  const requestedReferenceId = String(body?.voiceReferenceId || body?.voiceRefId || body?.referenceId || '').trim();
  const shouldResolveReference = shouldResolveLocalVoiceReference(body, voiceStyle, requestedReferenceId);
  const explicitReference = shouldResolveReference
    ? resolveVoiceReferenceForRequest({
        user: options.user || null,
        requestedId: requestedReferenceId,
        preferredLabel: voiceStyle,
        includeCatalog: canUseSharedVoiceCatalog({ user: options.user || null }),
      })
    : null;
  const explicitReferenceFile = explicitReference?.filePath && fs.existsSync(explicitReference.filePath)
    ? explicitReference
    : null;
  if (isDjeffRapVoiceStyle(voiceStyle) && !explicitReferenceFile) {
    throw new Error('djeff_rap_reference_missing');
  }
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
    if (!explicitReferenceFile || !isDjeffRapVoiceStyle(voiceStyle)) {
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
            voiceReferenceId: requestedReferenceId || undefined,
            voiceReferenceName: body?.voiceReferenceName || body?.voiceReferenceLabel || undefined,
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
          const rawAudioUrl = synthesizePayload?.audio_url || synthesizePayload?.audioUrl || synthesizePayload?.url || '';
          const remoteAudioUrl = normalizeRemoteAssetUrl(
            baseUrl,
            rawAudioUrl
          );
          const referenceAware = isReferenceAwareTtsPayload(synthesizePayload);
          if (remoteAudioUrl && referenceAware) {
            const sourceAudioUrl = resolveRemoteTtsAssetFetchUrl(baseUrl, rawAudioUrl) || remoteAudioUrl;
            const materializedAudioUrl = await materializeTtsAudioUrlForFormat(sourceAudioUrl, audioFormat, 'xtts-rvc');
            const finalAudioUrl = materializedAudioUrl || remoteAudioUrl;
            return {
              ...(synthesizePayload && typeof synthesizePayload === 'object' ? synthesizePayload : {}),
              success: true,
              provider: PROVIDERS.XTTS_RVC,
              via: synthesizePayload?.via || 'a11-voice-module-persona',
              text,
              vocalMode,
              audioFormat: materializedAudioUrl ? 'mp3' : audioExtensionFromContentType('', path.extname(new URL(finalAudioUrl, 'http://127.0.0.1').pathname).slice(1) || audioFormat || 'wav'),
              originalAudioUrl: materializedAudioUrl ? remoteAudioUrl : undefined,
              original_audio_url: materializedAudioUrl ? remoteAudioUrl : undefined,
              audio_url: finalAudioUrl,
              audioUrl: finalAudioUrl,
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
                reference: synthesizePayload?.voiceConversion?.reference
                  || synthesizePayload?.voiceReference
                  || serializeVoiceReferenceForPayload(explicitReferenceFile, voiceStyle),
              },
            };
          }
        } else if (synthesizePayload?.detail || synthesizePayload?.error || synthesizePayload?.message) {
          lastError = new Error(
            errorMessageFromPayload(
              synthesizePayload?.detail ?? synthesizePayload?.error ?? synthesizePayload?.message,
              `voice_synthesize_http_${synthesizeResponse.status}`
            )
          );
        }
      } catch (error_) {
        lastError = error_;
      }
    }

    try {
      const form = new FormData();
      form.append('text', String(text || '').slice(0, 4096));
      form.append('persona', persona);
      form.append('voiceStyle', voiceStyle);
      if (requestedReferenceId) form.append('voiceReferenceId', requestedReferenceId);
      if (body?.voiceReferenceName || body?.voiceReferenceLabel) {
        form.append('voiceReferenceName', String(body.voiceReferenceName || body.voiceReferenceLabel));
      }
      if (explicitReferenceFile?.filePath) {
        const referenceBuffer = fs.readFileSync(explicitReferenceFile.filePath);
        const referenceBlob = new Blob([referenceBuffer], { type: explicitReferenceFile.mimeType || 'audio/wav' });
        form.append('reference', referenceBlob, explicitReferenceFile.originalName || `${explicitReferenceFile.label || 'reference'}.wav`);
      }
      form.append('styleInstruction', buildVoicePersonaInstruction(persona));
      form.append('mode', vocalMode || 'adaptive');
      form.append('engine', String(body?.voiceConversionEngine || body?.conversionEngine || body?.engine || body?.voiceEngine || 'auto').trim() || 'auto');
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
        const referenceSource = String(response.headers?.get?.('x-a11-reference-source') || '').trim().toLowerCase();
        if (isDjeffRapVoiceStyle(voiceStyle) && explicitReferenceFile && referenceSource !== 'upload') {
          throw new Error('djeff_rap_reference_not_applied');
        }
        const extension = audioExtensionFromContentType(contentType, audioFormat || 'wav');
        const audioUrl = await saveProviderAudioBufferForFormat(
          Buffer.from(await response.arrayBuffer()),
          'xtts-rvc',
          audioFormat || extension,
          contentType
        );
        if (!audioUrl) throw new Error('xtts_rvc_empty_audio');
        const rvcModel = response.headers?.get?.('x-a11-rvc-model') || '';
        const rvcIndex = response.headers?.get?.('x-a11-rvc-index') || '';
        return {
          success: true,
          provider: PROVIDERS.XTTS_RVC,
          via: 'xtts-rvc-direct',
          text,
          vocalMode,
          audioFormat: /\.mp3(?:[?#].*)?$/i.test(audioUrl) ? 'mp3' : extension,
          audio_url: audioUrl,
          audioUrl,
          providerCapabilities: { referenceVoice: true },
          voiceConversion: {
            ok: true,
            module: 'funesterie-xtts-rvc-bridge',
            provider: PROVIDERS.XTTS_RVC,
            engine: response.headers?.get?.('x-a11-voice-engine') || 'xtts-rvc',
            voiceStyle: response.headers?.get?.('x-a11-voice-style') || voiceStyle || null,
            referenceSource: referenceSource || null,
            rvcModel: rvcModel || null,
            rvcIndex: rvcIndex || null,
            direction: buildVoicePersonaInstruction(persona),
            attemptedEngines: [PROVIDERS.XTTS_RVC],
            reference: serializeVoiceReferenceForPayload(explicitReferenceFile, voiceStyle),
          },
        };
      }

      const textBody = await response.text();
      const parsed = parseJsonMaybe(textBody);
      if (!response.ok || parsed?.ok === false) {
        throw new Error(errorMessageFromPayload(parsed?.detail ?? parsed?.message ?? parsed?.error, `xtts_rvc_http_${response.status}`));
      }
      const rawAudioUrl = parsed?.audio_url || parsed?.audioUrl || parsed?.url || '';
      const remoteAudioUrl = normalizeRemoteAssetUrl(baseUrl, rawAudioUrl);
      if (!remoteAudioUrl) throw new Error('xtts_rvc_missing_audio_url');
      const sourceAudioUrl = resolveRemoteTtsAssetFetchUrl(baseUrl, rawAudioUrl) || remoteAudioUrl;
      const materializedAudioUrl = await materializeTtsAudioUrlForFormat(sourceAudioUrl, audioFormat, 'xtts-rvc');
      const finalAudioUrl = materializedAudioUrl || remoteAudioUrl;
      return {
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
        success: true,
        provider: PROVIDERS.XTTS_RVC,
        via: parsed?.via || 'xtts-rvc-direct',
        text,
        vocalMode,
        audioFormat: materializedAudioUrl ? 'mp3' : audioExtensionFromContentType('', path.extname(new URL(finalAudioUrl, 'http://127.0.0.1').pathname).slice(1) || audioFormat || 'wav'),
        originalAudioUrl: materializedAudioUrl ? remoteAudioUrl : undefined,
        original_audio_url: materializedAudioUrl ? remoteAudioUrl : undefined,
        audio_url: finalAudioUrl,
        audioUrl: finalAudioUrl,
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
          reference: parsed?.voiceConversion?.reference
            || parsed?.voiceReference
            || serializeVoiceReferenceForPayload(explicitReferenceFile, voiceStyle),
        },
      };
    } catch (error_) {
      lastError = error_;
    }
  }

  throw lastError || new Error('xtts_rvc_unreachable');
}

async function requestDirectXttsRvcWithRetry(text, body = {}, options = {}) {
  return enqueueXttsRvcWork(async () => {
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
  });
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
  const explicitPersona = getExplicitTtsPersonaFromBody(body || {});
  const readyVoice = getReadyVoiceProfile(persona, PROVIDERS.OPENAI);
  const preferredVoiceStyle = getPreferredVoiceReferenceLabelFromBody(body || {}, persona);
  const reference = resolveVoiceReferenceForRequest({
    user: options.user || null,
    requestedId: String(body?.voiceReferenceId || body?.voiceRefId || body?.referenceId || '').trim(),
    preferredLabel: preferredVoiceStyle,
    includeCatalog: canUseSharedVoiceCatalog({ user: options.user || null }),
  });
  const officialPersonaStyleFallback = !reference
    && OFFICIAL_PERSONAS.has(explicitPersona)
    && wantsOfficialIdentityVoice(body);
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
  const voice = normalizeOpenAiTtsVoice(body?.openAiVoice || body?.ttsVoice || readyVoice?.openAiVoice || body?.voice, vocalMode);
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
    via: 'openai-tts',
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
            label: preferredVoiceStyle,
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
            return resolve({
              success: true,
              audioUrl: buildBackendTtsOutPath(`/out/${outFileName}`),
              model: path.basename(modelPath || ''),
            });
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
      references: listVoiceReferences({ user: req.user, includeCatalog: canUseSharedVoiceCatalog(req) }),
    });
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'voice_reference_list_failed',
      message: String(error_?.message || error_),
    });
  }
});

router.get('/tts/voice-catalog', requireJwt, (req, res) => {
  try {
    const canUse = canUseSharedVoiceCatalog(req);
    return res.json({
      ok: true,
      enabled: true,
      canUse,
      consent: VOICE_CATALOG_CONSENT,
      voices: canUse ? listVoiceCatalogReferences({ user: req.user }) : [],
      message: canUse
        ? 'Catalogue voix disponible pour les usages consentis.'
        : 'Catalogue voix reserve aux comptes Premium, Fondateur, Famille ou Admin.',
    });
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'voice_catalog_list_failed',
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
    const requestedScope = req.body?.scope || 'private';
    if (isVoiceCatalogScope(requestedScope) && !canUseSharedVoiceCatalog(req)) {
      return res.status(403).json({
        ok: false,
        error: 'voice_catalog_premium_required',
        message: 'Publier une voix au catalogue chanson demande un compte Premium, Fondateur, Famille ou Admin.',
        consent: VOICE_CATALOG_CONSENT,
      });
    }

    const reference = saveVoiceReference({
      user: req.user,
      file,
      label: req.body?.label || req.body?.name || file.originalname,
      scope: requestedScope,
      catalogName: req.body?.catalogName || req.body?.voiceName || req.body?.publicName || req.body?.name || req.body?.label,
      consent: req.body?.consent || req.body?.voiceCatalogConsent || req.body?.contract || '',
    });

    return res.status(201).json({
      ok: true,
      reference,
      consent: VOICE_CATALOG_CONSENT,
      references: listVoiceReferences({ user: req.user, includeCatalog: canUseSharedVoiceCatalog(req) }),
    });
  } catch (error_) {
    const message = String(error_?.message || error_);
    if (error_?.code === 'account_storage_quota_exceeded') {
      return res.status(error_?.status || 413).json(buildStorageQuotaPayload(error_));
    }
    const status = Number(error_?.status || 0)
      || (message.startsWith('unsupported_audio_type') ? 415 : 500);
    return res.status(status).json({
      ok: false,
      error: status === 415 ? 'unsupported_audio_type' : (error_?.code || 'voice_reference_save_failed'),
      message,
      consent: VOICE_CATALOG_CONSENT,
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

router.get('/tts/official/:persona/audio', (req, res) => {
  setTtsCorsHeaders(req, res);
  try {
    if (Object.keys(req.query || {}).length > 0) {
      res.setHeader('X-A11-Voice-Sample', 'static');
      return res.redirect(302, `${req.baseUrl || ''}${req.path}`);
    }
    const sample = resolveOfficialVoiceSample(req.params?.persona);
    if (!sample?.filePath) {
      return res.status(404).json({
        ok: false,
        error: 'official_voice_sample_not_found',
        message: 'Reference vocale officielle indisponible sur ce runtime.',
      });
    }
    res.setHeader('Content-Type', sample.reference?.mimeType || contentTypeForTtsAsset(sample.filePath));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-A11-Voice-Persona', sample.persona);
    res.setHeader('X-A11-Voice-Sample', 'static');
    return res.sendFile(sample.filePath);
  } catch (error_) {
    return res.status(500).json({
      ok: false,
      error: 'official_voice_sample_read_failed',
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
      references: listVoiceReferences({ user: req.user, includeCatalog: canUseSharedVoiceCatalog(req) }),
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
      ? findVoiceReference({ user: req.user, id: referenceId, includePath: true, includeCatalog: canUseSharedVoiceCatalog(req) })
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

function normalizeOfficialVoiceSamplePersona(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['a11', 'alphaonze', 'alpha-onze', 'a-11'].includes(normalized)) return 'a11';
  if (['djeff', 'jeff', 'jeffrey', 'djeff-rap', 'pignon', 'pignon-rap'].includes(normalized)) return 'djeff';
  if (['k44', 'kaen44', 'kaen'].includes(normalized)) return 'kaen44';
  if (['vivy', 'vivy-one', 'vivy_one'].includes(normalized)) return 'vivy';
  return '';
}

function resolveOfficialVoiceSample(persona = '') {
  const normalized = normalizeOfficialVoiceSamplePersona(persona);
  const expectedFile = OFFICIAL_VOICE_SAMPLE_FILES[normalized];
  if (!expectedFile) return null;

  const references = listLibraryVoiceReferences({ includePath: true });
  const match = references.find((reference) => (
    String(reference?.originalName || '').toLowerCase() === expectedFile
    || path.basename(String(reference?.filePath || '')).toLowerCase() === expectedFile
  ));
  if (!match?.filePath || !fs.existsSync(match.filePath)) return null;
  return {
    persona: normalized,
    filePath: match.filePath,
    reference: match,
  };
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
  const requestedProvider = getRequestedTtsProvider(body);
  const explicitLegacyBridge = requestedProvider === PROVIDERS.XTTS_RVC && allowsXttsRvcForBody(body);
  const requestedLocalReference = (requestedProvider === 'auto' || !requestedProvider)
    && (allowsXttsRvcForBody(body) || wantsSpecificLocalVoiceReference(body));
  const requestedCloudProvider = isCloudTtsProvider(requestedProvider)
    ? requestedProvider
    : '';
  const defaultProvider = getDefaultVoiceProviderForPersona('vivy');
  const provider = explicitLegacyBridge
    ? PROVIDERS.XTTS_RVC
    : (requestedLocalReference
      ? PROVIDERS.XTTS_RVC
      : (requestedCloudProvider || (isProviderRuntimeConfigured(defaultProvider) ? defaultProvider : PROVIDERS.XTTS_RVC)));
  const useXttsBridge = provider === PROVIDERS.XTTS_RVC;
  return {
    ...body,
    text,
    voice: body.voice || 'vivy',
    provider,
    ttsProvider: provider,
    persona: body.persona || 'vivy',
    voicePersona: body.voicePersona || 'vivy',
    surface: body.surface || 'vivy',
    vocalMode: body.vocalMode || (isSong ? 'sing' : 'adaptive'),
    voiceConversion: useXttsBridge ? (body.voiceConversion ?? true) : false,
    convertVoice: useXttsBridge ? (body.convertVoice ?? true) : false,
    morphVoice: useXttsBridge ? (body.morphVoice ?? true) : false,
    rvc: useXttsBridge ? (body.rvc ?? true) : false,
    allowRvc: useXttsBridge,
    allowXttsRvc: useXttsBridge,
    allowLegacyVoiceBridge: useXttsBridge,
    xttsRvcOptIn: useXttsBridge,
    useDefaultVoiceReference: body.useDefaultVoiceReference ?? !body.voiceReferenceId,
    defaultVoiceReference: body.defaultVoiceReference ?? !body.voiceReferenceId,
    voiceReferenceRequired: useXttsBridge ? (body.voiceReferenceRequired ?? true) : (body.voiceReferenceRequired ?? false),
    referenceVoiceRequired: useXttsBridge ? (body.referenceVoiceRequired ?? true) : (body.referenceVoiceRequired ?? false),
    allowBrowserSpeechFallback: false,
    disableLocalGpuWorker: body.disableLocalGpuWorker ?? true,
    audioFormat: normalizeTtsAudioFormat(body, 'mp3'),
    responseFormat: normalizeTtsAudioFormat(body, 'mp3'),
    voiceConversionStrength: vivyVoiceStrength,
    strength: vivyVoiceStrength,
    f0Shift: vivyF0Shift,
    jobKind: body.jobKind || (isSong ? 'vivy.song.official-tts' : 'vivy.official-tts'),
  };
}

function escapeSsmlText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getCartesiaTtsBaseUrl() {
  return String(
    process.env.A11_CARTESIA_BASE_URL
    || process.env.CARTESIA_BASE_URL
    || 'https://api.cartesia.ai'
  ).trim().replace(/\/$/, '');
}

function getElevenLabsTtsBaseUrl() {
  return String(
    process.env.A11_ELEVENLABS_BASE_URL
    || process.env.ELEVENLABS_BASE_URL
    || 'https://api.elevenlabs.io/v1'
  ).trim().replace(/\/$/, '');
}

function resolveCartesiaVoiceId(persona, body = {}) {
  const profile = getReadyVoiceProfile(persona, PROVIDERS.CARTESIA);
  return String(
    body?.cartesiaVoiceId
    || body?.cartesia_voice_id
    || body?.providerVoiceId
    || getPersonaScopedEnvValue('A11_CARTESIA', persona, ['VOICE_ID', 'VOICE'])
    || getPersonaScopedEnvValue('CARTESIA', persona, ['VOICE_ID', 'VOICE'])
    || getPersonaScopedEnvValue('A11_TTS', persona, ['VOICE_ID'])
    || profile?.cartesiaVoiceId
    || ''
  ).trim();
}

function resolveElevenLabsVoiceId(persona, body = {}) {
  const profile = getReadyVoiceProfile(persona, PROVIDERS.ELEVENLABS);
  return String(
    body?.elevenLabsVoiceId
    || body?.elevenlabsVoiceId
    || body?.elevenlabs_voice_id
    || body?.providerVoiceId
    || getPersonaScopedEnvValue('A11_ELEVENLABS', persona, ['VOICE_ID', 'VOICE'])
    || getPersonaScopedEnvValue('ELEVENLABS', persona, ['VOICE_ID', 'VOICE'])
    || getPersonaScopedEnvValue('A11_TTS', persona, ['ELEVENLABS_VOICE_ID'])
    || profile?.elevenLabsVoiceId
    || ''
  ).trim();
}

function resolveAzureVoiceName(persona, body = {}) {
  const profile = getReadyVoiceProfile(persona, PROVIDERS.AZURE);
  return String(
    body?.azureVoice
    || body?.azureVoiceName
    || body?.speechVoice
    || body?.speechVoiceName
    || getPersonaScopedEnvValue('A11_AZURE', persona, ['VOICE', 'VOICE_NAME'])
    || getPersonaScopedEnvValue('AZURE', persona, ['VOICE', 'VOICE_NAME'])
    || getPersonaScopedEnvValue('A11_TTS', persona, ['AZURE_VOICE'])
    || profile?.azureVoice
    || ''
  ).trim();
}

function contentTypeForGeneratedFormat(format = 'mp3') {
  return normalizeTtsAudioFormat({ audioFormat: format }, 'mp3') === 'wav'
    ? 'audio/wav'
    : 'audio/mpeg';
}

function buildReadyVoicePayloadMeta(provider, persona, voice, audioFormat) {
  const profile = getReadyVoiceProfile(persona, provider);
  return {
    persona,
    voiceReference: {
      id: getOfficialVoiceStyleId(persona),
      label: getOfficialVoiceStyleLabel(persona, provider),
      scope: 'ready-made-provider',
      provider,
    },
    referenceVoice: {
      ok: true,
      mode: 'ready-made-provider',
      provider,
      voice,
    },
    providerCapabilities: {
      referenceVoice: true,
      readyMadeVoice: true,
      styleVoice: true,
      voiceLabel: profile?.label || profile?.displayName || null,
    },
    audioFormat,
    content_type: contentTypeForGeneratedFormat(audioFormat),
  };
}

async function requestElevenLabsTts(text, body = {}, options = {}) {
  const apiKey = getElevenLabsTtsApiKey();
  if (!apiKey) throw new Error('elevenlabs_tts_key_missing');

  const vocalMode = normalizeVocalMode({ ...(body || {}), ...(options || {}) });
  const persona = getTtsPersonaFromBody(body || {}, options?.persona || options?.surface || '');
  const voiceId = resolveElevenLabsVoiceId(persona, body);
  if (!voiceId) throw new Error('elevenlabs_voice_id_missing');

  const audioFormat = normalizeTtsAudioFormat(body, 'mp3');
  const outputFormat = audioFormat === 'wav' ? 'pcm_44100' : 'mp3_44100_128';
  const model = String(
    body?.elevenLabsModel
    || body?.elevenlabsModel
    || body?.ttsModel
    || process.env.A11_ELEVENLABS_MODEL
    || process.env.ELEVENLABS_MODEL
    || 'eleven_multilingual_v2'
  ).trim();
  const stability = Number(body?.elevenLabsStability ?? process.env.A11_ELEVENLABS_STABILITY ?? 0.54);
  const similarityBoost = Number(body?.elevenLabsSimilarityBoost ?? process.env.A11_ELEVENLABS_SIMILARITY_BOOST ?? 0.72);
  const style = Number(body?.elevenLabsStyle ?? process.env.A11_ELEVENLABS_STYLE ?? (vocalMode === 'sing' ? 0.18 : 0.08));
  const useSpeakerBoost = parseOptionalBoolean(
    body?.elevenLabsUseSpeakerBoost ?? process.env.A11_ELEVENLABS_USE_SPEAKER_BOOST,
    true
  );

  const response = await fetch(`${getElevenLabsTtsBaseUrl()}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: String(text || '').slice(0, 5000),
      model_id: model,
      language_code: String(body?.language || body?.ttsLanguage || 'fr').slice(0, 12),
      voice_settings: {
        stability: Number.isFinite(stability) ? Math.max(0, Math.min(1, stability)) : 0.54,
        similarity_boost: Number.isFinite(similarityBoost) ? Math.max(0, Math.min(1, similarityBoost)) : 0.72,
        style: Number.isFinite(style) ? Math.max(0, Math.min(1, style)) : 0.08,
        use_speaker_boost: useSpeakerBoost !== false,
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.ELEVENLABS_TTS_TIMEOUT_MS || 22000) || 22000),
  });

  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    throw new Error(`elevenlabs_tts_http_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('elevenlabs_tts_empty_audio');
  const audioUrl = saveProviderAudioBuffer(audioBuffer, PROVIDERS.ELEVENLABS, audioFormat);
  return {
    success: true,
    provider: PROVIDERS.ELEVENLABS,
    via: 'elevenlabs-tts',
    model,
    voice: voiceId,
    ...buildReadyVoicePayloadMeta(PROVIDERS.ELEVENLABS, persona, voiceId, audioFormat),
    audioUrl,
    audio_url: audioUrl,
  };
}

async function requestCartesiaTts(text, body = {}, options = {}) {
  const apiKey = getCartesiaTtsApiKey();
  if (!apiKey) throw new Error('cartesia_tts_key_missing');

  const vocalMode = normalizeVocalMode({ ...(body || {}), ...(options || {}) });
  const persona = getTtsPersonaFromBody(body || {}, options?.persona || options?.surface || '');
  const voiceId = resolveCartesiaVoiceId(persona, body);
  if (!voiceId) throw new Error('cartesia_voice_id_missing');

  const audioFormat = normalizeTtsAudioFormat(body, 'mp3');
  const outputFormat = audioFormat === 'wav'
    ? { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 }
    : { container: 'mp3', bit_rate: 128000, sample_rate: 44100 };
  const model = String(
    body?.cartesiaModel
    || body?.ttsModel
    || process.env.A11_CARTESIA_MODEL
    || process.env.CARTESIA_MODEL
    || 'sonic-3'
  ).trim();
  const response = await fetch(`${getCartesiaTtsBaseUrl()}/tts/bytes`, {
    method: 'POST',
    headers: {
      'Cartesia-Version': String(process.env.A11_CARTESIA_VERSION || process.env.CARTESIA_VERSION || '2026-03-01').trim(),
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model_id: model,
      transcript: String(text || '').slice(0, 4096),
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: outputFormat,
      language: String(body?.language || body?.ttsLanguage || 'fr').slice(0, 12),
      speed: vocalMode === 'sing' ? 'slow' : undefined,
    }),
    signal: AbortSignal.timeout(Number(process.env.CARTESIA_TTS_TIMEOUT_MS || 18000) || 18000),
  });

  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    throw new Error(`cartesia_tts_http_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('cartesia_tts_empty_audio');
  const audioUrl = saveProviderAudioBuffer(audioBuffer, PROVIDERS.CARTESIA, audioFormat);
  return {
    success: true,
    provider: PROVIDERS.CARTESIA,
    via: 'cartesia-tts',
    model,
    voice: voiceId,
    ...buildReadyVoicePayloadMeta(PROVIDERS.CARTESIA, persona, voiceId, audioFormat),
    audioUrl,
    audio_url: audioUrl,
  };
}

async function requestAzureTts(text, body = {}, options = {}) {
  const apiKey = getAzureSpeechKey();
  const endpoint = getAzureSpeechEndpoint();
  if (!apiKey) throw new Error('azure_tts_key_missing');
  if (!endpoint) throw new Error('azure_tts_endpoint_missing');

  const vocalMode = normalizeVocalMode({ ...(body || {}), ...(options || {}) });
  const persona = getTtsPersonaFromBody(body || {}, options?.persona || options?.surface || '');
  const voice = resolveAzureVoiceName(persona, body);
  if (!voice) throw new Error('azure_voice_missing');

  const audioFormat = normalizeTtsAudioFormat(body, 'mp3');
  const outputFormat = audioFormat === 'wav'
    ? 'riff-24khz-16bit-mono-pcm'
    : 'audio-24khz-96kbitrate-mono-mp3';
  const rate = vocalMode === 'sing' ? 'slow' : 'medium';
  const ssml = [
    '<speak version="1.0" xml:lang="fr-FR" xmlns="http://www.w3.org/2001/10/synthesis">',
    `<voice name="${escapeSsmlText(voice)}">`,
    `<prosody rate="${rate}">${escapeSsmlText(String(text || '').slice(0, 4096))}</prosody>`,
    '</voice>',
    '</speak>',
  ].join('');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': outputFormat,
      'User-Agent': 'Funesterie-A11-TTS',
    },
    body: ssml,
    signal: AbortSignal.timeout(Number(process.env.AZURE_TTS_TIMEOUT_MS || 18000) || 18000),
  });

  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    throw new Error(`azure_tts_http_${response.status}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (!audioBuffer.length) throw new Error('azure_tts_empty_audio');
  const audioUrl = saveProviderAudioBuffer(audioBuffer, PROVIDERS.AZURE, audioFormat);
  return {
    success: true,
    provider: PROVIDERS.AZURE,
    via: 'azure-speech-tts',
    voice,
    ...buildReadyVoicePayloadMeta(PROVIDERS.AZURE, persona, voice, audioFormat),
    audioUrl,
    audio_url: audioUrl,
  };
}

router.options(['/tts/piper', '/tts/speak', '/tts/jobs/:jobId', '/vivy/jobs', '/vivy/jobs/:jobId', '/tts/out/:filename'], (req, res) => {
  setTtsCorsHeaders(req, res);
  return res.status(204).end();
});

async function handleTtsSpeakRequest(req, res) {
  try {
    const requestBody = normalizeA11OfficialReferenceRequest(enforceBasicTtsCostPolicy(req, req.body || {}));
    req.body = requestBody;
    const text = String(requestBody?.text || '').trim();
    const vocalMode = normalizeVocalMode(requestBody || {});
    const readableText = shapeTextForVocalMode(buildTtsReadableText(text), vocalMode);
    const voice = resolveVoiceForRequest(requestBody || {});
    const preferHttpTts = shouldPreferHttpTts();

    if (!readableText) {
      return res.status(400).json({ error: 'missing_text' });
    }

    let remoteError = null;
    let preparedBody = {
      ...(requestBody || {}),
      text: readableText,
      voice,
      model: voice || requestBody?.model,
      vocalMode,
    };
    preparedBody = normalizeA11OfficialReferenceRequest(preparedBody);
    req.body = preparedBody;
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
      if (strictOfficialVoice && isFfmpegMorphVoicePayload(payload)) {
        return res.status(424).json({
          ok: false,
          error: 'voice_reference_tts_unavailable',
          message: 'Voix officielle indisponible: le runtime a propose un fallback ffmpeg-morph au lieu du moteur identitaire. La fausse voix est bloquee.',
          provider: PROVIDERS.XTTS_RVC,
          diagnostic: 'official_ffmpeg_morph_blocked',
          voiceConversion: payload?.voiceConversion || null,
        });
      }
      if (requiresReferenceVoice(req) && !hasUsableReferenceVoicePayload(payload)) {
        return res.status(424).json(buildReferenceVoiceUnavailablePayload(payload));
      }
      return sendTtsPayloadResponse(req, res, payload);
    };
    const cloudProviderOrder = getCloudTtsProviderOrder(preparedBody, resolvedProvider);
    for (const provider of cloudProviderOrder) {
      try {
        const cloudTts = await requestCloudTtsProvider(provider, readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(cloudTts.audioUrl || cloudTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...cloudTts,
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (cloudTtsError) {
        const message = String(cloudTtsError?.message || cloudTtsError);
        if (provider === PROVIDERS.OPENAI) openAiTtsErrorMessage = message;
        console.warn(`[TTS][${provider}] ready-made voice failed:`, message);
        if (strictOfficialVoice && getRequestedTtsProvider(preparedBody) === provider) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: `Voix officielle indisponible: ${provider} n'a pas produit la voix demandee.`,
            provider,
            diagnostic: `${provider}_tts_failed`,
          });
        }
      }
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

    if (strictOfficialVoice && isNeutralTtsProvider(resolvedProvider.provider)) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider identitaire n’a produit d’audio. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: 'neutral_provider_blocked',
      });
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

function runInternalTtsAsyncJob(job, req, headers) {
  setImmediate(() => {
    Promise.resolve().then(async () => {
      job.state = 'running';
      job.startedAt = job.startedAt || Date.now();
      const capture = createTtsJobResponseCapture(job);
      const internalReq = {
        ...req,
        body: job.body,
        headers,
        user: req.user || null,
      };
      await handleTtsSpeakRequest(internalReq, capture);
      if (job.state === 'running' || job.state === 'queued' || job.state === 'leased') {
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
}

function scheduleLocalGpuWorkerFallback(job, req, headers) {
  const fallbackMs = getLocalGpuWorkerFallbackMs();
  if (!fallbackMs) return;
  const timer = setTimeout(() => {
    if (job.state !== 'queued' || job.worker !== 'local-gpu') return;
    job.workerFallbackAt = Date.now();
    job.workerFallbackReason = 'local_gpu_worker_not_claimed';
    runInternalTtsAsyncJob(job, req, headers);
  }, fallbackMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function startTtsAsyncJob(req, res, options = {}) {
  pruneTtsAsyncJobs();
  const queueMax = getTtsAsyncQueueMax();
  const activeJobs = Array.from(ttsAsyncJobs.values()).filter(isActiveTtsAsyncJob).length;
  if (activeJobs >= queueMax) {
    return res.status(429).json({
      ok: false,
      error: 'tts_async_queue_saturated',
      message: 'La file voix est pleine, reessaie dans quelques instants.',
      queue: buildTtsQueueSnapshot(),
    });
  }
  const requestBody = normalizeA11OfficialReferenceRequest(enforceBasicTtsCostPolicy(req, req.body || {}));
  req.body = requestBody;
  const body = buildAsyncTtsJobBody(requestBody);
  const routeToLocalGpu = shouldRouteTtsJobToLocalGpuWorker(body);
  const priorityLane = resolveTtsPriorityLane(req, body);
  const job = {
    id: createTtsAsyncJobId(),
    kind: String(options.kind || body.jobKind || body.kind || 'tts.speak').trim() || 'tts.speak',
    queue: String(options.queue || body.queue || 'media.audio').trim() || 'media.audio',
    priorityTier: priorityLane.tier,
    priorityScore: priorityLane.score,
    priorityLabel: priorityLane.label,
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
    worker: routeToLocalGpu ? 'local-gpu' : 'server',
    workerId: null,
    leasedAt: null,
    workerFallbackAt: null,
    workerFallbackReason: null,
  };
  ttsAsyncJobs.set(job.id, job);

  const headers = { ...(req.headers || {}), 'x-a11-internal-tts-job': '1' };
  if (routeToLocalGpu) {
    scheduleLocalGpuWorkerFallback(job, req, headers);
  } else {
    runInternalTtsAsyncJob(job, req, headers);
  }

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

router.get('/tts/queue/status', runOptionalJwt, (req, res) => {
  setTtsCorsHeaders(req, res);
  pruneTtsAsyncJobs();
  return res.json({
    ok: true,
    ...buildTtsQueueSnapshot(),
  });
});

router.post('/vivy/jobs', runOptionalJwt, async (req, res) => {
  setTtsCorsHeaders(req, res);
  const body = buildVivyTtsJobBody(req.body || {});
  if (!body.text) {
    return res.status(400).json({ ok: false, error: 'missing_text' });
  }
  req.body = body;
  return startTtsAsyncJob(req, res, {
    kind: body.jobKind || 'vivy.official-tts',
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

router.post('/tts/local-worker/heartbeat', express.json({ limit: '16kb' }), requireLocalGpuWorkerAuth, (req, res) => {
  pruneTtsAsyncJobs();
  const workerId = String(req.body?.workerId || req.body?.id || 'local-gpu-worker').trim().slice(0, 120) || 'local-gpu-worker';
  const claimable = findClaimableLocalGpuWorkerJob();
  const snapshot = buildTtsQueueSnapshot();
  return res.json({
    ok: true,
    enabled: localGpuWorkerEnabled(),
    workerId,
    queueDepth: snapshot.localGpu.queued,
    active: snapshot.localGpu.active,
    leased: snapshot.localGpu.leased,
    maxActive: snapshot.localGpu.maxActive,
    availableSlots: snapshot.localGpu.availableSlots,
    staleLeases: snapshot.localGpu.staleLeases,
    xttsRvc: snapshot.xttsRvc,
    nextJobId: claimable?.id || null,
  });
});

router.post('/tts/local-worker/claim', express.json({ limit: '16kb' }), requireLocalGpuWorkerAuth, (req, res) => {
  pruneTtsAsyncJobs();
  if (!localGpuWorkerEnabled()) {
    return res.json({ ok: true, enabled: false, job: null, pollIntervalMs: 2500 });
  }
  const activeLeases = countLocalGpuWorkerLeases();
  const maxActive = getLocalGpuWorkerMaxActive();
  if (activeLeases >= maxActive) {
    const snapshot = buildTtsQueueSnapshot();
    return res.json({
      ok: true,
      enabled: true,
      job: null,
      backpressure: true,
      reason: 'local_gpu_worker_busy',
      pollIntervalMs: 1500,
      queueDepth: snapshot.localGpu.queued,
      leased: snapshot.localGpu.leased,
      maxActive,
      availableSlots: snapshot.localGpu.availableSlots,
    });
  }
  const job = findClaimableLocalGpuWorkerJob();
  if (!job) {
    const snapshot = buildTtsQueueSnapshot();
    return res.json({
      ok: true,
      enabled: true,
      job: null,
      pollIntervalMs: 1500,
      queueDepth: snapshot.localGpu.queued,
      leased: snapshot.localGpu.leased,
      maxActive,
      availableSlots: snapshot.localGpu.availableSlots,
    });
  }
  job.state = 'leased';
  job.startedAt = job.startedAt || Date.now();
  job.leasedAt = Date.now();
  job.workerId = String(req.body?.workerId || req.body?.id || 'local-gpu-worker').trim().slice(0, 120) || 'local-gpu-worker';
  return res.json({
    ok: true,
    enabled: true,
    leaseMs: getLocalGpuWorkerLeaseMs(),
    maxActive,
    activeLeases: countLocalGpuWorkerLeases(),
    job: publicLocalGpuWorkerJob(job),
  });
});

router.post('/tts/local-worker/jobs/:jobId/complete', express.json({ limit: '80mb' }), requireLocalGpuWorkerAuth, async (req, res) => {
  pruneTtsAsyncJobs();
  const jobId = String(req.params?.jobId || '').trim();
  const job = ttsAsyncJobs.get(jobId);
  if (!job || job.worker !== 'local-gpu') {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  if (!['queued', 'leased', 'running'].includes(job.state)) {
    return res.status(409).json({ ok: false, error: 'tts_job_not_active', state: job.state });
  }

  const rawBase64 = String(req.body?.audioBase64 || req.body?.audio_base64 || '').replace(/^data:[^;]+;base64,/i, '').trim();
  if (!rawBase64) {
    return res.status(400).json({ ok: false, error: 'missing_audio_base64' });
  }

  let audioBuffer = null;
  try {
    audioBuffer = Buffer.from(rawBase64, 'base64');
  } catch {
    audioBuffer = null;
  }
  if (!audioBuffer?.length) {
    return res.status(400).json({ ok: false, error: 'invalid_audio_base64' });
  }

  const contentType = String(req.body?.contentType || req.body?.content_type || 'audio/wav').trim() || 'audio/wav';
  const requestedFormat = normalizeTtsAudioFormat(job.body || {}, audioExtensionFromContentType(contentType, 'wav'));
  const audioUrl = await saveProviderAudioBufferForFormat(
    audioBuffer,
    'local-gpu-xtts-rvc',
    requestedFormat,
    contentType
  );
  if (!audioUrl) {
    return res.status(500).json({ ok: false, error: 'audio_materialize_failed' });
  }

  const result = {
    ok: true,
    success: true,
    provider: PROVIDERS.XTTS_RVC,
    via: 'local-gpu-worker',
    worker: 'local-gpu',
    workerId: job.workerId || String(req.body?.workerId || req.body?.id || '').trim() || null,
    audioUrl,
    audio_url: audioUrl,
    audioFormat: /\.mp3(?:[?#].*)?$/i.test(audioUrl) ? 'mp3' : audioExtensionFromContentType(contentType, requestedFormat),
    contentType,
    vocalMode: job.body?.vocalMode || null,
    voiceConversion: {
      ok: true,
      provider: PROVIDERS.XTTS_RVC,
      engine: req.body?.engine || req.body?.voiceEngine || 'local-gpu-xtts-rvc',
      voiceStyle: req.body?.voiceStyle || req.body?.voice_style || null,
      rvcModel: req.body?.rvcModel || req.body?.rvc_model || null,
      rvcIndex: req.body?.rvcIndex || req.body?.rvc_index || null,
      attemptedEngines: Array.isArray(req.body?.attemptedEngines) ? req.body.attemptedEngines : ['local-gpu-xtts-rvc'],
    },
    providerCapabilities: {
      referenceVoice: true,
      styleVoice: true,
      localGpu: true,
    },
  };

  job.result = result;
  job.state = 'done';
  job.statusCode = 200;
  job.finishedAt = Date.now();
  job.error = null;
  job.message = null;
  return res.json(publicTtsAsyncJob(job));
});

router.post('/tts/local-worker/jobs/:jobId/fail', express.json({ limit: '64kb' }), requireLocalGpuWorkerAuth, (req, res) => {
  pruneTtsAsyncJobs();
  const jobId = String(req.params?.jobId || '').trim();
  const job = ttsAsyncJobs.get(jobId);
  if (!job || job.worker !== 'local-gpu') {
    return res.status(404).json({ ok: false, error: 'tts_job_not_found' });
  }
  job.localGpuFailure = {
    at: Date.now(),
    workerId: job.workerId || String(req.body?.workerId || req.body?.id || '').trim() || null,
    error: String(req.body?.error || 'local_gpu_worker_failed').slice(0, 120),
    message: String(req.body?.message || req.body?.error || 'Le worker GPU local n’a pas produit l’audio.').slice(0, 800),
  };
  fallbackLocalGpuJobToServer(job, job.localGpuFailure.error);
  return res.json(publicTtsAsyncJob(job));
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
  return res.sendFile(localPath);
});

router.post(['/tts/piper', '/tts/speak'], runOptionalJwt, async (req, res) => {
  setTtsCorsHeaders(req, res);
  const requestBody = normalizeA11OfficialReferenceRequest(enforceBasicTtsCostPolicy(req, req.body || {}));
  req.body = requestBody;
  if (wantsAsyncTtsJob(requestBody) && String(req.headers?.['x-a11-internal-tts-job'] || '') !== '1') {
    return startTtsAsyncJob(req, res);
  }
  try {
    const text = String(requestBody?.text || '').trim();
    const vocalMode = normalizeVocalMode(requestBody || {});
    const readableText = shapeTextForVocalMode(buildTtsReadableText(text), vocalMode);
    const voice = resolveVoiceForRequest(requestBody || {});
    const preferHttpTts = shouldPreferHttpTts();

    if (!readableText) {
      return res.status(400).json({ error: 'missing_text' });
    }

    let remoteError = null;
    let preparedBody = {
      ...(requestBody || {}),
      text: readableText,
      voice,
      model: voice || requestBody?.model,
      vocalMode,
    };
    preparedBody = normalizeA11OfficialReferenceRequest(preparedBody);
    req.body = preparedBody;
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
      if (strictOfficialVoice && isFfmpegMorphVoicePayload(payload)) {
        return res.status(424).json({
          ok: false,
          error: 'voice_reference_tts_unavailable',
          message: 'Voix officielle indisponible: le runtime a propose un fallback ffmpeg-morph au lieu du moteur identitaire. La fausse voix est bloquee.',
          provider: PROVIDERS.XTTS_RVC,
          diagnostic: 'official_ffmpeg_morph_blocked',
          voiceConversion: payload?.voiceConversion || null,
        });
      }
      if (requiresReferenceVoice(req) && !hasUsableReferenceVoicePayload(payload)) {
        return res.status(424).json(buildReferenceVoiceUnavailablePayload(payload));
      }
      return sendTtsPayloadResponse(req, res, payload);
    };
    const cloudProviderOrder = getCloudTtsProviderOrder(preparedBody, resolvedProvider);
    for (const provider of cloudProviderOrder) {
      try {
        const cloudTts = await requestCloudTtsProvider(provider, readableText, preparedBody, {
          vocalMode,
          persona: preparedBody.voicePersona || preparedBody.ttsPersona || preparedBody.persona || preparedBody.surface || null,
          user: req.user || null,
        });
        const absoluteAudioUrl = String(cloudTts.audioUrl || cloudTts.audio_url || '').trim();
        return sendFinalizedPayload({
          ...cloudTts,
          text: readableText,
          vocalMode,
          audio_url: absoluteAudioUrl || null,
          audioUrl: absoluteAudioUrl || null,
        });
      } catch (cloudTtsError) {
        const message = String(cloudTtsError?.message || cloudTtsError);
        if (provider === PROVIDERS.OPENAI) openAiTtsErrorMessage = message;
        console.warn(`[TTS][${provider}] ready-made voice failed:`, message);
        if (strictOfficialVoice && getRequestedTtsProvider(preparedBody) === provider) {
          return res.status(424).json({
            ok: false,
            error: 'voice_reference_tts_unavailable',
            message: `Voix officielle indisponible: ${provider} n'a pas produit la voix demandee.`,
            provider,
            diagnostic: `${provider}_tts_failed`,
          });
        }
      }
    }

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

    if (strictOfficialVoice && isNeutralTtsProvider(resolvedProvider.provider)) {
      return res.status(424).json({
        ok: false,
        error: 'voice_reference_tts_unavailable',
        message: 'Voix officielle indisponible: aucun provider identitaire n’a produit d’audio. Piper est bloque pour cette voix.',
        provider: resolvedProvider.provider || null,
        diagnostic: 'neutral_provider_blocked',
      });
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
