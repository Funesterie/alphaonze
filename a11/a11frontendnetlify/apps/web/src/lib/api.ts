// --- Génération d'image via backend DALL·E ---
export async function generatePngWithPrompt(prompt: string): Promise<{ url: string, filename: string, prompt: string }> {
  const res = await authFetch(getApiUrl('/api/tools/generate_png'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders()
    },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) throw new Error('Erreur génération image');
  return res.json();
}
// @ts-nocheck

const API_BASE_STORAGE_KEY = 'a11:api-base-override';
const DISPLAY_NAME_STORAGE_KEY = 'a11:display-name';
const AUTH_TOKEN_STORAGE_KEY = 'a11-auth-token';
const LEGACY_AUTH_TOKEN_STORAGE_KEY = 'a11_jwt_token';
const AUTH_INVALID_EVENT_NAME = 'a11:auth-invalid';
const DEFAULT_API_BASE = normalizeApiBase(
  (import.meta.env?.VITE_A11_API_BASE_URL) ||
  (import.meta.env?.VITE_API_BASE_URL) ||
  (import.meta.env?.VITE_API_URL) ||
  (import.meta.env?.VITE_API_BASE) ||
  ''
);
const DEFAULT_ONLINE_API_BASE = normalizeApiBase(import.meta.env?.VITE_A11_ONLINE_API_BASE_URL) || 'https://api.funesterie.pro';
const DEFAULT_LOCAL_PROFILE_BASE = (() => {
  const explicitLocalBase = normalizeApiBase(import.meta.env?.VITE_A11_LOCAL_API_BASE_URL);
  if (explicitLocalBase) return explicitLocalBase;
  if (DEFAULT_API_BASE && DEFAULT_API_BASE !== DEFAULT_ONLINE_API_BASE) return DEFAULT_API_BASE;
  return 'https://api.funesterie.me';
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
  return normalized === 'a11.funesterie.pro'
    || normalized === 'a11funesterie.netlify.app'
    || normalized.endsWith('--a11funesterie.netlify.app');
}

function isLocalApiBaseCandidate(baseValue: string | null | undefined) {
  const normalized = normalizeApiBase(baseValue);
  if (!normalized) return false;
  if (normalized === normalizeApiBase(A11_API_PROFILE_BASES.local)) return true;
  try {
    const hostname = new URL(normalized, globalThis.location?.origin || 'http://127.0.0.1').hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname.endsWith('.funesterie.me')
      || hostname === 'api.funesterie.me';
  } catch {
    return false;
  }
}

export function isPublicOnlineModeLocked() {
  try {
    return isPublicA11WebHost(globalThis.location?.hostname);
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
    if (forcedMode === 'online' || forcedMode === 'local') {
      const nextBase = A11_API_PROFILE_BASES[forcedMode as 'online' | 'local'];
      if (nextBase) {
        globalThis.localStorage?.setItem(API_BASE_STORAGE_KEY, normalizeApiBase(nextBase));
      }
      url.searchParams.delete('a11-force-api-mode');
      changed = true;
    }

    if (isPublicA11WebHost(url.hostname)) {
      const onlineBase = normalizeApiBase(A11_API_PROFILE_BASES.online);
      const currentOverride = normalizeApiBase(globalThis.localStorage?.getItem(API_BASE_STORAGE_KEY));
      if (currentOverride !== onlineBase) {
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
  if (isPublicOnlineModeLocked()) {
    return normalizeApiBase(A11_API_PROFILE_BASES.online) || DEFAULT_ONLINE_API_BASE;
  }
  try {
    const override = normalizeApiBase(globalThis.localStorage?.getItem(API_BASE_STORAGE_KEY));
    if (override) return override;
  } catch {
    // ignore storage issues
  }
  return DEFAULT_API_BASE;
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

function getApiUrl(path: string) {
  return buildApiUrlFromBase(getCurrentApiBase(), path);
}

function getApiOrigin() {
  return getApiOriginFromBase(getCurrentApiBase());
}

export function resolveApiAssetUrl(rawValue: string | null | undefined) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }
  const origin = getApiOrigin();
  const normalizedRaw = raw.replace(/\\/g, '/');
  const containerPathMatch = normalizedRaw.match(/^\/app\/(.+)$/i);
  if (containerPathMatch?.[1]) {
    const normalizedRuntimePath = `/files/${containerPathMatch[1]}`.replace(/\/{2,}/g, '/');
    return origin ? `${origin}${normalizedRuntimePath}` : normalizedRuntimePath;
  }
  if (/^app\/.+/i.test(normalizedRaw)) {
    const normalizedRuntimePath = `/files/${normalizedRaw.replace(/^app\//i, '')}`.replace(/\/{2,}/g, '/');
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

export function getAuthIdentity() {
  const payload = decodeJwtPayload(getAuthToken());
  const id = normalizeStorageScopePart(payload?.id || payload?.sub || '');
  const username = normalizeStorageScopePart(
    payload?.username || payload?.preferred_username || payload?.name || ''
  );
  const storageScope = [id, username].filter(Boolean).join('__');
  return {
    id,
    username,
    storageScope: storageScope || '',
  };
}

export function getAuthStorageScope() {
  return getAuthIdentity().storageScope;
}

export function hasAdminApiAccess() {
  if (String(ADMIN_TOKEN || '').trim()) return true;
  const payload = decodeJwtPayload(getAuthToken()) || {};
  const id = normalizeStorageScopePart(payload?.id || payload?.sub || '');
  const username = normalizeStorageScopePart(
    payload?.username || payload?.preferred_username || payload?.name || ''
  );
  const role = normalizeStorageScopePart(payload?.role || payload?.user_role || '');
  return payload?.isAdmin === true || id === 'admin' || username === 'admin' || role === 'admin';
}

export function getAuthDisplayName() {
  try {
    const saved = String(localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || '').trim();
    if (saved) return saved;
  } catch {
    // ignore storage issues
  }

  const payload = decodeJwtPayload(getAuthToken());
  const fromToken =
    payload?.username ||
    payload?.preferred_username ||
    payload?.name ||
    payload?.sub ||
    '';
  return String(fromToken || '').trim();
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_AUTH_TOKEN_STORAGE_KEY);
}

function clearClientAuthSession(detail?: { reason?: string; message?: string; status?: number }) {
  const hadStoredToken = !!readStoredAuthToken();
  clearAuthToken();
  setAuthDisplayName('');
  if (!hadStoredToken && !detail?.reason && !detail?.message) return;
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
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    setAuthToken(data.token);
    setAuthDisplayName(data?.user?.username || username);
    return data;
  }
  throw new Error(data.error || 'Connexion impossible');
}

export async function register(username: string, email: string, password: string) {
  const res = await fetch(getApiUrl('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    setAuthDisplayName(data?.user?.username || username);
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

export function logout() {
  clearAuthToken();
  setAuthDisplayName('');
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
  if (!appendJwtHeaders(headers)) {
    clearClientAuthSession({
      reason: 'A11_JWT_Missing',
      message: 'JWT token manquant',
    });
    throw new Error('A11_JWT_Missing');
  }

  return headers;
}

function dispatchBrowserEvent(event: Event) {
  globalThis.dispatchEvent(event);
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

async function throwIfAuthInvalidResponse(res: Response) {
  if (res.ok) return;

  const { text, data } = await readResponsePayloadSafe(res.clone());
  const errorCode = String(data?.error || '').trim();
  const message = String(data?.message || '').trim()
    || errorCode
    || (!isLikelyHtmlDocument(text) ? text.trim() : '');

  if (res.status === 401 || errorCode === 'A11_JWT_Invalid' || errorCode === 'A11_JWT_Missing') {
    clearClientAuthSession({
      reason: errorCode || 'A11_JWT_Invalid',
      message: message || `Session A11 invalide (${res.status})`,
      status: res.status,
    });

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
  const res = await fetch(input, init);
  await throwIfAuthInvalidResponse(res);
  return res;
}

export function getTtsApiUrl() {
  return import.meta.env.VITE_TTS_API || getApiUrl('/api/tts/piper');
}

export const TTS_VOICES = ['fr_FR-siwis-medium'];

export type Provider = "local" | "ollama" | "openai";

export function getModelForProvider(provider: Provider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'ollama':
      return 'llama3.2:latest';
    case 'local':
    default:
      return 'llama3.2:latest';
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

export function extractAssistantDisplayContent(payload: unknown) {
  return String(extractAssistantContentFromPayload(payload) || '').trim();
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
        const processDataLine = (line) => {
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
                // Log raw data for debugging
                console.log('[A11][RAW] 200 data:', line.slice(5).trim());
                processDataLine(line);
              }
            }
          }
        }

        // Final flush if buffer contains a data: line
        const finalLines = buf.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of finalLines) {
          if (line.startsWith('data:')) {
            console.log('[A11][RAW] 200 data:', line.slice(5).trim());
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
  console.log('[A11][RAW]', res.status, text);

  if (!res.ok) {
    const message = isLikelyHtmlDocument(text)
      ? `API ${res.status}: reponse HTML inattendue recue au lieu d'une reponse assistant`
      : `API ${res.status}: ${text}`;
    throw new Error(message);
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
}

// Appel OpenAI-like, now accepts provider
export async function chatCompletion(
  messages: Msg[],
  provider: Provider = 'local',
  systemPromptOrOptions?: string | { turbo?: boolean; systemPrompt?: string; model?: string; conversationId?: string; providerProfileId?: string }
) {
  const result = await chatCompletionDetailed(messages, provider, systemPromptOrOptions);
  return result.content;
}

export async function chatCompletionDetailed(
  messages: Msg[],
  provider: Provider = 'local',
  systemPromptOrOptions?: string | { turbo?: boolean; systemPrompt?: string; model?: string; conversationId?: string; providerProfileId?: string }
) {
  // Support both old signature (systemPrompt string) and new options object
  let systemPrompt: string | undefined;
  let turboFlag = false;
  let modelOverride: string | undefined;
  let conversationId: string | undefined;
  let providerProfileId: string | undefined;
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
  }

  // Ajout du systemPrompt si fourni
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
  };

  // Always post to router (apiPost ignores the path and uses router endpoint)
  const data = await apiPost(payload);

  // On essaie de lire réponse façon OpenAI
  const content =
    extractAssistantDisplayContent(data) ||
    "Je n'ai pas pu formuler une reponse exploitable.";

  const imageUrl =
    resolveApiAssetUrl(data?.a11Agent?.imagePath) ||
    resolveApiAssetUrl(data?.imagePath) ||
    extractImageUrlFromA11Agent(data?.a11Agent || null) ||
    null;

  return {
    content: String(content || ''),
    imageUrl,
    a11Agent: data?.a11Agent || null,
    qflushVerification: data?.qflushVerification || null,
    createdAt: normalizeCreatedAt(data?.created) || new Date().toISOString(),
    raw: data,
  } as ChatCompletionResult;
}

// Chat simple avec prompt système et modèle choisis
export async function chat(message: string, history: Msg[] = [], provider: Provider = 'local', systemPrompt?: string) {
  const messages: Msg[] = history.length ? history : [
    { role: 'system', content: systemPrompt || "Tu es A-11, assistant local. Reponds court, clair et direct. N'invente pas de contexte. Ne propose pas d'action non demandee. Si la question est triviale, reponds en une phrase maximum." },
    { role: 'user', content: message }
  ];
  dispatchBrowserEvent(new Event('conversation:start'));
  try {
    return await chatCompletion(messages, provider, systemPrompt);
  } finally {
    dispatchBrowserEvent(new Event('conversation:end'));
  }
}

// Appel TTS générique
export async function ttsSpeak(text: string, voice: string = 'fr_FR-siwis-medium', provider: string = 'piper') {
  const payload = {
    text,
    voice,
    provider
  };
  // Backend route is mounted at /api/tts/piper
  const fetchOptions: any = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  // same-origin proxy should include credentials
  fetchOptions.credentials = 'include';

  const url = getApiUrl('/api/tts/piper');
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

  // Sinon on essaie le JSON (cas ElevenLabs / fallback)
  try {
    const data = await res.json();
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

// === A11 Conversation History (backend) ===
export async function fetchA11HistoryList() {
  // GET /api/a11/history renvoie la liste des conversations (id, name, updated...)
  const url = getApiUrl('/api/a11/history');
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement historique A-11');
  return res.json() as Promise<A11HistoryItem[]>;
}

export async function fetchA11Conversation(convId: string) {
  // GET /api/a11/history/:id renvoie les messages d'une conversation
  const url = getApiUrl(`/api/a11/history/${encodeURIComponent(convId)}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement conversation A-11');
  return res.json();
}

export async function clearA11History(convId?: string) {
  const target = String(convId || '').trim();
  const url = target
    ? getApiUrl(`/api/a11/history/${encodeURIComponent(target)}`)
    : getApiUrl('/api/a11/history');
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

export async function fetchA11ConversationResources(convId: string, options?: { kind?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (options?.kind) params.set('kind', options.kind);
  if (options?.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const url = getApiUrl(`/api/a11/history/${encodeURIComponent(convId)}/resources${suffix}`);
  const res = await authFetch(url, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error('Erreur chargement ressources A-11');
  return res.json();
}

export async function fetchA11ConversationActivity(convId: string, options?: { limit?: number }) {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
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

export async function uploadConversationFile(file: File, options?: { conversationId?: string; emailTo?: string }) {
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
    }),
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // ignore parse error
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `Upload failed (${res.status})`);
  }

  return data as {
    ok: boolean;
    conversationId?: string;
    file?: A11ConversationResource;
    conversationResource?: A11ConversationResource | null;
    record?: any;
    mail?: any;
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
  if (!hasAdminApiAccess()) {
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
  if (!hasAdminApiAccess()) {
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
  if (!hasAdminApiAccess()) {
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
