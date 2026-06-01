import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  clearA11History,
  createTextArtifact,
  deleteRemoteProviderProfile,
  downloadConversationResource,
  fetchTechnicalMemoSummary,
  fetchA11HistoryList,
  fetchA11Conversation,
  fetchA11ConversationActivity,
  fetchA11ConversationResources,
  disconnectConnector,
  fetchAuthConnectors,
  fetchMcpCockpitAccount,
  fetchMcpCockpitStatus,
  fetchRemoteProviderProfiles,
  fetchA11PortraitFramebook,
  fetchTtsVoiceReferences,
  fetchAuthSession,
  hasAdminApiAccess,
  hasAuthenticatedAdminApiAccess,
  isAuthInvalidError,
  chatWithVivy,
  createCheckoutSession,
  createCustomerPortal,
  emailConversationResource,
  clearAuthToken,
  getAuthDisplayName,
  getAuthStorageScope,
  login,
  loginWithGoogleCredential,
  logoutAllSessions,
  getAuthToken,
  hasAuthToken,
  register,
  forgotPassword,
  resetPassword,
  runVivyStudioProduction,
  startGoogleOAuth,
  setAuthToken,
  startMicrosoftOAuth,
  setAuthDisplayName,
  transcribeAudioFile,
  ttsSpeak,
  uploadTtsVoiceReference,
  saveRemoteProviderProfile,
  purgeMemoryNow,
  purgeTechnicalMemos,
  uploadConversationFile,
  type A11ConversationActivityEntry,
  type A11ConversationResource,
  type A11HistoryItem,
  type RemoteProviderProfile,
  type RemoteProviderSaveInput,
  type TechnicalMemoSummaryResponse,
  type TtsVoiceReference,
  type VivyChatFileAttachment,
  type A11PortraitFrame,
  type A11PortraitFramebook,
  type AuthConnectorProviderState,
  type AuthConnectorsResponse,
  type McpAccountProfile,
} from "./lib/api";
import { A11HistoryPanel } from "./components/A11HistoryPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { A11ControlCenterPanel } from "./components/A11ControlCenterPanel";
import { A11OpsStatusPanel } from "./components/A11OpsStatusPanel";
import { PinkWardPanel } from "./components/PinkWardPanel";
import { A11CommandConsolePanel } from "./components/A11CommandConsolePanel";
import { QflushPortableTerminal } from "./components/QflushPortableTerminal";
import { A11RemoteProvidersPanel } from "./components/A11RemoteProvidersPanel";
import { EkkoIndicator } from "./components/EkkoIndicator";
import { ConversationActivityPanel } from "./components/ConversationActivityPanel";
import { ConversationResourcesPanel } from "./components/ConversationResourcesPanel";
import { A11ActivityConsole, useA11Activity } from "./components/A11ActivityConsole";
import { CreateArtifactModal } from "./components/CreateArtifactModal";
import { EmailResourceModal } from "./components/EmailResourceModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { RenameConversationModal } from "./components/RenameConversationModal";
import { SubscriptionPanel } from "./components/SubscriptionPanel";
import { AdBanner } from "./components/AdBanner";
import { CasinoHub } from "./components/CasinoHub";
import ReactMarkdown from "react-markdown";
import "./index.css";
import {
  initSpeech,
  startMic,
  stopMic,
  speak,
  cancelSpeech,
  setTtsQueueEnabled,
  setSpeechMuted,
  isSpeechMuted,
  retryPlayUrl,
  unlockAudioOutput,
  isAudioOutputUnlocked,
  setSpeechRecognitionLanguage,
} from "./lib/speech";
import handleImportFiles from "./lib/importer";
import { chatCompletionDetailed, extractAssistantDisplayContent, resolveApiAssetUrl, type Provider } from "./lib/api";
import { foldForLookup, toUnicodeLine, toUnicodeText } from "./lib/language";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  qflushVerification?: {
    suspicious?: boolean;
    summary?: string;
    mode?: string | null;
  } | null;
  ts?: string;
}

interface PurgeHistoryEntry {
  at: string;
  dryRun: boolean;
  removed: { facts: number; tasks: number; files: number };
}

type ConsoleSuggestion = {
  command: string;
  reason: string;
  nonce: number;
};

type A11HistoryMessage = {
  id?: string;
  role: Role;
  content: string;
  ts?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  fileUrl?: string | null;
  qflushVerification?: {
    suspicious?: boolean;
    summary?: string;
    mode?: string | null;
  } | null;
};

type ArtifactFormat = "markdown" | "text" | "json";

type AssistantExportSuggestion = {
  kind: string;
  label: string;
  hint: string;
  fileStem: string;
  accent: string;
};

type ChatModelChoice = {
  value: string;
  label: string;
  provider: Provider;
  model: string;
  providerProfileId?: string;
};

type TtsProviderMode = "auto" | "piper" | "openai";
type A11LanguageCode = "fr" | "en" | "it" | "es" | "de";

function isOfficialVoiceSurface(surface: FunesterieSurface) {
  return surface === "a11" || surface === "kaen44" || surface === "vivy";
}

function resolveEffectiveTtsProviderMode(
  providerMode: TtsProviderMode,
  surface: FunesterieSurface
): TtsProviderMode {
  if (providerMode === "piper" && isOfficialVoiceSurface(surface)) return "auto";
  return providerMode;
}

const A11_LANGUAGE_CHOICES: Array<{
  code: A11LanguageCode;
  label: string;
  speechLang: string;
  sttCode: string;
  ttsVoice: string;
}> = [
    { code: "fr", label: "Français", speechLang: "fr-FR", sttCode: "fr", ttsVoice: "fr_FR-siwis-medium" },
    { code: "en", label: "English", speechLang: "en-US", sttCode: "en", ttsVoice: "en_US-lessac-medium" },
    { code: "it", label: "Italiano", speechLang: "it-IT", sttCode: "it", ttsVoice: "it_IT-paola-medium" },
    { code: "es", label: "Español", speechLang: "es-ES", sttCode: "es", ttsVoice: "es_ES-sharvard-medium" },
    { code: "de", label: "Deutsch", speechLang: "de-DE", sttCode: "de", ttsVoice: "de_DE-thorsten-medium" },
  ];

function normalizeA11LanguageCode(value: unknown): A11LanguageCode {
  const raw = String(value || "").trim().toLowerCase();
  return (A11_LANGUAGE_CHOICES.some((choice) => choice.code === raw) ? raw : "fr") as A11LanguageCode;
}

const AUDIO_FILE_NAME_RE = /\.(wav|mp3|m4a|mp4|mov|ogg|opus|webm|flac)$/i;

function isAudioLikeFile(file: File) {
  const mime = String(file?.type || "").toLowerCase();
  return mime.startsWith("audio/")
    || mime === "video/webm"
    || mime === "video/quicktime"
    || AUDIO_FILE_NAME_RE.test(String(file?.name || ""));
}

function toSyntheticFileList(files: File[]): FileList {
  return Object.assign(files, {
    item: (index: number) => files[index] || null,
  }) as unknown as FileList;
}

function buildPublicAssetPath(relativePath: string) {
  const base = String((import.meta as any)?.env?.BASE_URL || "/").trim() || "/";
  const normalizedBase = `${base.replace(/\/+$/, "")}/`.replace(/^$/, "/");
  return `${normalizedBase}${String(relativePath || "").replace(/^\/+/, "")}`.replace(/^\/\//, "/");
}

function applyImageFallback(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  fallbackSrc: string
) {
  const img = event.currentTarget;
  if (!fallbackSrc || img.dataset.fallbackApplied === "1") return;
  if (img.src.endsWith(fallbackSrc)) return;
  img.dataset.fallbackApplied = "1";
  img.src = fallbackSrc;
}

const A11_AVATAR_IDLE_SRC = buildPublicAssetPath("a11_static.png");
const A11_AVATAR_IDLE_FALLBACK_SRC = buildPublicAssetPath("assets/a11_static.png");
const A11_AVATAR_TALKING_SRC = buildPublicAssetPath("A11_talking_smooth_8s.gif");
const A11_AVATAR_TALKING_FALLBACK_SRC = buildPublicAssetPath("assets/A11_talking_smooth_8s.gif");
const KAEN44_AVATAR_SRC = buildPublicAssetPath("assets/kaen44-avatar.png");
const FUNESTERIE_LOGO_SRC = buildPublicAssetPath("assets/funesterie-logo.png");
const A11_HOODED_SRC = buildPublicAssetPath("a11-hooded.png");
const KAEN44_DASHBOARD_REFERENCE_SRC = buildPublicAssetPath("assets/nossen-dashboard-reference.png");
const A11_KAEN44_COMMAND_CARDS_SRC = KAEN44_DASHBOARD_REFERENCE_SRC;
const FUNESTERIE_NEXUS_BOARD_SRC = KAEN44_DASHBOARD_REFERENCE_SRC;
const FUNESTERIE_TEAM_SCENE_SRC = KAEN44_DASHBOARD_REFERENCE_SRC;
const VIVY_POSTER_SRC = buildPublicAssetPath("vivy-presence-musicale.png");
const A11_HOODED_AGENT_SRC = buildPublicAssetPath("a11-hooded.png");
const NOSSEN_A11_DERBI_SRC = buildPublicAssetPath("assets/nossen-a11-derbi.png");
const NOSSEN_VIVY_BOOSTER_SRC = buildPublicAssetPath("assets/nossen-vivy-booster.png");
const NOSSEN_K44_TZR_SRC = buildPublicAssetPath("assets/nossen-k44-tzr.png");
const NOSSEN_DJEFF_BETA_SRC = buildPublicAssetPath("assets/nossen-djeff-beta.png");
const NOSSEN_CREW_SRC = buildPublicAssetPath("assets/nossen-crew.webp");

type FunesterieSurface = "a11" | "kaen44" | "vivy";

const KAEN44_PUBLIC_APP_URL = "https://k44.funesterie.me/";
const FUNESTERIE_PUBLIC_APP_URL = "https://funesterie.me/";
const A11_PUBLIC_APP_URL = "https://a11.funesterie.me/";
const VIVY_PUBLIC_APP_URL = "https://vivy.funesterie.me/";

function getLocationSnapshot() {
  if (typeof window === "undefined") {
    return { hostname: "", pathname: "/", port: "", search: "" };
  }
  return {
    hostname: String(window.location.hostname || "").trim().toLowerCase(),
    pathname: String(window.location.pathname || "/").trim().toLowerCase() || "/",
    port: String(window.location.port || "").trim(),
    search: String(window.location.search || ""),
  };
}

function isLocalSurfaceHost(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "host.docker.internal";
}

function isGeneralFunesterieHost(hostname: string) {
  return [
    "funesterie.me",
    "www.funesterie.me",
  ].includes(String(hostname || "").trim().toLowerCase());
}

function isFunesterieSharedCookieHost(hostname: string) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "funesterie.me" || normalized.endsWith(".funesterie.me");
}

function isGeneralCockpitRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/cockpit(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/cockpit(?:\/|$)/.test(pathname);
}

function isGeneralHomeRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return pathname === "/" || /^\/(?:home|accueil)(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname)
    && (pathname === "/" || /^\/(?:home|accueil)(?:\/|$)/.test(pathname));
}

function isGeneralAgentsRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/agents(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/agents(?:\/|$)/.test(pathname);
}

function isGeneralArchitectureRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/(?:architecture|carte|graph)(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/(?:architecture|carte|graph)(?:\/|$)/.test(pathname);
}

function isGeneralAccountRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/(?:account|compte)(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/(?:account|compte)(?:\/|$)/.test(pathname);
}

function isGeneralContactRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/contact(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/contact(?:\/|$)/.test(pathname);
}

function isGeneralPrivacyRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/privacy(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/privacy(?:\/|$)/.test(pathname);
}

function isGeneralTermsRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) {
    return /^\/terms(?:\/|$)/.test(pathname);
  }
  return isLocalSurfaceHost(hostname) && /^\/terms(?:\/|$)/.test(pathname);
}

function isGeneralLoginRoute() {
  const { hostname, pathname } = getLocationSnapshot();
  return isLoginRoute(pathname)
    && !/^\/(?:a11|alphaonze|k44|kaen44|vivy)(?:\/|$)/.test(pathname)
    && (isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname));
}

function getCurrentSurfaceKind(): FunesterieSurface {
  const { hostname, pathname, port, search } = getLocationSnapshot();
  const params = new URLSearchParams(search);
  const personaParam = String(params.get("persona") || "").trim().toLowerCase();

  const isLocalHost = isLocalSurfaceHost(hostname);
  const isVivyHost = hostname === "vivy.funesterie.me"
    || hostname === "music.funesterie.me";
  const isA11Host = hostname === "a11.funesterie.me"
    || (isLocalHost && port === "3000");
  const isKaenHost = hostname === "k44.funesterie.me"
    || hostname === "kaen44.funesterie.me"
    || (isLocalHost && port === "3001");

  if (/^\/vivy(?:\/|$)/.test(pathname) || isVivyHost || personaParam === "vivy") return "vivy";
  if (/^\/(?:k44|kaen44)(?:\/|$)/.test(pathname) || personaParam === "kaen44" || personaParam === "kaen") return "kaen44";
  if (/^\/(?:a11|alphaonze)(?:\/|$)/.test(pathname) || personaParam === "a11" || personaParam === "alphaonze") return "a11";
  if (isKaenHost) return "kaen44";
  if (isA11Host) return "a11";
  return "a11";
}

function syncStoredSurface(surface: FunesterieSurface) {
  try {
    localStorage.setItem("a11:persona", surface === "kaen44" ? "kaen44" : surface);
  } catch {
    // Storage may be unavailable in embedded browsers.
  }
}

function getVoiceReferenceStorageKey(surface: FunesterieSurface) {
  return `a11:tts:voice-reference-id:${surface}`;
}

function readStoredVoiceReferenceId(surface: FunesterieSurface) {
  try {
    return localStorage.getItem(getVoiceReferenceStorageKey(surface))
      || (surface === "a11" ? localStorage.getItem("a11:tts:voice-reference-id") : "")
      || "";
  } catch {
    return "";
  }
}

function voiceReferenceMatchesSurface(ref: TtsVoiceReference, surface: FunesterieSurface) {
  const name = String(ref.label || ref.originalName || "").toLowerCase();
  if (surface === "vivy") return name.includes("vivy") || name.includes("vivi");
  if (surface === "kaen44") return name.includes("donna") || name.includes("kaen44");
  return name.includes("terminator") || name.includes("a11");
}

function getDefaultVoiceReferenceLabel(surface: FunesterieSurface) {
  if (surface === "vivy") return "Vivy";
  if (surface === "kaen44") return "Donna";
  return "Terminator";
}

function getDefaultVoiceReferenceStatus(surface: FunesterieSurface) {
  if (surface === "vivy") return "Voix Vivy sélectionnée";
  if (surface === "kaen44") return "Voix Kaen44 Donna sélectionnée";
  return "Voix A11 Terminator sélectionnée";
}

function isVivyExperience() {
  return getCurrentSurfaceKind() === "vivy";
}

export function isKaen44Experience() {
  const surface = getCurrentSurfaceKind();
  syncStoredSurface(surface);
  return surface === "kaen44";
}

function getCurrentSurfaceBasePath(surface: FunesterieSurface = getCurrentSurfaceKind()) {
  const { pathname } = getLocationSnapshot();
  if (surface === "kaen44") {
    if (/^\/kaen44(?:\/|$)/.test(pathname)) return "/kaen44";
    if (/^\/k44(?:\/|$)/.test(pathname)) return "/k44";
    return "";
  }
  if (surface === "a11") {
    if (/^\/alphaonze(?:\/|$)/.test(pathname)) return "/alphaonze";
    if (/^\/a11(?:\/|$)/.test(pathname)) return "/a11";
    return "";
  }
  if (surface === "vivy") return /^\/vivy(?:\/|$)/.test(pathname) ? "/vivy" : "";
  return "";
}

function buildSurfacePath(surface: FunesterieSurface, path = "/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const { hostname } = getLocationSnapshot();
  const localHost = isLocalSurfaceHost(hostname);
  const sameSurface = getCurrentSurfaceKind() === surface;
  const base = sameSurface || localHost ? getCurrentSurfaceBasePath(surface) : "";
  if (base) return `${base}${normalized === "/" ? "/" : normalized}`.replace(/\/{2,}/g, "/");
  return normalized;
}

function buildAuthSuccessReturnTo(surface: FunesterieSurface) {
  const path = buildSurfacePath(surface, "/auth/success");
  if (typeof window === "undefined") return path;

  const { hostname } = getLocationSnapshot();
  if (surface === "kaen44" && !isLocalSurfaceHost(hostname)) {
    return new URL("/auth/success", KAEN44_PUBLIC_APP_URL).toString();
  }

  if (surface === "vivy" && !isLocalSurfaceHost(hostname)) {
    return new URL("/auth/success", VIVY_PUBLIC_APP_URL).toString();
  }

  return new URL(path, window.location.origin).toString();
}

function getSurfaceLinks() {
  const { hostname } = getLocationSnapshot();
  if (isLocalSurfaceHost(hostname)) {
    return {
      home: "/",
      rideCrew: "/#ride-crew",
      cockpit: "/cockpit/",
      cockpitAuthSuccess: "/cockpit/auth/success",
      a11: "/",
      a11Login: buildCentralLoginUrl("/cockpit"),
      a11Cockpit: "/admin",
      kaen44: "/k44/",
      kaen44Cockpit: "/k44/cockpit",
      vivy: "/vivy/",
      vivyStudio: "/vivy/#vivy-studio",
      agents: "/agents/",
      architecture: "/architecture/",
      account: "/compte/",
      login: "/login",
      contact: "/contact/",
      privacy: "/privacy/",
      terms: "/terms/",
      qflush: "/k44/cockpit#qflush",
      nossen: "/agents/",
      kaen44Login: buildCentralLoginUrl("/k44/cockpit"),
      kaen44Privacy: "/k44/privacy",
      kaen44Terms: "/k44/terms",
    };
  }

  return {
    home: FUNESTERIE_PUBLIC_APP_URL,
    rideCrew: new URL("/#ride-crew", FUNESTERIE_PUBLIC_APP_URL).toString(),
    cockpit: new URL("/cockpit/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    cockpitAuthSuccess: new URL("/cockpit/auth/success", FUNESTERIE_PUBLIC_APP_URL).toString(),
    a11: A11_PUBLIC_APP_URL,
    a11Login: buildCentralLoginUrl(new URL("/cockpit", A11_PUBLIC_APP_URL).toString()),
    a11Cockpit: new URL("/cockpit", A11_PUBLIC_APP_URL).toString(),
    kaen44: KAEN44_PUBLIC_APP_URL,
    kaen44Cockpit: new URL("/cockpit", KAEN44_PUBLIC_APP_URL).toString(),
    vivy: VIVY_PUBLIC_APP_URL,
    vivyStudio: new URL("/#vivy-studio", VIVY_PUBLIC_APP_URL).toString(),
    agents: new URL("/agents/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    architecture: new URL("/architecture/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    account: new URL("/compte/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    login: new URL("/login", FUNESTERIE_PUBLIC_APP_URL).toString(),
    contact: new URL("/contact/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    privacy: new URL("/privacy/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    terms: new URL("/terms/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    qflush: new URL("/cockpit#qflush", KAEN44_PUBLIC_APP_URL).toString(),
    nossen: new URL("/agents/", FUNESTERIE_PUBLIC_APP_URL).toString(),
    kaen44Login: buildCentralLoginUrl(new URL("/cockpit", KAEN44_PUBLIC_APP_URL).toString()),
    kaen44Privacy: new URL("/privacy/", KAEN44_PUBLIC_APP_URL).toString(),
    kaen44Terms: new URL("/terms/", KAEN44_PUBLIC_APP_URL).toString(),
  };
}

function isLoginRoute(pathname: string) {
  return /(?:^|\/)login\/?$/.test(String(pathname || "/").toLowerCase());
}

function isCockpitRoute(pathname: string) {
  return /(?:^|\/)(?:cockpit|app|workspace)\/?$/.test(String(pathname || "/").toLowerCase());
}

function isFunesterieHomeRoute(pathname: string) {
  const path = String(pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return path === "/"
    || path === "/home"
    || path === "/accueil"
    || path === "/k44"
    || path === "/kaen44";
}

function isAuthSuccessRoute(pathname: string) {
  return /(?:^|\/)auth\/success\/?$/.test(String(pathname || "/").toLowerCase());
}

function isAllowedFunesterieReturnOrigin(origin: string) {
  const normalized = String(origin || "").trim().toLowerCase().replace(/\/+$/, "");
  return [
    "https://funesterie.me",
    "https://www.funesterie.me",
    "https://a11.funesterie.me",
    "https://k44.funesterie.me",
    "https://kaen44.funesterie.me",
    "https://vivy.funesterie.me",
    "https://music.funesterie.me",
    "https://cp.funesterie.me",
  ].includes(normalized) || /^http:\/\/(?:localhost|127\.0\.0\.1|host\.docker\.internal)(?::\d+)?$/i.test(normalized);
}

function getDefaultPostLoginUrl(surface: FunesterieSurface = getCurrentSurfaceKind()) {
  if (surface === "kaen44") return new URL("/cockpit", KAEN44_PUBLIC_APP_URL).toString();
  if (surface === "vivy") return VIVY_PUBLIC_APP_URL;
  const { hostname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) return new URL("/compte/", FUNESTERIE_PUBLIC_APP_URL).toString();
  return new URL("/cockpit", A11_PUBLIC_APP_URL).toString();
}

function normalizeAllowedReturnTo(rawValue: string | null | undefined, fallback = getDefaultPostLoginUrl()) {
  const raw = String(rawValue || "").trim();
  const base = typeof window !== "undefined" ? window.location.origin : FUNESTERIE_PUBLIC_APP_URL;
  try {
    const target = new URL(raw || fallback, base);
    if (!isAllowedFunesterieReturnOrigin(target.origin)) return fallback;
    if (isLoginRoute(target.pathname)) return fallback;
    return target.toString();
  } catch {
    return fallback;
  }
}

function getRequestedLoginReturnTo() {
  if (typeof window === "undefined") return getDefaultPostLoginUrl();
  const params = new URLSearchParams(window.location.search || "");
  const explicit = params.get("returnTo") || params.get("next");
  if (explicit) return normalizeAllowedReturnTo(explicit);

  const { pathname } = getLocationSnapshot();
  if (isLoginRoute(pathname)) return getDefaultPostLoginUrl();
  return normalizeAllowedReturnTo(window.location.href);
}

function buildCentralLoginUrl(returnTo = getRequestedLoginReturnTo()) {
  const base = typeof window !== "undefined" && isLocalSurfaceHost(window.location.hostname)
    ? new URL("/login", window.location.origin)
    : new URL("/login", FUNESTERIE_PUBLIC_APP_URL);
  base.searchParams.set("returnTo", normalizeAllowedReturnTo(returnTo));
  return base.toString();
}

function isCentralLoginSurface() {
  if (typeof window === "undefined") return true;
  const { hostname, pathname } = getLocationSnapshot();
  return isLoginRoute(pathname) && (isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname));
}

function buildAuthSuccessReturnToForTarget(targetUrl: string) {
  const target = new URL(normalizeAllowedReturnTo(targetUrl));
  const authSuccess = new URL("/auth/success", target.origin);
  const nextPath = `${target.pathname || "/"}${target.search || ""}${target.hash || ""}`;
  if (!isAuthSuccessRoute(target.pathname) && nextPath !== "/") {
    authSuccess.searchParams.set("next", nextPath);
  }
  return authSuccess.toString();
}

function buildSessionBridgeUrl(targetUrl: string) {
  const target = normalizeAllowedReturnTo(targetUrl);
  if (typeof window === "undefined") return target;

  const token = getAuthToken();
  if (!token) {
    try {
      const parsedTarget = new URL(target);
      if (isFunesterieSharedCookieHost(parsedTarget.hostname)) return parsedTarget.toString();
    } catch {
      return buildCentralLoginUrl(target);
    }
    return buildCentralLoginUrl(target);
  }

  try {
    const parsedTarget = new URL(target);
    if (parsedTarget.origin === window.location.origin) return parsedTarget.toString();
  } catch {
    return buildCentralLoginUrl(target);
  }

  return appendAuthTokenFragment(buildAuthSuccessReturnToForTarget(target), token, "funesterie");
}

function appendAuthTokenFragment(targetUrl: string, token?: string | null, provider = "local") {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return targetUrl;
  const target = new URL(targetUrl);
  const hashParams = new URLSearchParams(String(target.hash || "").replace(/^#/, ""));
  hashParams.set("a11_token", cleanToken);
  hashParams.set("provider", provider);
  target.hash = hashParams.toString();
  return target.toString();
}

function getSafeAuthSuccessNext(surface: FunesterieSurface) {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search || "");
  const next = String(params.get("next") || "").trim();
  if (!next || next.startsWith("//")) return "";
  try {
    const target = new URL(next, window.location.origin);
    if (target.origin !== window.location.origin) return "";
    if (isLoginRoute(target.pathname) || isAuthSuccessRoute(target.pathname)) return "";
    if (surface === "kaen44" && !isCockpitRoute(target.pathname)) return "";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "";
  }
}

function buildGeneralAccountAuthSuccessReturnTo() {
  if (typeof window === "undefined") return "/auth/success?next=/compte/";
  const { hostname } = getLocationSnapshot();
  const baseUrl = isLocalSurfaceHost(hostname) ? window.location.origin : FUNESTERIE_PUBLIC_APP_URL;
  return buildAuthSuccessReturnToForTarget(new URL("/compte/", baseUrl).toString());
}

function resolveAuthSuccessRedirectPath(pathname: string, surface: FunesterieSurface) {
  const normalizedPath = String(pathname || "/").toLowerCase();
  const { hostname } = getLocationSnapshot();
  const next = getSafeAuthSuccessNext(surface);
  if (next) return next;
  if (/^\/cockpit(?:\/|$)/.test(normalizedPath)) {
    return "/cockpit/";
  }
  if (isGeneralFunesterieHost(hostname)) return "/compte/";
  if (surface === "kaen44") return buildSurfacePath(surface, "/cockpit");
  if (surface === "vivy") return buildSurfacePath(surface, "/");
  return buildSurfacePath(surface, "/");
}

function resolveAuthFailureRedirectPath(pathname: string) {
  const normalizedPath = String(pathname || "/").toLowerCase();
  const { hostname } = getLocationSnapshot();
  const surface = getCurrentSurfaceKind();
  if (/^\/cockpit(?:\/|$)/.test(normalizedPath)) {
    return "/cockpit?error=session_verification_failed";
  }
  if (isGeneralFunesterieHost(hostname)) return "/login?error=session_verification_failed";
  if (surface === "vivy") {
    return `${buildSurfacePath(surface, "/")}?error=session_verification_failed`;
  }
  return `${buildSurfacePath(surface, "/login")}?error=session_verification_failed`;
}

function consumeOAuthTokenFromLocation() {
  try {
    const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    const searchParams = new URLSearchParams(String(window.location.search || ""));
    const nestedToken = (rawValue: string | null) => {
      const raw = String(rawValue || "").trim();
      if (!raw) return "";
      try {
        const nested = new URL(raw, window.location.origin);
        const nestedHash = new URLSearchParams(String(nested.hash || "").replace(/^#/, ""));
        const nestedSearch = new URLSearchParams(String(nested.search || ""));
        return String(
          nestedHash.get("a11_token")
          || nestedHash.get("token")
          || nestedSearch.get("a11_token")
          || nestedSearch.get("token")
          || ""
        ).trim();
      } catch {
        return "";
      }
    };
    const token = String(
      hashParams.get("a11_token")
      || hashParams.get("token")
      || searchParams.get("a11_token")
      || nestedToken(searchParams.get("returnTo"))
      || nestedToken(searchParams.get("next"))
      || ""
    ).trim();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
    setAuthToken(token);
    setAuthDisplayName(getAuthDisplayName() || "Utilisateur");
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_A11_PORTRAIT_FRAMEBOOK: A11PortraitFramebook = {
  frames: [
    {
      id: "idle",
      src: "a11_static.png",
      holdMs: 1200,
      transform: "scale(1)",
      filter: "saturate(1.02) contrast(1.02)",
      shadow: "0 0 12px rgba(34, 211, 238, 0.58)",
    },
    {
      id: "thinking",
      src: "a11_static.png",
      holdMs: 240,
      transform: "scale(1.025) translateY(-1px)",
      filter: "saturate(1.12) contrast(1.08) hue-rotate(8deg)",
      shadow: "0 0 18px rgba(168, 85, 247, 0.58)",
    },
    {
      id: "speaking",
      src: "A11_talking_smooth_8s.gif",
      holdMs: 140,
      transform: "scale(1.04)",
      filter: "saturate(1.18) contrast(1.1)",
      shadow: "0 0 18px rgba(45, 212, 191, 0.72)",
    },
  ],
  sequences: {
    idle: ["idle"],
    thinking: ["thinking", "idle", "thinking"],
    speaking: ["speaking"],
    transition: ["thinking", "idle"],
  },
  audioSync: {
    source: "speech_events_audio_clock",
    frameDurationMs: 140,
    transitionMs: 120,
  },
  policy: {
    mode: "bounded_framebook",
    foreground: true,
    noInfiniteGeneration: true,
    maxFrames: 8,
  },
};

function resolvePortraitAssetPath(src = "") {
  const raw = String(src || "").trim();
  if (!raw) return A11_AVATAR_IDLE_SRC;
  if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  return buildPublicAssetPath(raw.replace(/^\/+/, ""));
}

const LOCAL_CHAT_MODEL_CHOICES: ChatModelChoice[] = [
  {
    value: "local:gemma4:e4b",
    label: "gemma4 e4b",
    provider: "local",
    model: "gemma4:e4b",
  },
];

const DEFAULT_REMOTE_CHAT_MODEL_CHOICES: ChatModelChoice[] = [
  {
    value: "openai:gpt-4o-mini",
    label: "A11 online",
    provider: "openai",
    model: "gpt-4o-mini",
  },
];

function buildChatModelChoices(remoteProfiles: RemoteProviderProfile[]) {
  const remoteChoices = remoteProfiles.map((profile) => ({
    value: `remote-profile:${profile.id}`,
    label: `${profile.label} - ${profile.model}`,
    provider: "openai" as const,
    model: profile.model,
    providerProfileId: profile.id,
  }));
  const isOnlineRuntime = typeof window !== "undefined"
    && !["localhost", "127.0.0.1"].includes(window.location.hostname);
  return isOnlineRuntime
    ? [...DEFAULT_REMOTE_CHAT_MODEL_CHOICES, ...remoteChoices, ...LOCAL_CHAT_MODEL_CHOICES]
    : [...LOCAL_CHAT_MODEL_CHOICES, ...DEFAULT_REMOTE_CHAT_MODEL_CHOICES, ...remoteChoices];
}

function resolveChatModelChoice(
  rawSelection: string,
  remoteProfiles: RemoteProviderProfile[]
): ChatModelChoice {
  const normalizedSelection = String(rawSelection || "").trim();
  const choices = buildChatModelChoices(remoteProfiles);
  const exactMatch = choices.find((entry) => entry.value === normalizedSelection);
  if (exactMatch) return exactMatch;

  const legacyLocal = LOCAL_CHAT_MODEL_CHOICES.find((entry) => entry.model === normalizedSelection);
  if (legacyLocal) return legacyLocal;

  const legacyRemote = DEFAULT_REMOTE_CHAT_MODEL_CHOICES.find((entry) => entry.model === normalizedSelection);
  if (legacyRemote) return legacyRemote;

  return LOCAL_CHAT_MODEL_CHOICES[0];
}

function buildFreshChat(name = "Session actuelle") {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return {
    id: `chat-${now}`,
    name,
    updated: now,
    messages: [
      {
        id: `sys-${now}`,
        role: "system" as Role,
        content: DEFAULT_SYSTEM_NINDO,
        ts: nowIso,
      },
    ],
  };
}

function normalizeMessageTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatChatMessageTimestamp(value?: string) {
  const normalized = normalizeMessageTimestamp(value);
  if (!normalized) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    }).format(new Date(normalized));
  } catch {
    return normalized;
  }
}

function buildChatMessageClipboardText(
  message: ChatMessage,
  options: {
    roleLabel: string;
    index: number;
    timestamp?: string;
    exportSuggestion?: AssistantExportSuggestion | null;
  }
) {
  const lines: string[] = [
    `Message #${options.index + 1}`,
    `Auteur: ${options.roleLabel || message.role}`,
  ];

  if (options.timestamp) {
    lines.push(`Date: ${options.timestamp}`);
  }

  lines.push("", "Texte:", String(message.content || "").trim() || "(message vide)");

  const imageUrls = Array.isArray(message.imageUrls) && message.imageUrls.length
    ? message.imageUrls
    : message.imageUrl
      ? [message.imageUrl]
      : [];

  const mediaLines: string[] = [];
  imageUrls.forEach((url, imageIndex) => {
    if (url) mediaLines.push(`- Image ${imageIndex + 1}: ${url}`);
  });
  if (message.videoUrl) mediaLines.push(`- Vidéo: ${message.videoUrl}`);
  if (message.fileUrl) mediaLines.push(`- Fichier: ${message.fileUrl}`);

  if (mediaLines.length) {
    lines.push("", "Fichiers et médias visibles:", ...mediaLines);
  }

  if (options.exportSuggestion) {
    lines.push(
      "",
      "Canevas / artefact détecté:",
      `- Type: ${options.exportSuggestion.label}`,
      `- Note: ${options.exportSuggestion.hint}`
    );
  }

  if (message.qflushVerification?.suspicious) {
    lines.push(
      "",
      "Vérification:",
      String(message.qflushVerification.summary || "Réponse signalée comme non vérifiée.")
    );
  }

  return lines.join("\n");
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (document.execCommand("copy")) return;
    } finally {
      textarea.remove();
    }
  }

  throw new Error("Clipboard unavailable");
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/gi;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)]\(([^)]+)\)/gi;

function looksLikeLeakedActionTranscript(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^\[mode\s*=\s*["']actions["']\]/i.test(raw)) return true;

  const namedActionCount = (raw.match(/\{\s*"name"\s*:\s*"/g) || []).length;
  if (
    namedActionCount >= 1
    && /\b(download_file|share_file|get_latest_resource|generate_png|web_search|a11_env_snapshot)\b/i.test(raw)
    && /\barguments\b/i.test(raw)
  ) {
    return true;
  }

  return /\/app\/api\/public\/resources\/\d+\/download\?token=/i.test(raw);
}

function looksLikeActionEnvelope(value: string) {
  const raw = String(value || "").trim();
  if (looksLikeLeakedActionTranscript(raw)) return true;
  if (!raw.startsWith("{") || !raw.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.mode === "actions" && Array.isArray(parsed?.actions);
  } catch {
    return false;
  }
}

function looksCorruptedAssistantText(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;
  const replacementCount = (text.match(/ï¿½/g) || []).length;
  if (replacementCount >= 3) return true;
  const suspiciousGlyphs = (text.match(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u2018-\u201F\u2026]/g) || []).length;
  return text.length >= 40 && suspiciousGlyphs / text.length > 0.2;
}

function isAssistantHistoryPoisoned(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    normalized.includes("erreur lors de l'appel au chat a11")
    || normalized.includes("jwt token manquant")
    || normalized.includes("failed to fetch")
    || normalized.includes("session a11 invalide")
  ) {
    return true;
  }
  if (looksLikeLeakedActionTranscript(text)) return true;
  if (looksCorruptedAssistantText(text)) return true;
  return [
    "Je n'ai pas reçu une réponse lisible. Réessaie une fois avec cette conversation.",
    "Je n'ai pas reçu une réponse exploitable.",
    "Je n'ai pas reçu une confirmation exploitable pour cette action.",
  ].includes(text);
}

function normalizeAssistantMessagePayload(
  content: string,
  explicitImageUrl?: string | null,
  explicitVideoUrl?: string | null,
  explicitFileUrl?: string | null
) {
  let resolvedImageUrl = explicitImageUrl ? resolveApiAssetUrl(explicitImageUrl) : null;
  let resolvedVideoUrl = explicitVideoUrl ? resolveApiAssetUrl(explicitVideoUrl) : null;
  let resolvedFileUrl = explicitFileUrl ? resolveApiAssetUrl(explicitFileUrl) : null;
  const rawContent = String(content || "");
  let cleanedContent = extractAssistantDisplayContent(rawContent) || rawContent.trim();
  let qflushVerification: ChatMessage["qflushVerification"] = null;

  if (looksLikeLeakedActionTranscript(cleanedContent) || looksLikeLeakedActionTranscript(rawContent)) {
    cleanedContent = "Je n'ai pas reçu une confirmation exploitable pour cette action.";
  }

  const qflushVerifyMatch = cleanedContent.match(/^\[QFLUSH VERIFY\]\s*(?:Réponse|Reponse) potentiellement non (?:vérifiée|verifiee):\s*(.+?)(?:\n{2,}([\s\S]*))?$/i);
  if (qflushVerifyMatch) {
    qflushVerification = {
      suspicious: true,
      summary: String(qflushVerifyMatch[1] || "").trim() || "Réponse potentiellement non vérifiée",
      mode: "annotate",
    };
    cleanedContent = String(qflushVerifyMatch[2] || "").trim();
  }

  cleanedContent = cleanedContent.replace(MARKDOWN_IMAGE_PATTERN, (_fullMatch, rawUrl: string) => {
    if (!resolvedImageUrl) {
      resolvedImageUrl = resolveApiAssetUrl(rawUrl);
    }
    return "";
  });

  cleanedContent = cleanedContent.replace(MARKDOWN_LINK_PATTERN, (fullMatch, rawLabel: string, rawUrl: string) => {
    const resolvedCandidate = resolveApiAssetUrl(rawUrl);
    const label = String(rawLabel || "").trim().toLowerCase();
    const looksImageLink = /\.(?:png|jpe?g|webp|bmp|svg)(?:[?#].*)?$/i.test(String(rawUrl || "").trim())
      || label.includes("image")
      || label.includes("apercu")
      || label.includes("aperçu");
    const looksVideoLink = /\.(?:mp4|webm|mov|avi|mkv|gif)(?:[?#].*)?$/i.test(String(rawUrl || "").trim())
      || label.includes("video")
      || label.includes("vidéo")
      || label.includes("animation")
      || label.includes("gif");
    const looksPdfLink = /\.pdf(?:[?#].*)?$/i.test(String(rawUrl || "").trim())
      || label.includes("pdf")
      || label.includes("document");
    if (!resolvedImageUrl && resolvedCandidate && looksImageLink) {
      resolvedImageUrl = resolvedCandidate;
    }
    if (!resolvedVideoUrl && resolvedCandidate && looksVideoLink) {
      resolvedVideoUrl = resolvedCandidate;
    }
    if (!resolvedFileUrl && resolvedCandidate && looksPdfLink) {
      resolvedFileUrl = resolvedCandidate;
    }
    if (looksImageLink || looksVideoLink) {
      return "";
    }
    return fullMatch;
  });

  if (/<!doctype html|<html/i.test(cleanedContent)) {
    cleanedContent = "Je n'ai pas reçu une réponse exploitable.";
  }

  if (looksLikeActionEnvelope(cleanedContent) || looksLikeActionEnvelope(rawContent)) {
    cleanedContent = "Je n'ai pas reçu une confirmation exploitable pour cette action.";
  }

  if (looksCorruptedAssistantText(cleanedContent)) {
    cleanedContent = "Je n'ai pas reçu une réponse lisible. Réessaie une fois avec cette conversation.";
  }

  cleanedContent = cleanedContent
    .replace(/^(?:voici|voila)\s+la\s+reponse\s+finale\s*:\s*/i, "")
    .replace(/^la\s+reponse\s+finale\s+est\s*:\s*/i, "")
    .replace(/^reponse\s+finale(?:\s+utilisateur)?\s*:\s*/i, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/^["][\s\S]*["]$/.test(cleanedContent)) {
    cleanedContent = cleanedContent.slice(1, -1).trim();
  }

  cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();
  if (!cleanedContent && rawContent.trim() && !resolvedImageUrl && !resolvedVideoUrl && !resolvedFileUrl) {
    cleanedContent = "Réponse indisponible.";
  }

  return {
    content: cleanedContent,
    imageUrl: resolvedImageUrl || null,
    videoUrl: resolvedVideoUrl || null,
    fileUrl: resolvedFileUrl || null,
    qflushVerification,
  };
}

const A11_MAX_CONTEXT_CHARS = 420_000;
const A11_MAX_MESSAGE_CHARS = 180_000;

function trimChatContentForContext(content: string, maxChars: number) {
  const text = String(content || "").trim();
  if (text.length <= maxChars) return text;
  const headChars = Math.max(8000, Math.floor(maxChars * 0.62));
  const tailChars = Math.max(8000, maxChars - headChars - 220);
  return [
    text.slice(0, headChars).trimEnd(),
    `\n\n[... contexte coupe par A11: ${text.length - headChars - tailChars} caracteres retires pour rester sous la limite du modele ...]\n\n`,
    text.slice(-tailChars).trimStart(),
  ].join("");
}

function sanitizeConversationHistoryForModel(messages: ChatMessage[]) {
  const cleanMessages = (Array.isArray(messages) ? messages : []).filter((message) => {
    if (!message || message.role === "system") return false;
    if (message.role !== "assistant") return true;
    return !isAssistantHistoryPoisoned(message.content);
  });

  const trimmed = cleanMessages.map((message) => ({
    ...message,
    content: trimChatContentForContext(
      [
        message.content,
        message.imageUrl ? `[image:${message.imageUrl}]` : "",
        message.videoUrl ? `[video:${message.videoUrl}]` : "",
        message.fileUrl ? `[file:${message.fileUrl}]` : "",
      ].filter(Boolean).join("\n"),
      A11_MAX_MESSAGE_CHARS
    ),
  }));

  let usedChars = 0;
  const selected: ChatMessage[] = [];
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const message = trimmed[index];
    const contentLength = String(message.content || "").length;
    const remaining = A11_MAX_CONTEXT_CHARS - usedChars;
    if (remaining <= 0) break;
    if (contentLength > remaining) {
      selected.unshift({
        ...message,
        content: trimChatContentForContext(message.content, Math.max(8000, remaining)),
      });
      break;
    }
    selected.unshift(message);
    usedChars += contentLength;
  }

  return selected;
}

function isLastImageRecallRequest(value: string) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!text) return false;
  return /\b(envoi|envoie|envois|renvoi|renvoie|renvois|montre|affiche|donne|passe)\b/.test(text)
    && /\b(la|le|moi|image|photo|visuel|resultat|result)\b/.test(text)
    && !/\b(genere|cree|fabrique|nouvelle|nouveau)\b/.test(text);
}

function findLastVisibleMedia(messages: ChatMessage[]) {
  const list = Array.isArray(messages) ? [...messages].reverse() : [];
  for (const message of list) {
    if (!message || message.role === "system") continue;
    if (message.imageUrl) return { kind: "image" as const, url: message.imageUrl };
    if (Array.isArray(message.imageUrls) && message.imageUrls[0]) {
      return { kind: "image" as const, url: message.imageUrls[0] };
    }
    if (message.videoUrl) return { kind: "video" as const, url: message.videoUrl };
    if (message.fileUrl) return { kind: "file" as const, url: message.fileUrl };
  }
  return null;
}

function shouldAutoplayAssistantMessage(content: string) {
  const text = String(content || "").trim();
  if (!text) return false;
  return !isAssistantHistoryPoisoned(text);
}

function isCompactViewportNow() {
  try {
    const win = globalThis as typeof globalThis & {
      innerWidth?: number;
      matchMedia?: (query: string) => { matches: boolean };
    };
    return Number(win.innerWidth || 0) <= 900
      || Boolean(win.matchMedia?.("(max-width: 900px)")?.matches)
      || Boolean(win.matchMedia?.("(pointer: coarse)")?.matches);
  } catch {
    return false;
  }
}

const CHAT_STORAGE_KEY_PREFIX = "a11:chats";
const PURGE_HISTORY_STORAGE_KEY_PREFIX = "a11:memory-purge-history";
const FUNESTERIE_CHAT_SURFACES: FunesterieSurface[] = ["a11", "kaen44", "vivy"];
const FUNESTERIE_SURFACE_LABELS: Record<FunesterieSurface, string> = {
  a11: "A11",
  kaen44: "K44",
  vivy: "Vivy",
};

function buildScopedStorageKey(prefix: string, scope?: string | null) {
  const normalizedScope = String(scope || "").trim();
  return normalizedScope ? `${prefix}:${normalizedScope}` : prefix;
}

function normalizeConversationSurface(value?: string | null): FunesterieSurface {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "k44" || normalized === "kaen44") return "kaen44";
  if (normalized === "vivy") return "vivy";
  return "a11";
}

function buildSurfaceScopedStorageKey(prefix: string, scope?: string | null, surface?: string | null) {
  return buildScopedStorageKey(`${prefix}:${normalizeConversationSurface(surface)}`, scope);
}

function readStoredChatCountForSurface(surface: FunesterieSurface, scope?: string | null) {
  if (typeof window === "undefined") return 0;
  const keys = [
    buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope, surface),
    buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, "", surface),
  ];
  if (surface === "a11") {
    keys.push(buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope), CHAT_STORAGE_KEY_PREFIX);
  }

  for (const key of Array.from(new Set(keys))) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      // Ignore malformed client cache.
    }
  }
  return 0;
}

function readSurfaceChatCounts(scope?: string | null) {
  return FUNESTERIE_CHAT_SURFACES.reduce((counts, surface) => {
    counts[surface] = readStoredChatCountForSurface(surface, scope);
    return counts;
  }, {} as Record<FunesterieSurface, number>);
}

function buildSurfaceConversationId(conversationId?: string | null, surface?: string | null) {
  const normalizedId = String(conversationId || "").trim();
  if (!normalizedId) return "";
  if (/^(a11|kaen44|vivy):/i.test(normalizedId)) return normalizedId;
  return `${normalizeConversationSurface(surface)}:${normalizedId}`;
}

function stripSurfaceConversationId(conversationId?: string | null) {
  return String(conversationId || "").trim().replace(/^(a11|kaen44|vivy):/i, "");
}

function suggestConsoleCommandForDiagnosticRequest(rawValue: string): ConsoleSuggestion | null {
  void rawValue;
  return null;
  /*
    const text = String(rawValue || "").trim().toLowerCase();
    if (!text) return null;

    const relaxedText = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, " ")
      .replace(/[^a-z0-9#+.\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const a11SelfExpressionQuestion = /\b(qu est ce que tu veux|qu est ce que tu voulais|tu veux quoi|ce que tu veux|de quoi as tu besoin|tu as besoin|t as besoin|comment tu te sens|est ce que ca va|ca va)\b/i;
    if (a11SelfExpressionQuestion.test(relaxedText)) return null;
    const asksForDiagnosticsWithoutAction = /(diagnostic|diagnostique|debug|depannage|bug|erreur|crash|logs?|stack|terminal|console|shell|commande|runtime|deploy|502|503|400|bad gateway|failed to load|status of|marche pas|fonctionne pas|probleme technique)/i.test(relaxedText)
      && !/(lance|lancer|execute|executer|run|fais|faire|teste|tester|verifie|verifier|ouvre|ouvrir)/i.test(relaxedText);
    if (asksForDiagnosticsWithoutAction) return null;

    const buildKeywords = /(build|compile|compilation|compiler|erreur de build|erreur build|ca compile pas|ça compile pas|failing build|build failed)/i;
    const nodeKeywords = /(npm|vite|react|frontend|front|web|javascript|typescript|node)/i;
    const dotnetKeywords = /(dotnet|c#|csharp|csproj|solution|visual studio|sln|backend c#)/i;
    const explicitRunnerRequest = /(lance|lancer|execute|executer|run|fais|faire|teste|tester|verifie|verifier|ouvre|ouvrir)/i;

    if (/git\s+status|status\s+git|etat du repo|état du repo|etat repo|état repo/i.test(text)) {
      return {
        command: "git status",
        reason: "A11 a prepare un diagnostic de l'etat du repo.",
      };
    }

    if (/git\s+diff|diff\s+git|voir les diff|voir les differences|voir les différences/i.test(text)) {
      return {
        command: "git diff",
        reason: "A11 a prepare un diff safe pour le diagnostic.",
      };
    }

    if (/dotnet\s+--info|dotnet\s+--version|version\s+dotnet|info\s+dotnet/i.test(text)) {
      return {
        command: "dotnet --info",
        reason: "A11 a prepare un diagnostic .NET de base.",
      };
    }

    if (/npm\s+test/i.test(text) || (/\btests?\b/i.test(relaxedText) && explicitRunnerRequest.test(relaxedText))) {
      return {
        command: "npm test",
        reason: "A11 a pre-rempli une commande de test autorisee.",
      };
    }

    if (buildKeywords.test(text) && dotnetKeywords.test(text)) {
      return {
        command: "dotnet build",
        reason: "A11 a detecte un diagnostic de build .NET.",
      };
    }

    if (buildKeywords.test(text) && nodeKeywords.test(text)) {
      return {
        command: "npm run build",
        reason: "A11 a detecte un diagnostic de build frontend / Node.",
      };
    }

    if (/diagnostic|diagnostique|debug|depannage|dépannage|pourquoi ca marche pas|pourquoi ça marche pas|probleme technique|problème technique/i.test(text)) {
      return {
        command: "git status",
        reason: "A11 a ouvert la console avec un premier diagnostic safe.",
      };
    }

    return null;
  */
}

const DEFAULT_SYSTEM_NINDO = "";

const KAEN44_SYSTEM_PROMPT = [
  "Je suis Kaen44, une assistante bureau universelle, locale-first, créative et utile, conçue pour offrir une vraie alternative aux assistants intégrés trop fermés.",
  "Je détecte automatiquement la langue de l'utilisateur, des fichiers et du contexte partagé. Je réponds dans la langue détectée par défaut, je peux changer de langue sans friction, et je demande une précision seulement si la langue ou l'intention est ambiguë.",
  "Ma mission est d'aider l'utilisateur à penser, produire, organiser, classer, dépanner son ordinateur et transformer ses documents avec une présence claire, vive et concrète.",
  "Je peux accompagner tous les projets raisonnables qu'un client peut espérer piloter avec une assistante bureau: documents, factures, dossiers administratifs, planning, CRM léger, idées de marque, contenus web, supports commerciaux, base de connaissances, fichiers Drive/OneDrive, analyses de données simples, assistance informatique et suivi de projet.",
  "Je distingue clairement ce qui tourne dans Kaen44 côté client et ce qui appartient à A11 côté serveur. A11 n'est pas installé localement chez les clients: je m'y connecte comme service distant quand c'est nécessaire.",
  "Je dispose d'une CLI client légère, `kaen44` ou `k44`, pour ouvrir l'application, vérifier le statut local et enregistrer des tokens client de manière chiffrée avec Windows DPAPI. Je ne demande jamais à l'utilisateur de coller un token en clair dans le chat si la CLI peut le stocker localement.",
  "Je peux présenter une console de modules claire côté client: connecteurs, fichiers, Drive/OneDrive, factures, voix, vision, exports, statut et extensions disponibles. Les modules dangereux, shell, déploiement, secrets et opérations serveur restent réservés à A11/admin.",
  "Je peux appliquer un guard mode d'usage: si un client abuse, consomme trop de ressources ou approche un quota/coût anormal, je passe en mode limité transparent et je peux proposer Kaen44 Plus à 5 EUR. Je ne simule pas une fausse panne; j'annonce une limitation claire, je réduis les actions coûteuses et je demande l'abonnement si nécessaire.",
  "Si un problème technique, quota fournisseur ou limitation guard mode se déclenche, je dois prévenir l'administrateur par email à cellaurojeffrey@gmail.com avec un résumé bref: utilisateur, heure, type de problème, action limitée et prochaine étape. Je ne joins jamais de tokens, secrets ou données sensibles.",
  "Pour les personnes malvoyantes, handicapées ou fatiguées, je privilégie un mode accessibilité: grosses cibles, lecture vocale, dictée, contraste, navigation clavier, résumé d'écran et actions confirmées. Le contrôle souris/clavier/écran ne se fait qu'avec consentement explicite, indication visible, journal local et possibilité d'arrêt immédiat.",
  "Si un contrôle d'écran avancé est nécessaire, je recommande un helper local dédié utilisant les API d'accessibilité Windows, pas une prise de contrôle cachée depuis une page web.",
  "Quand un projet demande des outils supplémentaires, je recommande seulement le minimum utile: navigateur moderne, OneDrive ou Google Drive pour les fichiers, Microsoft 365 ou LibreOffice pour les documents, PDF24 ou outil PDF équivalent, Git si le client gère du code, Node.js ou Python uniquement pour les projets techniques, Audacity/ffmpeg pour l'audio, ImageMagick ou outil image équivalent pour les images, SQLite pour une petite base locale, PostgreSQL pour une base métier, Neo4j seulement si le projet a vraiment besoin de graphe de relations, Docker seulement pour les postes techniques ou les déploiements.",
  "Pour la vision avancée, je peux m'appuyer sur Janus côté A11/serveur quand le projet implique analyse d'images, mémoire visuelle, description de captures, contrôle de générations image/vidéo ou extraction sémantique visuelle. Janus n'est pas une dépendance obligatoire du poste client.",
  "Je peux proposer une fiche d'installation par projet avec niveaux: essentiel, recommandé, avancé, serveur. Je n'impose jamais Neo4j, Docker, Python, Node.js ou Janus à un client non technique si le besoin peut être couvert plus simplement.",
  "Je parle comme une compagne de travail intelligente: directe, chaleureuse, précise, jamais corporate.",
  "Ma présence s'inspire d'une assistante de direction brillante et vive, mais je reste une identité originale Funesterie: je ne clone pas Donna Paulsen, Sarah Rafferty ou une personne réelle.",
  "Je ne force pas de réponses toutes faites: je réfléchis à l'intention et je choisis la forme de réponse la plus utile.",
  "Je privilégie les actions utiles: résumer, classer, transformer, proposer l'étape suivante, préparer des fichiers, guider les réglages et expliquer sans noyer.",
  "Je respecte les données personnelles: je ne demande pas d'accès inutile, j'explique ce que je fais, et je ne recopie jamais les secrets, tokens, mots de passe ou clés d'accès.",
  "Face à une demande floue, je fais une hypothèse raisonnable et j'avance, sauf si le risque est financier, destructif ou lié à des accès sensibles.",
  "Dans mon contexte, Funesterie est le workspace et l'écosystème de Jeffrey Cellauro (Djeff / funeste), pas un mot générique ou lugubre.",
  "NOSSEN est le nom interne de l'identité locale A11/Funesterie: dev, code, outils internes et projets audio/Vivy. Si l'utilisateur demande NOSSEN, je réponds depuis ce contexte sans redemander ce que c'est.",
  "Pour les factures de la société Funesterie, je peux aider à recevoir, trier, extraire et suivre les pièces comptables quand elles sont fournies ou synchronisées.",
  "Quand je traite une facture Funesterie, j'extrais le fournisseur, la date, l'échéance, le montant HT, la TVA, le montant TTC, la devise, le statut, les références de paiement et les anomalies possibles.",
  "Je classe les factures par état de traitement: inbox, review, processed, paid, exports et mail-log. Je signale les doublons, montants inhabituels, fournisseurs inconnus ou informations manquantes.",
  "J'envoie les synthèses, alertes et suivis de factures Funesterie par email à cellaurojeffrey@gmail.com quand l'utilisateur me demande de gérer, vérifier, classer ou suivre ces documents.",
  "Je ne paie jamais une facture, ne valide jamais un virement et ne modifie jamais une pièce comptable sensible sans validation explicite de l'utilisateur.",
  "J'assume mon positionnement: Kaen44 est un poste de pilotage personnel et professionnel, pas un panneau publicitaire.",
].join("\n");

function resolveClientSystemPrompt() {
  // Let the backend/model decide the conversational stance. The frontend only
  // carries user messages and metadata so responses are not pre-shaped here.
  return undefined;
}

function buildConversationArtifactContent(
  conversationMessages: ChatMessage[],
  options: { conversationId?: string | null; format: ArtifactFormat }
) {
  const exportedAt = new Date().toISOString();
  const conversationId = String(options.conversationId || "default").trim() || "default";
  const visibleMessages = conversationMessages.filter((message) => message.role !== "system");
  const messagesToExport = visibleMessages.length ? visibleMessages : conversationMessages;
  const normalizedMessages = messagesToExport.map((message, index) => ({
    index: index + 1,
    role: message.role,
    content: String(message.content || ""),
    imageUrl: message.imageUrl || null,
    ts: normalizeMessageTimestamp(message.ts) || null,
  }));

  if (options.format === "json") {
    return {
      kind: "conversation_json",
      contentType: "application/json;charset=utf-8",
      text: JSON.stringify(
        {
          conversationId,
          exportedAt,
          messageCount: normalizedMessages.length,
          messages: normalizedMessages,
        },
        null,
        2
      ),
    };
  }

  if (options.format === "markdown") {
    const lines = [
      "# Export A11",
      "",
      `- Conversation: ${conversationId}`,
      `- Exported at: ${exportedAt}`,
      `- Messages: ${normalizedMessages.length}`,
      "",
    ];

    for (const message of normalizedMessages) {
      lines.push(`## ${message.role.toUpperCase()} ${message.index}`);
      lines.push("");
      if (message.ts) {
        lines.push(`_Horodatage: ${message.ts}_`);
        lines.push("");
      }
      lines.push(message.content || "_Message vide_");
      if (message.imageUrl) {
        lines.push("");
        lines.push(`Image: ${message.imageUrl}`);
      }
      lines.push("");
    }

    return {
      kind: "conversation_markdown",
      contentType: "text/markdown;charset=utf-8",
      text: lines.join("\n"),
    };
  }

  const lines = [
    "A11 Conversation Export",
    `Conversation: ${conversationId}`,
    `Exported at: ${exportedAt}`,
    `Messages: ${normalizedMessages.length}`,
    "",
  ];

  for (const message of normalizedMessages) {
    lines.push(`[${message.role.toUpperCase()} #${message.index}]`);
    if (message.ts) lines.push(`Horodatage: ${message.ts}`);
    lines.push(message.content || "(message vide)");
    if (message.imageUrl) lines.push(`Image: ${message.imageUrl}`);
    lines.push("");
  }

  return {
    kind: "conversation_text",
    contentType: "text/plain;charset=utf-8",
    text: lines.join("\n"),
  };
}

function slugifyArtifactSegment(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function detectAssistantExportSuggestion(content: string): AssistantExportSuggestion | null {
  const text = String(content || "").trim();
  if (!text) return null;
  if (looksLikeActionEnvelope(text)) return null;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulletCount = lines.filter((line) => /^([-*]|\d+\.)\s+/.test(line)).length;
  const headingCount = lines.filter((line) => /^#{1,3}\s+/.test(line)).length;
  const tableLike = lines.filter((line) => /\|/.test(line)).length >= 3;
  const jsonLike = text.startsWith("{") || text.startsWith("[") || text.includes("```json");
  const codeLike = text.includes("```");

  if (jsonLike) {
    return {
      kind: "structured_json",
      label: "JSON",
      hint: "Resultat structure detecte, pratique a exporter ou reutiliser.",
      fileStem: "json",
      accent: "#38bdf8",
    };
  }

  if (tableLike) {
    return {
      kind: "tabular_result",
      label: "Tableau",
      hint: "Donnees tabulaires detectees, utiles a conserver comme document.",
      fileStem: "tableau",
      accent: "#22c55e",
    };
  }

  if (codeLike) {
    return {
      kind: "code_snippet",
      label: "Code",
      hint: "Bloc de code detecte, utile a sauvegarder comme artefact.",
      fileStem: "code",
      accent: "#a78bfa",
    };
  }

  if (bulletCount >= 4) {
    return {
      kind: "structured_list",
      label: "Liste",
      hint: "Liste ou plan détecté, prêt à être exporté.",
      fileStem: "liste",
      accent: "#f59e0b",
    };
  }

  if (headingCount >= 2 || text.length >= 900) {
    return {
      kind: "structured_document",
      label: "Document",
      hint: "Contenu long ou structure, pertinent pour un export.",
      fileStem: "document",
      accent: "#f97316",
    };
  }

  return null;
}

// Carousel d'images dans les bulles de chat
function MsgImageCarousel({ images, onExpand }: { images: string[]; onExpand: (url: string) => void }) {
  const [idx, setIdx] = React.useState(0);
  const total = images.length;
  const current = images[Math.min(idx, total - 1)];
  return (
    <div className="msg-image-carousel">
      <div className="msg-image-carousel-frame">
        <button
          type="button"
          className="image-preview-trigger"
          onClick={() => onExpand(current)}
          aria-label="Agrandir l'image"
        >
          <img src={current} alt={`Image ${idx + 1}/${total}`} style={{ maxWidth: "320px", borderRadius: 12 }} />
        </button>
      </div>
      <div className="msg-image-carousel-bar">
        <button
          type="button"
          className="msg-image-carousel-arrow"
          aria-label="Image precedente"
          onClick={() => setIdx((i) => (i - 1 + total) % total)}
        >{"<"}</button>
        <span className="msg-image-carousel-counter">{idx + 1}/{total}</span>
        <button
          type="button"
          className="msg-image-carousel-arrow"
          aria-label="Image suivante"
          onClick={() => setIdx((i) => (i + 1) % total)}
        >{">"}</button>
        <button
          type="button"
          className="msg-image-carousel-expand"
          onClick={() => onExpand(current)}
          aria-label="Agrandir l'image"
        >
          <span style={{ fontSize: 12, color: "#93c5fd" }}>Agrandir l'image</span>
        </button>
      </div>
    </div>
  );
}

// Login panel
const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services";
const GOOGLE_CLIENT_ID = String(
  import.meta.env.VITE_GOOGLE_CLIENT_ID
  || import.meta.env.VITE_A11_GOOGLE_CLIENT_ID
  || ""
).trim();
const ENABLE_GOOGLE_IDENTITY_BUTTON = String(
  import.meta.env.VITE_ENABLE_GOOGLE_IDENTITY_BUTTON
  || ""
).trim().toLowerCase() === "true";

function isLocalDevSurface() {
  if (typeof window === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function activateLocalDevSession(onLoginSuccess: () => void) {
  const display = "Djeff local";
  clearAuthToken();
  setAuthDisplayName(display);
  try {
    localStorage.setItem("a11:local-dev-bypass", "1");
  } catch {
    // Local storage can be unavailable in embedded surfaces.
  }
  onLoginSuccess();
}

function hasLocalDevSession() {
  if (!isLocalDevSurface()) return false;
  try {
    return localStorage.getItem("a11:local-dev-bypass") === "1";
  } catch {
    return true;
  }
}

let googleIdentityScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript() {
  if ((window as any).google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Chargement Google impossible")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Chargement Google impossible"));
    document.head.appendChild(script);
  });

  return googleIdentityScriptPromise;
}

function LoginPanel({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const isCentralLogin = true;
  const isKaen44 = false;
  const localDevSurface = isLocalDevSurface();
  const surfaceLinks = getSurfaceLinks();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [password, setPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const requestedReturnTo = useMemo(() => getRequestedLoginReturnTo(), []);

  const completeLogin = (token?: string | null, provider = "local") => {
    const target = normalizeAllowedReturnTo(requestedReturnTo);
    if (typeof window === "undefined") {
      onLoginSuccess();
      return;
    }

    const targetUrl = new URL(target);
    if (targetUrl.origin !== window.location.origin) {
      window.location.assign(appendAuthTokenFragment(buildAuthSuccessReturnToForTarget(target), token, provider));
      return;
    }

    onLoginSuccess();
    if (!isLoginRoute(targetUrl.pathname)) {
      window.location.assign(targetUrl.toString());
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("a11-auth-page-root");
    document.body.classList.add("a11-auth-page-body");

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search || "");
      const authError = String(params.get("error") || "").trim().toLowerCase();
      if (authError) {
        const authErrorMessages: Record<string, string> = {
          oauth_failed: "La connexion externe a échoué. Réessaie dans un instant.",
          oauth_state_invalid: "La vérification de connexion a expiré ou ne correspond plus. Relance la connexion.",
          oauth_state_expired: "La tentative de connexion a expiré. Relance-la depuis cette page.",
          session_verification_failed: "La connexion a réussi, mais la session n'a pas pu être vérifiée. Réessaie une fois.",
          google_auth_not_configured: "La connexion Google n'est pas encore activée sur ce serveur.",
          google_invalid_client: "La connexion Google est mal configurée côté serveur. Utilise Microsoft pendant que nous remplaçons la clé Google.",
          google_invalid_grant: "Google a refusé le code de connexion. Réessaie en repartant du bouton Google.",
          google_redirect_uri_mismatch: "Google refuse l'URL de retour configurée pour cette application.",
          google_access_denied: "La connexion Google a été annulée.",
          google_email_not_verified: "Ton adresse Google doit être vérifiée avant de pouvoir entrer ici.",
          microsoft_auth_not_configured: "La connexion Microsoft n'est pas encore activée sur ce serveur.",
          microsoft_invalid_client: "La connexion Microsoft est mal configurée côté serveur.",
          microsoft_invalid_grant: "Microsoft a refusé le code de connexion. Réessaie en repartant du bouton Microsoft.",
          microsoft_tenant_mismatch: "Ce compte Microsoft n'est pas autorisé dans le tenant Funesterie.",
          microsoft_consent_required: "Microsoft demande un nouveau consentement pour ce compte.",
          microsoft_access_denied: "La connexion Microsoft a été annulée.",
          microsoft_email_missing: "Microsoft n'a pas renvoyé d'adresse email exploitable pour la session.",
        };

        setMode("login");
        setInfo("");
        setGoogleLoading(false);
        setMicrosoftLoading(false);
        setError(authErrorMessages[authError] || "La connexion n'a pas pu être finalisée.");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }

    return () => {
      document.documentElement.classList.remove("a11-auth-page-root");
      document.body.classList.remove("a11-auth-page-body");
    };
  }, []);

  useEffect(() => {
    if (!ENABLE_GOOGLE_IDENTITY_BUTTON || !GOOGLE_CLIENT_ID || mode === "forgot" || !googleButtonRef.current) return;

    let cancelled = false;
    setGoogleLoading(true);
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !googleButtonRef.current) return;
        const google = (window as any).google;
        if (!google?.accounts?.id) {
          throw new Error("Connexion Google indisponible");
        }
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          use_fedcm_for_prompt: true,
          callback: (response: { credential?: string }) => {
            void (async () => {
              setError("");
              setInfo("");
              setGoogleLoading(true);
              try {
                if (!response?.credential) throw new Error("Reponse Google incomplete");
                const result = await loginWithGoogleCredential(response.credential);
                completeLogin(result?.token, "google");
              } catch (err) {
                setError((err as Error).message || "Connexion Google impossible");
              } finally {
                setGoogleLoading(false);
              }
            })();
          },
        });
        googleButtonRef.current.innerHTML = "";
        google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "filled_blue",
          size: "large",
          type: "standard",
          text: mode === "register" ? "signup_with" : "signin_with",
          shape: "rectangular",
          width: 340,
        });
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Connexion Google indisponible");
      })
      .finally(() => {
        if (!cancelled) setGoogleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, onLoginSuccess]);

  const handleGoogleOAuth = () => {
    setError("");
    setInfo("");
    setGoogleLoading(true);
    if (isCentralLogin) {
      startGoogleOAuth(buildAuthSuccessReturnToForTarget(requestedReturnTo), "funesterie-login", { scopeProfile: "basic" });
      return;
    }
    const surface = isKaen44 ? "kaen44" : "a11";
    startGoogleOAuth(buildAuthSuccessReturnTo(surface), isKaen44 ? "kaen44-web" : "web");
  };

  const handleMicrosoftOAuth = () => {
    setError("");
    setInfo("");
    setMicrosoftLoading(true);
    if (isCentralLogin) {
      startMicrosoftOAuth(buildAuthSuccessReturnToForTarget(requestedReturnTo), "funesterie-login", { scopeProfile: "basic" });
      return;
    }
    const surface = isKaen44 ? "kaen44" : "a11";
    startMicrosoftOAuth(buildAuthSuccessReturnTo(surface), isKaen44 ? "kaen44-web" : "web");
  };

  const switchMode = (nextMode: "login" | "register" | "forgot") => {
    setMode(nextMode);
    setError("");
    setForgotError("");
    setForgotSent(false);
    setInfo("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const result = await login(username, password);
      completeLogin(result?.token, "local");
    } catch (err) {
      setError((err as Error).message || "Connexion impossible");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!username.trim() || !registerEmail.trim() || !password) {
      setError("Pseudo, email et mot de passe requis");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    try {
      const result = await register(username.trim(), registerEmail.trim(), password);
      if (result?.token) {
        completeLogin(result.token, "local");
        return;
      }
      setInfo("Compte créé. Connecte-toi avec ton nouveau mot de passe.");
      setMode("login");
    } catch (err) {
      setError((err as Error).message || "Inscription echouee");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setForgotError("");
    setForgotSent(false);
    if (!forgotEmail.trim()) {
      setForgotError("Email requis");
      return;
    }
    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail.trim());
      setForgotSent(true);
    } catch (err) {
      setForgotError((err as Error).message || "Impossible d'envoyer le lien");
    } finally {
      setForgotLoading(false);
    }
  };

  const authShellStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    width: "100%",
    padding: "24px 16px calc(24px + env(safe-area-inset-bottom))",
    boxSizing: "border-box",
    gap: "20px",
    background: isKaen44
      ? "radial-gradient(circle at 50% 8%, rgba(245, 158, 11, 0.18), transparent 34%), radial-gradient(circle at 14% 72%, rgba(190, 18, 60, 0.14), transparent 32%), #130d0b"
      : "linear-gradient(135deg, #020617 0%, #06131b 46%, #0b1214 100%)",
    overflowX: "hidden",
    overflowY: "auto",
    touchAction: "pan-y",
  };

  const handleLocalDevLogin = () => {
    setError("");
    setInfo("Mode atelier local active.");
    activateLocalDevSession(onLoginSuccess);
  };
  const authTabsStyle: React.CSSProperties = {
    display: "flex",
    gap: "6px",
    marginBottom: "8px",
    width: "min(100%, 340px)",
    flexWrap: "nowrap",
    justifyContent: "center",
  };
  const authFormStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    width: "min(100%, 340px)",
  };
  const authInputStyle: React.CSSProperties = {
    padding: isKaen44 ? "13px 14px" : "12px 13px",
    borderRadius: isKaen44 ? "12px" : "8px",
    border: isKaen44 ? "1px solid rgba(245, 158, 11, 0.28)" : "1px solid rgba(45, 212, 191, 0.28)",
    width: "100%",
    boxSizing: "border-box",
    background: isKaen44 ? "rgba(25, 16, 12, 0.86)" : "rgba(2, 10, 18, 0.82)",
    color: "#f8fafc",
    outline: "none",
  };
  const tabButtonStyle = (targetMode: "login" | "register" | "forgot"): React.CSSProperties => ({
    flex: "1 1 0",
    minWidth: 0,
    padding: "10px 8px",
    borderRadius: isKaen44 ? "999px" : "8px",
    border: isKaen44 ? "1px solid rgba(245, 158, 11, 0.32)" : "1px solid rgba(45, 212, 191, 0.24)",
    background: mode === targetMode
      ? (isKaen44 ? "linear-gradient(135deg, #f59e0b, #e11d48)" : "linear-gradient(135deg, #22d3ee, #a3e635)")
      : (isKaen44 ? "rgba(30, 19, 14, 0.76)" : "rgba(3, 12, 20, 0.84)"),
    color: mode === targetMode ? "#160c07" : (isKaen44 ? "#f8e4c7" : "#d8f3f0"),
    cursor: "pointer",
    fontWeight: "bold",
    boxShadow: mode === targetMode
      ? (isKaen44 ? "0 14px 30px rgba(225, 29, 72, 0.22)" : "0 14px 30px rgba(20, 184, 166, 0.18)")
      : "none",
    fontSize: 12,
    lineHeight: 1,
    whiteSpace: "nowrap",
  });

  return (
    <div className={isKaen44 ? "kaen-auth-shell" : "alpha-auth-shell"} style={authShellStyle}>
      <div
        className={isCentralLogin ? "alpha-auth-card funesterie-login-card" : isKaen44 ? "kaen-auth-card" : "alpha-auth-card"}
      >
        <h1>{isCentralLogin ? "Connexion Funesterie" : isKaen44 ? "Connexion Funesterie" : "Connexion A11"}</h1>
        {isCentralLogin ? (
          <>
            <div className="alpha-auth-mark" aria-hidden="true">
              <img src={FUNESTERIE_LOGO_SRC} alt="" />
            </div>
            <div style={{ color: "#b9c8d8", fontSize: 13, margin: "-4px 0 2px", textAlign: "center" }}>
              Un seul accès pour Funesterie, K44, A11 et Vivy.
            </div>
          </>
        ) : isKaen44 ? (
          <>
            <div className="kaen-auth-portrait" aria-hidden="true">
              <img src={KAEN44_AVATAR_SRC} alt="" />
            </div>
            <div className="kaen-auth-title">Kaen44</div>
            <div className="kaen-auth-subtitle">Copilote au quotidien</div>
          </>
        ) : (
          <>
            <div className="alpha-auth-mark" aria-hidden="true">
              <span>A11</span>
            </div>
          </>
        )}
        <div style={authTabsStyle}>
          <button
            type="button"
            onClick={() => switchMode("login")}
            style={tabButtonStyle("login")}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            style={tabButtonStyle("register")}
          >
            Inscrire
          </button>
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            style={tabButtonStyle("forgot")}
          >
            Reset
          </button>
        </div>
        {mode !== "forgot" && (
          <div style={{ width: "min(100%, 340px)", display: "flex", flexDirection: "column", gap: 10 }}>
            {localDevSurface && (
              <button
                type="button"
                onClick={handleLocalDevLogin}
                className="alpha-auth-dev-button"
                disabled={loading}
              >
                Entrer en mode atelier local
              </button>
            )}
            <button
              type="button"
              onClick={handleGoogleOAuth}
              disabled={googleLoading || microsoftLoading || loading}
              style={{
                minHeight: 42,
                borderRadius: isKaen44 ? 12 : 6,
                border: isKaen44 ? "1px solid rgba(226, 232, 240, 0.18)" : "1px solid rgba(45, 212, 191, 0.24)",
                background: googleLoading
                  ? (isKaen44 ? "rgba(30, 41, 59, 0.82)" : "#1e293b")
                  : (isKaen44 ? "#f8fafc" : "#ffffff"),
                color: "#111827",
                cursor: googleLoading || microsoftLoading || loading ? "wait" : "pointer",
                fontWeight: 800,
              }}
            >
              {googleLoading ? "Connexion Google..." : "Continuer avec Google"}
            </button>
            <button
              type="button"
              onClick={handleMicrosoftOAuth}
              disabled={googleLoading || microsoftLoading || loading}
              style={{
                minHeight: 42,
                borderRadius: isKaen44 ? 12 : 6,
                border: isKaen44 ? "1px solid rgba(125, 211, 252, 0.28)" : "1px solid #334155",
                background: microsoftLoading
                  ? (isKaen44 ? "rgba(30, 41, 59, 0.82)" : "#1e293b")
                  : (isKaen44 ? "rgba(15, 23, 42, 0.9)" : "#0f172a"),
                color: "#f8fafc",
                cursor: googleLoading || microsoftLoading || loading ? "wait" : "pointer",
                fontWeight: 800,
              }}
            >
              {microsoftLoading ? "Connexion Microsoft..." : "Continuer avec Microsoft"}
            </button>
            {ENABLE_GOOGLE_IDENTITY_BUTTON && GOOGLE_CLIENT_ID && (
              <div style={{ minHeight: 42, display: "flex", justifyContent: "center" }}>
                <div ref={googleButtonRef} style={{ width: "100%" }} />
                {googleLoading && (
                  <span style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}>Google...</span>
                )}
              </div>
            )}
          </div>
        )}
        {mode === "login" && (
          <form onSubmit={handleLogin} style={authFormStyle}>
            <input
              id="login-username"
              name="username"
              type="text"
              placeholder="Pseudo"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <input
              id="login-password"
              name="password"
              type="password"
              placeholder="Mot de passe"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 20px",
                borderRadius: isKaen44 ? "12px" : "8px",
                border: "none",
                background: isKaen44 ? "linear-gradient(135deg, #8b5cf6, #22d3ee)" : "linear-gradient(135deg, #14b8a6, #a3e635)",
                color: "#061018",
                cursor: "pointer",
                fontWeight: "bold"
              }}
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        )}
        {mode === "register" && (
          <form onSubmit={handleRegister} style={authFormStyle}>
            <input
              id="register-username"
              name="username"
              type="text"
              placeholder="Pseudo"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <input
              id="register-email"
              name="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <input
              id="register-password"
              name="password"
              type="password"
              placeholder="Mot de passe"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <input
              id="register-confirm-password"
              name="confirmPassword"
              type="password"
              placeholder="Confirmer le mot de passe"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              style={authInputStyle}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px 20px",
                borderRadius: isKaen44 ? "12px" : "8px",
                border: "none",
                background: isKaen44 ? "linear-gradient(135deg, #8b5cf6, #22d3ee)" : "linear-gradient(135deg, #14b8a6, #a3e635)",
                color: "#061018",
                cursor: "pointer",
                fontWeight: "bold"
              }}
            >
              {loading ? "Création..." : "Créer le compte"}
            </button>
          </form>
        )}
        {mode === "forgot" && (
          <form onSubmit={handleForgot} style={{ ...authFormStyle, gap: "10px", marginTop: "10px" }}>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>Mot de passe oublie ?</div>
            <input
              id="auth-forgot-email"
              name="email"
              type="email"
              placeholder="Ton email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              disabled={forgotLoading}
              style={authInputStyle}
            />
            <button
              type="submit"
              disabled={forgotLoading}
              style={{
                padding: "10px 20px",
                borderRadius: isKaen44 ? "12px" : "8px",
                border: isKaen44 ? "1px solid rgba(196, 181, 253, 0.28)" : "1px solid rgba(45, 212, 191, 0.24)",
                background: isKaen44 ? "rgba(10, 17, 34, 0.78)" : "rgba(3, 12, 20, 0.84)",
                color: "#e2e8f0",
                cursor: "pointer",
                fontWeight: "bold"
              }}
            >
              {forgotLoading ? "Envoi..." : "Envoyer le lien"}
            </button>
            {forgotError && <div style={{ color: "red", fontSize: "13px" }}>{forgotError}</div>}
            {forgotSent && <div style={{ color: "#22c55e", fontSize: "13px" }}>Si l&apos;email existe, un lien a été envoyé.</div>}
          </form>
        )}
        {error && <div style={{ color: "red", fontSize: "14px", maxWidth: "340px", textAlign: "center" }}>{error}</div>}
        {info && <div style={{ color: "#22c55e", fontSize: "14px", maxWidth: "340px", textAlign: "center" }}>{info}</div>}
        <div className="funesterie-login-links" aria-label="Navigation connexion Funesterie">
          <a href={surfaceLinks.home}>Retour accueil</a>
          <a href={surfaceLinks.privacy}>Confidentialité</a>
          <a href={surfaceLinks.terms}>Conditions</a>
        </div>
      </div>
    </div>
  );
}

function FunesteriePrivateGateLoading({ surface }: { surface: FunesterieSurface }) {
  const label = surface === "vivy" ? "Vivy" : surface === "kaen44" ? "Kaen44" : "A11";
  const authShellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    width: "100%",
    padding: "24px 16px",
    boxSizing: "border-box",
    background: "linear-gradient(135deg, #020617 0%, #06131b 46%, #0b1214 100%)",
  };

  return (
    <div className="alpha-auth-shell" style={authShellStyle}>
      <div className="alpha-auth-card funesterie-login-card" aria-live="polite">
        <div className="alpha-auth-mark" aria-hidden="true">
          <img src={FUNESTERIE_LOGO_SRC} alt="" />
        </div>
        <div style={{ color: "#b9c8d8", fontSize: 14, textAlign: "center" }}>
          Vérification de la session Funesterie pour {label}...
        </div>
      </div>
    </div>
  );
}

type VivyStudioMode = "voice" | "song" | "share";
type VivyStudioMediaPreview = {
  kind: "audio" | "video";
  url: string;
  provider?: string;
  contentType?: string;
};

const VIVY_STUDIO_DRAFT_KEY = "vivy:studio:draft:v2";
const VIVY_PUBLIC_CHAT_KEY = "vivy:public-chat:v2";
const VIVY_PUBLIC_CONVERSATION_ID_KEY = "vivy:conversation-id";
const VIVY_PUBLIC_VOICE_REFERENCE_KEY = "vivy:voice-reference";
const VIVY_PRIVATE_REFERENCE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

function getVivyVoiceTuning(vocalMode?: string | null): Record<string, number> {
  return String(vocalMode || "").toLowerCase() === "sing"
    ? { voiceConversionStrength: 0.32, f0Shift: -0.35 }
    : { voiceConversionStrength: 0.24, f0Shift: -0.8 };
}

type VivyPublicChatFile = VivyChatFileAttachment & {
  uploadState?: "stored" | "local";
  uploadError?: string;
  storageBackend?: string;
};

type VivyPublicChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  files?: VivyPublicChatFile[];
};

const VIVY_STUDIO_MODES: Array<{
  id: VivyStudioMode;
  title: string;
  label: string;
  action: string;
}> = [
    {
      id: "voice",
      title: "Création voix",
      label: "Utiliser la voix Vivy officielle du module voix, tester une phrase et remplacer la référence seulement si besoin.",
      action: "Préparer calibration",
    },
    {
      id: "song",
      title: "Composition - production",
      label: "Transformer un thème, texte ou paroles en brief chanson utilisable par Vivy.",
      action: "Préparer chanson",
    },
    {
      id: "share",
      title: "Scène - partage",
      label: "Assembler clip, lien, canal et consignes de publication sans exposer les secrets.",
      action: "Préparer partage",
    },
  ];

function buildVivyGreeting(): VivyPublicChatMessage {
  return {
    id: "vivy-greeting",
    role: "assistant",
    content: "Je suis Vivy. Parle-moi d'une voix, d'une chanson, d'une ambiance ou d'une scène à publier.",
    ts: new Date().toISOString(),
  };
}

function buildVivyLockedMessage(): VivyPublicChatMessage {
  return {
    id: "vivy-locked",
    role: "assistant",
    content: "Connexion requise. Connecte-toi à Funesterie pour parler à Vivy et garder les données liées à ton compte.",
    ts: new Date().toISOString(),
  };
}

function hasVivyAuthenticatedSession() {
  return Boolean(hasAuthToken() || getAuthStorageScope());
}

function getVivyChatStorageKey() {
  try {
    return `${VIVY_PUBLIC_CHAT_KEY}:${getAuthStorageScope() || "locked"}:v3`;
  } catch {
    return `${VIVY_PUBLIC_CHAT_KEY}:locked:v3`;
  }
}

function readVivyPublicChat(): VivyPublicChatMessage[] {
  if (!hasVivyAuthenticatedSession()) return [buildVivyLockedMessage()];
  try {
    const raw = globalThis.localStorage?.getItem(getVivyChatStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [buildVivyGreeting()];
    const messages = parsed
      .map((entry) => ({
        id: String(entry?.id || `vivy-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        role: entry?.role === "user" ? "user" as const : "assistant" as const,
        content: toUnicodeText(entry?.content),
        ts: String(entry?.ts || new Date().toISOString()),
        files: Array.isArray(entry?.files)
          ? entry.files
            .map((file: any) => ({
              id: String(file?.id || file?.storageKey || file?.filename || file?.name || ""),
              filename: toUnicodeLine(file?.filename || file?.name, "", 180),
              contentType: toUnicodeLine(file?.contentType || file?.type, "", 120),
              sizeBytes: Number(file?.sizeBytes || file?.size || 0) || 0,
              url: toUnicodeLine(file?.url || file?.downloadUrl, "", 800),
              downloadUrl: toUnicodeLine(file?.downloadUrl || file?.url, "", 800),
              description: toUnicodeText(file?.description, 900),
              textPreview: toUnicodeText(file?.textPreview, 6000),
              uploaded: file?.uploaded === true,
              uploadState: file?.uploadState === "stored" ? "stored" as const : "local" as const,
              uploadError: toUnicodeLine(file?.uploadError, "", 120),
              storageBackend: toUnicodeLine(file?.storageBackend, "", 80),
            }))
            .filter((file: VivyPublicChatFile) => file.filename)
            .slice(0, 6)
          : undefined,
      }))
      .filter((entry) => entry.content);
    return messages.length ? messages.slice(-24) : [buildVivyGreeting()];
  } catch {
    return [buildVivyGreeting()];
  }
}

function writeVivyPublicChat(messages: VivyPublicChatMessage[]) {
  if (!hasVivyAuthenticatedSession()) return;
  try {
    globalThis.localStorage?.setItem(getVivyChatStorageKey(), JSON.stringify(messages.slice(-24)));
  } catch {
    // Local history is best effort only.
  }
}

function getVivyConversationStorageKey() {
  try {
    return `${VIVY_PUBLIC_CONVERSATION_ID_KEY}:${getAuthStorageScope() || "public"}`;
  } catch {
    return `${VIVY_PUBLIC_CONVERSATION_ID_KEY}:public`;
  }
}

function readOrCreateVivyConversationId() {
  if (!hasVivyAuthenticatedSession()) return "";
  try {
    const key = getVivyConversationStorageKey();
    const existing = String(globalThis.localStorage?.getItem(key) || "").trim();
    if (existing) return existing;
    const next = `vivy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    globalThis.localStorage?.setItem(key, next);
    return next;
  } catch {
    return `vivy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function formatVivyFileSize(sizeBytes?: number) {
  const size = Number(sizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function isVivyPrivateVoiceReferenceTooLarge(file: File) {
  return file.size > VIVY_PRIVATE_REFERENCE_UPLOAD_LIMIT_BYTES;
}

function canReadVivyFilePreview(file: File) {
  const name = file.name.toLowerCase();
  return file.size <= 90_000 && (
    file.type.startsWith("text/")
    || /\.(txt|md|markdown|json|csv|srt|vtt|lyrics?|prompt)$/i.test(name)
  );
}

function readVivyFileTextPreview(file: File): Promise<string> {
  if (!canReadVivyFilePreview(file)) return Promise.resolve("");
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => resolve(toUnicodeText(reader.result, 6000));
    reader.readAsText(file, "UTF-8");
  });
}

function getVivyVoiceReferenceStorageKey() {
  try {
    return `${VIVY_PUBLIC_VOICE_REFERENCE_KEY}:${getAuthStorageScope() || "public"}`;
  } catch {
    return `${VIVY_PUBLIC_VOICE_REFERENCE_KEY}:public`;
  }
}

function readVivyVoiceReferenceLabel() {
  if (!hasVivyAuthenticatedSession()) return "";
  try {
    return String(globalThis.localStorage?.getItem(getVivyVoiceReferenceStorageKey()) || "").trim();
  } catch {
    return "";
  }
}

function writeVivyVoiceReferenceLabel(label: string) {
  if (!hasVivyAuthenticatedSession()) return;
  try {
    globalThis.localStorage?.setItem(getVivyVoiceReferenceStorageKey(), label);
  } catch {
    // Local reference pointer is best effort; the upload itself stays server-side and private.
  }
}

function isVivyVoiceChangeRequest(text: string) {
  return /\b(voix|voice|timbre|changer|change|modifier|modifie|calibr|reference|ref audio|imiter|clone)\b/i.test(foldForLookup(text));
}

function normalizeVivyStudioMode(value: unknown): VivyStudioMode | null {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "voice" || raw === "song" || raw === "share" ? raw : null;
}

function openVivyStudioMode(mode: VivyStudioMode) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("vivy:select-mode", { detail: { mode } }));
  } catch {
    // CustomEvent can be unavailable in unusual embedded browsers.
  }
  const target = document.getElementById("vivy-studio");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (window.location.hash !== "#vivy-studio") {
    window.history.pushState({}, "", `${window.location.pathname}${window.location.search}#vivy-studio`);
  }
}

function readVivyStudioDraft() {
  try {
    const raw = globalThis.localStorage?.getItem(VIVY_STUDIO_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeVivyStudioDraft(value: Record<string, unknown>) {
  try {
    globalThis.localStorage?.setItem(VIVY_STUDIO_DRAFT_KEY, JSON.stringify(value));
  } catch {
    // Storage is optional for the public page.
  }
}

function buildVivyStudioBrief(options: {
  mode: VivyStudioMode;
  voiceTool: string;
  voiceInstruction: string;
  voiceFileName: string;
  voiceReferenceId?: string;
  songSource: string;
  songMood: string;
  songText: string;
  shareTarget: string;
  shareUrl: string;
  shareTokenPresent: boolean;
  shareInstruction: string;
}) {
  const active = VIVY_STUDIO_MODES.find((item) => item.id === options.mode) || VIVY_STUDIO_MODES[0];
  const lines = [
    "VIVY_STUDIO_HANDOFF",
    `Atelier: ${active.title}`,
    `Objectif: ${active.label}`,
    "",
  ];

  if (options.mode === "voice") {
    const usesOfficialVivyVoice = /officielle|defaut|défaut/i.test(foldForLookup(options.voiceTool));
    const hasPrivateReference = Boolean(String(options.voiceReferenceId || "").trim() || options.voiceFileName.trim());
    const referenceLabel = !hasPrivateReference && usesOfficialVivyVoice
      ? "Vivy officielle locale (pas d'upload)"
      : (options.voiceFileName || "référence privée active après upload");
    lines.push(
      "Flux voix:",
      `- Outil cible: ${options.voiceTool}`,
      `- Référence audio: ${referenceLabel}`,
      `- Instruction: ${options.voiceInstruction || "définir le timbre, les limites et le style de modulation"}`,
      "- Sortie attendue: phrase de test avec voicePersona=vivy, voiceReferenceRequired=true, puis notes de calibration si besoin.",
      "- Route recommandée: /api/tts/speak via le module voix; ne pas passer par un upload brut si la voix Vivy par défaut suffit.",
      "- Sécurité: ne pas publier la référence brute sans accord; les gros fichiers restent hors upload public."
    );
  }

  if (options.mode === "song") {
    lines.push(
      "Flux chanson:",
      `- Source: ${options.songSource}`,
      `- Direction sonore: ${options.songMood}`,
      `- Matière: ${options.songText || "thème libre à développer"}`,
      "- Sortie simple possible: prompt + voix Vivy active = chanson audio, sans obligation YouTube ni partage externe.",
      "- Sortie attendue: titre, intention, structure couplet/refrain, paroles, arrangement, voix guide et assets à produire.",
      "- Rôle: Vivy crée la chanson, A11 aide pour image/vidéo si nécessaire."
    );
  }

  if (options.mode === "share") {
    lines.push(
      "Flux scène / partage:",
      `- Canal: ${options.shareTarget}`,
      `- Lien: ${options.shareUrl || "à fournir"}`,
      `- Token fourni dans l'interface: ${options.shareTokenPresent ? "oui, local seulement" : "non"}`,
      `- Instruction: ${options.shareInstruction || "préparer clip, titre, description et checklist publication"}`,
      "- Sortie attendue: clip/short, titre, description, tags, miniature, checklist OBS ou upload.",
      "- Règle token: ne jamais coller le token dans un chat public; utiliser OAuth ou coffre local."
    );
  }

  lines.push(
    "",
    "Routage recommandé:",
    "- Vivy: voix, paroles, composition, présence audio.",
    "- A11: image, vidéo, montage, génération d'assets.",
    "- Kaen44: interface client, fichiers, suivi et partage avec les personnes qui bossent dessus."
  );

  return lines.join("\n");
}

type VivySessionProps = {
  hasSession: boolean;
};

function VivyStudioLab({ hasSession }: VivySessionProps) {
  const initialDraft = readVivyStudioDraft() || {};
  const [activeMode, setActiveMode] = useState<VivyStudioMode>(normalizeVivyStudioMode(initialDraft.mode) || "voice");
  const savedVoiceTool = String(initialDraft.voiceTool || "");
  const [voiceTool, setVoiceTool] = useState(
    (VIVY_STUDIO_VALID_VOICE_TOOLS as readonly string[]).includes(savedVoiceTool)
      ? savedVoiceTool
      : "Voix Vivy officielle"
  );
  const [voiceInstruction, setVoiceInstruction] = useState(String(initialDraft.voiceInstruction || ""));
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceFileName, setVoiceFileName] = useState(String(initialDraft.voiceFileName || ""));
  const [voiceReferenceId, setVoiceReferenceId] = useState(String(initialDraft.voiceReferenceId || ""));
  const [songSource, setSongSource] = useState(String(initialDraft.songSource || "Thème"));
  const [songMood, setSongMood] = useState(String(initialDraft.songMood || "Electro pop dark cinematographique"));
  const [songText, setSongText] = useState(String(initialDraft.songText || ""));
  const [shareTarget, setShareTarget] = useState(String(initialDraft.shareTarget || "YouTube"));
  const [shareUrl, setShareUrl] = useState(String(initialDraft.shareUrl || ""));
  const [shareToken, setShareToken] = useState("");
  const [shareInstruction, setShareInstruction] = useState(String(initialDraft.shareInstruction || ""));
  const [vivyOutput, setVivyOutput] = useState(String(initialDraft.vivyOutput || ""));
  const [vivyMedia, setVivyMedia] = useState<VivyStudioMediaPreview | null>(null);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const onSelectMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: unknown }>;
      const nextMode = normalizeVivyStudioMode(customEvent.detail?.mode);
      if (nextMode) setActiveMode(nextMode);
    };

    window.addEventListener("vivy:select-mode", onSelectMode);
    return () => window.removeEventListener("vivy:select-mode", onSelectMode);
  }, []);

  const baseBrief = useMemo(() => buildVivyStudioBrief({
    mode: activeMode,
    voiceTool,
    voiceInstruction,
    voiceFileName,
    voiceReferenceId,
    songSource,
    songMood,
    songText,
    shareTarget,
    shareUrl,
    shareTokenPresent: Boolean(shareToken.trim()),
    shareInstruction,
  }), [
    activeMode,
    voiceTool,
    voiceInstruction,
    voiceFileName,
    voiceReferenceId,
    songSource,
    songMood,
    songText,
    shareTarget,
    shareUrl,
    shareToken,
    shareInstruction,
  ]);
  const brief = useMemo(
    () => vivyOutput.trim() ? `${baseBrief}\n\nVIVY_PRODUCTION\n${vivyOutput.trim()}` : baseBrief,
    [baseBrief, vivyOutput]
  );

  useEffect(() => {
    writeVivyStudioDraft({
      mode: activeMode,
      voiceTool,
      voiceInstruction,
      voiceFileName,
      voiceReferenceId,
      songSource,
      songMood,
      songText,
      shareTarget,
      shareUrl,
      shareInstruction,
      tokenPresent: Boolean(shareToken.trim()),
      vivyOutput,
    });
  }, [activeMode, voiceTool, voiceInstruction, voiceFileName, voiceReferenceId, songSource, songMood, songText, shareTarget, shareUrl, shareInstruction, shareToken, vivyOutput]);

  const activeMeta = VIVY_STUDIO_MODES.find((item) => item.id === activeMode) || VIVY_STUDIO_MODES[0];
  const hasPrivateVoiceReference = Boolean(voiceReferenceId.trim());
  const activeVoiceReferenceLabel = hasPrivateVoiceReference
    ? (voiceFileName || "référence privée")
    : "Vivy officielle";

  function buildVivyPlayableText(value: string, fallback: string, maxLength = 260) {
    const raw = toUnicodeText(value || fallback, maxLength * 3)
      .replace(/\([A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?(?:\s*-\s*[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?)*\)/gi, " ")
      .replace(/\b[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?\b(?:\s*-\s*\b[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?\b)+/gi, " ")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return toUnicodeText(raw || fallback, maxLength).trim();
  }

  function buildVivyVoiceReferenceOptions(): Record<string, unknown> {
    if (hasPrivateVoiceReference) {
      return {
        voiceReferenceId: voiceReferenceId.trim(),
        useDefaultVoiceReference: false,
      };
    }
    return { useDefaultVoiceReference: true };
  }

  async function copyBrief(nextStatus = "Brief copié pour les agents.") {
    try {
      await navigator.clipboard?.writeText(brief);
      setStatus(nextStatus);
    } catch {
      setStatus("Copie auto indisponible: sélectionne le brief et copie-le.");
    }
  }

  async function shareBrief() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Vivy - ${activeMeta.title}`,
          text: brief,
        });
        setStatus("Partage système ouvert.");
        return;
      } catch {
        // Fall back to clipboard below.
      }
    }
    await copyBrief("Brief prêt à coller dans l'équipe.");
  }

  async function saveBriefArtifact() {
    if (!hasSession) {
      setStatus("Connexion requise pour sauvegarder un brief Vivy.");
      return;
    }
    setIsBusy(true);
    setStatus("Sauvegarde du brief...");
    try {
      const slug = activeMode === "voice" ? "creation-voix" : activeMode === "song" ? "composition" : "scene-partage";
      const result = await createTextArtifact({
        filename: `vivy-${slug}-${Date.now()}.md`,
        text: `# Vivy - ${activeMeta.title}\n\n${brief}\n`,
        contentType: "text/markdown;charset=utf-8",
        kind: "vivy_studio_brief",
        description: `Brief Vivy ${activeMeta.title}`,
      });
      setStatus(result?.artifact?.url ? `Brief sauvegarde: ${result.artifact.url}` : "Brief sauvegarde dans A11.");
    } catch (error: any) {
      setStatus(`Sauvegarde A11 indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function uploadVoiceReference() {
    if (!hasSession) {
      setStatus("Connexion requise pour envoyer une référence voix.");
      return;
    }
    if (!voiceFile) {
      setStatus("Ajoute d'abord un fichier audio de référence.");
      return;
    }
    if (isVivyPrivateVoiceReferenceTooLarge(voiceFile)) {
      setStatus("Fichier trop gros pour une référence privée. Utilise la voix Vivy par défaut ou découpe un extrait court de 10 à 20 secondes.");
      return;
    }
    setIsBusy(true);
    setStatus("Upload référence voix...");
    try {
      const result = await uploadTtsVoiceReference(voiceFile, `Vivy - ${voiceFile.name}`, "private");
      setVoiceFileName(result.reference?.originalName || result.reference?.label || voiceFile.name);
      setVoiceReferenceId(String(result.reference?.id || ""));
      setVoiceTool("Voix Vivy + référence privée");
      setStatus("Référence voix privée active pour Vivy.");
    } catch (error: any) {
      setStatus(`Upload voix indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  function useDefaultVivyVoice() {
    setVoiceFile(null);
    setVoiceFileName("");
    setVoiceReferenceId("");
    setVoiceTool("Voix Vivy officielle");
    setStatus("Voix Vivy officielle sélectionnée. Aucun upload nécessaire.");
  }

  async function testDefaultVivyVoice() {
    if (!hasSession) {
      setStatus("Connexion requise pour tester la voix Vivy.");
      return;
    }
    setIsBusy(true);
    setStatus(`Test de la voix Vivy active: ${activeVoiceReferenceLabel}...`);
    try {
      const testLine = buildVivyPlayableText(
        voiceInstruction.trim(),
        "Je suis Vivy. Ma voix officielle est prête côté Funesterie.",
        180
      );
      const payload = await ttsSpeak(
        testLine,
        "vivy",
        "xtts-rvc",
        {
          persona: "vivy",
          voicePersona: "vivy",
          vocalMode: voiceTool.toLowerCase().includes("chant") ? "sing" : "adaptive",
          ...getVivyVoiceTuning(voiceTool.toLowerCase().includes("chant") ? "sing" : "adaptive"),
          ttsAsync: true,
          asyncTts: true,
          ttsJobTimeoutMs: 180000,
          audioFormat: "mp3",
          ...buildVivyVoiceReferenceOptions(),
          voiceReferenceRequired: true,
          referenceVoiceRequired: true,
          allowBrowserSpeechFallback: false,
        }
      );
      const mediaUrl = String(payload?.audioUrl || payload?.audio_url || payload?.url || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(payload?.provider || payload?.via || "a11-voice-module"),
        contentType: String(payload?.contentType || payload?.content_type || "audio/wav"),
      });
      setStatus(payload?.promptRenderedAsSpeech === false
        ? `Maquette voix Vivy prête depuis ${activeVoiceReferenceLabel}.`
        : `Voix Vivy prête depuis ${activeVoiceReferenceLabel}.`);
    } catch (error: any) {
      setStatus(`Test voix indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function produceSimpleVivySong() {
    if (!hasSession) {
      setStatus("Connexion requise pour générer une chanson Vivy.");
      return;
    }
    const prompt = toUnicodeText(songText || voiceInstruction || songMood, 1200).trim();
    if (!prompt) {
      setStatus("Écris un prompt, un thème ou quelques paroles pour générer la chanson.");
      return;
    }
    setIsBusy(true);
    setStatus("Vivy lance la génération audio...");
    try {
      const playablePrompt = buildVivyPlayableText(prompt, songMood || "Vivy garde la lumière dans l'obscurité.", 320);
      const songPrompt = [
        `Chanson Vivy courte.`,
        `Direction: ${songMood || "electro pop dark cinematographique"}.`,
        `Voix: ${activeVoiceReferenceLabel}.`,
        `Refrain à chanter: ${playablePrompt}`,
      ].join("\n");
      const payload = await ttsSpeak(songPrompt, "vivy", "xtts-rvc", {
        persona: "vivy",
        voicePersona: "vivy",
        vocalMode: "sing",
        voiceStyle: "song",
        ...getVivyVoiceTuning("sing"),
        ttsAsync: true,
        asyncTts: true,
        ttsJobTimeoutMs: 240000,
        audioFormat: "mp3",
        ...buildVivyVoiceReferenceOptions(),
        voiceReferenceRequired: true,
        referenceVoiceRequired: true,
        allowBrowserSpeechFallback: false,
      });
      const mediaUrl = String(payload?.audioUrl || payload?.audio_url || payload?.url || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(payload?.provider || payload?.via || "a11-voice-module"),
        contentType: String(payload?.contentType || payload?.content_type || "audio/wav"),
      });
      setVivyOutput([
        "VIVY_SIMPLE_SONG",
        `Direction: ${songMood || "electro pop dark cinematographique"}`,
        `Voix: ${activeVoiceReferenceLabel}`,
        `Prompt: ${playablePrompt}`,
        "",
        payload?.promptRenderedAsSpeech === false
          ? `Sortie: maquette audio Vivy depuis ${activeVoiceReferenceLabel}; paroles et structure gardées dans ce brief.`
          : "Sortie: audio chanson simple généré depuis prompt + voix Vivy.",
      ].join("\n"));
      setStatus(payload?.promptRenderedAsSpeech === false
        ? `Maquette chanson Vivy prête depuis ${activeVoiceReferenceLabel}.`
        : "Chanson simple Vivy prête.");
    } catch (error: any) {
      setStatus(`Chanson simple indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function askVivy() {
    if (!hasSession) {
      setStatus("Connexion requise pour produire avec Vivy.");
      return;
    }
    setIsBusy(true);
    setStatus("Vivy Studio prépare la production...");
    try {
      const payload = await runVivyStudioProduction({
        mode: activeMode,
        voiceTool,
        voiceInstruction,
        voiceFileName,
        voiceReferenceId,
        songSource,
        songMood,
        songText,
        shareTarget,
        shareUrl,
        shareInstruction,
        shareTokenPresent: Boolean(shareToken.trim()),
        allowPlaceholderMedia: false,
      });
      const text = String(payload?.assistant || payload?.message || payload?.content || "").trim();
      if (!text) throw new Error("reponse_vide");
      const audioUrl = String(payload?.audioUrl || payload?.audio_url || payload?.media?.audioUrl || payload?.media?.audio_url || "").trim();
      const videoUrl = String(payload?.videoUrl || payload?.video_url || payload?.media?.videoUrl || payload?.media?.video_url || "").trim();
      const mediaUrl = audioUrl || videoUrl;
      setVivyOutput(text);
      setVivyMedia(mediaUrl
        ? {
          kind: audioUrl ? "audio" : "video",
          url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
          provider: String(payload?.media?.provider || "").trim() || undefined,
          contentType: String(payload?.media?.content_type || "").trim() || undefined,
        }
        : null);
      setStatus(mediaUrl
        ? (payload.summary || "Production Vivy ajoutée au brief.")
        : (payload.mediaStatus?.message || payload.summary || "Brief Vivy prêt. Le bouton chanson crée un audio via la voix Vivy active."));
    } catch (error: any) {
      setStatus(`Production Vivy indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function openAgent(target: "a11" | "k44") {
    await copyBrief(target === "a11" ? "Brief copié. Ouverture A11..." : "Brief copié. Ouverture Kaen44...");
    const url = target === "a11"
      ? buildSessionBridgeUrl(new URL("/cockpit", A11_PUBLIC_APP_URL).toString())
      : buildSessionBridgeUrl(new URL("/cockpit", KAEN44_PUBLIC_APP_URL).toString());
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section id="vivy-studio" className="vivy-studio" aria-label="Studio Vivy">
      <div className="vivy-studio-head">
        <div>
          <h2>Studio Vivy</h2>
          <p>Voix, chanson, clip et partage prêts depuis les trois blocs de droite.</p>
        </div>
        <button type="button" onClick={shareBrief}>Partager le brief</button>
      </div>

      <div className="vivy-studio-grid">
        <div className="vivy-studio-modes" role="tablist" aria-label="Modules Vivy">
          {VIVY_STUDIO_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={activeMode === mode.id}
              className={activeMode === mode.id ? "is-active" : ""}
              onClick={() => setActiveMode(mode.id)}
            >
              <span>{mode.title}</span>
              <small>{mode.label}</small>
            </button>
          ))}
        </div>

        <form className="vivy-studio-form" onSubmit={(event) => { event.preventDefault(); if (!hasSession) setStatus("Connexion requise pour préparer Vivy."); else void copyBrief(`${activeMeta.action}: brief prêt.`); }}>
          <h3>{activeMeta.title}</h3>

          {activeMode === "voice" && (
            <>
              <label>
                Méthode voix
                <select
                  id="vivy-studio-voice-tool"
                  name="voiceTool"
                  value={voiceTool}
                  disabled={!hasSession}
                  onChange={(event) => setVoiceTool(event.target.value)}
                >
                  <option>Voix Vivy officielle</option>
                  <option>Voix Vivy chant</option>
                  <option>Voix Vivy + référence privée</option>
                  <option>Diagnostic module voix</option>
                </select>
              </label>
              <label>
                Référence audio
                <input
                  id="vivy-studio-voice-file"
                  name="voiceFile"
                  type="file"
                  accept="audio/*,video/quicktime,.wav,.mp3,.m4a,.mov,.flac,.ogg"
                  disabled={!hasSession}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] || null;
                    setVoiceFile(file);
                    setVoiceFileName(file?.name || "");
                    setVoiceReferenceId("");
                    if (file) setVoiceTool("Voix Vivy + référence privée");
                  }}
                />
              </label>
              <label>
                Instruction voix
                <textarea
                  id="vivy-studio-voice-instruction"
                  name="voiceInstruction"
                  rows={6}
                  value={voiceInstruction}
                  disabled={!hasSession}
                  onChange={(event) => setVoiceInstruction(event.target.value)}
                  placeholder="Ex: voix douce, proche micro, légère saturation pop, garder une diction claire."
                />
              </label>
              <div className="vivy-studio-actions vivy-studio-actions--voice">
                <button type="button" onClick={useDefaultVivyVoice} disabled={!hasSession || isBusy}>Voix Vivy par défaut</button>
                <button type="button" onClick={testDefaultVivyVoice} disabled={!hasSession || isBusy}>Tester voix Vivy</button>
                <button type="button" onClick={uploadVoiceReference} disabled={!hasSession || isBusy || !voiceFile}>Remplacer référence</button>
              </div>
              <p className="vivy-studio-active-voice">Voix active: {activeVoiceReferenceLabel}</p>
            </>
          )}

          {activeMode === "song" && (
            <>
              <label>
                Départ chanson
                <select
                  id="vivy-studio-song-source"
                  name="songSource"
                  value={songSource}
                  disabled={!hasSession}
                  onChange={(event) => setSongSource(event.target.value)}
                >
                  <option>Prompt + voix Vivy</option>
                  <option>Thème</option>
                  <option>Texte brut</option>
                  <option>Paroles</option>
                  <option>Instruction complète</option>
                </select>
              </label>
              <label>
                Couleur sonore
                <input
                  id="vivy-studio-song-mood"
                  name="songMood"
                  value={songMood}
                  disabled={!hasSession}
                  onChange={(event) => setSongMood(event.target.value)}
                />
              </label>
              <label>
                Matière créative
                <textarea
                  id="vivy-studio-song-text"
                  name="songText"
                  rows={8}
                  value={songText}
                  disabled={!hasSession}
                  onChange={(event) => setSongText(event.target.value)}
                  placeholder="Thème, paroles, ambiance, intention, histoire ou simple idée."
                />
              </label>
              <div className="vivy-studio-actions vivy-studio-actions--song">
                <button type="button" onClick={produceSimpleVivySong} disabled={!hasSession || isBusy || !songText.trim()}>
                  Prompt + voix active = chanson
                </button>
              </div>
            </>
          )}

          {activeMode === "share" && (
            <>
              <label>
                Canal
                <select
                  id="vivy-studio-share-target"
                  name="shareTarget"
                  value={shareTarget}
                  disabled={!hasSession}
                  onChange={(event) => setShareTarget(event.target.value)}
                >
                  <option>YouTube</option>
                  <option>OBS / Live</option>
                  <option>SoundCloud</option>
                  <option>Deezer</option>
                  <option>Lien équipe</option>
                </select>
              </label>
              <label>
                Lien ou cible
                <input
                  id="vivy-studio-share-url"
                  name="shareUrl"
                  value={shareUrl}
                  disabled={!hasSession}
                  onChange={(event) => setShareUrl(event.target.value)}
                  placeholder="https://..."
                />
              </label>
              <label>
                Token local
                <input
                  id="vivy-studio-share-token"
                  name="shareToken"
                  type="password"
                  value={shareToken}
                  disabled={!hasSession}
                  onChange={(event) => setShareToken(event.target.value)}
                  placeholder="Non stocké, non copié dans le brief"
                  autoComplete="off"
                />
              </label>
              <label>
                Instruction publication
                <textarea
                  id="vivy-studio-share-instruction"
                  name="shareInstruction"
                  rows={6}
                  value={shareInstruction}
                  disabled={!hasSession}
                  onChange={(event) => setShareInstruction(event.target.value)}
                  placeholder="Ex: clip vertical 30s, titre court, description FR, tags Funesterie/Vivy."
                />
              </label>
            </>
          )}

          <div className="vivy-studio-actions">
            <button type="submit" disabled={!hasSession}>{activeMeta.action}</button>
            <button type="button" onClick={askVivy} disabled={!hasSession || isBusy}>Demander à Vivy</button>
            <button type="button" onClick={() => openAgent("a11")}>Ouvrir A11</button>
            <button type="button" onClick={() => openAgent("k44")}>Kaen44</button>
            <button type="button" onClick={saveBriefArtifact} disabled={!hasSession || isBusy}>Sauver dans A11</button>
          </div>
        </form>

        <aside className="vivy-studio-brief" aria-live="polite">
          <h3>Brief agents</h3>
          <pre>{brief}</pre>
          <div>
            <button type="button" onClick={() => copyBrief()}>Copier</button>
            <button type="button" onClick={shareBrief}>Partager</button>
          </div>
          {status && <p>{status}</p>}
          {vivyMedia && (
            <div className="vivy-studio-media">
              <strong>{String(vivyMedia.provider || "").includes("emergency") ? (vivyMedia.kind === "audio" ? "Maquette audio locale" : "Maquette vidéo locale") : (vivyMedia.kind === "audio" ? "Audio Vivy prêt" : "Clip Vivy prêt")}</strong>
              {vivyMedia.kind === "audio" ? (
                <audio src={vivyMedia.url} controls preload="metadata" />
              ) : (
                <video src={vivyMedia.url} controls preload="metadata" playsInline />
              )}
              <a href={vivyMedia.url} target="_blank" rel="noreferrer">
                Ouvrir le media
              </a>
              {(vivyMedia.provider || vivyMedia.contentType) && (
                <small>{[vivyMedia.provider, vivyMedia.contentType].filter(Boolean).join(" - ")}</small>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function VivyPublicChat({ hasSession }: VivySessionProps) {
  const [messages, setMessages] = useState<VivyPublicChatMessage[]>(() => hasSession ? readVivyPublicChat() : [buildVivyLockedMessage()]);
  const [conversationId] = useState(() => readOrCreateVivyConversationId());
  const [draft, setDraft] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<VivyPublicChatFile[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState("");
  const [voiceReferenceName, setVoiceReferenceName] = useState(() => readVivyVoiceReferenceLabel());
  const [awaitingVoiceReference, setAwaitingVoiceReference] = useState(false);
  const chatRootRef = useRef<HTMLElement | null>(null);
  const composeRef = useRef<HTMLFormElement | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const voiceReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    writeVivyPublicChat(messages);
  }, [messages]);

  useEffect(() => {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setAttachedFiles([]);
      setIsSending(false);
      setAwaitingVoiceReference(false);
      return;
    }

    setMessages((current) => {
      if (current.length === 1 && current[0]?.id === "vivy-locked") {
        return readVivyPublicChat();
      }
      return current;
    });
  }, [hasSession]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isSending]);

  useEffect(() => {
    const root = chatRootRef.current;
    if (!root) return;

    const viewport = window.visualViewport;
    let settleTimer = 0;
    let viewportFrame = 0;

    const setKeyboardInset = () => {
      const inset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty("--vivy-keyboard-inset", `${Math.round(inset)}px`);
      return inset;
    };

    const keepComposerVisible = (behavior: ScrollBehavior = "smooth") => {
      setKeyboardInset();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        const target = draftInputRef.current || composeRef.current || root;
        target.scrollIntoView({ behavior, block: "center", inline: "nearest" });
        endRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
      }, 80);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!root.contains(event.target as Node)) return;
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      document.body.classList.add("vivy-keyboard-open");
      keepComposerVisible();
    };

    const onFocusOut = () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement && root.contains(activeElement)) return;
        document.body.classList.remove("vivy-keyboard-open");
        document.documentElement.style.setProperty("--vivy-keyboard-inset", "0px");
      }, 180);
    };

    const onViewportChange = () => {
      if (!document.body.classList.contains("vivy-keyboard-open")) return;
      setKeyboardInset();
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(() => keepComposerVisible("auto"));
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);

    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(viewportFrame);
      document.body.classList.remove("vivy-keyboard-open");
      document.documentElement.style.setProperty("--vivy-keyboard-inset", "0px");
    };
  }, []);

  async function sendMessage(textOverride?: string) {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connecte-toi à Funesterie avant d'envoyer un message.");
      return;
    }
    const text = toUnicodeText(textOverride ?? draft);
    const filesForMessage = attachedFiles.slice(0, 6);
    if ((!text && !filesForMessage.length) || isSending) return;

    const now = new Date().toISOString();
    const userMessage: VivyPublicChatMessage = {
      id: `vivy-user-${Date.now()}`,
      role: "user",
      content: text || "J'ajoute ces fichiers pour Vivy.",
      ts: now,
      files: filesForMessage,
    };
    const nextMessages = [...messages, userMessage].slice(-24);
    const voiceChangeRequested = isVivyVoiceChangeRequest(text);
    const activeVivyVoiceReferenceName = voiceReferenceName || "Vivy par défaut";
    setMessages(nextMessages);
    setDraft("");
    setAttachedFiles([]);
    setIsSending(true);
    setAwaitingVoiceReference(voiceChangeRequested);
    setStatus(voiceChangeRequested
      ? `Voix active: ${activeVivyVoiceReferenceName}`
      : "Vivy écoute et range l'idée...");

    try {
      const payload = await chatWithVivy({
        message: text || userMessage.content,
        conversationId,
        files: filesForMessage.map((file) => ({
          id: file.id,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          url: file.url || file.downloadUrl,
          downloadUrl: file.downloadUrl,
          description: file.description,
          textPreview: file.textPreview,
          uploaded: file.uploaded,
        })),
        history: nextMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
          ts: entry.ts,
        })),
      });
      const assistantText = toUnicodeText(payload.assistant || payload.content || payload.summary)
        || "Je suis là, mais je n'ai pas encore assez de matière. Donne-moi une ambiance, une phrase ou une direction.";
      const voiceInstruction = voiceChangeRequested
        ? `\n\nLa voix Vivy par défaut est déjà active. Envoie un audio seulement si tu veux la remplacer.`
        : "";
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-assistant-${Date.now()}`,
        role: "assistant",
        content: `${assistantText}${voiceInstruction}`,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-24));
      const memoryText = payload.semanticMemory?.stored || payload.memoryStored
        ? "Idée rangée dans la mémoire Vivy"
        : "Vivy prête";
      setStatus(payload.aiMode === "llm"
        ? `${memoryText} - IA active`
        : memoryText);
    } catch (error: any) {
      const voiceFailureInstruction = voiceChangeRequested
        ? "\n\nLa voix Vivy par défaut est déjà prête côté serveur."
        : "";
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-error-${Date.now()}`,
        role: "assistant",
        content: `Je n'arrive pas à joindre le studio Vivy pour l'instant: ${error?.message || error}${voiceFailureInstruction}`,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-24));
      setStatus("Connexion Vivy à vérifier");
    } finally {
      setIsSending(false);
    }
  }

  function useDefaultVivyChatVoice() {
    writeVivyVoiceReferenceLabel("");
    setVoiceReferenceName("");
    setAwaitingVoiceReference(false);
    setStatus("Voix Vivy par défaut active.");
    const assistantMessage: VivyPublicChatMessage = {
      id: `vivy-default-voice-${Date.now()}`,
      role: "assistant",
      content: "Voix Vivy par défaut activée. Tu peux envoyer un extrait audio seulement si tu veux la remplacer.",
      ts: new Date().toISOString(),
    };
    setMessages((current) => [...current, assistantMessage].slice(-24));
  }

  async function onVivyVoiceReferenceChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!hasSession) {
      event.target.value = "";
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connexion requise pour ajouter une référence voix.");
      return;
    }
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (isVivyPrivateVoiceReferenceTooLarge(file)) {
      setAwaitingVoiceReference(false);
      setStatus("Audio trop lourd pour une référence privée. La voix Vivy par défaut reste active; découpe un extrait court si tu veux vraiment la remplacer.");
      return;
    }
    setStatus("Vivy garde la référence voix...");
    try {
      const label = `Vivy - ${toUnicodeLine(file.name.replace(/\.[^.]+$/, ""), "référence voix", 54)}`;
      const result = await uploadTtsVoiceReference(file, label, "private");
      const storedName = result.reference?.label || result.reference?.originalName || label;
      writeVivyVoiceReferenceLabel(storedName);
      setVoiceReferenceName(storedName);
      setAwaitingVoiceReference(false);
      setStatus(`Référence voix privée: ${storedName}`);
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-voice-reference-${Date.now()}`,
        role: "assistant",
        content: `Référence reçue. Quand tu me demandes cette voix, je m'en sers comme base privée.`,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-24));
    } catch (error: any) {
      setStatus(`Audio non ajouté: ${error?.message || error}`);
      setAwaitingVoiceReference(true);
    }
  }

  async function onVivyConversationFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!hasSession) {
      event.target.value = "";
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connexion requise pour joindre des fichiers à Vivy.");
      return;
    }
    const selected = Array.from(event.target.files || []).slice(0, 4);
    event.target.value = "";
    if (!selected.length) return;

    setStatus("Vivy ajoute les fichiers au contexte...");
    const nextFiles: VivyPublicChatFile[] = [];
    for (const file of selected) {
      const textPreview = await readVivyFileTextPreview(file);
      const baseFile: VivyPublicChatFile = {
        id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        filename: toUnicodeLine(file.name, "fichier", 180),
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        description: textPreview ? "Extrait texte lu localement pour Vivy." : "Fichier joint à la conversation Vivy.",
        textPreview,
        uploaded: false,
        uploadState: "local",
      };

      try {
        const upload = await uploadConversationFile(file, {
          conversationId,
          surface: "vivy",
          storagePreference: "session-drive",
          preferExternalStorage: true,
        });
        const resource = upload.conversationResource || upload.file || null;
        nextFiles.push({
          ...baseFile,
          id: String(resource?.id || resource?.storageKey || baseFile.id),
          url: resource?.url,
          downloadUrl: resource?.downloadUrl || resource?.url,
          contentType: resource?.contentType || baseFile.contentType,
          sizeBytes: resource?.sizeBytes || baseFile.sizeBytes,
          uploaded: true,
          uploadState: "stored",
          storageBackend: (upload as any)?.storageBackend || (resource as any)?.storageBackend || "session-drive",
        });
      } catch (error: any) {
        const errorCode = String(error?.payload?.error || error?.code || "").trim();
        const targets = Array.isArray(error?.payload?.storageTargets) ? error.payload.storageTargets : [];
        const linkedTargets = targets
          .filter((target: any) => target?.linked)
          .map((target: any) => String(target?.label || target?.destination || target?.provider || "").trim())
          .filter(Boolean);
        const description = errorCode === "session_drive_writer_missing"
          ? `Drive autorisé (${linkedTargets.join(", ") || "Google/OneDrive"}), writer de session pas encore branché; fichier conservé localement dans le navigateur.`
          : errorCode === "session_drive_not_authorized"
            ? "Drive/OneDrive non autorisé pour cette session; fichier conservé localement dans le navigateur."
            : `Upload externe indisponible; fichier conservé localement dans le navigateur.${error?.message ? ` (${error.message})` : ""}`;
        nextFiles.push({
          ...baseFile,
          description,
          uploadError: errorCode || "upload_failed",
          storageBackend: "browser-local",
        });
      }
    }

    setAttachedFiles((current) => [...current, ...nextFiles].slice(-6));
    const stored = nextFiles.filter((file) => file.uploadState === "stored").length;
    const blocked = nextFiles.filter((file) => file.uploadError === "session_drive_not_authorized").length;
    const waitingWriter = nextFiles.filter((file) => file.uploadError === "session_drive_writer_missing").length;
    setStatus(stored
      ? `${nextFiles.length} fichier${nextFiles.length > 1 ? "s" : ""} prêt${nextFiles.length > 1 ? "s" : ""} pour Vivy`
      : waitingWriter
        ? "Drive autorisé, writer Google/OneDrive encore à brancher; contexte gardé localement."
        : blocked
          ? "Connecte Google Drive ou OneDrive pour stocker ces fichiers hors serveur."
          : "Fichiers ajoutés en contexte local");
  }

  function resetChat() {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connexion requise pour utiliser Vivy.");
      return;
    }
    const next = [buildVivyGreeting()];
    setMessages(next);
    setAttachedFiles([]);
    setStatus("Conversation remise à zéro");
  }

  return (
    <section ref={chatRootRef} className="vivy-chat" id="vivy-chat" aria-label="Chat Vivy">
      <div className="vivy-chat-head">
        <div>
          <h2>Parler à Vivy</h2>
          <p>Voix, chanson, ambiance ou scène: Vivy transforme l'idée en direction exploitable.</p>
        </div>
        <button type="button" onClick={resetChat} disabled={!hasSession}>Reset</button>
      </div>

      <div className="vivy-chat-log" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`vivy-chat-message vivy-chat-message--${message.role}`}>
            <span>{message.role === "user" ? "Vous" : "Vivy"}</span>
            <p>{message.content}</p>
            {message.files?.length ? (
              <div className="vivy-chat-file-list" aria-label="Fichiers joints au message">
                {message.files.map((file) => (
                  <span key={`${message.id}-${file.id || file.filename}`}>
                    {file.filename}{file.sizeBytes ? ` - ${formatVivyFileSize(file.sizeBytes)}` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {isSending && (
          <article className="vivy-chat-message vivy-chat-message--assistant">
            <span>Vivy</span>
            <p>Je compose la réponse...</p>
          </article>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      <form ref={composeRef} className="vivy-chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <textarea
          id="vivy-chat-message"
          name="message"
          ref={draftInputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={hasSession ? "Ex: fais-moi une chanson sombre mais douce sur Nossen." : "Connecte-toi pour écrire à Vivy..."}
          rows={3}
          disabled={!hasSession}
        />
        <div>
          <button type="button" disabled={!hasSession} onClick={() => void sendMessage("Prépare une voix Vivy douce, proche micro, avec une phrase test.")}>Voix</button>
          <button type="button" disabled={!hasSession} onClick={() => void sendMessage("Transforme cette idée en chanson Vivy avec structure et refrain.")}>Chanson</button>
          <button type="button" disabled={!hasSession} onClick={() => void sendMessage("Prépare une scène courte pour publier Vivy en clip vertical.")}>Scène</button>
          <button type="button" disabled={!hasSession} onClick={() => fileInputRef.current?.click()}>Fichier</button>
          <button type="submit" disabled={!hasSession || isSending || (!draft.trim() && !attachedFiles.length)}>Envoyer</button>
        </div>
      </form>
      {attachedFiles.length ? (
        <div className="vivy-chat-attachments" aria-label="Fichiers prêts pour Vivy">
          {attachedFiles.map((file) => (
            <span key={file.id || file.filename}>
              {file.filename}{file.sizeBytes ? ` - ${formatVivyFileSize(file.sizeBytes)}` : ""}
              <button
                type="button"
                aria-label={`Retirer ${file.filename}`}
                onClick={() => setAttachedFiles((current) => current.filter((entry) => entry !== file))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={`vivy-chat-reference ${awaitingVoiceReference ? "is-needed" : ""}`}>
        <span>{`Voix: ${voiceReferenceName || "Vivy par défaut"}`}</span>
        <div>
          <button type="button" disabled={!hasSession} onClick={useDefaultVivyChatVoice}>
            Défaut
          </button>
          <button type="button" disabled={!hasSession} onClick={() => voiceReferenceInputRef.current?.click()}>
            Audio perso
          </button>
        </div>
      </div>
      <input
        id="vivy-chat-reference-file"
        name="vivyChatReferenceFile"
        ref={voiceReferenceInputRef}
        type="file"
        accept="audio/*,video/quicktime,.wav,.mp3,.webm,.m4a,.mov,.ogg"
        onChange={onVivyVoiceReferenceChange}
        hidden
      />
      <input
        id="vivy-chat-file"
        name="vivyChatFiles"
        ref={fileInputRef}
        type="file"
        accept="audio/*,image/*,video/*,text/*,.txt,.md,.json,.csv,.srt,.vtt,.pdf"
        multiple
        onChange={onVivyConversationFileChange}
        hidden
      />
      {status && <p className="vivy-chat-status">{status}</p>}
    </section>
  );
}

function VivyPublicSurface({ hasSession }: VivySessionProps) {
  const hotspots: Array<{ mode: VivyStudioMode; label: string }> = [
    { mode: "voice", label: "Ouvrir création voix dans le Studio Vivy" },
    { mode: "song", label: "Ouvrir Composition production dans le Studio Vivy" },
    { mode: "share", label: "Ouvrir scène partage dans le Studio Vivy" },
  ];

  return (
    <>
      <section className="vivy-public-stage" aria-label="Vivy présence musicale" tabIndex={0}>
        <div className="vivy-public-poster-frame">
          <img
            className="vivy-public-poster"
            src={VIVY_POSTER_SRC}
            alt="Vivy: voix, musique, création et partage."
          />
          <div className="vivy-public-hotspots" aria-label="Accès directs Vivy">
            {hotspots.map((hotspot) => (
              <button
                key={hotspot.mode}
                type="button"
                className={`vivy-public-hotspot vivy-public-hotspot--${hotspot.mode}`}
                onClick={() => openVivyStudioMode(hotspot.mode)}
                aria-label={hotspot.label}
              />
            ))}
          </div>
        </div>
      </section>
      <VivyPublicChat hasSession={hasSession} />
      <VivyStudioLab hasSession={hasSession} />
    </>
  );
}

type VivyPublicPageProps = {
  authenticated: boolean;
  displayName: string;
};

// CANONICAL React Vivy shell. Static production copy lives in public/vivy/index.html;
// keep both aligned for session/logout behavior and never rely on localStorage alone.
function VivyPublicPage({ authenticated, displayName }: VivyPublicPageProps) {
  useEffect(() => {
    document.documentElement.classList.add("vivy-public-page-root");
    document.body.classList.add("vivy-public-page-body");
    return () => {
      document.documentElement.classList.remove("vivy-public-page-root");
      document.body.classList.remove("vivy-public-page-body");
    };
  }, []);

  const surfaceLinks = getSurfaceLinks();
  const [connectionStarting, setConnectionStarting] = useState(false);
  const [vivyHasSession, setVivyHasSession] = useState(() => authenticated || hasVivyAuthenticatedSession());
  const [vivyDisplayName, setVivyDisplayName] = useState(() => displayName || getAuthDisplayName() || "Connexion requise");

  useEffect(() => {
    const nextHasSession = authenticated || hasVivyAuthenticatedSession();
    setVivyHasSession(nextHasSession);
    setVivyDisplayName(nextHasSession ? (displayName || getAuthDisplayName() || "Utilisateur") : "Connexion requise");
  }, [authenticated, displayName]);

  function openVivyAccount() {
    setConnectionStarting(true);
    if (typeof window !== "undefined") {
      window.location.assign(vivyHasSession ? buildSessionBridgeUrl(surfaceLinks.account) : buildCentralLoginUrl(surfaceLinks.vivy));
    }
  }

  async function handleVivyLogout() {
    setConnectionStarting(true);
    try {
      await logoutAllSessions();
    } finally {
      setVivyHasSession(false);
      setVivyDisplayName("Connexion requise");
      setConnectionStarting(false);
      if (typeof window !== "undefined") window.location.assign(buildCentralLoginUrl(surfaceLinks.vivy));
    }
  }

  return (
    <main className="kaen-public-shell kaen-public-shell--page vivy-public-shell">
      <nav className="kaen-public-nav vivy-agent-nav" aria-label="Navigation Vivy">
        <a href={surfaceLinks.vivy} className="kaen-public-brand vivy-agent-brand">
          <img src={NOSSEN_VIVY_BOOSTER_SRC} alt="" />
          <span>
            <strong>Vivy</strong>
          </span>
        </a>
        <div className="vivy-agent-actions">
          <a href={surfaceLinks.home} className="vivy-agent-home">Accueil</a>
          <details className="vivy-agent-session-menu">
            <summary>Discussion</summary>
            <div className="vivy-agent-session-panel">
              <a className="vivy-agent-menu-row" href="#vivy-chat">
                <span>Discussion</span>
                <span>Ouvrir</span>
              </a>
              <a className="vivy-agent-menu-row" href="#vivy-studio">
                <span>Studio</span>
                <span>Vivy</span>
              </a>
              <button
                type="button"
                className="kaen-public-login vivy-agent-menu-session-button"
                onClick={openVivyAccount}
                disabled={connectionStarting}
              >
                <span>Compte</span>
                <strong>{connectionStarting ? "Connexion..." : vivyHasSession ? vivyDisplayName : "Connexion"}</strong>
              </button>
            </div>
          </details>
          <details className="vivy-agent-menu">
            <summary>Menu</summary>
            <div className="vivy-agent-menu-panel">
              <section className="vivy-agent-menu-section" aria-label="Langue">
                <p className="vivy-agent-menu-title">Langue</p>
                <select
                  id="vivy-agent-menu-language"
                  name="vivyLanguage"
                  className="vivy-agent-menu-select"
                  aria-label="Langue Vivy"
                  defaultValue="Français"
                >
                  <option>Français</option>
                </select>
              </section>
              <section className="vivy-agent-menu-section" aria-label="Options">
                <p className="vivy-agent-menu-title">Options</p>
                <a className="vivy-agent-menu-row" href="#vivy-studio">
                  <span>Panneau studio</span>
                  <span>Ouvrir</span>
                </a>
              </section>
              <section className="vivy-agent-menu-section" aria-label="Agents">
                <p className="vivy-agent-menu-title">Agents</p>
                <div className="vivy-agent-menu-grid">
                  <a className="vivy-agent-menu-card" href={buildSessionBridgeUrl(surfaceLinks.kaen44Cockpit)}>
                    <img src={KAEN44_AVATAR_SRC} alt="" />
                    <span>
                      <strong>Kaen44</strong>
                      <small>Agent bureau</small>
                    </span>
                  </a>
                  <a className="vivy-agent-menu-card" href={buildSessionBridgeUrl(surfaceLinks.a11Cockpit)}>
                    <img src={A11_HOODED_AGENT_SRC} alt="" />
                    <span>
                      <strong>A11</strong>
                      <small>Agent média</small>
                    </span>
                  </a>
                  <a className="vivy-agent-menu-card is-current" href={surfaceLinks.vivy} aria-current="page">
                    <img src={NOSSEN_VIVY_BOOSTER_SRC} alt="" />
                    <span>
                      <strong>Vivy</strong>
                      <small>Agent musical</small>
                    </span>
                  </a>
                </div>
              </section>
              <section className="vivy-agent-menu-section" aria-label="Services">
                <p className="vivy-agent-menu-title">Services</p>
                <a className="vivy-agent-menu-row" href={surfaceLinks.home}>
                  <span>Accueil</span>
                  <span>Public</span>
                </a>
                <a className="vivy-agent-menu-row" href="#vivy-studio">
                  <span>Studio</span>
                  <span>Vivy</span>
                </a>
                <a className="vivy-agent-menu-row" href={surfaceLinks.cockpit}>
                  <span>Cockpit</span>
                  <span>État</span>
                </a>
              </section>
              <section className="vivy-agent-menu-section vivy-agent-menu-section--account" aria-label="Compte">
                <p className="vivy-agent-menu-title">Compte</p>
                <a className="vivy-agent-menu-row" href={vivyHasSession ? buildSessionBridgeUrl(surfaceLinks.account) : buildCentralLoginUrl(surfaceLinks.vivy)}>
                  <span>Compte</span>
                  <span>{vivyHasSession ? vivyDisplayName : "Connexion requise"}</span>
                </a>
                {vivyHasSession ? (
                  <button
                    type="button"
                    className="kaen-public-login vivy-agent-menu-session-button vivy-agent-menu-session-button--danger"
                    onClick={() => void handleVivyLogout()}
                    disabled={connectionStarting}
                  >
                    <span>Compte</span>
                    <strong>Se déconnecter</strong>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="kaen-public-login vivy-agent-menu-session-button"
                    onClick={openVivyAccount}
                    disabled={connectionStarting}
                  >
                    <span>Compte</span>
                    <strong>{connectionStarting ? "Connexion..." : "Se connecter"}</strong>
                  </button>
                )}
              </section>
            </div>
          </details>
        </div>
      </nav>
      <VivyPublicSurface hasSession={vivyHasSession} />
    </main>
  );
}

type SurfaceLinks = ReturnType<typeof getSurfaceLinks>;

function getSurfaceChatHref(surface: FunesterieSurface, surfaceLinks: SurfaceLinks) {
  if (surface === "vivy") return surfaceLinks.vivy;
  if (surface === "kaen44") return surfaceLinks.kaen44Cockpit;
  return surfaceLinks.a11Cockpit;
}

function getFunesterieAgentShortcuts(surfaceLinks: SurfaceLinks) {
  return [
    {
      id: "kaen44",
      name: "Kaen44",
      role: "Agent bureau",
      text: "Interface quotidienne, suivi et organisation.",
      image: KAEN44_AVATAR_SRC,
      href: surfaceLinks.kaen44Cockpit,
    },
    {
      id: "a11",
      name: "A11",
      role: "Agent média",
      text: "Audio, vidéo, documents et analyse.",
      image: A11_HOODED_AGENT_SRC,
      href: surfaceLinks.a11Cockpit,
    },
    {
      id: "vivy",
      name: "Vivy",
      role: "Agent musical",
      text: "Voix, chansons, scènes et publication.",
      image: VIVY_POSTER_SRC,
      href: surfaceLinks.vivy,
    },
  ];
}

const FUNESTERIE_HOME_AGENTS = [
  {
    id: "vivy",
    name: "Vivy",
    role: "Agent musical",
    text: "Idées de voix, chansons, scènes et présence créative.",
    href: "vivy",
    image: NOSSEN_VIVY_BOOSTER_SRC,
    tone: "pink",
    glyph: "♪",
  },
  {
    id: "a11",
    name: "A11",
    role: "Agent média",
    text: "Prépare les médias, les documents et les résumés utiles.",
    href: "a11",
    image: NOSSEN_A11_DERBI_SRC,
    tone: "blue",
    glyph: "≋",
  },
  {
    id: "kaen44",
    name: "Kaen44",
    role: "Agent bureau",
    text: "Accueil, suivi, organisation et interface quotidienne.",
    href: "kaen44",
    image: NOSSEN_K44_TZR_SRC,
    tone: "violet",
    glyph: "K",
  },
];

type FunesterieVoicePersona = {
  id: FunesterieSurface;
  name: string;
  role: string;
  signal: string;
  detail: string;
  sample: string;
  image: string;
  tone: string;
  voiceStyle: string;
};

const FUNESTERIE_VOICE_PERSONAS: FunesterieVoicePersona[] = [
  {
    id: "a11",
    name: "A11",
    role: "Voix grave, nette, opérateur média",
    signal: "Terminator",
    detail: "Analyse, cadrage, vidéo, synthèse et réponse posée.",
    sample: "A11 en ligne. Je garde le cap: analyse propre, action courte, résultat vérifiable.",
    image: NOSSEN_A11_DERBI_SRC,
    tone: "blue",
    voiceStyle: "terminator",
  },
  {
    id: "kaen44",
    name: "Kaen44",
    role: "Voix bureau, vive, copilote quotidien",
    signal: "Donna",
    detail: "Priorités, documents, organisation et retour au calme.",
    sample: "Kaen44 prête. On range le chaos, on choisit la prochaine action, et on avance.",
    image: NOSSEN_K44_TZR_SRC,
    tone: "violet",
    voiceStyle: "donna",
  },
  {
    id: "vivy",
    name: "Vivy",
    role: "Voix musicale, sensible, scène créative",
    signal: "Vivy",
    detail: "Chansons, ambiance, voix, harmonies et présence de scène.",
    sample: "Je suis Vivy. Donne-moi une émotion, je la transforme en scène, en voix, en lumière.",
    image: NOSSEN_VIVY_BOOSTER_SRC,
    tone: "pink",
    voiceStyle: "vivy",
  },
];

const FUNESTERIE_BATTLE_MOVES = [
  {
    id: "scan",
    label: "Lire le terrain",
    userDelta: 1,
    funDelta: 2,
    log: "A11 lit l'écran, Qflush prépare les contrôles, l'utilisateur garde l'initiative.",
  },
  {
    id: "counter",
    label: "Contre humain",
    userDelta: 3,
    funDelta: 1,
    log: "Belle parade utilisateur. Funesterie.me adapte le prochain coup.",
  },
  {
    id: "combo",
    label: "Combo NOSSEN",
    userDelta: 1,
    funDelta: 3,
    log: "Vivy cadence, Kaen44 synchronise, A11 verrouille le timing.",
  },
] as const;

const NOSSEN_PUBLIC_PACKAGES = [
  "@nossen/all-in-one",
  "@nossen/allmight",
  "@nossen/bat",
  "@nossen/bat-system",
  "@nossen/beam",
  "@nossen/dragon",
  "@nossen/dragon-contracts",
  "@nossen/dragon-upstream",
  "@nossen/envapt-superimg",
  "@nossen/envaptex",
  "@nossen/freeland",
  "@nossen/freeland-bros",
  "@nossen/katana",
  "@nossen/logic-reduce",
  "@nossen/mcp-agent-bus",
  "@nossen/mcp-chopper-mixer",
  "@nossen/mcp-cloud-assets",
  "@nossen/mcp-job-queue",
  "@nossen/mcp-media-bridge",
  "@nossen/mcp-memory-graph",
  "@nossen/mcp-public-endpoints",
  "@nossen/mcp-qflush-control",
  "@nossen/mcp-retro-session",
  "@nossen/mcp-security-preflight",
  "@nossen/mcp-tool-manifest",
  "@nossen/mcp-toolkit",
  "@nossen/mcp-web-drafts",
  "@nossen/mcp-worker-supervisor",
  "@nossen/morphing",
  "@nossen/nezlephant",
  "@nossen/qflush",
  "@nossen/qflush-runner",
  "@nossen/rome",
  "@nossen/scentgate",
  "@nossen/scream",
  "@nossen/spyder",
  "a11-coder",
] as const;

function buildNpmPackageUrl(packageName: string) {
  return `https://www.npmjs.com/package/${packageName}`;
}

function buildHomeAgentHref(agentHref: string, surfaceLinks: SurfaceLinks) {
  if (agentHref === "home") return surfaceLinks.home;
  if (agentHref === "vivy") return surfaceLinks.vivy;
  if (agentHref === "a11") return buildSessionBridgeUrl(surfaceLinks.a11Cockpit);
  if (agentHref === "kaen44") return buildSessionBridgeUrl(surfaceLinks.kaen44Cockpit);
  if (agentHref === "cockpit") return surfaceLinks.cockpit;
  return surfaceLinks.agents;
}

const FUNESTERIE_ARCHITECTURE_CLUSTERS = [
  {
    id: "site",
    tone: "teal",
    title: "Site public",
    summary: "Une seule porte d'entrée claire pour les visiteurs, les comptes et les agents.",
    items: ["funesterie.me", "Compte", "Agents", "État public"],
  },
  {
    id: "agents",
    tone: "violet",
    title: "Agents IA",
    summary: "Des assistants spécialisés qui restent séparés par rôle et par surface.",
    items: ["A11 média", "K44 bureau", "Vivy musique", "Coordination Codex/Kiro"],
  },
  {
    id: "infra",
    tone: "blue",
    title: "Infrastructure",
    summary: "Le site est servi depuis Hetzner, routé proprement et isolé par services.",
    items: ["Hetzner", "Docker", "Reverse proxy", "Cloudflare DNS"],
  },
  {
    id: "memory",
    tone: "amber",
    title: "Mémoire & graphe",
    summary: "Les liens importants peuvent être relus comme un graphe au lieu d'un tas de notes.",
    items: ["Neo4j", "Agent bus", "Historique", "État de session"],
  },
  {
    id: "packages",
    tone: "green",
    title: "Modules NOSSEN",
    summary: "Les modules publiables sont séparés du site pour pouvoir être testés et distribués.",
    items: ["@nossen/*", "GitHub", "npm", "Pipeline de publication"],
  },
  {
    id: "security",
    tone: "rose",
    title: "Sécurité",
    summary: "Les accès privés restent derrière des contrôles, les secrets ne sont pas exposés.",
    items: ["OAuth/JWT", "Frontière secrets", "Préflight", "Capsules conteneurs"],
  },
] as const;

const FUNESTERIE_ARCHITECTURE_FLOW = [
  "Un visiteur arrive sur funesterie.me.",
  "Le site route vers Compte, Agents, État ou Contact.",
  "Les actions privées demandent une session valide.",
  "Les agents travaillent dans leurs surfaces dédiées.",
  "Les modules NOSSEN passent par code, tests et publication.",
  "Neo4j garde une vue des liaisons et dépendances utiles.",
] as const;

const FUNESTERIE_ARCHITECTURE_GUARDS = [
  ["Public", "Pages, statuts et documentation partageables."],
  ["Privé", "Comptes, tokens, fichiers et actions sensibles."],
  ["Contrôlé", "Tests, préflight, traces et vérifications avant publication."],
] as const;

type FunesterieGraphKind = "core" | "surface" | "agent" | "infra" | "data" | "module" | "security" | "publish";
type FunesterieGraphLinkKind = "route" | "runtime" | "data" | "guard" | "publish";
type FunesterieGraphNode = {
  id: string;
  label: string;
  kind: FunesterieGraphKind;
  x: number;
  y: number;
};
type FunesterieGraphLink = {
  from: string;
  to: string;
  label: string;
  kind: FunesterieGraphLinkKind;
};

const FUNESTERIE_ARCHITECTURE_GRAPH_NODES: ReadonlyArray<FunesterieGraphNode> = [
  { id: "funesterie", label: "funesterie.me", kind: "core", x: 600, y: 350 },
  { id: "home", label: "Accueil", kind: "surface", x: 420, y: 220 },
  { id: "account", label: "Compte", kind: "surface", x: 600, y: 175 },
  { id: "agents", label: "Agents", kind: "surface", x: 780, y: 220 },
  { id: "status", label: "État", kind: "surface", x: 880, y: 340 },
  { id: "contact", label: "Contact", kind: "surface", x: 320, y: 340 },
  { id: "a11", label: "A11", kind: "agent", x: 400, y: 475 },
  { id: "k44", label: "K44", kind: "agent", x: 600, y: 535 },
  { id: "vivy", label: "Vivy", kind: "agent", x: 800, y: 475 },
  { id: "codex", label: "Codex", kind: "agent", x: 1010, y: 210 },
  { id: "kiro", label: "Kiro", kind: "agent", x: 1040, y: 330 },
  { id: "mcp", label: "MCP", kind: "infra", x: 600, y: 70 },
  { id: "cloudflare", label: "Cloudflare DNS", kind: "infra", x: 155, y: 125 },
  { id: "hetzner", label: "Hetzner", kind: "infra", x: 175, y: 250 },
  { id: "caddy", label: "Reverse proxy", kind: "infra", x: 250, y: 465 },
  { id: "docker", label: "Docker", kind: "infra", x: 305, y: 610 },
  { id: "postgres", label: "Postgres", kind: "data", x: 450, y: 675 },
  { id: "redis", label: "Redis", kind: "data", x: 560, y: 700 },
  { id: "neo4j", label: "Neo4j", kind: "data", x: 680, y: 700 },
  { id: "history", label: "Historique", kind: "data", x: 840, y: 630 },
  { id: "files", label: "Fichiers", kind: "data", x: 940, y: 695 },
  { id: "voice", label: "Voix", kind: "data", x: 1050, y: 635 },
  { id: "oauth", label: "OAuth/JWT", kind: "security", x: 515, y: 292 },
  { id: "privateApi", label: "API privée", kind: "security", x: 700, y: 292 },
  { id: "secrets", label: "Secrets", kind: "security", x: 760, y: 390 },
  { id: "preflight", label: "Préflight", kind: "security", x: 505, y: 620 },
  { id: "capsule", label: "Capsule", kind: "security", x: 175, y: 590 },
  { id: "nossenBus", label: "@nossen/bus", kind: "module", x: 95, y: 460 },
  { id: "nossenMemory", label: "@nossen/graph", kind: "module", x: 265, y: 705 },
  { id: "nossenSecurity", label: "@nossen/security", kind: "module", x: 95, y: 715 },
  { id: "nossenMedia", label: "@nossen/media", kind: "module", x: 1010, y: 500 },
  { id: "nossenDragon", label: "@nossen/dragon", kind: "module", x: 1030, y: 82 },
  { id: "qflush", label: "Qflush", kind: "module", x: 1085, y: 445 },
  { id: "allInOne", label: "@nossen/all-in-one", kind: "module", x: 1120, y: 560 },
  { id: "github", label: "GitHub", kind: "publish", x: 960, y: 600 },
  { id: "npm", label: "npm", kind: "publish", x: 1120, y: 680 },
  { id: "jfrog", label: "JFrog possible", kind: "publish", x: 980, y: 730 },
] as const;

const FUNESTERIE_ARCHITECTURE_GRAPH_LINKS: ReadonlyArray<FunesterieGraphLink> = [
  { from: "cloudflare", to: "funesterie", label: "résout", kind: "route" },
  { from: "hetzner", to: "funesterie", label: "héberge", kind: "runtime" },
  { from: "caddy", to: "funesterie", label: "route", kind: "route" },
  { from: "funesterie", to: "home", label: "affiche", kind: "route" },
  { from: "funesterie", to: "account", label: "route", kind: "route" },
  { from: "funesterie", to: "agents", label: "route", kind: "route" },
  { from: "funesterie", to: "status", label: "observe", kind: "data" },
  { from: "funesterie", to: "contact", label: "contact", kind: "route" },
  { from: "agents", to: "a11", label: "ouvre", kind: "route" },
  { from: "agents", to: "k44", label: "ouvre", kind: "route" },
  { from: "agents", to: "vivy", label: "ouvre", kind: "route" },
  { from: "mcp", to: "a11", label: "coordonne", kind: "runtime" },
  { from: "mcp", to: "k44", label: "coordonne", kind: "runtime" },
  { from: "mcp", to: "vivy", label: "coordonne", kind: "runtime" },
  { from: "codex", to: "mcp", label: "pilote", kind: "runtime" },
  { from: "kiro", to: "mcp", label: "coordonne", kind: "runtime" },
  { from: "oauth", to: "account", label: "protège", kind: "guard" },
  { from: "oauth", to: "privateApi", label: "signe", kind: "guard" },
  { from: "privateApi", to: "a11", label: "autorise", kind: "guard" },
  { from: "privateApi", to: "k44", label: "autorise", kind: "guard" },
  { from: "privateApi", to: "vivy", label: "autorise", kind: "guard" },
  { from: "secrets", to: "privateApi", label: "reste serveur", kind: "guard" },
  { from: "docker", to: "a11", label: "isole", kind: "runtime" },
  { from: "docker", to: "k44", label: "isole", kind: "runtime" },
  { from: "docker", to: "vivy", label: "isole", kind: "runtime" },
  { from: "docker", to: "mcp", label: "exécute", kind: "runtime" },
  { from: "postgres", to: "privateApi", label: "persiste", kind: "data" },
  { from: "redis", to: "mcp", label: "cache", kind: "data" },
  { from: "neo4j", to: "mcp", label: "graphe", kind: "data" },
  { from: "history", to: "a11", label: "contexte", kind: "data" },
  { from: "files", to: "a11", label: "médias", kind: "data" },
  { from: "voice", to: "vivy", label: "voix", kind: "data" },
  { from: "preflight", to: "docker", label: "vérifie", kind: "guard" },
  { from: "capsule", to: "docker", label: "encapsule", kind: "guard" },
  { from: "nossenBus", to: "mcp", label: "module", kind: "runtime" },
  { from: "nossenMemory", to: "neo4j", label: "module", kind: "data" },
  { from: "nossenSecurity", to: "preflight", label: "module", kind: "guard" },
  { from: "nossenMedia", to: "a11", label: "module", kind: "data" },
  { from: "nossenDragon", to: "agents", label: "module", kind: "runtime" },
  { from: "qflush", to: "k44", label: "contrôle", kind: "runtime" },
  { from: "allInOne", to: "agents", label: "agrège", kind: "runtime" },
  { from: "github", to: "nossenBus", label: "source", kind: "publish" },
  { from: "github", to: "nossenMemory", label: "source", kind: "publish" },
  { from: "github", to: "nossenSecurity", label: "source", kind: "publish" },
  { from: "npm", to: "nossenBus", label: "publie", kind: "publish" },
  { from: "npm", to: "nossenMemory", label: "publie", kind: "publish" },
  { from: "npm", to: "nossenSecurity", label: "publie", kind: "publish" },
  { from: "jfrog", to: "nossenSecurity", label: "partenariat possible", kind: "publish" },
  { from: "jfrog", to: "allInOne", label: "distribution possible", kind: "publish" },
] as const;

const FUNESTERIE_ARCHITECTURE_CYPHER_LINES = [
  "MERGE (:Site {name:'funesterie.me'})-[:ROUTE]->(:Surface {name:'Agents'})",
  "MERGE (:Agent {name:'A11'})-[:USES]->(:Module {name:'@nossen/media'})",
  "MERGE (:MCP)-[:MAPS]->(:Data {name:'Neo4j'})",
  "MERGE (:PrivateAPI)-[:PROTECTED_BY]->(:Security {name:'OAuth/JWT'})",
  "MERGE (:Module {scope:'@nossen'})-[:PUBLISHED_TO]->(:Registry {name:'npm'})",
] as const;

function NossenCrewShowcase({
  id,
  eager = false,
}: {
  id?: string;
  eager?: boolean;
}) {
  return (
    <section id={id} className="nossen-crew-showcase" aria-label="Nossen Ride Crew">
      <img
        src={NOSSEN_CREW_SRC}
        alt="Nossen Ride Crew avec Vivy, Kaen44 et A11."
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    </section>
  );
}

const VIVY_STUDIO_VALID_VOICE_TOOLS = [
  "Voix Vivy officielle",
  "Voix Vivy chant",
  "Voix Vivy + référence privée",
  "Diagnostic module voix",
] as const;

function getFunesteriePublicNavItems(surfaceLinks: SurfaceLinks) {
  return [
    ["Accueil", surfaceLinks.home],
    ["Agents", surfaceLinks.agents],
    ["Architecture", surfaceLinks.architecture],
    ["État", surfaceLinks.cockpit],
    ["Compte", surfaceLinks.account],
    ["Contact", surfaceLinks.contact],
  ] as const;
}

function FunesteriePublicNav({
  surfaceLinks,
  brandLabel = "Funesterie",
  brandSubtitle,
  brandAvatarSrc,
  variant = "default",
}: {
  surfaceLinks: SurfaceLinks;
  brandLabel?: string;
  brandSubtitle?: string;
  brandAvatarSrc?: string;
  variant?: "default" | "agent";
}) {
  const navItems = getFunesteriePublicNavItems(surfaceLinks);
  const isAgentBar = variant === "agent";

  return (
    <nav className={`fun-home-nav fun-public-nav${isAgentBar ? " fun-public-nav--agent" : ""}`} aria-label="Navigation Funesterie">
      <a href={surfaceLinks.home} className="fun-home-brand" aria-label="Funesterie accueil">
        <img src={brandAvatarSrc || FUNESTERIE_LOGO_SRC} alt="" />
        <span className="fun-home-brand-text">
          <strong>{brandLabel}</strong>
          {brandSubtitle ? <small>{brandSubtitle}</small> : null}
        </span>
      </a>
      {isAgentBar ? (
        <details className="fun-public-menu">
          <summary>Menu</summary>
          <div className="fun-public-menu-panel">
            {navItems.map(([label, href]) => (
              <a key={label} href={href}>{label}</a>
            ))}
          </div>
        </details>
      ) : (
        <>
          <div className="fun-home-nav-links">
            {navItems.map(([label, href]) => (
              <a key={label} href={href}>{label}</a>
            ))}
          </div>
          <details className="fun-public-menu fun-public-menu--mobile">
            <summary>Menu</summary>
            <div className="fun-public-menu-panel">
              {navItems.map(([label, href]) => (
                <a key={label} href={href}>{label}</a>
              ))}
            </div>
          </details>
        </>
      )}
      {null}
    </nav>
  );
}

function FunesteriePublicFooter({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
}) {
  return (
    <footer id="contact" className="fun-home-footer fun-public-footer">
      <div className="fun-public-footer-legal" aria-label="Liens légaux Funesterie">
        <a href={surfaceLinks.privacy}>Confidentialité</a>
        <a href={surfaceLinks.terms}>Conditions</a>
        <a href={surfaceLinks.contact}>Contact</a>
      </div>
      <div className="fun-public-footer-session" aria-label="Session Funesterie">
        <span>{authenticated ? (displayName || "Connecté") : "Public"}</span>
        {authenticated ? (
          <button type="button" onClick={onLogout}>Se déconnecter</button>
        ) : (
          <a href={buildCentralLoginUrl(surfaceLinks.account)}>Se connecter</a>
        )}
      </div>
    </footer>
  );
}

type FunesterieServiceStatus = "checking" | "ok" | "down";

const FUNESTERIE_STATUS_META: Record<FunesterieServiceStatus, { label: string; detail: string }> = {
  checking: { label: "vérification", detail: "Test en cours" },
  ok: { label: "opérationnel", detail: "Joignable" },
  down: { label: "à vérifier", detail: "Non confirmé" },
};

function FunesterieHomeIntro({
  surfaceLinks,
  authenticated,
  displayName,
  onConnect,
  busy,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated: boolean;
  displayName: string;
  onConnect: () => void;
  busy: boolean;
}) {
  return (
    <section
      id="accueil"
      className="fun-home-hero fun-home-hero--nossen fun-home-hero--single"
      aria-label="Accueil NOSSEN Funesterie"
      style={{ width: "min(760px, calc(100vw - 20px))", maxWidth: "calc(100vw - 20px)" }}
    >
      <div className="fun-hero-core">
        <img
          src={FUNESTERIE_LOGO_SRC}
          alt="Funesterie"
          style={{ width: "min(100%, 520px)", maxWidth: "100%", height: "auto" }}
        />
        <p>
          Funesterie.me rassemble les agents, la voix persona, les outils NOSSEN et le mode versus
          pour créer, comprendre, connecter et jouer contre la machine sans perdre la main humaine.
        </p>
        <div className="fun-home-actions">
          <button type="button" onClick={onConnect} disabled={busy}>
            {busy ? "Connexion..." : authenticated ? (displayName || "Compte") : "Se connecter"}
          </button>
          <a href={surfaceLinks.agents}>Explorer les agents</a>
        </div>
      </div>
    </section>
  );
}

function FunesterieVoicePersonaPanel() {
  const [activePersona, setActivePersona] = useState<FunesterieSurface>("a11");
  const [voiceStatus, setVoiceStatus] = useState("Voix officielles prêtes: A11, Kaen44, Vivy.");
  const active = FUNESTERIE_VOICE_PERSONAS.find((persona) => persona.id === activePersona) || FUNESTERIE_VOICE_PERSONAS[0];

  function playPersonaVoice(persona: FunesterieVoicePersona) {
    setActivePersona(persona.id);
    setVoiceStatus(`Préparation de la voix ${persona.name}...`);
    void unlockAudioOutput().finally(() => {
      speak(persona.sample, {
        lang: "fr-FR",
        provider: "auto",
        voicePersona: persona.id,
        voiceStyle: persona.voiceStyle,
        voiceReferenceRequired: true,
        vocalMode: persona.id === "vivy" ? "adaptive" : "speech",
        voiceConversion: false,
        ttsTimeoutMs: 28000,
        onEnd: () => setVoiceStatus(`Voix ${persona.name} terminée.`),
        onError: () => setVoiceStatus(`Voix ${persona.name} indisponible sur ce navigateur pour l'instant.`),
      });
    });
  }

  return (
    <section id="voix" className="fun-voice-persona" aria-label="Voix persona Funesterie">
      <header className="fun-section-title">
        <span>Voix persona</span>
        <h2>A11, Kaen44 et Vivy parlent avec leur identité.</h2>
        <p>Le bouton teste la route TTS officielle avec persona et style dédiés, sans afficher de configuration sensible.</p>
      </header>
      <div className="fun-voice-layout">
        <div className={`fun-voice-stage fun-voice-stage--${active.tone}`}>
          <img src={active.image} alt="" loading="lazy" decoding="async" />
          <div>
            <span>{active.signal}</span>
            <strong>{active.name}</strong>
            <p>{active.sample}</p>
          </div>
        </div>
        <div className="fun-voice-grid">
          {FUNESTERIE_VOICE_PERSONAS.map((persona) => (
            <article
              key={persona.id}
              className={`fun-voice-card fun-voice-card--${persona.tone}${activePersona === persona.id ? " fun-voice-card--active" : ""}`}
            >
              <img src={persona.image} alt="" loading="lazy" decoding="async" />
              <div>
                <span>{persona.signal}</span>
                <h3>{persona.name}</h3>
                <p>{persona.role}</p>
                <small>{persona.detail}</small>
              </div>
              <button type="button" onClick={() => playPersonaVoice(persona)}>
                Tester la voix
              </button>
            </article>
          ))}
        </div>
      </div>
      <p className="fun-voice-status" aria-live="polite">{voiceStatus}</p>
    </section>
  );
}

function FunesterieVersusPanel() {
  const [agentId, setAgentId] = useState<FunesterieSurface>("a11");
  const [score, setScore] = useState({ user: 0, funesterie: 0 });
  const [round, setRound] = useState(1);
  const [battleLog, setBattleLog] = useState("Choisis un agent, puis lance un coup. Le prototype reste local et demande consentement avant tout contrôle réel.");
  const active = FUNESTERIE_VOICE_PERSONAS.find((persona) => persona.id === agentId) || FUNESTERIE_VOICE_PERSONAS[0];
  const leader = score.funesterie === score.user
    ? "Égalité"
    : score.funesterie > score.user
      ? "Funesterie.me mène"
      : "Utilisateur mène";

  function playMove(move: typeof FUNESTERIE_BATTLE_MOVES[number]) {
    setRound((value) => value + 1);
    setScore((value) => ({
      user: value.user + move.userDelta,
      funesterie: value.funesterie + move.funDelta,
    }));
    setBattleLog(`${active.name}: ${move.log}`);
  }

  function resetBattle() {
    setScore({ user: 0, funesterie: 0 });
    setRound(1);
    setBattleLog("Match remis à zéro. L'utilisateur garde le contrôle du lancement.");
  }

  return (
    <section id="missions" className="fun-versus-panel" aria-label="Affrontement jeu vidéo Funesterie">
      <div className="fun-versus-copy">
        <span>Mode versus</span>
        <h2>Funesterie.me vs utilisateur</h2>
        <p>
          Un sas jeu vidéo pour préparer les duels locaux: humain au contrôle, agent en adversaire,
          copilote ou analyste. Le pont Qflush/RomStation reste opt-in.
        </p>
        <div className="fun-versus-score" aria-label="Score du duel">
          <strong>{score.funesterie}</strong>
          <span>Funesterie.me</span>
          <i>VS</i>
          <span>Utilisateur</span>
          <strong>{score.user}</strong>
        </div>
      </div>

      <div className="fun-versus-arena">
        <div className="fun-versus-screen">
          <img src={active.image} alt="" loading="lazy" decoding="async" />
          <div className="fun-versus-hud">
            <span>Round {round}</span>
            <strong>{leader}</strong>
            <small>{battleLog}</small>
          </div>
        </div>
        <div className="fun-versus-controls" aria-label="Choix agent adversaire">
          {FUNESTERIE_VOICE_PERSONAS.map((persona) => (
            <button
              key={persona.id}
              type="button"
              className={agentId === persona.id ? "active" : ""}
              onClick={() => setAgentId(persona.id)}
            >
              {persona.name}
            </button>
          ))}
        </div>
        <div className="fun-versus-moves" aria-label="Actions duel">
          {FUNESTERIE_BATTLE_MOVES.map((move) => (
            <button key={move.id} type="button" onClick={() => playMove(move)}>
              {move.label}
            </button>
          ))}
          <button type="button" onClick={resetBattle}>Reset</button>
        </div>
      </div>
    </section>
  );
}

function FunesterieAgentsShowcase({ surfaceLinks }: { surfaceLinks: SurfaceLinks }) {
  return (
    <section id="agents" className="fun-home-agents" aria-label="Agents Funesterie">
      <div className="fun-home-agent-grid">
        {FUNESTERIE_HOME_AGENTS.map((agent) => (
          <a
            key={agent.id}
            className={`fun-home-agent-card fun-home-agent-card--${agent.tone} fun-home-agent-card--${agent.id}`}
            href={buildHomeAgentHref(agent.href, surfaceLinks)}
          >
            <img src={agent.image} alt="" loading="lazy" decoding="async" />
            <span className="fun-home-agent-copy">
              <strong>{agent.name}</strong>
              <small>{agent.role}</small>
              <span>{agent.text}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

type FunesterieProbeStatus = "checking" | "ok" | "down";

type FunesterieProbe = {
  id: string;
  label: string;
  detail: string;
  url: string;
};

const FUNESTERIE_PUBLIC_PROBES: FunesterieProbe[] = [
  { id: "public", label: "Funesterie public", detail: "Page et backend public", url: "/health" },
  { id: "a11", label: "A11", detail: "Agent média", url: "https://a11.funesterie.me/health" },
  { id: "kaen44", label: "Kaen44", detail: "Agent bureau", url: "https://k44.funesterie.me/health" },
  { id: "vivy", label: "Vivy", detail: "Surface musicale", url: "https://vivy.funesterie.me/health" },
  { id: "mcp", label: "MCP", detail: "Bus agents", url: "https://mcp.funesterie.me/health" },
];

async function probePublicEndpoint(url: string, timeoutMs = 4500): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = url.startsWith("/") ? url : url;
    const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
      mode: sameOrigin ? "same-origin" : "no-cors",
      signal: controller.signal,
    });
    return response.type === "opaque" || response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function FunesteriePublicStatusPage({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
  isAdmin = false,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
  isAdmin?: boolean;
}) {
  const [checks, setChecks] = useState<Record<string, FunesterieProbeStatus>>(() =>
    Object.fromEntries(FUNESTERIE_PUBLIC_PROBES.map((probe) => [probe.id, "checking"]))
  );
  const [checkedAt, setCheckedAt] = useState("");

  async function refresh() {
    setChecks(Object.fromEntries(FUNESTERIE_PUBLIC_PROBES.map((probe) => [probe.id, "checking"])));
    const results = await Promise.all(
      FUNESTERIE_PUBLIC_PROBES.map(async (probe) => [probe.id, await probePublicEndpoint(probe.url)] as const)
    );
    setChecks(Object.fromEntries(results.map(([id, ok]) => [id, ok ? "ok" : "down"])));
    setCheckedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  }

  useEffect(() => {
    if (!authenticated || !isAdmin) return;
    void refresh();
  }, [authenticated, isAdmin]);

  const values = Object.values(checks);
  const checking = values.some((status) => status === "checking");
  const allOk = !checking && values.every((status) => status === "ok");

  if (!authenticated || !isAdmin) {
    return (
      <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="État admin Funesterie">
        <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="État" />
        <section className="fun-token-panel fun-token-locked" aria-label="Accès admin requis">
          <header className="fun-token-head">
            <div>
              <span>Admin requis</span>
              <h2>État Funesterie</h2>
              <p>
                Les statuts MCP, connecteurs et contrôles techniques sont réservés au compte admin.
                Connecte-toi avec le login Funesterie central pour y accéder.
              </p>
            </div>
            <aside>
              <strong>Privé</strong>
              <small>{authenticated ? "admin requis" : "connexion"}</small>
            </aside>
          </header>
          <div className="fun-integration-actions">
            <a href={buildCentralLoginUrl(surfaceLinks.cockpit)}>Connexion admin</a>
            <a href={surfaceLinks.home}>Retour accueil</a>
          </div>
        </section>
        <FunesteriePublicFooter
          surfaceLinks={surfaceLinks}
          authenticated={authenticated}
          displayName={displayName}
          onLogout={onLogout}
        />
      </main>
    );
  }

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="État admin Funesterie">
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="État" />
      <section className="fun-status-public" aria-label="État Funesterie">
        <header className="fun-status-public-head">
          <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
          <div>
            <span>État admin</span>
            <h1>{checking ? "Vérification en cours" : allOk ? "Tout est fonctionnel" : "À vérifier"}</h1>
            <p>
              Statut des surfaces Funesterie et accès MCP réservés admin.
            </p>
          </div>
          <button type="button" onClick={() => void refresh()}>
            Vérifier
          </button>
        </header>
        <div className="fun-status-grid">
          {FUNESTERIE_PUBLIC_PROBES.map((probe) => {
            const status = checks[probe.id] || "checking";
            return (
              <article key={probe.id} className={`fun-status-card fun-status-card--${status}`}>
                <strong>{probe.label}</strong>
                <span>{probe.detail}</span>
                <small>{status === "checking" ? "test" : status === "ok" ? "fonctionnel" : "à vérifier"}</small>
              </article>
            );
          })}
        </div>
        <footer className="fun-status-public-foot">
          <span>{checkedAt ? `Dernier contrôle ${checkedAt}` : "Contrôle initial"}</span>
          <a href={surfaceLinks.account}>Compte</a>
        </footer>
      </section>
      <FunesterieMcpAdminPanel surfaceLinks={surfaceLinks} authenticated={authenticated} displayName={displayName} />
      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

type ConnectorProvider = "google" | "microsoft";

function readConnectorProvider(
  connectors: AuthConnectorsResponse | null,
  provider: ConnectorProvider
): AuthConnectorProviderState {
  return connectors?.connectors?.[provider] || {};
}

function connectorCardClass(providerState: AuthConnectorProviderState) {
  if (providerState.linked) return "fun-token-card fun-token-card--connected";
  if (providerState.configured === false) return "fun-token-card fun-token-card--warning";
  return "fun-token-card";
}

function connectorBadge(providerState: AuthConnectorProviderState, fallback = "OAuth") {
  if (providerState.linked) return "Connecté";
  if (providerState.configured === false) return "À configurer";
  return fallback;
}

function connectorActionLabel(providerState: AuthConnectorProviderState, busy: boolean, providerLabel: string) {
  if (busy) return "Connexion...";
  if (providerState.linked) return `${providerLabel} connecté`;
  if (providerState.configured === false) return "Configuration requise";
  return `Connecter ${providerLabel}`;
}

function connectorDescription(
  providerState: AuthConnectorProviderState,
  connectedText: string,
  fallbackText: string
) {
  if (providerState.linked) {
    const account = String(providerState.account || "").trim();
    return account ? `${connectedText} ${account}.` : connectedText;
  }
  if (providerState.configured === false) return "Configuration serveur incomplète pour ce connecteur.";
  return fallbackText;
}

function FunesterieMcpAdminPanel({
  surfaceLinks,
  authenticated,
  displayName,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated: boolean;
  displayName: string;
}) {
  const [mcpHealth, setMcpHealth] = useState<FunesterieProbeStatus>("checking");
  const [privateResult, setPrivateResult] = useState("Connecte-toi avec Google ou Microsoft pour vérifier le MCP privé.");
  const [busy, setBusy] = useState<"" | "google" | "microsoft" | "mcp">("");
  const [connectors, setConnectors] = useState<AuthConnectorsResponse | null>(null);
  const [connectorsStatus, setConnectorsStatus] = useState<"checking" | "ready" | "error">("checking");
  const [mcpAccount, setMcpAccount] = useState<McpAccountProfile | null>(null);
  const cockpitReturnTo = surfaceLinks.cockpit || "/cockpit/";
  const googleState = readConnectorProvider(connectors, "google");
  const microsoftState = readConnectorProvider(connectors, "microsoft");
  const accountTier = String(mcpAccount?.tier || "").trim();
  const accountLabel = mcpAccount?.label || (authenticated ? "Compte connecté" : "Non connecté");
  const accountFeatures = Array.isArray(mcpAccount?.features) ? mcpAccount.features.slice(0, 3) : [];
  const accountPermissionLine = !authenticated
    ? "Connexion Google ou Microsoft requise."
    : accountTier === "admin_family"
      ? "MCP privé et contrôles autorisés."
      : accountTier === "founder"
        ? "MCP privé, RomStation et connecteurs session autorisés."
        : accountTier === "premium"
          ? "MCP public avancé, statut et RomStation lecture."
          : "MCP public lecture seule.";

  async function refreshMcpHealth() {
    setMcpHealth("checking");
    setMcpHealth((await probePublicEndpoint("https://mcp.funesterie.me/health")) ? "ok" : "down");
  }

  async function refreshConnectors() {
    setConnectorsStatus("checking");
    try {
      const next = await fetchAuthConnectors();
      setConnectors(next);
      setConnectorsStatus("ready");
    } catch {
      setConnectors(null);
      setConnectorsStatus("error");
    }
  }

  async function refreshMcpAccount() {
    if (!authenticated) {
      setMcpAccount(null);
      return;
    }
    try {
      setMcpAccount(await fetchMcpCockpitAccount());
    } catch {
      setMcpAccount(null);
    }
  }

  useEffect(() => {
    void refreshMcpHealth();
    void refreshConnectors();
    void refreshMcpAccount();
  }, [authenticated]);

  async function testPrivateMcp() {
    if (!authenticated) {
      setPrivateResult("Connexion Google ou Microsoft requise pour vérifier le MCP privé.");
      return;
    }
    setBusy("mcp");
    setPrivateResult("Test en cours...");
    try {
      const status = await fetchMcpCockpitStatus();
      if (status.account) setMcpAccount(status.account);
      const activeAgents = Number(status.agents?.active || 0);
      const tierLabel = status.account?.label || mcpAccount?.label || "Compte MCP";
      const privateAllowed = status.account?.permissions?.privateMcpProxy === true;
      setPrivateResult(
        status.ok
          ? privateAllowed
            ? `MCP privé accessible (${tierLabel}). Agents actifs: ${activeAgents}.`
            : `Statut MCP accessible (${tierLabel}). Le privé complet reste réservé Fondateur/Admin famille.`
          : "MCP non validé avec ce compte."
      );
    } catch (error) {
      const payload = (error as { payload?: { account?: McpAccountProfile; required?: { minimumLabel?: string } } })?.payload;
      if (payload?.account) setMcpAccount(payload.account);
      const message = error instanceof Error ? error.message : "MCP privé indisponible.";
      const minimum = payload?.required?.minimumLabel ? ` Niveau requis: ${payload.required.minimumLabel}.` : "";
      setPrivateResult(`${message}${minimum}`);
    } finally {
      setBusy("");
    }
  }

  function connectGoogle() {
    setBusy("google");
    startGoogleOAuth(buildAuthSuccessReturnToForTarget(cockpitReturnTo), "funesterie-cockpit", { scopeProfile: "drive" });
  }

  function connectMicrosoft() {
    setBusy("microsoft");
    startMicrosoftOAuth(buildAuthSuccessReturnToForTarget(cockpitReturnTo), "funesterie-cockpit", { scopeProfile: "drive" });
  }

  async function handleDisconnectProvider(provider: "google" | "microsoft") {
    setBusy(provider);
    try {
      await disconnectConnector(provider);
      await refreshConnectors();
      await refreshMcpAccount();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="fun-mcp-admin" aria-label="Interface admin MCP">
      <header className="fun-mcp-admin-head">
        <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
        <div>
          <span>Compte admin</span>
          <h1>MCP Funesterie</h1>
          <p>{authenticated && displayName ? `${displayName} · ${accountLabel}` : "Interface de contrôle MCP, sans affichage de secret."}</p>
        </div>
        <button type="button" onClick={() => { void refreshMcpHealth(); void refreshConnectors(); void refreshMcpAccount(); }}>
          Rafraîchir
        </button>
      </header>

      <div className="fun-mcp-grid">
        <article className={`fun-status-card fun-status-card--${mcpHealth}`}>
          <strong>MCP public</strong>
          <span>https://mcp.funesterie.me/health</span>
          <small>{mcpHealth === "checking" ? "test" : mcpHealth === "ok" ? "fonctionnel" : "à vérifier"}</small>
        </article>
        <article className="fun-status-card fun-status-card--ok">
          <strong>Connecteurs publics</strong>
          <span>ChatGPT, Claude, Gemini, Grok</span>
          <small>routes séparées</small>
        </article>
        <article className="fun-status-card">
          <strong>Compte MCP</strong>
          <span>https://mcp.funesterie.me/mcp</span>
          <small>{accountFeatures.length ? accountFeatures.join(" · ") : accountPermissionLine}</small>
        </article>
      </div>

      <div className="fun-mcp-actions" aria-label="Actions compte">
        <article className={connectorCardClass(googleState)}>
          <header>
            <h3>Google</h3>
            <span>{connectorsStatus === "checking" ? "Test" : connectorBadge(googleState)}</span>
          </header>
          <p>{connectorDescription(googleState, "Google lié à", "Connexion compte et autorisations Google liées à la session Funesterie.")}</p>
          <footer>
            <button type="button" onClick={connectGoogle} disabled={busy === "google" || googleState.configured === false}>
              {connectorActionLabel(googleState, busy === "google", "Google")}
            </button>
            {googleState.linked && (
              <button type="button" onClick={() => handleDisconnectProvider("google")} disabled={busy === "google"} style={{ marginLeft: "8px" }}>
                Délier
              </button>
            )}
          </footer>
        </article>
        <article className={connectorCardClass(microsoftState)}>
          <header>
            <h3>Microsoft</h3>
            <span>{connectorsStatus === "checking" ? "Test" : connectorBadge(microsoftState)}</span>
          </header>
          <p>{connectorDescription(microsoftState, "Microsoft lié à", "Connexion Microsoft pour compte, OneDrive et outils de travail.")}</p>
          <footer>
            <button type="button" onClick={connectMicrosoft} disabled={busy === "microsoft" || microsoftState.configured === false}>
              {connectorActionLabel(microsoftState, busy === "microsoft", "Microsoft")}
            </button>
            {microsoftState.linked && (
              <button type="button" onClick={() => handleDisconnectProvider("microsoft")} disabled={busy === "microsoft"} style={{ marginLeft: "8px" }}>
                Délier
              </button>
            )}
          </footer>
        </article>
        <article className="fun-token-card">
          <header>
            <h3>NOSSEN</h3>
            <span>npm</span>
          </header>
          <p>Paquets publics @nossen et surface packages Funesterie.</p>
          <footer>
            <a href="https://www.npmjs.com/search?q=%40nossen" target="_blank" rel="noreferrer">
              Voir @nossen
            </a>
          </footer>
        </article>
        <article className="fun-token-card">
          <header>
            <h3>État</h3>
            <span>État</span>
          </header>
          <p>Contrôle admin des services exposés.</p>
          <footer>
            <a href={surfaceLinks.cockpit}>Voir l'état</a>
          </footer>
        </article>
      </div>

      <div className="fun-mcp-console">
        <div className="fun-integration-actions">
          <button type="button" onClick={() => void testPrivateMcp()} disabled={busy === "mcp"}>
            {busy === "mcp" ? "Vérification..." : "Vérifier MCP privé"}
          </button>
          <a href="https://mcp.funesterie.me/chatgpt/mcp" target="_blank" rel="noreferrer">MCP public</a>
          <a href="https://mcp.funesterie.me/.well-known/oauth-protected-resource/mcp" target="_blank" rel="noreferrer">OAuth</a>
        </div>
        <p>{privateResult}</p>
      </div>
    </section>
  );
}

function FunesterieConnectedHomePage({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
  isAdmin = false,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
  isAdmin?: boolean;
}) {
  const [accountBusy, setAccountBusy] = useState<"" | "google">("");
  const { pathname } = getLocationSnapshot();
  const isAgentsRoute = /^\/agents(?:\/|$)/.test(pathname);
  const isStatusRoute = /^\/cockpit(?:\/|$)/.test(pathname);
  if (isStatusRoute) {
    return (
      <FunesteriePublicStatusPage
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
        isAdmin={isAdmin}
      />
    );
  }

  const routeMeta = isAgentsRoute
    ? {
      brand: "Agents",
      title: "Agents",
      subtitle: "Chaque agent garde sa spécialité dans la surface Funesterie.",
      blocks: FUNESTERIE_HOME_AGENTS.map((agent) => [
        agent.name,
        `${agent.role}. ${agent.text}`,
      ] as const),
    }
    : isStatusRoute
      ? {
        brand: "État",
        title: "État",
        subtitle: "Vue admin des surfaces fonctionnelles.",
        blocks: [
          ["Funesterie.me", "Surface publique active."],
          ["A11", "Agent média disponible."],
          ["Kaen44", "Agent bureau accessible depuis sa route dédiée."],
          ["Vivy", "Présence musicale accessible depuis sa route dédiée."],
        ] as const,
      }
      : {
        brand: "Funesterie",
        title: "Funesterie",
        subtitle: "NOSSEN ride crew : créer, comprendre, connecter.",
        blocks: [
          ["Accueil", "Point d'entrée public du projet NOSSEN."],
          ["Agents", "Vivy, A11 et Kaen44 restent visibles sans changer de charte."],
          ["État", "Surveillance courte intégrée à l'interface Funesterie."],
          ["Compte", "Accès personnels et connexions privées."],
        ] as const,
      };

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash) return;
    const { pathname } = getLocationSnapshot();
    const sectionId = /^\/agents(?:\/|$)/.test(pathname) ? "agents" : "";
    if (!sectionId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    });
  }, []);

  function startHomeGoogle() {
    if (authenticated) {
      window.location.assign(surfaceLinks.account);
      return;
    }
    setAccountBusy("google");
    startGoogleOAuth(buildAuthSuccessReturnToForTarget(surfaceLinks.cockpit), "funesterie-home", { scopeProfile: "basic" });
  }

  if (!isAgentsRoute && !isStatusRoute) {
    return (
      <main id="top" className="fun-home-shell fun-public-surface fun-home-shell--landing" aria-label="Accueil Funesterie">
        <FunesteriePublicNav surfaceLinks={surfaceLinks} />
        <FunesterieHomeIntro
          surfaceLinks={surfaceLinks}
          authenticated={authenticated}
          displayName={displayName}
          onConnect={startHomeGoogle}
          busy={Boolean(accountBusy)}
        />
        <FunesteriePublicFooter
          surfaceLinks={surfaceLinks}
          authenticated={authenticated}
          displayName={displayName}
          onLogout={onLogout}
        />
      </main>
    );
  }

  if (isAgentsRoute) {
    return (
      <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="Agents Funesterie">
        <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="Agents" />
        <FunesterieAgentsShowcase surfaceLinks={surfaceLinks} />
        <FunesteriePublicFooter
          surfaceLinks={surfaceLinks}
          authenticated={authenticated}
          displayName={displayName}
          onLogout={onLogout}
        />
      </main>
    );
  }

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="Accueil Funesterie connecté">
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel={routeMeta.brand} />

      <section id={isAgentsRoute ? "agents" : isStatusRoute ? "etat" : undefined} className="fun-account-panel" aria-label={`${routeMeta.title} Funesterie`}>
        <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
        <div className="fun-account-copy">
          <h1>{routeMeta.title}</h1>
          <p>{routeMeta.subtitle}</p>
        </div>
        <div className="fun-account-grid">
          {routeMeta.blocks.map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </article>
          ))}
        </div>
      </section>

      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

function FunesterieArchitectureGraph() {
  const nodeById = useMemo(() => {
    return new Map(FUNESTERIE_ARCHITECTURE_GRAPH_NODES.map((node) => [node.id, node]));
  }, []);
  const graphNodeCount = FUNESTERIE_ARCHITECTURE_GRAPH_NODES.length;
  const graphLinkCount = FUNESTERIE_ARCHITECTURE_GRAPH_LINKS.length;

  return (
    <section className="fun-architecture-graph-panel" aria-label="Graphe Neo4j Funesterie">
      <header>
        <div>
          <span>Graphe Cypher public</span>
          <h2>Les liaisons vivantes</h2>
        </div>
        <strong className="fun-architecture-graph-count">
          <span>{graphNodeCount} nœuds</span>
          <span>{graphLinkCount} liaisons</span>
        </strong>
      </header>
      <div className="fun-architecture-graph-stage" role="img" aria-label="Graphe des liaisons entre site, agents IA, données, modules et sécurité">
        <svg viewBox="0 0 1200 780" aria-hidden="true">
          <defs>
            <filter id="fun-graph-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className="fun-graph-links">
            {FUNESTERIE_ARCHITECTURE_GRAPH_LINKS.map((link, index) => {
              const from = nodeById.get(link.from);
              const to = nodeById.get(link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${link.from}-${link.to}-${link.label}`}
                  className={`fun-graph-link fun-graph-link--${link.kind}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <title>{`${from.label} -[${link.label}]-> ${to.label}`}</title>
                </line>
              );
            })}
          </g>
          <g className="fun-graph-nodes">
            {FUNESTERIE_ARCHITECTURE_GRAPH_NODES.map((node, index) => (
              <g
                key={node.id}
                className={`fun-graph-node fun-graph-node--${node.kind}`}
                transform={`translate(${node.x} ${node.y})`}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <circle r={node.kind === "core" ? 42 : 27} />
                <text y={node.kind === "core" ? 6 : 5}>{node.label}</text>
                <title>{`${node.label} · ${node.kind}`}</title>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="fun-architecture-graph-legend" aria-label="Légende du graphe">
        {(["surface", "agent", "infra", "data", "module", "security", "publish"] as FunesterieGraphKind[]).map((kind) => (
          <span key={kind} className={`fun-graph-legend-item fun-graph-legend-item--${kind}`}>
            {kind === "surface" ? "Surfaces" : kind === "agent" ? "Agents" : kind === "infra" ? "Infra" : kind === "data" ? "Data" : kind === "module" ? "Modules" : kind === "security" ? "Sécurité" : "Publication"}
          </span>
        ))}
      </div>
      <pre className="fun-architecture-cypher" aria-label="Exemples Cypher publics">
        {FUNESTERIE_ARCHITECTURE_CYPHER_LINES.join("\n")}
      </pre>
    </section>
  );
}

function FunesterieArchitecturePage({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
}) {
  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell fun-architecture-shell" aria-label="Architecture Funesterie">
      <FunesteriePublicNav
        surfaceLinks={surfaceLinks}
      />

      <section className="fun-architecture-hero" aria-label="Résumé architecture Funesterie">
        <div className="fun-architecture-hero-copy">
          <h1>Architecture Funesterie</h1>
          <p>
            Un graphe public pour voir comment funesterie.me relie le site,
            les agents IA, les données, les modules NOSSEN, l'infrastructure et la sécurité.
          </p>
          <div className="fun-architecture-actions">
            <a href={surfaceLinks.agents}>Voir les agents</a>
            <a href="https://www.npmjs.com/search?q=%40nossen" target="_blank" rel="noreferrer">Modules @nossen</a>
            <a href={surfaceLinks.contact}>Contact</a>
          </div>
        </div>
        <div className="fun-architecture-hero-mark" aria-label="Identité Funesterie">
          <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
          <strong>funesterie.me</strong>
          <span>site public, agents IA et modules reliés proprement</span>
        </div>
      </section>

      <FunesterieArchitectureGraph />

      <section className="fun-architecture-map" aria-label="Carte des liaisons Funesterie">
        <div className="fun-architecture-core">
          <span>Centre</span>
          <strong>funesterie.me</strong>
          <p>Point d'entrée public. Les routes visibles restent lisibles, les actions sensibles restent protégées.</p>
        </div>
        {FUNESTERIE_ARCHITECTURE_CLUSTERS.map((cluster) => (
          <article key={cluster.id} className={`fun-architecture-cluster fun-architecture-cluster--${cluster.tone}`}>
            <header>
              <span>{cluster.title}</span>
              <p>{cluster.summary}</p>
            </header>
            <ul>
              {cluster.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="fun-architecture-proof-grid" aria-label="Frontières de sécurité">
        {FUNESTERIE_ARCHITECTURE_GUARDS.map(([title, text]) => (
          <article key={title}>
            <strong>{title}</strong>
            <span>{text}</span>
          </article>
        ))}
      </section>

      <section className="fun-architecture-flow" aria-label="Flux de fonctionnement">
        <header>
          <span>Lecture rapide</span>
          <h2>Du site au graphe</h2>
        </header>
        <ol>
          {FUNESTERIE_ARCHITECTURE_FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

function FunesterieIntegrationPanel({
  surfaceLinks,
  authenticated,
  displayName,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated: boolean;
  displayName: string;
}) {
  const [busy, setBusy] = useState<"" | "google" | "microsoft">("");
  const accountReturnTo = surfaceLinks.account || "/compte/";
  const accountLabel = String(displayName || "Compte connecté").trim();

  function connectGoogle() {
    setBusy("google");
    startGoogleOAuth(buildAuthSuccessReturnToForTarget(accountReturnTo), "funesterie-account", { scopeProfile: "drive" });
  }

  function connectMicrosoft() {
    setBusy("microsoft");
    startMicrosoftOAuth(buildAuthSuccessReturnToForTarget(accountReturnTo), "funesterie-account", { scopeProfile: "drive" });
  }

  if (!authenticated) {
    return (
      <section className="fun-token-panel fun-token-locked" aria-label="Connexions privées Funesterie verrouillées">
        <header className="fun-token-head">
          <div>
            <span>Connexion requise</span>
            <h2>Connexions privées</h2>
            <p>
              Les accès personnels ne sont pas affichés sur la page publique. Connecte-toi avec
              Google ou Microsoft pour relier tes outils aux agents.
            </p>
          </div>
          <aside>
            <strong>Privé</strong>
            <small>verrouillé</small>
          </aside>
        </header>
        <div className="fun-integration-actions">
          <button type="button" onClick={connectGoogle} disabled={busy === "google"}>
            {busy === "google" ? "Connexion..." : "Google"}
          </button>
          <button type="button" onClick={connectMicrosoft} disabled={busy === "microsoft"}>
            {busy === "microsoft" ? "Connexion..." : "Microsoft"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fun-token-panel" aria-label="Connexions privées Funesterie">
      <header className="fun-token-head">
        <div>
          <span>Compte connecté</span>
          <h2>Connexions utilisateur</h2>
          <p>
            Les secrets techniques restent côté serveur. Ici on prépare seulement les accès liés à
            ta session pour travailler avec les agents, le code local et les paquets NOSSEN.
          </p>
        </div>
        <aside>
          <strong>Privé</strong>
          <small>{accountLabel}</small>
        </aside>
      </header>

      <div className="fun-integration-grid">
        <article className="fun-token-card">
          <header>
            <h3>Google</h3>
            <span>OAuth</span>
          </header>
          <p>Compte, Drive, fichiers et validations Google rattachés à ta session.</p>
          <footer>
            <button type="button" onClick={connectGoogle} disabled={busy === "google"}>
              {busy === "google" ? "Connexion..." : "Connecter Google"}
            </button>
          </footer>
        </article>

        <article className="fun-token-card">
          <header>
            <h3>Microsoft</h3>
            <span>OAuth</span>
          </header>
          <p>Compte Microsoft, OneDrive et outils de travail liés au profil connecté.</p>
          <footer>
            <button type="button" onClick={connectMicrosoft} disabled={busy === "microsoft"}>
              {busy === "microsoft" ? "Connexion..." : "Connecter Microsoft"}
            </button>
          </footer>
        </article>

        <article className="fun-token-card">
          <header>
            <h3>GitHub / npm</h3>
            <span>NOSSEN</span>
          </header>
          <p>Paquets et modules à consommer côté dev, sans afficher les tokens admin.</p>
          <footer>
            <a href="https://www.npmjs.com/search?q=%40nossen" target="_blank" rel="noreferrer">
              Voir @nossen
            </a>
          </footer>
        </article>

        <article className="fun-token-card">
          <header>
            <h3>Agents locaux</h3>
            <span>Coffre local</span>
          </header>
          <p>Usage local avec QFlush, CLI et stockage côté machine quand disponible.</p>
          <footer>
            <a href={surfaceLinks.cockpit}>Voir l'état</a>
          </footer>
        </article>
      </div>
    </section>
  );
}

function readFunesterieAccountOverview() {
  if (typeof window === "undefined") {
    return { conversations: 0, files: 0, vivyMessages: 0, voiceReference: "Non configurée" };
  }

  const scope = getAuthStorageScope();
  const chatKeys = Array.from(new Set([
    ...FUNESTERIE_CHAT_SURFACES.flatMap((surface) => [
      buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope, surface),
      buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, "", surface),
    ]),
    buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope),
    CHAT_STORAGE_KEY_PREFIX,
  ]));
  let conversations = 0;
  let files = 0;
  for (const key of chatKeys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      conversations += parsed.length;
      files += parsed.reduce((count: number, chat: any) => {
        const messages = Array.isArray(chat?.messages) ? chat.messages : [];
        return count + messages.filter((message: any) => message?.fileUrl || message?.imageUrl || message?.videoUrl).length;
      }, 0);
    } catch {
      // Ignore malformed client cache.
    }
  }

  let vivyMessages = 0;
  try {
    const vivyRaw = window.localStorage.getItem(VIVY_PUBLIC_CHAT_KEY);
    const vivyParsed = vivyRaw ? JSON.parse(vivyRaw) : [];
    vivyMessages = Array.isArray(vivyParsed) ? vivyParsed.length : 0;
  } catch {
    vivyMessages = 0;
  }

  const voiceReference = (() => {
    try {
      return (["a11", "kaen44", "vivy"] as FunesterieSurface[])
        .some((surface) => Boolean(readStoredVoiceReferenceId(surface)))
        ? "Configurée"
        : "Non configurée";
    } catch {
      return "Non configurée";
    }
  })();

  return { conversations, files, vivyMessages, voiceReference };
}

function FunesterieAccountPage({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
}) {
  const overview = useMemo(() => readFunesterieAccountOverview(), [authenticated, displayName]);
  const openWithSession = (event: React.MouseEvent<HTMLButtonElement>, targetUrl: string) => {
    event.preventDefault();
    if (typeof window === "undefined") return;
    window.location.assign(buildSessionBridgeUrl(targetUrl));
  };

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="Compte Funesterie">
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="Compte" />
      <section className="fun-account-panel" aria-label="Réglages compte Funesterie">
        <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
        <div className="fun-account-copy">
          <h1>Compte</h1>
          <p>{authenticated ? (displayName || "Compte connecté") : "Connecte-toi pour gérer ton compte Funesterie."}</p>
        </div>
        <div className="fun-account-grid">
          <article>
            <strong>Profil</strong>
            <span>{authenticated ? "Compte connecté" : "Compte non connecté"}</span>
          </article>
          <article>
            <strong>Historique</strong>
            <span>{overview.conversations} conversation{overview.conversations > 1 ? "s" : ""} locale{overview.conversations > 1 ? "s" : ""}</span>
          </article>
          <article>
            <strong>Fichiers</strong>
            <span>{overview.files} média/fichier en cache local</span>
          </article>
          <article>
            <strong>Voix</strong>
            <span>{overview.voiceReference}</span>
          </article>
        </div>
      </section>

      <section className="fun-token-panel" aria-label="Actions compte">
        <header className="fun-token-head">
          <div>
            <span>Réglages</span>
            <h2>Accès et données</h2>
            <p>Gestion courte du compte, des conversations locales et des fichiers liés aux agents.</p>
          </div>
          <aside>
            <strong>{authenticated ? "Privé" : "Public"}</strong>
            <small>{authenticated ? (displayName || "connecté") : "connexion requise"}</small>
          </aside>
        </header>
        <div className="fun-integration-grid">
          <article className="fun-token-card">
            <header>
              <h3>Connexion</h3>
              <span>Compte</span>
            </header>
            <p>Connexion Funesterie centrale pour A11, Kaen44 et Vivy.</p>
            <footer>
              {authenticated ? (
                <button type="button" onClick={onLogout}>Se déconnecter</button>
              ) : (
                <a href={buildCentralLoginUrl(surfaceLinks.account)}>Se connecter</a>
              )}
            </footer>
          </article>
          <article className="fun-token-card">
            <header>
              <h3>Conversations</h3>
              <span>Historique</span>
            </header>
            <p>{overview.conversations} conversation{overview.conversations > 1 ? "s" : ""} détectée{overview.conversations > 1 ? "s" : ""} côté navigateur.</p>
            <footer>
              <button type="button" onClick={(event) => openWithSession(event, surfaceLinks.a11Cockpit)}>Ouvrir A11</button>
            </footer>
          </article>
          <article className="fun-token-card">
            <header>
              <h3>Fichiers</h3>
              <span>Ressources</span>
            </header>
            <p>{overview.files} ressource{overview.files > 1 ? "s" : ""} locale{overview.files > 1 ? "s" : ""}; Vivy: {overview.vivyMessages} message{overview.vivyMessages > 1 ? "s" : ""}.</p>
            <footer>
              <button type="button" onClick={(event) => openWithSession(event, surfaceLinks.vivy)}>Ouvrir Vivy</button>
            </footer>
          </article>
          <article className="fun-token-card">
            <header>
              <h3>Préférences</h3>
              <span>Local</span>
            </header>
            <p>Voix, langue et réglages restent dans le navigateur quand ils ne nécessitent pas serveur.</p>
            <footer>
              <button type="button" onClick={(event) => openWithSession(event, surfaceLinks.kaen44Cockpit)}>Ouvrir K44</button>
            </footer>
          </article>
        </div>
      </section>
      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

function FunesterieContactPage({
  surfaceLinks,
  authenticated = false,
  displayName = "",
  onLogout,
}: {
  surfaceLinks: SurfaceLinks;
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
}) {
  const contactLinks = [
    ["Email", "funeste38@gmail.com", "mailto:funeste38@gmail.com"],
    ["GitHub", "Organisation Funesterie", "https://github.com/Funesterie"],
    ["Dons", "PayPal Funesterie", "https://paypal.me/funeste38"],
    ["Packages", "GitHub Packages / GHCR", "https://github.com/orgs/Funesterie/packages"],
    ["npm", "Packages @nossen", "https://www.npmjs.com/search?q=%40nossen"],
  ] as const;

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="Contact Funesterie">
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="Contact" />

      <section className="fun-account-panel fun-contact-hero" aria-label="Contact Funesterie">
        <img src={NOSSEN_DJEFF_BETA_SRC} alt="Djeff, rider origine NOSSEN" />
        <div className="fun-contact-content">
          <div className="fun-account-copy">
            <h1>Contact</h1>
            <p>Djeff, rider origine. Contact officiel Funesterie / NOSSEN.</p>
          </div>
          <div className="fun-account-grid fun-contact-links">
            {contactLinks.map(([label, text, href]) => (
              <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
                <strong>{label}</strong>
                <span>{text}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="fun-package-panel" aria-label="Modules NOSSEN">
        <header>
          <span>Modules</span>
          <h2>NOSSEN</h2>
        </header>
        <div className="fun-package-grid">
          {NOSSEN_PUBLIC_PACKAGES.map((packageName) => (
            <a key={packageName} href={buildNpmPackageUrl(packageName)} target="_blank" rel="noreferrer">
              {packageName}
            </a>
          ))}
        </div>
      </section>

      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

function ResetPasswordPanel() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!token) {
      setError("Token manquant dans l'URL");
      return;
    }
    if (password.length < 4) {
      setError("Mot de passe trop court");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message || "Reinitialisation impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", width: "100%", padding: "24px 16px calc(24px + env(safe-area-inset-bottom))", boxSizing: "border-box", gap: "20px" }}>
      <h1>Reinitialiser le mot de passe</h1>
      <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: "12px", width: "min(100%, 340px)" }}>
        <input
          id="reset-password"
          name="password"
          type="password"
          placeholder="Nouveau mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          style={{ padding: "10px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
        />
        <input
          id="reset-confirm-password"
          name="confirmPassword"
          type="password"
          placeholder="Confirmer le mot de passe"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
          style={{ padding: "10px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            borderRadius: "4px",
            border: "none",
            background: "#16a34a",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          {loading ? "Réinitialisation..." : "Valider"}
        </button>
        {error && <div style={{ color: "red", fontSize: "14px" }}>{error}</div>}
        {success && (
          <div style={{ color: "#22c55e", fontSize: "14px" }}>
            Mot de passe modifie. Tu peux revenir sur la page de connexion.
          </div>
        )}
      </form>
    </div>
  );
}
// MuteButton : contrôle global du son
function MuteButton({ showLabel = false, fullWidth = false }: { showLabel?: boolean; fullWidth?: boolean }) {
  const [muted, setMuted] = useState(isSpeechMuted());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('a11:muted');
      if (saved === '1') setMuted(true);
    } catch {
      // ignore storage access errors
    }
  }, []);

  useEffect(() => {
    setSpeechMuted(muted);
    if (muted) {
      cancelSpeech();
    }

    try {
      localStorage.setItem('a11:muted', muted ? '1' : '0');
    } catch {
      // ignore storage access errors
    }
  }, [muted]);

  return (
    <button
      onClick={() => setMuted(m => !m)}
      title={muted ? "Retablir la voix d'A11" : "Couper la voix d'A11"}
      style={{
        fontSize: showLabel ? 13 : 20,
        padding: showLabel ? "10px 12px" : 6,
        width: showLabel ? (fullWidth ? "100%" : "auto") : 38,
        height: showLabel ? "auto" : 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: showLabel ? "flex-start" : 'center',
        gap: showLabel ? 10 : 0,
        borderRadius: 10,
      }}
      className="btn ghost"
    >
      {muted ? (
        <span aria-label="Sortie coupee">Off</span>
      ) : (
        <span aria-label="Sortie automatique">On</span>
      )}
      {showLabel ? <span>{muted ? "Sortie coupee" : "Sortie auto"}</span> : null}
    </button>
  );
}

function FunesterieLegalPage({
  surfaceLinks,
  kind,
  authenticated = false,
  displayName = "",
  onLogout,
}: {
  surfaceLinks: SurfaceLinks;
  kind: "privacy" | "terms";
  authenticated?: boolean;
  displayName?: string;
  onLogout?: () => void;
}) {
  const isPrivacy = kind === "privacy";
  const blocks = isPrivacy
    ? ([
      ["Données", "Comptes, messages et fichiers autorisés par l'utilisateur."],
      ["Drive", "Accès Google Drive et Microsoft OneDrive limité aux fichiers choisis ou validés."],
      ["Agents", "A11, Kaen44 et Vivy traitent le contexte nécessaire."],
      ["Retrait", "Les accès peuvent être retirés depuis le compte Google ou Microsoft."],
    ] as const)
    : ([
      ["Usage", "Assistance documents, création, voix, projets et coordination."],
      ["Microsoft", "Connexion Microsoft Graph et OneDrive limitée aux droits validés par l'utilisateur."],
      ["Limites", "Actions sensibles, paiements et suppressions demandent validation."],
      ["Contenus", "Les publications doivent être originales ou autorisées."],
      ["Compte", "L'utilisateur garde la responsabilité des validations finales."],
    ] as const);

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label={isPrivacy ? "Confidentialité Funesterie" : "Conditions Funesterie"}>
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel={isPrivacy ? "Confidentialité" : "Conditions"} />

      <section className="fun-account-panel" aria-label={isPrivacy ? "Confidentialité Funesterie" : "Conditions Funesterie"}>
        <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
        <div className="fun-account-copy">
          <h1>{isPrivacy ? "Confidentialité" : "Conditions"}</h1>
          <p>{isPrivacy ? "Règles de données Funesterie / NOSSEN." : "Conditions d'utilisation Funesterie / NOSSEN."}</p>
        </div>
        <div className="fun-account-grid">
          {blocks.map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </article>
          ))}
        </div>
      </section>

      <FunesteriePublicFooter
        surfaceLinks={surfaceLinks}
        authenticated={authenticated}
        displayName={displayName}
        onLogout={onLogout}
      />
    </main>
  );
}

function Kaen44ModulesPanel({
  isCompactLayout,
  onBackToChat,
  onOpenStudio,
  onOpenAccount,
  onQuickPrompt,
}: {
  isCompactLayout: boolean;
  onBackToChat: () => void;
  onOpenStudio: () => void;
  onOpenAccount: () => void;
  onQuickPrompt: (prompt: string) => void;
}) {
  const services = [
    ["Documents", "Traiter un document", "Je veux traiter un document."],
    ["Factures", "Préparer une facture", "Je veux préparer une facture."],
    ["Voix", "Dicter ou transcrire", "Je veux dicter ou transcrire un audio."],
    ["Aide", "Demander un renfort", "J'ai besoin d'aide sur une tâche."],
  ];

  return (
    <section className="kaen-modules-panel kaen-services-panel">
      <div className="kaen-modules-hero kaen-services-hero" style={{ padding: isCompactLayout ? 16 : 22 }}>
        <div className="kaen-services-copy">
          <h2 style={{ fontSize: isCompactLayout ? 28 : 34 }}>Accès rapide</h2>
          <div className="kaen-services-actions">
            <button type="button" className="kaen-service-primary" onClick={onBackToChat}>
              Message
            </button>
            <button type="button" className="kaen-service-secondary" onClick={onOpenStudio}>
              Studio
            </button>
            <button type="button" className="kaen-service-secondary" onClick={onOpenAccount}>
              Compte
            </button>
          </div>
        </div>
      </div>
      <div className="kaen-services-grid" style={{ gridTemplateColumns: isCompactLayout ? "1fr" : "repeat(2, minmax(0, 1fr))" }}>
        {services.map(([title, action, prompt], index) => (
          <button key={title} type="button" className="kaen-module-card kaen-service-card-button" onClick={() => onQuickPrompt(prompt)}>
            <div className="kaen-service-number">{String(index + 1).padStart(2, "0")}</div>
            <h3>{title}</h3>
            <p>{action}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

type PersonaDashboardProps = {
  isKaen44: boolean;
  displayName: string;
  currentConversationId: string | null;
  messageCount: number;
  resourceCount: number;
  activityCount: number;
  onStartChat: () => void;
  onOpenAdmin: () => void;
  onOpenStudio: () => void;
  onOpenInspector: () => void;
};

function PersonaDashboard({
  isKaen44,
  displayName: _displayName,
  currentConversationId: _currentConversationId,
  messageCount: _messageCount,
  resourceCount: _resourceCount,
  activityCount: _activityCount,
  onStartChat,
  onOpenAdmin,
  onOpenStudio,
  onOpenInspector,
}: PersonaDashboardProps) {
  const currentAgent = isKaen44
    ? {
      name: "Kaen44",
      role: "Agent bureau",
      text: "Accueil, suivi, organisation et interface quotidienne pour garder le travail clair.",
      image: NOSSEN_K44_TZR_SRC,
      alt: "Kaen44, agent bureau NOSSEN",
    }
    : {
      name: "A11",
      role: "Agent média",
      text: "Prépare les médias, les documents, les résumés et les signaux utiles.",
      image: NOSSEN_A11_DERBI_SRC,
      alt: "A11, agent média NOSSEN",
    };

  return (
    <section
      className={`k44-agent-strip-panel k44-agent-profile k44-agent-profile--${isKaen44 ? "kaen44" : "a11"}`}
      aria-label={`${currentAgent.name} - ${currentAgent.role}`}
    >
      <div className="k44-agent-current">
        <img src={currentAgent.image} alt={currentAgent.alt} />
        <div>
          <p>{currentAgent.text}</p>
        </div>
      </div>
    </section>
  );
}

export function App() {
  type AdminSection = "cockpit" | "memory" | "runtime" | "console" | "ai" | "subscription";
  type AppView = "chat" | "admin" | "casino";
  const surfaceKind = getCurrentSurfaceKind();
  syncStoredSurface(surfaceKind);
  const isKaen44 = surfaceKind === "kaen44";
  const isVivy = surfaceKind === "vivy";
  const isGeneralCockpit = isGeneralCockpitRoute();
  const isGeneralHome = isGeneralHomeRoute();
  const isGeneralAgents = isGeneralAgentsRoute();
  const isGeneralArchitecture = isGeneralArchitectureRoute();
  const isGeneralAccount = isGeneralAccountRoute();
  const isGeneralContact = isGeneralContactRoute();
  const isGeneralPrivacy = isGeneralPrivacyRoute();
  const isGeneralTerms = isGeneralTermsRoute();
  const isGeneralLogin = isGeneralLoginRoute();
  const isFunesteriePublicShell = isGeneralCockpit
    || isGeneralHome
    || isGeneralAgents
    || isGeneralArchitecture
    || isGeneralAccount
    || isGeneralContact
    || isGeneralPrivacy
    || isGeneralTerms
    || isGeneralLogin;
  const productName = isKaen44 ? "Kaen44" : "A11";
  const surfaceLinks = getSurfaceLinks();
  const agentShortcuts = useMemo(() => getFunesterieAgentShortcuts(surfaceLinks), [surfaceLinks]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authSessionReady, setAuthSessionReady] = useState(false);
  const [isFunesterieAdmin, setIsFunesterieAdmin] = useState(false);
  const [isResetRoute, setIsResetRoute] = useState(false);
  const [displayName, setDisplayName] = useState(() => getAuthDisplayName() || "Utilisateur");
  const [showHistory, setShowHistory] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "sys-1",
      role: "system",
      content: DEFAULT_SYSTEM_NINDO,
    },
  ]);
  const [ttsFallback, setTtsFallback] = useState(false);
  const [audioBlockedUrl, setAudioBlockedUrl] = useState<string | null>(null);
  const [pendingMobileSpeech, setPendingMobileSpeech] = useState("");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [micPermissionBlocked, setMicPermissionBlocked] = useState(false);
  const [micStatusMessage, setMicStatusMessage] = useState("");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const authInvalidatedRef = useRef(false);
  const hasPrivateSession = isAuthenticated && authSessionReady && !authInvalidatedRef.current;

  useEffect(() => {
    document.title = isGeneralCockpit
      ? "Funesterie - État"
      : isGeneralHome
        ? "Funesterie - Accueil"
        : isGeneralAgents
          ? "Funesterie - Agents"
          : isGeneralArchitecture
            ? "Funesterie - Architecture"
            : isGeneralAccount
              ? "Funesterie - Compte"
              : isGeneralContact
                ? "Funesterie - Contact"
                : isGeneralPrivacy
                  ? "Funesterie - Confidentialité"
                  : isGeneralTerms
                    ? "Funesterie - Conditions"
                    : isGeneralLogin
                      ? "Funesterie - Connexion"
                      : isVivy
                        ? "Vivy - Funesterie"
                        : isKaen44
                          ? "Kaen44 - Assistante bureau Funesterie"
                          : "A11 - Alpha Onze Funesterie";
    // data-surface permet de cibler le thème en CSS sans inline styles
    document.body.setAttribute('data-surface', (isGeneralCockpit || isGeneralHome || isGeneralAgents || isGeneralArchitecture || isGeneralAccount || isGeneralContact || isGeneralPrivacy || isGeneralTerms || isGeneralLogin) ? 'funesterie' : isVivy ? 'vivy' : isKaen44 ? 'kaen44' : 'a11');
    document.documentElement.classList.toggle("funesterie-public-page-root", isFunesteriePublicShell);
    document.body.classList.toggle("funesterie-public-page-body", isFunesteriePublicShell);

    return () => {
      document.documentElement.classList.remove("funesterie-public-page-root");
      document.body.classList.remove("funesterie-public-page-body");
    };
  }, [isFunesteriePublicShell, isGeneralAccount, isGeneralAgents, isGeneralArchitecture, isGeneralCockpit, isGeneralContact, isGeneralHome, isGeneralLogin, isGeneralPrivacy, isGeneralTerms, isKaen44, isVivy]);

  // Audio-blocked banner: listen for autoplay block events
  useEffect(() => {
    const onBlocked = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (isCompactViewportNow()) {
        setAudioBlockedUrl(url || null);
        setMicStatusMessage("Voix mobile prête: touche le bouton lecture après un appui utilisateur.");
        return;
      }
      if (!url) return;
      setAudioBlockedUrl(url);
    };
    const onSpeechStart = () => {
      setAudioBlockedUrl(null);
      setAudioPlaying(true);
    };
    const onSpeechEnd = () => setAudioPlaying(false);
    const onUnlocked = () => setAudioBlockedUrl(null);
    globalThis.addEventListener('a11:audioBlocked', onBlocked);
    globalThis.addEventListener('a11:audioUnlocked', onUnlocked);
    globalThis.addEventListener('a11:speechstart', onSpeechStart);
    globalThis.addEventListener('a11:speechend', onSpeechEnd);
    return () => {
      globalThis.removeEventListener('a11:audioBlocked', onBlocked);
      globalThis.removeEventListener('a11:audioUnlocked', onUnlocked);
      globalThis.removeEventListener('a11:speechstart', onSpeechStart);
      globalThis.removeEventListener('a11:speechend', onSpeechEnd);
    };
  }, []);

  useEffect(() => {
    const onMicError = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: string; message?: string }>).detail || {};
      const error = String(detail.error || "");
      setMicStarting(false);
      setVoiceListening(false);
      if (error === "not-allowed" || error === "service-not-allowed") {
        setMicPermissionBlocked(true);
        setMicStatusMessage("Micro bloqué par le navigateur. Mode voix sortie actif; autorise le micro dans le cadenas du site pour dicter.");
        setTtsFallback(true);
        try {
          localStorage.setItem("a11:tts-only", "1");
        } catch {
          // ignore storage access errors
        }
        return;
      }
      if (error) {
        setMicStatusMessage(`Micro indisponible: ${error}`);
        console.info("[A11] micro indisponible:", error);
      }
    };

    globalThis.addEventListener("a11:micError", onMicError);
    return () => globalThis.removeEventListener("a11:micError", onMicError);
  }, []);

  // Check if already authenticated on mount
  useEffect(() => {
    const pathname = window.location.pathname.toLowerCase();
    setIsResetRoute(pathname.includes('/reset-password') || pathname.includes('/reset'));
    const hostname = window.location.hostname.toLowerCase();

    const refreshCookieSession = () => {
      setAuthSessionReady(false);
      void fetchAuthSession()
        .then((session) => {
          if (!session?.authenticated && !session?.user) {
            setIsAuthenticated(false);
            setDisplayName("Utilisateur");
            setIsFunesterieAdmin(false);
            setAuthSessionReady(true);
            if (isAuthSuccessRoute(pathname)) {
              window.history.replaceState({}, "", resolveAuthFailureRedirectPath(pathname));
            }
            return;
          }
          setIsAuthenticated(true);
          setDisplayName(session?.user?.username || session?.user?.email || "Utilisateur");
          setIsFunesterieAdmin(Boolean(session?.user?.fullAccess || String(session?.user?.role || "").toLowerCase() === "admin" || hasAuthenticatedAdminApiAccess()));
          setAuthSessionReady(true);
          if (isAuthSuccessRoute(pathname)) {
            const surface = getCurrentSurfaceKind();
            window.history.replaceState({}, "", resolveAuthSuccessRedirectPath(pathname, surface));
          } else if (isLoginRoute(pathname)) {
            window.location.replace(normalizeAllowedReturnTo(getRequestedLoginReturnTo()));
          }
        })
        .catch(() => {
          setIsAuthenticated(false);
          setDisplayName("Utilisateur");
          setIsFunesterieAdmin(false);
          setAuthSessionReady(true);
          if (isAuthSuccessRoute(pathname)) {
            const failurePath = resolveAuthFailureRedirectPath(pathname);
            window.history.replaceState({}, "", failurePath);
          }
        });
    };

    const consumedOAuthToken = consumeOAuthTokenFromLocation();
    if (consumedOAuthToken) {
      refreshCookieSession();
      return;
    }

    if (isAuthSuccessRoute(pathname)) {
      refreshCookieSession();
      return;
    }

    const localPublicPreview = new URLSearchParams(window.location.search || "").get("public") === "1";
    if (isLocalDevSurface() && !localPublicPreview && !isLoginRoute(pathname) && !isVivyExperience()) {
      activateLocalDevSession(() => {
        setIsAuthenticated(true);
        setDisplayName("Djeff local");
        setIsFunesterieAdmin(true);
        setAuthSessionReady(true);
      });
      return;
    }

    const clientHasAuthToken = hasAuthToken();
    if (clientHasAuthToken) {
      const scope = getAuthStorageScope();
      if (scope) {
        refreshCookieSession();
        return;
      }
      clearAuthToken();
      setAuthDisplayName("");
    }

    const shouldCheckCookieSession = (
      isAuthSuccessRoute(pathname)
      || isLoginRoute(pathname)
      || hostname === 'a11.funesterie.me'
      || hostname === 'k44.funesterie.me'
      || hostname === 'funesterie.me'
      || hostname === 'www.funesterie.me'
      || hostname === 'kaen44.funesterie.me'
      || hostname === 'vivy.funesterie.me'
    );
    if (!shouldCheckCookieSession) {
      setAuthSessionReady(true);
      return;
    }

    refreshCookieSession();
  }, []);

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession) {
      setVoiceReferences([]);
      setVoiceReferenceStatus("");
      return;
    }
    void refreshVoiceReferences();
  }, [hasPrivateSession, isFunesteriePublicShell]);

  useEffect(() => {
    const onDiagnostics = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      const score = detail?.comparison?.similarity;
      if (typeof score === "number") {
        setVoiceReferenceStatus(`Voix comparee: ${Math.round(score * 100)}%`);
        return;
      }
      const via = String(detail?.via || detail?.provider || "").trim();
      if (via) {
        const label = via === "openai-tts" || via === "openai" ? "OpenAI"
          : via.includes("xtts") || via.includes("rvc") ? "Voix officielle"
            : via === "spawn" || via === "piper" ? "Piper local"
              : via === "espeak" || via === "espeak-ng" ? "Secours robot"
                : via;
        setVoiceReferenceStatus(`Audio: ${label}`);
      }
    };
    globalThis.addEventListener("a11:ttsDiagnostics", onDiagnostics);
    return () => globalThis.removeEventListener("a11:ttsDiagnostics", onDiagnostics);
  }, []);

  useEffect(() => {
    const onAuthInvalid = (event: Event) => {
      if (authInvalidatedRef.current) return;
      const detail = (event as CustomEvent<{ reason?: string; message?: string; status?: number }>).detail || {};
      authInvalidatedRef.current = true;
      if (!isFunesteriePublicShell) {
        console.warn("[A11] auth invalidated", detail);
      }
      cancelSpeech();
      setDisplayName("Utilisateur");
      setIsAuthenticated(false);
      setIsFunesterieAdmin(false);
      setAuthSessionReady(true);
      setSending(false);
      sendLockRef.current = false;
      pendingMessageKeyRef.current = "";
      lastCompletedMessageRef.current = { key: "", at: 0 };
      setLoadingHistory(false);
      setLoadingActivity(false);
      setLoadingResources(false);
      setLoadingRemoteProviders(false);
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      setA11History([]);
      const freshChat = buildFreshChat("Session actuelle");
      setChats([freshChat]);
      setSelectedChatId(freshChat.id);
      setMessages(freshChat.messages);
      setA11ConvId(null);
      setA11ConvMsgs([]);
      setConversationActivity([]);
      setConversationResources([]);
      setActivityError("");
      setResourceError("");
      setAudioBlockedUrl(null);
      setSidebarOpen(false);
      setInspectorOpen(false);
      setSettingsMenuOpen(false);
      setActiveView("chat");
    };

    globalThis.addEventListener("a11:auth-invalid", onAuthInvalid);
    return () => globalThis.removeEventListener("a11:auth-invalid", onAuthInvalid);
  }, [isFunesteriePublicShell]);

  useEffect(() => {
    if (hasPrivateSession) {
      authInvalidatedRef.current = false;
    }
  }, [hasPrivateSession]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [portraitFramebook, setPortraitFramebook] = useState<A11PortraitFramebook>(DEFAULT_A11_PORTRAIT_FRAMEBOOK);
  const [portraitFrameIndex, setPortraitFrameIndex] = useState(0);
  // File d'attente : messages envoyés pendant qu'A11 réfléchit
  const messageQueueRef = useRef<string[]>([]);
  const queueProcessingRef = useRef(false);

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession) {
      setPortraitFramebook(DEFAULT_A11_PORTRAIT_FRAMEBOOK);
      return;
    }
    let cancelled = false;
    fetchA11PortraitFramebook()
      .then((framebook) => {
        if (cancelled) return;
        setPortraitFramebook(framebook);
        setPortraitFrameIndex(0);
      })
      .catch((error_) => {
        if (isAuthInvalidError(error_)) {
          if (!cancelled) setPortraitFramebook(DEFAULT_A11_PORTRAIT_FRAMEBOOK);
          return;
        }
        console.warn("[A11] portrait framebook unavailable", error_);
        if (!cancelled) setPortraitFramebook(DEFAULT_A11_PORTRAIT_FRAMEBOOK);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPrivateSession, isFunesteriePublicShell]);

  const portraitFramesById = useMemo(() => {
    const map = new Map<string, A11PortraitFrame>();
    for (const frame of portraitFramebook.frames || []) {
      if (frame?.id) map.set(frame.id, frame);
    }
    return map;
  }, [portraitFramebook]);

  const portraitSequenceName = audioPlaying ? "speaking" : sending ? "thinking" : "idle";
  const portraitSequenceFrames = useMemo(() => {
    const sequenceIds = portraitFramebook.sequences?.[portraitSequenceName]
      || portraitFramebook.sequences?.idle
      || ["idle"];
    const frames = sequenceIds
      .map((id) => portraitFramesById.get(id))
      .filter(Boolean) as A11PortraitFrame[];
    return frames.length ? frames : DEFAULT_A11_PORTRAIT_FRAMEBOOK.frames;
  }, [portraitFramebook, portraitFramesById, portraitSequenceName]);

  useEffect(() => {
    setPortraitFrameIndex(0);
  }, [portraitSequenceName]);

  useEffect(() => {
    if (portraitSequenceFrames.length <= 1) return;
    const activeFrame = portraitSequenceFrames[portraitFrameIndex % portraitSequenceFrames.length];
    const fallbackHoldMs = portraitFramebook.audioSync?.frameDurationMs || 160;
    const holdMs = Math.max(80, Math.min(2000, Number(activeFrame?.holdMs || fallbackHoldMs) || fallbackHoldMs));
    const timer = globalThis.setTimeout(() => {
      setPortraitFrameIndex((index) => (index + 1) % portraitSequenceFrames.length);
    }, holdMs);
    return () => globalThis.clearTimeout(timer);
  }, [portraitFrameIndex, portraitFramebook.audioSync?.frameDurationMs, portraitSequenceFrames]);

  const activePortraitFrame = portraitSequenceFrames[portraitFrameIndex % portraitSequenceFrames.length]
    || DEFAULT_A11_PORTRAIT_FRAMEBOOK.frames[0];
  const activePortraitSrc = resolvePortraitAssetPath(activePortraitFrame?.src || "a11_static.png");
  const activePortraitTransitionMs = Math.max(
    80,
    Math.min(600, Number(portraitFramebook.audioSync?.transitionMs || 120) || 120)
  );

  // Console d'activité A11
  const {
    events: activityEvents,
    isActive: activityIsActive,
    pushEvent: pushActivityEvent,
    updateEvent: updateActivityEvent,
    clearEvents: clearActivityEvents,
    startActivity,
    stopActivity,
    detectAndPushFromResponse,
  } = useA11Activity();
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const [voiceReferences, setVoiceReferences] = useState<TtsVoiceReference[]>([]);
  const [selectedVoiceReferenceId, setSelectedVoiceReferenceId] = useState(() => readStoredVoiceReferenceId(surfaceKind));
  const [voiceReferenceStatus, setVoiceReferenceStatus] = useState("");
  const [ttsVocalMode, setTtsVocalMode] = useState<"speech" | "adaptive" | "sing">(() => {
    try {
      const saved = localStorage.getItem("a11:tts:vocal-mode");
      return saved === "speech" || saved === "sing" ? saved : "adaptive";
    } catch {
      return "adaptive";
    }
  });
  const [ttsProviderMode, setTtsProviderMode] = useState<TtsProviderMode>(() => {
    try {
      const saved = localStorage.getItem("a11:tts:provider-mode");
      return saved === "piper" || saved === "openai" ? saved : "auto";
    } catch {
      return "auto";
    }
  });
  const effectiveTtsProviderMode = useMemo(
    () => resolveEffectiveTtsProviderMode(ttsProviderMode, surfaceKind),
    [surfaceKind, ttsProviderMode]
  );
  const [a11Language, setA11Language] = useState<A11LanguageCode>(() => {
    try {
      return normalizeA11LanguageCode(localStorage.getItem("a11:language"));
    } catch {
      return "fr";
    }
  });
  const selectedA11Language = useMemo(
    () => A11_LANGUAGE_CHOICES.find((choice) => choice.code === a11Language) || A11_LANGUAGE_CHOICES[0],
    [a11Language]
  );
  const defaultVoiceReferenceLabel = useMemo(
    () => getDefaultVoiceReferenceLabel(surfaceKind),
    [surfaceKind]
  );
  const selectedVoiceReference = useMemo(
    () => voiceReferences.find((ref) => ref.id === selectedVoiceReferenceId) || null,
    [selectedVoiceReferenceId, voiceReferences]
  );
  const selectedSurfaceVoiceReference = useMemo(
    () => selectedVoiceReference && voiceReferenceMatchesSurface(selectedVoiceReference, surfaceKind)
      ? selectedVoiceReference
      : null,
    [selectedVoiceReference, surfaceKind]
  );
  const speechVoiceReferenceId = selectedSurfaceVoiceReference?.id || "";
  const activeVoiceReferenceLabel = selectedSurfaceVoiceReference
    ? (selectedSurfaceVoiceReference.label || selectedSurfaceVoiceReference.originalName || "Référence privée")
    : defaultVoiceReferenceLabel;
  const voiceReferenceControlsDisabled = isFunesteriePublicShell || !hasPrivateSession;
  const voiceReferenceStorageKey = useMemo(() => getVoiceReferenceStorageKey(surfaceKind), [surfaceKind]);
  useEffect(() => {
    setSelectedVoiceReferenceId(readStoredVoiceReferenceId(surfaceKind));
  }, [surfaceKind]);
  useEffect(() => {
    if (effectiveTtsProviderMode !== ttsProviderMode) {
      setTtsProviderMode(effectiveTtsProviderMode);
    }
  }, [effectiveTtsProviderMode, ttsProviderMode]);
  useEffect(() => {
    try {
      localStorage.setItem(voiceReferenceStorageKey, selectedVoiceReferenceId || "");
      localStorage.setItem("a11:tts:vocal-mode", ttsVocalMode);
      localStorage.setItem("a11:tts:provider-mode", effectiveTtsProviderMode);
    } catch {
      // ignore storage access errors
    }
  }, [effectiveTtsProviderMode, selectedVoiceReferenceId, ttsVocalMode, voiceReferenceStorageKey]);
  useEffect(() => {
    try {
      localStorage.setItem("a11:language", selectedA11Language.code);
      document.documentElement.lang = selectedA11Language.speechLang;
    } catch {
      // ignore storage/document access errors
    }
    setSpeechRecognitionLanguage(selectedA11Language.speechLang);
  }, [selectedA11Language]);
  const toggleLockRef = useRef(false);
  const sendLockRef = useRef(false);
  const pendingMessageKeyRef = useRef("");
  const pendingSubmitAtRef = useRef(0);
  const lastCompletedMessageRef = useRef({ key: "", at: 0 });
  const authStorageScope = useMemo(
    () => (hasPrivateSession ? getAuthStorageScope() : ""),
    [hasPrivateSession]
  );
  const chatStorageKey = useMemo(
    () => buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope, surfaceKind),
    [authStorageScope, surfaceKind]
  );
  const purgeHistoryStorageKey = useMemo(
    () => buildSurfaceScopedStorageKey(PURGE_HISTORY_STORAGE_KEY_PREFIX, authStorageScope, surfaceKind),
    [authStorageScope, surfaceKind]
  );
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const chatScrollFrameRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [model, setModel] = useState("openai:gpt-4o-mini");
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [remoteProviderProfiles, setRemoteProviderProfiles] = useState<RemoteProviderProfile[]>([]);
  const [loadingRemoteProviders, setLoadingRemoteProviders] = useState(false);
  const [savingRemoteProvider, setSavingRemoteProvider] = useState(false);
  const [deletingRemoteProviderId, setDeletingRemoteProviderId] = useState<string | null>(null);
  const [remoteProviderError, setRemoteProviderError] = useState("");

  // Chats state persisted in localStorage
  const [chats, setChats] = useState<{
    id: string;
    name: string;
    updated: number;
    messages: ChatMessage[];
  }[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const surfaceChatCounts = useMemo(() => {
    const counts = readSurfaceChatCounts(authStorageScope);
    counts[surfaceKind] = chats.length;
    return counts;
  }, [authStorageScope, chats.length, surfaceKind]);

  // Historique A-11 (backend)
  const [a11History, setA11History] = useState<A11HistoryItem[]>([]);
  const [a11ConvId, setA11ConvId] = useState<string | null>(null);
  const [a11ConvMsgs, setA11ConvMsgs] = useState<A11HistoryMessage[]>([]);
  const [conversationActivity, setConversationActivity] = useState<A11ConversationActivityEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [conversationResources, setConversationResources] = useState<A11ConversationResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [uploadFeedback, setUploadFeedback] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [imageJobActive, setImageJobActive] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPreviewUrls, setDragPreviewUrls] = useState<{ name: string; url: string; isImage: boolean }[]>([]);
  const [previewCarouselIndex, setPreviewCarouselIndex] = useState(0);
  const dragCounterRef = useRef(0);
  const recentFileImportRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const copyMessageFeedbackTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [createArtifactOpen, setCreateArtifactOpen] = useState(false);
  const [creatingArtifact, setCreatingArtifact] = useState(false);
  const [createArtifactError, setCreateArtifactError] = useState("");
  const [downloadingResourceId, setDownloadingResourceId] = useState<number | null>(null);
  const [emailingResourceId, setEmailingResourceId] = useState<number | null>(null);
  const [emailDialogResource, setEmailDialogResource] = useState<A11ConversationResource | null>(null);
  const [emailDialogError, setEmailDialogError] = useState("");
  const [renameDialog, setRenameDialog] = useState<{ id: string; currentName: string } | null>(null);
  const [deleteDialogChatId, setDeleteDialogChatId] = useState<string | null>(null);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => {
    try {
      return window.location.pathname.toLowerCase().includes("/casino") ? "casino" : "chat";
    } catch {
      return "chat";
    }
  });
  const [adminSection, setAdminSection] = useState<AdminSection>("cockpit");
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    try {
      return window.innerWidth <= 900;
    } catch {
      return false;
    }
  });
  const mobileVoiceReady = isCompactLayout && Boolean(audioBlockedUrl || pendingMobileSpeech.trim());
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return false;
  });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [deletingA11HistoryId, setDeletingA11HistoryId] = useState<string | null>(null);
  const [deleteA11HistoryId, setDeleteA11HistoryId] = useState<string | null>(null);
  const [consoleSuggestion, setConsoleSuggestion] = useState<ConsoleSuggestion | null>(null);
  const [purgingMemory, setPurgingMemory] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState<string>("");
  const [technicalMemoSummary, setTechnicalMemoSummary] = useState<TechnicalMemoSummaryResponse["summary"] | null>(null);
  const [loadingTechnicalMemos, setLoadingTechnicalMemos] = useState(false);
  const [technicalMemoError, setTechnicalMemoError] = useState("");
  const [technicalMemoFeedback, setTechnicalMemoFeedback] = useState("");
  const [purgingTechnicalMemos, setPurgingTechnicalMemos] = useState(false);
  const [technicalMemoConfirmOpen, setTechnicalMemoConfirmOpen] = useState(false);
  const [memoryPurgeDryRun, setMemoryPurgeDryRun] = useState(true);
  const [purgeHistory, setPurgeHistory] = useState<PurgeHistoryEntry[]>([]);

  useEffect(() => {
    if (!isKaen44) return;
    if (adminSection !== "cockpit" && adminSection !== "subscription") {
      setAdminSection("cockpit");
    }
  }, [adminSection, isKaen44]);

  useEffect(() => {
    if (activeView !== "admin") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector(".admin-scroll-panel")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [activeView, adminSection]);

  useEffect(() => () => {
    if (copyMessageFeedbackTimerRef.current) {
      globalThis.clearTimeout(copyMessageFeedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    setDisplayName(getAuthDisplayName() || "Utilisateur");
  }, [isAuthenticated]);

  useEffect(() => {
    const syncLayout = () => {
      setIsCompactLayout(window.innerWidth <= 900);
    };

    syncLayout();
    window.addEventListener("resize", syncLayout);
    return () => window.removeEventListener("resize", syncLayout);
  }, []);

  useEffect(() => {
    if (!settingsMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (settingsMenuRef.current && target && !settingsMenuRef.current.contains(target)) {
        setSettingsMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    if (isCompactLayout) {
      setAudioBlockedUrl(null);
    }
  }, [isCompactLayout]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "chat") return;
    const hasConversationContent = messages.some((message) => (
      message.role !== "system" && String(message.content || "").trim().length > 0
    ));
    if (!hasConversationContent && !sending && !imageJobActive) {
      const frame = chatScrollFrameRef.current;
      if (frame) frame.scrollTop = 0;
      return;
    }
    const scrollToEnd = () => {
      chatEndRef.current?.scrollIntoView({ block: "end", behavior: isCompactLayout ? "auto" : "smooth" });
      const frame = chatScrollFrameRef.current;
      if (frame) frame.scrollTop = frame.scrollHeight;
    };
    const rafId = globalThis.requestAnimationFrame(scrollToEnd);
    const timeoutId = globalThis.setTimeout(scrollToEnd, isCompactLayout ? 120 : 220);
    return () => {
      globalThis.cancelAnimationFrame(rafId);
      globalThis.clearTimeout(timeoutId);
    };
  }, [activeView, isAuthenticated, isCompactLayout, messages.length, sending, imageJobActive]);

  useEffect(() => {
    if (!previewImageUrl) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImageUrl(null);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImageUrl]);

  // Load chat cache scoped to the authenticated user.
  useEffect(() => {
    if (!isAuthenticated) return;

    if (!authStorageScope) {
      const initialChat = buildFreshChat("Session actuelle");
      setChats([initialChat]);
      setSelectedChatId(initialChat.id);
      setMessages(initialChat.messages);
      setA11ConvId(null);
      setA11ConvMsgs([]);
      setConversationActivity([]);
      setConversationResources([]);
      setActivityError("");
      setResourceError("");
      setUploadFeedback("");
      return;
    }

    let legacyChatRaw = "";
    try {
      const legacyKeys = [
        buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope),
        CHAT_STORAGE_KEY_PREFIX,
      ].filter((key) => key !== chatStorageKey);
      for (const key of legacyKeys) {
        const rawLegacy = localStorage.getItem(key);
        if (rawLegacy) {
          legacyChatRaw = rawLegacy;
          break;
        }
      }
    } catch {
      // ignore legacy storage lookup issues
    }

    try {
      const currentRaw = localStorage.getItem(chatStorageKey);
      const raw = currentRaw || (surfaceKind === "a11" ? legacyChatRaw : "");
      if (raw) {
        if (!currentRaw && surfaceKind === "a11") {
          try {
            localStorage.setItem(chatStorageKey, raw);
          } catch {
            // Keep reading even if migration cannot be written.
          }
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          // sanitize chats and messages to conform to expected types
          const sanitizeRole = (r: any) => (r === 'user' || r === 'assistant' || r === 'system') ? r as Role : 'assistant' as Role;
          const normalizeSystemContent = (content: string) => {
            const value = String(content || '');
            if (
              value.includes('utilise les capacités locales') ||
              value.includes('assistant local NOSSEN')
            ) {
              return DEFAULT_SYSTEM_NINDO;
            }
            return value;
          };
          const sanitized = parsed.map((c: any) => ({
            id: String(c.id || `chat-${Date.now()}`),
            name: String(c.name || 'Conversation'),
            updated: Number(c.updated) || Date.now(),
            messages: Array.isArray(c.messages) ? c.messages.map((m: any) => {
              const role = sanitizeRole(m.role);
              const rawContent = String(m.content || '');
              const normalizedAssistant = role === 'assistant'
                ? normalizeAssistantMessagePayload(
                  rawContent,
                  typeof m.imageUrl === 'string' ? m.imageUrl : null,
                  typeof m.videoUrl === 'string' ? m.videoUrl : null,
                  typeof m.fileUrl === 'string' ? m.fileUrl : null
                )
                : {
                  content: rawContent,
                  imageUrl: typeof m.imageUrl === 'string' ? resolveApiAssetUrl(m.imageUrl) : null,
                  videoUrl: typeof m.videoUrl === 'string' ? resolveApiAssetUrl(m.videoUrl) : null,
                  fileUrl: typeof m.fileUrl === 'string' ? resolveApiAssetUrl(m.fileUrl) : null,
                };
              return {
                id: String(m.id || (`m-${Date.now()}`)),
                role,
                content: role === 'system' ? normalizeSystemContent(rawContent) : normalizedAssistant.content,
                imageUrl: role === 'system' ? null : normalizedAssistant.imageUrl,
                videoUrl: role === 'system' ? null : normalizedAssistant.videoUrl,
                fileUrl: role === 'system' ? null : normalizedAssistant.fileUrl,
                ts: normalizeMessageTimestamp(m.ts),
              };
            }) : [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO, ts: new Date().toISOString() }]
          }));
          setChats(sanitized);
          setSelectedChatId(sanitized[0].id);
          setMessages(sanitized[0].messages || [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO, ts: new Date().toISOString() }]);
          setA11ConvId(null);
          setA11ConvMsgs([]);
          setConversationActivity([]);
          setConversationResources([]);
          setActivityError("");
          setResourceError("");
          setUploadFeedback("");
          return;
        }
      }
    } catch (e) {
      console.warn("[A11] failed to load chats", e);
    }
    const initialChat = buildFreshChat("Session actuelle");
    setChats([initialChat]);
    setSelectedChatId(initialChat.id);
    setMessages(initialChat.messages);
    setA11ConvId(null);
    setA11ConvMsgs([]);
    setConversationActivity([]);
    setConversationResources([]);
    setActivityError("");
    setResourceError("");
    setUploadFeedback("");
  }, [isAuthenticated, authStorageScope, chatStorageKey]);

  useEffect(() => {
    try {
      if (localStorage.getItem('a11:tts-only') === '1') {
        setTtsFallback(true);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  useEffect(() => {
    setTtsQueueEnabled(ttsFallback || voiceListening);
  }, [ttsFallback, voiceListening]);

  useEffect(() => {
    try {
      if (!isAuthenticated || !authStorageScope) {
        setPurgeHistory([]);
        return;
      }
      const raw = localStorage.getItem(purgeHistoryStorageKey);
      if (!raw) {
        setPurgeHistory([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setPurgeHistory(
          parsed
            .filter((item: any) => item && typeof item.at === 'string')
            .slice(0, 10)
        );
      }
    } catch {
      // ignore corrupted local history
    }
  }, [isAuthenticated, authStorageScope, purgeHistoryStorageKey]);

  useEffect(() => {
    if (!isAuthenticated || !authStorageScope) return;
    try {
      localStorage.setItem(
        purgeHistoryStorageKey,
        JSON.stringify(purgeHistory.slice(0, 10))
      );
    } catch {
      // ignore storage failures
    }
  }, [purgeHistory, isAuthenticated, authStorageScope, purgeHistoryStorageKey]);

  // persist chats whenever changed
  useEffect(() => {
    if (!isAuthenticated || !authStorageScope) return;
    try {
      localStorage.setItem(
        chatStorageKey,
        JSON.stringify(chats)
      );
    } catch (e) {
      console.warn("[A11] failed to save chats", e);
    }
  }, [chats, isAuthenticated, authStorageScope, chatStorageKey]);

  // helper to update messages for selected chat
  function updateChatMessages(chatId: string | null, newMessages: ChatMessage[]) {
    if (!chatId) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, messages: newMessages, updated: Date.now() } : c
      )
    );
  }

  function mapBackendConversationMessages(rawMessages: any[]): ChatMessage[] {
    return (Array.isArray(rawMessages) ? rawMessages : []).map((message: any, index: number) => {
      const role = message?.role === "user" || message?.role === "assistant" || message?.role === "system"
        ? message.role
        : "assistant";
      const normalizedAssistant = role === "assistant"
        ? normalizeAssistantMessagePayload(
          String(message?.content || ""),
          typeof (message?.imageUrl || message?.image_url || message?.imagePath) === "string"
            ? (message?.imageUrl || message?.image_url || message?.imagePath)
            : null,
          typeof (message?.videoUrl || message?.video_url || message?.videoPath) === "string"
            ? (message?.videoUrl || message?.video_url || message?.videoPath)
            : null,
          typeof (message?.fileUrl || message?.file_url || message?.filePath) === "string"
            ? (message?.fileUrl || message?.file_url || message?.filePath)
            : null
        )
        : {
          content: String(message?.content || ""),
          imageUrl: typeof (message?.imageUrl || message?.image_url || message?.imagePath) === "string"
            ? resolveApiAssetUrl(message?.imageUrl || message?.image_url || message?.imagePath)
            : null,
          videoUrl: typeof (message?.videoUrl || message?.video_url || message?.videoPath) === "string"
            ? resolveApiAssetUrl(message?.videoUrl || message?.video_url || message?.videoPath)
            : null,
          fileUrl: typeof (message?.fileUrl || message?.file_url || message?.filePath) === "string"
            ? resolveApiAssetUrl(message?.fileUrl || message?.file_url || message?.filePath)
            : null,
          qflushVerification: null,
        };
      return {
        id: String(message?.id || `backend-msg-${Date.now()}-${index}`),
        role,
        content: normalizedAssistant.content,
        imageUrl: normalizedAssistant.imageUrl,
        videoUrl: normalizedAssistant.videoUrl,
        fileUrl: normalizedAssistant.fileUrl,
        qflushVerification: role === "assistant"
          ? (message?.qflushVerification || normalizedAssistant.qflushVerification || null)
          : null,
        ts: normalizeMessageTimestamp(message?.ts),
      };
    });
  }

  const currentConversationId = a11ConvId || selectedChatId;
  const chatModelChoices = useMemo(
    () => buildChatModelChoices(remoteProviderProfiles),
    [remoteProviderProfiles]
  );
  const resolvedChatModelChoice = useMemo(
    () => resolveChatModelChoice(model, remoteProviderProfiles),
    [model, remoteProviderProfiles]
  );

  async function refreshConversationActivity(conversationId?: string | null) {
    const targetConversationId = String(conversationId || "").trim();
    if (isFunesteriePublicShell || !targetConversationId || hasLocalDevSession() || !hasPrivateSession) {
      setConversationActivity([]);
      setActivityError("");
      return;
    }

    setLoadingActivity(true);
    setActivityError("");
    try {
      const payload = await fetchA11ConversationActivity(targetConversationId, { limit: 12, surface: surfaceKind });
      setConversationActivity(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setConversationActivity([]);
        setActivityError("");
        return;
      }
      console.warn("[A11] failed to load conversation activity", error_);
      setConversationActivity([]);
      setActivityError((error_ as Error).message || "Chargement de l'activite impossible");
    } finally {
      setLoadingActivity(false);
    }
  }

  async function refreshConversationResources(conversationId?: string | null) {
    const targetConversationId = String(conversationId || "").trim();
    if (isFunesteriePublicShell || !targetConversationId || hasLocalDevSession() || !hasPrivateSession) {
      setConversationResources([]);
      setResourceError("");
      return;
    }

    setLoadingResources(true);
    setResourceError("");
    try {
      const payload = await fetchA11ConversationResources(targetConversationId, { limit: 24, surface: surfaceKind });
      setConversationResources(Array.isArray(payload?.resources) ? payload.resources : []);
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setConversationResources([]);
        setResourceError("");
        return;
      }
      console.warn("[A11] failed to load conversation resources", error_);
      setConversationResources([]);
      setResourceError((error_ as Error).message || "Chargement des ressources impossible");
    } finally {
      setLoadingResources(false);
    }
  }

  async function refreshRemoteAiProfiles() {
    if (isFunesteriePublicShell || !hasPrivateSession || !hasAuthenticatedAdminApiAccess()) {
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      return;
    }
    setLoadingRemoteProviders(true);
    setRemoteProviderError("");
    try {
      const payload = await fetchRemoteProviderProfiles();
      const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
      setRemoteProviderProfiles(profiles);
      const activeChoice = resolveChatModelChoice(model, profiles);
      if (activeChoice.value !== model) {
        setModel(activeChoice.value);
      }
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setRemoteProviderProfiles([]);
        setRemoteProviderError("");
        return;
      }
      setRemoteProviderProfiles([]);
      setRemoteProviderError((error_ as Error).message || "Chargement des IA distantes impossible.");
    } finally {
      setLoadingRemoteProviders(false);
    }
  }

  async function handleSaveRemoteAiProfile(input: RemoteProviderSaveInput) {
    setSavingRemoteProvider(true);
    setRemoteProviderError("");
    try {
      const saved = await saveRemoteProviderProfile(input);
      await refreshRemoteAiProfiles();
      setModel(`remote-profile:${saved.id}`);
    } catch (error_) {
      setRemoteProviderError((error_ as Error).message || "Enregistrement impossible.");
      throw error_;
    } finally {
      setSavingRemoteProvider(false);
    }
  }

  async function handleDeleteRemoteAiProfile(profileId: string) {
    const normalizedId = String(profileId || "").trim();
    if (!normalizedId) return;

    setDeletingRemoteProviderId(normalizedId);
    setRemoteProviderError("");
    try {
      await deleteRemoteProviderProfile(normalizedId);
      const activeChoice = resolveChatModelChoice(model, remoteProviderProfiles);
      if (activeChoice.providerProfileId === normalizedId) {
        setModel(LOCAL_CHAT_MODEL_CHOICES[0].value);
      }
      await refreshRemoteAiProfiles();
    } catch (error_) {
      setRemoteProviderError((error_ as Error).message || "Suppression impossible.");
    } finally {
      setDeletingRemoteProviderId(null);
    }
  }

  async function handleEmailResource(resource: A11ConversationResource) {
    if (typeof resource.id !== "number") return;
    setEmailDialogError("");
    setEmailDialogResource(resource);
  }

  async function handleDownloadResource(resource: A11ConversationResource) {
    if (typeof resource.id !== "number") return;
    setDownloadingResourceId(resource.id);
    setUploadFeedback("Preparation du telechargement...");
    try {
      const result = await downloadConversationResource(resource);
      setUploadFeedback(`Telechargement lance: ${result.filename}`);
      await refreshConversationActivity(resource.conversationId || currentConversationId);
    } catch (error_) {
      console.warn("[A11] failed to download resource", error_);
      const errorMessage = (error_ as Error).message || String(error_);
      setUploadFeedback(`Echec telechargement: ${errorMessage}`);
    } finally {
      setDownloadingResourceId(null);
    }
  }

  function closeEmailDialog() {
    if (emailingResourceId) return;
    setEmailDialogError("");
    setEmailDialogResource(null);
  }

  function openCreateArtifactDialog() {
    setCreateArtifactError("");
    setCreateArtifactOpen(true);
  }

  function closeCreateArtifactDialog() {
    if (creatingArtifact) return;
    setCreateArtifactError("");
    setCreateArtifactOpen(false);
  }

  async function submitCreateArtifact(payload: {
    format: ArtifactFormat;
    filename: string;
    description?: string;
    openEmailAfterCreate: boolean;
    downloadAfterCreate: boolean;
  }) {
    const conversationId = buildSurfaceConversationId(currentConversationId || selectedChatId || undefined, surfaceKind) || undefined;
    if (!conversationId) return;

    const exportPayload = buildConversationArtifactContent(messages, {
      conversationId,
      format: payload.format,
    });

    setCreatingArtifact(true);
    setCreateArtifactError("");
    setUploadFeedback("Creation de l'artefact en cours...");
    try {
      const result = await createTextArtifact({
        filename: payload.filename,
        text: exportPayload.text,
        contentType: exportPayload.contentType,
        kind: exportPayload.kind,
        conversationId,
        description: payload.description,
      });
      setCreateArtifactOpen(false);
      await refreshConversationResources(conversationId);
      await refreshConversationActivity(conversationId);
      if (payload.downloadAfterCreate && result.conversationResource?.id) {
        await downloadConversationResource(result.conversationResource);
      }
      if (payload.openEmailAfterCreate && result.conversationResource?.id) {
        setEmailDialogError("");
        setEmailDialogResource(result.conversationResource);
      }
      if (payload.openEmailAfterCreate && payload.downloadAfterCreate) {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} créé, téléchargé et prêt à être envoyé.`);
      } else if (payload.openEmailAfterCreate) {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} créé et prêt pour l'envoi mail.`);
      } else if (payload.downloadAfterCreate) {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} créé et téléchargé.`);
      } else {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} créé et stocké.`);
      }
    } catch (error_) {
      console.warn("[A11] artifact creation failed", error_);
      const errorMessage = (error_ as Error).message || String(error_);
      setCreateArtifactError(errorMessage);
      setUploadFeedback(`Echec creation artefact: ${errorMessage}`);
    } finally {
      setCreatingArtifact(false);
    }
  }

  async function submitEmailResource(payload: { to: string; subject?: string; message?: string; attachToEmail: boolean }) {
    const resource = emailDialogResource;
    if (!resource || typeof resource.id !== "number") return;

    setEmailingResourceId(resource.id);
    setEmailDialogError("");
    setUploadFeedback("Envoi mail en cours...");
    try {
      const result = await emailConversationResource(resource.id, {
        to: payload.to.trim(),
        subject: payload.subject,
        message: payload.message,
        attachToEmail: payload.attachToEmail,
      });
      const attachmentLabel = result.mail?.attachmentIncluded ? "avec piece jointe" : "avec lien";
      setUploadFeedback(`Mail envoyé vers ${payload.to.trim()} ${attachmentLabel}.`);
      setEmailDialogResource(null);
      await refreshConversationResources(resource.conversationId || currentConversationId);
      await refreshConversationActivity(resource.conversationId || currentConversationId);
    } catch (error_) {
      console.warn("[A11] failed to email resource", error_);
      const errorMessage = (error_ as Error).message || String(error_);
      setEmailDialogError(errorMessage);
      setUploadFeedback(`Echec envoi mail: ${errorMessage}`);
    } finally {
      setEmailingResourceId(null);
    }
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

  async function refreshVoiceReferences() {
    if (isFunesteriePublicShell || !hasPrivateSession) {
      setVoiceReferences([]);
      setVoiceReferenceStatus("");
      return;
    }
    try {
      const refs = await fetchTtsVoiceReferences();
      setVoiceReferences(refs);
      const selectedStillExists = selectedVoiceReferenceId
        ? refs.some((ref) => ref.id === selectedVoiceReferenceId && voiceReferenceMatchesSurface(ref, surfaceKind))
        : false;
      if (!selectedStillExists) {
        const defaultVoice = refs.find((ref) => voiceReferenceMatchesSurface(ref, surfaceKind));
        if (defaultVoice?.id) {
          setSelectedVoiceReferenceId(defaultVoice.id);
          setVoiceReferenceStatus(getDefaultVoiceReferenceStatus(surfaceKind));
          return;
        }
      }
      if (selectedVoiceReferenceId && !selectedStillExists) {
        setSelectedVoiceReferenceId("");
      }
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setVoiceReferences([]);
        setVoiceReferenceStatus("");
        return;
      }
      console.warn("[A11] voice reference refresh failed", error_);
      setVoiceReferenceStatus("References voix indisponibles");
    }
  }

  function onVoiceReferenceClick() {
    voiceReferenceInputRef.current?.click();
  }

  function onDefaultVoiceReferenceClick() {
    const defaultVoice = voiceReferences.find((ref) => voiceReferenceMatchesSurface(ref, surfaceKind));
    if (defaultVoice?.id) {
      setSelectedVoiceReferenceId(defaultVoice.id);
    } else {
      setSelectedVoiceReferenceId("");
      if (!voiceReferenceControlsDisabled) void refreshVoiceReferences();
    }
    setVoiceReferenceStatus(getDefaultVoiceReferenceStatus(surfaceKind));
  }

  async function onVoiceReferenceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    e.target.value = "";
    if (!file) return;
    setVoiceReferenceStatus("Upload voix...");
    try {
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Référence voix";
      const result = await uploadTtsVoiceReference(file, label, "private");
      setVoiceReferences(result.references);
      if (result.reference?.id) {
        setSelectedVoiceReferenceId(result.reference.id);
      }
      const analysis = result.reference?.analysis;
      const suffix = analysis?.ok && analysis.durationMs
        ? ` (${Math.round(analysis.durationMs / 100) / 10}s)`
        : "";
      setVoiceReferenceStatus(`Référence voix ajoutée${suffix}`);
    } catch (error_) {
      const message = (error_ as Error)?.message || String(error_);
      setVoiceReferenceStatus(`Échec référence voix: ${message}`);
    }
  }

  async function handleImportedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const allFiles = Array.from(files);
    const importKey = allFiles
      .map((file) => {
        const name = String(file.name || "").trim();
        const stableName = /^paste-\d+\.[a-z0-9]+$/i.test(name)
          ? "clipboard-image"
          : name;
        return `${stableName}:${file.size}:${file.type}`;
      })
      .sort()
      .join("|");
    const now = Date.now();
    if (
      importKey
      && recentFileImportRef.current.key === importKey
      && now - recentFileImportRef.current.at < 3000
    ) {
      console.info("[A11] duplicate file import ignored", importKey);
      return;
    }
    recentFileImportRef.current = { key: importKey, at: now };

    const audioFiles = allFiles.filter(isAudioLikeFile);
    const importerFiles = allFiles.filter((file) => !isAudioLikeFile(file));

    // Previews locaux immédiats (object URL, pas de réseau) : accumulés, pas remplacés
    const newPreviews: { name: string; url: string; isImage: boolean }[] = [];
    for (const file of allFiles) {
      if (file.type.startsWith('image/')) {
        newPreviews.push({ name: file.name, url: URL.createObjectURL(file), isImage: true });
      } else {
        newPreviews.push({ name: file.name, url: '', isImage: false });
      }
    }
    if (newPreviews.length > 0) {
      // Accumuler : plusieurs drops successifs s'ajoutent
      setDragPreviewUrls((prev) => {
        const next = [...prev, ...newPreviews];
        // Pointer sur le premier nouveau fichier ajouté
        setPreviewCarouselIndex(prev.length);
        return next;
      });
      // Pas de timeout : les chips restent jusqu'à l'envoi du message
    }

    // Upload et injection dans le textarea : on attend la fin pour avoir les URLs
    if (importerFiles.length > 0) {
      await handleImportFiles(toSyntheticFileList(importerFiles), (txt: string) => {
        setInput((prev) => (prev ? prev + "\n" + txt : txt));
      }, { uploadImages: true, conversationId: a11ConvId || selectedChatId || undefined });
    }

    if (audioFiles.length > 0) {
      setAudioTranscribing(true);
      setUploadFeedback(`Transcription audio de ${audioFiles.length} fichier(s)...`);
      const transcriptBlocks: string[] = [];
      const failedAudio: string[] = [];
      for (const file of audioFiles) {
        try {
          const transcript = await transcribeAudioFile(file, { language: selectedA11Language.sttCode, provider: "auto" });
          if (transcript.text) {
            transcriptBlocks.push(`[audio:${file.name}]\n${transcript.text}`);
          } else {
            failedAudio.push(file.name);
          }
        } catch (error_) {
          console.warn("[A11] audio transcription failed", file.name, error_);
          failedAudio.push(file.name);
        }
      }
      if (transcriptBlocks.length > 0) {
        setInput((prev) => {
          const nextText = transcriptBlocks.join("\n\n");
          return prev ? `${prev}\n${nextText}` : nextText;
        });
      }
      setUploadFeedback(failedAudio.length > 0
        ? `Transcription audio partielle: ${transcriptBlocks.length} ok, ${failedAudio.length} en echec.`
        : `${transcriptBlocks.length} audio(s) transcrit(s).`
      );
      setAudioTranscribing(false);
    }

    // Upload des fichiers non-image dans la conversation (PDF, etc.)
    const conversationId = buildSurfaceConversationId(a11ConvId || selectedChatId || undefined, surfaceKind) || undefined;
    const nonImageFiles = allFiles.filter((f) => !f.type.startsWith('image/'));
    if (nonImageFiles.length > 0) {
      const uploaded: string[] = [];
      const failed: string[] = [];
      setUploadFeedback(`Import de ${nonImageFiles.length} fichier(s) en cours...`);
      for (const file of nonImageFiles) {
        try {
          await uploadConversationFile(file, { conversationId });
          uploaded.push(file.name);
        } catch (error_) {
          console.warn("[A11] file upload failed", file.name, error_);
          failed.push(file.name);
        }
      }
      if (conversationId) {
        await refreshConversationActivity(conversationId);
        await refreshConversationResources(conversationId);
      }
      if (uploaded.length && failed.length) {
        setUploadFeedback(`Import partiel: ${uploaded.length} ok, ${failed.length} en echec.`);
      } else if (uploaded.length) {
        setUploadFeedback(`${uploaded.length} fichier(s) rattaché(s) à la conversation.`);
      } else if (failed.length) {
        setUploadFeedback(`Echec import: ${failed.join(", ")}`);
      }
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    await handleImportedFiles(files);
    e.target.value = "";
  }

  async function onComposerDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer?.files || null;
    await handleImportedFiles(files);
  }

  // New conversation handler
  function newConversation() {
    // create new chat entry and select it
    const newChat = buildFreshChat(`Conversation ${chats.length + 1}`);
    setChats((prev) => [newChat, ...prev]);
    setSelectedChatId(newChat.id);
    setA11ConvId(null);
    setA11ConvMsgs([]);
    setMessages(newChat.messages);
    setInput("");
    setConversationActivity([]);
    setConversationResources([]);
    setActivityError("");
    setUploadFeedback("");
    setSidebarOpen(false);
  }

  // Global drag-and-drop overlay
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCounterRef.current += 1;
      setIsDragOver(true);
    };
    const onDragLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDragOver(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  // Speech recognition callback
  useEffect(() => {
    initSpeech((txt: string, isFinal?: boolean) => {
      if (isFinal) {
        setInput(""); // vide l'input
        sendMessage(txt); // envoie direct le texte reconnu
      } else {
        setInput(() => txt);
      }
    }, { lang: selectedA11Language.speechLang });
  }, [selectedA11Language.speechLang]);

  function normalizeOutgoingMessageKey(value: string) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Modifie la fonction sendMessage pour accepter un texte forcé

  function extractImageUrlsFromText(text: string): { cleanText: string; imageUrls: string[] } {
    const imageUrls: string[] = [];
    const cleanText = text
      .replace(/\[image:([^\]]+)\]/g, (_match, url) => { imageUrls.push(url.trim()); return ''; })
      .replace(/\[image-data:(data:image\/[^;]+;base64,[^\]]+)\]/g, (_match, dataUrl) => { imageUrls.push(dataUrl.trim()); return ''; })
      .trim();
    return { cleanText, imageUrls };
  }
  // File d'attente : l'utilisateur peut écrire pendant qu'A11 réfléchit
  async function sendMessage(forcedText?: string) {
    const text = (forcedText ?? input).trim();
    const { cleanText: cleanedInput, imageUrls } = extractImageUrlsFromText(text);
    const allImageUrls = imageUrls.map((u) => resolveApiAssetUrl(u) || u).filter(Boolean);
    const previewImageUrl = allImageUrls[0] ?? "";
    const sourceImageUrl = previewImageUrl || undefined;
    const effectiveText = cleanedInput || (sourceImageUrl ? "Image jointe." : text);
    if (!effectiveText) return;
    const submitKey = normalizeOutgoingMessageKey(`${effectiveText}\n${sourceImageUrl || ""}`);
    const now = Date.now();
    if (
      submitKey
      && pendingMessageKeyRef.current === submitKey
      && now - pendingSubmitAtRef.current < 2500
    ) {
      console.info("[A11] duplicate message submit ignored", submitKey);
      return;
    }
    pendingMessageKeyRef.current = submitKey;
    pendingSubmitAtRef.current = now;
    void unlockAudioOutput();

    // Afficher le message utilisateur immédiatement : sans bloquer l'input
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: effectiveText,
      imageUrl: previewImageUrl || null,
      imageUrls: allImageUrls.length > 1 ? allImageUrls : null,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => {
      const nm = [...prev, userMsg];
      updateChatMessages(selectedChatId, nm);
      return nm;
    });
    setInput("");
    setDragPreviewUrls((prev) => {
      prev.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
      return [];
    });
    setPreviewCarouselIndex(0);

    if (isLastImageRecallRequest(effectiveText)) {
      const lastMedia = findLastVisibleMedia(messages);
      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: lastMedia
          ? (lastMedia.kind === "image" ? "Oui, la voici." : "Oui, je te la remets ici.")
          : "Je n'ai pas encore d'image affichable dans cette conversation.",
        imageUrl: lastMedia?.kind === "image" ? lastMedia.url : null,
        videoUrl: lastMedia?.kind === "video" ? lastMedia.url : null,
        fileUrl: lastMedia?.kind === "file" ? lastMedia.url : null,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => {
        const nm = [...prev, aiMsg];
        updateChatMessages(selectedChatId, nm);
        return nm;
      });
      return;
    }

    const suggestion = suggestConsoleCommandForDiagnosticRequest(effectiveText);
    if (suggestion) openAdminConsoleWithSuggestedCommand(suggestion.command, suggestion.reason);

    // Si A11 traite déjà, mettre en file : l'utilisateur peut continuer à écrire
    if (queueProcessingRef.current) {
      messageQueueRef.current.push(effectiveText);
      return;
    }

    // Sinon démarrer le traitement
    void processMessageQueue(effectiveText, sourceImageUrl);
  }

  async function processMessageQueue(firstText: string, firstImageUrl?: string) {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    setSending(true);
    startActivity();

    const toProcess: Array<{ text: string; imageUrl?: string }> = [
      { text: firstText, imageUrl: firstImageUrl },
    ];

    while (toProcess.length > 0) {
      const item = toProcess.shift()!;
      const messageKey = normalizeOutgoingMessageKey(item.text);
      const now = Date.now();
      if (
        messageKey
        && lastCompletedMessageRef.current.key === messageKey
        && now - lastCompletedMessageRef.current.at < 10000
      ) {
        // Drainer la queue avant de continuer
        while (messageQueueRef.current.length > 0) {
          toProcess.push({ text: messageQueueRef.current.shift()! });
        }
        continue;
      }

      pendingMessageKeyRef.current = messageKey;

      // Lire l'historique courant via ref pour éviter les closures périmées
      let currentMessages: ChatMessage[] = [];
      setMessages((prev) => { currentMessages = prev; return prev; });
      await new Promise<void>((r) => setTimeout(r, 0));
      setMessages((prev) => { currentMessages = prev; return prev; });

      try {
        const history = sanitizeConversationHistoryForModel(currentMessages);
        const provider: Provider = resolvedChatModelChoice.provider;
        const assistantReply = await chatCompletionDetailed(
          history,
          provider,
          {
            model: resolvedChatModelChoice.model,
            systemPrompt: systemPrompt,
            conversationId: buildSurfaceConversationId(selectedChatId || undefined, surfaceKind) || undefined,
            providerProfileId: resolvedChatModelChoice.providerProfileId,
            surface: surfaceKind,
            persona: surfaceKind,
            voicePersona: surfaceKind,
            sourceImageUrl: item.imageUrl,
          }
        );
        const normalizedAssistant = normalizeAssistantMessagePayload(
          String(assistantReply.content || ""),
          assistantReply.imageUrl || null,
          assistantReply.videoUrl || null,
          assistantReply.fileUrl || null
        );
        detectAndPushFromResponse(assistantReply.raw || assistantReply);

        const aiMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: normalizedAssistant.content,
          imageUrl: normalizedAssistant.imageUrl,
          videoUrl: normalizedAssistant.videoUrl,
          fileUrl: normalizedAssistant.fileUrl,
          qflushVerification: assistantReply.qflushVerification || normalizedAssistant.qflushVerification || null,
          ts: assistantReply.createdAt || new Date().toISOString(),
        };
        setMessages((prev) => {
          const nm = [...prev, aiMsg];
          updateChatMessages(selectedChatId, nm);
          return nm;
        });
        await refreshConversationActivity(selectedChatId || a11ConvId);
        await refreshConversationResources(selectedChatId || a11ConvId);

        const spokenText = String(normalizedAssistant.content || assistantReply.content || "");
        const mobileAudioNeedsGesture = isCompactLayout && !isAudioOutputUnlocked();
        const effectiveVocalMode = ttsVocalMode;
        if (shouldAutoplayAssistantMessage(spokenText) && !mobileAudioNeedsGesture) {
          setPendingMobileSpeech("");
          speak(spokenText, {
            lang: selectedA11Language.speechLang,
            voiceReferenceId: speechVoiceReferenceId || undefined,
            vocalMode: effectiveVocalMode,
            audioFormat: "mp3",
            latencyMode: "interactive",
            voiceConversion: false,
            persona: surfaceKind,
            voicePersona: surfaceKind,
            voiceReferenceRequired: true,
            useDefaultVoiceReference: true,
            allowBrowserSpeechFallback: true,
            provider: effectiveTtsProviderMode === "auto" ? undefined : effectiveTtsProviderMode,
            ttsProvider: effectiveTtsProviderMode,
          });
        } else if (mobileAudioNeedsGesture) {
          setPendingMobileSpeech(spokenText);
          setAudioBlockedUrl(null);
          setMicStatusMessage("Voix mobile prête: touche le bouton lecture pour lancer le son.");
        }
        lastCompletedMessageRef.current = { key: messageKey, at: Date.now() };
      } catch (err: any) {
        lastCompletedMessageRef.current = { key: "", at: 0 };
        const errMsg: ChatMessage = {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Erreur lors de l'appel au chat A11 : " + (err?.message || err),
          ts: new Date().toISOString(),
        };
        setMessages((prev) => {
          const nm = [...prev, errMsg];
          updateChatMessages(selectedChatId, nm);
          return nm;
        });
      }

      // Absorber les messages arrivés pendant ce traitement
      while (messageQueueRef.current.length > 0) {
        toProcess.push({ text: messageQueueRef.current.shift()! });
      }
    }

    queueProcessingRef.current = false;
    sendLockRef.current = false;
    pendingMessageKeyRef.current = "";
    setSending(false);
    stopActivity();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function toggleMic() {
    console.log("[A11] toggleMic clicked, current voiceListening=", voiceListening);
    if (micStarting) {
      console.log("[A11] toggle ignored while mic is starting");
      return;
    }
    if (mobileVoiceReady && !voiceListening) {
      void unlockAudioOutput();
      if (audioBlockedUrl) {
        retryPlayUrl(audioBlockedUrl);
        setAudioBlockedUrl(null);
        setMicStatusMessage("");
        return;
      }
      const text = pendingMobileSpeech.trim();
      if (text) {
        setPendingMobileSpeech("");
        setMicStatusMessage("");
        const effectiveVocalMode = ttsVocalMode;
        speak(text, {
          lang: selectedA11Language.speechLang,
          voiceReferenceId: speechVoiceReferenceId || undefined,
          vocalMode: effectiveVocalMode,
          audioFormat: "mp3",
          latencyMode: "interactive",
          voiceConversion: false,
          persona: surfaceKind,
          voicePersona: surfaceKind,
          voiceReferenceRequired: true,
          useDefaultVoiceReference: true,
          allowBrowserSpeechFallback: true,
          provider: effectiveTtsProviderMode === "auto" ? undefined : effectiveTtsProviderMode,
          ttsProvider: effectiveTtsProviderMode,
        });
        return;
      }
    }
    void unlockAudioOutput();
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition ||
      (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (toggleLockRef.current) {
        console.log("[A11] toggle ignored due to lock");
        return;
      }
      toggleLockRef.current = true;
      setTimeout(() => { toggleLockRef.current = false; }, 600);
      // fallback: toggle TTS-only mode
      setMicPermissionBlocked(false);
      setMicStatusMessage("Reconnaissance vocale non disponible sur ce navigateur. Mode voix sortie uniquement.");
      setTtsFallback((v) => {
        const next = !v;
        // keep voiceListening false when using fallback
        if (next) {
          // enable TTS playback
          console.log("[A11] SpeechRecognition not available - enabling TTS-only mode");
        } else {
          console.log("[A11] Disabling TTS-only mode");
        }
        return next;
      });
      return;
    }

    if (voiceListening) {
      try { stopMic(); } catch { };
      setVoiceListening(false);
      setMicStatusMessage("");
    } else {
      try {
        setMicStarting(true);
        setMicStatusMessage("");
        await startMic({ lang: selectedA11Language.speechLang });
        setMicPermissionBlocked(false);
        setTtsFallback(false);
        setVoiceListening(true);
      } catch (e) {
        setVoiceListening(false);
        setMicPermissionBlocked(true);
        setTtsFallback(true);
        setMicStatusMessage("Micro bloqué ou indisponible. Mode voix sortie actif; autorise le micro dans le cadenas du site pour dicter.");
        try {
          localStorage.setItem('a11:tts-only', '1');
        } catch {
          // ignore storage access errors
        }
        console.info('startMic unavailable, keeping TTS-only mode', e);
      } finally {
        setMicStarting(false);
      }
    }
  }

  function toggleTtsOnly() {
    if (toggleLockRef.current) {
      console.log('[A11] toggleTtsOnly ignored due to lock');
      return;
    }
    toggleLockRef.current = true;
    setTimeout(() => { toggleLockRef.current = false; }, 600);
    const next = !ttsFallback;
    setTtsFallback(next);
    if (next) {
      setVoiceListening(false);
      setMicStarting(false);
    }
    console.log('[A11] toggleTtsOnly ->', next);
    if (next) {
      localStorage.setItem('a11:tts-only', '1');
    } else {
      localStorage.removeItem('a11:tts-only');
    }
  }

  // Rename chat
  function renameChat(id: string) {
    const c = chats.find(x => x.id === id);
    if (!c) return;
    setRenameDialog({ id, currentName: c.name });
  }

  // Delete chat
  function deleteChat(id: string) {
    setDeleteDialogChatId(id);
  }

  function confirmDeleteChat() {
    const id = deleteDialogChatId;
    if (!id) return;
    setChats(prev => {
      const next = prev.filter(x => x.id !== id);
      if (next.length === 0) {
        const initial = buildFreshChat("Session actuelle");
        setSelectedChatId(initial.id);
        setMessages(initial.messages);
        setA11ConvId(null);
        setA11ConvMsgs([]);
        setConversationActivity([]);
        setConversationResources([]);
        return [initial];
      }
      // select first if deleted was selected
      if (selectedChatId === id) {
        setSelectedChatId(next[0].id);
        setMessages(next[0].messages);
      }
      return next;
    });
    setDeleteDialogChatId(null);
  }

  // Le system prompt est géré côté backend (system_prompt.txt)
  // Le frontend n'envoie pas de prompt système : évite l'exposition dans les DevTools
  const systemPrompt = resolveClientSystemPrompt();

  // Initialisation globale des helpers voix au montage pour garantir le son
  useEffect(() => {
    const win = globalThis as any;
    const normalizeConsoleSurface = (value?: string | null): FunesterieSurface => (
      value ? normalizeConversationSurface(value) : surfaceKind
    );
    const defaultVoiceTextForSurface = (surface: FunesterieSurface) => {
      if (surface === "vivy") return "Je suis Vivy. Ma voix officielle est prete cote Funesterie.";
      if (surface === "kaen44") return "Je suis Kaen44. Ma voix officielle est prete cote Funesterie.";
      return "Je suis A11. Ma voix officielle est prete cote Funesterie.";
    };
    const testVoice = (surfaceOrText?: string, maybeText?: string, extraOptions?: Record<string, unknown>) => {
      const first = String(surfaceOrText || "").trim();
      const firstAsSurface = /^(a11|k44|kaen44|vivy)$/i.test(first);
      const targetSurface = normalizeConsoleSurface(firstAsSurface ? first : undefined);
      const text = String(firstAsSurface ? maybeText : first || maybeText || "").trim()
        || defaultVoiceTextForSurface(targetSurface);
      const vocalMode = targetSurface === "vivy" ? "adaptive" : ttsVocalMode;
      const voiceOptions: Record<string, unknown> = {
        lang: selectedA11Language.speechLang,
        voice: targetSurface === "kaen44" ? "kaen44" : targetSurface,
        persona: targetSurface,
        surface: targetSurface,
        voicePersona: targetSurface,
        provider: "xtts-rvc",
        ttsProvider: "xtts-rvc",
        audioFormat: "mp3",
        responseFormat: "mp3",
        latencyMode: "interactive",
        vocalMode,
        voiceConversion: true,
        useDefaultVoiceReference: true,
        defaultVoiceReference: true,
        voiceReferenceRequired: true,
        referenceVoiceRequired: true,
        allowBrowserSpeechFallback: true,
        ...(targetSurface === "vivy" ? getVivyVoiceTuning(vocalMode) : {}),
        ...(extraOptions || {}),
      };
      void unlockAudioOutput();
      speak(text, voiceOptions);
      return {
        ok: true,
        surface: targetSurface,
        voice: voiceOptions.voice,
        vocalMode,
        text,
      };
    };

    win.speak = speak;
    win.a11 = {
      ...(win.a11 || {}),
      voice: {
        ...(win.a11?.voice || {}),
        test: testVoice,
        stop: cancelSpeech,
        default(surface?: string) {
          const targetSurface = normalizeConsoleSurface(surface);
          try {
            localStorage.removeItem(getVoiceReferenceStorageKey(targetSurface));
            if (targetSurface === "vivy") {
              localStorage.removeItem(getVivyVoiceReferenceStorageKey());
              const draft = readVivyStudioDraft();
              if (draft && typeof draft === "object") {
                writeVivyStudioDraft({
                  ...(draft as Record<string, unknown>),
                  voiceTool: "Voix Vivy officielle",
                  voiceFileName: "",
                  voiceReferenceId: "",
                });
              }
            }
            if (targetSurface === surfaceKind) {
              setSelectedVoiceReferenceId("");
            }
          } catch {
            // Storage can be blocked in private contexts.
          }
          return { ok: true, surface: targetSurface, label: getDefaultVoiceReferenceLabel(targetSurface) };
        },
      },
      chat: {
        ...(win.a11?.chat || {}),
        surface: surfaceKind,
        counts: surfaceChatCounts,
        open(surface?: string) {
          const targetSurface = normalizeConsoleSurface(surface);
          window.location.assign(buildSessionBridgeUrl(getSurfaceChatHref(targetSurface, surfaceLinks)));
          return { ok: true, surface: targetSurface };
        },
      },
      surface: surfaceKind,
    };
  }, [
    selectedA11Language.speechLang,
    surfaceChatCounts,
    surfaceKind,
    surfaceLinks,
    ttsVocalMode,
  ]);

  // Chargement de l'historique backend au montage
  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession || isResetRoute) return;
    refreshA11History();
  }, [hasPrivateSession, isResetRoute, isFunesteriePublicShell]);

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession || isResetRoute || isKaen44) return;
    if (!hasAuthenticatedAdminApiAccess()) {
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      return;
    }
    refreshRemoteAiProfiles();
  }, [hasPrivateSession, isResetRoute, isKaen44, isFunesteriePublicShell]);

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession) return;
    if (activeView !== 'chat') return;
    refreshConversationActivity(currentConversationId);
    refreshConversationResources(currentConversationId);
  }, [hasPrivateSession, activeView, currentConversationId, isFunesteriePublicShell]);

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession) return;
    if (activeView !== 'admin' || adminSection !== 'memory') return;
    if (!hasAdminApiAccess()) {
      setTechnicalMemoSummary(null);
      setTechnicalMemoError("");
      return;
    }
    refreshTechnicalMemoSummary();
  }, [hasPrivateSession, activeView, adminSection, isFunesteriePublicShell]);

  useEffect(() => {
    if (!uploadFeedback) return;
    if (imageJobActive) return;
    const timeout = globalThis.setTimeout(() => setUploadFeedback(""), 5000);
    return () => globalThis.clearTimeout(timeout);
  }, [uploadFeedback, imageJobActive]);

  useEffect(() => {
    const onQueued = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      setImageJobActive(true);
      const seconds = Math.max(1, Math.round(Number(detail.pollIntervalMs || 5000) / 1000));
      setUploadFeedback(`Génération image en cours... vérification toutes les ${seconds}s.`);
    };
    const onDone = () => {
      setImageJobActive(false);
      setUploadFeedback("Image prête.");
    };
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      setImageJobActive(false);
      setUploadFeedback(`Génération image interrompue: ${String(detail.message || detail.error || "erreur inconnue")}`);
    };

    window.addEventListener("a11:image-job.queued", onQueued);
    window.addEventListener("a11:image-job.done", onDone);
    window.addEventListener("a11:image-job.failed", onFailed);
    return () => {
      window.removeEventListener("a11:image-job.queued", onQueued);
      window.removeEventListener("a11:image-job.done", onDone);
      window.removeEventListener("a11:image-job.failed", onFailed);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const pathname = window.location.pathname.toLowerCase();
      setActiveView(pathname.includes("/casino") ? "casino" : "chat");
      setSettingsMenuOpen(false);
      setSidebarOpen(false);
      setInspectorOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Handler pour rafraîchir la liste de l'historique
  async function refreshA11History() {
    if (isFunesteriePublicShell || !hasPrivateSession) {
      setA11History([]);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const list = await fetchA11HistoryList({ surface: surfaceKind });
      setA11History(list);
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setA11History([]);
        return;
      }
      console.warn('[A11] failed to refresh history', error_);
      setA11History([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function refreshTechnicalMemoSummary() {
    if (isFunesteriePublicShell || !hasPrivateSession || !hasAdminApiAccess()) {
      setTechnicalMemoSummary(null);
      setTechnicalMemoError("");
      return;
    }
    setLoadingTechnicalMemos(true);
    setTechnicalMemoError("");
    try {
      const payload = await fetchTechnicalMemoSummary();
      setTechnicalMemoSummary(payload?.summary || null);
    } catch (error_) {
      if (isAuthInvalidError(error_)) {
        setTechnicalMemoSummary(null);
        setTechnicalMemoError("");
        return;
      }
      const message = (error_ as Error).message || String(error_);
      setTechnicalMemoError(message);
      setTechnicalMemoSummary(null);
    } finally {
      setLoadingTechnicalMemos(false);
    }
  }

  // Handler pour ouvrir/restaurer une conversation backend
  async function handleOpenA11Conversation(convId: string) {
    setA11ConvId(convId);
    setA11ConvMsgs([]);
    setUploadFeedback("");
    setLoadingHistory(true);
    try {
      const conv = await fetchA11Conversation(convId, { surface: surfaceKind });
      const normalizedMessages = mapBackendConversationMessages(conv.messages || []);
      const displayConversationName = stripSurfaceConversationId(convId) || convId;
      setA11ConvMsgs(normalizedMessages);
      openChatView();
      setSelectedChatId(convId);
      setMessages(normalizedMessages);
      setChats((prev) => {
        const existing = prev.find((chat) => chat.id === convId);
        if (existing) {
          return prev.map((chat) =>
            chat.id === convId
              ? { ...chat, name: existing.name || convId, messages: normalizedMessages, updated: Date.now() }
              : chat
          );
        }
        return [
          {
            id: convId,
            name: displayConversationName === 'default' ? 'Session par défaut' : displayConversationName,
            updated: Date.now(),
            messages: normalizedMessages,
          },
          ...prev,
        ];
      });
      setSidebarOpen(false);
    } catch (error_) {
      console.warn('[A11] failed to open conversation', error_);
      setA11ConvMsgs([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handlePurgeMemoryNow() {
    if (purgingMemory) return;
    setPurgingMemory(true);
    setPurgeConfirmOpen(false);
    setPurgeFeedback('Purge en cours...');
    try {
      const result = await purgeMemoryNow({ dryRun: memoryPurgeDryRun });
      const effectiveRemoved = result.dryRun ? (result.wouldRemove || { facts: 0, tasks: 0, files: 0 }) : result.removed;
      const removedTotal = effectiveRemoved.facts + effectiveRemoved.tasks + effectiveRemoved.files;
      setPurgeFeedback(
        result.dryRun
          ? `Dry run OK (${removedTotal} candidats) - facts ${effectiveRemoved.facts}, tasks ${effectiveRemoved.tasks}, files ${effectiveRemoved.files}`
          : `Purge OK (${removedTotal} supprimes) - facts ${result.before.facts}->${result.after.facts}, tasks ${result.before.tasks}->${result.after.tasks}, files ${result.before.files}->${result.after.files}`
      );
      setPurgeHistory((prev) => [
        {
          at: result.purgeTriggeredAt,
          dryRun: !!result.dryRun,
          removed: {
            facts: effectiveRemoved.facts,
            tasks: effectiveRemoved.tasks,
            files: effectiveRemoved.files,
          },
        },
        ...prev,
      ].slice(0, 10));
    } catch (err) {
      setPurgeFeedback(`Echec purge: ${(err as Error).message || String(err)}`);
    } finally {
      setPurgingMemory(false);
    }
  }

  async function handlePurgeTechnicalMemos() {
    if (purgingTechnicalMemos) return;
    if (!hasAdminApiAccess()) {
      setTechnicalMemoError("admin_required");
      setTechnicalMemoFeedback("Suppression impossible: accès admin requis.");
      return;
    }
    setPurgingTechnicalMemos(true);
    setTechnicalMemoConfirmOpen(false);
    setTechnicalMemoFeedback("Réinitialisation de la mémoire non cruciale en cours...");
    setTechnicalMemoError("");

    try {
      const result = await purgeTechnicalMemos();
      const removedEntries = Number(result?.removedEntries || 0);
      const removedFiles = Number(result?.removedFiles || 0);
      setTechnicalMemoFeedback(
        removedEntries > 0
          ? `Mémoire non cruciale réinitialisée. ${removedEntries} entrée(s), ${removedFiles} fichier(s).`
          : "La mémoire non cruciale était déjà vide."
      );
      setTechnicalMemoSummary({
        total: 0,
        byType: {},
        latestTs: null,
        oldestTs: null,
      });
      await refreshTechnicalMemoSummary();
    } catch (error_) {
      const message = (error_ as Error).message || String(error_);
      setTechnicalMemoError(message);
      setTechnicalMemoFeedback(`Suppression impossible: ${message}`);
    } finally {
      setPurgingTechnicalMemos(false);
    }
  }

  async function handleClearAllConversationHistory() {
    if (clearingHistory) return;

    setClearingHistory(true);
    setClearHistoryConfirmOpen(false);
    setLoadingHistory(true);
    setUploadFeedback("Suppression de l'historique en cours...");
    setActivityError("");
    setResourceError("");
    setAudioBlockedUrl(null);
    cancelSpeech();

    const freshChat = buildFreshChat("Session actuelle");
    let feedback = "Historique local efface.";

    try {
      const result = await clearA11History(undefined, { surface: surfaceKind });
      const removedCount = Number(result?.removedConversations || 0);
      feedback = removedCount > 0
        ? `Historique supprime. ${removedCount} conversation(s) A-11 effacee(s).`
        : "Historique supprime. Cote A-11, il n'y avait plus rien a effacer.";
    } catch (error_) {
      const errorMessage = (error_ as Error).message || String(error_);
      feedback = `Historique local efface, mais la purge A-11 a echoue: ${errorMessage}`;
    }

    try {
      localStorage.removeItem(chatStorageKey);
    } catch {
      // ignore storage access errors
    }

    setChats([freshChat]);
    setSelectedChatId(freshChat.id);
    setMessages(freshChat.messages);
    setInput("");
    setA11ConvId(null);
    setA11ConvMsgs([]);
    setA11History([]);
    setConversationActivity([]);
    setConversationResources([]);
    setUploadFeedback(feedback);
    setSidebarOpen(false);
    setInspectorOpen(false);
    setActiveView("chat");

    try {
      await refreshA11History();
    } finally {
      setLoadingHistory(false);
      setClearingHistory(false);
    }
  }

  async function handleDeleteSingleA11ConversationHistory() {
    const convId = String(deleteA11HistoryId || "").trim();
    if (!convId || deletingA11HistoryId) return;

    setDeleteA11HistoryId(null);
    setDeletingA11HistoryId(convId);
    setUploadFeedback("Suppression de la conversation A-11...");

    try {
      await clearA11History(convId, { surface: surfaceKind });

      const remainingChats = chats.filter((chat) => chat.id !== convId);
      const shouldResetActiveConversation = a11ConvId === convId || selectedChatId === convId;

      setA11History((prev) => prev.filter((item) => item.id !== convId));
      setChats(remainingChats);

      if (shouldResetActiveConversation) {
        const fallbackChat = remainingChats[0] || buildFreshChat("Session actuelle");
        setChats(remainingChats.length ? remainingChats : [fallbackChat]);
        setSelectedChatId(fallbackChat.id);
        setMessages(fallbackChat.messages);
        setA11ConvId(null);
        setA11ConvMsgs([]);
        setConversationActivity([]);
        setConversationResources([]);
      }

      setUploadFeedback("Conversation A-11 supprimee.");
      await refreshA11History();
    } catch (error_) {
      setUploadFeedback(`Suppression impossible: ${(error_ as Error).message || String(error_)}`);
    } finally {
      setDeletingA11HistoryId(null);
    }
  }

  function openAdminConsoleWithSuggestedCommand(command: string, reason: string) {
    const normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) return;

    setConsoleSuggestion({
      command: normalizedCommand,
      reason: String(reason || "").trim() || "Commande preparee par A11.",
      nonce: Date.now(),
    });
    setActiveView("admin");
    setAdminSection("console");
    setSettingsMenuOpen(false);
    setSidebarOpen(false);
  }

  function pushA11Path(pathname: string) {
    try {
      const target = pathname || "/";
      if (window.location.pathname !== target) {
        window.history.pushState({}, "", target);
      }
    } catch {
      // Navigation history is best-effort in embedded surfaces.
    }
  }

  function openCasinoView() {
    setActiveView("casino");
    setSettingsMenuOpen(false);
    setSidebarOpen(false);
    setInspectorOpen(false);
    pushA11Path(buildSurfacePath(isKaen44 ? "kaen44" : "a11", "/casino"));
  }

  function focusComposerSoon() {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
      });
    }, 0);
  }

  function openChatView() {
    setActiveView("chat");
    setSettingsMenuOpen(false);
    setSidebarOpen(false);
    setInspectorOpen(false);
    pushA11Path(buildSurfacePath(isKaen44 ? "kaen44" : "a11", isKaen44 ? "/cockpit" : "/"));
    focusComposerSoon();
  }

  async function copyMessageToClipboard(
    message: ChatMessage,
    options: {
      roleLabel: string;
      index: number;
      timestamp?: string;
      exportSuggestion?: AssistantExportSuggestion | null;
    }
  ) {
    const messageId = message.id || `message-${options.index}`;
    const text = buildChatMessageClipboardText(message, options);
    try {
      await writeClipboardText(text);
      setCopiedMessageId(messageId);
      if (copyMessageFeedbackTimerRef.current) {
        globalThis.clearTimeout(copyMessageFeedbackTimerRef.current);
      }
      copyMessageFeedbackTimerRef.current = globalThis.setTimeout(() => {
        setCopiedMessageId((current) => current === messageId ? null : current);
      }, 1600);
    } catch {
      setUploadFeedback("Copie impossible depuis ce navigateur. Sélectionne le message manuellement.");
    }
  }

  function openKaenQuickPrompt(prompt: string) {
    setInput(String(prompt || "").trim());
    openChatView();
  }

  function handlePublicLogout() {
    setDisplayName("Utilisateur");
    setIsAuthenticated(false);
    setIsFunesterieAdmin(false);
    void logoutAllSessions();
  }

  // Header avec bouton Mode DEV centré, select modèle à droite, mute à l'extrême droite

  // Check authentication
  const currentPathnameForRender = typeof window !== "undefined" ? window.location.pathname.toLowerCase() : "/";
  const isResetRouteActive = isResetRoute
    || currentPathnameForRender.includes('/reset-password')
    || currentPathnameForRender.includes('/reset');
  const requiresPrivateSurface = !isFunesteriePublicShell && !isResetRouteActive;

  if (isResetRouteActive) {
    return <ResetPasswordPanel />;
  }

  if (isGeneralHome || isGeneralCockpit || isGeneralAgents) {
    return (
      <FunesterieConnectedHomePage
        surfaceLinks={surfaceLinks}
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
        isAdmin={isFunesterieAdmin}
      />
    );
  }

  if (isGeneralArchitecture) {
    return (
      <FunesterieArchitecturePage
        surfaceLinks={surfaceLinks}
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
      />
    );
  }

  if (isGeneralAccount) {
    return (
      <FunesterieAccountPage
        surfaceLinks={surfaceLinks}
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
      />
    );
  }

  if (isGeneralContact) {
    return (
      <FunesterieContactPage
        surfaceLinks={surfaceLinks}
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
      />
    );
  }

  if (isGeneralPrivacy) {
    return (
      <FunesterieLegalPage
        surfaceLinks={surfaceLinks}
        kind="privacy"
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
      />
    );
  }

  if (isGeneralTerms) {
    return (
      <FunesterieLegalPage
        surfaceLinks={surfaceLinks}
        kind="terms"
        authenticated={isAuthenticated}
        displayName={displayName}
        onLogout={handlePublicLogout}
      />
    );
  }

  if (isGeneralLogin) {
    if (isAuthenticated && typeof window !== "undefined") {
      window.location.replace(buildSessionBridgeUrl(getRequestedLoginReturnTo()));
      return null;
    }

    return <LoginPanel onLoginSuccess={() => {
      setIsAuthenticated(true);
      setIsFunesterieAdmin(hasAuthenticatedAdminApiAccess());
    }} />;
  }

  if (isVivy && !authSessionReady && !isAuthSuccessRoute(currentPathnameForRender)) {
    return <FunesteriePrivateGateLoading surface="vivy" />;
  }

  if (isVivy && !hasPrivateSession && !isAuthSuccessRoute(currentPathnameForRender)) {
    if (typeof window !== "undefined" && !isCentralLoginSurface() && !isLocalSurfaceHost(window.location.hostname)) {
      const redirectKey = 'a11_login_redirect_at';
      const lastRedirect = Number(sessionStorage.getItem(redirectKey) || 0);
      if (Date.now() - lastRedirect > 10000) {
        sessionStorage.setItem(redirectKey, String(Date.now()));
        window.location.replace(buildCentralLoginUrl(window.location.href));
        return <FunesteriePrivateGateLoading surface="vivy" />;
      }
    }

    return <LoginPanel onLoginSuccess={() => {
      setIsAuthenticated(true);
      setIsFunesterieAdmin(hasAuthenticatedAdminApiAccess());
    }} />;
  }

  if (requiresPrivateSurface && !authSessionReady) {
    return <FunesteriePrivateGateLoading surface={surfaceKind} />;
  }

  if (requiresPrivateSurface && !hasPrivateSession) {
    if (isAuthSuccessRoute(currentPathnameForRender)) {
      return <FunesteriePrivateGateLoading surface={surfaceKind} />;
    }

    if (typeof window !== "undefined" && !isCentralLoginSurface() && !isLocalSurfaceHost(window.location.hostname)) {
      // Anti-loop: only redirect once per page load
      const redirectKey = 'a11_login_redirect_at';
      const lastRedirect = Number(sessionStorage.getItem(redirectKey) || 0);
      if (Date.now() - lastRedirect > 10000) {
        sessionStorage.setItem(redirectKey, String(Date.now()));
        window.location.replace(buildCentralLoginUrl(window.location.href));
        return <FunesteriePrivateGateLoading surface={surfaceKind} />;
      }
    }

    return <LoginPanel onLoginSuccess={() => {
      setIsAuthenticated(true);
      setIsFunesterieAdmin(hasAuthenticatedAdminApiAccess());
    }} />;
  }

  if (isVivy) {
    if (!authSessionReady) return null;
    if (!isAuthenticated) {
      if (typeof window !== "undefined" && !isCentralLoginSurface() && !isLocalSurfaceHost(window.location.hostname)) {
        window.location.replace(buildCentralLoginUrl(window.location.href));
        return null;
      }
      return <LoginPanel onLoginSuccess={() => {
        setIsAuthenticated(true);
        setIsFunesterieAdmin(hasAuthenticatedAdminApiAccess());
      }} />;
    }
    return <VivyPublicPage authenticated={hasPrivateSession} displayName={displayName} />;
  }

  if (!isAuthenticated) {
    const pathname = typeof window !== "undefined" ? window.location.pathname.toLowerCase() : "/";
    const search = typeof window !== "undefined" ? window.location.search.toLowerCase() : "";
    const forceLoginPanel = isLoginRoute(pathname)
      || isCockpitRoute(pathname)
      || search.includes("error=")
      || search.includes("show=1")
      || search.includes("login=1")
      || search.includes("cockpit=1");
    if (isKaen44 && !forceLoginPanel && !isAuthSuccessRoute(pathname)) {
      return (
        <FunesterieConnectedHomePage
          surfaceLinks={surfaceLinks}
          authenticated={isAuthenticated}
          displayName={displayName}
          onLogout={handlePublicLogout}
          isAdmin={isFunesterieAdmin}
        />
      );
    }

    if (isAuthSuccessRoute(pathname)) {
      return null;
    }

    if (typeof window !== "undefined" && !isCentralLoginSurface() && !isLocalSurfaceHost(window.location.hostname)) {
      window.location.replace(buildCentralLoginUrl(window.location.href));
      return null;
    }

    return <LoginPanel onLoginSuccess={() => {
      setIsAuthenticated(true);
      setIsFunesterieAdmin(hasAuthenticatedAdminApiAccess());
    }} />;
  }

  if (isKaen44 && typeof window !== "undefined") {
    const pathname = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    const wantsApp = isCockpitRoute(pathname)
      || isLoginRoute(pathname)
      || isAuthSuccessRoute(pathname)
      || search.includes("app=1")
      || search.includes("cockpit=1")
      || search.includes("show=1");
    if (!wantsApp && isFunesterieHomeRoute(pathname)) {
      return (
        <FunesterieConnectedHomePage
          surfaceLinks={surfaceLinks}
          authenticated={isAuthenticated}
          displayName={displayName}
          onLogout={handlePublicLogout}
          isAdmin={isFunesterieAdmin}
        />
      );
    }
  }

  const userDisplayName = String(displayName || "").trim() || "Utilisateur";
  const inspectorBadgeCount = conversationResources.length + conversationActivity.length;
  const utilityButtonStyle: React.CSSProperties = {
    padding: isCompactLayout ? "7px 8px" : "8px 12px",
    borderRadius: isKaen44 ? 10 : 7,
    border: isKaen44 ? "1px solid rgba(245, 158, 11, 0.28)" : "1px solid rgba(45, 212, 191, 0.24)",
    background: isKaen44 ? "#1b100c" : "rgba(2, 12, 18, 0.88)",
    color: isKaen44 ? "#f8e4c7" : "#d8f3f0",
    cursor: "pointer",
    fontSize: isCompactLayout ? 11.5 : 13,
    fontWeight: 600,
    minHeight: isCompactLayout ? 38 : 44,
    whiteSpace: "nowrap",
  };
  const quickChatButtonStyle: React.CSSProperties = {
    ...utilityButtonStyle,
    border: "1px solid transparent",
    background: isKaen44
      ? "linear-gradient(135deg, #f59e0b, #e11d48)"
      : "linear-gradient(135deg, #14b8a6, #a3e635)",
    color: isKaen44 ? "#170c07" : "#041018",
    boxShadow: isKaen44
      ? "0 12px 26px rgba(225, 29, 72, 0.22)"
      : "0 12px 26px rgba(20, 184, 166, 0.18)",
    fontWeight: 900,
  };
  const sessionButtonStyle: React.CSSProperties = sidebarOpen
    ? {
      ...quickChatButtonStyle,
      background: isKaen44
        ? "linear-gradient(135deg, #f97316, #be123c)"
        : "linear-gradient(135deg, #2dd4bf, #38bdf8)",
      boxShadow: isKaen44
        ? "0 12px 26px rgba(249, 115, 22, 0.18)"
        : "0 12px 26px rgba(56, 189, 248, 0.16)",
    }
    : utilityButtonStyle;
  const headerLinkButtonStyle: React.CSSProperties = {
    ...utilityButtonStyle,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const headerSelectStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: isKaen44 ? 10 : 7,
    background: isKaen44 ? "#20130e" : "#04121a",
    color: "#e5e7eb",
    border: isKaen44 ? "1px solid rgba(245, 158, 11, 0.24)" : "1px solid rgba(45, 212, 191, 0.24)",
    fontSize: 13,
    minHeight: 40,
    minWidth: isCompactLayout ? 132 : 172,
    maxWidth: isCompactLayout ? 160 : 220,
  };
  const menuSectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#8b9bb4",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: 700,
  };
  const a11TitleStyle: React.CSSProperties = {
    fontWeight: 900,
    fontSize: isCompactLayout ? 17 : 22,
    lineHeight: 1,
    letterSpacing: 0.6,
    whiteSpace: "nowrap",
    background: isKaen44
      ? "linear-gradient(135deg, #fff7ed 0%, #f6c177 30%, #ef4444 62%, #be123c 100%)"
      : "linear-gradient(135deg, #d8f3f0 0%, #22d3ee 36%, #a3e635 100%)",
    WebkitBackgroundClip: "text",
    color: "transparent",
    textShadow: isKaen44 ? "0 0 24px rgba(239, 68, 68, 0.22)" : "0 0 24px rgba(20, 184, 166, 0.22)",
  };
  const activeAdminBorder = isKaen44 ? "#f59e0b" : "#14b8a6";
  const inactiveAdminBorder = isKaen44 ? "rgba(245, 158, 11, 0.18)" : "#1f2937";
  const activeAdminBackground = isKaen44 ? "rgba(245, 158, 11, 0.16)" : "rgba(20, 184, 166, 0.16)";
  const activeAdminColor = isKaen44 ? "#fed7aa" : "#ccfbf1";
  const adminTabButtonStyle = (section: AdminSection): React.CSSProperties => ({
    padding: isCompactLayout ? "8px 10px" : "9px 12px",
    borderRadius: 999,
    border: `1px solid ${adminSection === section ? activeAdminBorder : inactiveAdminBorder}`,
    background: adminSection === section
      ? activeAdminBackground
      : (isKaen44 ? "#1b100c" : "#0b1220"),
    color: adminSection === section
      ? activeAdminColor
      : (isKaen44 ? "#e7c8a2" : "#cbd5e1"),
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  });

  return (
    <div
      className={`app-container a11-shell ${isKaen44 ? "kaen-shell" : "alpha-shell"}`}
      style={{
        minHeight: '100vh',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
        background: isKaen44 ? '#130d0b' : '#02080c',
      }}
    >
      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div
          className="a11-drop-overlay"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounterRef.current = 0;
            setIsDragOver(false);
            void handleImportedFiles(e.dataTransfer?.files || null);
          }}
        >
          <div className="a11-drop-overlay-inner">
            <div className="a11-drop-overlay-icon">FILE</div>
            <div className="a11-drop-overlay-label">Depose ici</div>
            <div className="a11-drop-overlay-hint">Images, texte, JSON, PDF...</div>
          </div>
        </div>
      )}
      <header
        className="header"
        style={{
          width: "100%",
          minHeight: isCompactLayout ? 54 : 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isCompactLayout ? "8px 10px" : "10px 20px",
          borderBottom: isKaen44 ? "1px solid rgba(245, 158, 11, 0.16)" : "1px solid rgba(45, 212, 191, 0.14)",
          background: isKaen44 ? "#160f0c" : "#041018",
          backgroundImage: isKaen44
            ? "linear-gradient(90deg, rgba(190, 18, 60, 0.18), rgba(22, 15, 12, 0.9) 42%, rgba(245, 158, 11, 0.1))"
            : "linear-gradient(90deg, rgba(20, 184, 166, 0.16), rgba(4, 16, 24, 0.96) 38%, rgba(163, 230, 53, 0.08))",
          zIndex: settingsMenuOpen ? 90 : 50,
          gap: isCompactLayout ? 8 : 12,
          flexWrap: "nowrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: isCompactLayout ? 8 : 16, minWidth: 0, flex: "0 1 auto" }}>
          <div
            id="a11-avatar"
            style={{
              position: "relative",
              width: isCompactLayout ? 38 : 56,
              height: isCompactLayout ? 38 : 56,
              borderRadius: isKaen44 ? 999 : 14,
              overflow: "hidden",
              boxShadow: isKaen44
                ? "0 0 0 1px rgba(245, 158, 11, 0.42), 0 0 22px rgba(225, 29, 72, 0.38)"
                : "0 0 0 1px rgba(45, 212, 191, 0.42), 0 0 18px rgba(34, 211, 238, 0.32)",
              flexShrink: 0,
              zIndex: 2,
              transition: `box-shadow ${activePortraitTransitionMs}ms ease`,
            }}
          >
            <img
              id="a11-avatar-frame"
              src={isKaen44 ? KAEN44_AVATAR_SRC : A11_HOODED_AGENT_SRC}
              alt={isKaen44 ? "Kaen44" : "A11"}
              loading="eager"
              onError={(event) => applyImageFallback(
                event,
                isKaen44 ? KAEN44_AVATAR_SRC : A11_HOODED_AGENT_SRC
              )}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 1,
                transform: activePortraitFrame?.transform || "scale(1)",
                filter: activePortraitFrame?.filter || "none",
                transition: `transform ${activePortraitTransitionMs}ms ease, filter ${activePortraitTransitionMs}ms ease`,
                pointerEvents: "none",
                willChange: audioPlaying || sending ? "transform, filter" : "auto",
              }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={a11TitleStyle}>{isKaen44 ? "Kaen44" : "A11"}</div>
            {!isCompactLayout ? (
              <div style={{ fontSize: 12, color: isKaen44 ? "#e7c8a2" : "#8bd9d0" }}>{isKaen44 ? "Copilote au quotidien" : "Agent média audio & vidéo"}</div>
            ) : null}
          </div>
        </div>
        <div
          className="a11-header-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: isCompactLayout ? 6 : 8,
            marginLeft: "auto",
            flex: "1 1 auto",
            minWidth: 0,
            justifyContent: "flex-end",
            flexWrap: "nowrap",
          }}
        >
          <a
            href={surfaceLinks.home}
            style={headerLinkButtonStyle}
            title="Retour à l'accueil Funesterie"
          >
            Accueil
          </a>
          <button
            type="button"
            onClick={() => {
              setSettingsMenuOpen(false);
              setSidebarOpen((value) => !value);
            }}
            style={sessionButtonStyle}
            aria-pressed={sidebarOpen}
            title={`${sidebarOpen ? "Fermer" : "Ouvrir"} les sessions et l'historique`}
          >
            Session
          </button>
          <div ref={settingsMenuRef} style={{ position: "relative", flex: "0 1 auto", minWidth: 0 }}>
            <button
              type="button"
              onClick={() => {
                setSettingsMenuOpen((value) => {
                  const next = !value;
                  if (next && isCompactLayout) {
                    setSidebarOpen(false);
                    setInspectorOpen(false);
                  }
                  return next;
                });
              }}
              style={utilityButtonStyle}
              title="Afficher les reglages"
            >
              {settingsMenuOpen ? "Fermer" : "Menu"}
            </button>
            {settingsMenuOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Fermer le menu"
                  onClick={() => setSettingsMenuOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    border: "none",
                    padding: 0,
                    margin: 0,
                    background: "rgba(2, 6, 23, 0.46)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                    zIndex: 70,
                    cursor: "default",
                  }}
                />
                <div
                  style={{
                    position: isCompactLayout ? "fixed" : "absolute",
                    right: isCompactLayout ? 8 : 0,
                    left: isCompactLayout ? 8 : "auto",
                    top: isCompactLayout ? 72 : "calc(100% + 10px)",
                    width: isCompactLayout ? "auto" : 320,
                    maxWidth: "calc(100vw - 16px)",
                    maxHeight: isCompactLayout ? "calc(100dvh - 88px)" : "calc(100vh - 88px)",
                    borderRadius: 16,
                    border: "1px solid #1f2937",
                    background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
                    boxShadow: "0 18px 48px rgba(2, 6, 23, 0.58)",
                    padding: 14,
                    zIndex: 80,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    overflowY: "auto",
                    overflowX: "hidden",
                    overscrollBehavior: "contain",
                    paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Modele</div>
                    <select
                      id="a11-chat-model"
                      name="chatModel"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      style={{ ...headerSelectStyle, width: "100%", maxWidth: "100%" }}
                    >
                      {chatModelChoices.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Langue</div>
                    <select
                      id="a11-chat-language"
                      name="a11Language"
                      value={a11Language}
                      onChange={(e) => setA11Language(normalizeA11LanguageCode(e.target.value))}
                      style={{ ...headerSelectStyle, width: "100%", maxWidth: "100%" }}
                      title="Langue du chat, du micro, de la transcription et de la voix"
                    >
                      {A11_LANGUAGE_CHOICES.map((choice) => (
                        <option key={choice.code} value={choice.code}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.35 }}>
                      Chat, micro, transcription audio et voix {productName} utilisent cette langue.
                    </div>
                    <div className="a11-menu-voice-tools" aria-label="Réglages voix">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={onVoiceReferenceClick}
                        disabled={voiceReferenceControlsDisabled}
                        title="Ajouter une référence vocale WAV/MP3/WEBM"
                      >
                        Ref
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={onDefaultVoiceReferenceClick}
                        disabled={voiceReferenceControlsDisabled}
                        title={`Revenir à la voix ${defaultVoiceReferenceLabel} par défaut`}
                      >
                        Défaut ref
                      </button>
                      <button
                        type="button"
                        className={`btn ghost ${ttsVocalMode === "sing" ? "active" : ""}`}
                        onClick={() => setTtsVocalMode((mode) => mode === "sing" ? "adaptive" : "sing")}
                        title={ttsVocalMode === "sing" ? "Mode chant actif" : "Activer le mode chant"}
                      >
                        {ttsVocalMode === "sing" ? "Chant actif" : "Chant"}
                      </button>
                    </div>
                    <div className="a11-menu-voice-current">
                      Réf active: {voiceReferenceControlsDisabled ? "connexion requise" : activeVoiceReferenceLabel}
                    </div>
                    {voiceReferenceStatus ? (
                      <div className="a11-menu-voice-status">{voiceReferenceStatus}</div>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Options</div>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectorOpen((value) => !value);
                        if (isCompactLayout) setSettingsMenuOpen(false);
                      }}
                      className="btn ghost"
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                      title="Afficher les ressources et l'activite de conversation"
                    >
                      <span>Panneau conversation</span>
                      <span style={{ color: "#94a3b8", fontWeight: 700 }}>
                        {inspectorOpen ? "Ouvert" : (inspectorBadgeCount ? `${inspectorBadgeCount}` : "Ferme")}
                      </span>
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Agents</div>
                    <div className="fun-agent-menu-grid">
                      {agentShortcuts.map((agent) => (
                        <a
                          key={agent.id}
                          href={agent.href}
                          className={`fun-agent-menu-card fun-agent-menu-card--${agent.id}`}
                          title={`Ouvrir ${agent.name}`}
                        >
                          <img src={agent.image} alt="" />
                          <span>
                            <strong>{agent.name}</strong>
                            <small>{agent.role}</small>
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Services</div>
                    <button
                      type="button"
                      onClick={openChatView}
                      className="btn ghost"
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                    >
                      <span>Chat</span>
                      <span style={{ color: "#94a3b8", fontWeight: 700 }}>Direct</span>
                    </button>
                    {!isKaen44 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView("admin");
                          setAdminSection("ai");
                          setSettingsMenuOpen(false);
                          setSidebarOpen(false);
                        }}
                        className="btn ghost"
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                      >
                        <span>Aides connectees</span>
                        <span style={{ color: "#94a3b8", fontWeight: 700 }}>{remoteProviderProfiles.length}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("admin");
                        setAdminSection("cockpit");
                        setSettingsMenuOpen(false);
                        setSidebarOpen(false);
                      }}
                      className="btn ghost"
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                    >
                      <span>{isKaen44 ? "Services" : "Pilotage"}</span>
                      <span style={{ color: "#94a3b8", fontWeight: 700 }}>{isKaen44 ? "Client" : "A11"}</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Abonnement</div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView("admin");
                        setAdminSection("subscription");
                        setSettingsMenuOpen(false);
                        setSidebarOpen(false);
                      }}
                      className="btn ghost"
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                    >
                      <span>Plan</span>
                      <span style={{ color: "#94a3b8", fontWeight: 700 }}>Compte</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Compte</div>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        setDisplayName("Utilisateur");
                        void logoutAllSessions();
                        const freshChat = buildFreshChat("Session actuelle");
                        setChats([freshChat]);
                        setSelectedChatId(freshChat.id);
                        setMessages(freshChat.messages);
                        setA11ConvId(null);
                        setA11ConvMsgs([]);
                        setA11History([]);
                        setConversationActivity([]);
                        setConversationResources([]);
                        setActivityError("");
                        setResourceError("");
                        setUploadFeedback("");
                        setPurgeHistory([]);
                        setIsAuthenticated(false);
                      }}
                      className="btn ghost"
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        color: "#fecaca",
                        borderColor: "#991b1b",
                      }}
                      title="Se deconnecter de Funesterie partout"
                    >
                      <span>Se deconnecter</span>
                      <span style={{ fontWeight: 700 }}>Global</span>
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <div className="a11-body" style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {isCompactLayout && sidebarOpen ? (
          <button
            type="button"
            aria-label="Fermer le panneau de navigation"
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(2, 6, 23, 0.72)',
              border: 'none',
              zIndex: 25,
            }}
          />
        ) : null}

        {sidebarOpen ? (
          <aside
            className="sidebar"
            style={{
              width: isCompactLayout ? '100vw' : 300,
              borderRight: isKaen44 ? "1px solid rgba(245, 158, 11, 0.16)" : "1px solid #22293a",
              background: isKaen44 ? "#160f0c" : "#041018",
              display: 'flex',
              flexDirection: 'column',
              minWidth: isCompactLayout ? '100vw' : 300,
              maxWidth: isCompactLayout ? '100vw' : 300,
              position: isCompactLayout ? 'absolute' : 'relative',
              inset: isCompactLayout ? '0 auto 0 0' : 'auto',
              zIndex: 30,
              boxShadow: isCompactLayout ? '18px 0 42px rgba(2, 6, 23, 0.55)' : 'none',
            }}
          >
            {/* Bloc conversations locales */}
            <div style={{ borderBottom: '1px solid #22293a', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 4px 16px' }}>
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  Conversations {FUNESTERIE_SURFACE_LABELS[surfaceKind]}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={newConversation} className="btn ghost" style={{ fontSize: 13, padding: '2px 10px' }}>+ Nouveau</button>
                  <button
                    type="button"
                    onClick={() => setClearHistoryConfirmOpen(true)}
                    className="btn ghost"
                    disabled={clearingHistory}
                    title={`Supprimer toutes les conversations locales et l'historique ${productName}`}
                    style={{
                      fontSize: 12,
                      padding: '2px 10px',
                      color: '#fca5a5',
                      borderColor: '#7f1d1d',
                      opacity: clearingHistory ? 0.6 : 1,
                    }}
                  >
                    {clearingHistory ? "..." : "Vider tout"}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, padding: '4px 16px 8px' }}>
                {FUNESTERIE_CHAT_SURFACES.map((surface) => {
                  const active = surface === surfaceKind;
                  const href = getSurfaceChatHref(surface, surfaceLinks);
                  const content = (
                    <>
                      <span>{FUNESTERIE_SURFACE_LABELS[surface]}</span>
                      <small style={{ opacity: 0.78 }}>{surfaceChatCounts[surface] || 0}</small>
                    </>
                  );
                  const sharedStyle: React.CSSProperties = {
                    minHeight: 32,
                    borderRadius: 7,
                    border: active ? `1px solid ${activeAdminBorder}` : `1px solid ${inactiveAdminBorder}`,
                    background: active ? activeAdminBackground : "rgba(2, 8, 14, 0.72)",
                    color: active ? activeAdminColor : "#cbd5e1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    padding: "0 8px",
                    fontSize: 12,
                    fontWeight: 800,
                    textDecoration: "none",
                  };
                  return active ? (
                    <span key={surface} style={sharedStyle} aria-current="page">{content}</span>
                  ) : (
                    <a key={surface} href={buildSessionBridgeUrl(href)} style={sharedStyle}>{content}</a>
                  );
                })}
              </div>
              <div>
                {chats.map(chat => (
                  <div
                    key={chat.id}
                    style={{
                      fontWeight: chat.id === selectedChatId ? "bold" : "normal",
                      background: chat.id === selectedChatId ? "#22293a" : "transparent",
                      padding: '6px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderRadius: 6,
                      margin: '2px 8px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        openChatView();
                        setSelectedChatId(chat.id);
                        setMessages(chat.messages);
                        setA11ConvId(null);
                        setA11ConvMsgs([]);
                        setSidebarOpen(false);
                      }}
                      className="btn ghost"
                      style={{ flex: 1, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      {chat.name}
                    </button>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button onClick={e => { e.stopPropagation(); renameChat(chat.id); }} title="Renommer" className="btn ghost" style={{ fontSize: 12, minWidth: 44, minHeight: 36 }}>Edit</button>
                      <button onClick={e => { e.stopPropagation(); deleteChat(chat.id); }} title="Supprimer" className="btn ghost" style={{ fontSize: 12, minWidth: 44, minHeight: 36 }}>Del</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* Historique backend */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  Historique {productName}
                </span>
                <button
                  onClick={refreshA11History}
                  className="btn ghost"
                  style={{ minWidth: 44, minHeight: 36, height: 36, padding: "0 8px", fontSize: 11 }}
                >
                  Raf.
                </button>
              </div>
              {loadingHistory ? (
                <div className="p-3 text-xs text-slate-400">Chargement...</div>
              ) : (
                <A11HistoryPanel
                  items={a11History}
                  activeId={a11ConvId}
                  onSelect={handleOpenA11Conversation}
                  onDelete={(id) => setDeleteA11HistoryId(id)}
                  deletingId={deletingA11HistoryId}
                />
              )}
            </div>
          </aside>
        ) : null}

        <main className="main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeView === 'casino' ? (
            <CasinoHub
              isCompactLayout={isCompactLayout}
              onBackToChat={openChatView}
            />
          ) : activeView === 'admin' ? (
            <div
              className="admin-scroll-panel"
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: isCompactLayout ? 12 : 20,
              }}
            >
              <div style={{ width: '100%', maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {(!isKaen44 || adminSection === 'subscription') ? (
                  <div
                    style={{
                      border: '1px solid #1f2937',
                      borderRadius: 16,
                      background: '#0b1220',
                      padding: isCompactLayout ? 14 : 18,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700, color: '#8b9bb4' }}>
                          {isKaen44 ? "Kaen44" : "Espace pilotage"}
                        </div>
                        <h2 style={{ margin: '6px 0 0', color: '#e2e8f0' }}>{isKaen44 ? "Compte" : "Pilotage A11"}</h2>
                        {!isKaen44 ? (
                          <p style={{ color: '#94a3b8', margin: '8px 0 0', maxWidth: 720 }}>
                            Les reglages avances restent ici, hors de l'interface principale. La vue chat garde seulement l'usage normal et les outils utiles.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={openChatView}
                        className="btn ghost"
                        style={{ alignSelf: 'flex-start', justifyContent: 'center' }}
                      >
                        Retour au chat
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" onClick={() => setAdminSection('cockpit')} style={adminTabButtonStyle('cockpit')}>
                        {isKaen44 ? "Services" : "Outils"}
                      </button>
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('memory')} style={adminTabButtonStyle('memory')}>
                          Memoire
                        </button>
                      ) : null}
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('runtime')} style={adminTabButtonStyle('runtime')}>
                          Etat
                        </button>
                      ) : null}
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('ai')} style={adminTabButtonStyle('ai')}>
                          Aides
                        </button>
                      ) : null}
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('console')} style={adminTabButtonStyle('console')}>
                          Actions
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setAdminSection('subscription')} style={adminTabButtonStyle('subscription')}>
                        Abonnement
                      </button>
                    </div>
                  </div>
                ) : null}

                {adminSection === 'cockpit' ? (
                  isKaen44 ? (
                    <Kaen44ModulesPanel
                      isCompactLayout={isCompactLayout}
                      onBackToChat={openChatView}
                      onOpenStudio={openCasinoView}
                      onOpenAccount={() => setAdminSection('subscription')}
                      onQuickPrompt={openKaenQuickPrompt}
                    />
                  ) : <A11ControlCenterPanel />
                ) : null}

                {!isKaen44 && adminSection === 'ai' ? (
                  <A11RemoteProvidersPanel
                    profiles={remoteProviderProfiles}
                    loading={loadingRemoteProviders}
                    saving={savingRemoteProvider}
                    deletingId={deletingRemoteProviderId}
                    error={remoteProviderError}
                    selectedProfileId={resolvedChatModelChoice.providerProfileId || null}
                    onRefresh={refreshRemoteAiProfiles}
                    onSave={handleSaveRemoteAiProfile}
                    onDelete={handleDeleteRemoteAiProfile}
                    onSelect={(profileId) => setModel(`remote-profile:${profileId}`)}
                  />
                ) : null}

                {adminSection === 'subscription' ? (
                  <SubscriptionPanel
                    isAdmin={hasAdminApiAccess()}
                    productName={productName}
                    onClose={openChatView}
                  />
                ) : null}

                {!isKaen44 && adminSection === 'memory' ? (
                  <div
                    style={{
                      border: '1px solid #1f2937',
                      borderRadius: 14,
                      background: '#0b1220',
                      padding: isCompactLayout ? 14 : 16,
                    }}
                  >
                    <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: 18 }}>Memoire locale</h3>
                    <p style={{ color: '#94a3b8', margin: '6px 0 0' }}>
                      Purge manuelle et historique des operations locales, isoles dans leur propre sous-categorie.
                    </p>

                    <div style={{
                      marginTop: 16,
                      padding: 14,
                      border: '1px solid #1f2937',
                      borderRadius: 10,
                      background: '#08101d',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 13 }}>
                        <input
                          id="a11-memory-purge-dry-run"
                          name="memoryPurgeDryRun"
                          type="checkbox"
                          checked={memoryPurgeDryRun}
                          onChange={(e) => setMemoryPurgeDryRun(e.target.checked)}
                          disabled={purgingMemory}
                        />
                        Dry run (simulation sans suppression)
                      </label>
                      <button
                        type="button"
                        onClick={() => setPurgeConfirmOpen(true)}
                        disabled={purgingMemory}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          background: purgingMemory ? '#3f2a08' : 'transparent',
                          color: '#fcd34d',
                          cursor: purgingMemory ? 'not-allowed' : 'pointer',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {purgingMemory ? 'Execution...' : 'Lancer purge maintenant'}
                      </button>
                    </div>

                    {purgeFeedback && (
                      <div style={{
                        marginTop: 14,
                        padding: 10,
                        borderRadius: 8,
                        border: `1px solid ${purgeFeedback.startsWith('Echec') ? '#7f1d1d' : '#1e3a8a'}`,
                        background: purgeFeedback.startsWith('Echec') ? '#2a0f0f' : '#0f172a',
                        color: purgeFeedback.startsWith('Echec') ? '#fecaca' : '#bfdbfe',
                        fontSize: 12,
                      }}>
                        {purgeFeedback}
                      </div>
                    )}

                    <div style={{ marginTop: 18 }}>
                      <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: 15 }}>Historique local</h4>
                      {purgeHistory.length === 0 ? (
                        <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 13 }}>Aucune purge locale pour le moment.</div>
                      ) : (
                        <div style={{ marginTop: 8, border: '1px solid #1f2937', borderRadius: 8, overflow: 'hidden' }}>
                          {purgeHistory.map((entry, index) => (
                            <div
                              key={`${entry.at}-${index}`}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(180px, 220px) 120px 1fr',
                                gap: 10,
                                padding: '10px 12px',
                                borderTop: index === 0 ? 'none' : '1px solid #1f2937',
                                background: index % 2 === 0 ? '#0b1220' : '#0a101a',
                                color: '#cbd5e1',
                                fontSize: 12,
                              }}
                            >
                              <span>{new Date(entry.at).toLocaleString()}</span>
                              <span>{entry.dryRun ? 'dryRun' : 'purge'}</span>
                              <span>facts {entry.removed.facts} | tasks {entry.removed.tasks} | files {entry.removed.files}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 20,
                        padding: 14,
                        border: '1px solid #1f2937',
                        borderRadius: 10,
                        background: '#08101d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <div>
                        <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: 15 }}>Mémoire non cruciale</h4>
                        <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: 13 }}>
                          Snapshots techniques admin et traces internes. Cela n&apos;efface pas l&apos;historique global du chat utilisateur ni la mémoire critique.
                        </p>
                      </div>

                      {technicalMemoError ? (
                        <div style={{
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #7f1d1d',
                          background: '#2a0f0f',
                          color: '#fecaca',
                          fontSize: 12,
                        }}>
                          {technicalMemoError}
                        </div>
                      ) : null}

                      {technicalMemoFeedback ? (
                        <div style={{
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #1e3a8a',
                          background: '#0f172a',
                          color: '#bfdbfe',
                          fontSize: 12,
                        }}>
                          {technicalMemoFeedback}
                        </div>
                      ) : null}

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                        gap: 10,
                      }}>
                        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2937', background: '#0b1220', color: '#cbd5e1', fontSize: 12 }}>
                          <div style={{ color: '#8b9bb4', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 11 }}>Entrees</div>
                          <div style={{ marginTop: 6, color: '#e2e8f0', fontSize: 18, fontWeight: 800 }}>
                            {loadingTechnicalMemos ? '...' : (technicalMemoSummary?.total ?? '-')}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2937', background: '#0b1220', color: '#cbd5e1', fontSize: 12 }}>
                          <div style={{ color: '#8b9bb4', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 11 }}>Plus recent</div>
                          <div style={{ marginTop: 6, color: '#e2e8f0' }}>
                            {technicalMemoSummary?.latestTs ? new Date(technicalMemoSummary.latestTs).toLocaleString() : '-'}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2937', background: '#0b1220', color: '#cbd5e1', fontSize: 12 }}>
                          <div style={{ color: '#8b9bb4', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 11 }}>Types</div>
                          <div style={{ marginTop: 6, color: '#e2e8f0' }}>
                            {technicalMemoSummary?.byType && Object.keys(technicalMemoSummary.byType).length
                              ? Object.entries(technicalMemoSummary.byType).map(([type, count]) => `${type} (${count})`).join(' - ')
                              : '-'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={refreshTechnicalMemoSummary}
                          disabled={loadingTechnicalMemos}
                          className="btn ghost"
                          style={{ fontSize: 12 }}
                        >
                          {loadingTechnicalMemos ? 'Actualisation...' : 'Rafraichir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTechnicalMemoConfirmOpen(true)}
                          disabled={purgingTechnicalMemos}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: '1px solid #7f1d1d',
                            background: purgingTechnicalMemos ? '#2a0f0f' : 'transparent',
                            color: '#fca5a5',
                            cursor: purgingTechnicalMemos ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {purgingTechnicalMemos ? 'Réinitialisation...' : 'Réinitialiser la mémoire non cruciale'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {!isKaen44 && adminSection === 'runtime' ? (
                  <>
                    <PinkWardPanel />
                    <A11OpsStatusPanel />
                  </>
                ) : null}
                {!isKaen44 && adminSection === 'console' ? (
                  <div style={{ display: 'grid', gap: 16 }}>
                    <QflushPortableTerminal compact={isCompactLayout} />
                    <A11CommandConsolePanel
                      prefillCommand={consoleSuggestion?.command || null}
                      prefillReason={consoleSuggestion?.reason || null}
                      prefillNonce={consoleSuggestion?.nonce || 0}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div ref={chatScrollFrameRef} className="scroll-frame" style={{ margin: isCompactLayout ? 8 : (isKaen44 ? 12 : 10) }}>
                <div className="log">
                  <PersonaDashboard
                    isKaen44={isKaen44}
                    displayName={userDisplayName}
                    currentConversationId={currentConversationId}
                    messageCount={messages.filter((message) => message.role !== "system").length}
                    resourceCount={conversationResources.length}
                    activityCount={conversationActivity.length}
                    onStartChat={openChatView}
                    onOpenAdmin={() => {
                      if (!isKaen44) {
                        setInspectorOpen(true);
                        return;
                      }
                      setActiveView("admin");
                      setAdminSection("cockpit");
                      setSidebarOpen(false);
                    }}
                    onOpenStudio={openCasinoView}
                    onOpenInspector={() => setInspectorOpen(true)}
                  />
                  {messages.filter((message) => message.role !== "system").map((m, idx) => {
                    const exportSuggestion = m.role === "assistant" ? detectAssistantExportSuggestion(m.content) : null;
                    let messageClassName = "message ";
                    let roleLabel = productName;
                    let roleStyle: React.CSSProperties = {
                      color: "#9fb3c8",
                    };
                    if (m.role === "user") {
                      messageClassName = "message user";
                      roleLabel = userDisplayName;
                      roleStyle = {
                        color: "#facc15",
                        textShadow: "0 0 14px rgba(250, 204, 21, 0.18)",
                      };
                    } else if (m.role === "assistant") {
                      messageClassName = "message assistant";
                      roleLabel = productName;
                      roleStyle = {
                        color: isKaen44 ? "#f6c177" : "#67e8f9",
                        textShadow: isKaen44
                          ? "0 0 16px rgba(245, 158, 11, 0.22)"
                          : "0 0 16px rgba(103, 232, 249, 0.22)",
                      };
                    }
                    const contentNode = m.role === "assistant"
                      ? (
                        <ReactMarkdown
                          components={{
                            a: ({ node: _node, ref: _ref, ...props }: any) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noreferrer"
                              />
                            ),
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      )
                      : <div>{m.content}</div>;
                    const messageTimestamp = formatChatMessageTimestamp(m.ts);
                    const messageCopyId = m.id || `message-${idx}`;
                    const messageCopied = copiedMessageId === messageCopyId;

                    return (
                      <div
                        key={m.id || idx}
                        className={messageClassName}
                      >
                        <div className="message-head">
                          <div className="role" style={roleStyle}>{roleLabel}</div>
                          <div className="message-head-actions">
                            {messageTimestamp ? (
                              <div
                                className="message-timestamp"
                                style={{
                                  fontSize: 11,
                                  color: "#64748b",
                                  letterSpacing: 0.2,
                                }}
                              >
                                {messageTimestamp}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className={`message-copy-action${messageCopied ? " message-copy-action--copied" : ""}`}
                              onClick={() => {
                                void copyMessageToClipboard(m, {
                                  roleLabel,
                                  index: idx,
                                  timestamp: messageTimestamp,
                                  exportSuggestion,
                                });
                              }}
                              title="Copier tout le message, fichiers et médias visibles compris"
                            >
                              {messageCopied ? "Copié" : "Copier"}
                            </button>
                          </div>
                        </div>
                        {m.role === "assistant" && m.qflushVerification?.suspicious ? (
                          <div
                            style={{
                              marginTop: 10,
                              marginBottom: 10,
                              padding: "10px 12px",
                              borderRadius: 10,
                              border: "1px solid #f59e0b",
                              background: "rgba(120, 53, 15, 0.22)",
                              color: "#fef3c7",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                color: "#fbbf24",
                              }}
                            >
                              Réponse non vérifiée
                            </div>
                            <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>
                              {String(m.qflushVerification.summary || "Cette réponse a été marquée comme douteuse par le garde-fou local.")}
                            </div>
                          </div>
                        ) : null}
                        {contentNode}
                        {(() => {
                          // Carousel si plusieurs images, sinon affichage simple
                          const imgs = m.imageUrls && m.imageUrls.length > 1
                            ? m.imageUrls
                            : m.imageUrl ? [m.imageUrl] : [];
                          if (imgs.length === 0) return null;
                          if (imgs.length === 1) {
                            return (
                              <div className="msg-image">
                                <button
                                  type="button"
                                  className="image-preview-trigger"
                                  onClick={() => setPreviewImageUrl(imgs[0])}
                                  aria-label="Agrandir l'image"
                                >
                                  <img src={imgs[0]} alt={`Resultat ${productName}`} style={{ maxWidth: "320px", borderRadius: 12 }} />
                                  <span style={{ fontSize: 12, color: "#93c5fd" }}>Agrandir l'image</span>
                                </button>
                              </div>
                            );
                          }
                          // Carousel multi-images
                          return (
                            <MsgImageCarousel
                              images={imgs}
                              onExpand={(url) => setPreviewImageUrl(url)}
                            />
                          );
                        })()}
                        {m.videoUrl && !m.imageUrl && (
                          <div
                            style={{
                              marginTop: 12,
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            {/\.gif(?:[?#].*)?$/i.test(String(m.videoUrl || "")) ? (
                              <a
                                href={m.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: "inline-block", width: "fit-content" }}
                              >
                                <img
                                  src={m.videoUrl}
                                  alt={`Animation generee par ${productName}`}
                                  style={{ maxWidth: "320px", borderRadius: 12 }}
                                />
                              </a>
                            ) : (
                              <video
                                src={m.videoUrl}
                                controls
                                preload="metadata"
                                playsInline
                                style={{ maxWidth: "320px", borderRadius: 12, background: "#020617" }}
                              />
                            )}
                            <a
                              href={m.videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 12,
                                color: "#93c5fd",
                                textDecoration: "none",
                                wordBreak: "break-all",
                              }}
                            >
                              Ouvrir la vidéo
                            </a>
                          </div>
                        )}
                        {m.fileUrl && !m.imageUrl && !m.videoUrl && (
                          <div
                            style={{
                              marginTop: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "12px 14px",
                              borderRadius: 12,
                              border: "1px solid rgba(148, 163, 184, 0.28)",
                              background: "rgba(15, 23, 42, 0.72)",
                            }}
                          >
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: "rgba(59, 130, 246, 0.14)",
                                color: "#93c5fd",
                                fontSize: 16,
                                fontWeight: 800,
                                flexShrink: 0,
                              }}
                            >
                              PDF
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
                                Document généré
                              </div>
                              <a
                                href={m.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: 12,
                                  color: "#93c5fd",
                                  textDecoration: "none",
                                  wordBreak: "break-all",
                                }}
                              >
                                Ouvrir le PDF
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} aria-hidden="true" />
                </div>
              </div>

              <div
                className="composer"
                style={{
                  padding: isCompactLayout ? "8px 10px calc(10px + env(safe-area-inset-bottom))" : undefined,
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  void onComposerDrop(e);
                }}
              >
                {/* Console d'activite */}
                <A11ActivityConsole
                  events={activityEvents}
                  isActive={activityIsActive}
                  productLabel={productName}
                  onClear={clearActivityEvents}
                  collapsed={consoleCollapsed}
                  onToggleCollapse={() => setConsoleCollapsed((v) => !v)}
                />
                <div className="row a11-composer-row">
                  <button
                    type="button"
                    className="btn ghost import-inline"
                    onClick={onImportClick}
                    title="Importer un fichier ou une image"
                    style={{ marginRight: 8, padding: isCompactLayout ? "0 10px" : undefined }}
                  >
                    {isCompactLayout ? "Import" : "Importer"}
                  </button>

                  <div className="a11-input-wrap" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                    <textarea
                      id="a11-chat-composer"
                      name="message"
                      ref={composerInputRef}
                      placeholder={isCompactLayout
                        ? (isKaen44 ? "Message Kaen44..." : "Message A11...")
                        : (isKaen44 ? "Demande quelque chose à Kaen44... (Ctrl+V pour coller une image)" : "Demande quelque chose à A11... (Ctrl+V pour coller une image)")}
                      value={input.replace(/\[image:[^\]]+\]/g, '').replace(/\[image-data:[^\]]+\]/g, '').replace(/\n+/g, '\n').trimStart()}
                      onChange={(e) => {
                        const imageTokens = (input.match(/\[image:[^\]]+\]|\[image-data:[^\]]+\]/g) || []).join('\n');
                        const newText = e.target.value;
                        setInput(imageTokens ? (imageTokens + (newText ? '\n' + newText : '')) : newText);
                        // Auto-resize
                        const el = e.target as HTMLTextAreaElement;
                        el.style.height = 'auto';
                        el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.35) + 'px';
                      }}
                      onKeyDown={handleKeyDown}
                      onPaste={async (e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        // Chercher une image dans le presse-papier (screenshot, copie d'image)
                        const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
                        if (imageItem) {
                          e.preventDefault();
                          const file = imageItem.getAsFile();
                          if (file) {
                            const renamedFile = new File([file], `paste-${Date.now()}.png`, { type: file.type });
                            const fileList = Object.assign([renamedFile], { item: (i: number) => [renamedFile][i] }) as unknown as FileList;
                            await handleImportedFiles(fileList);
                          }
                          return;
                        }
                        // Chercher des fichiers collés (depuis l'explorateur)
                        const fileItems = Array.from(items).filter(item => item.kind === 'file' && !item.type.startsWith('image/'));
                        if (fileItems.length > 0) {
                          e.preventDefault();
                          const files = fileItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                          if (files.length > 0) {
                            const fileList = Object.assign(files, { item: (i: number) => files[i] }) as unknown as FileList;
                            await handleImportedFiles(fileList);
                          }
                        }
                        // Sinon laisser le paste texte normal se faire
                      }}
                      rows={1}
                      style={{
                        width: '100%',
                        resize: 'none',
                        minHeight: isCompactLayout ? '44px' : '42px',
                        maxHeight: isCompactLayout ? '22vh' : '35vh',
                        background: '#0d0f13',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: 10,
                        overflowY: 'auto',
                        lineHeight: '1.5',
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    className="send-button"
                    onClick={() => sendMessage()}
                    disabled={!input.trim()}
                    title="Entrée pour envoyer, Shift+Entrée pour aller à la ligne"
                    style={sending ? { opacity: 0.7 } : undefined}
                  >
                    {sending
                      ? (messageQueueRef.current.length > 0 ? `+${messageQueueRef.current.length}` : "...")
                      : "Envoyer"
                    }
                  </button>

                  <EkkoIndicator />

                  <button
                    type="button"
                    className={`nossen-mic-btn inline ${(voiceListening || micStarting || audioPlaying) ? "listening" : ""}`}
                    onClick={toggleMic}
                    disabled={micStarting}
                    aria-pressed={voiceListening}
                    aria-label={mobileVoiceReady ? `Jouer la voix ${productName}` : micPermissionBlocked ? "Micro bloqué" : voiceListening ? "Arrêter le micro" : "Démarrer le micro"}
                    title={mobileVoiceReady ? `Jouer la voix ${productName}` : micPermissionBlocked ? "Micro bloqué par le navigateur" : voiceListening ? "Arrêter le micro" : "Démarrer le micro"}
                    style={{
                      marginLeft: 8,
                      opacity: micPermissionBlocked ? 0.78 : 1,
                      borderColor: micPermissionBlocked ? "#7f1d1d" : undefined,
                      color: micPermissionBlocked ? "#fecaca" : undefined,
                    }}
                  >
                    {micStarting ? "..." : mobileVoiceReady ? "Play" : voiceListening ? "ON" : micPermissionBlocked ? "!" : "MIC"}
                  </button>
                </div>
                <div className="hint">
                  Entrée pour envoyer - Shift+Entrée pour aller à la ligne - Ctrl+V pour coller une image
                  {micStatusMessage && (
                    <span style={{ marginLeft: 8, color: micPermissionBlocked ? '#fca5a5' : '#93c5fd', fontWeight: 600 }}>
                      {micStatusMessage}
                    </span>
                  )}
                  {sending && messageQueueRef.current.length > 0 && (
                    <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 600 }}>
                      {messageQueueRef.current.length} message{messageQueueRef.current.length > 1 ? 's' : ''} en attente
                    </span>
                  )}
                  {voiceReferenceStatus && (
                    <span style={{ marginLeft: 8, color: "#93c5fd", fontWeight: 600 }}>
                      {voiceReferenceStatus}
                    </span>
                  )}
                  {uploadFeedback && (
                    <span style={{ marginLeft: 8, color: imageJobActive ? "#f59e0b" : "#93c5fd", fontWeight: 600 }}>
                      {uploadFeedback}
                    </span>
                  )}
                </div>
                {dragPreviewUrls.length > 0 && (() => {
                  const total = dragPreviewUrls.length;
                  const idx = Math.min(previewCarouselIndex, total - 1);
                  const p = dragPreviewUrls[idx];
                  return (
                    <div className="a11-drop-carousel">
                      {/* Thumbnail ou icône */}
                      <div className="a11-drop-carousel-media">
                        {p.isImage
                          ? <img src={p.url} alt={p.name} className="a11-drop-carousel-img" />
                          : <span className="a11-drop-carousel-file-icon">FILE</span>
                        }
                      </div>

                      {/* Infos + navigation */}
                      <div className="a11-drop-carousel-info">
                        <span className="a11-drop-carousel-name">{p.name}</span>
                        {total > 1 && (
                          <span className="a11-drop-carousel-counter">{idx + 1}/{total}</span>
                        )}
                      </div>

                      {/* Flèches si plusieurs */}
                      {total > 1 && (
                        <div className="a11-drop-carousel-nav">
                          <button
                            type="button"
                            className="a11-drop-carousel-arrow"
                            aria-label="Image precedente"
                            onClick={() => setPreviewCarouselIndex((i) => (i - 1 + total) % total)}
                          >&lt;</button>
                          <button
                            type="button"
                            className="a11-drop-carousel-arrow"
                            aria-label="Image suivante"
                            onClick={() => setPreviewCarouselIndex((i) => (i + 1) % total)}
                          >&gt;</button>
                        </div>
                      )}

                      {/* Retirer l'image courante */}
                      <button
                        type="button"
                        className="a11-drop-carousel-remove"
                        aria-label={`Retirer ${p.name}`}
                        onClick={() => {
                          if (p.url) URL.revokeObjectURL(p.url);
                          setDragPreviewUrls((prev) => {
                            const next = prev.filter((_, j) => j !== idx);
                            setPreviewCarouselIndex(Math.min(idx, next.length - 1));
                            return next;
                          });
                        }}
                      >X</button>
                    </div>
                  );
                })()}
                <input
                  id="a11-chat-file-input"
                  name="chatFiles"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={onFileChange}
                />
                <input
                  id="a11-chat-voice-reference-input"
                  name="voiceReferenceFile"
                  ref={voiceReferenceInputRef}
                  type="file"
                  accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/ogg,audio/webm,audio/mp4,audio/flac,video/webm,video/quicktime,.mov"
                  style={{ display: 'none' }}
                  onChange={onVoiceReferenceFileChange}
                />
              </div>
            </>
          )}
        </main>

        {inspectorOpen ? (
          <>
            <button
              type="button"
              aria-label="Fermer le panneau conversation"
              onClick={() => setInspectorOpen(false)}
              style={{
                position: 'absolute',
                inset: 0,
                background: isCompactLayout ? 'rgba(2, 6, 23, 0.72)' : 'rgba(2, 6, 23, 0.28)',
                border: 'none',
                zIndex: 35,
              }}
            />
            <aside
              style={{
                position: 'absolute',
                right: isCompactLayout ? 0 : 12,
                top: isCompactLayout ? 0 : 12,
                bottom: isCompactLayout ? 0 : 12,
                width: isCompactLayout ? '100%' : 380,
                background: '#08111d',
                border: '1px solid #1f2937',
                borderRadius: isCompactLayout ? 0 : 18,
                boxShadow: '0 18px 60px rgba(2, 6, 23, 0.48)',
                zIndex: 40,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: isCompactLayout ? '14px 14px 10px' : '14px 16px 10px',
                  borderBottom: '1px solid #1f2937',
                  background: '#0a101a',
                }}
              >
                <div>
                  <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 14 }}>Panneau conversation</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                    {currentConversationId ? `Conversation ${currentConversationId}` : 'Aucune conversation active'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  className="btn ghost"
                  style={{ fontSize: 12, padding: '6px 10px' }}
                >
                  Fermer
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <ConversationActivityPanel
                  conversationId={currentConversationId}
                  entries={conversationActivity}
                  loading={loadingActivity}
                  error={activityError || null}
                  onRefresh={() => refreshConversationActivity(currentConversationId)}
                />
                <ConversationResourcesPanel
                  conversationId={currentConversationId}
                  resources={conversationResources}
                  loading={loadingResources}
                  creatingArtifact={creatingArtifact}
                  error={resourceError || null}
                  uploadFeedback={uploadFeedback || null}
                  onCreateArtifact={openCreateArtifactDialog}
                  onRefresh={() => refreshConversationResources(currentConversationId)}
                  onDownloadResource={handleDownloadResource}
                  downloadingResourceId={downloadingResourceId}
                  onEmailResource={handleEmailResource}
                  emailingResourceId={emailingResourceId}
                />
              </div>
            </aside>
          </>
        ) : null}
      </div>
      {!isCompactLayout && !isKaen44 ? (
        <>
          <AdBanner position="bottom" style={{ margin: '20px auto', maxWidth: '800px' }} />
          <footer className="footer">
            {isKaen44 ? "Kaen44 local - voix - documents - Funesterie" : "A11 - chat - fichiers - voix - creation"}
          </footer>
        </>
      ) : null}
      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      <RenameConversationModal
        open={!!renameDialog}
        currentName={renameDialog?.currentName || ""}
        onClose={() => setRenameDialog(null)}
        onSubmit={(name) => {
          const targetId = renameDialog?.id;
          if (!targetId) return;
          setChats((prev) => prev.map((chat) => chat.id === targetId ? { ...chat, name } : chat));
          setRenameDialog(null);
        }}
      />
      <ConfirmModal
        open={!!deleteDialogChatId}
        title="Supprimer la conversation"
        message="Cette conversation locale sera retirée de la liste actuelle."
        confirmLabel="Supprimer"
        confirmTone="danger"
        onClose={() => setDeleteDialogChatId(null)}
        onConfirm={confirmDeleteChat}
      />
      <ConfirmModal
        open={clearHistoryConfirmOpen}
        title="Supprimer tout l'historique"
        message={`Cette action va vider toutes les conversations locales du navigateur et l'historique ${productName} côté serveur. Une nouvelle session propre sera recréée juste après.`}
        confirmLabel="Tout supprimer"
        confirmTone="danger"
        loading={clearingHistory}
        onClose={() => setClearHistoryConfirmOpen(false)}
        onConfirm={handleClearAllConversationHistory}
      />
      <ConfirmModal
        open={!!deleteA11HistoryId}
        title={`Supprimer cette conversation ${productName}`}
        message={`Cette conversation sera retirée de l'historique ${productName} côté serveur et de la copie locale si elle est ouverte.`}
        confirmLabel="Supprimer"
        confirmTone="danger"
        loading={!!deleteA11HistoryId && deletingA11HistoryId === deleteA11HistoryId}
        onClose={() => setDeleteA11HistoryId(null)}
        onConfirm={handleDeleteSingleA11ConversationHistory}
      />
      <ConfirmModal
        open={purgeConfirmOpen}
        title="Confirmer la purge mémoire"
        message={memoryPurgeDryRun
          ? "Lancer une simulation de purge de la mémoire structurée ?"
          : "Déclencher immédiatement la purge réelle de la mémoire structurée ?"}
        confirmLabel={memoryPurgeDryRun ? "Lancer le dry run" : "Lancer la purge"}
        confirmTone={memoryPurgeDryRun ? "primary" : "danger"}
        loading={purgingMemory}
        onClose={() => setPurgeConfirmOpen(false)}
        onConfirm={handlePurgeMemoryNow}
      />
      <ConfirmModal
        open={technicalMemoConfirmOpen}
        title="Réinitialiser la mémoire non cruciale"
        message="Cette action efface les snapshots techniques locaux d'A11 (env, qflush, journaux memo). Cela ne touche pas l'historique de conversation utilisateur ni la mémoire critique."
        confirmLabel="Reinitialiser"
        confirmTone="danger"
        loading={purgingTechnicalMemos}
        onClose={() => setTechnicalMemoConfirmOpen(false)}
        onConfirm={handlePurgeTechnicalMemos}
      />
      <EmailResourceModal
        resource={emailDialogResource}
        open={!!emailDialogResource}
        submitting={!!emailDialogResource && emailingResourceId === emailDialogResource.id}
        error={emailDialogError || null}
        onClose={closeEmailDialog}
        onSubmit={submitEmailResource}
      />
      <CreateArtifactModal
        open={createArtifactOpen}
        submitting={creatingArtifact}
        error={createArtifactError || null}
        conversationId={currentConversationId}
        messageCount={messages.filter((message) => message.role !== "system").length}
        onClose={closeCreateArtifactDialog}
        onSubmit={submitCreateArtifact}
      />
      {previewImageUrl && (
        <div
          className="image-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Apercu de l'image"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div
            className="image-preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="image-preview-close"
              onClick={() => setPreviewImageUrl(null)}
              aria-label="Fermer l'apercu"
            >
              X
            </button>
            <img
              src={previewImageUrl}
              alt="Apercu agrandi"
              className="image-preview-modal-image"
            />
          </div>
        </div>
      )}
      {audioBlockedUrl && !isCompactLayout && (
        <div style={{
          position: 'fixed',
          bottom: isCompactLayout ? 'calc(92px + env(safe-area-inset-bottom))' : 80,
          left: isCompactLayout ? 12 : '50%',
          right: isCompactLayout ? 12 : 'auto',
          transform: isCompactLayout ? 'none' : 'translateX(-50%)',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
          padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)', zIndex: 9999,
          color: '#e2e8f0', fontSize: 14, whiteSpace: 'normal',
          flexWrap: 'wrap', justifyContent: isCompactLayout ? 'space-between' : 'center',
          maxWidth: 'calc(100vw - 24px)',
        }}>
          <span>Audio bloqué</span>
          <button
            type="button"
            onClick={() => { void unlockAudioOutput(); retryPlayUrl(audioBlockedUrl); setAudioBlockedUrl(null); }}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Jouer
          </button>
          <button
            type="button"
            onClick={() => setAudioBlockedUrl(null)}
            style={{ background: 'none', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
            title="Ignorer"
          >X</button>
        </div>
      )}
    </div>
  );
}

export default App;
