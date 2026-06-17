// --- Génération d'image via backend DALL·E ---
type A11GenerationSourceOptions = {
  sourceImageUrl?: string | null;
  provider?: string;
  videoProvider?: string;
  width?: number;
  height?: number;
  steps?: number;
  durationSeconds?: number;
  durationSec?: number;
  fps?: number;
  frameCount?: number;
  frames?: number;
  sdSteps?: number;
  guidanceScale?: number;
  timingMode?: string;
  autoTiming?: boolean;
  acceptAsyncVideoJob?: boolean;
  mobileAsync?: boolean;
  pollIntervalMs?: number;
  maxWaitMs?: number;
};

const FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY = "funesterie:session-app-tokens:v1";

function readSessionAppTokenMapForApi(): Record<string, string> {
  try {
    const storage = (globalThis as any)?.sessionStorage;
    if (!storage?.getItem) return {};
    const parsed = JSON.parse(storage.getItem(FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [String(key).trim().toLowerCase(), String(value || "").trim()])
        .filter(([key, value]) => Boolean(key && value))
    );
  } catch {
    return {};
  }
}

function normalizeVideoProviderName(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["grok", "grok-imagine", "xai", "x-ai"].includes(normalized)) return "xai";
  if (["hf", "hugging-face", "huggingface"].includes(normalized)) return "huggingface";
  if (["run-comfy", "runcomfy", "comfy", "comfyui", "comfy-ui"].includes(normalized)) return "runcomfy";
  return normalized;
}

function resolveSessionVideoProvider(tokens: Record<string, string>, requestedProvider = "") {
  const requested = normalizeVideoProviderName(requestedProvider);
  if (requested) return requested;
  if (tokens.xai || tokens.grok) return "xai";
  if (tokens.huggingface || tokens.hf) return "huggingface";
  if (tokens.runcomfy || tokens.comfy) return "runcomfy";
  if (tokens.replicate) return "replicate";
  return "";
}

function buildSessionVideoProviderHeaders(requestedProvider = "") {
  const tokens = readSessionAppTokenMapForApi();
  const provider = resolveSessionVideoProvider(tokens, requestedProvider);
  const headers: Record<string, string> = {};
  if (provider) headers["X-A11-Video-Provider"] = provider;
  const xaiToken = tokens.xai || tokens.grok;
  if (xaiToken) {
    headers["X-A11-XAI-Key"] = xaiToken;
    headers["X-A11-Grok-Key"] = xaiToken;
    headers["X-XAI-API-Key"] = xaiToken;
  }
  const hfToken = tokens.huggingface || tokens.hf;
  if (hfToken) {
    headers["X-A11-HF-Video-Key"] = hfToken;
    headers["X-HuggingFace-Token"] = hfToken;
  }
  const runComfyToken = tokens.runcomfy || tokens.comfy;
  if (runComfyToken) {
    headers["X-A11-RunComfy-Key"] = runComfyToken;
    headers["X-RunComfy-API-Key"] = runComfyToken;
  }
  if (tokens.civitai) headers["X-A11-Civitai-Key"] = tokens.civitai;
  if (tokens.replicate) headers["X-A11-Replicate-Key"] = tokens.replicate;
  return { provider, headers };
}

function isMobileLongTaskClient() {
  try {
    const win = globalThis as typeof globalThis & {
      innerWidth?: number;
      matchMedia?: (query: string) => { matches: boolean };
      navigator?: Navigator & { maxTouchPoints?: number; wakeLock?: any };
    };
    return Number(win.innerWidth || 0) <= 900
      || Boolean(win.matchMedia?.("(pointer: coarse)")?.matches)
      || Number(win.navigator?.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

async function acquireScreenWakeLock(maxHoldMs = 900000) {
  let sentinel: any = null;
  let released = false;
  const wakeLock = (globalThis as any)?.navigator?.wakeLock;
  if (!wakeLock || typeof wakeLock.request !== "function") {
    return async () => { };
  }

  const requestLock = async () => {
    try {
      sentinel = await wakeLock.request("screen");
      sentinel?.addEventListener?.("release", () => {
        sentinel = null;
      }, { once: true });
    } catch {
      sentinel = null;
    }
  };

  const onVisibilityChange = () => {
    if (!released && (globalThis as any)?.document?.visibilityState === "visible" && !sentinel) {
      void requestLock();
    }
  };

  await requestLock();
  (globalThis as any)?.document?.addEventListener?.("visibilitychange", onVisibilityChange);
  const timeoutId = globalThis.setTimeout(() => {
    void sentinel?.release?.();
    sentinel = null;
  }, Math.max(1000, maxHoldMs));

  return async () => {
    released = true;
    globalThis.clearTimeout(timeoutId);
    (globalThis as any)?.document?.removeEventListener?.("visibilitychange", onVisibilityChange);
    try {
      await sentinel?.release?.();
    } catch {
      // Best effort; some mobile browsers auto-release.
    }
    sentinel = null;
  };
}

async function withMobileLongTaskGuard<T>(maxWaitMs: number, task: () => Promise<T>): Promise<T> {
  const releaseWakeLock = await acquireScreenWakeLock(maxWaitMs);
  try {
    return await task();
  } finally {
    await releaseWakeLock();
  }
}

function resolveChatRequestTimeoutMs() {
  const raw = Number(
    import.meta.env?.VITE_A11_CHAT_REQUEST_TIMEOUT_MS
    || import.meta.env?.VITE_A11_CHAT_TIMEOUT_MS
    || 60_000
  );
  const resolved = Number.isFinite(raw) && raw > 0 ? raw : 60_000;
  return Math.max(10_000, Math.min(120_000, Math.round(resolved)));
}

export async function generatePngWithPrompt(
  prompt: string,
  options: A11GenerationSourceOptions = {}
): Promise<{ url: string, filename: string, prompt: string }> {
  const sourceImageUrl = String(options.sourceImageUrl || '').trim();
  const body: Record<string, any> = {
    prompt,
    width: options.width || 384,
    height: options.height || 384,
    num_inference_steps: options.steps || 2,
  };
  if (sourceImageUrl) {
    Object.assign(body, {
      sourceImageUrl,
      initImageUrl: sourceImageUrl,
      init_image_url: sourceImageUrl,
      referenceImageUrl: sourceImageUrl,
      reference_image_url: sourceImageUrl,
      strength: 0.34,
    });
  }
  const res = await fetch(getApiUrl('/api/tools/generate_sd'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Erreur génération image');
  return res.json();
}

export async function generateVideoWithPrompt(
  prompt: string,
  options: A11GenerationSourceOptions = {}
): Promise<{ ok?: boolean; url?: string; videoUrl?: string; video_url?: string; filename?: string; prompt?: string; raw?: any }> {
  const sourceImageUrl = String(options.sourceImageUrl || '').trim();
  const resolvePositiveNumber = (...values: Array<number | undefined>) => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
  };
  const durationSeconds = resolvePositiveNumber(options.durationSeconds, options.durationSec);
  const fps = resolvePositiveNumber(options.fps);
  const frameCount = resolvePositiveNumber(options.frameCount, options.frames);
  const width = resolvePositiveNumber(options.width);
  const height = resolvePositiveNumber(options.height);
  const sdSteps = resolvePositiveNumber(options.sdSteps, options.steps);
  const guidanceScale = resolvePositiveNumber(options.guidanceScale);
  const requestedProvider = normalizeVideoProviderName(options.videoProvider || options.provider || "");
  const sessionVideoAuth = buildSessionVideoProviderHeaders(requestedProvider);
  const hasManualTiming = Boolean(durationSeconds || fps || frameCount);
  const mobileAsync = options.mobileAsync ?? isMobileLongTaskClient();
  const maxWaitMs = Math.max(
    60000,
    Math.min(3600000, Math.round(Number(options.maxWaitMs || (mobileAsync ? 900000 : 600000)) || 600000))
  );
  const pollIntervalMs = Math.max(
    1000,
    Math.min(30000, Math.round(Number(options.pollIntervalMs || (mobileAsync ? 5000 : 3000)) || 3000))
  );
  const body: Record<string, any> = {
    prompt,
    timingMode: options.timingMode || (hasManualTiming ? 'manual' : 'auto'),
    autoTiming: options.autoTiming ?? !hasManualTiming,
    allowAutoTiming: true,
    continuityMode: 'frame_chain',
    preserveSubject: true,
    acceptAsyncVideoJob: options.acceptAsyncVideoJob ?? mobileAsync,
    mobileAsync,
    pollIntervalMs,
    maxWaitMs,
  };
  if (sessionVideoAuth.provider) body.videoProvider = sessionVideoAuth.provider;
  if (durationSeconds) body.durationSeconds = durationSeconds;
  if (fps) body.fps = fps;
  if (frameCount) body.frameCount = frameCount;
  if (width) body.width = width;
  if (height) body.height = height;
  if (sdSteps) body.sdSteps = sdSteps;
  if (guidanceScale) body.guidanceScale = guidanceScale;
  if (sourceImageUrl) body.sourceImageUrl = sourceImageUrl;

  return withMobileLongTaskGuard(maxWaitMs, async () => {
    const res = await fetch(getApiUrl('/api/video/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionVideoAuth.headers },
      body: JSON.stringify(body)
    });
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // ignore parse failure and use the status error below
    }
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.message || data?.error || `Erreur generation video (${res.status})`);
    }
    data = await resolveAsyncMediaJobPayload(data, {
      eventPrefix: "video-job",
      fallbackPollUrl: "/api/video/jobs",
      maxWaitMs,
    });
    return {
      ...data,
      videoUrl: data?.videoUrl || data?.video_url || data?.url || data?.result?.videoUrl || data?.result?.video_url || data?.result?.url || null,
      raw: data
    };
  });
}
// @ts-nocheck

const API_BASE_STORAGE_KEY = 'a11:api-base-override';
const DISPLAY_NAME_STORAGE_KEY = 'a11:display-name';
const AUTH_USER_STORAGE_KEY = 'a11-auth-user';
const AUTH_TOKEN_STORAGE_KEY = 'a11-auth-token';
const LEGACY_AUTH_TOKEN_STORAGE_KEY = 'a11_jwt_token';
const AUTH_INVALID_EVENT_NAME = 'a11:auth-invalid';
const AUTH_GLOBAL_LOGOUT_STORAGE_KEY = 'a11:global-logout-at';
const DEFAULT_A11_SYSTEM_PROMPT = "";
const DEFAULT_API_BASE = normalizeApiBase(
  (import.meta.env?.VITE_A11_API_BASE_URL) ||
  (import.meta.env?.VITE_API_BASE_URL) ||
  (import.meta.env?.VITE_API_URL) ||
  (import.meta.env?.VITE_API_BASE) ||
  ''
);
const DEFAULT_PROD_API_BASE = normalizeApiBase(
  import.meta.env?.VITE_A11_PROD_API_BASE_URL ||
  'https://a11.funesterie.me'
);
const DEFAULT_KAEN44_API_BASE = normalizeApiBase(
  import.meta.env?.VITE_KAEN44_API_BASE_URL ||
  'https://k44.funesterie.me'
);
const DEFAULT_FUNESTERIE_AUTH_BASE = normalizeApiBase(
  import.meta.env?.VITE_FUNESTERIE_AUTH_BASE_URL ||
  'https://funesterie.me'
);

function isPublicKaen44WebHost(hostname: string | null | undefined) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  return [
    'k44.funesterie.me',
    'kaen44.funesterie.me',
  ].includes(normalized);
}

function isPublicVivyWebHost(hostname: string | null | undefined) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  return [
    'vivy.funesterie.me',
    'music.funesterie.me',
  ].includes(normalized);
}

function isPublicGeneralCockpitHost(hostname: string | null | undefined) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  return [
    'funesterie.me',
    'www.funesterie.me',
  ].includes(normalized);
}

function resolveDefaultOnlineApiBase() {
  const configured = normalizeApiBase(import.meta.env?.VITE_A11_ONLINE_API_BASE_URL);
  if (configured) return configured;
  try {
    const hostname = globalThis.location?.hostname;
    if (isPublicA11WebHost(hostname)) return DEFAULT_PROD_API_BASE;
    if (isPublicGeneralCockpitHost(hostname) || isPublicKaen44WebHost(hostname) || isPublicVivyWebHost(hostname)) return '';
  } catch {
    // ignore browser location issues
  }
  return DEFAULT_PROD_API_BASE;
}

const DEFAULT_ONLINE_API_BASE = resolveDefaultOnlineApiBase();
const DEFAULT_LOCAL_PROFILE_BASE = (() => {
  const explicitLocalBase = normalizeApiBase(import.meta.env?.VITE_A11_LOCAL_API_BASE_URL);
  if (explicitLocalBase) return explicitLocalBase;
  if (DEFAULT_API_BASE && DEFAULT_API_BASE !== DEFAULT_ONLINE_API_BASE) return DEFAULT_API_BASE;
  return 'http://127.0.0.1:3000';
})();

export const A11_API_PROFILE_BASES = {
  online: DEFAULT_ONLINE_API_BASE,
  local: DEFAULT_LOCAL_PROFILE_BASE,
} as const;

export type A11ApiMode = 'auto' | 'online' | 'local';

function normalizeApiBase(rawValue: string | null | undefined) {
  return String(rawValue || '').trim().replace(/\/$/, '');
}

function isPublicA11WebHost(hostname: string | null | undefined) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  return [
    '178.105.86.89',
    'a11.funesterie.me',
  ].includes(normalized);
}

function isPublicFunesterieWebHost(hostname: string | null | undefined) {
  return isPublicA11WebHost(hostname) || isPublicKaen44WebHost(hostname) || isPublicVivyWebHost(hostname) || isPublicGeneralCockpitHost(hostname);
}

function isLocalApiBaseCandidate(baseValue: string | null | undefined) {
  const normalized = normalizeApiBase(baseValue);
  if (!normalized) return false;
  if (normalized === normalizeApiBase(A11_API_PROFILE_BASES.local)) return true;
  try {
    const hostname = new URL(normalized, globalThis.location?.origin || 'http://127.0.0.1').hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isPublicOnlineModeLocked() {
  try {
    return isPublicFunesterieWebHost(globalThis.location?.hostname);
  } catch {
    return false;
  }
}

function applyLaunchApiModeOverrides() {
  try {
    const locationRef = globalThis.location;
    if (!locationRef) return;
    const url = new URL(locationRef.href);
    let changed = false;

    if (url.searchParams.get('a11-reset-api-override') === '1') {
      globalThis.localStorage?.removeItem(API_BASE_STORAGE_KEY);
      url.searchParams.delete('a11-reset-api-override');
      changed = true;
    }

    const forcedMode = String(url.searchParams.get('a11-force-api-mode') || '').trim().toLowerCase();
    if (forcedMode === 'online' || forcedMode === 'prod' || forcedMode === 'production' || forcedMode === 'local') {
      const profileMode = (forcedMode === 'prod' || forcedMode === 'production') ? 'online' : forcedMode;
      const nextBase = A11_API_PROFILE_BASES[profileMode as 'online' | 'local'];
      if (nextBase) {
        globalThis.localStorage?.setItem(API_BASE_STORAGE_KEY, normalizeApiBase(nextBase));
      }
      url.searchParams.delete('a11-force-api-mode');
      changed = true;
    }

    if (isPublicFunesterieWebHost(url.hostname)) {
      const onlineBase = normalizeApiBase(A11_API_PROFILE_BASES.online);
      const currentOverride = normalizeApiBase(globalThis.localStorage?.getItem(API_BASE_STORAGE_KEY));
      if (!onlineBase && currentOverride) {
        globalThis.localStorage?.removeItem(API_BASE_STORAGE_KEY);
        changed = true;
      } else if (onlineBase && currentOverride !== onlineBase) {
        globalThis.localStorage?.setItem(API_BASE_STORAGE_KEY, onlineBase);
        changed = true;
      }
    }

    if (isLocalWebHost(url.hostname) && url.searchParams.get('a11-local-api') !== '1' && !hasLocalDevBypassSession()) {
      const onlineBase = normalizeApiBase(A11_API_PROFILE_BASES.online);
      const currentOverride = normalizeApiBase(globalThis.localStorage?.getItem(API_BASE_STORAGE_KEY));
      if (onlineBase && (!currentOverride || isLocalApiBaseCandidate(currentOverride))) {
        globalThis.localStorage?.setItem(API_BASE_STORAGE_KEY, onlineBase);
        changed = true;
      }
    }

    if (changed && typeof globalThis.history?.replaceState === 'function') {
      globalThis.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // ignore browser storage/location issues
  }
}

applyLaunchApiModeOverrides();

export function getCurrentApiBase() {
  if (hasLocalDevBypassSession()) {
    return normalizeApiBase(A11_API_PROFILE_BASES.local) || DEFAULT_LOCAL_PROFILE_BASE;
  }
  if (isPublicOnlineModeLocked()) {
    return normalizeApiBase(A11_API_PROFILE_BASES.online) || DEFAULT_ONLINE_API_BASE;
  }
  try {
    const override = normalizeApiBase(globalThis.localStorage?.getItem(API_BASE_STORAGE_KEY));
    if (override) return override;
  } catch {
    // ignore storage issues
  }
  return DEFAULT_API_BASE || DEFAULT_ONLINE_API_BASE;
}

export function getCurrentApiMode(): A11ApiMode {
  const currentBase = normalizeApiBase(getCurrentApiBase());
  if (!currentBase) return 'auto';
  if (currentBase === normalizeApiBase(A11_API_PROFILE_BASES.online)) return 'online';
  if (currentBase === normalizeApiBase(A11_API_PROFILE_BASES.local)) return 'local';
  return 'auto';
}

function emitApiModeChanged() {
  try {
    globalThis.dispatchEvent(new CustomEvent('a11:api-mode-changed', {
      detail: {
        apiBase: getCurrentApiBase(),
        mode: getCurrentApiMode(),
      },
    }));
  } catch {
    // ignore browser event issues
  }
}

export function setCurrentApiBase(nextBase: string | null | undefined) {
  let normalized = normalizeApiBase(nextBase);
  if (isPublicOnlineModeLocked() && isLocalApiBaseCandidate(normalized)) {
    normalized = normalizeApiBase(A11_API_PROFILE_BASES.online);
  }
  try {
    if (!normalized) {
      globalThis.localStorage?.removeItem(API_BASE_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(API_BASE_STORAGE_KEY, normalized);
    }
  } catch {
    // ignore storage issues
  }
  emitApiModeChanged();
}

export function setCurrentApiMode(mode: A11ApiMode) {
  if (mode === 'local' && isPublicOnlineModeLocked()) {
    setCurrentApiBase(A11_API_PROFILE_BASES.online);
    return;
  }
  if (mode === 'auto') {
    setCurrentApiBase('');
    return;
  }
  setCurrentApiBase(A11_API_PROFILE_BASES[mode]);
}

export function buildApiUrlFromBase(baseValue: string | null | undefined, path: string) {
  const base = normalizeApiBase(baseValue);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!base) return normalizedPath;
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  if (base === '/api' && normalizedPath === '/api') {
    return base;
  }
  return `${base}${normalizedPath}`;
}

export function getApiOriginFromBase(baseValue: string | null | undefined) {
  const base = normalizeApiBase(baseValue);
  try {
    if (base) {
      return new URL(base, globalThis.location?.origin || 'http://127.0.0.1').origin;
    }
  } catch {
    // ignore malformed API base
  }
  return globalThis.location?.origin || '';
}

function shouldUseSameOriginDevProxy(baseValue: string | null | undefined, path: string) {
  try {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return isLocalWebHost(globalThis.location?.hostname)
      && isLocalApiBaseCandidate(baseValue)
      && (
        normalizedPath.startsWith('/api/')
        || normalizedPath.startsWith('/v1/')
        || normalizedPath.startsWith('/files/')
      );
  } catch {
    return false;
  }
}

function getApiUrl(path: string) {
  const base = getCurrentApiBase();
  if (shouldUseSameOriginDevProxy(base, path)) {
    return buildApiUrlFromBase('', path);
  }
  return buildApiUrlFromBase(base, path);
}

function getApiOrigin() {
  return getApiOriginFromBase(getCurrentApiBase());
}

export function resolveApiAssetUrl(rawValue: string | null | undefined) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  if (/^(?:sandbox|file|vscode|cursor):/i.test(raw) || /^\/?sandbox:/i.test(raw)) return null;
  if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    try {
      const parsed = new URL(raw, globalThis.location?.origin || 'http://178.105.86.89');
      if (/^\/sandbox:/i.test(parsed.pathname) || /\/sandbox:\//i.test(parsed.pathname)) return null;
      const pathLike = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const currentHost = globalThis.location?.hostname || '';
      const currentOrigin = globalThis.location?.origin || '';
      const assetHost = parsed.hostname.toLowerCase();
      const isFunesterieHost = assetHost === 'funesterie.me' || assetHost.endsWith('.funesterie.me');
      if (
        parsed.protocol === 'http:'
        && globalThis.location?.protocol === 'https:'
        && (assetHost === currentHost.toLowerCase() || isFunesterieHost)
      ) {
        parsed.protocol = 'https:';
        return parsed.toString();
      }
      if (
        currentOrigin
        && isLocalWebHost(currentHost)
        && isLocalApiBaseCandidate(`${parsed.protocol}//${parsed.host}`)
        && shouldUseSameOriginDevProxy(getCurrentApiBase(), parsed.pathname)
      ) {
        return `${currentOrigin}${pathLike}`;
      }
      if (
        [
          'a11.funesterie.me',
          '178.105.86.89',
          'funesterie.me',
          'www.funesterie.me',
          'k44.funesterie.me',
          'kaen44.funesterie.me',
          'vivy.funesterie.me',
          'music.funesterie.me',
        ].includes(assetHost)
        && /^\/files\//i.test(parsed.pathname)
      ) {
        const origin = getApiOrigin() || globalThis.location?.origin || 'http://178.105.86.89';
        return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // keep the original absolute URL when it is not parseable by URL.
    }
    return raw;
  }
  const origin = getApiOrigin();
  const normalizedRaw = raw.replace(/\\/g, '/');
  if (
    /^\/(?:api|v1|files)\//i.test(normalizedRaw)
    && shouldUseSameOriginDevProxy(getCurrentApiBase(), normalizedRaw)
    && globalThis.location?.origin
  ) {
    return `${globalThis.location.origin}${normalizedRaw}`;
  }
  if (/^\/files\//i.test(normalizedRaw)) {
    return origin ? `${origin}${normalizedRaw}` : normalizedRaw;
  }
  const containerPathMatch = normalizedRaw.match(/^\/app\/(.+)$/i);
  if (containerPathMatch?.[1]) {
    const normalizedRuntimePath = `/files/${containerPathMatch[1]}`.replace(/\/{2,}/g, '/');
    return origin ? `${origin}${normalizedRuntimePath}` : normalizedRuntimePath;
  }
  if (/^app\/.+/i.test(normalizedRaw)) {
    const normalizedRuntimePath = `/files/${normalizedRaw.replace(/^app\//i, '')}`.replace(/\/{2,}/g, '/');
    return origin ? `${origin}${normalizedRuntimePath}` : normalizedRuntimePath;
  }
  const unifiedRuntimePath = normalizedRaw.replace(/^.*?\/runtime\/files\//i, '/runtime/files/');
  if (/^\/runtime\/files\//i.test(unifiedRuntimePath)) {
    const normalizedRuntimePath = unifiedRuntimePath
      .replace(/^\/runtime\/files\//i, '/files/')
      .replace(/\/{2,}/g, '/');
    return origin ? `${origin}${normalizedRuntimePath}` : normalizedRuntimePath;
  }
  const workspaceRuntimePath = normalizedRaw.replace(/^.*?\/a11_runtime\//i, '/a11_runtime/');
  if (/^\/a11_runtime\//i.test(workspaceRuntimePath)) {
    const normalizedRuntimePath = workspaceRuntimePath
      .replace(/^\/a11_runtime\//i, '/files/a11_runtime/')
      .replace(/\/{2,}/g, '/');
    return origin ? `${origin}${normalizedRuntimePath}` : normalizedRuntimePath;
  }
  if (raw.startsWith('/')) {
    return origin ? `${origin}${raw}` : raw;
  }
  return origin ? `${origin}/${raw.replace(/^\.?\//, '')}` : raw;
}

// Legacy router URL: only used for a same-origin credentials hint in a few local flows.
// Public frontend traffic should continue to go through the A11 API base, not directly to Cerbere.
const LLM_ROUTER_URL = (import.meta.env?.VITE_LLM_ROUTER_URL) || '';

const ADMIN_TOKEN = (import.meta.env?.VITE_A11_ADMIN_TOKEN) || '';

// ✅ AUTH HELPERS
function readStoredAuthToken() {
  try {
    return String(
      localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
      || localStorage.getItem(LEGACY_AUTH_TOKEN_STORAGE_KEY)
      || ''
    ).trim();
  } catch {
    return '';
  }
}

function looksLikeJwtToken(value: string | null | undefined) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || '').trim());
}

export function getAuthToken() {
  const token = readStoredAuthToken();
  if (!token) return '';
  if (!looksLikeJwtToken(token)) {
    clearClientAuthSession({
      reason: 'A11_JWT_Invalid',
      message: 'Le format de la session A11 est invalide.',
    });
    return '';
  }

  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== 'object') {
    clearClientAuthSession({
      reason: 'A11_JWT_Invalid',
      message: 'Le JWT A11 ne peut pas etre decode.',
    });
    return '';
  }

  const exp = Number(payload?.exp || 0);
  if (Number.isFinite(exp) && exp > 0 && (exp * 1000) <= (Date.now() + 5000)) {
    clearClientAuthSession({
      reason: 'A11_JWT_Expired',
      message: 'Le JWT A11 a expire.',
    });
    return '';
  }

  return token;
}

export function hasAuthToken() {
  return !!getAuthToken();
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  localStorage.setItem(LEGACY_AUTH_TOKEN_STORAGE_KEY, token);
}

export function setAuthDisplayName(name: string | null | undefined) {
  const normalized = String(name || '').trim();
  try {
    if (!normalized) {
      localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    } else {
      localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, normalized);
    }
  } catch {
    // ignore storage issues
  }
}

function stripGeneratedAuthNameSuffix(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[-_.][a-f0-9]{6,12}$/i, '') || text;
}

function prettifyAuthName(value: unknown) {
  const raw = String(value || '').trim();
  const text = stripGeneratedAuthNameSuffix(raw);
  if (!text) return '';
  if (text === raw) return text;
  return text
    .replace(/[-_.]+/g, ' ')
    .split(/\s+/)
    .map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 96);
}

function resolveAuthUserDisplayName(user: any, fallback = '') {
  const candidates = [
    user?.displayName,
    user?.display_name,
    user?.name,
    user?.username,
    user?.email,
    fallback,
  ];
  for (const candidate of candidates) {
    const resolved = prettifyAuthName(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function setAuthUserProfile(user: any) {
  try {
    if (!user || typeof user !== 'object') {
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify({
      id: user.id ?? '',
      username: user.username || '',
      displayName: user.displayName || user.display_name || user.name || '',
      email: user.email || '',
      storageScope: user.storageScope || user.storage_scope || '',
      role: user.role || '',
      fullAccess: user.fullAccess === true,
      isAdmin: user.isAdmin === true,
      tier: user.tier || user.accountTier || user.account_tier || '',
      accountTier: user.accountTier || user.account_tier || user.tier || '',
      provider: user.provider || '',
      language: normalizeAccountLanguage(user.language || user.locale || user.accountLanguage || user.account_language || user.preferredLanguage || user.preferred_language),
      locale: normalizeAccountLanguage(user.locale || user.language || user.accountLanguage || user.account_language || user.preferredLanguage || user.preferred_language),
    }));
  } catch {
    // ignore storage issues
  }
}

function getStoredAuthUserProfile() {
  try {
    const raw = String(localStorage.getItem(AUTH_USER_STORAGE_KEY) || '').trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string) {
  try {
    const payload = String(token || '').split('.')[1] || '';
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeStorageScopePart(value: unknown) {
  try {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  } catch {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }
}

export function normalizeAccountLanguage(value: unknown, fallback = 'fr') {
  const normalizedFallback = ['fr', 'en', 'it', 'es', 'de', 'ja', 'zh'].includes(String(fallback || '').trim().toLowerCase())
    ? String(fallback || '').trim().toLowerCase()
    : 'fr';
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw || raw === 'auto') return normalizedFallback;
  const first = raw.split(/[-,;]/)[0];
  if (['fr', 'en', 'it', 'es', 'de', 'ja', 'zh'].includes(first)) return first;
  if (['francais', 'français', 'french'].includes(raw)) return 'fr';
  if (['english', 'anglais'].includes(raw)) return 'en';
  if (['italiano', 'italien', 'italian'].includes(raw)) return 'it';
  if (['espanol', 'español', 'espagnol', 'spanish'].includes(raw)) return 'es';
  if (['deutsch', 'allemand', 'german'].includes(raw)) return 'de';
  return normalizedFallback;
}

export function getAuthAccountLanguage(fallback = 'fr') {
  if (hasLocalDevBypassSession()) return normalizeAccountLanguage(localStorage.getItem('a11:language'), fallback);

  const payload = decodeJwtPayload(getAuthToken()) || {};
  const storedUser = getStoredAuthUserProfile() || {};
  return normalizeAccountLanguage(
    payload?.language
    || payload?.locale
    || payload?.accountLanguage
    || payload?.account_language
    || payload?.preferredLanguage
    || payload?.preferred_language
    || storedUser?.language
    || storedUser?.locale
    || storedUser?.accountLanguage
    || storedUser?.account_language
    || storedUser?.preferredLanguage
    || storedUser?.preferred_language,
    fallback
  );
}

function isLocalDevSurface() {
  try {
    const hostname = String(globalThis.location?.hostname || '').trim().toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function hasLocalDevBypassSession() {
  try {
    return isLocalDevSurface() && localStorage.getItem('a11:local-dev-bypass') === '1';
  } catch {
    return isLocalDevSurface();
  }
}

export function getAuthIdentity() {
  if (hasLocalDevBypassSession()) {
    return {
      id: 'djeff-local',
      username: 'djeff-local',
      email: 'djeff-local@funesterie.local',
      storageScope: 'local__djeff-local',
    };
  }

  const payload = decodeJwtPayload(getAuthToken()) || {};
  const storedUser = getStoredAuthUserProfile() || {};
  const explicitStorageScope = normalizeStorageScopePart(
    payload?.storageScope
    || payload?.storage_scope
    || storedUser?.storageScope
    || storedUser?.storage_scope
    || ''
  );
  const id = normalizeStorageScopePart(
    payload?.id
    || payload?.userId
    || payload?.user_id
    || payload?.sub
    || storedUser?.id
    || ''
  );
  const username = normalizeStorageScopePart(
    payload?.username
    || payload?.preferred_username
    || payload?.name
    || storedUser?.username
    || ''
  );
  const email = normalizeStorageScopePart(
    payload?.email
    || storedUser?.email
    || ''
  );
  const primary = email || id || username;
  const storageScope = explicitStorageScope || (primary ? `account__${primary}` : '');
  return {
    id,
    username,
    email,
    storageScope: storageScope || '',
    language: getAuthAccountLanguage('fr'),
  };
}

export function getLegacyAuthStorageScopes() {
  if (hasLocalDevBypassSession()) return [];

  const payload = decodeJwtPayload(getAuthToken()) || {};
  const storedUser = getStoredAuthUserProfile() || {};
  const id = normalizeStorageScopePart(
    payload?.id
    || payload?.userId
    || payload?.user_id
    || payload?.sub
    || storedUser?.id
    || ''
  );
  const username = normalizeStorageScopePart(
    payload?.username
    || payload?.preferred_username
    || payload?.name
    || storedUser?.username
    || ''
  );
  const email = normalizeStorageScopePart(
    payload?.email
    || storedUser?.email
    || ''
  );
  const provider = normalizeStorageScopePart(
    payload?.provider
    || storedUser?.provider
    || ''
  );
  const primary = id || email || username;
  const legacyScope = [provider, primary, username && username !== primary ? username : '']
    .filter(Boolean)
    .join('__');
  const currentScope = getAuthStorageScope();
  return Array.from(new Set([legacyScope].filter((scope) => scope && scope !== currentScope)));
}

export function getAuthEmail() {
  if (hasLocalDevBypassSession()) return 'djeff-local@funesterie.local';

  const payload = decodeJwtPayload(getAuthToken()) || {};
  const storedUser = getStoredAuthUserProfile() || {};
  return String(payload?.email || storedUser?.email || '').trim().toLowerCase();
}

export function getAuthStorageScope() {
  return getAuthIdentity().storageScope;
}

function hasAdminIdentityClaims() {
  const payload = decodeJwtPayload(getAuthToken()) || {};
  const storedUser = getStoredAuthUserProfile() || {};
  const id = normalizeStorageScopePart(payload?.id || payload?.sub || '');
  const username = normalizeStorageScopePart(
    payload?.username || payload?.preferred_username || payload?.name || ''
  );
  const role = normalizeStorageScopePart(payload?.role || payload?.user_role || '');
  const storedUsername = normalizeStorageScopePart(storedUser?.username || '');
  const storedRole = normalizeStorageScopePart(storedUser?.role || '');
  const roles = Array.isArray(payload?.roles)
    ? payload.roles.map((entry: unknown) => normalizeStorageScopePart(entry)).filter(Boolean)
    : [];
  const storedRoles = Array.isArray(storedUser?.roles)
    ? storedUser.roles.map((entry: unknown) => normalizeStorageScopePart(entry)).filter(Boolean)
    : [];
  return payload?.isAdmin === true
    || storedUser?.isAdmin === true
    || id === 'admin'
    || username === 'admin'
    || role === 'admin'
    || storedUsername === 'admin'
    || storedRole === 'admin'
    || roles.some((entry: string) => entry === 'admin')
    || storedRoles.some((entry: string) => entry === 'admin');
}

export function hasAuthenticatedAdminApiAccess() {
  if (hasLocalDevBypassSession()) return true;

  return hasAdminIdentityClaims();
}

export function hasAdminApiAccess() {
  if (hasAuthenticatedAdminApiAccess()) return true;

  if (String(ADMIN_TOKEN || '').trim()) return true;

  return false;
}

export function getAuthDisplayName() {
  if (hasLocalDevBypassSession()) return 'Djeff local';

  try {
    const saved = String(localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || '').trim();
    if (saved) return prettifyAuthName(saved);
  } catch {
    // ignore storage issues
  }

  const payload = decodeJwtPayload(getAuthToken());
  const fromToken =
    payload?.displayName ||
    payload?.display_name ||
    payload?.username ||
    payload?.preferred_username ||
    payload?.name ||
    payload?.email ||
    payload?.sub ||
    '';
  if (fromToken) return prettifyAuthName(fromToken);

  const storedUser = getStoredAuthUserProfile();
  return resolveAuthUserDisplayName(storedUser);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
}

let _lastAuthInvalidDispatchAt = 0;

function clearClientAuthSession(detail?: { reason?: string; message?: string; status?: number }) {
  if (hasLocalDevBypassSession()) return;

  const hadStoredToken = !!readStoredAuthToken();
  clearAuthToken();
  setAuthDisplayName('');
  if (!hadStoredToken && !detail?.reason && !detail?.message) return;
  // Debounce: ne pas dispatch plus d'une fois par seconde pour éviter les boucles
  const now = Date.now();
  if (now - _lastAuthInvalidDispatchAt < 2000) return;
  _lastAuthInvalidDispatchAt = now;
  dispatchBrowserEvent(new CustomEvent(AUTH_INVALID_EVENT_NAME, {
    detail: {
      reason: String(detail?.reason || 'A11_JWT_Invalid').trim(),
      message: String(detail?.message || '').trim(),
      status: Number(detail?.status || 0) || undefined,
    },
  }));
}

export async function login(username: string, password: string) {
  const res = await fetch(getApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    setAuthToken(data.token);
    setAuthUserProfile(data?.user);
    setAuthDisplayName(resolveAuthUserDisplayName(data?.user, username));
    return data;
  }
  throw new Error(data.error || 'Connexion impossible');
}

export async function loginWithGoogleCredential(credential: string) {
  const res = await fetch(getApiUrl('/api/auth/google'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential })
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (res.ok && data.success && data.token) {
    setAuthToken(data.token);
    setAuthUserProfile(data?.user);
    setAuthDisplayName(resolveAuthUserDisplayName(data?.user, 'Google'));
    return data;
  }

  if (data.error === 'google_auth_not_configured') {
    throw new Error('Connexion Google pas encore configuree sur ce deploiement');
  }
  throw new Error(data.message || data.error || 'Connexion Google impossible');
}

export type AuthSessionResponse = {
  ok: boolean;
  authenticated?: boolean;
  user?: {
    id?: string | number;
    username?: string;
    displayName?: string;
    email?: string;
    storageScope?: string;
    role?: string;
    isAdmin?: boolean;
    fullAccess?: boolean;
    tier?: string;
    accountTier?: string;
    provider?: string;
    surface?: string;
    accessPacks?: string[];
  };
  session?: {
    id?: string | null;
    version?: number;
    surface?: string;
    provider?: string;
    expiresAt?: string | null;
  };
  token?: string;
  error?: string;
  message?: string;
};

export type AuthConnectorProviderState = {
  configured?: boolean;
  linked?: boolean;
  account?: string | null;
  filesAccess?: string;
  missing?: string[];
};

export type AuthConnectorsResponse = {
  ok: boolean;
  authenticated?: boolean;
  user?: AuthSessionResponse["user"] | null;
  tier?: string;
  connectors?: {
    google?: AuthConnectorProviderState;
    microsoft?: AuthConnectorProviderState;
    accountFiles?: {
      configured?: boolean;
      linked?: boolean;
      scopedToAccount?: boolean;
    };
  };
  serverConfig?: {
    google?: { configured?: boolean; missing?: string[] };
    microsoft?: { configured?: boolean; missing?: string[] };
  };
  error?: string;
  message?: string;
};

export type AuthSessionDescriptor = {
  id: string;
  current?: boolean;
  provider?: string;
  surface?: string;
  client?: string;
  email?: string;
  username?: string;
  createdAt?: string | null;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  requestHost?: string;
};

export type AuthSessionsResponse = {
  ok: boolean;
  sessions?: AuthSessionDescriptor[];
  global?: {
    version?: number;
    canLogoutAll?: boolean;
  };
  error?: string;
  message?: string;
};

function shouldUseCookieOnlyAuthSessionProbe() {
  try {
    const hostname = String(globalThis.location?.hostname || '').toLowerCase();
    if (hostname !== 'funesterie.me' && hostname !== 'www.funesterie.me') return false;
    const pathname = String(globalThis.location?.pathname || '/').toLowerCase();
    return pathname === '/'
      || /^\/(?:home|accueil|agents|architecture|carte|graph|etat|cockpit|compte|contact|privacy|terms|login)(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

function isFunesterieSessionHost() {
  try {
    const hostname = String(globalThis.location?.hostname || '').trim().toLowerCase();
    return hostname === 'funesterie.me' || hostname.endsWith('.funesterie.me');
  } catch {
    return false;
  }
}

function hasAuthorizationHeader(headers?: HeadersInit) {
  if (!headers) return false;
  try {
    return new Headers(headers).has('authorization');
  } catch {
    return false;
  }
}

function stripAuthorizationHeader(headers?: HeadersInit) {
  const next = new Headers(headers || undefined);
  next.delete('authorization');
  next.delete('Authorization');
  return next;
}

type OAuthStartOptions = {
  scopeProfile?: string;
};

export async function fetchAuthSession(): Promise<AuthSessionResponse> {
  const headers: Record<string, string> = {};
  const tokenAtStart = getAuthToken();
  const usedBearer = !!tokenAtStart && !shouldUseCookieOnlyAuthSessionProbe();
  if (usedBearer) {
    headers.Authorization = `Bearer ${tokenAtStart}`;
  }
  let res = await fetch(getApiUrl('/api/auth/me'), {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  let data: AuthSessionResponse = await res.json().catch(() => ({ ok: false }));
  if (
    (!res.ok || data?.ok === false)
    && usedBearer
    && isFunesterieSessionHost()
    && (
      res.status === 401
      || data?.error === 'A11_JWT_Invalid'
      || data?.error === 'A11_SESSION_REVOKED'
    )
  ) {
    const retryRes = await fetch(getApiUrl('/api/auth/me'), {
      method: 'GET',
      headers: {},
      credentials: 'include',
    });
    const retryData: AuthSessionResponse = await retryRes.json().catch(() => ({ ok: false }));
    if (retryRes.ok && retryData?.ok !== false) {
      if (retryData.token) {
        setAuthToken(retryData.token);
      } else {
        clearAuthToken();
      }
      if (retryData?.authenticated || retryData?.user) {
        setAuthUserProfile(retryData?.user);
        setAuthDisplayName(resolveAuthUserDisplayName(retryData?.user));
      }
      return retryData;
    }
    res = retryRes;
    data = retryData;
  }
  if (!res.ok || data?.ok === false) {
    if (res.status === 401 || data?.error === 'A11_JWT_Invalid' || data?.error === 'A11_SESSION_REVOKED') {
      const currentToken = getAuthToken();
      if (!currentToken || currentToken === tokenAtStart) {
        clearClientAuthSession({
          reason: data?.error || 'A11_JWT_Invalid',
          message: data?.message || `Session A11 invalide (${res.status})`,
          status: res.status,
        });
      }
    }
    throw new Error(data?.message || data?.error || `Session A11 invalide (${res.status})`);
  }
  if (data.token) {
    setAuthToken(data.token);
  }
  if (!data?.authenticated && !data?.user) {
    const currentToken = getAuthToken();
    if (tokenAtStart && (!currentToken || currentToken === tokenAtStart)) {
      clearClientAuthSession({
        reason: 'A11_SESSION_INACTIVE',
        message: 'Session Funesterie inactive.',
        status: res.status,
      });
    }
    return data;
  }
  setAuthUserProfile(data?.user);
  setAuthDisplayName(resolveAuthUserDisplayName(data?.user));
  return data;
}

export async function fetchAuthConnectors(): Promise<AuthConnectorsResponse> {
  const headers: Record<string, string> = {};
  const tokenAtStart = getAuthToken();
  const usedBearer = !!tokenAtStart && !shouldUseCookieOnlyAuthSessionProbe();
  if (usedBearer) {
    headers.Authorization = `Bearer ${tokenAtStart}`;
  }
  let res = await fetch(getApiUrl('/api/auth/connectors'), {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  let data: AuthConnectorsResponse = await res.json().catch(() => ({ ok: false }));
  if (
    (!res.ok || data?.ok === false)
    && usedBearer
    && isFunesterieSessionHost()
    && (
      res.status === 401
      || data?.error === 'A11_JWT_Invalid'
      || data?.error === 'A11_SESSION_REVOKED'
    )
  ) {
    const retryRes = await fetch(getApiUrl('/api/auth/connectors'), {
      method: 'GET',
      headers: {},
      credentials: 'include',
      cache: 'no-store',
    });
    const retryData: AuthConnectorsResponse = await retryRes.json().catch(() => ({ ok: false }));
    if (retryRes.ok && retryData?.ok !== false) return retryData;
    res = retryRes;
    data = retryData;
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Connecteurs indisponibles (${res.status})`);
  }
  return data;
}

export async function fetchAuthSessions(): Promise<AuthSessionsResponse> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(getApiUrl('/api/auth/sessions'), {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const data: AuthSessionsResponse = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data?.ok === false) {
    if (res.status === 401 || data?.error === 'A11_SESSION_REVOKED') {
      clearClientAuthSession({
        reason: data?.error || 'A11_JWT_Invalid',
        message: data?.message || `Session A11 invalide (${res.status})`,
        status: res.status,
      });
    }
    throw new Error(data?.message || data?.error || `Sessions indisponibles (${res.status})`);
  }
  return data;
}

export type McpCockpitSummary = {
  ok: boolean;
  updatedAt?: string;
  account?: McpAccountProfile;
  a11?: { ok?: boolean };
  kaen44?: { ok?: boolean };
  vivy?: {
    ok?: boolean;
    audio?: boolean;
    present?: boolean;
    source?: string;
  };
  agents?: {
    active?: number;
    total?: number;
    names?: string[];
  };
  jobs?: {
    total?: number;
    ready?: number;
    running?: number;
  };
  game?: {
    source?: string;
    ready?: boolean;
    phase?: string;
    japaneseIgnored?: boolean;
  };
  controller?: {
    ready?: boolean;
    recentCount?: number;
    target?: string;
  };
  pitching?: {
    total?: number;
    ready?: number;
    items?: Array<{
      title?: string;
      ready?: boolean;
      requiredAnswered?: number;
      requiredTotal?: number;
      expectedAnswered?: number;
      expectedTotal?: number;
      deadlineSoftPassed?: boolean;
    }>;
  };
  threads?: {
    working?: McpCockpitThreadList;
    open?: McpCockpitThreadList;
    pitching?: McpCockpitThreadList;
  };
  error?: string;
  message?: string;
};

export type McpAccountProfile = {
  ok?: boolean;
  tier?: "basic" | "premium" | "founder" | "admin_family" | string;
  label?: string;
  reason?: string;
  authenticated?: boolean;
  pricing?: {
    monthlyEur?: number | null;
    publicLabel?: string;
  };
  features?: string[];
  user?: {
    id?: string;
    username?: string;
    email?: string;
    provider?: string;
    role?: string;
  };
  permissions?: Record<string, boolean>;
  required?: {
    permission?: string;
    minimumTier?: string;
    minimumLabel?: string;
  };
};

export type McpAccessTierCard = {
  tier: string;
  label?: string;
  pricing?: {
    monthlyEur?: number | null;
    publicLabel?: string;
  };
  features?: string[];
};

export type McpAccessCapability = {
  id: string;
  label: string;
  permission?: string;
  minimumTier?: string;
  category?: string;
  description?: string;
  recommended?: boolean;
  adjustable?: boolean;
  allowed?: boolean;
};

export type McpAccessConnector = {
  id: string;
  label: string;
  permission?: string;
  minimumTier?: string;
  allowed?: boolean;
};

export type McpAccessCatalog = {
  tiers?: McpAccessTierCard[];
  sessionSafety?: {
    scopedToOwnSession?: boolean;
    destructiveActions?: boolean;
    crossAccountAccess?: boolean;
    preservesExistingDataByDefault?: boolean;
  };
  capabilities?: McpAccessCapability[];
  connectors?: McpAccessConnector[];
};

export type McpAccessCatalogResponse = {
  ok: boolean;
  account?: McpAccountProfile;
  catalog?: McpAccessCatalog;
  error?: string;
  message?: string;
};

export type McpCockpitThreadList = {
  total?: number;
  items?: McpCockpitThread[];
};

export type McpCockpitThread = {
  id?: string;
  title?: string;
  status?: string;
  topic?: string;
  participants?: string[];
  tags?: string[];
  messageCount?: number;
  updatedAt?: string;
  lastFrom?: string;
  lastKind?: string;
  lastSnippet?: string;
  ready?: boolean;
  requiredAnswered?: number;
  requiredTotal?: number;
};

export async function fetchMcpCockpitAccount(): Promise<McpAccountProfile> {
  const headers: Record<string, string> = {};
  const tokenAtStart = getAuthToken();
  const usedBearer = !!tokenAtStart && !shouldUseCookieOnlyAuthSessionProbe();
  if (usedBearer) headers.Authorization = `Bearer ${tokenAtStart}`;
  let res = await fetch(getApiUrl('/api/cockpit/mcp/me'), {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  let data = await res.json().catch(() => ({ ok: false }));
  if (
    (!res.ok || data?.ok === false)
    && usedBearer
    && isFunesterieSessionHost()
    && (
      res.status === 401
      || data?.error === 'A11_JWT_Invalid'
      || data?.error === 'A11_SESSION_REVOKED'
    )
  ) {
    const retryRes = await fetch(getApiUrl('/api/cockpit/mcp/me'), {
      method: 'GET',
      headers: {},
      credentials: 'include',
      cache: 'no-store',
    });
    const retryData = await retryRes.json().catch(() => ({ ok: false }));
    if (retryRes.ok && retryData?.ok !== false) return retryData.account || retryData;
    res = retryRes;
    data = retryData;
  }
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Compte MCP indisponible (${res.status})`) as Error & {
      status?: number;
      payload?: unknown;
    };
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data.account || data;
}

export async function fetchMcpCockpitStatus(): Promise<McpCockpitSummary> {
  const headers: Record<string, string> = {};
  const tokenAtStart = getAuthToken();
  const usedBearer = !!tokenAtStart && !shouldUseCookieOnlyAuthSessionProbe();
  if (usedBearer) headers.Authorization = `Bearer ${tokenAtStart}`;
  let res = await fetch(getApiUrl('/api/cockpit/mcp/status'), {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  let data: McpCockpitSummary = await res.json().catch(() => ({ ok: false }));
  if (
    (!res.ok || data?.ok === false)
    && usedBearer
    && isFunesterieSessionHost()
    && (
      res.status === 401
      || data?.error === 'A11_JWT_Invalid'
      || data?.error === 'A11_SESSION_REVOKED'
    )
  ) {
    const retryRes = await fetch(getApiUrl('/api/cockpit/mcp/status'), {
      method: 'GET',
      headers: {},
      credentials: 'include',
      cache: 'no-store',
    });
    const retryData: McpCockpitSummary = await retryRes.json().catch(() => ({ ok: false }));
    if (retryRes.ok && retryData?.ok !== false) return retryData;
    res = retryRes;
    data = retryData;
  }
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Cockpit MCP indisponible (${res.status})`) as Error & {
      status?: number;
      payload?: McpCockpitSummary;
    };
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function fetchMcpAccessCatalog(): Promise<McpAccessCatalogResponse> {
  const res = await authFetch(getApiUrl('/api/mcp/access'), {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Catalogue MCP indisponible (${res.status})`) as Error & {
      status?: number;
      payload?: unknown;
    };
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data as McpAccessCatalogResponse;
}

function isKaen44WebSurface() {
  try {
    const hostname = String(globalThis.location?.hostname || '').trim().toLowerCase();
    const pathname = String(globalThis.location?.pathname || '/').trim().toLowerCase();
    const search = String(globalThis.location?.search || '');
    const params = new URLSearchParams(search);
    const persona = String(params.get('persona') || '').trim().toLowerCase();
    return isPublicKaen44WebHost(hostname)
      || (/^\/(?:k44|kaen44)(?:\/|$)/.test(pathname))
      || persona === 'kaen44'
      || persona === 'kaen';
  } catch {
    return false;
  }
}

function resolveOAuthReturnTo(returnTo: string) {
  const fallback = '/auth/success';
  const raw = String(returnTo || fallback).trim() || fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, globalThis.location?.origin || 'https://a11.funesterie.me').toString();
  } catch {
    return raw;
  }
}

function resolveCurrentPublicApiBase() {
  try {
    const hostname = globalThis.location?.hostname;
    const origin = normalizeApiBase(globalThis.location?.origin || '');
    if (origin && isPublicFunesterieWebHost(hostname)) return origin;
  } catch {
    // ignore browser location issues
  }
  return '';
}

function isCentralFunesterieLoginPage() {
  try {
    const hostname = globalThis.location?.hostname;
    const pathname = String(globalThis.location?.pathname || '/').toLowerCase();
    return isPublicGeneralCockpitHost(hostname) && /^\/login\/?$/.test(pathname);
  } catch {
    return false;
  }
}

function resolveCurrentAuthSurface() {
  try {
    const hostname = String(globalThis.location?.hostname || '').trim().toLowerCase();
    const pathname = String(globalThis.location?.pathname || '/').toLowerCase();
    const params = new URLSearchParams(String(globalThis.location?.search || ''));
    const persona = String(params.get('persona') || '').trim().toLowerCase();
    if (isPublicKaen44WebHost(hostname) || /^\/(?:k44|kaen44)(?:\/|$)/.test(pathname) || ['kaen44', 'kaen', 'k44'].includes(persona)) {
      return 'k44';
    }
    if (isPublicVivyWebHost(hostname) || /^\/vivy(?:\/|$)/.test(pathname) || persona === 'vivy') {
      return 'vivy';
    }
    if (isPublicA11WebHost(hostname) || /^\/(?:a11|alphaonze)(?:\/|$)/.test(pathname) || ['a11', 'alphaonze'].includes(persona)) {
      return 'a11';
    }
  } catch {
    // ignore browser location issues
  }
  return 'funesterie';
}

function resolveCentralAuthBase() {
  try {
    const hostname = globalThis.location?.hostname;
    if (isPublicFunesterieWebHost(hostname)) return DEFAULT_FUNESTERIE_AUTH_BASE;
    if (isCentralFunesterieLoginPage()) return normalizeApiBase(globalThis.location?.origin || DEFAULT_FUNESTERIE_AUTH_BASE);
  } catch {
    // ignore browser location issues
  }
  return normalizeApiBase(getCurrentApiBase() || A11_API_PROFILE_BASES.online || DEFAULT_FUNESTERIE_AUTH_BASE);
}

export function getGoogleOAuthStartUrl(returnTo = '/auth/success', client = 'web', options: OAuthStartOptions = {}) {
  const googleBaseUrl = resolveCentralAuthBase();
  const target = new URL(
    buildApiUrlFromBase(googleBaseUrl, '/api/auth/google/start'),
    globalThis.location?.origin || googleBaseUrl || DEFAULT_FUNESTERIE_AUTH_BASE
  );
  target.searchParams.set('returnTo', resolveOAuthReturnTo(returnTo));
  target.searchParams.set('client', client || 'web');
  target.searchParams.set('scopeProfile', options.scopeProfile || 'basic');
  target.searchParams.set('surface', resolveCurrentAuthSurface());
  return target.toString();
}

export function startGoogleOAuth(returnTo = '/auth/success', client = 'web', options: OAuthStartOptions = {}) {
  globalThis.location.assign(getGoogleOAuthStartUrl(returnTo, client, options));
}

export function getMicrosoftOAuthStartUrl(returnTo = '/auth/success', client = 'web', options: OAuthStartOptions = {}) {
  const msBaseUrl = resolveCentralAuthBase();
  const target = new URL(buildApiUrlFromBase(msBaseUrl, '/api/auth/microsoft/start'), globalThis.location?.origin || msBaseUrl || 'https://a11.funesterie.me');
  target.searchParams.set('returnTo', resolveOAuthReturnTo(returnTo));
  target.searchParams.set('client', client || 'web');
  if (options.scopeProfile) {
    target.searchParams.set('scopeProfile', options.scopeProfile);
  }
  target.searchParams.set('surface', resolveCurrentAuthSurface());
  return target.toString();
}

export function startMicrosoftOAuth(returnTo = '/auth/success', client = 'web', options: OAuthStartOptions = {}) {
  globalThis.location.assign(getMicrosoftOAuthStartUrl(returnTo, client, options));
}

export async function register(username: string, email: string, password: string) {
  const res = await fetch(getApiUrl('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, email, password })
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    if (data.error === 'username_taken') {
      throw new Error("Ce nom d'utilisateur est deja pris");
    }
    if (data.error === 'email_taken') {
      throw new Error("Cet email est deja utilise");
    }
    throw new Error(data.error || "Inscription impossible");
  }

  if (data.token) {
    setAuthToken(data.token);
    setAuthUserProfile(data?.user);
    setAuthDisplayName(resolveAuthUserDisplayName(data?.user, username));
  }

  return data;
}

export async function forgotPassword(email: string) {
  const res = await fetch(getApiUrl('/api/auth/forgot-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(data.error || `Echec de l'envoi du lien (${res.status})`);
  }

  return data;
}

export async function resetPassword(token: string, password: string) {
  const res = await fetch(getApiUrl('/api/auth/reset-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password })
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(data.error || `Reinitialisation impossible (${res.status})`);
  }

  return data;
}

export async function disconnectConnector(provider: 'google' | 'microsoft'): Promise<{ ok: boolean; alreadyUnlinked?: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token && !shouldUseCookieOnlyAuthSessionProbe()) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(getApiUrl(`/api/auth/connectors/${provider}/disconnect`), {
    method: 'POST',
    headers,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok && !data?.alreadyUnlinked) throw new Error(data?.message || `Déconnexion ${provider} impossible`);
  return data;
}

export async function logout(options: { allSessions?: boolean } = {}) {
  const token = getAuthToken();
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(getApiUrl(options.allSessions ? '/api/auth/logout-all' : '/api/auth/logout'), {
      method: 'POST',
      headers,
      credentials: 'include',
    });
  } catch {
    // ignore logout transport issues
  }
  try {
    localStorage.setItem(AUTH_GLOBAL_LOGOUT_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore storage issues
  }
  clearClientAuthSession({
    reason: options.allSessions ? 'A11_Logout_All' : 'A11_Logout',
    message: options.allSessions ? 'Déconnexion globale demandée.' : 'Session courante déconnectée.',
  });
}

export async function logoutAllSessions() {
  return logout({ allSessions: true });
}

export function isAuthInvalidError(error: unknown) {
  const code = String((error as { code?: string } | null | undefined)?.code || '').trim();
  const status = Number((error as { status?: number } | null | undefined)?.status);
  const message = String((error as { message?: string } | null | undefined)?.message || '').trim().toLowerCase();
  return code === 'A11_JWT_Invalid'
    || code === 'A11_JWT_Missing'
    || code === 'A11_JWT_Revoked'
    || code === 'A11_SESSION_REVOKED'
    || status === 401
    || message.includes('session a11 invalide')
    || message.includes('session funesterie inactive')
    || message.includes('session révoquée')
    || message.includes('session revoquee');
}

export async function revokeAuthSession(sessionId: string) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('Session manquante');
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(getApiUrl(`/api/auth/sessions/${encodeURIComponent(sid)}`), {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    if (res.status === 401 || data?.error === 'A11_SESSION_REVOKED') {
      clearClientAuthSession({
        reason: data?.error || 'A11_JWT_Invalid',
        message: data?.message || `Session A11 invalide (${res.status})`,
        status: res.status,
      });
    }
    throw new Error(data?.message || data?.error || `Révocation impossible (${res.status})`);
  }
  return data;
}

function appendJwtHeaders(headers: Record<string, string>) {
  const token = getAuthToken();
  if (!token) return false;
  headers['Authorization'] = `Bearer ${token}`;
  return true;
}

function buildAuthHeaders(contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  appendJwtHeaders(headers);
  if (hasLocalDevBypassSession()) {
    headers['X-A11-Local-Dev-Bypass'] = '1';
  }

  return headers;
}

async function readResponsePayloadSafe(res: Response) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return { text: '', data: null as any };
  }

  try {
    return {
      text,
      data: text ? JSON.parse(text) : null,
    };
  } catch {
    return {
      text,
      data: null as any,
    };
  }
}

async function throwIfAuthInvalidResponse(res: Response, tokenAtStart = '') {
  if (res.ok) return;

  const { text, data } = await readResponsePayloadSafe(res.clone());
  const errorCode = String(data?.error || '').trim();
  const message = String(data?.message || '').trim()
    || errorCode
    || (!isLikelyHtmlDocument(text) ? text.trim() : '');

  if (
    res.status === 401
    || errorCode === 'A11_JWT_Invalid'
    || errorCode === 'A11_JWT_Missing'
    || errorCode === 'A11_JWT_Revoked'
    || errorCode === 'A11_SESSION_REVOKED'
  ) {
    const currentToken = getAuthToken();
    if (!currentToken || currentToken === tokenAtStart) {
      clearClientAuthSession({
        reason: errorCode || 'A11_JWT_Invalid',
        message: message || `Session A11 invalide (${res.status})`,
        status: res.status,
      });
    }

    const authError = new Error(message || errorCode || `Session A11 invalide (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    authError.code = errorCode || 'A11_JWT_Invalid';
    authError.status = res.status;
    throw authError;
  }
}

async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const tokenAtStart = getAuthToken();
  const res = await fetch(input, {
    credentials: 'include',
    ...init,
  });
  if (
    res.status === 401
    && tokenAtStart
    && isFunesterieSessionHost()
    && hasAuthorizationHeader(init?.headers)
  ) {
    const retry = await fetch(input, {
      ...init,
      credentials: 'include',
      headers: stripAuthorizationHeader(init?.headers),
    });
    if (retry.ok) {
      clearAuthToken();
      return retry;
    }
    await throwIfAuthInvalidResponse(retry, tokenAtStart);
    return retry;
  }
  await throwIfAuthInvalidResponse(res, tokenAtStart);
  return res;
}

export function getTtsApiUrl() {
  return import.meta.env.VITE_TTS_API || getApiUrl('/api/tts/speak');
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollTtsJob(statusUrl: string, timeoutMs = 180000) {
  const deadline = Date.now() + Math.max(10000, timeoutMs);
  let delayMs = 1200;
  while (Date.now() < deadline) {
    await wait(delayMs);
    const response = await fetch(getApiUrl(statusUrl), {
      method: 'GET',
      credentials: 'include',
      headers: buildAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    const state = String(payload?.state || payload?.status || '').toLowerCase();

    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `TTS job indisponible (${response.status})`);
    }
    if (state === 'done' || state === 'complete' || state === 'completed') {
      return payload?.result || payload;
    }
    if (state === 'failed' || state === 'error') {
      const result = payload?.result || {};
      throw new Error(payload?.message || result?.message || payload?.error || result?.error || 'tts_job_failed');
    }
    delayMs = Math.min(5000, delayMs + 600);
  }
  throw new Error('tts_job_timeout');
}

export const TTS_VOICES = [
  'fr_FR-siwis-medium',
  'en_US-lessac-medium',
  'it_IT-paola-medium',
  'es_ES-sharvard-medium',
  'de_DE-thorsten-medium',
];

export type TtsVoiceReference = {
  id: string;
  label: string;
  scope?: string;
  source?: string;
  catalog?: {
    enabled?: boolean;
    status?: string;
    name?: string;
    slug?: string;
    consent?: string;
    contractVersion?: string;
    allowedUses?: string[];
    consumerTier?: string;
    rawAudioPublic?: boolean;
    ownerRetainsRights?: boolean;
    consentedAt?: string | null;
  } | null;
  mimeType?: string | null;
  originalName?: string | null;
  bytes?: number;
  analysis?: {
    ok?: boolean;
    kind?: string;
    durationMs?: number;
    sampleRate?: number;
    channels?: number;
    loudnessDb?: number;
    reason?: string;
  } | null;
  createdAt?: string | null;
};

export async function fetchTtsVoiceReferences(): Promise<TtsVoiceReference[]> {
  if (hasLocalDevBypassSession()) return [];

  const res = await authFetch(getApiUrl('/api/tts/references'), {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `References voix indisponibles (${res.status})`);
  }
  return Array.isArray(payload?.references) ? payload.references : [];
}

export async function fetchTtsVoiceCatalog(): Promise<{
  canUse: boolean;
  consent?: string;
  voices: TtsVoiceReference[];
  message?: string;
}> {
  if (hasLocalDevBypassSession()) return { canUse: true, voices: [] };

  const res = await authFetch(getApiUrl('/api/tts/voice-catalog'), {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Catalogue voix indisponible (${res.status})`);
  }
  return {
    canUse: payload?.canUse === true,
    consent: typeof payload?.consent === 'string' ? payload.consent : undefined,
    voices: Array.isArray(payload?.voices) ? payload.voices : [],
    message: typeof payload?.message === 'string' ? payload.message : undefined,
  };
}

export async function uploadTtsVoiceReference(
  file: File,
  label?: string,
  scope: 'private' | 'family' | 'catalog' = 'private',
  options?: {
    catalogName?: string;
    consent?: string;
  }
): Promise<{ reference: TtsVoiceReference; references: TtsVoiceReference[] }> {
  const form = new FormData();
  form.append('voiceReference', file);
  if (label) form.append('label', label);
  if (scope) form.append('scope', scope);
  if (options?.catalogName) form.append('catalogName', options.catalogName);
  if (options?.consent) form.append('consent', options.consent);

  const res = await authFetch(getApiUrl('/api/tts/references'), {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Upload reference voix impossible (${res.status})`);
  }
  return {
    reference: payload.reference,
    references: Array.isArray(payload.references) ? payload.references : [],
  };
}

export async function deleteTtsVoiceReference(id: string): Promise<TtsVoiceReference[]> {
  const res = await authFetch(getApiUrl(`/api/tts/references/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Suppression reference voix impossible (${res.status})`);
  }
  return Array.isArray(payload.references) ? payload.references : [];
}

export type SttTranscriptionResult = {
  ok: boolean;
  text: string;
  language?: string | null;
  duration?: number | null;
  provider?: string | null;
  model?: string | null;
  elapsed?: number | null;
};

export async function transcribeAudioFile(
  file: File,
  options?: {
    language?: string;
    provider?: 'auto' | 'faster-whisper' | 'ollama' | 'openai';
    durationMs?: number | null;
    dbfs?: number | null;
    peak?: number | null;
  }
): Promise<SttTranscriptionResult> {
  const form = new FormData();
  form.append('audio', file);
  if (options?.language) form.append('language', options.language);
  if (options?.provider) form.append('provider', options.provider);
  if (Number.isFinite(Number(options?.durationMs))) form.append('durationMs', String(Math.round(Number(options?.durationMs))));
  if (Number.isFinite(Number(options?.dbfs))) form.append('dbfs', String(Number(options?.dbfs).toFixed(1)));
  if (Number.isFinite(Number(options?.peak))) form.append('peak', String(Number(options?.peak).toFixed(5)));

  const res = await authFetch(getApiUrl('/api/stt/transcribe'), {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Transcription audio impossible (${res.status})`);
  }
  return {
    ok: true,
    text: String(payload?.text || '').trim(),
    language: payload?.language || null,
    duration: payload?.duration ?? null,
    provider: payload?.provider || null,
    model: payload?.model || null,
    elapsed: payload?.elapsed ?? null,
  };
}

export type VoiceLearningStatus = {
  ok: boolean;
  enabled?: boolean;
  canCapture?: boolean;
  persona?: string | null;
  consentRequired?: boolean;
  consent?: string;
  isOfficialSource?: boolean;
  contributorRole?: 'official-source' | 'opt-in-user' | string;
  voiceIdentityKey?: string;
  voiceIdentityLabel?: string;
  voiceStyle?: string;
  minimumTier?: string;
  clipCount?: number;
  secondsCollected?: number;
  requiredSeconds?: number;
  corpusReady?: boolean;
  totalBytes?: number;
  lastClipAt?: string | null;
  queuedTrainingCount?: number;
  duplicate?: boolean;
  clipId?: string;
  message?: string;
  nextAction?: string;
  deleted?: boolean;
};

export async function fetchVoiceLearningStatus(persona: 'a11' | 'kaen44' | string): Promise<VoiceLearningStatus> {
  const query = persona ? `?persona=${encodeURIComponent(persona)}` : '';
  const res = await authFetch(getApiUrl(`/api/voice-learning/status${query}`), {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Statut apprentissage voix indisponible (${res.status})`);
  }
  return payload as VoiceLearningStatus;
}

export async function uploadVoiceLearningSnippet(
  file: File,
  options: {
    persona: 'a11' | 'kaen44' | string;
    durationMs?: number;
    transcript?: string;
    source?: string;
    consent?: string;
  }
): Promise<VoiceLearningStatus> {
  const form = new FormData();
  form.append('audio', file);
  form.append('persona', options.persona);
  form.append('source', options.source || 'micro');
  form.append('consent', options.consent || 'voice-learning-v1');
  if (Number.isFinite(Number(options.durationMs)) && Number(options.durationMs) > 0) {
    form.append('durationMs', String(Math.round(Number(options.durationMs))));
  }
  if (options.transcript) form.append('transcript', options.transcript);

  const res = await authFetch(getApiUrl('/api/voice-learning/snippet'), {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Capture voix impossible (${res.status})`);
  }
  return payload as VoiceLearningStatus;
}

export type DoubleHarmonicProcessMode = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v71' | 'v8' | 'v8plus' | 'v8pivot' | 'v9turbo';
export type DoubleHarmonicOutputFormat = 'source' | 'flac' | 'mp3' | 'm4a' | 'wav';

export type DoubleHarmonicProcessResult = {
  ok: boolean;
  id?: string;
  method?: string;
  state?: string;
  variant?: string;
  profile?: string;
  intensity?: number | string;
  audioUrl?: string;
  shareUrl?: string;
  contentType?: string;
  filename?: string;
  bytes?: number;
  weights?: {
    dry?: number;
    high?: number;
    low?: number;
    highBase?: number;
    lowBase?: number;
    weightScale?: number;
    highMin?: number;
    highMax?: number;
    lowMin?: number;
    lowMax?: number;
    ratio?: number;
    lowGrainMultiplier?: number;
    highGrainPower?: number;
    highPitch?: number;
    lowPitch?: number;
    dynamicMin?: number;
    dynamicMax?: number;
    dynamicMean?: number;
  };
  dynamic?: {
    frameMs?: number;
    summary?: {
      frames?: number;
      framesReturned?: number;
      durationSeconds?: number;
      dbMin?: number;
      dbMax?: number;
      dbMean?: number;
      weightMin?: number;
      weightMax?: number;
      weightMean?: number;
    };
  };
  phase?: {
    score?: number;
    delaySamples?: number;
    delayMs?: number;
    correctionRadians?: number;
    mgPhase?: number;
  };
  grain?: {
    mode?: string;
    active?: {
      low?: number;
      high?: number;
      product?: number;
      productGapToHalf?: number;
    };
  };
  binaryGrid?: {
    measuredSlotsPerSecond?: number;
    measuredGapTo1024?: number;
    grainProduct?: number;
    grainProductGapToHalf?: number;
  };
  analysis?: {
    summary?: {
      frames?: number;
      voicedFrames?: number;
      medianF0?: number;
      meanF0Confidence?: number;
      transientFrames?: number;
    };
  };
  publicSummary?: string;
  message?: string;
};

export async function processDoubleHarmonicAudio(
  file: File,
  options?: {
    profile?: 'blend' | 'prime3' | 'prime11' | string;
    intensity?: number;
    format?: DoubleHarmonicOutputFormat | string;
    name?: string;
    mode?: DoubleHarmonicProcessMode;
    lowGrainMultiplier?: number;
    highGrainPower?: number;
    minBricks?: number;
    maxBricks?: number;
    brickInfluence?: number;
    binaryGrid?: string;
  }
): Promise<DoubleHarmonicProcessResult> {
  const form = new FormData();
  form.append('audio', file);
  form.append('profile', options?.profile || 'blend');
  if (options?.format) {
    form.append('format', options.format);
  }
  if ((options?.mode === 'v1' || options?.mode === 'v2' || options?.mode === 'v4' || options?.mode === 'v5' || options?.mode === 'v6' || options?.mode === 'v7' || options?.mode === 'v71' || options?.mode === 'v8' || options?.mode === 'v8plus' || options?.mode === 'v8pivot' || options?.mode === 'v9turbo' || !options?.mode) && Number.isFinite(Number(options?.intensity))) {
    form.append('intensity', String(options?.intensity));
  }
  if (Number.isFinite(Number(options?.lowGrainMultiplier))) {
    form.append('lowGrainMultiplier', String(options?.lowGrainMultiplier));
  }
  if (Number.isFinite(Number(options?.highGrainPower))) {
    form.append('highGrainPower', String(options?.highGrainPower));
  }
  if (Number.isFinite(Number(options?.minBricks))) {
    form.append('minBricks', String(options?.minBricks));
  }
  if (Number.isFinite(Number(options?.maxBricks))) {
    form.append('maxBricks', String(options?.maxBricks));
  }
  if (Number.isFinite(Number(options?.brickInfluence))) {
    form.append('brickInfluence', String(options?.brickInfluence));
  }
  if (options?.binaryGrid) {
    form.append('binaryGrid', options.binaryGrid);
  }
  if (options?.name) form.append('name', options.name);

  const endpoint = options?.mode === 'v9turbo'
    ? '/api/double-harmonic/v9turbo/process'
    : options?.mode === 'v8pivot'
      ? '/api/double-harmonic/v8pivot/process'
      : options?.mode === 'v8plus'
        ? '/api/double-harmonic/v8plus/process'
        : options?.mode === 'v8'
          ? '/api/double-harmonic/v8/process'
          : options?.mode === 'v71'
            ? '/api/double-harmonic/v71/process'
            : options?.mode === 'v7'
              ? '/api/double-harmonic/v7/process'
              : options?.mode === 'v6'
                ? '/api/double-harmonic/v6/process'
                : options?.mode === 'v5'
                  ? '/api/double-harmonic/v5/process'
                  : options?.mode === 'v4'
                    ? '/api/double-harmonic/v4/process'
                    : options?.mode === 'v3'
                      ? '/api/double-harmonic/v3/process'
                      : options?.mode === 'v2'
                        ? '/api/double-harmonic/v2/process'
                        : '/api/double-harmonic/process';
  const res = await authFetch(getApiUrl(endpoint), {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Traitement D40 impossible (${res.status})`);
  }
  return payload as DoubleHarmonicProcessResult;
}

export async function deleteVoiceLearningCorpus(persona: 'a11' | 'kaen44' | string): Promise<VoiceLearningStatus> {
  const res = await authFetch(getApiUrl('/api/voice-learning/corpus'), {
    method: 'DELETE',
    headers: buildAuthHeaders('application/json'),
    credentials: 'include',
    body: JSON.stringify({ persona, confirm: 'delete-voice-learning-corpus' }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Retrait corpus voix impossible (${res.status})`);
  }
  return payload as VoiceLearningStatus;
}

export async function queueVoiceLearningTraining(persona: 'a11' | 'kaen44' | string): Promise<VoiceLearningStatus> {
  const res = await authFetch(getApiUrl('/api/voice-learning/train'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    credentials: 'include',
    body: JSON.stringify({ persona, consent: 'voice-learning-v1' }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Entrainement voix impossible (${res.status})`);
  }
  return payload as VoiceLearningStatus;
}

export type VivyStudioMode = 'voice' | 'song' | 'share';
export type VivyChatMode = 'chat' | VivyStudioMode;

export type VivyStudioAction = {
  id: string;
  label: string;
  target: string;
  ready: boolean;
};

export type VivyStudioMedia = {
  kind?: 'audio' | 'video' | string;
  provider?: string;
  mode?: string;
  state?: string;
  status?: string;
  taskId?: string;
  jobId?: string;
  title?: string;
  url?: string;
  audioUrl?: string;
  audio_url?: string;
  videoUrl?: string;
  video_url?: string;
  content_type?: string;
  filename?: string;
};

export type VivyDoubleHarmonicNavigation = {
  equation?: string;
  branchId?: string;
  branchSymbol?: string;
  branchLabel?: string;
  branchReal?: number;
  branchImaginary?: number;
  h1Real?: number;
  h2Imaginary?: number;
  accelerationK?: number;
  coherenceM?: number;
  deltaReal?: number;
  deltaImaginary?: number;
  nextReal?: number;
  nextImaginary?: number;
};

export type VivyDoubleHarmonicSegment = {
  id?: string;
  segmentId?: string;
  order?: number;
  label?: string;
  roleId?: string;
  roleLabel?: string;
  audio?: {
    phase?: number;
    tempoBpm?: number;
    subdivision?: string;
    energy?: number;
    grain?: number;
    breathMs?: number;
  };
  semantic?: {
    phase?: number;
    weight?: number;
    anchors?: string[];
    forceSignature?: string;
  };
  sync?: {
    state?: string;
    delta?: number;
    triState?: string;
    gain?: number;
    instruction?: string;
  };
  navigation?: VivyDoubleHarmonicNavigation;
  control?: string;
};

export type VivyChatFileAttachment = {
  id?: string;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
  url?: string;
  downloadUrl?: string;
  description?: string;
  textPreview?: string;
  visualDescription?: string;
  analysisSummary?: string;
  analysis?: Record<string, unknown> | null;
  uploaded?: boolean;
};

export type VivyStudioProductionInput = {
  mode: VivyStudioMode;
  language?: string;
  message?: string;
  prompt?: string;
  text?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; ts?: string }>;
  conversationId?: string;
  files?: VivyChatFileAttachment[];
  voiceTool?: string;
  voiceInstruction?: string;
  voiceFileName?: string;
  voiceReferenceId?: string;
  voiceReferenceName?: string;
  voiceCatalogName?: string;
  voiceCatalogConsent?: string;
  songSource?: string;
  songArtists?: string[];
  vocalCast?: string;
  artistCount?: number;
  singerCount?: number;
  songMood?: string;
  songText?: string;
  sessionSunoApiKey?: string;
  shareTarget?: string;
  shareUrl?: string;
  shareTokenPresent?: boolean;
  shareInstruction?: string;
  disableEmergencyMedia?: boolean;
  allowPlaceholderMedia?: boolean;
  forceRealMusic?: boolean;
  generateMusic?: boolean;
  makeSong?: boolean;
  durationSeconds?: number;
};

export type VivyStudioProductionResult = {
  ok: boolean;
  service?: string;
  mode?: VivyChatMode;
  title?: string;
  summary?: string;
  assistant?: string;
  content?: string;
  brief?: string;
  actions?: VivyStudioAction[];
  routing?: string[];
  media?: VivyStudioMedia;
  prosody?: {
    schema?: string;
    id?: string;
    model?: string;
    summary?: string;
    cast?: Record<string, unknown>;
    primeSignature?: number[];
    complexBasis?: Record<string, unknown>;
    doubleHarmonic?: {
      schema?: string;
      id?: string;
      summary?: string;
      avgTempoBpm?: number;
      lockRatio?: number;
      dominantAnchors?: string[];
      controlTags?: string[];
      segments?: VivyDoubleHarmonicSegment[];
    };
    neo4j?: Record<string, unknown>;
    segments?: Array<Record<string, unknown>>;
  };
  audioUrl?: string;
  audio_url?: string;
  videoUrl?: string;
  video_url?: string;
  mediaStatus?: {
    state?: string;
    provider?: string;
    taskId?: string;
    jobId?: string;
    status?: string;
    reason?: string;
    message?: string;
  };
  musicJob?: {
    provider?: string;
    taskId?: string;
    jobId?: string;
    state?: string;
    status?: string;
  };
  tokenStored?: boolean;
  aiMode?: 'llm' | 'fallback' | string;
  model?: string;
  memoryStored?: boolean;
  semanticMemory?: {
    stored?: boolean;
    episodeId?: string | null;
    totalEpisodes?: number;
  };
  visionContext?: Array<{
    filename?: string;
    reliable?: boolean;
    provider?: string;
    observation?: string;
  }>;
  localContext?: {
    roots?: Array<Record<string, unknown>>;
    runtimeDirs?: string[];
    janus?: Record<string, unknown> | null;
    searchTerms?: string[];
    matches?: Array<Record<string, unknown>>;
  } | null;
  files?: VivyChatFileAttachment[];
  error?: string;
  message?: string;
};

export async function runVivyStudioProduction(
  input: VivyStudioProductionInput
): Promise<VivyStudioProductionResult> {
  const res = await authFetch(getApiUrl('/api/vivy/studio/produce'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    credentials: 'include',
    body: JSON.stringify({
      ...input,
      language: normalizeAccountLanguage(input.language || getAuthAccountLanguage('fr')),
      shareToken: undefined,
      shareTokenPresent: Boolean(input.shareTokenPresent),
      allowPlaceholderMedia: input.allowPlaceholderMedia === true,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Vivy Studio indisponible (${res.status})`);
  }
  return payload as VivyStudioProductionResult;
}

export async function getVivyStudioMusicJob(taskId: string, sessionSunoApiKey?: string): Promise<VivyStudioProductionResult> {
  const safeTaskId = String(taskId || '').trim();
  if (!safeTaskId) throw new Error('job_vivy_manquant');
  const headers = buildAuthHeaders();
  const safeSessionKey = String(sessionSunoApiKey || '').trim();
  if (safeSessionKey) headers['X-Vivy-Suno-Key'] = safeSessionKey;
  const res = await authFetch(getApiUrl(`/api/vivy/studio/jobs/${encodeURIComponent(safeTaskId)}`), {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Job Vivy indisponible (${res.status})`);
  }
  return payload as VivyStudioProductionResult;
}

export async function chatWithVivy(
  input: {
    message?: string;
    history?: VivyStudioProductionInput['history'];
    mode?: VivyChatMode;
    language?: string;
    conversationId?: string;
    files?: VivyChatFileAttachment[];
  }
): Promise<VivyStudioProductionResult> {
  const res = await authFetch(getApiUrl('/api/vivy/studio/chat'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    credentials: 'include',
    body: JSON.stringify({
      ...input,
      language: normalizeAccountLanguage(input.language || getAuthAccountLanguage('fr')),
      shareToken: undefined,
      shareTokenPresent: false,
      disableEmergencyMedia: true,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `Chat Vivy indisponible (${res.status})`);
  }
  return payload as VivyStudioProductionResult;
}

export type Provider = "local" | "ollama" | "openai" | "groq";

const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

export function getModelForProvider(provider: Provider): string {
  switch (provider) {
    case 'groq':
      return DEFAULT_GROQ_MODEL;
    case 'openai':
      return 'meta-llama/llama-3.3-70b-instruct';
    case 'ollama':
      return DEFAULT_OLLAMA_MODEL;
    case 'local':
    default:
      return DEFAULT_OLLAMA_MODEL;
  }
}

export type Msg = { role: "user" | "assistant" | "system"; content: string; ts?: string };
export type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  content?: string;
  output?: string;
};

export type ChatCompletionResult = {
  content: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  a11Agent?: any;
  qflushVerification?: {
    suspicious?: boolean;
    summary?: string;
    mode?: string | null;
    rawContent?: string;
    verification?: any;
  } | null;
  createdAt?: string;
  raw?: any;
};

function extractImageUrlFromA11Agent(agent: any): string | null {
  if (!agent || typeof agent !== "object") return null;

  const direct = resolveApiAssetUrl(
    agent?.imagePath ||
    agent?.imageUrl ||
    agent?.image_url ||
    null
  );
  if (direct) return direct;

  const candidates = Array.isArray(agent?.results)
    ? agent.results
    : (Array.isArray(agent?.actions) ? agent.actions : []);

  for (const entry of candidates) {
    const result = entry?.result && typeof entry.result === "object" ? entry.result : {};
    const maybeUrl = resolveApiAssetUrl(
      result?.file?.downloadUrl ||
      result?.file?.url ||
      result?.conversationResource?.downloadUrl ||
      result?.conversationResource?.url ||
      result?.image_url ||
      result?.imageUrl ||
      result?.url ||
      null
    );
    const filename = String(
      result?.file?.filename ||
      result?.conversationResource?.filename ||
      result?.image_url ||
      result?.imageUrl ||
      ''
    ).trim();
    const contentType = String(
      result?.file?.contentType ||
      result?.conversationResource?.contentType ||
      result?.contentType ||
      ''
    ).trim().toLowerCase();
    const artifactType = String(
      result?.artifact_type ||
      entry?.artifact_type ||
      ''
    ).trim().toLowerCase();
    const looksImage = contentType.startsWith('image/')
      || artifactType === 'image'
      || artifactType === 'web_image'
      || artifactType === 'image_search'
      || /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(filename)
      || /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(String(maybeUrl || ''));
    if (maybeUrl && looksImage) {
      return maybeUrl;
    }
  }

  return null;
}

function extractImageUrlFromPayload(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;

  const direct = resolveApiAssetUrl(
    payload?.imagePath ||
    payload?.imageUrl ||
    payload?.image_url ||
    payload?.url ||
    null
  );

  const directArtifactType = String(
    payload?.artifact_type ||
    payload?.kind ||
    ''
  ).trim().toLowerCase();

  const directContentType = String(
    payload?.contentType ||
    ''
  ).trim().toLowerCase();

  const directFilename = String(
    payload?.filename ||
    ''
  ).trim();

  const directLooksImage = directContentType.startsWith('image/')
    && directContentType !== 'image/gif'
    || directArtifactType === 'image'
    || directArtifactType === 'web_image'
    || directArtifactType === 'image_search'
    || /\.(?:png|jpe?g|webp|bmp|svg)(?:[?#].*)?$/i.test(directFilename)
    || /\.(?:png|jpe?g|webp|bmp|svg)(?:[?#].*)?$/i.test(String(direct || ''))
    || ((directArtifactType === 'image' || directArtifactType === 'web_image') && /\.gif(?:[?#].*)?$/i.test(String(direct || directFilename || '')));

  if (direct && directLooksImage) return direct;

  const results = Array.isArray(payload?.results)
    ? payload.results
    : (Array.isArray(payload?.a11Agent?.results) ? payload.a11Agent.results : []);

  for (const entry of results) {
    const result = entry?.result && typeof entry.result === "object" ? entry.result : entry;
    const candidate = resolveApiAssetUrl(
      result?.imagePath ||
      result?.imageUrl ||
      result?.image_url ||
      result?.url ||
      null
    );
    const artifactType = String(
      result?.artifact_type ||
      entry?.artifact_type ||
      ''
    ).trim().toLowerCase();
    const contentType = String(
      result?.contentType ||
      ''
    ).trim().toLowerCase();
    const filename = String(
      result?.filename ||
      ''
    ).trim();
    const looksImage = contentType.startsWith('image/')
      && contentType !== 'image/gif'
      || artifactType === 'image'
      || artifactType === 'web_image'
      || artifactType === 'image_search'
      || /\.(?:png|jpe?g|webp|bmp|svg)(?:[?#].*)?$/i.test(filename)
      || /\.(?:png|jpe?g|webp|bmp|svg)(?:[?#].*)?$/i.test(String(candidate || ''))
      || ((artifactType === 'image' || artifactType === 'web_image') && /\.gif(?:[?#].*)?$/i.test(String(candidate || filename || '')));
    if (candidate && looksImage) {
      return candidate;
    }
  }

  return extractImageUrlFromA11Agent(payload?.a11Agent || null);
}

function extractFileUrlFromPayload(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;

  const direct = resolveApiAssetUrl(
    payload?.file_url ||
    payload?.filePath ||
    payload?.shared?.downloadUrl ||
    payload?.shared?.url ||
    payload?.conversationResource?.downloadUrl ||
    payload?.conversationResource?.url ||
    null
  );

  const directArtifactType = String(
    payload?.artifact_type ||
    payload?.kind ||
    ''
  ).trim().toLowerCase();

  const directContentType = String(
    payload?.contentType ||
    payload?.shared?.contentType ||
    payload?.conversationResource?.contentType ||
    ''
  ).trim().toLowerCase();

  const directFilename = String(
    payload?.filename ||
    payload?.shared?.filename ||
    payload?.conversationResource?.filename ||
    ''
  ).trim();

  const directLooksPdf = directContentType === 'application/pdf'
    || directArtifactType === 'pdf'
    || /\.pdf(?:[?#].*)?$/i.test(directFilename)
    || /\.pdf(?:[?#].*)?$/i.test(String(direct || ''));

  if (direct && directLooksPdf) return direct;

  const entries = Array.isArray(payload?.a11Agent?.results)
    ? payload.a11Agent.results
    : [];

  for (const entry of entries) {
    const result = entry?.result && typeof entry.result === "object" ? entry.result : {};
    const candidate = resolveApiAssetUrl(
      result?.file?.downloadUrl ||
      result?.file?.url ||
      result?.conversationResource?.downloadUrl ||
      result?.conversationResource?.url ||
      result?.url ||
      null
    );
    const artifactType = String(
      result?.artifact_type ||
      entry?.artifact_type ||
      ''
    ).trim().toLowerCase();
    const contentType = String(
      result?.file?.contentType ||
      result?.conversationResource?.contentType ||
      result?.contentType ||
      ''
    ).trim().toLowerCase();
    const filename = String(
      result?.file?.filename ||
      result?.conversationResource?.filename ||
      ''
    ).trim();
    const looksPdf = contentType === 'application/pdf'
      || artifactType === 'pdf'
      || /\.pdf(?:[?#].*)?$/i.test(filename)
      || /\.pdf(?:[?#].*)?$/i.test(String(candidate || ''));
    if (candidate && looksPdf) {
      return candidate;
    }
  }

  return null;
}

function extractVideoUrlFromPayload(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;

  const direct = resolveApiAssetUrl(
    payload?.video_url ||
    payload?.videoUrl ||
    payload?.videoPath ||
    payload?.url ||
    null
  );

  const directArtifactType = String(
    payload?.artifact_type ||
    payload?.kind ||
    ''
  ).trim().toLowerCase();

  const directContentType = String(
    payload?.contentType ||
    ''
  ).trim().toLowerCase();

  const directFilename = String(
    payload?.filename ||
    ''
  ).trim();

  const directLooksVideo = directContentType.startsWith('video/')
    || directArtifactType === 'video'
    || /\.(?:mp4|webm|mov|avi|mkv|gif)(?:[?#].*)?$/i.test(directFilename)
    || /\.(?:mp4|webm|mov|avi|mkv|gif)(?:[?#].*)?$/i.test(String(direct || ''));

  if (direct && directLooksVideo) return direct;

  const entries = Array.isArray(payload?.a11Agent?.results)
    ? payload.a11Agent.results
    : [];

  for (const entry of entries) {
    const result = entry?.result && typeof entry.result === "object" ? entry.result : {};
    const candidate = resolveApiAssetUrl(
      result?.video_url ||
      result?.videoUrl ||
      result?.videoPath ||
      result?.url ||
      null
    );
    const artifactType = String(
      result?.artifact_type ||
      entry?.artifact_type ||
      ''
    ).trim().toLowerCase();
    const contentType = String(
      result?.contentType ||
      ''
    ).trim().toLowerCase();
    const filename = String(
      result?.filename ||
      ''
    ).trim();
    const looksVideo = contentType.startsWith('video/')
      || artifactType === 'video'
      || /\.(?:mp4|webm|mov|avi|mkv|gif)(?:[?#].*)?$/i.test(filename)
      || /\.(?:mp4|webm|mov|avi|mkv|gif)(?:[?#].*)?$/i.test(String(candidate || ''));
    if (candidate && looksVideo) {
      return candidate;
    }
  }

  return null;
}

function tryParseJsonString(rawValue: unknown) {
  if (typeof rawValue !== 'string') return null;
  const raw = rawValue.trim();
  if (!raw) return null;
  const directCandidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || raw;
  const candidate = directCandidate.startsWith('{') || directCandidate.startsWith('[')
    ? directCandidate
    : (() => {
      const firstBrace = directCandidate.indexOf('{');
      const lastBrace = directCandidate.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return directCandidate.slice(firstBrace, lastBrace + 1).trim();
      }
      return '';
    })();
  if (!candidate || !/^[\[{]/.test(candidate)) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractJsonishField(rawValue: unknown, fieldName: string) {
  const raw = typeof rawValue === 'string' ? rawValue : '';
  if (!raw) return '';
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'is');
  const match = regex.exec(raw);
  if (!match?.[1]) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function isLikelyHtmlDocument(rawValue: unknown) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  return /^<!doctype html/i.test(raw) || /^<html/i.test(raw);
}

function buildFriendlyChatApiErrorMessage(status: number, rawValue: unknown) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  let parsed: any = null;
  if (raw && !isLikelyHtmlDocument(raw)) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const serverMessage = String(
    parsed?.message
    || parsed?.error_description
    || parsed?.error?.message
    || (typeof parsed?.error === 'string' ? parsed.error : '')
    || ''
  ).trim();
  const combinedMessage = `${serverMessage}\n${raw}`;
  if (/video_engine_unavailable|generateVideo handler unavailable|real_video_unavailable|video_proxy_fetch_unavailable|local video runner|mochi|A11_VIDEO_LOCAL_RUNNER/i.test(combinedMessage)) {
    return "Le moteur vidéo local n'est pas encore prêt: le routage est actif, mais le worker de rendu vidéo n'est pas lancé ou pas branché. Les poids locaux sont installés; il faut démarrer le runner vidéo avant de lancer le clip.";
  }
  const statusCode = Number(status || parsed?.status || parsed?.statusCode || 0);
  const isOverload = [429, 502, 503, 504, 524].includes(statusCode)
    || /cloudflare|timeout|surcharge|overload|upstream|html inattendue/i.test(raw)
    || isLikelyHtmlDocument(raw);
  if (serverMessage) return serverMessage;
  if (isOverload) {
    return "Le serveur IA ou un fournisseur externe a coupé la réponse. Réessaie dans quelques instants; la priorité de ton compte reste conservée.";
  }
  return `API ${statusCode || status}: ${raw || 'réponse assistant indisponible'}`;
}

function shouldLogRawChatPayload() {
  if (import.meta.env?.DEV) return true;
  try {
    return globalThis.localStorage?.getItem('a11:debug-raw-chat') === '1';
  } catch {
    return false;
  }
}

function extractAssistantContentFromPayload(payload: unknown, depth = 0): string {
  if (depth > 5 || payload == null) return '';

  if (typeof payload === 'string') {
    const raw = payload.trim();
    if (!raw || isLikelyHtmlDocument(raw)) return '';
    const parsed = tryParseJsonString(raw);
    if (parsed) {
      if (typeof parsed === 'object' && parsed && (parsed as any).mode === 'actions' && Array.isArray((parsed as any).actions)) {
        return '';
      }
      const nested = extractAssistantContentFromPayload(parsed, depth + 1);
      if (nested) return nested;
    }
    const answerField = extractJsonishField(raw, 'answer') || extractJsonishField(raw, 'question') || extractJsonishField(raw, 'content');
    if (answerField) return answerField.trim();
    return raw;
  }

  if (typeof payload !== 'object') {
    return '';
  }

  const candidate = payload as any;

  if (candidate.mode === 'actions' && Array.isArray(candidate.actions)) {
    return '';
  }

  if (typeof candidate.explanation === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.explanation, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.text === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.text, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.reply === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.reply, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.assistant === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.assistant, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.response === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.response, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.output === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.output, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.answer === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.answer, depth + 1);
    if (extracted) return extracted;
  }

  if (typeof candidate.content === 'string') {
    const extracted = extractAssistantContentFromPayload(candidate.content, depth + 1);
    if (extracted) return extracted;
  }

  if (candidate.message && typeof candidate.message === 'object') {
    const extracted = extractAssistantContentFromPayload(candidate.message.content, depth + 1);
    if (extracted) return extracted;
  }

  if (Array.isArray(candidate.choices)) {
    for (const choice of candidate.choices) {
      const extracted = extractAssistantContentFromPayload(choice?.message?.content ?? choice?.delta?.content, depth + 1);
      if (extracted) return extracted;
    }
  }

  if (Array.isArray(candidate.messages)) {
    const assistantMessage = [...candidate.messages]
      .reverse()
      .find((entry) => entry?.role === 'assistant' && typeof entry?.content === 'string');
    const extracted = extractAssistantContentFromPayload(assistantMessage?.content, depth + 1);
    if (extracted) return extracted;
  }

  if (candidate.raw != null) {
    const extracted = extractAssistantContentFromPayload(candidate.raw, depth + 1);
    if (extracted) return extracted;
  }

  return '';
}

function looksLikeInternalAssistantLeak(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/<\|(?:start|message|channel|end)\|>/i.test(raw)) return true;
  if (/(?:analysis){2,}|(?:commentary){2,}/i.test(raw)) return true;
  if (/\b(?:analysis|commentary|final)\b.{0,80}<\|/i.test(raw)) return true;

  const metaHits = [
    /\bwe need to (?:answer|respond|produce|call|search|use)\b/i,
    /\bwe just answer\b/i,
    /\bthe user (?:wants|asks|said|typed|is asking)\b/i,
    /\brespond in (?:french|english|spanish)\b/i,
    /\bprovide short\b/i,
    /\bwe (?:respond|answer|should|need|can respond)\b/i,
    /\blet'?s produce (?:final|the final|a final)/i,
    /\bfinal answer\b/i,
  ].reduce((count, pattern) => count + (pattern.test(raw) ? 1 : 0), 0);
  const repeatedMeta = (raw.match(/\b(?:the user wants|the user asks|the user is asking|we need|we respond|we should|we just answer|respond in french|provide short|analysis|commentary)\b/gi) || []).length;
  return metaHits >= 2 || repeatedMeta >= 5;
}

function sanitizeAssistantDisplayText(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (looksLikeInternalAssistantLeak(raw)) {
    return "";
  }
  return raw;
}

export function extractAssistantDisplayContent(payload: unknown) {
  return sanitizeAssistantDisplayText(String(extractAssistantContentFromPayload(payload) || '').trim());
}

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function dispatchBrowserEvent(event: Event) {
  try {
    globalThis.dispatchEvent(event);
  } catch {
    // ignore browser event dispatch issues
  }
}

function batAsyncSleep(ms: number, deadlineAt = 0) {
  const remaining = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : ms;
  return sleep(Math.max(250, Math.min(ms, remaining || ms)));
}

function extractAsyncMediaJobDescriptor(
  payload: any,
  options: { fallbackPollUrl?: string; maxWaitMs?: number } = {}
) {
  if (!payload || typeof payload !== "object") return null;

  const asyncJob = payload?.asyncJob && typeof payload.asyncJob === "object"
    ? payload.asyncJob
    : (payload?.a11Agent?.asyncJob && typeof payload.a11Agent.asyncJob === "object" ? payload.a11Agent.asyncJob : null);

  const status = String(asyncJob?.status || payload?.status || "").trim().toLowerCase();
  const jobId = String(asyncJob?.jobId || asyncJob?.id || payload?.jobId || "").trim();
  if (!jobId || (status !== "pending" && status !== "running" && status !== "queued")) {
    return null;
  }

  const pollUrl = String(asyncJob?.pollUrl || asyncJob?.poll_url || payload?.pollUrl || payload?.poll_url || "").trim()
    || (options.fallbackPollUrl ? `${options.fallbackPollUrl.replace(/\/$/, "")}/${encodeURIComponent(jobId)}` : `/api/llm/jobs/image/${encodeURIComponent(jobId)}`);
  const pollIntervalMs = Math.max(
    1000,
    Math.min(
      30000,
      Math.floor(Number(asyncJob?.pollIntervalMs || payload?.pollIntervalMs || 5000) || 5000)
    )
  );
  const maxPollAttempts = Math.max(
    1,
    Math.min(
      720,
      Math.floor(Number(asyncJob?.maxPollAttempts || payload?.maxPollAttempts || 72) || 72)
    )
  );
  const maxWaitMs = Math.max(
    pollIntervalMs,
    Math.min(
      3600000,
      Math.floor(Number(asyncJob?.maxWaitMs || payload?.maxWaitMs || options.maxWaitMs || maxPollAttempts * pollIntervalMs) || maxPollAttempts * pollIntervalMs)
    )
  );

  return {
    jobId,
    status,
    pollUrl,
    pollIntervalMs,
    maxPollAttempts,
    maxWaitMs,
  };
}

async function fetchAsyncMediaJobStatus(descriptor: {
  pollUrl: string;
}) {
  const pollTarget = String(descriptor?.pollUrl || "").trim();
  const url = /^https?:\/\//i.test(pollTarget) ? pollTarget : getApiUrl(pollTarget || "/api/llm/jobs/image");
  const response = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  const text = await response.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = typeof data?.message === "string" && data.message.trim()
      ? data.message.trim()
      : (typeof data?.error === "string" && data.error.trim()
        ? data.error.trim()
        : `API ${response.status}: ${text}`);
    throw new Error(message);
  }

  return data;
}

async function resolveAsyncMediaJobPayload(
  initialPayload: any,
  options: { eventPrefix?: string; fallbackPollUrl?: string; maxWaitMs?: number } = {}
) {
  const descriptor = extractAsyncMediaJobDescriptor(initialPayload, options);
  if (!descriptor) return initialPayload;

  const eventPrefix = options.eventPrefix || "image-job";
  const deadlineAt = Date.now() + descriptor.maxWaitMs;

  try {
    globalThis.localStorage?.setItem(`a11:${eventPrefix}:last`, JSON.stringify({
      ...descriptor,
      startedAt: Date.now(),
      deadlineAt,
    }));
  } catch {
    // ignore storage issues
  }

  dispatchBrowserEvent(new CustomEvent(`a11:${eventPrefix}.queued`, {
    detail: {
      jobId: descriptor.jobId,
      pollIntervalMs: descriptor.pollIntervalMs,
      maxWaitMs: descriptor.maxWaitMs,
      strategy: "bat-sleep/rome-poll",
    },
  }));

  for (let attempt = 0; attempt < descriptor.maxPollAttempts && Date.now() < deadlineAt; attempt += 1) {
    await batAsyncSleep(descriptor.pollIntervalMs, deadlineAt);
    const polled = await fetchAsyncMediaJobStatus(descriptor);
    const status = String(polled?.status || polled?.asyncJob?.status || "").trim().toLowerCase();

    if (status === "done") {
      try {
        globalThis.localStorage?.removeItem(`a11:${eventPrefix}:last`);
      } catch {
        // ignore storage issues
      }
      dispatchBrowserEvent(new CustomEvent(`a11:${eventPrefix}.done`, {
        detail: { jobId: descriptor.jobId },
      }));
      return polled?.result || polled;
    }

    if (status === "error") {
      try {
        globalThis.localStorage?.removeItem(`a11:${eventPrefix}:last`);
      } catch {
        // ignore storage issues
      }
      dispatchBrowserEvent(new CustomEvent(`a11:${eventPrefix}.failed`, {
        detail: {
          jobId: descriptor.jobId,
          message: String(polled?.message || polled?.error || `${eventPrefix}_failed`),
        },
      }));
      throw new Error(String(polled?.message || polled?.error || `${eventPrefix}_failed`));
    }
  }

  const timeoutMessage = `Timeout async apres ${Math.round(descriptor.maxWaitMs / 1000)}s`;
  dispatchBrowserEvent(new CustomEvent(`a11:${eventPrefix}.failed`, {
    detail: {
      jobId: descriptor.jobId,
      message: timeoutMessage,
    },
  }));
  throw new Error(timeoutMessage);
}

async function resolveAsyncImageJobPayload(initialPayload: any) {
  return resolveAsyncMediaJobPayload(initialPayload, {
    eventPrefix: "image-job",
    fallbackPollUrl: "/api/llm/jobs/image",
  });
}

function normalizeCreatedAt(rawValue: unknown) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    const timestamp = rawValue > 1e12 ? rawValue : rawValue * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof rawValue === 'string' && rawValue.trim()) {
    const date = new Date(rawValue);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

// Appel générique POST JSON : pass via backend auth gateway
async function apiPost(body: unknown) {
  // Route through the canonical protected backend chat endpoint.
  const url = getApiUrl('/api/llm/chat');

  const headers = buildAuthHeaders('application/json');

  const fetchOptions: any = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };

  // Use credentials for same-origin scenarios if router is same origin
  try {
    const routerUrlObj = new URL(LLM_ROUTER_URL);
    if (routerUrlObj.origin === location.origin) fetchOptions.credentials = 'include';
  } catch {
    // ignore
  }

  const chatTimeoutMs = resolveChatRequestTimeoutMs();
  let didAbortChatRequest = false;
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    didAbortChatRequest = true;
    abortController.abort();
  }, chatTimeoutMs);
  fetchOptions.signal = abortController.signal;

  try {
    const res = await authFetch(url, fetchOptions);

    // If response is an event-stream, process incrementally
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && (contentType.includes('text/event-stream') || contentType.includes('text/plain'))) {
      // Try to stream-process SSE-style responses
      try {
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buf = '';
          let aggregated = '';

          // Helper to process a full line starting with 'data:'
          const processDataLine = (line: string) => {
            const payload = line.slice(5).trim(); // after 'data:'
            if (!payload) return;
            if (payload === '[DONE]') {
              dispatchBrowserEvent(new CustomEvent('a11:assistant.done'));
              return;
            }
            let parsed = null;
            try { parsed = JSON.parse(payload); } catch { return; }
            const chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? parsed?.response ?? '';
            if (chunk) {
              aggregated += String(chunk);
              dispatchBrowserEvent(new CustomEvent('a11:assistant.delta', { detail: String(chunk) }));
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            // split on double-newline which typically separates SSE events
            let parts = buf.split(/\n\n/);
            // keep last partial in buffer
            buf = parts.pop() || '';

            for (const p of parts) {
              const lines = p.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
              for (const line of lines) {
                if (line.startsWith('data:')) {
                  if (shouldLogRawChatPayload()) {
                    console.log('[A11][RAW] 200 data:', line.slice(5).trim());
                  }
                  processDataLine(line);
                }
              }
            }
          }

          // Final flush if buffer contains a data: line
          const finalLines = buf.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of finalLines) {
            if (line.startsWith('data:')) {
              if (shouldLogRawChatPayload()) {
                console.log('[A11][RAW] 200 data:', line.slice(5).trim());
              }
              processDataLine(line);
            }
          }

          // Return OpenAI-like structure with aggregated content
          return {
            choices: [{ message: { role: 'assistant', content: aggregated } }]
          };
        }
      } catch (error_) {
        console.warn('[A11][STREAM] streaming parse failed, falling back to full read', error_);
        // fallthrough to full-text handling
      }
    }

    // Try streaming text if needed; for now read full text
    const text = await res.text();
    if (shouldLogRawChatPayload()) {
      console.log('[A11][RAW]', res.status, text);
    }

    if (!res.ok) {
      throw new Error(buildFriendlyChatApiErrorMessage(res.status, text));
    }

    let data: any;
    try {
      // Handle event-stream / SSE style responses that prefix lines with "data: {...}"
      const trimmed = text.trim();
      if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
        // Extract JSON blobs from lines starting with 'data: '
        const re = /data:\s*(\{[\s\S]*?\})(?:\s*\n|$)/g;
        let match: RegExpExecArray | null;
        let lastJsonStr: string | null = null;
        const parts: string[] = [];
        while ((match = re.exec(text)) !== null) {
          lastJsonStr = match[1];
          try {
            const parsed = JSON.parse(lastJsonStr);
            const chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? parsed?.response ?? null;
            if (chunk) parts.push(String(chunk));
          } catch {
            // ignore
          }
        }
        if (parts.length) {
          data = { choices: [{ message: { role: 'assistant', content: parts.join('') } }] };
        } else if (lastJsonStr) {
          try { data = JSON.parse(lastJsonStr); } catch { data = { raw: text }; }
        } else {
          data = { raw: text };
        }
      } else {
        data = JSON.parse(text);
      }
    } catch {
      // If parsing fails, return raw text wrapped
      if (!data) data = { raw: text };
    }

    return data;
  } catch (error_) {
    if (didAbortChatRequest || (error_ as any)?.name === 'AbortError') {
      throw new Error("Le serveur IA met trop longtemps à répondre. J'ai coupé la requête proprement; réessaie dans quelques secondes.");
    }
    throw error_;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

// Appel OpenAI-like, now accepts provider
export async function chatCompletion(
  messages: Msg[],
  provider: Provider = 'local',
  systemPromptOrOptions?: string | { turbo?: boolean; systemPrompt?: string; model?: string; conversationId?: string; providerProfileId?: string; surface?: string; persona?: string; voicePersona?: string; language?: string }
) {
  const result = await chatCompletionDetailed(messages, provider, systemPromptOrOptions);
  return result.content;
}
export async function chatCompletionDetailed(
  messages: Msg[],
  provider: Provider = 'local',
  systemPromptOrOptions?: string | { turbo?: boolean; systemPrompt?: string; model?: string; conversationId?: string; providerProfileId?: string; sourceImageUrl?: string; surface?: string; persona?: string; voicePersona?: string; language?: string }
) {
  let systemPrompt: string | undefined;
  let turboFlag = false;
  let modelOverride: string | undefined;
  let conversationId: string | undefined;
  let providerProfileId: string | undefined;
  let sourceImageUrl: string | undefined;
  let surface: string | undefined;
  let persona: string | undefined;
  let voicePersona: string | undefined;
  let language: string | undefined;
  if (typeof systemPromptOrOptions === 'string') {
    systemPrompt = systemPromptOrOptions;
  } else if (typeof systemPromptOrOptions === 'object' && systemPromptOrOptions !== null) {
    systemPrompt = systemPromptOrOptions.systemPrompt;
    turboFlag = !!systemPromptOrOptions.turbo;
    modelOverride = systemPromptOrOptions.model;
    conversationId = typeof systemPromptOrOptions.conversationId === 'string'
      ? systemPromptOrOptions.conversationId.trim()
      : undefined;
    providerProfileId = typeof systemPromptOrOptions.providerProfileId === 'string'
      ? systemPromptOrOptions.providerProfileId.trim()
      : undefined;
    sourceImageUrl = typeof systemPromptOrOptions.sourceImageUrl === 'string'
      ? systemPromptOrOptions.sourceImageUrl.trim() || undefined
      : undefined;
    surface = typeof systemPromptOrOptions.surface === 'string'
      ? systemPromptOrOptions.surface.trim().toLowerCase() || undefined
      : undefined;
    persona = typeof systemPromptOrOptions.persona === 'string'
      ? systemPromptOrOptions.persona.trim().toLowerCase() || undefined
      : undefined;
    voicePersona = typeof systemPromptOrOptions.voicePersona === 'string'
      ? systemPromptOrOptions.voicePersona.trim().toLowerCase() || undefined
      : undefined;
    language = typeof systemPromptOrOptions.language === 'string'
      ? systemPromptOrOptions.language.trim().toLowerCase() || undefined
      : undefined;
  }
  let msgs = messages;
  if (systemPrompt) {
    msgs = [{ role: 'system', content: systemPrompt }, ...messages.filter(m => m.role !== 'system')];

  }

  // Filtre les tokens spéciaux Llama (<|...|>) dans tous les messages
  msgs = msgs.map(m => ({
    ...m,
    content: typeof m.content === 'string' ? m.content.replaceAll(/<\|.*?\|>/g, '') : ''
  }));

  const payload = {
    provider,
    model: modelOverride || getModelForProvider(provider),
    messages: msgs,
    stream: false,
    temperature: turboFlag ? 0.3 : 0.7,
    top_p: 0.9,
    conversationId,
    providerProfileId,
    surface,
    persona,
    voicePersona,
    language,
    acceptAsyncImageJob: true,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  };
  // Always post to router (apiPost ignores the path and uses router endpoint)
  const initialData = await apiPost(payload);
  const data = await resolveAsyncImageJobPayload(initialData);

  const videoUrl = extractVideoUrlFromPayload(data);
  const imageUrl = videoUrl ? null : extractImageUrlFromPayload(data);
  const fileUrl = extractFileUrlFromPayload(data);
  const extractedContent = extractAssistantDisplayContent(data);
  const content = extractedContent
    || "";

  return {
    content: String(content || ''),
    imageUrl,
    videoUrl,
    fileUrl,
    a11Agent: data?.a11Agent || null,
    qflushVerification: data?.qflushVerification || null,
    createdAt: normalizeCreatedAt(data?.created) || new Date().toISOString(),
    raw: data,
  } as ChatCompletionResult;
}

// Chat simple avec prompt système et modèle choisis
export async function chat(message: string, history: Msg[] = [], provider: Provider = 'local', systemPrompt?: string) {
  const defaultSystemPrompt = String(systemPrompt || DEFAULT_A11_SYSTEM_PROMPT || '').trim();
  const messages: Msg[] = history.length ? history : [
    ...(defaultSystemPrompt ? [{ role: 'system' as const, content: defaultSystemPrompt }] : []),
    { role: 'user', content: message }
  ];
  dispatchBrowserEvent(new Event('conversation:start'));
  try {
    try {
      return await chatCompletion(messages, provider, systemPrompt);
    } catch (error) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      appendJwtHeaders(headers);
      const res = await authFetch(getApiUrl('/api/chat'), {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ message, messages, provider }),
      });
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // ignore parse failure and keep the original error if needed
      }
      if (res.ok && (data?.assistant || data?.content || data?.message)) {
        return String(data?.assistant || data?.content || data?.message || '');
      }
      throw error;
    }
  } finally {
    dispatchBrowserEvent(new Event('conversation:end'));
  }
}

function isLocalWebHost(hostname: string | null | undefined) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

// Appel TTS générique
export async function ttsSpeak(
  text: string,
  voice: string = 'fr_FR-siwis-medium',
  provider: string = 'auto',
  options: Record<string, unknown> = {}
) {
  const payload = {
    text,
    voice,
    provider,
    ...options,
  };
  // Backend route resolves the real provider server-side.
  const fetchOptions: any = {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify(payload),
  };
  // same-origin proxy should include credentials
  fetchOptions.credentials = 'include';

  const url = getApiUrl('/api/tts/speak');
  const res = await fetch(url, fetchOptions);

  // Si le backend renvoie JSON (erreur ou métadonnées)
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    // essayer de parser JSON d'erreur
    if (contentType.includes('application/json')) {
      const err = await res.json();
      throw new Error(err?.error ? String(err.error) : JSON.stringify(err));
    }
    const textErr = await res.text();
    throw new Error(textErr || `TTS request failed with status ${res.status}`);
  }

  // Si audio retourné, renvoyer une URL blob exploitable par le frontend
  if (contentType.startsWith('audio/') || contentType === 'application/octet-stream') {
    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    return { success: true, audioUrl, blob };
  }

  // Sinon on essaie le JSON (cas fournisseur distant / fallback)
  try {
    const data = await res.json();
    if (data?.async && data?.statusUrl) {
      const timeoutMs = Number(options.ttsJobTimeoutMs || options.timeoutMs || 180000);
      return pollTtsJob(String(data.statusUrl), Number.isFinite(timeoutMs) ? timeoutMs : 180000);
    }
    return data;
  } catch {
    // fallback: retourner le texte brut
    const txt = await res.text();
    return { success: true, text: txt };
  }
}

export type A11ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type A11HistoryItem = {
  id: string;
  name: string;
  updated?: string;
  messageCount?: number;
};

export type ClearA11HistoryResponse = {
  ok: boolean;
  removedFiles?: number;
  removedConversations?: number;
  id?: string;
  removed?: boolean;
  reason?: string;
  error?: string;
  message?: string;
};

export type A11ConversationResource = {
  id?: number;
  userId?: string;
  conversationId?: string | null;
  resourceKind?: string;
  origin?: string;
  filename: string;
  storageKey?: string;
  url?: string;
  downloadUrl?: string;
  contentType?: string;
  sizeBytes?: number;
  metadata?: any;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type A11UserStoredFile = {
  id?: number;
  userId?: string;
  user_id?: string;
  filename: string;
  storageKey?: string;
  storage_key?: string;
  url?: string;
  contentType?: string;
  content_type?: string;
  sizeBytes?: number;
  size_bytes?: number;
  expiresAt?: string | null;
  expires_at?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type A11ConversationActivityEntry = {
  id: string;
  type: string;
  tone?: string;
  ts?: string;
  title: string;
  summary: string;
  detail?: string;
};

export type A11AgentResponse =
  | {
    type: "text";
    content: string;
    imageUrl?: string | null;
  }
  | {
    type: "tool-result";
    tool: string;
    input: any;
    result: any;
    explanation: string;
    imageUrl?: string | null;
    actionId?: string | null;
  }
  | {
    type: "tool-error";
    tool: string;
    input: any;
    error: string;
    actionId?: string | null;
  };

export async function callA11Agent(messages: A11ChatMessage[], _devMode?: boolean): Promise<A11AgentResponse> {
  const result = await chatCompletionDetailed(messages, 'local');
  return {
    type: "text",
    content: String(result.content || ""),
    imageUrl: result.imageUrl || null,
  };
}

function appendSurfaceQuery(params: URLSearchParams, surface?: string) {
  const normalizedSurface = String(surface || '').trim().toLowerCase();
  if (normalizedSurface) params.set('surface', normalizedSurface);
}

// === A11 Conversation History (backend) ===
export async function fetchA11HistoryList(options?: { surface?: string }) {
  if (hasLocalDevBypassSession()) return [];

  // GET /api/a11/history renvoie la liste des conversations (id, name, updated...)
  const params = new URLSearchParams();
  appendSurfaceQuery(params, options?.surface);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = getApiUrl(`/api/a11/history${suffix}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement historique A-11');
  return res.json() as Promise<A11HistoryItem[]>;
}

export async function fetchA11Conversation(convId: string, options?: { surface?: string }) {
  if (hasLocalDevBypassSession()) return { ok: true, id: convId, messages: [] };

  // GET /api/a11/history/:id renvoie les messages d'une conversation
  const params = new URLSearchParams();
  appendSurfaceQuery(params, options?.surface);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = getApiUrl(`/api/a11/history/${encodeURIComponent(convId)}${suffix}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement conversation A-11');
  return res.json();
}

export async function clearA11History(convId?: string, options?: { surface?: string }) {
  const target = String(convId || '').trim();
  const params = new URLSearchParams();
  appendSurfaceQuery(params, options?.surface);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = target
    ? getApiUrl(`/api/a11/history/${encodeURIComponent(target)}${suffix}`)
    : getApiUrl(`/api/a11/history${suffix}`);
  const res = await authFetch(url, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error and use fallback below
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || 'Erreur suppression historique A-11');
  }

  return data as ClearA11HistoryResponse;
}

export async function fetchA11ConversationResources(convId: string, options?: { kind?: string; limit?: number; surface?: string }) {
  if (hasLocalDevBypassSession()) {
    return { ok: true, conversationId: convId, count: 0, resources: [] };
  }

  const params = new URLSearchParams();
  if (options?.kind) params.set('kind', options.kind);
  if (options?.limit) params.set('limit', String(options.limit));
  appendSurfaceQuery(params, options?.surface);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = getApiUrl(`/api/a11/history/${encodeURIComponent(convId)}/resources${suffix}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement ressources A-11');
  return res.json();
}

export async function fetchMyConversationResources(options?: { conversationId?: string; kind?: string; limit?: number }) {
  if (hasLocalDevBypassSession()) {
    return { ok: true, conversationId: options?.conversationId || null, count: 0, resources: [] as A11ConversationResource[] };
  }

  const params = new URLSearchParams();
  if (options?.conversationId) params.set('conversationId', options.conversationId);
  if (options?.kind) params.set('kind', options.kind);
  if (options?.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(getApiUrl(`/api/resources/my${suffix}`), {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Erreur chargement ressources (${res.status})`);
  return res.json() as Promise<{
    ok: boolean;
    conversationId?: string | null;
    count?: number;
    resources?: A11ConversationResource[];
  }>;
}

export async function fetchMyStoredFiles(options?: { limit?: number }) {
  if (hasLocalDevBypassSession()) {
    return { ok: true, count: 0, files: [] as A11UserStoredFile[] };
  }

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(getApiUrl(`/api/files/my${suffix}`), {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Erreur chargement fichiers (${res.status})`);
  return res.json() as Promise<{
    ok: boolean;
    count?: number;
    files?: A11UserStoredFile[];
  }>;
}

export async function fetchA11ConversationActivity(convId: string, options?: { limit?: number; surface?: string }) {
  if (hasLocalDevBypassSession()) {
    return { ok: true, conversationId: convId, count: 0, entries: [] };
  }

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  appendSurfaceQuery(params, options?.surface);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = getApiUrl(`/api/a11/history/${encodeURIComponent(convId)}/activity${suffix}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement activite A-11');
  return res.json() as Promise<{
    ok: boolean;
    conversationId?: string | null;
    count?: number;
    entries?: A11ConversationActivityEntry[];
  }>;
}

function encodeTextAsDataUrl(text: string, contentType = 'text/plain;charset=utf-8') {
  const bytes = new TextEncoder().encode(String(text || ''));
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${contentType};base64,${base64}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export async function uploadConversationFile(file: File, options?: {
  conversationId?: string;
  emailTo?: string;
  surface?: string;
  storagePreference?: 'server-local' | 'session-drive' | string;
  preferExternalStorage?: boolean;
}) {
  const contentBase64 = await readFileAsDataUrl(file);
  const res = await authFetch(getApiUrl('/api/files/upload'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      contentBase64,
      conversationId: options?.conversationId,
      emailTo: options?.emailTo,
      surface: options?.surface,
      storagePreference: options?.storagePreference,
      preferExternalStorage: options?.preferExternalStorage,
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error
  }

  if (!res.ok || !data?.ok) {
    const error: Error & { status?: number; payload?: any; code?: string } = new Error(
      data?.message || data?.error || `Upload failed (${res.status})`
    );
    error.status = res.status;
    error.payload = data;
    error.code = data?.error;
    throw error;
  }

  return data as {
    ok: boolean;
    conversationId?: string;
    file?: A11ConversationResource;
    conversationResource?: A11ConversationResource | null;
    record?: any;
    analysis?: any;
    mail?: any;
  };
}

export async function fetchUserLibrary(options?: { kind?: string; limit?: number }): Promise<A11ConversationResource[]> {
  const params = new URLSearchParams();
  if (options?.kind) params.set('kind', options.kind);
  if (options?.limit) params.set('limit', String(options.limit));
  const res = await authFetch(getApiUrl(`/api/user/library?${params}`), {
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.resources) ? data.resources : [];
}

export async function pinResourceToLibrary(resourceId: number, alias?: string): Promise<boolean> {
  const res = await authFetch(getApiUrl(`/api/user/library/${resourceId}/pin`), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({ alias }),
  });
  return res.ok;
}

export type SessionDriveStorageStatus = {
  ok: boolean;
  storagePreference?: 'session-drive';
  ready?: boolean;
  writable?: boolean;
  reason?: string;
  writer?: {
    ready?: boolean;
    state?: string;
    note?: string;
  };
  availableProviders?: string[];
  connectors?: {
    google?: AuthConnectorProviderState | null;
    microsoft?: AuthConnectorProviderState | null;
  };
  storageTargets?: Array<{
    provider?: string;
    destination?: string;
    label?: string;
    configured?: boolean;
    linked?: boolean;
    account?: string | null;
    filesAccess?: string;
    writable?: boolean;
    writerState?: string;
    reason?: string;
  }>;
  error?: string;
  message?: string;
};

export async function fetchSessionDriveStorageStatus(): Promise<SessionDriveStorageStatus> {
  const res = await authFetch(getApiUrl('/api/storage/session-drive/status'), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data: SessionDriveStorageStatus = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data?.ok === false) {
    const error: Error & { status?: number; payload?: any; code?: string } = new Error(
      data?.message || data?.error || `Session drive status failed (${res.status})`
    );
    error.status = res.status;
    error.payload = data;
    error.code = data?.error;
    throw error;
  }
  return data;
}

export async function uploadLocalImage(file: File, options?: { conversationId?: string }) {
  const contentBase64 = await readFileAsDataUrl(file);
  const res = await fetch(getApiUrl('/api/upload/image-local'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentBase64,
      conversationId: options?.conversationId,
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error and surface the HTTP status below
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Upload local image impossible (${res.status})`);
  }

  return data as {
    ok: boolean;
    url?: string;
    filename?: string;
    storageKey?: string;
    sizeBytes?: number;
    storageBackend?: string;
  };
}

export async function analyzeVisionImage(
  imageUrl: string,
  options?: { prompt?: string; conversationId?: string; source?: string; timeoutMs?: number }
) {
  const res = await authFetch(getApiUrl('/api/agent/vision-memory/analyze'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({
      imageUrl,
      prompt: options?.prompt,
      conversationId: options?.conversationId,
      source: options?.source || 'casino',
      timeoutMs: options?.timeoutMs || 20000,
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error and surface the HTTP status below
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || data?.reason || `Analyse image impossible (${res.status})`);
  }

  return data as {
    ok: boolean;
    entry?: any;
    skipped?: boolean;
    reason?: string;
    raw?: any;
  };
}

export async function createTextArtifact(options: {
  filename: string;
  text: string;
  contentType?: string;
  kind?: string;
  conversationId?: string;
  description?: string;
  emailTo?: string;
  emailSubject?: string;
  emailMessage?: string;
  attachToEmail?: boolean;
}) {
  const contentType = String(options.contentType || 'text/plain;charset=utf-8').trim() || 'text/plain;charset=utf-8';
  const contentBase64 = encodeTextAsDataUrl(options.text, contentType);
  const res = await authFetch(getApiUrl('/api/artifacts/create'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({
      filename: options.filename,
      contentBase64,
      contentType,
      kind: options.kind,
      conversationId: options.conversationId,
      description: options.description,
      emailTo: options.emailTo,
      emailSubject: options.emailSubject,
      emailMessage: options.emailMessage,
      attachToEmail: !!options.attachToEmail,
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `Artifact creation failed (${res.status})`);
  }

  return data as {
    ok: boolean;
    artifact?: {
      kind?: string;
      conversationId?: string;
      description?: string | null;
      filename?: string;
      storageKey?: string;
      url?: string;
      contentType?: string;
      sizeBytes?: number;
    };
    record?: any;
    mail?: any;
    conversationResource?: A11ConversationResource | null;
  };
}

export async function emailConversationResource(resourceId: number, options: { to: string; subject?: string; message?: string; attachToEmail?: boolean }) {
  const res = await authFetch(getApiUrl('/api/resources/email'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({
      resourceId,
      to: options.to,
      subject: options.subject,
      message: options.message,
      attachToEmail: !!options.attachToEmail,
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `Resource email failed (${res.status})`);
  }

  return data as {
    ok: boolean;
    resourceId: number;
    resource?: A11ConversationResource;
    mail?: {
      ok?: boolean;
      id?: string | null;
      to?: string;
      subject?: string;
      attachmentIncluded?: boolean;
      attachmentFallbackReason?: string | null;
    };
  };
}

function parseDownloadFilename(contentDisposition: string, fallback: string) {
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition || '');
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      // ignore malformed encoding
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(contentDisposition || '');
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = /filename=([^;]+)/i.exec(contentDisposition || '');
  if (plainMatch?.[1]) return plainMatch[1].trim();

  return fallback;
}

export async function downloadConversationResource(resource: A11ConversationResource) {
  const resourceId = Number(resource?.id || 0);
  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error('invalid_resource_id');
  }

  const res = await authFetch(getApiUrl(`/api/resources/${resourceId}/download`), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // ignore parse errors
    }
    throw new Error(data?.message || data?.error || `Resource download failed (${res.status})`);
  }

  const blob = await res.blob();
  const fallbackName = String(resource.filename || `resource-${resourceId}.bin`);
  const filename = parseDownloadFilename(res.headers.get('content-disposition') || '', fallbackName);
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  return {
    ok: true,
    filename,
    sizeBytes: blob.size,
  };
}

type MemoryCounts = {
  facts: number;
  tasks: number;
  files: number;
};

export type MemoryPurgeNowResponse = {
  ok: boolean;
  userId: string;
  dryRun?: boolean;
  purgeTriggeredAt: string;
  before: MemoryCounts;
  after: MemoryCounts;
  removed: MemoryCounts;
  wouldRemove?: MemoryCounts | null;
};

export type TechnicalMemoSummaryResponse = {
  ok: boolean;
  summary?: {
    total: number;
    byType: Record<string, number>;
    latestTs?: string | null;
    oldestTs?: string | null;
  };
  error?: string;
};

export type TechnicalMemoPurgeResponse = {
  ok: boolean;
  removedEntries?: number;
  removedFiles?: number;
  removedIndex?: boolean;
  byType?: Record<string, number>;
  latestTs?: string | null;
  oldestTs?: string | null;
  error?: string;
};

export type A11HostStatusResponse = {
  ok: boolean;
  available?: boolean;
  bridgeAvailable?: boolean;
  headlessAvailable?: boolean;
  mode?: string;
  safeMode?: boolean;
  workspaceRoot?: string | null;
  buildCommandConfigured?: boolean;
  methods?: string[];
  bridgeMethods?: string[];
  headlessMethods?: string[];
  capabilities?: Record<string, boolean>;
  shellPolicy?: {
    whitelisted?: boolean;
    defaultExamples?: string[];
    extraPrefixes?: string[];
  };
  shellRuntime?: {
    source?: string;
    platform?: string;
    probed?: boolean;
    tools?: Record<string, boolean>;
    unavailableTools?: string[];
    unavailableExamples?: string[];
  };
  error?: string;
};

export type A11CapabilitiesResponse = {
  ok: boolean;
  a11host?: {
    mode?: string;
    bridgeConnected?: boolean;
    safeMode?: boolean;
    workspaceRoot?: string | null;
    shellCwd?: string | null;
    buildCommand?: string | null;
    buildCommandConfigured?: boolean;
    methods?: {
      active?: string[];
      bridge?: string[];
      headless?: string[];
    };
    capabilities?: Record<string, boolean>;
    shellPolicy?: {
      whitelisted?: boolean;
      defaultExamples?: string[];
      extraPrefixes?: string[];
    };
    shellRuntime?: {
      source?: string;
      platform?: string;
      probed?: boolean;
      tools?: Record<string, boolean>;
      unavailableTools?: string[];
      unavailableExamples?: string[];
    };
  };
  qflush?: {
    available?: boolean;
    error?: string | null;
    processes?: Record<string, {
      status?: string;
      pid?: number | null;
      restarts?: number;
      uptime?: string | number | null;
    }>;
  };
  error?: string;
};

export type QflushStatusResponse = {
  available?: boolean;
  initialized?: boolean;
  remoteUrl?: string | null;
  chatFlow?: string | null;
  memorySummaryFlow?: string | null;
  memorySummaryBuiltIn?: boolean;
  message?: string;
  error?: string;
  processes?: Record<string, {
    status?: string;
    pid?: number | null;
    restarts?: number;
    uptime?: string | number | null;
  }>;
};

export type RuntimeModuleEntrypoint = {
  kind: string;
  value: string;
};

export type RuntimeModuleInfo = {
  id: string;
  name: string;
  version?: string | null;
  kind: string;
  summary?: string;
  capabilities?: string[];
  scripts?: string[];
  entrypoints?: RuntimeModuleEntrypoint[];
  state: {
    status: 'ready' | 'source-only' | 'asset-only' | 'raw' | 'partial' | string;
    hasPackage?: boolean;
    hasSource?: boolean;
    hasDist?: boolean;
    hasDocs?: boolean;
    hasTests?: boolean;
    loaded?: boolean;
    shallowFiles?: number;
    shallowDirectories?: number;
  };
};

export type RuntimeModulesStatusResponse = {
  ok: boolean;
  timestamp?: string;
  runtimeRoot?: string;
  modulesRoot?: string;
  summary?: {
    total?: number;
    ready?: number;
    packages?: number;
    sourceOnly?: number;
    assetOnly?: number;
    raw?: number;
    loaded?: number;
  };
  modules?: RuntimeModuleInfo[];
  error?: string;
  message?: string;
};

export type ControlServiceState = 'online' | 'offline' | 'warning' | 'starting';

export type ControlServiceStatus = {
  id: string;
  label: string;
  state: ControlServiceState;
  detail?: string | null;
  url?: string | null;
  actions?: string[];
  meta?: Record<string, any>;
};

export type ControlProfileStatus = {
  key?: 'online' | 'local' | string;
  label?: string;
  requestOrigin?: string;
  frontendUrl?: string | null;
  publicApiUrl?: string | null;
  controlEnabled?: boolean;
  controlReason?: string | null;
  availableTargets?: string[];
};

export type ControlStatusResponse = {
  ok: boolean;
  profile?: ControlProfileStatus;
  runtime?: any;
  supervisor?: {
    available?: boolean;
    processes?: Record<string, {
      status?: string;
      pid?: number | null;
      restarts?: number;
      uptime?: string | number | null;
      autoRestart?: boolean;
    }>;
  };
  services?: ControlServiceStatus[];
  error?: string;
};

export type ControlActionCommand = 'start' | 'stop' | 'restart';

export type ControlActionResponse = {
  ok: boolean;
  action?: ControlActionCommand;
  target?: string;
  results?: Array<{
    target: string;
    ok: boolean;
    message?: string;
  }>;
  status?: ControlStatusResponse;
  error?: string;
};

export type PinkWardStatusResponse = {
  ok: boolean;
  id?: string;
  label?: string;
  timestamp?: string;
  janus?: {
    ok?: boolean;
    provider?: string;
    enabled?: boolean;
    requestedGpu?: boolean;
    cpuFallback?: boolean;
    config?: {
      pythonBin?: string;
      workerScript?: string;
      device?: string;
      torchDtype?: string;
      maxNewTokens?: number;
      timeoutMs?: number;
      workerScriptExists?: boolean;
      pythonBinExists?: boolean | null;
      model?: {
        ref?: string;
        label?: string;
        source?: string;
        local?: boolean;
        exists?: boolean;
      };
    };
    fallback?: {
      enabled?: boolean;
      model?: {
        ref?: string;
        label?: string;
        source?: string;
        local?: boolean;
        exists?: boolean;
      };
    };
    worker?: {
      alive?: boolean;
      ready?: boolean;
      pending?: number;
      pid?: number | null;
      lastStdoutLine?: string | null;
      stderrBytes?: number;
    };
  };
  gpu?: {
    ok?: boolean;
    available?: boolean;
    source?: string;
    error?: string;
    message?: string;
    gpus?: Array<{
      index?: number;
      name?: string;
      memoryTotalMb?: number | null;
      memoryUsedMb?: number | null;
      memoryFreeMb?: number | null;
      utilizationGpuPercent?: number | null;
    }>;
  };
  budget?: {
    lane?: string;
    totalGb?: number | null;
    freeGb?: number | null;
    usedGb?: number | null;
    wantsGpu?: boolean;
    wants7b?: boolean;
    recommendation?: string;
  };
  a11host?: {
    ok?: boolean;
    available?: boolean;
    mode?: string | null;
    bridgeAvailable?: boolean;
    headlessAvailable?: boolean;
    capabilities?: Record<string, boolean>;
  };
  qflush?: {
    available?: boolean;
    remoteUrl?: string | null;
    chatFlow?: string | null;
    memorySummaryFlow?: string | null;
    processes?: Record<string, any>;
  };
  fallback?: {
    cpu?: boolean;
    reason?: string;
  };
  error?: string;
};

export type RemoteProviderProfile = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyPresent: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type RemoteProviderCatalogResponse = {
  ok: boolean;
  enabled: boolean;
  count?: number;
  profiles: RemoteProviderProfile[];
};

export type RemoteProviderSaveInput = {
  id?: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

function buildApiUrlForRequest(path: string, apiBaseOverride?: string) {
  return buildApiUrlFromBase(apiBaseOverride || getCurrentApiBase(), path);
}

export async function fetchA11HostStatus(): Promise<A11HostStatusResponse> {
  const res = await authFetch(getApiUrl('/api/a11host/status'), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `A11Host status failed (${res.status})`);
  }

  return data as A11HostStatusResponse;
}

export async function fetchA11Capabilities(): Promise<A11CapabilitiesResponse> {
  const res = await authFetch(getApiUrl('/api/a11/capabilities'), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `A11 capabilities failed (${res.status})`);
  }

  return data as A11CapabilitiesResponse;
}

export async function fetchPinkWardStatus(): Promise<PinkWardStatusResponse> {
  const res = await authFetch(getApiUrl('/api/a11/pink-ward/status'), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Pink Ward status failed (${res.status})`);
  }

  return data as PinkWardStatusResponse;
}

export async function fetchQflushStatus(): Promise<QflushStatusResponse> {
  const res = await authFetch(getApiUrl('/api/qflush/status'), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Qflush status failed (${res.status})`);
  }

  return data as QflushStatusResponse;
}

export type QflushTerminalStatusResponse = {
  ok: boolean;
  terminal?: {
    name?: string;
    shell?: boolean;
    localOnly?: boolean;
    help?: string;
  };
  gamepad?: any;
  error?: string;
  message?: string;
};

export type QflushTerminalRunResponse = {
  ok: boolean;
  command?: string;
  mode?: string;
  output?: string;
  error?: string;
  message?: string;
  result?: any;
  payload?: any;
  items?: any[];
  file?: string;
};

export async function fetchQflushTerminalStatus(): Promise<QflushTerminalStatusResponse> {
  const res = await authFetch(getApiUrl('/api/qflush/terminal/status'), {
    headers: buildAuthHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Qflush terminal status failed (${res.status})`);
  }

  return data as QflushTerminalStatusResponse;
}

export async function runQflushTerminalCommand(command: string): Promise<QflushTerminalRunResponse> {
  const res = await authFetch(getApiUrl('/api/qflush/terminal/run'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({ command }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.output || data?.message || data?.error || `Qflush terminal command failed (${res.status})`);
  }

  return data as QflushTerminalRunResponse;
}

export async function fetchRuntimeModulesStatus(): Promise<RuntimeModulesStatusResponse> {
  const res = await authFetch(getApiUrl('/api/runtime/modules'), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Runtime modules status failed (${res.status})`);
  }

  return data as RuntimeModulesStatusResponse;
}

export async function fetchControlStatus(apiBaseOverride?: string): Promise<ControlStatusResponse> {
  const res = await authFetch(buildApiUrlForRequest('/api/control/status', apiBaseOverride), {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Control status failed (${res.status})`);
  }

  return data as ControlStatusResponse;
}

export async function runControlAction(
  action: ControlActionCommand,
  target: string,
  apiBaseOverride?: string
): Promise<ControlActionResponse> {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const normalizedTarget = String(target || '').trim().toLowerCase();
  const res = await authFetch(buildApiUrlForRequest(`/api/control/${normalizedAction}`, apiBaseOverride), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({ target: normalizedTarget }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Control action failed (${res.status})`);
  }

  return data as ControlActionResponse;
}

export async function purgeMemoryNow(options?: { userId?: string; dryRun?: boolean }): Promise<MemoryPurgeNowResponse> {
  const dryRun = !!options?.dryRun;
  const headers = buildAuthHeaders('application/json');

  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const purgePath = dryRun ? '/api/memory/purge-now?dryRun=1' : '/api/memory/purge-now';
  const res = await authFetch(getApiUrl(purgePath), {
    method: 'POST',
    headers,
    body: JSON.stringify(options?.userId ? { userId: options.userId } : {}),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors and use fallback error below
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `Memory purge failed (${res.status})`);
  }

  return data as MemoryPurgeNowResponse;
}

export async function fetchTechnicalMemoSummary(): Promise<TechnicalMemoSummaryResponse> {
  if (!hasAdminApiAccess()) {
    throw new Error('admin_required');
  }
  const headers = buildAuthHeaders();
  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const res = await authFetch(getApiUrl('/api/a11/memo/summary'), {
    headers,
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Memo summary failed (${res.status})`);
  }

  return data as TechnicalMemoSummaryResponse;
}

export async function purgeTechnicalMemos(): Promise<TechnicalMemoPurgeResponse> {
  if (!hasAdminApiAccess()) {
    throw new Error('admin_required');
  }
  const headers = buildAuthHeaders();
  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const res = await authFetch(getApiUrl('/api/a11/memo'), {
    method: 'DELETE',
    headers,
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Memo purge failed (${res.status})`);
  }

  return data as TechnicalMemoPurgeResponse;
}

export async function fetchRemoteProviderProfiles(): Promise<RemoteProviderCatalogResponse> {
  if (hasLocalDevBypassSession() || !hasAuthenticatedAdminApiAccess()) {
    return {
      ok: true,
      enabled: false,
      count: 0,
      profiles: [],
    };
  }
  const headers = buildAuthHeaders();
  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const res = await authFetch(getApiUrl('/api/a11/providers'), {
    headers,
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Provider list failed (${res.status})`);
  }

  return data as RemoteProviderCatalogResponse;
}

export async function saveRemoteProviderProfile(input: RemoteProviderSaveInput): Promise<RemoteProviderProfile> {
  if (!hasAuthenticatedAdminApiAccess()) {
    throw new Error('admin_required');
  }
  const headers = buildAuthHeaders('application/json');
  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const res = await authFetch(getApiUrl('/api/a11/providers'), {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || data?.ok === false || !data?.profile) {
    throw new Error(data?.message || data?.error || `Provider save failed (${res.status})`);
  }

  return data.profile as RemoteProviderProfile;
}

export async function deleteRemoteProviderProfile(profileId: string): Promise<{ ok: boolean; removedId?: string }> {
  if (!hasAuthenticatedAdminApiAccess()) {
    throw new Error('admin_required');
  }
  const headers = buildAuthHeaders();
  if (ADMIN_TOKEN) headers['X-NEZ-ADMIN'] = ADMIN_TOKEN;

  const res = await authFetch(getApiUrl(`/api/a11/providers/${encodeURIComponent(String(profileId || '').trim())}`), {
    method: 'DELETE',
    headers,
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Provider delete failed (${res.status})`);
  }

  return data as { ok: boolean; removedId?: string };
}

export type A11PortraitFrame = {
  id: string;
  src: string;
  layer?: string;
  mood?: string;
  holdMs?: number;
  transform?: string;
  filter?: string;
  shadow?: string;
};

export type A11PortraitFramebook = {
  ok?: boolean;
  version?: string;
  frames: A11PortraitFrame[];
  sequences?: Record<string, string[]>;
  audioSync?: {
    source?: string;
    frameDurationMs?: number;
    transitionMs?: number;
    minMessageHoldMs?: number;
    cleanup?: string;
  };
  policy?: {
    mode?: string;
    foreground?: boolean;
    noInfiniteGeneration?: boolean;
    maxFrames?: number;
    maxSequenceFrames?: number;
  };
};

export async function fetchA11PortraitFramebook(): Promise<A11PortraitFramebook> {
  if (hasLocalDevBypassSession()) {
    return { ok: true, frames: [], sequences: { idle: [], thinking: [], speaking: [] } };
  }

  const res = await authFetch(getApiUrl('/api/a11/portrait-framebook'), {
    headers: buildAuthHeaders(),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors and fail below
  }
  if (!res.ok || data?.ok === false || !Array.isArray(data?.frames)) {
    throw new Error(data?.message || data?.error || `Portrait framebook failed (${res.status})`);
  }
  return data as A11PortraitFramebook;
}

export type MatchArenaPriorityTier = 'admin' | 'family' | 'public';
export type MatchArenaMode = 'user-vs-a11' | 'user-with-a11' | 'user-vs-player';

export type MatchArenaGame = {
  id: string;
  title: string;
  source?: string;
  rootLabel?: string;
  playableCount?: number;
  extensions?: Record<string, number>;
  hasCover?: boolean;
  playableFiles?: Array<{
    name: string;
    relativePath: string;
    extension: string;
    size?: number | null;
  }>;
  note?: string;
};

export type MatchArenaSession = {
  id: string;
  state: string;
  status?: string;
  gameId: string;
  gameTitle: string;
  mode?: MatchArenaMode | string;
  opponent?: string;
  a11Mode?: {
    enabled?: boolean;
    role?: 'opponent' | 'copilot' | 'none' | string;
    label?: string;
    requiredTier?: string | null;
    permissions?: string[];
    accountTier?: string;
  };
  visibility?: 'private' | 'public';
  priorityTier?: MatchArenaPriorityTier;
  priorityLabel?: string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  workerId?: string | null;
  stream?: {
    ready?: boolean;
    mode?: string;
    url?: string | null;
    embedUrl?: string | null;
    controlUrl?: string | null;
    message?: string | null;
  } | null;
  input?: {
    ready?: boolean;
    mode?: string;
    endpoint?: string | null;
    claimEndpoint?: string | null;
    sequence?: number;
    accepted?: string[];
  } | null;
  runtime?: {
    playable?: boolean;
    emulator?: string;
    transport?: string;
    stream?: string;
    input?: string;
    capabilities?: string[];
  } | null;
  export?: {
    ready?: boolean;
    localPath?: string | null;
    drivePath?: string | null;
    manifestUrl?: string | null;
  } | null;
  message?: string | null;
  error?: string | null;
  plan?: Record<string, unknown> | null;
  lastInputAt?: string | null;
  players?: Array<{
    slot: number;
    label?: string;
    role?: string | null;
    automated?: boolean;
    joinedAt?: string | null;
  }>;
  playerSlot?: number | null;
  joinable?: boolean;
};

export type MatchArenaStatus = {
  ok: boolean;
  enabled: boolean;
  generatedAt?: string;
  gamesRoot?: {
    configured?: boolean;
    localRootLabel?: string;
    localRootAvailable?: boolean;
  };
  catalog?: {
    count?: number;
    sources?: Record<string, number>;
    workerInventoryAt?: string | null;
  };
  queue?: {
    total?: number;
    active?: number;
    states?: Record<string, number>;
    priorities?: Record<string, number>;
  };
  access?: {
    accountTier?: string;
    accountLabel?: string;
    a11MatchAllowed?: boolean;
    modes?: Array<{
      enabled?: boolean;
      role?: string;
      label?: string;
      requiredTier?: string | null;
      permissions?: string[];
      accountTier?: string;
    }>;
  };
  worker?: {
    configured?: boolean;
    lastSeenAt?: string | null;
    ageMs?: number | null;
    online?: boolean;
    heartbeat?: Record<string, unknown> | null;
  };
  architecture?: Record<string, string>;
};

export async function fetchMatchArenaStatus(): Promise<MatchArenaStatus> {
  const res = await authFetch(getApiUrl('/api/match-arena/status'), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Match Arena indisponible (${res.status})`);
  }
  return data as MatchArenaStatus;
}

export async function fetchMatchArenaGames(): Promise<MatchArenaGame[]> {
  const res = await authFetch(getApiUrl('/api/match-arena/games'), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Inventaire Match Arena indisponible (${res.status})`);
  }
  return (Array.isArray(data?.games) ? data.games : []) as MatchArenaGame[];
}

export async function fetchMatchArenaSessions(): Promise<MatchArenaSession[]> {
  const res = await authFetch(getApiUrl('/api/match-arena/sessions'), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Sessions Match Arena indisponibles (${res.status})`);
  }
  return (Array.isArray(data?.sessions) ? data.sessions : []) as MatchArenaSession[];
}

export async function createMatchArenaSession(input: {
  gameId: string;
  mode?: MatchArenaMode | string;
  opponent?: string;
  priorityTier?: MatchArenaPriorityTier;
  visibility?: 'private' | 'public';
}): Promise<MatchArenaSession> {
  const res = await authFetch(getApiUrl('/api/match-arena/sessions'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify(input || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Session Match Arena refusee (${res.status})`);
  }
  return data.session as MatchArenaSession;
}

export async function joinMatchArenaSession(sessionId: string): Promise<MatchArenaSession> {
  const res = await authFetch(getApiUrl(`/api/match-arena/sessions/${encodeURIComponent(sessionId)}/join`), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Session Match Arena impossible a rejoindre (${res.status})`);
  }
  return data.session as MatchArenaSession;
}

export async function fetchMatchArenaSession(sessionId: string): Promise<MatchArenaSession> {
  const res = await authFetch(getApiUrl(`/api/match-arena/sessions/${encodeURIComponent(sessionId)}`), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Session Match Arena indisponible (${res.status})`);
  }
  return data.session as MatchArenaSession;
}

export async function sendMatchArenaInput(sessionId: string, input: {
  control: string;
  action?: string;
  value?: number;
  durationMs?: number;
  player?: number;
}): Promise<MatchArenaSession> {
  const res = await authFetch(getApiUrl(`/api/match-arena/sessions/${encodeURIComponent(sessionId)}/input`), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify(input || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Commande Match Arena refusee (${res.status})`);
  }
  return data.session as MatchArenaSession;
}

// ── Qonto Pro — lecture admin uniquement ─────────────────────────────────────

export type QontoPublicConfig = {
  ok: boolean;
  configured: boolean;
  apiBaseUrl?: string;
  loginConfigured?: boolean;
  secretConfigured?: boolean;
  secretSource?: string | null;
  stagingTokenConfigured?: boolean;
  stagingTokenSource?: string | null;
  missing?: string[];
  mode?: string;
  readOnly?: boolean;
  error?: string;
  message?: string;
};

export type QontoBankAccount = {
  id: string | null;
  slug?: string | null;
  name?: string | null;
  type?: string | null;
  currency?: string | null;
  balance?: number | string | null;
  balanceCents?: number | null;
  status?: string | null;
  maskedIban?: string | null;
};

export type QontoTransaction = {
  id: string | null;
  bankAccountId?: string | null;
  amount?: number | string | null;
  amountCents?: number | null;
  currency?: string | null;
  side?: string | null;
  operationType?: string | null;
  status?: string | null;
  settledAt?: string | null;
  emittedAt?: string | null;
  updatedAt?: string | null;
  label?: string | null;
  counterpartyName?: string | null;
  category?: string | null;
  attachmentIds?: string[];
};

export type QontoOrganization = {
  id: string | null;
  slug?: string | null;
  name?: string | null;
  legalName?: string | null;
  status?: string | null;
  verificationStatus?: string | null;
  country?: string | null;
  bankAccounts?: QontoBankAccount[];
};

export type QontoTransactionsInput = {
  bankAccountId?: string;
  iban?: string;
  page?: number;
  perPage?: number;
  status?: string | string[];
  includes?: string | string[];
  operationType?: string | string[];
  side?: string;
  sortBy?: string;
  withAttachments?: boolean;
  settledAtFrom?: string;
  settledAtTo?: string;
  updatedAtFrom?: string;
  updatedAtTo?: string;
  emittedAtFrom?: string;
  emittedAtTo?: string;
};

export type QontoOrganizationResponse = {
  ok: boolean;
  configured?: boolean;
  organization: QontoOrganization;
};

export type QontoBankAccountsResponse = {
  ok: boolean;
  configured?: boolean;
  bankAccounts: QontoBankAccount[];
};

export type QontoTransactionsResponse = {
  ok: boolean;
  configured?: boolean;
  page?: number;
  perPage?: number;
  transactions: QontoTransaction[];
};

export type QontoSummaryResponse = {
  ok: boolean;
  configured?: boolean;
  organization: QontoOrganization;
  bankAccounts: QontoBankAccount[];
  sampledBankAccounts?: Array<{ id?: string | null; name?: string | null; maskedIban?: string | null }>;
  recentTransactions: QontoTransaction[];
  totalsByCurrency: Record<string, {
    creditCents: number;
    debitCents: number;
    creditCount: number;
    debitCount: number;
  }>;
};

function appendQontoParams(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendQontoParams(params, key, item));
    return;
  }
  params.append(key, String(value));
}

function buildQontoQuery(input: QontoTransactionsInput = {}) {
  const params = new URLSearchParams();
  appendQontoParams(params, 'bankAccountId', input.bankAccountId);
  appendQontoParams(params, 'iban', input.iban);
  appendQontoParams(params, 'page', input.page);
  appendQontoParams(params, 'perPage', input.perPage);
  appendQontoParams(params, 'status', input.status);
  appendQontoParams(params, 'includes', input.includes);
  appendQontoParams(params, 'operationType', input.operationType);
  appendQontoParams(params, 'side', input.side);
  appendQontoParams(params, 'sortBy', input.sortBy);
  if (input.withAttachments !== undefined) appendQontoParams(params, 'withAttachments', input.withAttachments ? 'true' : 'false');
  appendQontoParams(params, 'settledAtFrom', input.settledAtFrom);
  appendQontoParams(params, 'settledAtTo', input.settledAtTo);
  appendQontoParams(params, 'updatedAtFrom', input.updatedAtFrom);
  appendQontoParams(params, 'updatedAtTo', input.updatedAtTo);
  appendQontoParams(params, 'emittedAtFrom', input.emittedAtFrom);
  appendQontoParams(params, 'emittedAtTo', input.emittedAtTo);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function fetchQontoJson<T>(path: string): Promise<T> {
  const res = await authFetch(getApiUrl(`/api/qonto${path}`), {
    headers: buildAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Qonto request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchQontoConfig(): Promise<QontoPublicConfig> {
  return fetchQontoJson<QontoPublicConfig>('/config');
}

export async function fetchQontoOrganization(): Promise<QontoOrganizationResponse> {
  return fetchQontoJson<QontoOrganizationResponse>('/organization');
}

export async function fetchQontoBankAccounts(): Promise<QontoBankAccountsResponse> {
  return fetchQontoJson<QontoBankAccountsResponse>('/bank-accounts');
}

export async function fetchQontoTransactions(input: QontoTransactionsInput = {}): Promise<QontoTransactionsResponse> {
  return fetchQontoJson<QontoTransactionsResponse>(`/transactions${buildQontoQuery(input)}`);
}

export async function fetchQontoSummary(input: QontoTransactionsInput = {}): Promise<QontoSummaryResponse> {
  return fetchQontoJson<QontoSummaryResponse>(`/summary${buildQontoQuery(input)}`);
}

// ── Subscription Management ──────────────────────────────────────────────────

export interface SubscriptionStatus {
  ok: boolean;
  active: boolean;
  fullAccess?: boolean;
  tier?: string | null;
  plan?: string | null;
  reason?: string | null;
  endDate?: string | null;
  founderPayment?: {
    available: boolean;
    phone?: string | null;
    ribUrl?: string | null;
  } | null;
  availablePlans?: Array<{
    id: 'premium' | 'founder' | string;
    label: string;
    monthlyEur: number;
  }>;
  stripeStatus?: {
    active: boolean;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd?: boolean;
    plan?: string | null;
  } | null;
}

export interface CheckoutSessionResponse {
  ok: boolean;
  sessionId: string;
  url: string;
}

export interface CustomerPortalResponse {
  ok: boolean;
  url: string;
}

export interface CancelSubscriptionResponse {
  ok: boolean;
  cancelAt?: number | null;
  endDate?: string | null;
  message?: string;
}

/**
 * Récupère le statut d'abonnement de l'utilisateur
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await authFetch(getApiUrl('/api/subscription/status'), {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Impossible de charger le statut (${res.status})`);
  }

  return res.json();
}

/**
 * Crée une session de checkout Stripe pour souscrire
 */
export async function createCheckoutSession(plan: 'premium' | 'founder' = 'premium'): Promise<CheckoutSessionResponse> {
  const res = await authFetch(getApiUrl('/api/subscription/create-checkout'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    throw new Error(`Impossible de créer la session (${res.status})`);
  }

  return res.json();
}

/**
 * Crée une session du portail client Stripe pour gérer l'abonnement
 */
export async function createCustomerPortal(): Promise<CustomerPortalResponse> {
  const res = await authFetch(getApiUrl('/api/subscription/create-portal'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
  });

  if (!res.ok) {
    throw new Error(`Impossible d'ouvrir le portail (${res.status})`);
  }

  return res.json();
}

/**
 * Programme le désabonnement Stripe à la fin de la période déjà payée.
 */
export async function cancelSubscription(): Promise<CancelSubscriptionResponse> {
  const res = await authFetch(getApiUrl('/api/subscription/cancel'), {
    method: 'POST',
    headers: buildAuthHeaders('application/json'),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Impossible de programmer le désabonnement (${res.status})`);
  }

  return data;
}

// ------------------------------------------------------------------
// Ekko — statut du module d'écoute audio système
// ------------------------------------------------------------------
export type EkkoRecentEvent = {
  timestamp: string;
  duration_ms: number;
  confidence: number;
  tags: string[];
  app_name: string | null;
  preview: string;
};

export type EkkoStatusResponse = {
  ok: boolean;
  stats: {
    total_received: number;
    last_received_at: string | null;
    last_app: string | null;
  };
  recent: EkkoRecentEvent[];
  /** Vrai si le module Python Ekko signale qu'il est en écoute active */
  listening?: boolean;
  error?: string;
};

/**
 * Récupère le statut Ekko depuis /api/ekko/status.
 * Pas d'auth requise (route publique locale), mais authFetch est utilisé
 * pour homogénéité avec le reste de l'API.
 */
export async function fetchEkkoStatus(): Promise<EkkoStatusResponse> {
  const statusUrl = isLocalDevSurface()
    ? '/api/ekko/status'
    : getApiUrl('/api/ekko/status');
  const res = await authFetch(statusUrl, {
    headers: buildAuthHeaders(),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    throw new Error(data?.error || `Ekko status failed (${res.status})`);
  }

  return data as EkkoStatusResponse;
}
