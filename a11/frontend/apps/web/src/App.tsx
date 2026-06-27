import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  clearA11History,
  createTextArtifact,
  deleteRemoteProviderProfile,
  downloadAccountInventoryZip,
  downloadConversationResource,
  downloadResourceById,
  parseA11ResourceDownloadId,
  buildAuthenticatedResourceDownloadPath,
  downloadStoredAccountFile,
  fetchTechnicalMemoSummary,
  fetchA11HistoryList,
  fetchA11Conversation,
  fetchA11ConversationActivity,
  fetchA11ConversationResources,
  disconnectConnector,
  fetchAuthConnectors,
  fetchMcpAccessCatalog,
  fetchMcpCockpitAccount,
  fetchMcpCockpitStatus,
  fetchMatchArenaGames,
  fetchMatchArenaSession,
  fetchMatchArenaSessions,
  fetchMatchArenaStatus,
  fetchMyConversationResources,
  fetchMyStoredFiles,
  fetchProviderHealth,
  fetchRemoteProviderProfiles,
  fetchA11PortraitFramebook,
  fetchTtsVoiceCatalog,
  fetchTtsVoiceReferences,
  fetchAuthSession,
  fetchVivyChatSession,
  fetchVivyChatSessions,
  appendVivyChatSessionMessageOnServer,
  getSubscriptionStatus,
  hasAdminApiAccess,
  hasAuthenticatedAdminApiAccess,
  isAuthInvalidError,
  chatWithVivy,
  createCheckoutSession,
  createCustomerPortal,
  cancelSubscription,
  createMatchArenaSession,
  emailConversationResource,
  clearAuthToken,
  getAuthAccountLanguage,
  getAuthDisplayName,
  getLegacyAuthStorageScopes,
  getAuthStorageScope,
  login,
  loginWithGoogleCredential,
  logoutAllSessions,
  getAuthToken,
  hasAuthToken,
  joinMatchArenaSession,
  register,
  forgotPassword,
  resetPassword,
  getVivyStudioMusicJob,
  extendVivyStudioSunoMusic,
  createVivyChatSessionOnServer,
  deleteVivyChatSessionOnServer,
  assembleVivyStudioVoicePreview,
  mixVivyStudioPreview,
  routeVivyNossenComposition,
  runVivyStudioProduction,
  sendMatchArenaInput,
  startGoogleOAuth,
  setAuthToken,
  startMicrosoftOAuth,
  setAuthDisplayName,
  transcribeAudioFile,
  ttsSpeak,
  fetchVoiceLearningStatus,
  deleteVoiceLearningCorpus,
  uploadVoiceLearningSnippet,
  queueVoiceLearningTraining,
  uploadTtsVoiceReference,
  processDoubleHarmonicAudio,
  saveRemoteProviderProfile,
  purgeMemoryNow,
  purgeTechnicalMemos,
  uploadConversationFile,
  type A11ConversationActivityEntry,
  type A11ConversationResource,
  type A11HistoryItem,
  type A11UserStoredFile,
  type RemoteProviderProfile,
  type RemoteProviderSaveInput,
  type TechnicalMemoSummaryResponse,
  type TtsVoiceReference,
  type VoiceLearningStatus,
  type DoubleHarmonicOutputFormat,
  type DoubleHarmonicProcessMode,
  type DoubleHarmonicProcessResult,
  type VivyChatFileAttachment,
  type VivyChatSessionRecord,
  type A11PortraitFrame,
  type A11PortraitFramebook,
  type AuthConnectorProviderState,
  type AuthConnectorsResponse,
  type McpAccessCapability,
  type McpAccessCatalogResponse,
  type McpAccessTierCard,
  type McpAccountProfile,
  type MatchArenaGame,
  type MatchArenaMode,
  type MatchArenaSession,
  type MatchArenaStatus,
  type SubscriptionStatus,
  type VivyStudioProductionInput,
  type VivyStudioProductionResult,
  fetchUserLibrary,
  pinResourceToLibrary,
  unpinResourceFromLibrary,
  clearVivyMemory,
  chatCompletionDetailed,
  downloadMediaUrl,
  extractAssistantDisplayContent,
  resolveApiAssetUrl,
  type Provider,
  type ProviderHealthResponse,
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
  startMicAudioCapture,
  startMic,
  stopMicAudioCapture,
  stopMic,
  speak,
  type MicAudioCaptureResult,
  cancelSpeech,
  setTtsQueueEnabled,
  setSpeechMuted,
  isSpeechMuted,
  retryPlayUrl,
  unlockAudioOutput,
  isAudioOutputUnlocked,
  setSpeechRecognitionLanguage,
} from "./lib/speech";
import handleImportFiles, { type ImportedConversationAttachment } from "./lib/importer";
import { foldForLookup, toUnicodeLine, toUnicodeText } from "./lib/language";
import { sanitizeMediaDisplayName, sanitizeMediaDisplayNameFromUrl } from "./lib/safe-media-name";
import {
  attachLegacyStaticUiTranslator,
  translateLegacyStaticDocumentTitle,
  translateLegacyStaticUi,
} from "./lib/ui-translation";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  audioUrl?: string | null;
  audioUrls?: string[] | null;
  videoUrl?: string | null;
  videoUrls?: string[] | null;
  fileUrl?: string | null;
  qflushVerification?: {
    suspicious?: boolean;
    summary?: string;
    mode?: string | null;
  } | null;
  ts?: string;
}

type ComposerPreviewKind = "image" | "audio" | "video" | "file";

type ComposerPreviewItem = {
  id: string;
  name: string;
  url: string;
  isImage: boolean;
  mediaKind: ComposerPreviewKind;
  remoteUrl?: string;
};

type QueuedChatItem = {
  text: string;
  imageUrl?: string;
  imageUrls?: string[];
  referenceVisualContext?: string;
  audioUrl?: string;
  audioUrls?: string[];
  videoUrl?: string;
  videoUrls?: string[];
};

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

type TtsProviderMode = "official" | "auto" | "piper" | "openai" | "elevenlabs" | "cartesia";
type A11LanguageCode = "fr" | "en" | "it" | "es" | "de";

const TTS_PROVIDER_MODE_VALUES = new Set<TtsProviderMode>([
  "official",
  "auto",
  "piper",
  "openai",
  "elevenlabs",
  "cartesia",
]);

const CLOUD_TTS_PROVIDER_MODES = new Set<TtsProviderMode>([
  "openai",
  "elevenlabs",
  "cartesia",
]);

const LOCAL_OFFICIAL_TTS_REFERENCE_ENABLED = /^(1|true|yes|on)$/i.test(String(
  import.meta.env?.VITE_A11_ENABLE_LOCAL_OFFICIAL_TTS_REFERENCE
  || import.meta.env?.VITE_A11_ENABLE_OFFICIAL_XTTS_RVC
  || ""
).trim());

function normalizeTtsProviderMode(value: unknown, fallback: TtsProviderMode = "auto"): TtsProviderMode {
  const raw = String(value || "").trim().toLowerCase() as TtsProviderMode;
  if (!TTS_PROVIDER_MODE_VALUES.has(raw)) return fallback;
  if (raw === "official" && !LOCAL_OFFICIAL_TTS_REFERENCE_ENABLED) {
    return fallback === "official" ? "auto" : fallback;
  }
  return raw;
}

function getDefaultTtsProviderMode(_surface: FunesterieSurface): TtsProviderMode {
  return "auto";
}

function getTtsProviderStorageKey(surface: FunesterieSurface) {
  return `a11:tts:provider-mode:v3:${surface}`;
}

function readStoredTtsProviderMode(surface: FunesterieSurface): TtsProviderMode {
  const fallback = getDefaultTtsProviderMode(surface);
  try {
    return normalizeTtsProviderMode(
      localStorage.getItem(getTtsProviderStorageKey(surface)),
      fallback
    );
  } catch {
    return fallback;
  }
}

function isOfficialVoiceSurface(surface: FunesterieSurface) {
  return surface === "a11" || surface === "kaen44" || surface === "vivy";
}

function shouldUseServerPushToTalk(surface: FunesterieSurface) {
  return surface === "a11" || surface === "kaen44";
}

function resolveEffectiveTtsProviderMode(
  providerMode: TtsProviderMode,
  surface: FunesterieSurface
): TtsProviderMode {
  const normalized = normalizeTtsProviderMode(providerMode, getDefaultTtsProviderMode(surface));
  if (normalized === "auto") return getDefaultTtsProviderMode(surface);
  return normalized;
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

const AUDIO_FILE_NAME_RE = /\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i;
const VIDEO_FILE_NAME_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

function isAudioLikeFile(file: File) {
  const mime = String(file?.type || "").toLowerCase();
  return mime.startsWith("audio/")
    || AUDIO_FILE_NAME_RE.test(String(file?.name || ""));
}

function isVideoLikeFile(file: File) {
  const mime = String(file?.type || "").toLowerCase();
  return mime.startsWith("video/")
    || VIDEO_FILE_NAME_RE.test(String(file?.name || ""));
}

function getFilePreviewKind(file: File): ComposerPreviewKind {
  if (file.type.startsWith("image/")) return "image";
  if (isAudioLikeFile(file)) return "audio";
  if (isVideoLikeFile(file)) return "video";
  return "file";
}

function getComposerPreviewKind(item: ComposerPreviewItem): ComposerPreviewKind {
  return item.mediaKind || (item.isImage ? "image" : AUDIO_FILE_NAME_RE.test(item.name) ? "audio" : VIDEO_FILE_NAME_RE.test(item.name) ? "video" : "file");
}

function composerReferenceFallbackName(kind: ComposerPreviewKind) {
  if (kind === "image") return "reference-image";
  if (kind === "audio") return "reference-audio";
  if (kind === "video") return "reference-video";
  return "reference-fichier";
}

function getLibraryResourceDisplayName(resource: A11ConversationResource | null | undefined, kind: ComposerPreviewKind) {
  const fallback = composerReferenceFallbackName(kind);
  const alias = sanitizeMediaDisplayName((resource as any)?.alias || "", "");
  if (alias) return alias;
  const filename = sanitizeMediaDisplayName(resource?.filename || "", "");
  if (filename) return filename;
  return sanitizeMediaDisplayNameFromUrl((resource as any)?.downloadUrl || resource?.url || "", fallback);
}

function buildComposerReferencePreviewItem(
  kind: ComposerPreviewKind,
  url: string,
  label: unknown,
  idPrefix: string
): ComposerPreviewItem {
  const safeName = sanitizeMediaDisplayName(label, composerReferenceFallbackName(kind));
  return {
    id: `${idPrefix}-${kind}-${url}`,
    name: safeName,
    url,
    isImage: kind === "image",
    mediaKind: kind,
    remoteUrl: url,
  };
}

function appendUniqueComposerPreview(prev: ComposerPreviewItem[], item: ComposerPreviewItem) {
  const targetUrl = String(item.remoteUrl || item.url || "").trim().toLowerCase();
  if (targetUrl && prev.some((entry) => getComposerPreviewKind(entry) === item.mediaKind && String(entry.remoteUrl || entry.url || "").trim().toLowerCase() === targetUrl)) {
    return prev;
  }
  return [...prev, item];
}

function appendUniqueUrl(list: string[], url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return list;
  return Array.from(new Set([...list, normalized]));
}

function uniqueMediaUrls(...sources: Array<string | string[] | null | undefined>) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const entries = Array.isArray(source) ? source : [source];
    for (const entry of entries) {
      const url = String(entry || "").trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(url);
    }
  }
  return output;
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
const VIVY_NOSSEN_BANGER_CALL_SRC = buildPublicAssetPath("assets/vivy-banger-call.wav");
const VIVY_NOSSEN_SUNO_TARGET_SECONDS = 300;
const VIVY_NOSSEN_SUNO_MIN_ACCEPTABLE_SECONDS = 240;
const VIVY_NOSSEN_SUNO_MAX_EXTENSIONS = 3;
const VIVY_NOSSEN_SUNO_LONG_MODEL = "V5_5";

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
  if (surface === "kaen44") return name.includes("kaen44") || name.includes("k44");
  return name.includes("a11") || name.includes("alphaonze");
}

function getDefaultVoiceReferenceLabel(surface: FunesterieSurface) {
  if (surface === "vivy") return "vivy.wav";
  if (surface === "kaen44") return "kaen44-official-french-narrator.wav";
  return "a11-official-stern-french.wav";
}

function getDefaultVoiceReferenceStatus(surface: FunesterieSurface) {
  if (surface === "vivy") return "Voix Vivy sélectionnée";
  if (surface === "kaen44") return "Voix K44 officielle sélectionnée";
  return "Voix A11 officielle sélectionnée";
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
      vivyPrivacy: "/vivy/privacy",
      vivyTerms: "/vivy/terms",
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
    vivyPrivacy: new URL("/privacy/", VIVY_PUBLIC_APP_URL).toString(),
    vivyTerms: new URL("/terms/", VIVY_PUBLIC_APP_URL).toString(),
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

const POST_LOGIN_RETURN_TO_KEY = "funesterie.postLoginReturnTo";

function isGeneralPostLoginCockpitTarget(target: URL) {
  const hostname = String(target.hostname || "").trim().toLowerCase();
  const pathname = String(target.pathname || "/").toLowerCase();
  if (!/^\/cockpit(?:\/|$)/.test(pathname)) return false;
  return isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname);
}

function getHomeUrlForReturnTarget(target?: URL) {
  if (target && isAllowedFunesterieReturnOrigin(target.origin)) {
    const hostname = String(target.hostname || "").trim().toLowerCase();
    if (isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname)) {
      return new URL("/", target.origin).toString();
    }
  }
  return getFunesteriePostLoginHomeUrl();
}

function getFunesteriePostLoginHomeUrl() {
  if (typeof window !== "undefined" && isLocalSurfaceHost(window.location.hostname)) {
    return new URL("/", window.location.origin).toString();
  }
  return new URL("/", FUNESTERIE_PUBLIC_APP_URL).toString();
}

function getDefaultPostLoginUrl(surface: FunesterieSurface = getCurrentSurfaceKind()) {
  if (surface === "kaen44") return new URL("/cockpit", KAEN44_PUBLIC_APP_URL).toString();
  if (surface === "vivy") return VIVY_PUBLIC_APP_URL;
  const { hostname } = getLocationSnapshot();
  if (isGeneralFunesterieHost(hostname)) return getFunesteriePostLoginHomeUrl();
  return new URL("/cockpit", A11_PUBLIC_APP_URL).toString();
}

function normalizeAllowedReturnTo(rawValue: string | null | undefined, fallback = getDefaultPostLoginUrl()) {
  const raw = String(rawValue || "").trim();
  const base = typeof window !== "undefined" ? window.location.origin : FUNESTERIE_PUBLIC_APP_URL;
  try {
    const target = new URL(raw || fallback, base);
    if (!isAllowedFunesterieReturnOrigin(target.origin)) return fallback;
    if (isLoginRoute(target.pathname)) return fallback;
    if (isGeneralPostLoginCockpitTarget(target)) return getHomeUrlForReturnTarget(target);
    return target.toString();
  } catch {
    return fallback;
  }
}

function isSafePostLoginReturnTo(target: URL) {
  return isAllowedFunesterieReturnOrigin(target.origin)
    && !isLoginRoute(target.pathname)
    && !isAuthSuccessRoute(target.pathname)
    && !isGeneralPostLoginCockpitTarget(target);
}

function rememberPostLoginReturnTo(rawValue: string | null | undefined) {
  if (typeof window === "undefined") return;
  const raw = String(rawValue || "").trim();
  if (!raw) return;
  try {
    const target = new URL(raw, window.location.origin);
    if (!isSafePostLoginReturnTo(target)) return;
    window.sessionStorage.setItem(POST_LOGIN_RETURN_TO_KEY, target.toString());
  } catch {
    // Storage can be blocked in private contexts; explicit returnTo still works.
  }
}

function getRememberedPostLoginReturnTo() {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.sessionStorage.getItem(POST_LOGIN_RETURN_TO_KEY);
    if (!stored) return "";
    const target = new URL(stored, window.location.origin);
    if (!isSafePostLoginReturnTo(target)) return "";
    return target.toString();
  } catch {
    return "";
  }
}

function getReferrerPostLoginReturnTo() {
  if (typeof document === "undefined" || typeof window === "undefined") return "";
  try {
    const referrer = String(document.referrer || "").trim();
    if (!referrer) return "";
    const target = new URL(referrer, window.location.origin);
    if (!isSafePostLoginReturnTo(target)) return "";
    return target.toString();
  } catch {
    return "";
  }
}

function getRequestedLoginReturnTo() {
  if (typeof window === "undefined") return getDefaultPostLoginUrl();
  const params = new URLSearchParams(window.location.search || "");
  const explicit = params.get("returnTo") || params.get("next");
  if (explicit) {
    const normalizedExplicit = normalizeAllowedReturnTo(explicit);
    rememberPostLoginReturnTo(normalizedExplicit);
    return normalizedExplicit;
  }

  const { pathname } = getLocationSnapshot();
  if (isLoginRoute(pathname)) {
    return getRememberedPostLoginReturnTo() || getReferrerPostLoginReturnTo() || getDefaultPostLoginUrl();
  }

  const currentReturnTo = normalizeAllowedReturnTo(window.location.href);
  rememberPostLoginReturnTo(currentReturnTo);
  return currentReturnTo;
}

function buildCentralLoginUrl(returnTo = getRequestedLoginReturnTo()) {
  const base = typeof window !== "undefined" && isLocalSurfaceHost(window.location.hostname)
    ? new URL("/login", window.location.origin)
    : new URL("/login", FUNESTERIE_PUBLIC_APP_URL);
  const normalizedReturnTo = normalizeAllowedReturnTo(returnTo);
  base.searchParams.set("returnTo", normalizedReturnTo);
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
    if (isGeneralPostLoginCockpitTarget(target)) return "";
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
    if (isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname)) return "/";
    return "/cockpit/";
  }
  if (isGeneralFunesterieHost(hostname)) return "/";
  if (surface === "kaen44") return buildSurfacePath(surface, "/cockpit");
  if (surface === "vivy") return buildSurfacePath(surface, "/");
  return buildSurfacePath(surface, "/");
}

function resolveAuthFailureRedirectPath(pathname: string) {
  const normalizedPath = String(pathname || "/").toLowerCase();
  const { hostname } = getLocationSnapshot();
  const surface = getCurrentSurfaceKind();
  if (/^\/cockpit(?:\/|$)/.test(normalizedPath)) {
    if (isGeneralFunesterieHost(hostname) || isLocalSurfaceHost(hostname)) return "/login?error=session_verification_failed";
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
    value: "ollama:llama3.2:3b",
    label: "A11 Ollama - rapide local",
    provider: "ollama",
    model: "llama3.2:3b",
  },
];

const DEFAULT_REMOTE_CHAT_MODEL_CHOICES: ChatModelChoice[] = [
  {
    value: "groq:llama-3.3-70b-versatile",
    label: "Groq - Llama 3.3 70B rapide",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
  },
  {
    value: "openai:meta-llama/llama-3.3-70b-instruct",
    label: "OpenRouter secours - Llama 3.3 70B",
    provider: "openai",
    model: "meta-llama/llama-3.3-70b-instruct",
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
  return [...DEFAULT_REMOTE_CHAT_MODEL_CHOICES, ...LOCAL_CHAT_MODEL_CHOICES, ...remoteChoices];
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

  return DEFAULT_REMOTE_CHAT_MODEL_CHOICES[0];
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

  const imageUrls = uniqueMediaUrls(message.imageUrl, message.imageUrls || []);
  const audioUrls = uniqueMediaUrls(message.audioUrl, message.audioUrls || []);
  const videoUrls = uniqueMediaUrls(message.videoUrl, message.videoUrls || []);

  const mediaLines: string[] = [];
  imageUrls.forEach((url, imageIndex) => {
    if (url) mediaLines.push(`- Image ${imageIndex + 1}: ${url}`);
  });
  audioUrls.forEach((url, audioIndex) => {
    if (url) mediaLines.push(`- Audio ${audioIndex + 1}: ${url}`);
  });
  videoUrls.forEach((url, videoIndex) => {
    if (url) mediaLines.push(`- Vidéo ${videoIndex + 1}: ${url}`);
  });
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

function looksLikeInternalAssistantLeak(value: string) {
  const raw = String(value || "").trim();
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

function resolveRenderableAssetUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^(?:sandbox|file|vscode|cursor):/i.test(raw) || /^\/?sandbox:/i.test(raw) || /\/sandbox:\//i.test(raw)) {
    return null;
  }
  const resolved = resolveApiAssetUrl(raw);
  if (!resolved) return null;
  if (/^(?:sandbox|file|vscode|cursor):/i.test(resolved) || /^\/?sandbox:/i.test(resolved) || /\/sandbox:\//i.test(resolved)) {
    return null;
  }
  return resolved;
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
  if (looksLikeInternalAssistantLeak(text)) return true;
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
  let resolvedImageUrl = explicitImageUrl ? resolveRenderableAssetUrl(explicitImageUrl) : null;
  let resolvedVideoUrl = explicitVideoUrl ? resolveRenderableAssetUrl(explicitVideoUrl) : null;
  let resolvedFileUrl = explicitFileUrl ? resolveRenderableAssetUrl(explicitFileUrl) : null;
  const rawContent = String(content || "");
  let cleanedContent = extractAssistantDisplayContent(rawContent) || rawContent.trim();
  let qflushVerification: ChatMessage["qflushVerification"] = null;
  let hideAssistantText = false;

  if (looksLikeLeakedActionTranscript(cleanedContent) || looksLikeLeakedActionTranscript(rawContent)) {
    cleanedContent = "Je n'ai pas reçu une confirmation exploitable pour cette action.";
  }

  if (looksLikeInternalAssistantLeak(cleanedContent) || looksLikeInternalAssistantLeak(rawContent)) {
    hideAssistantText = true;
    cleanedContent = "";
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
      resolvedImageUrl = resolveRenderableAssetUrl(rawUrl);
    }
    return "";
  });

  cleanedContent = cleanedContent.replace(MARKDOWN_LINK_PATTERN, (fullMatch, rawLabel: string, rawUrl: string) => {
    const resolvedCandidate = resolveRenderableAssetUrl(rawUrl);
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
  if (!cleanedContent && rawContent.trim() && !resolvedImageUrl && !resolvedVideoUrl && !resolvedFileUrl && !hideAssistantText) {
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

function isRenderableChatMessage(message: ChatMessage) {
  if (!message) return false;
  if (message.role === "system") return true;
  if (message.role === "user") {
    return Boolean(
      String(message.content || "").trim()
      || message.imageUrl
      || message.videoUrl
      || message.fileUrl
      || (Array.isArray(message.imageUrls) && message.imageUrls.length > 0)
      || message.audioUrl
      || (Array.isArray(message.audioUrls) && message.audioUrls.length > 0)
      || (Array.isArray(message.videoUrls) && message.videoUrls.length > 0)
    );
  }
  if (message.role === "assistant") {
    return Boolean(
      String(message.content || "").trim()
      || message.imageUrl
      || (Array.isArray(message.imageUrls) && message.imageUrls.length > 0)
      || message.audioUrl
      || (Array.isArray(message.audioUrls) && message.audioUrls.length > 0)
      || message.videoUrl
      || (Array.isArray(message.videoUrls) && message.videoUrls.length > 0)
      || message.fileUrl
    );
  }
  return false;
}

function buildClientAssistantFallback(userText = "", surface: FunesterieSurface = "a11") {
  const folded = String(userText || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const label = surface === "kaen44" ? "K44" : surface === "vivy" ? "Vivy" : "A11";
  if (/(allo|t es la|tu es la|vous etes la|quelqu un|reponds|réponds)/.test(folded)) {
    return `Oui, je suis là. ${label} reprend normalement.`;
  }
  if (/(ca va mieux|ça va mieux|mieux)/.test(folded)) {
    return "Oui, mieux. La réponse précédente a dérapé côté technique, mais je reprends normalement.";
  }
  if (/(salut|bonjour|coucou|ca va|ça va|comment tu vas)/.test(folded)) {
    return surface === "kaen44"
      ? "Oui, je suis là. On reprend simplement: qu'est-ce que tu veux faire ?"
      : "Oui, je suis là. Je reprends proprement.";
  }
  return `${label} est là. Je n'ai pas reçu une réponse exploitable du modèle, donc je repars sur ton dernier message.`;
}

const A11_MAX_CONTEXT_CHARS = 48_000;
const A11_MAX_MESSAGE_CHARS = 12_000;
const A11_MAX_HISTORY_MESSAGES = 36;

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

function stripHistoricalMediaMarkersForModel(content: string) {
  return String(content || "")
    .replace(/\[image-data:data:image\/[^;]+;base64,[^\]]+\]/gi, "")
    .replace(/\[(?:image|video|file|audio):[^\]]+\]/gi, "")
    .replace(/\[(?:image|fichier|audio)-joint(?:e)?[^\]]*\]/gi, "")
    .replace(/\b(?:id|url|analyse|action-probable)=[^\s]+/gi, "")
    .replace(/Image rattachee a la conversation;?\s*/gi, "")
    .replace(/analyse-la avec la vision[^.?!]*(?:[.?!]|$)/gi, "")
    .replace(/Fichier rattache a la conversation;?\s*/gi, "")
    .replace(/analyse-le et decide quoi en faire avant de repondre\.?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildModelMediaMarkers(message: ChatMessage) {
  if (!message || message.role === "system") return [];
  const imageUrls = uniqueMediaUrls(message.imageUrl, message.imageUrls || []);
  const audioUrls = uniqueMediaUrls(message.audioUrl, message.audioUrls || []);
  const videoUrls = uniqueMediaUrls(message.videoUrl, message.videoUrls || []);
  const fileUrls = uniqueMediaUrls(message.fileUrl);
  return [
    ...imageUrls.map((url) => `[image:${url}]`),
    ...audioUrls.map((url) => `[audio:${url}]`),
    ...videoUrls.map((url) => `[video:${url}]`),
    ...fileUrls.map((url) => `[file:${url}]`),
  ];
}

function sanitizeConversationHistoryForModel(messages: ChatMessage[]) {
  const cleanMessages = (Array.isArray(messages) ? messages : []).filter((message) => {
    if (!message || message.role === "system") return false;
    if (message.role !== "assistant") return true;
    return !isAssistantHistoryPoisoned(message.content);
  }).slice(-A11_MAX_HISTORY_MESSAGES);

  const latestUserIndex = (() => {
    for (let index = cleanMessages.length - 1; index >= 0; index -= 1) {
      if (cleanMessages[index]?.role === "user") return index;
    }
    return -1;
  })();

  const trimmed = cleanMessages.map((message, index) => {
    const keepCurrentMediaMarkers = message.role === "user" && index === latestUserIndex;
    const baseContent = keepCurrentMediaMarkers
      ? String(message.content || "").trim()
      : stripHistoricalMediaMarkersForModel(message.content);

    const mediaMarkers = buildModelMediaMarkers(message);
    return {
      ...message,
      content: trimChatContentForContext(
        [
          baseContent,
          ...mediaMarkers,
        ].filter(Boolean).join("\n"),
        A11_MAX_MESSAGE_CHARS
      ),
    };
  }).filter((message) => String(message.content || "").trim());

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

function isImageInspectionRequest(value: string) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .toLowerCase()
    .trim();
  if (!text) return false;
  if (/\b(genere|cree|fabrique|dessine|rajoute|ajoute|modifie|retouche|transforme|remplace|anime|video)\b/.test(text)) {
    return false;
  }
  return /\b(c est qui|c est quoi|qui est ce|qui c est|qui est sur|c quoi|qu est ce que c est|que vois tu|qu y a t il|decris|decrit|analyse|identifie|reconnais|tu vois quoi|image|photo|visuel|capture|dessus)\b/.test(text);
}

function canReuseLastMediaForRequest(value: string) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .toLowerCase()
    .trim();
  if (!text) return false;
  if (isLastImageRecallRequest(text)) return true;
  return /\b(cette|celle|celui|dernier|derniere|precedent|precedente|la meme|le meme|l image jointe|la photo jointe)\b/.test(text)
    && /\b(image|photo|visuel|capture|dessus|analyse|decris|decrit|vois)\b/.test(text);
}

function getSurfaceChatLabel(surface: FunesterieSurface | string = "a11") {
  const normalized = String(surface || "").trim().toLowerCase();
  if (normalized === "kaen44" || normalized === "k44" || normalized === "kaen") return "K44";
  if (normalized === "vivy" || normalized === "vivi") return "Vivy";
  return "A11";
}

function formatChatErrorForUser(error: unknown, surface: FunesterieSurface | string = "a11") {
  let message = String((error as any)?.message || "").trim();
  if (!message && error && typeof error === "object") {
    const candidate = error as any;
    message = String(
      candidate?.message
      || candidate?.error_description
      || candidate?.error?.message
      || candidate?.payload?.message
      || candidate?.data?.message
      || candidate?.statusText
      || ""
    ).trim();
  }
  if (!message) {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error || "").trim();
    }
  }
  if (message === "{}" || message === "[object Object]") {
    message = "le serveur a renvoyé une erreur sans détail lisible";
  }
  if (/video_engine_unavailable|generateVideo handler unavailable|real_video_unavailable|video_proxy_fetch_unavailable|local video runner|mochi|A11_VIDEO_LOCAL_RUNNER/i.test(message)) {
    return "Le moteur vidéo local n'est pas encore prêt: le routage est actif, mais le worker de rendu vidéo n'est pas lancé ou pas branché. Les poids locaux sont installés; il faut démarrer le runner vidéo avant de lancer le clip.";
  }
  if (/met trop longtemps|coup[eé] la requ[eê]te proprement/i.test(message)) {
    return message;
  }
  if (/\b(API\s*)?(502|503|504|524)\b/i.test(message) || /html inattendue|timeout|surcharge|upstream/i.test(message)) {
    return "Le serveur IA ou un fournisseur externe a coupé la réponse. Réessaie dans quelques instants; la priorité de ton compte reste conservée.";
  }
  return message || "Une erreur s'est produite lors de la requête.";
}

function isRetryableVivyMusicJobError(error: unknown) {
  const message = String((error as any)?.message || error || "").trim();
  return /\b(?:429|502|503|504|524)\b/.test(message)
    || /timeout|temporair|temporaire|surcharge|upstream|coup[eé].*r[eé]ponse|Job Vivy indisponible/i.test(message);
}

function findLastVisibleMedia(messages: ChatMessage[]) {
  const list = Array.isArray(messages) ? [...messages].reverse() : [];
  for (const message of list) {
    if (!message || message.role === "system") continue;
    const imageUrls = uniqueMediaUrls(message.imageUrl, message.imageUrls || []);
    const videoUrls = uniqueMediaUrls(message.videoUrl, message.videoUrls || []);
    const audioUrls = uniqueMediaUrls(message.audioUrl, message.audioUrls || []);
    if (imageUrls[0]) return { kind: "image" as const, url: imageUrls[0] };
    if (videoUrls[0]) return { kind: "video" as const, url: videoUrls[0] };
    if (audioUrls[0]) return { kind: "audio" as const, url: audioUrls[0] };
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
  "Je suis K44, une assistante bureau universelle, locale-first, créative et utile, conçue pour offrir une vraie alternative aux assistants intégrés trop fermés.",
  "Je détecte automatiquement la langue de l'utilisateur, des fichiers et du contexte partagé. Je réponds dans la langue détectée par défaut, je peux changer de langue sans friction, et je demande une précision seulement si la langue ou l'intention est ambiguë.",
  "Ma mission est d'aider l'utilisateur à penser, produire, organiser, classer, dépanner son ordinateur et transformer ses documents avec une présence claire, vive et concrète.",
  "Je peux accompagner tous les projets raisonnables qu'un client peut espérer piloter avec une assistante bureau: documents, factures, dossiers administratifs, planning, CRM léger, idées de marque, contenus web, supports commerciaux, base de connaissances, fichiers Drive/OneDrive, analyses de données simples, assistance informatique et suivi de projet.",
  "Je distingue clairement ce qui tourne dans K44 côté client et ce qui appartient à A11 côté serveur. A11 n'est pas installé localement chez les clients: je m'y connecte comme service distant quand c'est nécessaire.",
  "Je dispose d'une CLI client légère, `kaen44` ou `k44`, pour ouvrir l'application, vérifier le statut local et enregistrer des tokens client de manière chiffrée avec Windows DPAPI. Je ne demande jamais à l'utilisateur de coller un token en clair dans le chat si la CLI peut le stocker localement.",
  "Je peux présenter une console de modules claire côté client: connecteurs, fichiers, Drive/OneDrive, factures, voix, vision, exports, statut et extensions disponibles. Les modules dangereux, shell, déploiement, secrets et opérations serveur restent réservés à A11/admin.",
  "Je peux appliquer un guard mode d'usage: si un client abuse, consomme trop de ressources ou approche un quota/coût anormal, je passe en mode limité transparent et je peux proposer K44 Plus à 5 EUR. Je ne simule pas une fausse panne; j'annonce une limitation claire, je réduis les actions coûteuses et je demande l'abonnement si nécessaire.",
  "Si un problème technique, quota fournisseur ou limitation guard mode se déclenche, je dois prévenir l'administrateur par email à cellaurojeffrey@gmail.com avec un résumé bref: utilisateur, heure, type de problème, action limitée et prochaine étape. Je ne joins jamais de tokens, secrets ou données sensibles.",
  "Pour les personnes malvoyantes, handicapées ou fatiguées, je privilégie un mode accessibilité: grosses cibles, lecture vocale, dictée, contraste, navigation clavier, résumé d'écran et actions confirmées. Le contrôle souris/clavier/écran ne se fait qu'avec consentement explicite, indication visible, journal local et possibilité d'arrêt immédiat.",
  "Si un contrôle d'écran avancé est nécessaire, je recommande un helper local dédié utilisant les API d'accessibilité Windows, pas une prise de contrôle cachée depuis une page web.",
  "Quand un projet demande des outils supplémentaires, je recommande seulement le minimum utile: navigateur moderne, OneDrive ou Google Drive pour les fichiers, Microsoft 365 ou LibreOffice pour les documents, PDF24 ou outil PDF équivalent, Git si le client gère du code, Node.js ou Python uniquement pour les projets techniques, Audacity/ffmpeg pour l'audio, ImageMagick ou outil image équivalent pour les images, SQLite pour une petite base locale, PostgreSQL pour une base métier, Neo4j seulement si le projet a vraiment besoin de graphe de relations, Docker seulement pour les postes techniques ou les déploiements.",
  "Pour la vision avancée, je peux m'appuyer sur Janus côté A11/serveur quand le projet implique analyse d'images, mémoire visuelle, description de captures, contrôle de générations image/vidéo ou extraction sémantique visuelle. Janus n'est pas une dépendance obligatoire du poste client.",
  "Je peux proposer une fiche d'installation par projet avec niveaux: essentiel, recommandé, avancé, serveur. Je n'impose jamais Neo4j, Docker, Python, Node.js ou Janus à un client non technique si le besoin peut être couvert plus simplement.",
  "Je parle comme une compagne de travail intelligente: directe, chaleureuse, précise, jamais corporate.",
  "Ma présence s'inspire d'une assistante de direction brillante et vive, mais je reste une identité originale Funesterie: je ne clone aucune personne réelle ni personnage existant.",
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
  "J'assume mon positionnement: K44 est un poste de pilotage personnel et professionnel, pas un panneau publicitaire.",
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
        <button
          type="button"
          style={{ fontSize: 12, color: '#86efac', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}
          onClick={() => {
            const imgUrl = resolveApiAssetUrl(current) || current;
            void downloadMediaUrl(imgUrl).catch(() => undefined);
          }}
        >
          ⬇ Télécharger
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
const D40_HARMONIC_RATIO = 8 / 9;
const D40_HARMONIC_INTENSITY_MIN = D40_HARMONIC_RATIO;
const D40_HARMONIC_INTENSITY_MAX = 1 / D40_HARMONIC_RATIO;
const D40_V4_LOW_GRAIN_MULTIPLIER = 2;
const D40_V4_HIGH_GRAIN_POWER = 3;
const D40_V4_INTENSITY_MIN = 0.5;
const D40_V4_INTENSITY_MAX = 4;
const D40_V5_INTENSITY_MIN = 0.5;
const D40_V5_INTENSITY_MAX = 3;
const D40_V5_DEFAULT_INTENSITY = 2;
const D40_V6_INTENSITY_MIN = 0.1;
const D40_V6_INTENSITY_MAX = 10;
const D40_V6_DEFAULT_INTENSITY = 3;
const D40_V7_INTENSITY_MIN = 0.1;
const D40_V7_INTENSITY_MAX = 10;
const D40_V7_DEFAULT_INTENSITY = 3;
const D40_V8_INTENSITY_MIN = 0.1;
const D40_V8_INTENSITY_MAX = 10;
const D40_V8_DEFAULT_INTENSITY = 3;
const D40_PROCESS_MODE_LABELS: Record<DoubleHarmonicProcessMode, string> = {
  v1: "V1 stable",
  v2: "V2 Release",
  v3: "V3 auto",
  v4: "V4 Stable",
  v5: "V5 Release",
  v6: "V6 Supreme",
  v7: "V7 Briques",
  v71: "V7.1 1024",
  v8: "V8 Fermeture",
  v8plus: "V8 Plus e2",
  v8pivot: "V8 Pivot",
  v9turbo: "V9 Dynamique",
};
const D40_OUTPUT_FORMAT_LABELS: Record<DoubleHarmonicOutputFormat, string> = {
  flac: "FLAC master",
  source: "Même format",
  mp3: "MP3 léger",
  m4a: "M4A léger",
  wav: "WAV brut",
};

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
  const requestedReturnTo = useMemo(() => getFunesteriePostLoginHomeUrl(), []);

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
            <div className="kaen-auth-title">K44</div>
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
  const label = surface === "vivy" ? "Vivy" : surface === "kaen44" ? "K44" : "A11";
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

type VivyStudioMode = "voice" | "test" | "song" | "share";
type VivyStudioProductionMode = Exclude<VivyStudioMode, "test">;
type VivyStudioMediaPreview = {
  kind: "audio" | "video";
  url: string;
  downloadUrl?: string;
  provider?: string;
  contentType?: string;
  filename?: string;
  id?: string;
  audioId?: string;
  durationSeconds?: number;
  model?: string;
  taskId?: string;
  voiceManifest?: {
    providerRequested?: string;
    providerUsed?: string;
    rvcApplied?: boolean;
    personaApplied?: boolean;
    fallbackUsed?: boolean;
    fallbackReason?: string | null;
    segments?: number;
    mixEngine?: string | null;
    output?: string | null;
  };
};

type VivyStudioVocalSegment = {
  artistIds: VivyStudioArtistId[];
  text: string;
};

const VIVY_STUDIO_DRAFT_KEY = "vivy:studio:draft:v2";
const VIVY_STUDIO_SUNO_SESSION_KEY = "vivy:suno:session-key";
const VIVY_PUBLIC_CHAT_KEY = "vivy:public-chat:v2";
const VIVY_PUBLIC_CONVERSATION_ID_KEY = "vivy:conversation-id";
const VIVY_PUBLIC_VOICE_REFERENCE_KEY = "vivy:voice-reference";
const VIVY_PRIVATE_REFERENCE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const VIVY_VOICE_CATALOG_CONSENT = "voice-catalog-song-v1";
const VIVY_STUDIO_SONG_MAX_CHARS = 12000;
const VIVY_PUBLIC_CHAT_MAX_MESSAGES = A11_MAX_HISTORY_MESSAGES;

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
  media?: VivyStudioMediaPreview | null;
};
type VivyPublicChatMode = "chat" | VivyStudioProductionMode;
type VivyNossenBangerReadiness = {
  ready: boolean;
  score: number;
  reason: string;
  source: string;
  sourceKind: "draft" | "chat" | "composition" | "empty";
  styleHints: string[];
  structureHints: string[];
  technicalNoise: string[];
  mediaHints: string[];
};
type VivyNossenSemanticCanvas = {
  lyricSource: string;
  sourceKind: "draft" | "chat" | "composition" | "empty";
  styleHints: string[];
  structureHints: string[];
  technicalNoise: string[];
  mediaHints: string[];
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
      id: "test",
      title: "Test voix",
      label: "Écouter chaque voix directement — Vivy, K44, A11, Djeff et les voix contribuées.",
      action: "Tester",
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

// --- Sessions multiples Vivy Chat ---
const VIVY_CHAT_SESSIONS_KEY = "vivy:chat-sessions:v1";
const VIVY_CHAT_MAX_SESSIONS = 20;

type VivyChatSessionMeta = { id: string; name: string; createdAt: string; updatedAt: string; };

function normalizeVivyChatSessionId(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized || "default";
}

function buildVivyConversationIdForChatSession(sessionId = "default") {
  const normalizedSessionId = normalizeVivyChatSessionId(sessionId);
  return normalizedSessionId === "default" ? "vivy-default" : `vivy-session-${normalizedSessionId}`;
}

function normalizeVivyRemoteChatSession(session: VivyChatSessionRecord): VivyChatSessionMeta | null {
  const id = normalizeVivyChatSessionId(session?.id || "");
  if (!id || id === "default") return null;
  const now = new Date().toISOString();
  return {
    id,
    name: toUnicodeLine(session?.name, `Session ${id}`, 80),
    createdAt: String(session?.createdAt || session?.updatedAt || now),
    updatedAt: String(session?.updatedAt || session?.createdAt || now),
  };
}

function mapVivyRemoteMessages(messages: VivyChatSessionRecord["messages"]): VivyPublicChatMessage[] {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((entry, index) => ({
      id: String(entry?.id || `vivy-remote-${Date.now()}-${index}`),
      role: entry?.role === "user" ? "user" as const : "assistant" as const,
      content: toUnicodeText(entry?.content),
      ts: String(entry?.ts || new Date().toISOString()),
      media: readVivyPublicChatMedia(entry?.media),
    }))
    .filter((entry) => entry.content)
    .slice(-VIVY_PUBLIC_CHAT_MAX_MESSAGES);
  return normalized.length ? normalized : [buildVivyGreeting()];
}

function isOnlyVivyPlaceholderMessages(messages: VivyPublicChatMessage[]) {
  return messages.length <= 1 && (messages[0]?.id === "vivy-greeting" || messages[0]?.id === "vivy-locked");
}

function getVivySessionsStorageKey() {
  try { return `${VIVY_CHAT_SESSIONS_KEY}:${getAuthStorageScope() || "locked"}`; }
  catch { return `${VIVY_CHAT_SESSIONS_KEY}:locked`; }
}

function getVivyChatStorageKeyForSession(sessionId: string) {
  const base = getVivyChatStorageKey();
  return sessionId === "default" ? base : `${base}:s:${sessionId}`;
}

function listVivyChatSessions(): VivyChatSessionMeta[] {
  try {
    const raw = globalThis.localStorage?.getItem(getVivySessionsStorageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return (parsed as VivyChatSessionMeta[]).filter((s) => s?.id && s?.name).slice(-VIVY_CHAT_MAX_SESSIONS);
  } catch { return []; }
}

function saveVivyChatSessions(sessions: VivyChatSessionMeta[]) {
  try { globalThis.localStorage?.setItem(getVivySessionsStorageKey(), JSON.stringify(sessions.slice(-VIVY_CHAT_MAX_SESSIONS))); }
  catch { }
}

function createVivyChatSession(name: string): VivyChatSessionMeta {
  const id = `s${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const meta: VivyChatSessionMeta = { id, name: name.trim().slice(0, 40) || `Session ${id}`, createdAt: now, updatedAt: now };
  const sessions = listVivyChatSessions();
  saveVivyChatSessions([...sessions, meta]);
  return meta;
}

function deleteVivyChatSession(sessionId: string) {
  try {
    const key = getVivyChatStorageKeyForSession(sessionId);
    globalThis.localStorage?.removeItem(key);
    globalThis.localStorage?.removeItem(getVivyConversationStorageKey(sessionId));
  } catch { }
  const sessions = listVivyChatSessions().filter((s) => s.id !== sessionId);
  saveVivyChatSessions(sessions);
}

function readVivyPublicChatFiles(files: any): VivyPublicChatFile[] | undefined {
  if (!Array.isArray(files)) return undefined;
  const normalized = files
    .map((file: any) => ({
      id: String(file?.id || file?.storageKey || file?.filename || file?.name || ""),
      filename: toUnicodeLine(file?.filename || file?.name, "", 180),
      contentType: toUnicodeLine(file?.contentType || file?.type, "", 120),
      sizeBytes: Number(file?.sizeBytes || file?.size || 0) || 0,
      url: toUnicodeLine(file?.url || file?.downloadUrl, "", 800),
      downloadUrl: toUnicodeLine(file?.downloadUrl || file?.url, "", 800),
      description: toUnicodeText(file?.description, 900),
      textPreview: toUnicodeText(file?.textPreview, 6000),
      visualDescription: toUnicodeText(file?.visualDescription, 900),
      analysisSummary: toUnicodeText(file?.analysisSummary, 900),
      analysis: file?.analysis && typeof file.analysis === "object" ? file.analysis : null,
      uploaded: file?.uploaded === true,
      uploadState: file?.uploadState === "stored" ? "stored" as const : "local" as const,
      uploadError: toUnicodeLine(file?.uploadError, "", 120),
      storageBackend: toUnicodeLine(file?.storageBackend, "", 80),
    }))
    .filter((file: VivyPublicChatFile) => file.filename)
    .slice(0, 6);
  return normalized.length ? normalized : undefined;
}

function readVivyPublicChatMedia(media: any): VivyStudioMediaPreview | null {
  if (!media || typeof media !== "object") return null;
  const url = toUnicodeLine(
    media?.url || media?.audioUrl || media?.audio_url || media?.videoUrl || media?.video_url,
    "",
    1200
  );
  if (!url) return null;
  const downloadUrl = toUnicodeLine(
    media?.downloadUrl || media?.download_url || media?.audioUrl || media?.audio_url || media?.url || url,
    "",
    1200
  );
  return {
    kind: String(media?.kind || (media?.videoUrl || media?.video_url ? "video" : "audio")).toLowerCase() === "video" ? "video" : "audio",
    url,
    downloadUrl: downloadUrl || url,
    provider: toUnicodeLine(media?.provider, "", 120) || undefined,
    contentType: toUnicodeLine(media?.contentType || media?.content_type, "", 120) || undefined,
    filename: toUnicodeLine(media?.filename || media?.title, "", 180) || undefined,
    voiceManifest: media?.voiceManifest && typeof media.voiceManifest === "object" ? media.voiceManifest : undefined,
  };
}

function readVivyChatSession(sessionId: string): VivyPublicChatMessage[] {
  if (!hasVivyAuthenticatedSession()) return [buildVivyLockedMessage()];
  const key = getVivyChatStorageKeyForSession(sessionId);
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed) || !parsed.length) return [buildVivyGreeting()];
    return parsed.map((e: any) => ({
      id: String(e?.id || `vivy-${Date.now()}`), role: (e?.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: toUnicodeText(e?.content), ts: String(e?.ts || new Date().toISOString()),
      files: readVivyPublicChatFiles(e?.files),
      media: readVivyPublicChatMedia(e?.media),
    })).filter((m) => m.content).slice(-VIVY_PUBLIC_CHAT_MAX_MESSAGES);
  } catch { return [buildVivyGreeting()]; }
}

function writeVivyChatSession(sessionId: string, messages: VivyPublicChatMessage[]) {
  if (!hasVivyAuthenticatedSession()) return;
  const key = getVivyChatStorageKeyForSession(sessionId);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(messages.slice(-VIVY_PUBLIC_CHAT_MAX_MESSAGES)));
    const sessions = listVivyChatSessions();
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) { sessions[idx].updatedAt = new Date().toISOString(); saveVivyChatSessions(sessions); }
  } catch { }
}
// --- Fin sessions multiples ---

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
        files: readVivyPublicChatFiles(entry?.files),
        media: readVivyPublicChatMedia(entry?.media),
      }))
      .filter((entry) => entry.content);
    return messages.length ? messages.slice(-VIVY_PUBLIC_CHAT_MAX_MESSAGES) : [buildVivyGreeting()];
  } catch {
    return [buildVivyGreeting()];
  }
}

function writeVivyPublicChat(messages: VivyPublicChatMessage[]) {
  if (!hasVivyAuthenticatedSession()) return;
  try {
    globalThis.localStorage?.setItem(getVivyChatStorageKey(), JSON.stringify(messages.slice(-VIVY_PUBLIC_CHAT_MAX_MESSAGES)));
  } catch {
    // Local history is best effort only.
  }
}

function getVivyConversationStorageKey(sessionId = "default") {
  try {
    return `${VIVY_PUBLIC_CONVERSATION_ID_KEY}:${getAuthStorageScope() || "public"}:${sessionId}`;
  } catch {
    return `${VIVY_PUBLIC_CONVERSATION_ID_KEY}:public:${sessionId}`;
  }
}

function readOrCreateVivyConversationId(sessionId = "default") {
  if (!hasVivyAuthenticatedSession()) return "";
  try {
    const key = getVivyConversationStorageKey(sessionId);
    const existing = String(globalThis.localStorage?.getItem(key) || "").trim();
    const deterministic = buildVivyConversationIdForChatSession(sessionId);
    if (existing && !/^vivy-\d+-/i.test(existing)) return existing;
    const next = deterministic;
    globalThis.localStorage?.setItem(key, next);
    return next;
  } catch {
    return buildVivyConversationIdForChatSession(sessionId);
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

function isVivyImageFile(file: File | VivyPublicChatFile | null | undefined) {
  const value = file as any;
  const type = String(value?.type || value?.contentType || "").toLowerCase();
  const name = String(file instanceof File ? file.name : value?.filename || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name);
}

function describeVivyUploadAnalysis(analysis: any) {
  const payload = analysis && typeof analysis === "object" ? analysis : null;
  if (!payload) return "";
  const preview = toUnicodeText(payload.preview, 900);
  if (payload.readableInChatContext && preview) return `Analyse A11/OCR: ${preview}`;
  const parts = [
    payload.format ? String(payload.format) : "",
    payload.width && payload.height ? `${payload.width}x${payload.height}` : "",
    payload.sizeBytes || payload.originalBytes ? formatVivyFileSize(Number(payload.sizeBytes || payload.originalBytes)) : "",
  ].filter(Boolean);
  if (parts.length) return `Image reçue par A11 (${parts.join(", ")}). Vision détaillée disponible côté chat.`;
  if (payload.note) return `Analyse A11: ${toUnicodeLine(payload.note, "image reçue", 160)}`;
  return "";
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
  const folded = foldForLookup(text);
  if (!folded) return false;
  // Only treat this as a voice request when the user explicitly talks about
  // voice / TTS / vocal timbre. Generic verbs like "changer" or "modifier" on
  // their own must NOT surface voice/TTS status in free chat.
  if (/\b(voix|voice|tts|timbre|vocal|vocale|synthese vocale)\b/.test(folded)) return true;
  // Explicit audio reference for the voice (e.g. "ref audio", "reference vocale").
  if (/\bref(?:erence)?\s+(?:audio|vocale|voix)\b/.test(folded)) return true;
  // A change / clone verb only counts when it explicitly targets voice or audio.
  if (
    /\b(changer|change|remplacer|remplace|modifier|modifie|calibr\w*|cloner|clone|imiter)\b/.test(folded)
    && /\b(voix|voice|timbre|vocal|vocale|tts|audio)\b/.test(folded)
  ) return true;
  return false;
}

function uniqueVivyNossenLines(lines: string[], max = 32) {
  const unique: string[] = [];
  const seen = new Set<string>();
  lines.forEach((line) => {
    const cleaned = toUnicodeLine(line, "", 260).trim();
    const key = foldForLookup(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    unique.push(cleaned);
  });
  return unique.slice(-max);
}

function isVivyNossenUseAttachmentTextRequest(value = "") {
  const folded = foldForLookup(value);
  return /\b(?:utilise|reprends|reprendre|mets|mettre|integre|intègre|copie|prends|prendre)\b.{0,90}\b(?:texte|ocr|image|photo|fichier|piece jointe|pièce jointe|document)\b/.test(folded);
}

function looksLikeVivyNossenTechnicalMediaLine(value = "") {
  const raw = String(value || "").trim();
  const folded = foldForLookup(raw);
  if (!folded) return false;
  if (/\.(?:jpe?g|png|webp|gif|bmp|svg|heic|avif)\b/i.test(raw)) return true;
  if (/https?:\/\/\S+/i.test(raw) || /\b(?:downloadurl|storagekey|contenttype|textpreview|visualdescription|analysissummary)\b/i.test(raw)) return true;
  if (/\b(?:ocr|analyse\s+a11|jpg|jpeg|png|webp|gif|maxresdefault|wallpaper|preview|filename|nom\s+de\s+fichier|fichier\s+image|metadata|metadonnees|métadonnées|lecture\s+locale|vision\s+avancee|vision\s+avancée|format\s+jpeg|format\s+png|image\s+recue|image\s+reçue|px|ko)\b/.test(folded)) return true;
  if (/\b[a-f0-9]{14,}\b/i.test(raw) || /\b\d{8,}\b/.test(raw)) return true;
  return false;
}

function stripVivyNossenControlLabel(value = "") {
  return toUnicodeLine(value, "", 260)
    .replace(/^(?:style\s+sonore|direction\s+sonore|couleur\s+sonore|ambiance\s+sonore|mood|genre|style|instruction|consigne|structure|format\s+attendu|concept|th[eè]me|theme|titre)\s*[:.-]?\s*/i, "")
    .trim();
}

function isVivyNossenSonicStyleLine(value = "") {
  const raw = String(value || "").trim();
  const folded = foldForLookup(raw);
  if (!folded) return false;
  if (/^(?:style\s+sonore|direction\s+sonore|couleur\s+sonore|ambiance\s+sonore|mood|genre|style)\b/.test(folded)) return true;
  const styleMatches = folded.match(/\b(?:epic|cinematic|cinematique|cinématique|dark|pop|rock|metal|electro|rap|anthem|motorbike|racing|powerful|female|male|vocal|voice|guitars?|guitares?|drums?|batterie|synths?|orchestr(?:e|al|ation)?|strings?|bpm|stadium|crowd|choir|reverb|bass|basse)\b/g) || [];
  return styleMatches.length >= 3 && (raw.includes(",") || /\b(?:vocal|bpm|drums?|guitars?|synths?|orchestr|anthem)\b/.test(folded));
}

function isVivyNossenStructureInstructionLine(value = "") {
  const folded = foldForLookup(value);
  if (!folded) return false;
  if (/^(?:instruction|consigne|structure|format\s+attendu|ecrire|écrire|ecris|écris)\b/.test(folded)) return true;
  if (/\b(?:mets|met|mettre)\b.{0,80}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/\b(?:put|turn|make)\b.{0,80}\b(?:action|theme|mood|ambience|ambiance|title|epic|fantasy)\b/.test(folded)) return true;
  if (/\b(?:quand\s+tu\s+es\s+prete|quand\s+tu\s+es\s+prête|envoie|envois|envoies|lance|sort)\b.{0,80}\b(?:son|ton|chanson|musique|voix\s+feminine|voix\s+féminine|bien\s+aimee|bien\s+aimée)\b/.test(folded)) return true;
  if (/\b(?:when\s+you(?:\s+re|\s+are)\s+ready|send|launch|release|drop)\b.{0,80}\b(?:song|track|music|lyrics|female\s+voice|beloved)\b/.test(folded)) return true;
  if (/\b(?:vraie\s+chanson\s+complete|vraie\s+chanson\s+complète|ecrire.{0,50}chanson\s+complete|écrire.{0,50}chanson\s+complète|ecris.{0,50}chanson\s+complete|écris.{0,50}chanson\s+complète|intro.*couplet.*refrain|couplet.*refrain.*pont|ne\s+pas\s+recopier|ne\s+chante\s+pas|paroles\s+chantables)\b/.test(folded)) return true;
  return false;
}

function looksLikeVivyNossenAssistantLyricsBlock(value = "") {
  const text = toUnicodeText(value, 6000);
  const folded = foldForLookup(text);
  if (!folded
    || /je prends ca comme une vraie discussion|je prends ça comme une vraie discussion/.test(folded)
    || /\bparoles envoyees a suno\b/.test(folded)) return false;
  const sectionCount = (text.match(/\[(?:intro|verse|couplet|pre-chorus|pre-refrain|chorus|refrain|bridge|pont|outro)(?:\s*[-\d][^\]]*)?\]/gi) || []).length;
  return sectionCount >= 3
    && /\[(?:chorus|refrain)(?:\s*[-\d][^\]]*)?\]/i.test(text);
}

function getLatestVivyNossenSongExchange(messages: VivyPublicChatMessage[] = []) {
  const latestUserIndex = messages.findLastIndex((entry) => entry.role === "user");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (index < latestUserIndex) break;
    const entry = messages[index];
    if (entry?.role !== "assistant" || !looksLikeVivyNossenAssistantLyricsBlock(entry.content)) continue;
    const precedingUser = messages
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.role === "user" && normalizeVivyNossenUserContent(candidate.content).trim());
    return [precedingUser?.content || "", entry.content].filter(Boolean);
  }
  return [];
}

function collectVivyNossenSemanticLine(canvas: VivyNossenSemanticCanvas & { lyricLines: string[] }, value = "") {
  const raw = toUnicodeLine(value, "", 320)
    .replace(/^(?:Utilisateur|Vivy)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return;
  if (looksLikeVivyNossenTechnicalMediaLine(raw)) {
    canvas.technicalNoise.push(raw);
    return;
  }
  if (isVivyNossenSonicStyleLine(raw)) {
    const hint = stripVivyNossenControlLabel(raw);
    if (hint) canvas.styleHints.push(hint);
    return;
  }
  if (isVivyNossenStructureInstructionLine(raw)) {
    const hint = stripVivyNossenControlLabel(raw);
    if (hint) canvas.structureHints.push(hint);
    return;
  }
  const cleaned = cleanVivyNossenLyricSourceLine(raw);
  if (cleaned) canvas.lyricLines.push(cleaned);
}

function buildVivyNossenSemanticCanvas(
  messages: VivyPublicChatMessage[] = [],
  draft = "",
  files: VivyPublicChatFile[] = [],
  compositionCanvas = ""
): VivyNossenSemanticCanvas {
  const rawUserContext = [
    ...messages.filter((entry) => entry.role === "user").map((entry) => entry.content),
    draft,
  ].filter(Boolean).join("\n");
  const useAttachmentText = isVivyNossenUseAttachmentTextRequest(rawUserContext);
  const canvas: VivyNossenSemanticCanvas & { lyricLines: string[] } = {
    lyricSource: "",
    sourceKind: "empty",
    lyricLines: [],
    styleHints: [],
    structureHints: [],
    technicalNoise: [],
    mediaHints: [],
  };
  const splitSemanticLines = (value = "") => toUnicodeText(value, 2600)
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const latestSongExchange = getLatestVivyNossenSongExchange(messages);
  const latestUserMessage = [...messages]
    .reverse()
    .find((entry) => entry.role === "user" && normalizeVivyNossenUserContent(entry.content).trim());
  const explicitDraft = normalizeVivyNossenUserContent(draft).trim();
  const sourceEntries = explicitDraft
    ? [explicitDraft]
    : latestSongExchange.length
      ? latestSongExchange
      : compositionCanvas.trim()
        ? [compositionCanvas]
        : latestUserMessage
          ? [latestUserMessage.content]
          : [];
  canvas.sourceKind = explicitDraft
    ? "draft"
    : latestSongExchange.length
      ? "chat"
      : compositionCanvas.trim()
        ? "composition"
        : latestUserMessage
          ? "chat"
          : "empty";
  sourceEntries.forEach((entry) => {
    splitSemanticLines(entry)
      .forEach((line) => collectVivyNossenSemanticLine(canvas, line));
  });

  files.slice(0, 6).forEach((file) => {
    const safeVisualHint = toUnicodeLine(file.visualDescription || file.description, "", 220);
    if (safeVisualHint && !looksLikeVivyNossenTechnicalMediaLine(safeVisualHint)) canvas.mediaHints.push(safeVisualHint);
    if (!useAttachmentText) {
      [
        file.filename,
        file.textPreview,
        file.analysisSummary,
      ].filter(Boolean).forEach((line) => canvas.technicalNoise.push(toUnicodeLine(line, "", 220)));
      return;
    }
    [
      file.description,
      file.visualDescription,
      file.textPreview,
      file.analysisSummary,
    ].filter(Boolean).forEach((line) => splitSemanticLines(line).forEach((part) => collectVivyNossenSemanticLine(canvas, part)));
  });

  canvas.lyricSource = toUnicodeText(uniqueVivyNossenLines(canvas.lyricLines, 32).join("\n"), 7200).trim();
  canvas.styleHints = uniqueVivyNossenLines(canvas.styleHints, 8);
  canvas.structureHints = uniqueVivyNossenLines(canvas.structureHints, 8);
  canvas.technicalNoise = uniqueVivyNossenLines(canvas.technicalNoise, 12);
  canvas.mediaHints = uniqueVivyNossenLines(canvas.mediaHints, 8);
  return canvas;
}

function normalizeVivyNossenContextSource(
  messages: VivyPublicChatMessage[] = [],
  draft = "",
  files: VivyPublicChatFile[] = []
) {
  return buildVivyNossenSemanticCanvas(messages, draft, files).lyricSource;
}

function buildVivyNossenBangerReadiness(
  messages: VivyPublicChatMessage[] = [],
  draft = "",
  files: VivyPublicChatFile[] = [],
  compositionCanvas = ""
): VivyNossenBangerReadiness {
  const canvas = buildVivyNossenSemanticCanvas(messages, draft, files, compositionCanvas);
  const source = canvas.lyricSource;
  const folded = foldForLookup(source);
  const foldedSemantic = foldForLookup([
    source,
    ...canvas.styleHints,
    ...canvas.structureHints,
    ...canvas.mediaHints,
  ].join("\n"));
  const actualCreativeUserTurns = messages
    .filter((entry) => entry.role === "user")
    .map((entry) => normalizeVivyNossenUserContent(entry.content))
    .filter((content) => content.trim().length >= 32).length;
  const draftTurn = normalizeVivyNossenUserContent(draft).trim().length >= 80 ? 1 : 0;
  const fileTurn = canvas.mediaHints.length && source.length >= 120 ? 1 : 0;
  const userTurns = actualCreativeUserTurns + draftTurn + fileTurn;
  const hasSongSignal = /\b(chanson|musique|paroles|refrain|couplet|bridge|outro|intro|suno|banger|son|melodie|mélodie|prod|composition)\b/.test(foldedSemantic);
  const hasVoiceSignal = /\b(voix|vocal|vocale|chanteur|chanteuse|solo|duo|trio|quatuor|djeff|vivy|a11|k44|kaen44|ref)\b/.test(foldedSemantic);
  const hasColorSignal = /\b(ambiance|couleur|sonor|mood|dark|sombre|doux|douce|electro|rap|pop|metal|rock|cinematique|cinématique|epique|épique|triste|lumineux|guitare|piano|basse|drums|batterie)\b/.test(foldedSemantic);
  const lyricLineCount = source.split(/\r?\n+/).map((line) => cleanVivyNossenLyricSourceLine(line)).filter((line) => line.length >= 12).length;
  const hasStrongSongDraft = /\[(?:verse|chorus|refrain|couplet|bridge|pont|intro|outro)(?:\s+\d+)?\]/i.test(source)
    || (lyricLineCount >= 7 && hasSongSignal && source.length >= 420);
  let score = Math.min(42, Math.floor(source.length / 70)) + Math.min(24, userTurns * 6);
  if (hasSongSignal) score += 18;
  if (hasVoiceSignal) score += 14;
  if (hasColorSignal) score += 12;
  if (canvas.styleHints.length) score += 6;
  if (/\b(nossen|funesterie|djeff|vivy)\b/.test(folded)) score += 8;
  if (fileTurn) score += 8;
  const hasEnoughTurns = actualCreativeUserTurns >= 2
    || (actualCreativeUserTurns >= 1 && draftTurn > 0)
    || (actualCreativeUserTurns >= 1 && fileTurn > 0)
    || hasStrongSongDraft;
  const longEnough = source.length >= 360 || (source.length >= 180 && fileTurn > 0) || hasStrongSongDraft;
  const ready = Boolean(source && longEnough && hasEnoughTurns && hasSongSignal && score >= 62);
  return {
    ready,
    score,
    source,
    sourceKind: canvas.sourceKind,
    styleHints: canvas.styleHints,
    structureHints: canvas.structureHints,
    technicalNoise: canvas.technicalNoise,
    mediaHints: canvas.mediaHints,
    reason: ready
      ? "Vivy sent assez de matière pour enflammer NOSSEN."
      : "Vivy attend encore un peu de matière avant d'enflammer NOSSEN.",
  };
}

function buildVivyNossenLaunchReadiness(readiness: VivyNossenBangerReadiness, draft = ""): VivyNossenBangerReadiness {
  const source = readiness.source.trim()
    || normalizeVivyNossenUserContent(draft).trim();
  return {
    ...readiness,
    ready: true,
    source,
    sourceKind: source ? readiness.sourceKind : "empty",
    reason: readiness.ready
      ? readiness.reason
      : "NOSSEN peut partir maintenant: Vivy écrit les paroles avec le contexte disponible.",
  };
}

function inferVivyNossenSonicMood(readiness: Pick<VivyNossenBangerReadiness, "source" | "styleHints" | "mediaHints">, artists: VivyStudioArtistId[] = []) {
  const explicit = readiness.styleHints.slice(0, 3).join(", ").trim();
  if (explicit) return explicit;
  const folded = foldForLookup([readiness.source, ...readiness.mediaHints].join("\n"));
  if (/\bkirito\b|\bsword\s+art\s+online\b|\bsao\b|\baincrad\b|\basuna\b|\balfheim\b|\banime\b|\bmanga\b|\bshonen\b|\bshônen\b|\bisekai\b|\bopening\b|\bgenerique\b|\bgénérique\b/.test(folded)) {
    return "opening animé J-rock / J-pop rock, batterie rapide, guitares lumineuses, synthés héroïques, couplets nerveux, refrain massif et mémorisable";
  }
  if (/\bzorro\b|\bjusticier\b|\bmasque\b|\bepee\b|\bépée\b|\bcheval\s+noir\b/.test(folded)) {
    return "latin cinematic pop-rock, guitare espagnole, palmas, castagnettes, trompettes western, batterie héroïque";
  }
  if (/\bpeter\s+pan\b|\bclochette\b|\bcrochet\b|\bneverland\b|\bpays\s+imaginaire\b|\bcrocodile\b|\btic\s*tac\b|\bpirate\b/.test(folded)) {
    return "anime opening aventure, orchestral pop aérien, cloches féeriques, chœurs légers, batterie vive";
  }
  if (/\btoupie\b|\bbeyblade\b|\blanceurs?\b|\bspin\b|\bspinning\b/.test(folded)) {
    return "electro pop tournoi, percussion tournoyante, basse ronde, claps rapides, synthés spirale, hook énergique";
  }
  if (/\bcycliste\b|\bcyclisme\b|\bvelo\b|\bvélo\b|\bpodium\b|\bpeloton\b|\balgerie\b|\balgérie\b/.test(folded)) {
    return "road movie pop-rock, batterie roulante, basse motrice, guitares ouvertes, cuivres de podium, souffle de peloton";
  }
  if (/\bdbz\b|\bdragon\s*ball\b|\bsuper\s*saiyan\b|\bspider[-\s]?man\b|\bavengers?\b|\bmarvel\b|\bdc\s+comics?\b|\bheros\b|\bhéros\b|\banime\b/.test(folded)) {
    return "anime opening héroïque, pop-rock cinématique, batterie massive, guitares lumineuses, chœurs larges, montée frisson";
  }
  if (/\btroie\b|\bhelene\b|\bhélène\b|\bcheval\s+de\s+troie\b|\bmythe\b|\bmytholog/.test(folded)) {
    return "mythological electro-rock, tambours solennels, cordes dramatiques, synthés profonds, vocal héroïque";
  }
  if (/\bmoto\b|\bscooter\b|\bpignon\b|\bcouronne\b|\bradiateur\b|\bchaine\b|\bchaîne\b|\bmoteur\b|\bessence\b|\bhuile\b|\bstunt\b/.test(folded)) {
    return "technical rap moto, basse lourde, drums secs, guitares garage, engine pulse, hook proche micro";
  }
  if (/\becrans?\b|\bécrans?\b|\bnouvelle\s+generation\b|\bnouvelle\s+génération\b|\breseaux\b|\bréseaux\b|\bnumerique\b|\bnumérique\b/.test(folded)) {
    return "modern alt-pop numérique, basses rondes, pads granuleux, percussion glitch, hook humain";
  }
  return "";
}

function inferVivyNossenBangerArtists(source = ""): VivyStudioArtistId[] {
  const folded = foldForLookup(source);
  const artists: VivyStudioArtistId[] = [];
  const add = (artistId: VivyStudioArtistId) => {
    if (!artists.includes(artistId)) artists.push(artistId);
  };
  if (/\bquatuor|quatre\s+voix|4\s+voix\b/.test(folded)) return ["djeff", "vivy", "a11", "k44"];
  if (/\btrio|trois\s+voix|3\s+voix\b/.test(folded)) {
    add("djeff");
    add("vivy");
    add(/\bk44|kaen44|kaen\b/.test(folded) ? "k44" : "a11");
  }
  if (/\bduo|deux\s+voix|2\s+voix\b/.test(folded)) {
    add("vivy");
    add(/\bk44|kaen44|kaen\b/.test(folded) ? "k44" : "djeff");
  }
  if (/\bdjeff\b/.test(folded)) add("djeff");
  if (/\bvivy\b|refrain|melodie|mélodie|chant/.test(folded)) add("vivy");
  if (/\ba11\b|alpha/.test(folded)) add("a11");
  if (/\bk44\b|kaen44|kaen\b/.test(folded)) add("k44");
  if (!artists.length) add("vivy");
  return artists.slice(0, 4);
}

function describeVivyNossenBangerCast(artists: VivyStudioArtistId[]) {
  const labels = artists.map((artistId) => VIVY_STUDIO_ARTISTS.find((artist) => artist.id === artistId)?.label || artistId);
  const prefix = artists.length >= 4 ? "Quatuor"
    : artists.length === 3 ? "Trio"
      : artists.length === 2 ? "Duo"
        : "Solo";
  return `${prefix} ${labels.join(" + ")}`;
}

function cleanVivyNossenLyricSourceLine(value = "") {
  const line = toUnicodeLine(value, "", 190)
    .replace(/^(?:Utilisateur|Vivy)\s*:\s*/i, "")
    .replace(/^(?:concept|th[eè]me|theme|titre)\s*[:.-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "";
  const folded = foldForLookup(line);
  if (/^(?:copier|vous|vivy|codex)\b/.test(folded)) return "";
  if (looksLikeVivyNossenOperatorNoiseLine(folded)) return "";
  return line
    .replace(/[<>[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();
}

function looksLikeVivyNossenOperatorNoiseLine(folded = "") {
  if (!folded) return true;
  if (looksLikeVivyNossenTechnicalMediaLine(folded)) return true;
  if (isVivyNossenSonicStyleLine(folded)) return true;
  if (isVivyNossenStructureInstructionLine(folded)) return true;
  if (/\b(?:d40|suno|fallback|secours|codex|prompt|telechargement|téléchargement|telecharger|télécharger|bouton|compile|compil|compiler|compilateur|formulaire|detecteur|détecteur|ajustements internes|grand modele|grand modèle|mode automatique|generation d40|génération d40)\b/.test(folded)) return true;
  if (/\b(?:nossen\s+mode|mode\s+nossen|tu\s+peux\s+faire\s+le\s+nossen|que\s+tu\s+fasses\s+un\s+son|fais\s+le\s+banger|lance\s+le\s+banger|demander\s+a\s+vivy|demander\s+à\s+vivy)\b/.test(folded)) return true;
  if (/\b(?:paroles?\s+passent?\s+pas|musique\s+bug|generation\s+musique\s+bug|génération\s+musique\s+bug|phrase générique|truc générique|generique|réecrit|réécrit|reecrit|recopie|recopier)\b/.test(folded)) return true;
  if (/\b(?:bug|bugs?|marche\s+pas|sort\s+pas|sorti\s+pas|corrige|corriger|fix|logs?|credits?|crédits?|cles?|clés?|key|llm|quota|token|secret)\b/.test(folded)) return true;
  if (/\b(?:repete|répète|repetes|répètes|reponse|réponse|reponses|réponses|perroquet|singeur|singe|confond|confondu|sortie\s+compilateur|user\s+avec|compiler\s+output)\b/.test(folded)) return true;
  if (/\b(?:oui\s+je\s+te\s+suis|je\s+suis\s+la\s+et\s+je\s+te\s+suis|je\s+dois\s+repondre\s+a\s+ce\s+que\s+tu\s+poses|je\s+dois\s+répondre\s+à\s+ce\s+que\s+tu\s+poses|sur\s+le\s+fond|avec\s+le\s+contexte)\b/.test(folded)) return true;
  if (/\b(?:affichage|telephone|téléphone|mobile|dezoom|dézoom|clavier|viewport|scroll|impossible\s+d[' ]?ecrire|impossible\s+d[' ]?écrire|ca\s+bouge|ça\s+bouge)\b/.test(folded)) return true;
  if (/\b(?:mets|met|mettre)\b.{0,80}\b(?:action|theme|th[eè]me|ambiance|titre)\b/.test(folded)) return true;
  if (/\b(?:put|turn|make)\b.{0,80}\b(?:action|theme|mood|ambience|ambiance|title|epic|fantasy)\b/.test(folded)) return true;
  if (/\b(?:quand\s+tu\s+es\s+prete|quand\s+tu\s+es\s+prête|envoie|envois|envoies|lance|sort)\b.{0,80}\b(?:son|ton|chanson|musique|voix\s+feminine|voix\s+féminine|bien\s+aimee|bien\s+aimée)\b/.test(folded)) return true;
  if (/\b(?:when\s+you(?:\s+re|\s+are)\s+ready|send|launch|release|drop)\b.{0,80}\b(?:song|track|music|lyrics|female\s+voice|beloved)\b/.test(folded)) return true;
  return false;
}

function normalizeVivyNossenUserContent(value = "") {
  return toUnicodeText(value, 2400)
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\r?\n+/)
    .map(cleanVivyNossenLyricSourceLine)
    .filter((line) => line.length >= 12)
    .slice(0, 24)
    .join("\n")
    .trim();
}

function extractVivyNossenLyricFragments(source = "") {
  const rawParts = String(source || "")
    .split(/\r?\n|[.!?]+/)
    .map(cleanVivyNossenLyricSourceLine)
    .filter((line) => line.length >= 12 && line.length <= 190);
  const unique: string[] = [];
  rawParts.forEach((line) => {
    const key = foldForLookup(line);
    if (!key || unique.some((entry) => foldForLookup(entry) === key)) return;
    unique.push(line);
  });
  return unique.slice(0, 18);
}

function wantsVivyNossenBangerWord(source = "") {
  return extractVivyNossenLyricFragments(source).some((line) => {
    const folded = foldForLookup(line);
    if (looksLikeVivyNossenOperatorNoiseLine(folded)) return false;
    return /\b(?:banger|baingueur|baa?nger)\b/.test(folded);
  });
}

function buildVivyNossenLyricsRequest(readiness: VivyNossenBangerReadiness, artists: VivyStudioArtistId[]) {
  const useBangerWord = wantsVivyNossenBangerWord(readiness.source);
  const sonicMood = inferVivyNossenSonicMood(readiness, artists);
  const styleLine = sonicMood
    ? `Direction sonore à ressentir sans la chanter: ${sonicMood}.`
    : "";
  const structureLine = readiness.structureHints.length
    ? `Souhait de structure: ${readiness.structureHints.slice(0, 3).join(" / ")}.`
    : "";
  const materialBlock = readiness.source.trim()
    ? `Matière créative du canevas Composition à transformer:\n\n${readiness.source}`
    : "Aucune matière n'est imposée. Choisis toi-même un sujet précis, une situation concrète et un angle narratif singulier avant d'écrire.";
  return toUnicodeText([
    "Écris uniquement les paroles complètes d'une chanson originale.",
    `Distribution vocale choisie: ${describeVivyNossenBangerCast(artists)}.`,
    styleLine,
    structureLine,
    "Écris une version longue, dense et chantable: intro, trois ou quatre couplets, pré-refrains, refrain mémorable répété au moins trois fois, pont, montée finale et outro. Le refrain doit revenir après le dernier pont.",
    "Chaque section doit apporter une image nouvelle, une progression émotionnelle et des rimes travaillées; évite les formules génériques et ne décris jamais la fabrication du morceau.",
    useBangerWord
      ? "Le mot Banger est autorisé seulement comme hook voulu par l'utilisateur."
      : "Ne mets pas le mot Banger dans les paroles.",
    "Ne reprends pas les phrases de réglage, les noms d'outils, les liens, les bugs, ni les consignes techniques.",
    materialBlock,
  ].filter(Boolean).join("\n\n"), 6200);
}

function buildVivyNossenBangerProductionBrief(readiness: VivyNossenBangerReadiness, artists: VivyStudioArtistId[]) {
  const useBangerWord = wantsVivyNossenBangerWord(readiness.source);
  const hasUserStyleHints = readiness.styleHints.length > 0;
  const sonicMood = inferVivyNossenSonicMood(readiness, artists);
  const styleLine = sonicMood
    ? `${hasUserStyleHints ? "Style sonore utilisateur" : "Style sonore choisi par Vivy depuis la matière"} (direction uniquement, jamais paroles): ${sonicMood}.`
    : "";
  const structureLine = readiness.structureHints.length
    ? `Contraintes de structure utilisateur: ${readiness.structureHints.slice(0, 3).join(" / ")}.`
    : "";
  return toUnicodeText([
    "Production musicale NOSSEN.",
    `Casting choisi: ${describeVivyNossenBangerCast(artists)}.`,
    styleLine,
    structureLine,
    "Format attendu: chanson complète sans durée imposée, développée autant que la matière le demande. Le refrain doit revenir après le dernier pont, pas disparaître avant la fin.",
    useBangerWord
      ? "Le mot Banger peut être utilisé parce que la demande utilisateur le cite."
      : "Ne jamais chanter le nom du bouton, son effet de lancement, les bugs, les liens, les instructions internes ou le mot prompt.",
    "Garder les voix sélectionnées comme direction de casting; si aucune voix vérifiée n'existe, Suno doit chanter avec une couleur proche et cohérente.",
  ].filter(Boolean).join("\n\n"), 2200);
}

function sanitizeVivyNossenSongSeed(value = "") {
  const lines = toUnicodeText(value, VIVY_STUDIO_SONG_MAX_CHARS)
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\[[^\]]+\]$/.test(trimmed)) return true;
      if (looksLikeVivyNossenTechnicalMediaLine(trimmed)) return false;
      if (isVivyNossenSonicStyleLine(trimmed)) return false;
      if (isVivyNossenStructureInstructionLine(trimmed)) return false;
      if (looksLikeVivyNossenOperatorNoiseLine(foldForLookup(trimmed))) return false;
      return true;
    });
  return toUnicodeText(lines.join("\n").replace(/\n{3,}/g, "\n\n"), VIVY_STUDIO_SONG_MAX_CHARS).trim();
}

function isValidVivyNossenSongSeed(value = "") {
  const text = sanitizeVivyNossenSongSeed(value);
  if (!text) return false;
  const folded = foldForLookup(text);
  if (/\b(?:oui\s+je\s+te\s+suis|je\s+dois\s+repondre\s+a\s+ce\s+que\s+tu\s+poses|sur\s+le\s+fond|avec\s+le\s+contexte)\b/.test(folded)) return false;
  const sectionCount = (text.match(/^\s*\[(?:Intro|Verse|Couplet|Pre[- ]?Chorus|Pré[- ]?refrain|Refrain|Chorus|Bridge|Pont|Outro|Final(?:\s+Chorus)?)\b[^\]]*\]\s*$/gim) || []).length;
  const chorusCount = (text.match(/^\s*\[(?:Refrain|Chorus|Final\s+Chorus)\b[^\]]*\]\s*$/gim) || []).length;
  const lyricLineCount = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]$/.test(line))
    .length;
  return sectionCount >= 4 && chorusCount >= 2 && lyricLineCount >= 16;
}

function playVivyNossenBangerCall() {
  if (typeof window === "undefined") return;
  try {
    const audio = new Audio(VIVY_NOSSEN_BANGER_CALL_SRC);
    audio.preload = "auto";
    audio.volume = 0.94;
    audio.play().catch(() => {});
  } catch {
    // User gesture audio is best-effort; the music generation must still launch.
  }
}

function getVivyProductionMediaPreview(payload: any, fallbackFilename = "vivy-nossen.mp3"): VivyStudioMediaPreview | null {
  const media = payload?.media || payload?.musicJob?.media || {};
  const audioUrl = String(
    payload?.audioUrl
    || payload?.audio_url
    || media?.audioUrl
    || media?.audio_url
    || media?.downloadUrl
    || media?.download_url
    || media?.url
    || ""
  ).trim();
  const videoUrl = String(payload?.videoUrl || payload?.video_url || media?.videoUrl || media?.video_url || "").trim();
  const url = audioUrl || videoUrl;
  if (!url) return null;
  const downloadUrl = String(media?.downloadUrl || media?.download_url || audioUrl || url).trim();
  return {
    kind: audioUrl ? "audio" : "video",
    url: resolveApiAssetUrl(url) || url,
    downloadUrl: resolveApiAssetUrl(downloadUrl) || downloadUrl || resolveApiAssetUrl(url) || url,
    provider: String(media?.provider || payload?.mediaStatus?.provider || payload?.musicJob?.provider || "vivy-music").trim(),
    contentType: String(media?.contentType || media?.content_type || payload?.contentType || payload?.content_type || (audioUrl ? "audio/mpeg" : "video/mp4")).trim(),
    filename: String(media?.filename || payload?.filename || fallbackFilename).trim(),
    id: String(media?.id || media?.audioId || media?.audio_id || payload?.id || payload?.audioId || payload?.audio_id || "").trim() || undefined,
    audioId: String(media?.audioId || media?.audio_id || media?.id || payload?.audioId || payload?.audio_id || payload?.id || "").trim() || undefined,
    durationSeconds: Number.isFinite(Number(media?.durationSeconds ?? media?.duration ?? payload?.durationSeconds ?? payload?.duration))
      ? Number(media?.durationSeconds ?? media?.duration ?? payload?.durationSeconds ?? payload?.duration)
      : undefined,
    model: String(media?.model || payload?.musicJob?.model || payload?.mediaStatus?.model || payload?.model || payload?.modelName || payload?.model_name || "").trim() || undefined,
    taskId: String(media?.taskId || media?.jobId || payload?.taskId || payload?.jobId || payload?.musicJob?.taskId || payload?.mediaStatus?.taskId || "").trim() || undefined,
  };
}

function getVivyProductionSunoAudioId(payload: any, media?: VivyStudioMediaPreview | null) {
  const raw = media?.audioId
    || media?.id
    || payload?.media?.audioId
    || payload?.media?.audio_id
    || payload?.media?.id
    || payload?.musicJob?.media?.audioId
    || payload?.musicJob?.media?.audio_id
    || payload?.musicJob?.media?.id
    || payload?.audioId
    || payload?.audio_id
    || "";
  return String(raw || "").trim();
}

function getVivyProductionDurationSeconds(payload: any, media?: VivyStudioMediaPreview | null) {
  const raw = media?.durationSeconds
    ?? payload?.media?.durationSeconds
    ?? payload?.media?.duration
    ?? payload?.musicJob?.media?.durationSeconds
    ?? payload?.musicJob?.media?.duration
    ?? payload?.durationSeconds
    ?? payload?.duration;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getVivyProductionSunoModel(payload: any, media?: VivyStudioMediaPreview | null) {
  return String(
    media?.model
    || payload?.media?.model
    || payload?.musicJob?.model
    || payload?.mediaStatus?.model
    || payload?.model
    || ""
  ).trim();
}

function buildVivyNossenBangerAssistantText(
  payload: any,
  media: VivyStudioMediaPreview | null,
  artists: VivyStudioArtistId[],
  d40Applied: boolean,
  fallbackLyrics = ""
) {
  const title = toUnicodeLine(payload?.title, "", 120);
  const summary = toUnicodeText(payload?.summary || payload?.publicText || payload?.assistant || payload?.content, 900);
  const lyrics = toUnicodeText(payload?.publicLyrics || payload?.vocalLyrics || fallbackLyrics || "", 4200);
  const downloadLine = media?.downloadUrl || media?.url ? `Téléchargement: ${media.downloadUrl || media.url}` : "";
  const opener = wantsVivyNossenBangerWord(fallbackLyrics) ? "Banger." : "NOSSEN.";
  return toUnicodeText([
    opener,
    title ? `Titre: ${title}` : "",
    `Casting: ${describeVivyNossenBangerCast(artists)}.`,
    d40Applied ? "Mix final prêt." : "Production prête.",
    downloadLine,
    lyrics ? "Paroles envoyées à Suno:" : "",
    lyrics || summary,
    lyrics && summary ? `Note: ${summary}` : "",
  ].filter(Boolean).join("\n\n"), 6200);
}

function normalizeVivyStudioMode(value: unknown): VivyStudioMode | null {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "voice" || raw === "test" || raw === "song" || raw === "share" ? raw : null;
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

function redactVivyStudioSensitiveOutput(value: string) {
  return String(value || "")
    .replace(/https?:\/\/[^\s<>"')]+/gi, (url) => {
      if (/[?&](?:token|key|signature|sig|access_token)=/i.test(url)) return "[lien média sécurisé masqué]";
      if (/\/api\/double-harmonic\/out\//i.test(url)) return "[lien média D40 masqué]";
      return url.replace(/[?&].*$/, "");
    })
    .replace(/\b(?:token|key|signature|sig|access_token)=\S+/gi, (match) => `${match.split("=")[0]}=[masqué]`)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanVivyStudioOutputLine(line: string) {
  const cleaned = redactVivyStudioSensitiveOutput(line)
    .replace(/\s*pr[êe]t\s*:\s*\[lien média [^\]]+\]/i, " prêt")
    .replace(/\s*M[êe]me format pr[êe]t\s*:\s*\[lien média [^\]]+\]/i, " prêt")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (/^VIVY_(?:STUDIO_HANDOFF|PRODUCTION|SONG_PRODUCTION|VOICE_CALIBRATION|SCENE_SHARE)\b/i.test(cleaned)) return "";
  if (/^(?:Atelier|Objectif|Flux\s+(?:voix|test voix|chanson|sc[èe]ne|partage)|R[oô]le|Sortie attendue)\s*:/i.test(cleaned)) return "";
  if (/^Routage recommand[ée]\s*:/i.test(cleaned)) return "";
  if (/^-\s*(?:Vivy|A11|K44|Kaen44)\s*:/i.test(cleaned)) return "";
  if (/^-\s*(?:Outil cible|Profil actif|R[ée]f[ée]rence|Instruction|Route recommand[ée]e|S[ée]curit[ée]|Voix s[ée]lectionn[ée]e|Phrase test|Source|Direction sonore|Mati[èe]re|Casting vocal|Nombre de chanteurs|Distribution vocale|Cl[ée] Suno|Sortie simple possible|Sortie attendue|R[oô]le)\s*:/i.test(cleaned)) return "";
  if (/^Job Suno\s*:/i.test(cleaned)) return "Job Suno: lancé (identifiant masqué du brief)";
  return cleaned;
}

function cleanVivyStudioPublicBlock(value: string, maxLines = 80) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lines = raw
    .split(/\r?\n+/)
    .map(cleanVivyStudioOutputLine)
    .filter(Boolean);
  return lines.slice(0, maxLines).join("\n").trim();
}

function normalizeVivyStudioOutputForState(value: string, maxLines = 6) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lines = raw
    .split(/\r?\n+/)
    .map(cleanVivyStudioOutputLine)
    .filter(Boolean);
  const compact: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = foldForLookup(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    compact.push(line);
  }
  return compact.slice(-maxLines).join("\n");
}

function appendVivyStudioOutputStatus(current: string, next: string) {
  return normalizeVivyStudioOutputForState([current, next].filter(Boolean).join("\n"), 6);
}

function buildVivyStudioProductionStatus(output: string) {
  const normalized = normalizeVivyStudioOutputForState(output, 6);
  if (!normalized) return "";
  const lines = normalized.split(/\r?\n+/).filter(Boolean);
  const d40Lines = lines.filter((line) => /^Mix D40\b/i.test(line));
  if (d40Lines.length) {
    return [
      "VIVY_PRODUCTION_STATUS",
      `Dernier média: ${d40Lines[d40Lines.length - 1]}`,
      d40Lines.length > 1 ? `Historique local: ${d40Lines.length} sorties D40 prêtes, liens masqués du brief.` : "",
      "Média: disponible dans le lecteur du Studio, pas recopié dans le brief agents.",
    ].filter(Boolean).join("\n");
  }
  return [
    "VIVY_PRODUCTION_STATUS",
    ...lines,
  ].join("\n");
}

function getVivyStudioDraftStorageKey() {
  try {
    return `${VIVY_STUDIO_DRAFT_KEY}:${getAuthStorageScope() || "locked"}`;
  } catch {
    return `${VIVY_STUDIO_DRAFT_KEY}:locked`;
  }
}

function readVivyStudioDraft() {
  try {
    const raw = globalThis.localStorage?.getItem(getVivyStudioDraftStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        vivyOutput: normalizeVivyStudioOutputForState(String(parsed.vivyOutput || "")),
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeVivyStudioDraft(value: Record<string, unknown>) {
  try {
    globalThis.localStorage?.setItem(getVivyStudioDraftStorageKey(), JSON.stringify({
      ...value,
      vivyOutput: normalizeVivyStudioOutputForState(String(value.vivyOutput || "")),
    }));
  } catch {
    // Storage is optional for the public page.
  }
}

function readVivyStudioCompositionWorkspace() {
  const draft = readVivyStudioDraft();
  if (!draft || typeof draft !== "object") {
    return { canvas: "", notes: "", songArtists: [] as VivyStudioArtistId[], castingAuto: true };
  }
  return {
    canvas: toUnicodeText(String(draft.songText || ""), VIVY_STUDIO_SONG_MAX_CHARS).trim(),
    notes: toUnicodeText(String(draft.songMood || ""), 800).trim(),
    songArtists: normalizeVivyStudioArtists(draft.songArtists),
    castingAuto: draft.songCastingAuto !== false,
  };
}

function readVivySessionSunoKey() {
  try {
    const directKey = String(globalThis.sessionStorage?.getItem(VIVY_STUDIO_SUNO_SESSION_KEY) || "").trim();
    return directKey || String(readSessionAppTokens().suno || "").trim();
  } catch {
    return "";
  }
}

function writeVivySessionSunoKey(value: string) {
  const safeValue = String(value || "").trim();
  try {
    if (safeValue) globalThis.sessionStorage?.setItem(VIVY_STUDIO_SUNO_SESSION_KEY, safeValue);
    else globalThis.sessionStorage?.removeItem(VIVY_STUDIO_SUNO_SESSION_KEY);
    writeSessionAppToken("suno", safeValue);
  } catch {
    // Session key is optional and never persisted outside this browser session.
  }
}

type VivyStudioArtistId = "djeff" | "vivy" | "a11" | "k44";
type VivyStudioVoiceLearningPersona = "djeff" | "vivy" | "a11" | "kaen44" | "personal";

const VIVY_STUDIO_ARTISTS: Array<{
  id: VivyStudioArtistId;
  label: string;
  tag: string;
  role: string;
}> = [
  {
    id: "djeff",
    label: "Djeff",
    tag: "[Djeff]",
    role: "couplets rap techniques, grain proche micro, images mécaniques concrètes",
  },
  {
    id: "vivy",
    label: "Vivy",
    tag: "[Vivy]",
    role: "refrain clair, réponses mélodiques, voix claire, émotion lumineuse",
  },
  {
    id: "a11",
    label: "A11",
    tag: "[A11]",
    role: "voix grave synthétique, pont narratif court, tension machine humaine",
  },
  {
    id: "k44",
    label: "K44",
    tag: "[K44]",
    role: "contre-chant posé, punchlines calmes, second lead propre",
  },
];

const VIVY_STUDIO_VOICE_DIRECTORY: Array<{
  id: VivyStudioVoiceLearningPersona;
  label: string;
  shortLabel: string;
  ownerLabel: string;
  persona: VivyStudioVoiceLearningPersona;
  artistId?: VivyStudioArtistId;
  voiceTool: string;
  ttsPersona: "vivy" | "a11" | "kaen44";
  surface: "vivy" | "a11" | "kaen44";
  voiceStyle: string;
  referenceLabel: string;
  referenceFileName?: string;
  statusLabel: string;
  statusKind: "ready" | "awaiting" | "personal";
  testLine: string;
}> = [
  {
    id: "djeff",
    label: "Djeff officielle",
    shortLabel: "Djeff",
    ownerLabel: "Compte Djeff",
    persona: "djeff",
    artistId: "djeff",
    voiceTool: "Voix Djeff officielle",
    ttsPersona: "a11",
    surface: "a11",
    voiceStyle: "djeff-officielle",
    referenceLabel: "Djeff ref.wav",
    referenceFileName: "Djeff ref.wav",
    statusLabel: "référence prête",
    statusKind: "ready",
    testLine: "Djeff cale le kick, pignon précis, radiateur froid, la voix reste proche du micro.",
  },
  {
    id: "kaen44",
    label: "K44 officielle",
    shortLabel: "K44",
    ownerLabel: "Compte famille K44",
    persona: "kaen44",
    artistId: "k44",
    voiceTool: "Voix K44 officielle",
    ttsPersona: "kaen44",
    surface: "kaen44",
    voiceStyle: "kaen44-official-french-narrator",
    referenceLabel: "K44 Ref.wav",
    referenceFileName: "kaen44-official-french-narrator.wav",
    statusLabel: "référence prête",
    statusKind: "ready",
    testLine: "K44 pose la ligne calmement, chaque mot tient la route, net et sans forcer.",
  },
  {
    id: "a11",
    label: "A11 officielle",
    shortLabel: "A11",
    ownerLabel: "Compte famille A11",
    persona: "a11",
    artistId: "a11",
    voiceTool: "Voix A11 officielle",
    ttsPersona: "a11",
    surface: "a11",
    voiceStyle: "a11-official-stern-french",
    referenceLabel: "A11 ref.wav",
    referenceFileName: "a11-official-stern-french.wav",
    statusLabel: "référence prête",
    statusKind: "ready",
    testLine: "A11 garde le signal, voix basse et nette, la machine respire avec le cœur humain.",
  },
  {
    id: "vivy",
    label: "Vivy officielle",
    shortLabel: "Vivy",
    ownerLabel: "Compte famille Vivy",
    persona: "vivy",
    artistId: "vivy",
    voiceTool: "Voix Vivy officielle",
    ttsPersona: "vivy",
    surface: "vivy",
    voiceStyle: "vivy-official-french-conversational",
    referenceLabel: "Vivy ref.wav",
    referenceFileName: "vivy.wav",
    statusLabel: "référence prête",
    statusKind: "ready",
    testLine: "Salut Jeffrey. Je suis Vivy, voix claire, proche et naturelle, prête à répondre.",
  },
  {
    id: "personal",
    label: "Ma voix",
    shortLabel: "Ma voix",
    ownerLabel: "Compte connecté premium",
    persona: "personal",
    voiceTool: "Voix Vivy + référence privée",
    ttsPersona: "vivy",
    surface: "vivy",
    voiceStyle: "personal-account-voice",
    referenceLabel: "référence privée",
    statusLabel: "premium personnel",
    statusKind: "personal",
    testLine: "Je teste la voix personnelle du compte connecté avec une phrase courte et claire.",
  },
];

type VivyStudioVoiceTestEntry = (typeof VIVY_STUDIO_VOICE_DIRECTORY)[number] | {
  id: string;
  label: string;
  shortLabel: string;
  ttsPersona: "vivy" | "a11" | "kaen44";
  voiceStyle: string;
  referenceLabel?: string;
  referenceFileName?: string;
  voiceTool: string;
  surface: "vivy" | "a11" | "kaen44";
  testLine?: string;
};

type VivyStudioVoiceTestMode = {
  id: "ref" | "rvc" | "sing";
  label: string;
  statusLabel: string;
  vocalMode: "adaptive" | "sing";
  useRvc: boolean;
  timeoutMs: number;
};

const VIVY_STUDIO_VOICE_TEST_MODES: VivyStudioVoiceTestMode[] = [
  {
    id: "ref",
    label: "Ref",
    statusLabel: "référence seule",
    vocalMode: "adaptive",
    useRvc: false,
    timeoutMs: 180000,
  },
  {
    id: "rvc",
    label: "RVC",
    statusLabel: "référence + RVC",
    vocalMode: "adaptive",
    useRvc: true,
    timeoutMs: 240000,
  },
  {
    id: "sing",
    label: "Chant",
    statusLabel: "mode chant",
    vocalMode: "sing",
    useRvc: false,
    timeoutMs: 240000,
  },
];

const DEFAULT_VIVY_STUDIO_ARTISTS: VivyStudioArtistId[] = ["vivy"];

function normalizeVivyStudioArtists(value: unknown, fallback: VivyStudioArtistId[] = DEFAULT_VIVY_STUDIO_ARTISTS): VivyStudioArtistId[] {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[,+/|;\s]+/g)
      .filter(Boolean);
  const foldedValues = new Set(rawValues.map((item) => foldForLookup(item)));
  const selected = VIVY_STUDIO_ARTISTS
    .filter((artist) => {
      const id = foldForLookup(artist.id);
      const label = foldForLookup(artist.label);
      return foldedValues.has(id) || foldedValues.has(label) || (artist.id === "k44" && foldedValues.has("kaen44"));
    })
    .map((artist) => artist.id);
  if (selected.length) return selected;
  return VIVY_STUDIO_ARTISTS
    .filter((artist) => fallback.includes(artist.id))
    .map((artist) => artist.id);
}

function buildVivyStudioArtistCast(ids: VivyStudioArtistId[]) {
  const normalized = normalizeVivyStudioArtists(ids);
  const artists = VIVY_STUDIO_ARTISTS.filter((artist) => normalized.includes(artist.id));
  const count = Math.max(1, artists.length);
  const countLabel = `${count} chanteur${count > 1 ? "s" : ""}`;
  const label = artists.map((artist) => artist.label).join(" + ") || "Vivy";
  const tags = artists.map((artist) => artist.tag).join(", ");
  const songCast = [
    `${countLabel}: ${label}.`,
    ...artists.map((artist) => `${artist.label}: ${artist.role}.`),
    count > 1
      ? `Tags obligatoires dans les paroles: ${tags}, et [Duo] ou [Tous] pour les passages communs.`
      : `Tag conseillé dans les paroles: ${tags}.`,
  ].join(" ");
  return { ids: normalized, artists, count, countLabel, label, tags, songCast };
}

function normalizeVivyStudioVoicePersona(value: unknown, fallback: VivyStudioVoiceLearningPersona = "djeff"): VivyStudioVoiceLearningPersona {
  const folded = foldForLookup(value);
  if (folded === "k44" || folded === "kaen44" || folded === "kaen") return "kaen44";
  if (folded === "djeff" || folded === "djeff-rap" || folded === "djeff-officielle" || folded === "djeff-official" || folded === "pignon") return "djeff";
  if (folded === "vivy" || folded === "vivi") return "vivy";
  if (folded === "a11" || folded === "alphaonze" || folded === "alpha-onze") return "a11";
  if (folded === "personal" || folded === "ma-voix" || folded === "ma_voix" || folded === "my-voice") return "personal";
  return fallback;
}

function getVivyStudioVoiceDirectoryEntry(persona: VivyStudioVoiceLearningPersona) {
  return VIVY_STUDIO_VOICE_DIRECTORY.find((entry) => entry.persona === persona) || VIVY_STUDIO_VOICE_DIRECTORY[0];
}

type VivyStudioVoiceProfile = {
  id: "vivy-official" | "vivy-sing" | "vivy-private" | "catalog-premium" | "djeff-rap" | "duo-djeff-vivy" | "a11-official" | "k44-official" | "diagnostic";
  label: string;
  ttsPersona: "vivy" | "a11" | "kaen44";
  surface: "vivy" | "a11" | "kaen44";
  voiceStyle: string;
  vocalMode: "adaptive" | "sing";
  referenceLabel: string;
  referenceFileName?: string;
  briefVoicePersona: string;
  testLine: string;
  songCast: string;
  uploadLabel: string;
};

function getVivyStudioVoiceProfileForTool(
  voiceTool: string,
  hasPrivateReference = false,
  voiceFileName = ""
): VivyStudioVoiceProfile {
  const folded = foldForLookup(voiceTool);
  const privateLabel = voiceFileName.trim() || "référence privée";
  const wantsDuo = /\bduo\b|djeff.*vivy|vivy.*djeff/.test(folded);
  const wantsK44 = /\bk44\b|\bkaen44\b|\bkaen\b/.test(folded);
  const wantsA11 = /\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded);
  const wantsDjeff = wantsDuo || /\bdjeff\b|\brap\b|\bfraiyeur\b/.test(folded);

  if (wantsDuo) {
    return {
      id: "duo-djeff-vivy",
      label: "Duo Djeff + Vivy",
      ttsPersona: "a11",
      surface: "vivy",
      voiceStyle: "djeff-officielle",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference
        ? `${privateLabel} + Vivy ref.wav`
        : "Djeff ref.wav + Vivy ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "Djeff ref.wav",
      briefVoicePersona: "voicePersona=a11, voiceStyle=djeff-officielle pour Djeff; voicePersona=vivy pour Vivy",
      testLine: "Djeff cale le kick, chaîne sur couronne, pignon précis; Vivy répond dans la nuit, radiateur froid, moteur lucide.",
      songCast: "Djeff prend les couplets rap; Vivy tient les refrains et réponses mélodiques; les paroles doivent garder les tags [Djeff], [Vivy] et [Duo].",
      uploadLabel: `Djeff - ${voiceFileName || "référence rap"}`,
    };
  }

  if (wantsK44) {
    return {
      id: "k44-official",
      label: "Voix K44 officielle",
      ttsPersona: "kaen44",
      surface: "kaen44",
      voiceStyle: "kaen44-official-french-narrator",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "K44 Ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "kaen44-official-french-narrator.wav",
      briefVoicePersona: "voicePersona=kaen44",
      testLine: "K44 pose la ligne, calme dans la cabine, chaque mot verrouille le rythme sans forcer.",
      songCast: "K44 prend le contre-chant posé, les réponses propres et les punchlines calmes.",
      uploadLabel: `K44 - ${voiceFileName || "référence officielle"}`,
    };
  }

  if (wantsA11) {
    return {
      id: "a11-official",
      label: "Voix A11 officielle",
      ttsPersona: "a11",
      surface: "a11",
      voiceStyle: "a11-official-stern-french",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "A11 ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "a11-official-stern-french.wav",
      briefVoicePersona: "voicePersona=a11",
      testLine: "A11 garde le signal, voix basse et nette, la machine respire avec le cœur humain.",
      songCast: "A11 prend les ponts graves, les réponses synthétiques et la tension machine humaine.",
      uploadLabel: `A11 - ${voiceFileName || "référence officielle"}`,
    };
  }

  if (wantsDjeff) {
    return {
      id: "djeff-rap",
      label: "Voix Djeff officielle",
      ttsPersona: "a11",
      surface: "a11",
      voiceStyle: "djeff-officielle",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "Djeff ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "Djeff ref.wav",
      briefVoicePersona: "voicePersona=a11, voiceStyle=djeff-officielle",
      testLine: "Djeff cale le kick, chaîne sur couronne, pignon précis, radiateur froid et moteur lucide.",
      songCast: "Djeff prend le lead rap avec diction serrée, rimes internes et image mécanique concrète.",
      uploadLabel: `Djeff - ${voiceFileName || "référence rap"}`,
    };
  }

  if (/diagnostic/.test(folded)) {
    return {
      id: "diagnostic",
      label: "Diagnostic module voix",
      ttsPersona: "vivy",
      surface: "vivy",
      voiceStyle: "vivy-official-french-conversational",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "Vivy ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "vivy.wav",
      briefVoicePersona: "voicePersona=vivy en diagnostic",
      testLine: "Diagnostic Vivy. Je teste la chaîne voix avec une phrase courte et claire.",
      songCast: "Vivy reste la voix de test pendant le diagnostic du module.",
      uploadLabel: `Vivy - ${voiceFileName || "référence privée"}`,
    };
  }

  if (/catalogue|catalog|premium|voix autorisee|voix autorisée/.test(folded)) {
    return {
      id: "catalog-premium",
      label: "Voix catalogue premium",
      ttsPersona: "vivy",
      surface: "vivy",
      voiceStyle: "voice-catalog-song",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "voix autorisée à choisir",
      briefVoicePersona: "voicePersona=vivy avec référence catalogue consentie",
      testLine: "Je teste une voix autorisée du catalogue Funesterie, sans publier la référence brute.",
      songCast: "La voix catalogue sélectionnée porte le lead ou le duo selon la chanson; garder les tags de chanteurs et ne pas imiter de célébrité.",
      uploadLabel: `Catalogue - ${voiceFileName || "voix autorisée"}`,
    };
  }

  if (/chant|sing/.test(folded)) {
    return {
      id: "vivy-sing",
      label: "Voix Vivy chant",
      ttsPersona: "vivy",
      surface: "vivy",
      voiceStyle: "vivy-official-french-conversational",
      vocalMode: "sing",
      referenceLabel: hasPrivateReference ? privateLabel : "Vivy ref.wav",
      referenceFileName: hasPrivateReference ? undefined : "vivy-song-context.wav",
      briefVoicePersona: "voicePersona=vivy en mode chant",
      testLine: "Je garde ma voix claire, proche du micro, et je transforme la nuit en refrain.",
      songCast: "Vivy porte le chant principal avec diction française claire et refrain mémorable.",
      uploadLabel: `Vivy - ${voiceFileName || "référence chant"}`,
    };
  }

  if (/reference privee|référence privée/.test(folded)) {
    return {
      id: "vivy-private",
      label: "Voix Vivy + référence privée",
      ttsPersona: "vivy",
      surface: "vivy",
      voiceStyle: "vivy-official-french-conversational",
      vocalMode: "adaptive",
      referenceLabel: hasPrivateReference ? privateLabel : "référence privée à ajouter",
      briefVoicePersona: "voicePersona=vivy avec référence privée",
      testLine: "Salut Jeffrey. Je suis Vivy. Je parle doucement, avec une voix claire et proche.",
      songCast: "Vivy utilise la référence privée comme repère de timbre, sans publication brute.",
      uploadLabel: `Vivy - ${voiceFileName || "référence privée"}`,
    };
  }

  return {
    id: "vivy-official",
    label: "Voix Vivy officielle",
    ttsPersona: "vivy",
    surface: "vivy",
    voiceStyle: "vivy-official-french-conversational",
    vocalMode: "adaptive",
    referenceLabel: hasPrivateReference ? privateLabel : "Vivy ref.wav",
    referenceFileName: hasPrivateReference ? undefined : "vivy.wav",
    briefVoicePersona: "voicePersona=vivy",
    testLine: "Salut Jeffrey. Je suis Vivy. Je parle doucement, avec une voix claire et proche.",
    songCast: "Vivy porte la voix principale claire, musicale et précise émotionnellement.",
    uploadLabel: `Vivy - ${voiceFileName || "référence privée"}`,
  };
}

function buildVivyStudioBrief(options: {
  mode: VivyStudioMode;
  voiceTool: string;
  voiceInstruction: string;
  voiceFileName: string;
  voiceReferenceId?: string;
  catalogVoiceName?: string;
  catalogVoiceConsent?: string;
  songSource: string;
  songArtists: VivyStudioArtistId[];
  songMood: string;
  songText: string;
  sessionSunoKeyPresent: boolean;
  shareTarget: string;
  shareUrl: string;
  shareTokenPresent: boolean;
  shareInstruction: string;
}) {
  const active = VIVY_STUDIO_MODES.find((item) => item.id === options.mode) || VIVY_STUDIO_MODES[0];
  const hasPrivateReference = Boolean(String(options.voiceReferenceId || "").trim() || options.voiceFileName.trim());
  const voiceProfile = getVivyStudioVoiceProfileForTool(options.voiceTool, hasPrivateReference, options.voiceFileName);
  const artistCast = buildVivyStudioArtistCast(options.songArtists);
  const lines = [
    "VIVY_STUDIO_HANDOFF",
    `Atelier: ${active.title}`,
    `Objectif: ${active.label}`,
    "",
  ];

  if (options.mode === "voice") {
    lines.push(
      "Flux voix:",
      `- Outil cible: ${options.voiceTool}`,
      `- Profil actif: ${voiceProfile.label}`,
      `- Référence audio: ${voiceProfile.referenceLabel}`,
      options.catalogVoiceName ? `- Voix catalogue autorisée: ${options.catalogVoiceName}` : "",
      options.catalogVoiceConsent ? `- Consentement voix: ${options.catalogVoiceConsent}` : "",
      `- Instruction: ${options.voiceInstruction || "définir le timbre, les limites et le style de modulation"}`,
      `- Sortie attendue: phrase de test avec ${voiceProfile.briefVoicePersona}, puis notes de calibration si besoin.`,
      "- Route recommandée: /api/tts/speak en XTTS/RVC quand une référence Vivy/Djeff/A11/K44 existe; texte libre, argot et diction naturelle autorisés; garder les références privées hors publication brute.",
      "- Sécurité: ne pas publier la référence brute sans accord; les gros fichiers restent hors upload public."
    );
  }

  if (options.mode === "test") {
    lines.push(
      "Flux test voix:",
      `- Voix sélectionnée: ${voiceProfile.label}`,
      `- Référence active: ${voiceProfile.referenceLabel}`,
      `- Phrase test: ${voiceProfile.testLine}`,
      "- Objectif: écouter une voix à la fois, vérifier timbre, diction, souffle, proximité micro et identité.",
      "- Sortie attendue: aperçu audio court dans le lecteur du Studio; aucun historique de production ni lien signé dans ce brief.",
      "- Sécurité: références privées et liens médias restent dans l’UI, pas dans le brief agents."
    );
  }

  if (options.mode === "song") {
    lines.push(
      "Flux chanson:",
      `- Source: ${options.songSource}`,
      `- Direction sonore: ${options.songMood}`,
      `- Matière: ${options.songText || "thème libre à développer"}`,
      `- Casting vocal: ${artistCast.label}`,
      `- Nombre de chanteurs: ${artistCast.countLabel}`,
      `- Distribution vocale: ${artistCast.songCast}`,
      `- Outil voix actif: ${voiceProfile.label}`,
      options.catalogVoiceName ? `- Voix catalogue autorisée: ${options.catalogVoiceName}` : "",
      options.catalogVoiceConsent ? `- Consentement voix: ${options.catalogVoiceConsent}` : "",
      `- Clé Suno personnelle: ${options.sessionSunoKeyPresent ? "oui, session navigateur seulement" : "non"}`,
      "- Sortie simple possible: vraie génération Suno ou brief chantable selon les droits disponibles.",
      "- Sortie attendue: titre, intention, structure couplet/refrain, paroles, arrangement, voix guide et assets à produire.",
      "- Rôle: Vivy crée la chanson, A11 aide pour image/vidéo si nécessaire."
    );
  }

  if (options.mode === "share") {
    lines.push(
      "Flux scène / partage:",
      `- Canal: ${options.shareTarget}`,
      `- Lien: ${options.shareUrl ? redactVivyStudioSensitiveOutput(options.shareUrl) : "à fournir"}`,
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
    "- K44: interface client, fichiers, suivi et partage avec les personnes qui bossent dessus."
  );

  return lines.join("\n");
}

type VivySessionProps = {
  hasSession: boolean;
  diagnosticsAllowed?: boolean;
};

function VivyD9DiagnosticsPanel({ prosody }: { prosody: VivyStudioProductionResult["prosody"] | null }) {
  const sync = prosody?.doubleHarmonic;
  const segments = Array.isArray(sync?.segments) ? sync.segments : [];
  if (!sync) return null;
  return (
    <section className="vivy-studio-diagnostics vivy-studio-diagnostics--supreme" aria-label="Version audio Vivy">
      <header>
        <span>Version : V9 Dynamique</span>
        <small>Même format par défaut · k 3x · dynamique 99 ms · pivot 0.292 · 1024</small>
      </header>
      <p>
        Préparation Vivy prête: {segments.length || 1} segment{(segments.length || 1) > 1 ? "s" : ""} calé{(segments.length || 1) > 1 ? "s" : ""}.
        Le traitement audio final se fait avec Mix D40 V9 Dynamique.
      </p>
    </section>
  );
}

function VivyStudioLab({ hasSession, diagnosticsAllowed = false }: VivySessionProps) {
  const initialDraft = readVivyStudioDraft() || {};
  const hasLegacyVivySunoSource = [
    "Prompt + Suno Vivy",
    "Prompt + Suno (voix Suno)",
  ].includes(String(initialDraft.songSource || ""));
  const initialSongSource = hasLegacyVivySunoSource
    ? "Prompt + Suno + voix sélectionnée"
    : String(initialDraft.songSource || "Prompt +");
  const [activeMode, setActiveMode] = useState<VivyStudioMode>(normalizeVivyStudioMode(initialDraft.mode) || "voice");
  const savedVoiceTool = hasLegacyVivySunoSource ? "Voix Vivy chant" : String(initialDraft.voiceTool || "");
  const [voiceTool, setVoiceTool] = useState(
    (VIVY_STUDIO_VALID_VOICE_TOOLS as readonly string[]).includes(savedVoiceTool)
      ? savedVoiceTool
      : "Voix Vivy officielle"
  );
  const [voiceInstruction, setVoiceInstruction] = useState(String(initialDraft.voiceInstruction || ""));
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceFileName, setVoiceFileName] = useState(String(initialDraft.voiceFileName || ""));
  const [voiceReferenceId, setVoiceReferenceId] = useState(String(initialDraft.voiceReferenceId || ""));
  const [catalogVoices, setCatalogVoices] = useState<TtsVoiceReference[]>([]);
  const [selectedCatalogVoiceId, setSelectedCatalogVoiceId] = useState(String(initialDraft.selectedCatalogVoiceId || ""));
  const [catalogVoiceName, setCatalogVoiceName] = useState(String(initialDraft.catalogVoiceName || ""));
  const [publishVoiceToCatalog, setPublishVoiceToCatalog] = useState(Boolean(initialDraft.publishVoiceToCatalog));
  const [catalogConsentAccepted, setCatalogConsentAccepted] = useState(Boolean(initialDraft.catalogConsentAccepted));
  const [catalogStatus, setCatalogStatus] = useState("");
  const [voiceLearningPersona, setVoiceLearningPersona] = useState<VivyStudioVoiceLearningPersona>(() =>
    normalizeVivyStudioVoicePersona(initialDraft.voiceLearningPersona, "djeff")
  );
  const [voiceLearningFile, setVoiceLearningFile] = useState<File | null>(null);
  const [voiceLearningFileName, setVoiceLearningFileName] = useState(String(initialDraft.voiceLearningFileName || ""));
  const [voiceLearningTranscript, setVoiceLearningTranscript] = useState(String(initialDraft.voiceLearningTranscript || ""));
  const [voiceLearningStatus, setVoiceLearningStatus] = useState<VoiceLearningStatus | null>(null);
  const [voiceLearningMessage, setVoiceLearningMessage] = useState("");
  const [doubleHarmonicFile, setDoubleHarmonicFile] = useState<File | null>(null);
  const [doubleHarmonicFileName, setDoubleHarmonicFileName] = useState("");
  const [doubleHarmonicMode, setDoubleHarmonicMode] = useState<DoubleHarmonicProcessMode>("v9turbo");
  const [doubleHarmonicOutputFormat, setDoubleHarmonicOutputFormat] = useState<DoubleHarmonicOutputFormat>("source");
  const [doubleHarmonicIntensity, setDoubleHarmonicIntensity] = useState(D40_V8_DEFAULT_INTENSITY);
  const [doubleHarmonicResult, setDoubleHarmonicResult] = useState<DoubleHarmonicProcessResult | null>(null);
  const [songSource, setSongSource] = useState(initialSongSource);
  const [songArtists, setSongArtists] = useState<VivyStudioArtistId[]>(() => (
    hasLegacyVivySunoSource ? ["vivy"] : normalizeVivyStudioArtists(initialDraft.songArtists)
  ));
  const [songCastingAuto, setSongCastingAuto] = useState(initialDraft.songCastingAuto !== false);
  const [songMood, setSongMood] = useState(String(initialDraft.songMood || ""));
  const [songText, setSongText] = useState(String(initialDraft.songText || ""));
  const [sunoSessionKey, setSunoSessionKey] = useState(() => readVivySessionSunoKey());
  const [shareTarget, setShareTarget] = useState(String(initialDraft.shareTarget || "YouTube"));
  const [shareUrl, setShareUrl] = useState(String(initialDraft.shareUrl || ""));
  const [shareToken, setShareToken] = useState("");
  const [shareInstruction, setShareInstruction] = useState(String(initialDraft.shareInstruction || ""));
  const [vivyOutput, setVivyOutput] = useState(normalizeVivyStudioOutputForState(String(initialDraft.vivyOutput || "")));
  const [vivyLyrics, setVivyLyrics] = useState<string>("");
  const [vivyArrangementCues, setVivyArrangementCues] = useState<string[]>([]);
  const [includeInstrumentalPreview, setIncludeInstrumentalPreview] = useState(true);
  const [vivyMedia, setVivyMedia] = useState<VivyStudioMediaPreview | null>(null);
  const [vivyDiagnostics, setVivyDiagnostics] = useState<VivyStudioProductionResult["prosody"] | null>(null);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [testingVoiceId, setTestingVoiceId] = useState<string>("");
  const doubleHarmonicIntensityLabel = `${doubleHarmonicIntensity.toFixed(2).replace(/\.?0+$/, "")}x`;
  const doubleHarmonicModeLabel = D40_PROCESS_MODE_LABELS[doubleHarmonicMode];
  const doubleHarmonicOutputFormatLabel = D40_OUTPUT_FORMAT_LABELS[doubleHarmonicOutputFormat];
  const doubleHarmonicIntensityMin = doubleHarmonicMode === "v8" || doubleHarmonicMode === "v8plus" || doubleHarmonicMode === "v8pivot" || doubleHarmonicMode === "v9turbo"
    ? D40_V8_INTENSITY_MIN
    : doubleHarmonicMode === "v7" || doubleHarmonicMode === "v71"
    ? D40_V7_INTENSITY_MIN
    : doubleHarmonicMode === "v6"
    ? D40_V6_INTENSITY_MIN
    : doubleHarmonicMode === "v5"
    ? D40_V5_INTENSITY_MIN
    : doubleHarmonicMode === "v4"
      ? D40_V4_INTENSITY_MIN
      : D40_HARMONIC_INTENSITY_MIN;
  const doubleHarmonicIntensityMax = doubleHarmonicMode === "v8" || doubleHarmonicMode === "v8plus" || doubleHarmonicMode === "v8pivot" || doubleHarmonicMode === "v9turbo"
    ? D40_V8_INTENSITY_MAX
    : doubleHarmonicMode === "v7" || doubleHarmonicMode === "v71"
    ? D40_V7_INTENSITY_MAX
    : doubleHarmonicMode === "v6"
    ? D40_V6_INTENSITY_MAX
    : doubleHarmonicMode === "v5"
    ? D40_V5_INTENSITY_MAX
    : doubleHarmonicMode === "v4"
      ? D40_V4_INTENSITY_MAX
      : D40_HARMONIC_INTENSITY_MAX;
  const doubleHarmonicIntensityStep = doubleHarmonicMode === "v6" || doubleHarmonicMode === "v7" || doubleHarmonicMode === "v71" || doubleHarmonicMode === "v8" || doubleHarmonicMode === "v8plus" || doubleHarmonicMode === "v8pivot" || doubleHarmonicMode === "v9turbo" ? "0.1" : doubleHarmonicMode === "v4" || doubleHarmonicMode === "v5" ? "0.05" : "0.005";
  const doubleHarmonicUsesFixedWeight = doubleHarmonicMode === "v3";
  const doubleHarmonicWeightLabel = doubleHarmonicMode === "v3"
    ? "Auto"
    : doubleHarmonicMode === "v9turbo"
      ? `k ${doubleHarmonicIntensityLabel} · dynamique 99 ms · pivot 0.292 · 1024`
    : doubleHarmonicMode === "v8pivot"
      ? `k ${doubleHarmonicIntensityLabel} · pivot 0.292 · 1024`
    : doubleHarmonicMode === "v8plus"
      ? `k ${doubleHarmonicIntensityLabel} · e2 · 1024 · mg_phase`
    : doubleHarmonicMode === "v8"
      ? `k ${doubleHarmonicIntensityLabel} · fermeture 1024 · mg_phase`
    : doubleHarmonicMode === "v71"
      ? `k ${doubleHarmonicIntensityLabel} · 1024 · mg_phase`
    : doubleHarmonicMode === "v7"
      ? `k ${doubleHarmonicIntensityLabel} · 10 briques · mg_phase`
    : doubleHarmonicMode === "v6"
      ? `k ${doubleHarmonicIntensityLabel} · M/K · D40`
      : doubleHarmonicMode === "v5"
        ? `${doubleHarmonicIntensityLabel} · bas 1/2D · haut ln(3D)`
        : doubleHarmonicMode === "v4"
          ? `${doubleHarmonicIntensityLabel} · grain bas x${D40_V4_LOW_GRAIN_MULTIPLIER} · haut ^${D40_V4_HIGH_GRAIN_POWER}`
          : doubleHarmonicIntensityLabel;
  const doubleHarmonicIntensityTitle = doubleHarmonicMode === "v9turbo"
    ? "V9 Dynamique"
    : doubleHarmonicMode === "v8pivot"
    ? "V8 Pivot"
    : doubleHarmonicMode === "v8plus"
    ? "V8 Plus e2"
    : doubleHarmonicMode === "v8"
    ? "Fermeture V8"
    : doubleHarmonicMode === "v71"
    ? "Grille V7.1"
    : doubleHarmonicMode === "v7"
    ? "Briques V7"
    : doubleHarmonicMode === "v6"
    ? "Résonance V6"
    : doubleHarmonicMode === "v5"
      ? "Recette V5 Release"
      : doubleHarmonicMode === "v4"
        ? "Recette V4 Stable"
        : "Poids harmonique";

  useEffect(() => {
    setDoubleHarmonicIntensity((current) => Math.max(
      doubleHarmonicIntensityMin,
      Math.min(doubleHarmonicIntensityMax, current)
    ));
  }, [doubleHarmonicIntensityMax, doubleHarmonicIntensityMin]);

  useEffect(() => {
    const onSelectMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: unknown }>;
      const nextMode = normalizeVivyStudioMode(customEvent.detail?.mode);
      if (nextMode) setActiveMode(nextMode);
    };

    window.addEventListener("vivy:select-mode", onSelectMode);
    return () => window.removeEventListener("vivy:select-mode", onSelectMode);
  }, []);

  const activeCatalogVoice = useMemo(
    () => catalogVoices.find((voice) => voice.id === selectedCatalogVoiceId) || null,
    [catalogVoices, selectedCatalogVoiceId]
  );
  const activeCatalogVoiceName = String(activeCatalogVoice?.catalog?.name || activeCatalogVoice?.label || "").trim();

  const baseBrief = useMemo(() => buildVivyStudioBrief({
    mode: activeMode,
    voiceTool,
    voiceInstruction,
    voiceFileName,
    voiceReferenceId,
    catalogVoiceName: activeCatalogVoiceName,
    catalogVoiceConsent: activeCatalogVoice ? VIVY_VOICE_CATALOG_CONSENT : "",
    songSource,
    songArtists,
    songMood,
    songText,
    sessionSunoKeyPresent: Boolean(sunoSessionKey.trim()),
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
    activeCatalogVoice,
    activeCatalogVoiceName,
    songSource,
    songArtists,
    songMood,
    songText,
    sunoSessionKey,
    shareTarget,
    shareUrl,
    shareToken,
    shareInstruction,
  ]);
  const productionStatusBrief = useMemo(
    () => buildVivyStudioProductionStatus(vivyOutput),
    [vivyOutput]
  );
  const brief = useMemo(
    () => productionStatusBrief ? `${baseBrief}\n\n${productionStatusBrief}` : baseBrief,
    [baseBrief, productionStatusBrief]
  );
  const activeMeta = VIVY_STUDIO_MODES.find((item) => item.id === activeMode) || VIVY_STUDIO_MODES[0];
  const publicStudioOutput = useMemo(() => {
    const lyrics = activeMode === "song" ? cleanVivyStudioPublicBlock(vivyLyrics, 120) : "";
    const statusBlock = cleanVivyStudioPublicBlock(vivyOutput, 12);
    const mediaLine = vivyMedia
      ? `Média ${vivyMedia.kind === "audio" ? "audio" : "vidéo"} prêt dans le Studio Vivy.`
      : "";
    const body = lyrics || statusBlock || cleanVivyStudioPublicBlock(status, 4) || activeMeta.label;
    return [
      `Vivy - ${activeMeta.title}`,
      body,
      mediaLine,
    ].filter(Boolean).join("\n\n").trim();
  }, [activeMode, activeMeta.title, activeMeta.label, vivyLyrics, vivyOutput, vivyMedia, status]);
  const showAgentDebug = diagnosticsAllowed && (() => {
    try {
      return globalThis.localStorage?.getItem("vivy:agent-debug") === "true";
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    writeVivyStudioDraft({
      mode: activeMode,
      voiceTool,
      voiceInstruction,
      voiceFileName,
      voiceReferenceId,
      selectedCatalogVoiceId,
      catalogVoiceName,
      publishVoiceToCatalog,
      catalogConsentAccepted,
      voiceLearningPersona,
      voiceLearningFileName,
      voiceLearningTranscript,
      songSource,
      songArtists,
      songCastingAuto,
      songMood,
      songText,
      shareTarget,
      shareUrl,
      shareInstruction,
      tokenPresent: Boolean(shareToken.trim()),
      vivyOutput: normalizeVivyStudioOutputForState(vivyOutput),
    });
  }, [activeMode, voiceTool, voiceInstruction, voiceFileName, voiceReferenceId, selectedCatalogVoiceId, catalogVoiceName, publishVoiceToCatalog, catalogConsentAccepted, voiceLearningPersona, voiceLearningFileName, voiceLearningTranscript, songSource, songArtists, songCastingAuto, songMood, songText, shareTarget, shareUrl, shareInstruction, shareToken, vivyOutput]);

  useEffect(() => {
    writeVivySessionSunoKey(sunoSessionKey);
  }, [sunoSessionKey]);

  async function refreshVoiceCatalog() {
    if (!hasSession) {
      setCatalogVoices([]);
      setCatalogStatus("");
      return;
    }
    try {
      const result = await fetchTtsVoiceCatalog();
      setCatalogVoices(result.voices || []);
      setCatalogStatus(result.message || "");
    } catch (error: any) {
      setCatalogVoices([]);
      setCatalogStatus(`Catalogue voix indisponible: ${error?.message || error}`);
    }
  }

  useEffect(() => {
    void refreshVoiceCatalog();
  }, [hasSession]);

  const activeVoiceLearningEntry = getVivyStudioVoiceDirectoryEntry(voiceLearningPersona);
  const hasPrivateVoiceReference = Boolean(voiceReferenceId.trim());
  const activeVoiceProfile = useMemo(
    () => getVivyStudioVoiceProfileForTool(voiceTool, hasPrivateVoiceReference, voiceFileName),
    [voiceTool, hasPrivateVoiceReference, voiceFileName]
  );
  const activeSongArtistCast = useMemo(() => buildVivyStudioArtistCast(songArtists), [songArtists]);
  const activeVoiceReferenceLabel = activeCatalogVoiceName
    ? `Catalogue: ${activeCatalogVoiceName}`
    : activeVoiceProfile.referenceLabel;
  const voiceLearningProgressLabel = voiceLearningStatus
    ? `${Math.round(Number(voiceLearningStatus.secondsCollected || 0))}s/${Math.round(Number(voiceLearningStatus.requiredSeconds || 0))}s, ${Number(voiceLearningStatus.clipCount || 0)} extrait${Number(voiceLearningStatus.clipCount || 0) > 1 ? "s" : ""}`
    : "statut non chargé";

  useEffect(() => {
    if (!hasSession) {
      setVoiceLearningStatus(null);
      setVoiceLearningMessage("");
      return;
    }
    let cancelled = false;
    fetchVoiceLearningStatus(voiceLearningPersona)
      .then((result) => {
        if (cancelled) return;
        setVoiceLearningStatus(result);
        setVoiceLearningMessage(result?.message || "");
      })
      .catch((error: any) => {
        if (cancelled) return;
        setVoiceLearningStatus(null);
        setVoiceLearningMessage(`Statut corpus indisponible: ${error?.message || error}`);
      });
    return () => {
      cancelled = true;
    };
  }, [hasSession, voiceLearningPersona]);

  useEffect(() => {
    if (hasPrivateVoiceReference) return;
    if (/diagnostic|reference privee|référence privée/.test(foldForLookup(voiceTool))) {
      setVoiceTool("Voix Vivy officielle");
    }
  }, [hasPrivateVoiceReference, voiceTool]);

  function applyVoiceToolSelection(nextTool: string) {
    setVoiceTool(nextTool);
    const folded = foldForLookup(nextTool);
    if (/\bduo\b|djeff.*vivy|vivy.*djeff/.test(folded)) {
      setSongArtists(["djeff", "vivy"]);
      return;
    }
    if (/\bdjeff\b|\brap\b|\bfraiyeur\b/.test(folded)) {
      setSongArtists(["djeff"]);
      return;
    }
    if (/\bk44\b|\bkaen44\b|\bkaen\b/.test(folded)) {
      setSongArtists(["k44"]);
      return;
    }
    if (/\ba11\b|\balpha\s*onze\b|\balphaonze\b/.test(folded)) {
      setSongArtists(["a11"]);
      return;
    }
    if (/catalogue|catalog|premium|voix autorisee|voix autorisée/.test(folded)) {
      return;
    }
    if (/\bvivy\b|\bchant\b|\bsing\b/.test(folded)) {
      setSongArtists(["vivy"]);
    }
  }

  function toggleSongArtist(id: VivyStudioArtistId) {
    const normalized = normalizeVivyStudioArtists(songArtists);
    let nextArtists: VivyStudioArtistId[];
    if (normalized.includes(id)) {
      if (normalized.length <= 1) {
        setStatus("Garde au moins un artiste pour la chanson.");
        return;
      }
      nextArtists = normalized.filter((item) => item !== id);
    } else {
      nextArtists = normalizeVivyStudioArtists([...normalized, id]);
    }
    setSongArtists(nextArtists);
    if (nextArtists.length === 1) {
      const voiceEntry = VIVY_STUDIO_VOICE_DIRECTORY.find((entry) => entry.artistId === nextArtists[0]);
      if (voiceEntry) setVoiceTool(voiceEntry.voiceTool);
    } else if (nextArtists.length === 2 && nextArtists.includes("djeff") && nextArtists.includes("vivy")) {
      setVoiceTool("Duo Djeff + Vivy");
    }
  }

  function buildVivyPlayableText(value: string, fallback: string, maxLength = 260) {
    const raw = toUnicodeText(value || fallback, maxLength * 3)
      .replace(/\([A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?(?:\s*-\s*[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?)*\)/gi, " ")
      .replace(/\b[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?\b(?:\s*-\s*\b[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?\b)+/gi, " ")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return toUnicodeText(raw || fallback, maxLength).trim();
  }

  function buildVivyAutoVoiceTestLine(entry: { label: string; shortLabel?: string; voiceStyle: string; testLine?: string }) {
    const safeLine = buildVivyPlayableText(
      "",
      entry.testLine || `${entry.shortLabel || entry.label} teste une phrase courte, claire et naturelle.`,
      150
    );
    return safeLine || `${entry.shortLabel || entry.label} teste une phrase courte, claire et naturelle.`;
  }

  function buildVivyAutoTtsOptions(entry: {
    id?: string;
    label: string;
    ttsPersona: "vivy" | "a11" | "kaen44";
    voiceStyle: string;
    referenceLabel?: string;
    referenceFileName?: string;
    voiceTool: string;
    surface: "vivy" | "a11" | "kaen44";
  }, mode: VivyStudioVoiceTestMode = VIVY_STUDIO_VOICE_TEST_MODES[0]) {
    const officialVoiceIds = new Set(["djeff", "kaen44", "a11", "vivy"]);
    const entryId = String(entry.id || "").trim().toLowerCase();
    const usesOfficialReference = officialVoiceIds.has(entryId)
      || /\b(?:djeff|kaen44|a11|vivy|official|officiel|rap)\b/i.test(`${entry.voiceStyle} ${entry.voiceTool}`);
    const usesCleanCloudVoice = usesOfficialReference && (entryId === "djeff" || entryId === "vivy");
    const provider = usesCleanCloudVoice ? "elevenlabs" : (usesOfficialReference ? "xtts-rvc" : "auto");
    const voiceConversion = usesOfficialReference && !usesCleanCloudVoice;
    const referenceLabel = String(entry.referenceLabel || entry.voiceStyle || entry.label).trim();
    const referenceFileName = String(entry.referenceFileName || referenceLabel).trim();
    return {
      persona: entry.ttsPersona,
      voicePersona: entry.ttsPersona,
      ttsPersona: entry.ttsPersona,
      surface: entry.surface,
      voiceStyle: entry.voiceStyle,
      voiceReferenceName: referenceFileName,
      voiceReferenceLabel: referenceLabel,
      referenceVoiceStyle: entry.voiceStyle || referenceLabel,
      voiceTool: entry.voiceTool,
      vocalCast: entry.label,
      provider,
      ttsProvider: provider,
      voiceProviderRequested: usesCleanCloudVoice ? "elevenlabs" : provider,
      engine: provider,
      voiceEngine: provider,
      vocalMode: usesOfficialReference ? mode.vocalMode : "speech",
      ttsAsync: true,
      asyncTts: true,
      ttsJobTimeoutMs: usesOfficialReference ? mode.timeoutMs : 60000,
      audioFormat: "mp3",
      responseFormat: "mp3",
      voiceTestMode: mode.id,
      useRvc: voiceConversion ? mode.useRvc : false,
      use_rvc: voiceConversion ? mode.useRvc : false,
      identityVoice: usesOfficialReference,
      useIdentityVoice: usesOfficialReference,
      useDefaultVoiceReference: voiceConversion,
      defaultVoiceReference: voiceConversion,
      usePersonaVoiceReference: voiceConversion,
      neutralVoice: usesOfficialReference ? false : undefined,
      voiceReferenceRequired: voiceConversion,
      referenceVoiceRequired: voiceConversion,
      requireVoiceReference: voiceConversion,
      voiceConversion,
      convertVoice: voiceConversion,
      morphVoice: voiceConversion,
      rvc: voiceConversion ? mode.useRvc : false,
      allowRvc: voiceConversion,
      allowXttsRvc: voiceConversion,
      allowLegacyVoiceBridge: voiceConversion,
      xttsRvcOptIn: voiceConversion,
      allowPaidTtsVoice: usesCleanCloudVoice ? true : undefined,
      allowCloudTts: usesCleanCloudVoice ? true : undefined,
      allowReadyMadeCloudVoice: usesCleanCloudVoice ? true : undefined,
      allowOfficialCloudVoice: usesCleanCloudVoice ? true : undefined,
      forceCloudTts: usesCleanCloudVoice ? true : undefined,
      useReadyMadeCloudVoice: usesCleanCloudVoice ? true : undefined,
      allowBrowserSpeechFallback: !usesOfficialReference,
      ttsCostPolicy: undefined,
    };
  }

  function buildVivyVoiceReferenceOptions(): Record<string, unknown> {
    if (hasPrivateVoiceReference) {
      return {
        voiceReferenceId: voiceReferenceId.trim(),
        useDefaultVoiceReference: false,
      };
    }
    return {
      useDefaultVoiceReference: true,
      defaultVoiceReference: true,
    };
  }

  function buildVivyTtsOptions(vocalMode: "adaptive" | "sing", useRvc = true) {
    const usesCleanCloudVoice = !hasPrivateVoiceReference
      && !activeCatalogVoice
      && (
        activeVoiceProfile.id === "djeff-rap"
        || activeVoiceProfile.id === "vivy-official"
        || activeVoiceProfile.id === "vivy-sing"
      );
    const provider = usesCleanCloudVoice ? "auto" : "xtts-rvc";
    const voiceConversion = !usesCleanCloudVoice;
    const resolvedUseRvc = voiceConversion ? useRvc : false;
    return {
      persona: activeVoiceProfile.ttsPersona,
      voicePersona: activeVoiceProfile.ttsPersona,
      surface: activeVoiceProfile.surface,
      voiceStyle: activeVoiceProfile.voiceStyle,
      voiceReferenceName: activeCatalogVoiceName || voiceFileName || activeVoiceProfile.referenceFileName || activeVoiceProfile.referenceLabel,
      voiceReferenceLabel: activeCatalogVoiceName || activeVoiceProfile.referenceLabel,
      referenceVoiceStyle: activeCatalogVoiceName || activeVoiceProfile.voiceStyle,
      voiceCatalogName: activeCatalogVoiceName || undefined,
      voiceCatalogConsent: activeCatalogVoice ? VIVY_VOICE_CATALOG_CONSENT : undefined,
      licensedVoiceCatalog: Boolean(activeCatalogVoice),
      voiceTool,
      vocalCast: activeVoiceProfile.label,
      provider,
      ttsProvider: provider,
      voiceProviderRequested: usesCleanCloudVoice ? "elevenlabs" : provider,
      engine: provider,
      voiceEngine: provider,
      voiceConversionEngine: provider === "xtts-rvc" ? "xtts-rvc" : undefined,
      conversionEngine: provider === "xtts-rvc" ? "xtts-rvc" : undefined,
      vocalMode,
      useRvc: resolvedUseRvc,
      use_rvc: resolvedUseRvc,
      ...getVivyVoiceTuning(vocalMode),
      ttsAsync: true,
      asyncTts: true,
      ttsJobTimeoutMs: vocalMode === "sing" ? 240000 : 180000,
      audioFormat: "mp3",
      responseFormat: "mp3",
      ...buildVivyVoiceReferenceOptions(),
      usePersonaVoiceReference: voiceConversion && !hasPrivateVoiceReference,
      voiceReferenceRequired: voiceConversion,
      referenceVoiceRequired: voiceConversion,
      requireVoiceReference: voiceConversion,
      voiceConversion,
      convertVoice: voiceConversion,
      morphVoice: voiceConversion,
      rvc: voiceConversion ? resolvedUseRvc : false,
      identityVoice: true,
      useIdentityVoice: true,
      neutralVoice: false,
      allowRvc: voiceConversion,
      allowXttsRvc: voiceConversion,
      allowLegacyVoiceBridge: voiceConversion,
      xttsRvcOptIn: voiceConversion,
      allowPaidTtsVoice: usesCleanCloudVoice ? true : undefined,
      allowCloudTts: usesCleanCloudVoice ? true : undefined,
      allowReadyMadeCloudVoice: usesCleanCloudVoice ? true : undefined,
      allowOfficialCloudVoice: usesCleanCloudVoice ? true : undefined,
      forceCloudTts: usesCleanCloudVoice ? true : undefined,
      useReadyMadeCloudVoice: usesCleanCloudVoice ? true : undefined,
      allowBrowserSpeechFallback: false,
      ttsCostPolicy: undefined,
    };
  }

  async function copyStudioPublicOutput(nextStatus = "Sortie Vivy copiée.") {
    try {
      await navigator.clipboard?.writeText(publicStudioOutput);
      setStatus(nextStatus);
    } catch {
      setStatus("Copie auto indisponible: sélectionne la sortie Vivy et copie-la.");
    }
  }

  async function shareStudioPublicOutput() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Vivy - ${activeMeta.title}`,
          text: publicStudioOutput,
        });
        setStatus("Partage système ouvert.");
        return;
      } catch {
        // Fall back to clipboard below.
      }
    }
    await copyStudioPublicOutput("Sortie Vivy prête à partager.");
  }

  async function copyInternalBrief(nextStatus = "Brief interne copié pour debug agent.") {
    try {
      await navigator.clipboard?.writeText(brief);
      setStatus(nextStatus);
    } catch {
      setStatus("Copie debug indisponible: sélectionne le brief interne et copie-le.");
    }
  }

  async function saveBriefArtifact() {
    if (!hasSession) {
      setStatus("Connexion requise pour sauvegarder la sortie Vivy.");
      return;
    }
    setIsBusy(true);
    setStatus("Sauvegarde de la sortie Vivy...");
    try {
      const slug = activeMode === "voice" ? "creation-voix" : activeMode === "song" ? "composition" : "scene-partage";
      const result = await createTextArtifact({
        filename: `vivy-${slug}-${Date.now()}.md`,
        text: `# Vivy - ${activeMeta.title}\n\n${publicStudioOutput}\n`,
        contentType: "text/markdown;charset=utf-8",
        kind: "vivy_studio_public_output",
        description: `Sortie Vivy ${activeMeta.title}`,
      });
      setStatus(result?.artifact?.url ? `Sortie sauvegardée: ${result.artifact.url}` : "Sortie sauvegardée dans A11.");
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
    const publishToCatalog = publishVoiceToCatalog === true;
    const publicVoiceName = catalogVoiceName.trim();
    if (publishToCatalog && !publicVoiceName) {
      setStatus("Donne un nom public unique à cette voix avant de la proposer au catalogue.");
      return;
    }
    if (publishToCatalog && !catalogConsentAccepted) {
      setStatus("Accord voix requis pour autoriser les chansons avec cette voix.");
      return;
    }
    setIsBusy(true);
    setStatus(publishToCatalog ? "Publication voix catalogue..." : "Upload référence voix...");
    try {
      const result = await uploadTtsVoiceReference(
        voiceFile,
        publishToCatalog ? publicVoiceName : activeVoiceProfile.uploadLabel,
        publishToCatalog ? "catalog" : "private",
        publishToCatalog
          ? { catalogName: publicVoiceName, consent: VIVY_VOICE_CATALOG_CONSENT }
          : undefined
      );
      setVoiceFileName(result.reference?.originalName || result.reference?.label || voiceFile.name);
      setVoiceReferenceId(String(result.reference?.id || ""));
      if (publishToCatalog) {
        setSelectedCatalogVoiceId(String(result.reference?.id || ""));
        setVoiceTool("Voix catalogue premium");
        void refreshVoiceCatalog();
      } else if (!["djeff-rap", "duo-djeff-vivy", "a11-official", "k44-official"].includes(activeVoiceProfile.id)) {
        setVoiceTool("Voix Vivy + référence privée");
      }
      setStatus(publishToCatalog
        ? `Voix catalogue "${publicVoiceName}" active.`
        : `Référence voix privée active pour ${activeVoiceProfile.label}.`);
    } catch (error: any) {
      setStatus(`Upload voix indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  function readMediaDurationMs(file: File): Promise<number> {
    return new Promise((resolve) => {
      try {
        const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio") as HTMLMediaElement;
        const url = URL.createObjectURL(file);
        const cleanup = () => {
          URL.revokeObjectURL(url);
          media.removeAttribute("src");
        };
        media.preload = "metadata";
        media.onloadedmetadata = () => {
          const durationMs = Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : 0;
          cleanup();
          resolve(durationMs);
        };
        media.onerror = () => {
          cleanup();
          resolve(0);
        };
        media.src = url;
      } catch {
        resolve(0);
      }
    });
  }

  function applyVoiceDirectoryEntry(entry = activeVoiceLearningEntry) {
    setVoiceLearningPersona(entry.persona);
    setVoiceTool(entry.voiceTool);
    setSelectedCatalogVoiceId("");
    if (entry.artistId) setSongArtists([entry.artistId]);
    if (!voiceInstruction.trim()) {
      setVoiceInstruction(entry.testLine);
    }
    setStatus(`${entry.label} sélectionnée dans le répertoire voix.`);
  }

  async function uploadVoiceLearningCorpus() {
    if (!hasSession) {
      setStatus("Connexion requise pour ajouter un extrait au corpus voix.");
      return;
    }
    if (!voiceLearningFile) {
      setStatus("Ajoute d'abord un extrait audio ou vidéo pour nourrir le corpus.");
      return;
    }
    setIsBusy(true);
    setVoiceLearningMessage(`Ajout corpus ${activeVoiceLearningEntry.shortLabel}...`);
    try {
      const durationMs = await readMediaDurationMs(voiceLearningFile);
      const result = await uploadVoiceLearningSnippet(voiceLearningFile, {
        persona: voiceLearningPersona,
        durationMs,
        transcript: voiceLearningTranscript,
        source: "vivy-studio-upload",
        consent: "voice-learning-v1",
      });
      setVoiceLearningStatus(result);
      const progress = `${Math.round(Number(result.secondsCollected || 0))}s/${Math.round(Number(result.requiredSeconds || 0))}s`;
      const message = result.duplicate
        ? `Extrait déjà présent pour ${activeVoiceLearningEntry.shortLabel}: ${progress}.`
        : `Corpus ${activeVoiceLearningEntry.shortLabel}: ${progress}.`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } catch (error: any) {
      const message = `Ajout corpus impossible: ${error?.message || error}`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function trainVoiceLearningCorpus() {
    if (!hasSession) {
      setStatus("Connexion requise pour lancer un entraînement voix.");
      return;
    }
    setIsBusy(true);
    setVoiceLearningMessage(`Préparation entraînement ${activeVoiceLearningEntry.shortLabel}...`);
    try {
      const result = await queueVoiceLearningTraining(voiceLearningPersona);
      setVoiceLearningStatus(result);
      const message = result.message || `Entraînement ${activeVoiceLearningEntry.shortLabel} ajouté à la file.`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } catch (error: any) {
      const message = `Entraînement voix impossible: ${error?.message || error}`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function resetVoiceLearningCorpus() {
    if (!hasSession) {
      setStatus("Connexion requise pour retirer un corpus voix.");
      return;
    }
    const confirmed = window.confirm(`Retirer les extraits collectés pour ${activeVoiceLearningEntry.shortLabel} sur ce compte ?`);
    if (!confirmed) return;
    setIsBusy(true);
    setVoiceLearningMessage(`Retrait corpus ${activeVoiceLearningEntry.shortLabel}...`);
    try {
      const result = await deleteVoiceLearningCorpus(voiceLearningPersona);
      setVoiceLearningStatus(result);
      const message = `Corpus ${activeVoiceLearningEntry.shortLabel} retiré pour ce compte.`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } catch (error: any) {
      const message = `Retrait corpus impossible: ${error?.message || error}`;
      setVoiceLearningMessage(message);
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function processVivyDoubleHarmonicAudio() {
    if (!hasSession) {
      setStatus("Connexion requise pour créer un mix D40.");
      return;
    }
    if (!doubleHarmonicFile) {
      setStatus("Ajoute d'abord un fichier audio à traiter en D40.");
      return;
    }
    setIsBusy(true);
    setStatus(`Traitement D40 ${doubleHarmonicModeLabel} en cours...`);
    try {
      const result = await processDoubleHarmonicAudio(doubleHarmonicFile, {
        profile: "blend",
        intensity: doubleHarmonicIntensity,
        format: doubleHarmonicOutputFormat,
        name: doubleHarmonicFile.name,
        mode: doubleHarmonicMode,
        lowGrainMultiplier: doubleHarmonicMode === "v4" ? D40_V4_LOW_GRAIN_MULTIPLIER : undefined,
        highGrainPower: doubleHarmonicMode === "v4" ? D40_V4_HIGH_GRAIN_POWER : undefined,
        binaryGrid: doubleHarmonicMode === "v71" ? "exact1024" : undefined,
      });
      const mediaUrl = String(result.shareUrl || result.audioUrl || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      const downloadUrl = String(result.audioUrl || result.shareUrl || "").trim();
      setDoubleHarmonicResult(result);
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        downloadUrl: resolveApiAssetUrl(downloadUrl) || downloadUrl || mediaUrl,
        provider: "funesterie-d40",
        contentType: String(result.contentType || doubleHarmonicFile.type || "audio/mpeg"),
        filename: String(result.filename || doubleHarmonicFile.name || "funesterie-d40-audio"),
      });
      setVivyOutput((current) => appendVivyStudioOutputStatus(
        current,
        `Mix D40 ${doubleHarmonicModeLabel} ${doubleHarmonicWeightLabel} ${doubleHarmonicOutputFormatLabel} prêt`
      ));
      setStatus(`Mix D40 ${doubleHarmonicModeLabel} prêt avec lien exportable (${doubleHarmonicWeightLabel}, ${doubleHarmonicOutputFormatLabel}).`);
    } catch (error: any) {
      setStatus(`Traitement D40 impossible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function downloadVivyMediaFile(url: string | null | undefined, filename: string | null | undefined) {
    const resolvedUrl = resolveApiAssetUrl(url || "") || String(url || "").trim();
    if (!resolvedUrl) {
      setStatus("Aucun média à télécharger.");
      return;
    }
    setStatus("Téléchargement...");
    const safeName = String(filename || "funesterie-media").replace(/[\\/:*?"<>|]+/g, "-");
    try {
      let response: Response;
      try {
        response = await fetch(resolvedUrl, { credentials: "include" });
        if (!response.ok) throw new Error(`status_${response.status}`);
      } catch {
        response = await fetch(resolvedUrl, { credentials: "omit" });
        if (!response.ok) throw new Error(`download_failed_${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safeName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setStatus("Téléchargement lancé.");
    } catch (error: any) {
      setStatus(`Téléchargement impossible: ${error?.message || error}`);
    }
  }

  async function testVoiceLearningChatbot() {
    if (!hasSession) {
      setStatus("Connexion requise pour tester le chat vocal.");
      return;
    }
    const entry = activeVoiceLearningEntry;
    setIsBusy(true);
    setStatus(`Test chat vocal ${entry.shortLabel}...`);
    try {
      const line = buildVivyAutoVoiceTestLine(entry);
      const payload = await ttsSpeak(line, entry.ttsPersona, "auto", buildVivyAutoTtsOptions(entry));
      const mediaUrl = String(payload?.audioUrl || payload?.audio_url || payload?.url || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        downloadUrl: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(payload?.provider || payload?.via || "a11-voice-module"),
        contentType: String(payload?.contentType || payload?.content_type || "audio/wav"),
        filename: String(payload?.filename || `vivy-chat-vocal-${entry.shortLabel}.wav`),
      });
      setStatus(`Chat vocal ${entry.shortLabel} prêt.`);
    } catch (error: any) {
      setStatus(`Test chat vocal indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function testSpecificVoiceEntry(entry: VivyStudioVoiceTestEntry, mode: VivyStudioVoiceTestMode = VIVY_STUDIO_VOICE_TEST_MODES[0]) {
    if (!hasSession) { setStatus("Connexion requise pour tester."); return; }
    setIsBusy(true);
    setStatus(`Test ${entry.label} · ${mode.statusLabel}...`);
    try {
      const line = buildVivyAutoVoiceTestLine(entry);
      const payload = await ttsSpeak(line, entry.ttsPersona, "auto", buildVivyAutoTtsOptions(entry, mode));
      const mediaUrl = String(payload?.audioUrl || payload?.audio_url || payload?.url || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        downloadUrl: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(payload?.provider || payload?.via || "a11-voice-module"),
        contentType: String(payload?.contentType || payload?.content_type || "audio/wav"),
        filename: String(payload?.filename || `vivy-voice-${entry.shortLabel}-${mode.id}.wav`),
      });
      const engine = String(payload?.voiceConversion?.engine || payload?.engine || payload?.provider || "").trim();
      setStatus(`${entry.label} prête (${mode.statusLabel}${engine ? `, ${engine}` : ""}).`);
    } catch (error: any) {
      setStatus(`${entry.label} · ${mode.statusLabel}: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  function useDefaultVivyVoice() {
    setVoiceFile(null);
    setVoiceFileName("");
    setVoiceReferenceId("");
    setSelectedCatalogVoiceId("");
    setVoiceTool("Voix Vivy officielle");
    setSongArtists(["vivy"]);
    setStatus("Voix Vivy officielle sélectionnée. Aucun upload nécessaire.");
  }

  function forgetSunoSessionKey() {
    setSunoSessionKey("");
    writeVivySessionSunoKey("");
    setStatus("Clé Suno personnelle oubliée pour cette session.");
  }

  async function testDefaultVivyVoice() {
    if (!hasSession) {
      setStatus("Connexion requise pour tester la voix active.");
      return;
    }
    setIsBusy(true);
    setStatus(`Test ${activeVoiceProfile.label}: ${activeVoiceReferenceLabel}...`);
    try {
      const testLine = buildVivyPlayableText(
        voiceInstruction.trim(),
        activeVoiceProfile.testLine,
        180
      );
      const vocalMode = activeVoiceProfile.vocalMode;
      const ttsOptions = buildVivyTtsOptions(vocalMode);
      const provider = String(ttsOptions.provider || "auto");
      if (!hasPrivateVoiceReference && /diagnostic/.test(foldForLookup(voiceTool))) {
        setVoiceTool("Voix Vivy officielle");
      }
      const payload = await ttsSpeak(
        testLine,
        activeVoiceProfile.ttsPersona,
        provider,
        ttsOptions
      );
      const mediaUrl = String(payload?.audioUrl || payload?.audio_url || payload?.url || "").trim();
      if (!mediaUrl) throw new Error("audio_url_missing");
      setVivyMedia({
        kind: "audio",
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        downloadUrl: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(payload?.provider || payload?.via || "a11-voice-module"),
        contentType: String(payload?.contentType || payload?.content_type || "audio/wav"),
        filename: String(payload?.filename || `vivy-voice-${activeVoiceProfile.id}.wav`),
      });
      setStatus(payload?.promptRenderedAsSpeech === false
        ? `Maquette ${activeVoiceProfile.label} prête depuis ${activeVoiceReferenceLabel}.`
        : `${activeVoiceProfile.label} prête depuis ${activeVoiceReferenceLabel}.`);
    } catch (error: any) {
      setStatus(`Test voix indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  function getVivySongMediaUrl(payload: any) {
    return String(
      payload?.audioUrl
      || payload?.audio_url
      || payload?.downloadUrl
      || payload?.download_url
      || payload?.url
      || payload?.media?.audioUrl
      || payload?.media?.audio_url
      || payload?.media?.downloadUrl
      || payload?.media?.download_url
      || payload?.media?.url
      || payload?.musicJob?.media?.audioUrl
      || payload?.musicJob?.media?.audio_url
      || payload?.musicJob?.media?.downloadUrl
      || payload?.musicJob?.media?.download_url
      || payload?.musicJob?.media?.url
      || ""
    ).trim();
  }

  async function waitForVivySongJob(taskId: string) {
    const safeTaskId = String(taskId || "").trim();
    if (!safeTaskId) throw new Error("job_vivy_manquant");
    const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      await pause(attempt <= 3 ? 6000 : 10000);
      let job: any;
      try {
        job = await getVivyStudioMusicJob(safeTaskId, sunoSessionKey);
      } catch (error: any) {
        if (attempt < 60 && isRetryableVivyMusicJobError(error)) {
          setStatus(`Suno répond lentement... Vivy continue d'attendre le MP3 (${attempt}/60).`);
          continue;
        }
        throw error;
      }
      const statusText = String(job?.mediaStatus?.status || job?.musicJob?.status || (job as any)?.status || "").trim();
      const mediaUrl = getVivySongMediaUrl(job);
      if (mediaUrl) return job;
      if (String(job?.mediaStatus?.state || job?.musicJob?.state || (job as any)?.state || "").toLowerCase() === "error") {
        throw new Error(job?.mediaStatus?.message || job?.message || "generation_suno_echouee");
      }
      setStatus(`Chanson Vivy en génération Suno... ${statusText || `essai ${attempt}`}`);
    }
    throw new Error("generation_suno_trop_longue");
  }

  async function createVivySongVoicePreview(publicLyrics: string): Promise<VivyStudioMediaPreview> {
    const previewText = buildVivyPlayableText(
      publicLyrics,
      songText || songMood || "Vivy prépare un aperçu de la chanson.",
      4000
    );
    if (!previewText) throw new Error("voice_preview_text_missing");
    const ttsOptions = buildVivyTtsOptions("sing");
    const preview = await ttsSpeak(
      previewText,
      activeVoiceProfile.ttsPersona,
      String(ttsOptions.provider || "auto"),
      ttsOptions
    );
    const previewUrl = String(preview?.audioUrl || preview?.audio_url || preview?.url || "").trim();
    if (!previewUrl) throw new Error("voice_preview_audio_url_missing");
    return {
      kind: "audio" as const,
      url: resolveApiAssetUrl(previewUrl) || previewUrl,
      downloadUrl: resolveApiAssetUrl(previewUrl) || previewUrl,
      provider: String(preview?.provider || preview?.via || "elevenlabs-tts"),
      contentType: String(preview?.contentType || preview?.content_type || "audio/mpeg"),
      filename: String(preview?.filename || `vivy-apercu-${activeVoiceProfile.id}.mp3`),
      voiceManifest: preview?.voiceManifest,
    };
  }

  async function createVivyMultiVoicePreview(rawSegments: VivyStudioVocalSegment[]): Promise<VivyStudioMediaPreview> {
    const allowedArtistIds = new Set(activeSongArtistCast.ids);
    const segments = (Array.isArray(rawSegments) ? rawSegments : [])
      .map((segment) => ({
        artistIds: normalizeVivyStudioArtists(segment?.artistIds || [], [])
          .filter((artistId) => allowedArtistIds.has(artistId)),
        text: toUnicodeText(segment?.text || "", 1800).trim(),
      }))
      .filter((segment) => segment.artistIds.length && segment.text)
      .slice(0, 20);
    if (!segments.length) throw new Error("multi_voice_segments_missing");

    const singMode = VIVY_STUDIO_VOICE_TEST_MODES.find((mode) => mode.id === "sing")
      || VIVY_STUDIO_VOICE_TEST_MODES[0];
    const synthesisCache = new Map<string, Promise<string>>();
    const synthesizeArtistSegment = (artistId: VivyStudioArtistId, text: string) => {
      const cacheKey = `${artistId}\n${text}`;
      const cached = synthesisCache.get(cacheKey);
      if (cached) return cached;
      const task = (async () => {
        const entry = VIVY_STUDIO_VOICE_DIRECTORY.find((voice) => voice.artistId === artistId);
        if (!entry) throw new Error(`official_voice_missing_${artistId}`);
        const options = buildVivyAutoTtsOptions(entry, singMode);
        const preview = await ttsSpeak(
          text,
          entry.ttsPersona,
          String(options.provider || "auto"),
          options
        );
        const audioUrl = String(preview?.audioUrl || preview?.audio_url || preview?.url || "").trim();
        if (!audioUrl) throw new Error(`voice_preview_audio_url_missing_${artistId}`);
        return resolveApiAssetUrl(audioUrl) || audioUrl;
      })();
      synthesisCache.set(cacheKey, task);
      return task;
    };

    const assembledSegments: Array<{ audioUrls: string[] }> = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const labels = segment.artistIds
        .map((artistId) => VIVY_STUDIO_ARTISTS.find((artist) => artist.id === artistId)?.label || artistId)
        .join(" + ");
      setStatus(`Voix ${index + 1}/${segments.length}: ${labels}...`);
      assembledSegments.push({
        audioUrls: await Promise.all(segment.artistIds.map((artistId) => synthesizeArtistSegment(artistId, segment.text))),
      });
    }

    setStatus(`Assemblage du duo ${activeSongArtistCast.label}...`);
    const assembled = await assembleVivyStudioVoicePreview(assembledSegments);
    const assembledUrl = String(assembled?.audioUrl || assembled?.audio_url || assembled?.url || "").trim();
    if (!assembledUrl) throw new Error("multi_voice_preview_audio_url_missing");
    return {
      kind: "audio" as const,
      url: resolveApiAssetUrl(assembledUrl) || assembledUrl,
      downloadUrl: resolveApiAssetUrl(assembledUrl) || assembledUrl,
      provider: String(assembled?.provider || "vivy-multi-voice-preview"),
      contentType: String(assembled?.content_type || "audio/mpeg"),
      filename: String(assembled?.filename || "vivy-apercu-multi-voix.mp3"),
    };
  }

  async function createVivySongInstrumentalPreview(publicLyrics: string, arrangementCues: string[]) {
    const direction = [songMood, ...arrangementCues].filter(Boolean).join(", ");
    const payload = await runVivyStudioProduction({
      mode: "song",
      voiceTool,
      songSource,
      songArtists,
      vocalCast: activeSongArtistCast.label,
      artistCount: activeSongArtistCast.count,
      singerCount: activeSongArtistCast.count,
      songMood: direction,
      songText: publicLyrics,
      forceRealMusic: true,
      generateMusic: true,
      instrumental: true,
      forceInstrumental: true,
      previewInstrumental: true,
      musicProvider: "elevenlabs",
      disableEmergencyMedia: true,
      durationSeconds: Math.max(45, Math.min(180, Math.ceil(publicLyrics.length / 14))),
    });
    const instrumentalUrl = String(
      payload?.audioUrl || payload?.audio_url || payload?.media?.audioUrl || payload?.media?.audio_url || payload?.media?.url || ""
    ).trim();
    if (!instrumentalUrl) {
      throw new Error(payload?.mediaStatus?.message || "instrumental_preview_missing");
    }
    return resolveApiAssetUrl(instrumentalUrl) || instrumentalUrl;
  }

  async function produceSimpleVivySong() {
    if (!hasSession) {
      setStatus("Connexion requise pour générer une chanson Vivy.");
      return;
    }
    const prompt = toUnicodeText(songText || voiceInstruction || songMood, VIVY_STUDIO_SONG_MAX_CHARS).trim();
    if (!prompt) {
      setStatus("Écris un prompt, un thème ou quelques paroles pour générer la chanson.");
      return;
    }
    setIsBusy(true);
    setVivyMedia(null);
    setVivyArrangementCues([]);
    setStatus(sunoSessionKey.trim()
      ? `${activeVoiceProfile.label} lance Suno avec ta clé personnelle de session...`
      : `${activeVoiceProfile.label} lance Suno si ton compte a les droits fondateur/admin.`);
    try {
      const playablePrompt = buildVivyPlayableText(prompt, songMood || "Vivy garde le fil du morceau.", 320);
      const payload = await runVivyStudioProduction({
        mode: "song",
        voiceTool,
        voiceInstruction,
        voiceFileName,
        voiceReferenceId,
        voiceReferenceName: activeCatalogVoiceName || voiceFileName,
        voiceCatalogName: activeCatalogVoiceName || undefined,
        voiceCatalogConsent: activeCatalogVoice ? VIVY_VOICE_CATALOG_CONSENT : undefined,
        songSource,
        songArtists,
        vocalCast: activeSongArtistCast.label,
        artistCount: activeSongArtistCast.count,
        singerCount: activeSongArtistCast.count,
        songMood,
        songText: prompt,
        sessionSunoApiKey: sunoSessionKey.trim() || undefined,
        prompt: playablePrompt,
        forceRealMusic: true,
        generateMusic: true,
        makeSong: true,
        preserveSelectedVoice: true,
        allowExternalVoiceMix: false,
        disableEmergencyMedia: true,
        durationSeconds: 45,
      });
      const payloadAny = payload as any;
      let finalPayload: any = payloadAny;
      setVivyDiagnostics(payload.prosody || null);
      const publicLyrics = toUnicodeText(payloadAny?.publicLyrics || prompt, VIVY_STUDIO_SONG_MAX_CHARS).trim();
      const vocalLyrics = toUnicodeText(payloadAny?.vocalLyrics || publicLyrics, VIVY_STUDIO_SONG_MAX_CHARS).trim();
      const vocalSegments = Array.isArray(payloadAny?.vocalSegments) ? payloadAny.vocalSegments : [];
      setVivyLyrics(publicLyrics);
      setVivyArrangementCues(Array.isArray(payloadAny?.arrangementCues) ? payloadAny.arrangementCues : []);
      let mediaUrl = getVivySongMediaUrl(finalPayload);
      const taskId = String(payloadAny?.mediaStatus?.taskId || payloadAny?.musicJob?.taskId || payloadAny?.media?.taskId || "").trim();
      if (!mediaUrl && taskId) {
        setStatus("Suno compose la chanson Vivy. Je récupère le MP3 dès qu’il est prêt...");
        finalPayload = await waitForVivySongJob(taskId);
        if (!payload.prosody && finalPayload?.prosody) setVivyDiagnostics(finalPayload.prosody);
        mediaUrl = getVivySongMediaUrl(finalPayload);
      }
      if (!mediaUrl) {
        const mediaStatus = payloadAny?.mediaStatus;
        const notConfigured = mediaStatus?.state === 'not_configured';
        const sunoPromptReady = Boolean(mediaStatus?.sunoPromptAvailable || mediaStatus?.lyricsPack);
        if (notConfigured && sunoPromptReady) {
          setVivyOutput(normalizeVivyStudioOutputForState([
            payload?.summary || "Pack Suno prêt.",
            "Suno non configuré côté serveur. Aucun ancien audio et aucune voix de secours ne sont utilisés.",
            `Direction: ${songMood || "couleur sonore automatique depuis la matière"}`,
            `Casting: ${activeSongArtistCast.label}`,
            payloadAny?.publicLyrics ? "Paroles disponibles dans l'onglet Paroles." : "",
          ].filter(Boolean).join("\n")));
          setStatus("Prompt Suno prêt. Clé Suno absente — paroles disponibles.");
          return;
        }
        throw new Error(mediaStatus?.message || mediaStatus?.reason || "audio_url_missing");
      }
      const voiceMode = String(
        payloadAny?.mediaStatus?.voiceMode
        || payloadAny?.musicJob?.voiceMode
        || payloadAny?.media?.voiceMode
        || "suno_generated"
      );
      let preparedMedia: VivyStudioMediaPreview = {
        kind: "audio" as const,
        url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        downloadUrl: resolveApiAssetUrl(mediaUrl) || mediaUrl,
        provider: String(finalPayload?.media?.provider || payloadAny?.mediaStatus?.provider || "vivy-music"),
        contentType: String(finalPayload?.media?.content_type || finalPayload?.contentType || finalPayload?.content_type || "audio/mpeg"),
        filename: String(finalPayload?.media?.filename || finalPayload?.filename || "vivy-chanson.mp3"),
      };
      if (voiceMode === "external_mix") {
        setStatus(`Suno a terminé l'instrumental. J'ajoute maintenant ${activeSongArtistCast.label}...`);
        const voicePreview = activeSongArtistCast.count > 1
          ? await createVivyMultiVoicePreview(vocalSegments)
          : await createVivySongVoicePreview(vocalLyrics);
        const mixed = await mixVivyStudioPreview(voicePreview.url, preparedMedia.url);
        const mixedUrl = String(mixed?.audioUrl || mixed?.audio_url || mixed?.url || "").trim();
        if (!mixedUrl) throw new Error("mix_suno_vivy_audio_url_missing");
        preparedMedia = {
          kind: "audio",
          url: resolveApiAssetUrl(mixedUrl) || mixedUrl,
          downloadUrl: resolveApiAssetUrl(mixedUrl) || mixedUrl,
          provider: String(mixed?.provider || "vivy-suno-voice-mix"),
          contentType: String(mixed?.content_type || "audio/mpeg"),
          filename: String(mixed?.filename || "vivy-suno-voix-selectionnee.mp3"),
          voiceManifest: voicePreview.voiceManifest,
        };
      }
      setVivyMedia(preparedMedia);
      const voiceRoute = voiceMode === "suno_voice"
        ? "Voix Vivy vérifiée utilisée directement par Suno."
        : voiceMode === "external_mix"
          ? `Instrumental Suno mixé avec la piste ${activeSongArtistCast.label}.`
          : "Voix chantée générée par Suno. La voix Suno Vivy doit encore être enregistrée pour conserver exactement son timbre.";
      setVivyOutput(normalizeVivyStudioOutputForState([
        "Production musicale Suno prête.",
        `Direction: ${songMood || "couleur sonore automatique depuis la matière"}`,
        `Casting vocal: ${activeSongArtistCast.countLabel} - ${activeSongArtistCast.label}`,
        voiceRoute,
        taskId ? "Job Suno: lancé (identifiant masqué du brief)" : "",
        finalPayload?.summary || payload?.summary || "Sortie: chanson audio Suno générée.",
      ].filter(Boolean).join("\n")));
      setStatus(voiceMode === "suno_voice"
        ? "Chanson Suno prête avec la voix Vivy vérifiée."
        : voiceMode === "external_mix"
          ? `Chanson prête: instrumental Suno + voix ${activeSongArtistCast.label}.`
          : "Chanson complète Suno prête. Le timbre Vivy sera disponible après l’enregistrement Suno Voice.");
    } catch (error: any) {
      setStatus(`Chanson Vivy indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function askVivy() {
    if (!hasSession) {
      setStatus("Connexion requise pour produire avec Vivy.");
      return;
    }
    if (activeMode === "test") {
      setStatus("Choisis une voix dans la liste, puis lance son bouton Tester.");
      return;
    }
    const wantsSongPreview = activeMode === "song";
    const productionMode: VivyStudioProductionMode = activeMode;
    setIsBusy(true);
    setVivyMedia(null);
    setStatus(wantsSongPreview
      ? "Vivy Studio prépare la chanson et une maquette audio locale..."
      : "Vivy Studio prépare la production...");
    try {
      const payload = await runVivyStudioProduction({
        mode: productionMode,
        voiceTool,
        voiceInstruction,
        voiceFileName,
        voiceReferenceId,
        voiceReferenceName: activeCatalogVoiceName || voiceFileName,
        voiceCatalogName: activeCatalogVoiceName || undefined,
        voiceCatalogConsent: activeCatalogVoice ? VIVY_VOICE_CATALOG_CONSENT : undefined,
        songSource,
        songArtists,
        vocalCast: activeSongArtistCast.label,
        artistCount: activeSongArtistCast.count,
        singerCount: activeSongArtistCast.count,
        songMood,
        songText,
        sessionSunoApiKey: sunoSessionKey.trim() || undefined,
        shareTarget,
        shareUrl,
        shareInstruction,
        shareTokenPresent: Boolean(shareToken.trim()),
        prompt: wantsSongPreview
          ? buildVivyPlayableText(songText || songMood || voiceInstruction, songMood || "Vivy garde le fil du morceau.", 320)
          : undefined,
        durationSeconds: wantsSongPreview ? 12 : undefined,
        allowPlaceholderMedia: false,
        disableEmergencyMedia: true,
      });
      const text = String(payload?.assistant || payload?.message || payload?.content || "").trim();
      if (!text) throw new Error("reponse_vide");
      setVivyDiagnostics(payload.prosody || null);
      const payloadAny = payload as any;
      const publicLyrics = String(payloadAny?.publicLyrics || "").trim();
      const vocalLyrics = String(payloadAny?.vocalLyrics || publicLyrics).trim();
      const vocalSegments = Array.isArray(payloadAny?.vocalSegments)
        ? payloadAny.vocalSegments as VivyStudioVocalSegment[]
        : [];
      const arrangementCues = Array.isArray(payloadAny?.arrangementCues)
        ? payloadAny.arrangementCues.map((cue: unknown) => String(cue || "").trim()).filter(Boolean)
        : [];
      setVivyLyrics(publicLyrics);
      setVivyArrangementCues(arrangementCues);
      const audioUrl = String(payload?.audioUrl || payload?.audio_url || payload?.media?.audioUrl || payload?.media?.audio_url || "").trim();
      const videoUrl = String(payload?.videoUrl || payload?.video_url || payload?.media?.videoUrl || payload?.media?.video_url || "").trim();
      const mediaUrl = audioUrl || videoUrl;
      setVivyOutput(normalizeVivyStudioOutputForState([
        payload.summary || "Production Vivy prête.",
        mediaUrl ? `Média ${audioUrl ? "audio" : "vidéo"} disponible dans le lecteur du Studio.` : "",
        text && !/^VIVY_/i.test(text) ? text : "",
      ].filter(Boolean).join("\n")));
      let preparedMedia: VivyStudioMediaPreview | null = mediaUrl
        ? {
          kind: audioUrl ? "audio" : "video",
          url: resolveApiAssetUrl(mediaUrl) || mediaUrl,
          downloadUrl: resolveApiAssetUrl(mediaUrl) || mediaUrl,
          provider: String(payload?.media?.provider || "").trim() || undefined,
          contentType: String(payload?.media?.content_type || "").trim() || undefined,
          filename: String(payload?.media?.filename || (audioUrl ? "vivy-audio.mp3" : "vivy-video.mp4")),
        }
        : null;
      let instrumentalPreviewError = "";
      if (!preparedMedia && wantsSongPreview && publicLyrics) {
        setStatus(`Création de l'aperçu avec ${activeSongArtistCast.label}...`);
        const voicePreview = activeSongArtistCast.count > 1
          ? await createVivyMultiVoicePreview(vocalSegments)
          : await createVivySongVoicePreview(vocalLyrics);
        preparedMedia = voicePreview;
        if (includeInstrumentalPreview && arrangementCues.length) {
          try {
            setStatus(`Création de l'instrumental: ${arrangementCues.join(", ")}...`);
            const instrumentalUrl = await createVivySongInstrumentalPreview(publicLyrics, arrangementCues);
            setStatus(`Mix de ${activeSongArtistCast.label} avec l'instrumental...`);
            const mixed = await mixVivyStudioPreview(voicePreview.url, instrumentalUrl);
            const mixedUrl = String(mixed?.audioUrl || mixed?.audio_url || mixed?.url || "").trim();
            if (!mixedUrl) throw new Error("mixed_preview_audio_url_missing");
            preparedMedia = {
              kind: "audio",
              url: resolveApiAssetUrl(mixedUrl) || mixedUrl,
              downloadUrl: resolveApiAssetUrl(mixedUrl) || mixedUrl,
              provider: String(mixed?.provider || "vivy-voice-instrumental-mix"),
              contentType: String(mixed?.content_type || "audio/mpeg"),
              filename: String(mixed?.filename || "vivy-apercu-voix-instrumental.mp3"),
              voiceManifest: voicePreview.voiceManifest
                ? {
                  ...voicePreview.voiceManifest,
                  mixEngine: "preview-mix",
                  output: String(mixed?.filename || "vivy-apercu-voix-instrumental.mp3"),
                }
                : undefined,
            };
          } catch (instrumentalError: any) {
            instrumentalPreviewError = String(instrumentalError?.message || instrumentalError || "instrumental_indisponible");
          }
        }
      }
      setVivyMedia(preparedMedia);
      const isMixedPreview = preparedMedia?.provider === "vivy-voice-instrumental-mix";
      setStatus(preparedMedia
        ? (wantsSongPreview && audioUrl
          ? (payload.summary || "Préécoute chanson prête avant Suno.")
          : (wantsSongPreview
            ? (isMixedPreview
              ? `Aperçu ${activeSongArtistCast.label} + instrumental prêt.`
              : (instrumentalPreviewError
                ? `Aperçu ${activeSongArtistCast.label} prêt sans instrumental: ${instrumentalPreviewError}`
                : `Aperçu ${activeSongArtistCast.label} prêt. Les indications instrumentales ne sont pas récitées.`))
            : (payload.summary || "Production Vivy ajoutée au brief.")))
        : (payload.mediaStatus?.message || payload.summary || "Brief Vivy prêt."));
    } catch (error: any) {
      setStatus(`Production Vivy indisponible: ${error?.message || error}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function openAgent(target: "a11" | "k44") {
    await copyStudioPublicOutput(target === "a11" ? "Sortie Vivy copiée. Ouverture A11..." : "Sortie Vivy copiée. Ouverture K44...");
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
        <button type="button" onClick={shareStudioPublicOutput}>Partager la sortie</button>
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

        <form className="vivy-studio-form" onSubmit={(event) => { event.preventDefault(); void askVivy(); }}>
          <h3>{activeMeta.title}</h3>

          {activeMode === "voice" && (
            <>
              <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#a78bfa", userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>Options avancées</summary>
              <label>
                Méthode voix
                <select
                  id="vivy-studio-voice-tool"
                  name="voiceTool"
                  value={voiceTool}
                  disabled={!hasSession}
                  onChange={(event) => applyVoiceToolSelection(event.target.value)}
                >
                  <option>Voix Vivy officielle</option>
                  <option>Voix Vivy chant</option>
                  <option>Voix Djeff officielle</option>
                  <option>Voix A11 officielle</option>
                  <option>Voix K44 officielle</option>
                  <option>Duo Djeff + Vivy</option>
                  <option>Voix Vivy + référence privée</option>
                  <option>Voix catalogue premium</option>
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
                    if (file && !/djeff|duo|a11|alphaonze|alpha onze|k44|kaen44|kaen/.test(foldForLookup(voiceTool))) {
                      setVoiceTool("Voix Vivy + référence privée");
                    }
                  }}
                />
              </label>
              <fieldset className="vivy-studio-consent-fieldset">
                <legend>Catalogue voix</legend>
                <label className="vivy-studio-checkline">
                  <input
                    type="checkbox"
                    checked={publishVoiceToCatalog}
                    disabled={!hasSession}
                    onChange={(event) => setPublishVoiceToCatalog(event.currentTarget.checked)}
                  />
                  <span>Proposer cette voix aux chansons autorisées</span>
                </label>
                {publishVoiceToCatalog ? (
                  <>
                    <label>
                      Nom public unique
                      <input
                        id="vivy-studio-catalog-name"
                        name="catalogVoiceName"
                        value={catalogVoiceName}
                        disabled={!hasSession}
                        onChange={(event) => setCatalogVoiceName(event.target.value)}
                        placeholder="Ex: Lara"
                      />
                    </label>
                    <label className="vivy-studio-checkline">
                      <input
                        type="checkbox"
                        checked={catalogConsentAccepted}
                        disabled={!hasSession}
                        onChange={(event) => setCatalogConsentAccepted(event.currentTarget.checked)}
                      />
                      <span>J’autorise les comptes Premium/Famille/Admin à créer des chansons avec cette voix.</span>
                    </label>
                  </>
                ) : null}
              </fieldset>
              <fieldset className="vivy-studio-voice-fieldset">
                <legend>Répertoire voix Funesterie</legend>
                <div className="vivy-studio-voice-directory">
                  {VIVY_STUDIO_VOICE_DIRECTORY.filter((entry) => entry.id !== "personal").map((entry) => {
                    const selected = voiceLearningPersona === entry.persona || voiceTool === entry.voiceTool;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`vivy-studio-voice-card${selected ? " is-active" : ""}`}
                        disabled={!hasSession || isBusy}
                        onClick={() => applyVoiceDirectoryEntry(entry)}
                      >
                        <span>{entry.label}</span>
                        <small>{entry.ownerLabel}</small>
                        <em data-kind={entry.statusKind}>{entry.statusLabel}</em>
                      </button>
                    );
                  })}
                </div>
                <label>
                  Voix premium autorisée
                  <select
                    id="vivy-studio-catalog-voice"
                    name="vivyCatalogVoice"
                    value={selectedCatalogVoiceId}
                    disabled={!hasSession || !catalogVoices.length}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      const nextVoice = catalogVoices.find((voice) => voice.id === nextId) || null;
                      setSelectedCatalogVoiceId(nextId);
                      if (nextVoice) {
                        const nextName = String(nextVoice.catalog?.name || nextVoice.label || "").trim();
                        setVoiceReferenceId(nextVoice.id);
                        setVoiceFileName(nextName || nextVoice.label || "voix catalogue");
                        setVoiceTool("Voix catalogue premium");
                        setCatalogVoiceName(nextName);
                        setStatus(`Voix catalogue sélectionnée: ${nextName || nextVoice.label}.`);
                      } else {
                        setVoiceReferenceId("");
                        setVoiceFileName("");
                        setStatus("Voix catalogue désactivée.");
                      }
                    }}
                  >
                    <option value="">Aucune voix catalogue</option>
                    {catalogVoices.map((voice) => {
                      const name = String(voice.catalog?.name || voice.label || voice.id).trim();
                      return (
                        <option key={voice.id} value={voice.id}>{name}</option>
                      );
                    })}
                  </select>
                </label>
                {!catalogVoices.length ? (
                  <p className="vivy-studio-voice-summary">Catalogue premium vide pour l’instant. Les voix publiées avec accord apparaîtront ici.</p>
                ) : null}
              </fieldset>
              </details>
              <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#a78bfa", userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>Apprentissage voix (avancé)</summary>
              <fieldset className="vivy-studio-voice-fieldset">
                <legend>Apprentissage voix</legend>
                <label>
                  Voix à entraîner
                  <select
                    id="vivy-studio-learning-persona"
                    name="voiceLearningPersona"
                    value={voiceLearningPersona}
                    disabled={!hasSession || isBusy}
                    onChange={(event) => {
                      const persona = normalizeVivyStudioVoicePersona(event.target.value, "djeff");
                      const entry = getVivyStudioVoiceDirectoryEntry(persona);
                      applyVoiceDirectoryEntry(entry);
                    }}
                  >
                    {VIVY_STUDIO_VOICE_DIRECTORY.map((entry) => (
                      <option key={entry.id} value={entry.persona}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Extrait source
                  <input
                    id="vivy-studio-learning-file"
                    name="voiceLearningFile"
                    type="file"
                    accept="audio/*,video/quicktime,video/mp4,.wav,.mp3,.m4a,.mov,.mp4,.flac,.ogg,.webm"
                    disabled={!hasSession || isBusy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      setVoiceLearningFile(file);
                      setVoiceLearningFileName(file?.name || "");
                    }}
                  />
                </label>
                <label>
                  Texte fidèle / paroles
                  <textarea
                    id="vivy-studio-learning-transcript"
                    name="voiceLearningTranscript"
                    rows={4}
                    value={voiceLearningTranscript}
                    disabled={!hasSession || isBusy}
                    onChange={(event) => setVoiceLearningTranscript(event.target.value)}
                    placeholder="Colle ici le texte exact ou corrigé de l’audio pour aider l’entraînement."
                  />
                </label>
                <div className="vivy-studio-actions vivy-studio-actions--voice">
                  <button type="button" onClick={uploadVoiceLearningCorpus} disabled={!hasSession || isBusy || !voiceLearningFile}>Ajouter au corpus</button>
                  <button type="button" onClick={trainVoiceLearningCorpus} disabled={!hasSession || isBusy || !voiceLearningStatus?.corpusReady}>Lancer entraînement</button>
                  <button type="button" onClick={testVoiceLearningChatbot} disabled={!hasSession || isBusy}>Tester chat vocal</button>
                  <button type="button" onClick={resetVoiceLearningCorpus} disabled={!hasSession || isBusy || !Number(voiceLearningStatus?.clipCount || 0)}>Nettoyer corpus</button>
                </div>
                <p className="vivy-studio-voice-summary">
                  {activeVoiceLearningEntry.label}: {voiceLearningProgressLabel}
                  {voiceLearningFileName ? ` · fichier prêt: ${voiceLearningFileName}` : ""}
                  {voiceLearningMessage ? ` · ${voiceLearningMessage}` : ""}
                </p>
              </fieldset>
              </details>
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
                <button type="button" className="vivy-studio-primary-action" onClick={testDefaultVivyVoice} disabled={!hasSession || isBusy}>
                  {isBusy ? "Génération..." : "Tester voix active"}
                </button>
                <button type="button" onClick={useDefaultVivyVoice} disabled={!hasSession || isBusy} style={{ opacity: 0.7 }}>Voix Vivy par défaut</button>
                <button type="button" onClick={uploadVoiceReference} disabled={!hasSession || isBusy || !voiceFile} style={{ opacity: 0.7 }}>Remplacer référence</button>
              </div>
              <p className="vivy-studio-active-voice">Voix active: {activeVoiceReferenceLabel}</p>
            </>
          )}

          {activeMode === "test" && (
            <>
              <p style={{ fontSize: 12, color: "var(--muted, #8892a6)", marginBottom: 12 }}>
                Teste chaque voix avec une phrase courte auto, sans reprendre le prompt Studio.
              </p>
              <div className="vivy-studio-test-list">
                {VIVY_STUDIO_VOICE_DIRECTORY.filter((e) => e.id !== "personal").map((entry) => {
                  return (
                    <div key={entry.id} className="vivy-studio-voice-card vivy-studio-test-card">
                      <div className="vivy-studio-test-card-copy">
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{entry.label}</div>
                        <div style={{ fontSize: 11, color: "var(--muted, #8892a6)" }}>{entry.referenceLabel || entry.voiceStyle}</div>
                        <div style={{ fontSize: 10, color: "#4ade80", marginTop: 2 }}>{entry.statusLabel}</div>
                      </div>
                      <div className="vivy-studio-test-mode-buttons" aria-label={`Modes de test ${entry.label}`}>
                        {VIVY_STUDIO_VOICE_TEST_MODES.map((mode) => {
                          const testKey = `${entry.id}:${mode.id}`;
                          const isTesting = testingVoiceId === testKey && isBusy;
                          return (
                            <button
                              key={mode.id}
                              type="button"
                              className="vivy-studio-primary-action"
                              disabled={!hasSession || isBusy}
                              title={`${entry.label} · ${mode.statusLabel}`}
                              onClick={async () => {
                                setTestingVoiceId(testKey);
                                await testSpecificVoiceEntry(entry, mode);
                                setTestingVoiceId("");
                              }}
                            >
                              {isTesting ? "..." : mode.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {catalogVoices.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: "var(--muted, #8892a6)", marginTop: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Voix contribuées</div>
                    {catalogVoices.map((voice) => {
                      const name = String(voice.catalog?.name || voice.label || voice.id).trim();
                      const catalogEntry = {
                        id: voice.id,
                        label: name,
                        shortLabel: name,
                        ttsPersona: "vivy" as const,
                        voiceStyle: (voice.catalog as any)?.voiceStyle || name,
                        voiceTool: "Voix catalogue premium",
                        surface: "vivy" as const,
                        testLine: `Je suis ${name}, voix Funesterie.`,
                      };
                      return (
                        <div key={voice.id} className="vivy-studio-voice-card vivy-studio-test-card">
                          <div className="vivy-studio-test-card-copy">
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
                            <div style={{ fontSize: 10, color: "#a78bfa", marginTop: 2 }}>catalogue premium</div>
                          </div>
                          <div className="vivy-studio-test-mode-buttons" aria-label={`Modes de test ${name}`}>
                            {VIVY_STUDIO_VOICE_TEST_MODES.map((mode) => {
                              const testKey = `${voice.id}:${mode.id}`;
                              const isTesting = testingVoiceId === testKey && isBusy;
                              return (
                                <button
                                  key={mode.id}
                                  type="button"
                                  className="vivy-studio-primary-action"
                                  disabled={!hasSession || isBusy}
                                  title={`${name} · ${mode.statusLabel}`}
                                  onClick={async () => {
                                    setTestingVoiceId(testKey);
                                    await testSpecificVoiceEntry(catalogEntry, mode);
                                    setTestingVoiceId("");
                                  }}
                                >
                                  {isTesting ? "..." : mode.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {!catalogVoices.length && (
                  <p style={{ fontSize: 12, color: "var(--muted, #8892a6)" }}>Aucune voix contribuée pour l'instant.</p>
                )}
              </div>
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
                  <option>Prompt +</option>
                  <option>Prompt + Suno + voix sélectionnée</option>
                  <option>Thème</option>
                  <option>Texte brut</option>
                  <option>Paroles</option>
                  <option>Instruction complète</option>
                </select>
              </label>
              <label className="vivy-studio-inline-option">
                <input
                  type="checkbox"
                  checked={songCastingAuto}
                  disabled={!hasSession}
                  onChange={(event) => setSongCastingAuto(event.target.checked)}
                />
                <span>Routage automatique du casting et de la couleur depuis le canevas</span>
              </label>
              <fieldset className="vivy-studio-artist-fieldset">
                <legend>Casting vocal</legend>
                <div className="vivy-studio-artist-grid">
                  {VIVY_STUDIO_ARTISTS.map((artist) => {
                    const checked = songArtists.includes(artist.id);
                    return (
                      <label
                        key={artist.id}
                        className={`vivy-studio-artist-option${checked ? " is-selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!hasSession || songCastingAuto}
                          onChange={() => toggleSongArtist(artist.id)}
                        />
                        <span>
                          <strong>{artist.label}</strong>
                          <small>{artist.tag}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p>{activeSongArtistCast.countLabel}: {activeSongArtistCast.label}</p>
              </fieldset>
              <label>
                Voix catalogue
                <select
                  id="vivy-studio-song-catalog-voice"
                  name="catalogVoice"
                  value={selectedCatalogVoiceId}
                  disabled={!hasSession || !catalogVoices.length}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const nextVoice = catalogVoices.find((voice) => voice.id === nextId) || null;
                    setSelectedCatalogVoiceId(nextId);
                    if (nextVoice) {
                      const nextName = String(nextVoice.catalog?.name || nextVoice.label || "").trim();
                      setVoiceReferenceId(nextVoice.id);
                      setVoiceFileName(nextName || nextVoice.label || "voix catalogue");
                      setVoiceTool("Voix catalogue premium");
                      setCatalogVoiceName(nextName);
                      setStatus(`Voix catalogue sélectionnée: ${nextName || nextVoice.label}.`);
                    } else {
                      setVoiceReferenceId("");
                      setVoiceFileName("");
                      setStatus("Voix catalogue désactivée pour cette chanson.");
                    }
                  }}
                >
                  <option value="">Aucune voix catalogue</option>
                  {catalogVoices.map((voice) => {
                    const name = String(voice.catalog?.name || voice.label || voice.id).trim();
                    return (
                      <option key={voice.id} value={voice.id}>{name}</option>
                    );
                  })}
                </select>
              </label>
              {catalogStatus ? (
                <p className="vivy-studio-active-voice">{catalogStatus}</p>
              ) : null}
              <label>
                Couleur sonore
                <input
                  id="vivy-studio-song-mood"
                  name="songMood"
                  value={songMood}
                  disabled={!hasSession}
                  onChange={(event) => setSongMood(event.target.value)}
                  placeholder="Laisse vide pour que Vivy choisisse depuis la matière."
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
                  onChange={(event) => {
                    setSongText(event.target.value);
                    setVivyArrangementCues([]);
                  }}
                  placeholder="Thème, paroles, ambiance, intention, histoire ou simple idée."
                />
              </label>
              <label className="vivy-studio-inline-option">
                <input
                  type="checkbox"
                  checked={includeInstrumentalPreview}
                  disabled={!hasSession || isBusy}
                  onChange={(event) => setIncludeInstrumentalPreview(event.target.checked)}
                />
                <span>Créer le fond instrumental des indications entre parenthèses</span>
              </label>
              <label>
                Clé Suno personnelle
                <input
                  id="vivy-studio-suno-key"
                  name="sessionSunoApiKey"
                  type="password"
                  value={sunoSessionKey}
                  disabled={!hasSession}
                  onChange={(event) => setSunoSessionKey(event.target.value)}
                  placeholder="Optionnel, gardé seulement dans cette session navigateur"
                  autoComplete="off"
                />
              </label>
              <div className="vivy-studio-actions vivy-studio-actions--song">
                <button type="button" onClick={produceSimpleVivySong} disabled={!hasSession || isBusy || !songText.trim()}>
                  Créer la chanson complète avec Suno
                </button>
                <button type="button" onClick={forgetSunoSessionKey} disabled={!hasSession || isBusy || !sunoSessionKey.trim()}>
                  Oublier clé Suno
                </button>
              </div>
              <p className="vivy-studio-provider-note">
                Vivy utilise une voix Suno vérifiée si elle est configurée; sinon Suno chante avec la direction vocale demandée.
              </p>
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

          <fieldset className="vivy-studio-voice-fieldset vivy-studio-d40-fieldset">
            <legend>Mix D40</legend>
            <label>
              Audio à traiter
              <input
                id="vivy-studio-dh-file"
                name="doubleHarmonicFile"
                type="file"
                accept="audio/*,video/quicktime,video/mp4,.wav,.mp3,.m4a,.mov,.mp4,.flac,.ogg,.webm"
                disabled={!hasSession || isBusy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  setDoubleHarmonicFile(file);
                  setDoubleHarmonicFileName(file?.name || "");
                  setDoubleHarmonicResult(null);
                }}
              />
            </label>
            <label className="vivy-studio-range-label">
              <span>Version</span>
              <select
                id="vivy-studio-dh-mode"
                name="doubleHarmonicMode"
                value={doubleHarmonicMode}
                disabled={!hasSession || isBusy}
                onChange={(event) => {
                  const rawMode = event.currentTarget.value;
                  const nextMode: DoubleHarmonicProcessMode = rawMode === "v9turbo"
                    ? "v9turbo"
                    : rawMode === "v8pivot"
                    ? "v8pivot"
                    : rawMode === "v8plus"
                    ? "v8plus"
                    : rawMode === "v8"
                    ? "v8"
                    : rawMode === "v71"
                    ? "v71"
                    : rawMode === "v7"
                    ? "v7"
                    : rawMode === "v6"
                    ? "v6"
                    : rawMode === "v5"
                      ? "v5"
                      : rawMode === "v4"
                      ? "v4"
                      : rawMode === "v3"
                        ? "v3"
                        : rawMode === "v2"
                          ? "v2"
                          : "v1";
                  setDoubleHarmonicMode(nextMode);
                  setDoubleHarmonicIntensity(nextMode === "v8" || nextMode === "v8plus" || nextMode === "v8pivot" || nextMode === "v9turbo" ? D40_V8_DEFAULT_INTENSITY : nextMode === "v71" ? D40_V7_DEFAULT_INTENSITY : nextMode === "v7" ? D40_V7_DEFAULT_INTENSITY : nextMode === "v6" ? D40_V6_DEFAULT_INTENSITY : nextMode === "v5" ? D40_V5_DEFAULT_INTENSITY : 1);
                  setDoubleHarmonicResult(null);
                }}
              >
                <option value="v9turbo">V9 Dynamique</option>
                <option value="v8pivot">V8 Pivot</option>
                <option value="v8plus">V8 Plus e2</option>
                <option value="v8">V8 Fermeture</option>
                <option value="v6">V6 Supreme</option>
                <option value="v7">V7 Briques</option>
                <option value="v71">V7.1 1024</option>
                <option value="v5">V5 Release</option>
                <option value="v1">V1 stable</option>
                <option value="v2">V2 Release</option>
                <option value="v3">V3 auto</option>
                <option value="v4">V4 Stable</option>
              </select>
              <strong>{doubleHarmonicModeLabel}</strong>
            </label>
            <label className="vivy-studio-range-label">
              <span>Sortie</span>
              <select
                id="vivy-studio-dh-format"
                name="doubleHarmonicOutputFormat"
                value={doubleHarmonicOutputFormat}
                disabled={!hasSession || isBusy}
                onChange={(event) => {
                  const rawFormat = event.currentTarget.value;
                  const nextFormat: DoubleHarmonicOutputFormat = rawFormat === "source"
                    ? "source"
                    : rawFormat === "mp3"
                      ? "mp3"
                      : rawFormat === "m4a"
                        ? "m4a"
                        : rawFormat === "wav"
                          ? "wav"
                          : "flac";
                  setDoubleHarmonicOutputFormat(nextFormat);
                  setDoubleHarmonicResult(null);
                }}
              >
                <option value="source">Même format</option>
                <option value="flac">FLAC master</option>
                <option value="mp3">MP3 léger</option>
                <option value="m4a">M4A léger</option>
                <option value="wav">WAV brut</option>
              </select>
              <strong>{doubleHarmonicOutputFormatLabel}</strong>
            </label>
            <label className="vivy-studio-range-label">
              <span>{doubleHarmonicIntensityTitle}</span>
              <input
                id="vivy-studio-dh-intensity"
                name="doubleHarmonicIntensity"
                type="range"
                min={doubleHarmonicIntensityMin}
                max={doubleHarmonicIntensityMax}
                step={doubleHarmonicIntensityStep}
                value={doubleHarmonicIntensity}
                disabled={!hasSession || isBusy || doubleHarmonicUsesFixedWeight}
                onChange={(event) => {
                  const nextValue = Number(event.currentTarget.valueAsNumber || event.currentTarget.value || 1);
                  setDoubleHarmonicIntensity(Math.max(doubleHarmonicIntensityMin, Math.min(doubleHarmonicIntensityMax, nextValue)));
                  setDoubleHarmonicResult(null);
                }}
              />
              <strong>{doubleHarmonicWeightLabel}</strong>
            </label>
            <div className="vivy-studio-actions vivy-studio-actions--voice">
              <button type="button" onClick={processVivyDoubleHarmonicAudio} disabled={!hasSession || isBusy || !doubleHarmonicFile}>Mixer D40</button>
              {doubleHarmonicResult?.shareUrl ? (
                <>
                  <button
                    type="button"
                    className="vivy-studio-action-link"
                    onClick={() => void downloadVivyMediaFile(
                      doubleHarmonicResult.audioUrl || doubleHarmonicResult.shareUrl,
                      doubleHarmonicResult.filename || "funesterie-d40-audio"
                    )}
                  >
                    Télécharger
                  </button>
                  <a className="vivy-studio-action-link" href={doubleHarmonicResult.shareUrl} target="_blank" rel="noreferrer">Ouvrir</a>
                </>
              ) : null}
            </div>
            <p className="vivy-studio-voice-summary">
              {`Version : ${doubleHarmonicModeLabel} · Sortie : ${doubleHarmonicOutputFormatLabel}`}
            </p>
          </fieldset>

          <div className="vivy-studio-actions">
            {activeMode !== "voice" && activeMode !== "test" && (
              <button type="submit" disabled={!hasSession || isBusy}>{activeMeta.action}</button>
            )}
            {activeMode !== "voice" && activeMode !== "test" && (
              <button type="button" onClick={askVivy} disabled={!hasSession || isBusy}>Demander à Vivy</button>
            )}
            <button type="button" onClick={() => openAgent("a11")}>Ouvrir A11</button>
            <button type="button" onClick={saveBriefArtifact} disabled={!hasSession || isBusy} style={{ opacity: 0.7 }}>Sauver dans A11</button>
          </div>
        </form>

        <aside className="vivy-studio-brief" aria-live="polite">
          {vivyMedia && (
            <div className="vivy-studio-media">
              <strong>{String(vivyMedia.provider || "") === "funesterie-d40"
                ? `Audio ${doubleHarmonicModeLabel} prêt`
                : String(vivyMedia.provider || "").includes("emergency")
                  ? (vivyMedia.kind === "audio" ? "Préécoute chanson" : "Maquette vidéo locale")
                  : (vivyMedia.kind === "audio" ? "Audio Vivy prêt" : "Clip Vivy prêt")}</strong>
              {vivyMedia.kind === "audio" ? (
                <audio
                  src={vivyMedia.url}
                  controls
                  autoPlay
                  preload="metadata"
                  onError={() => {
                    setVivyMedia(null);
                    setStatus("Ancien audio Vivy expiré. Relance le test pour créer un nouveau MP3.");
                  }}
                />
              ) : (
                <video
                  src={vivyMedia.url}
                  controls
                  preload="metadata"
                  playsInline
                  onError={() => {
                    setVivyMedia(null);
                    setStatus("Ancien clip Vivy expiré. Relance la production pour créer un nouveau média.");
                  }}
                />
              )}
              <div className="vivy-studio-media-actions">
                <button
                  type="button"
                  onClick={() => void downloadVivyMediaFile(vivyMedia.downloadUrl || vivyMedia.url, vivyMedia.filename || "funesterie-media")}
                >
                  Télécharger
                </button>
                <a href={vivyMedia.url} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
              </div>
              {(vivyMedia.provider || vivyMedia.contentType) && (
                <small>{[vivyMedia.provider, vivyMedia.contentType].filter(Boolean).join(" - ")}</small>
              )}
              {vivyMedia.voiceManifest ? (
                <small>
                  {`Voix demandée: ${vivyMedia.voiceManifest.providerRequested || "auto"} · utilisée: ${vivyMedia.voiceManifest.providerUsed || "inconnue"} · RVC: ${vivyMedia.voiceManifest.rvcApplied ? "oui" : "non"} · persona: ${vivyMedia.voiceManifest.personaApplied ? "oui" : "non"}`}
                  {vivyMedia.voiceManifest.fallbackUsed
                    ? ` · Fallback voix: ${vivyMedia.voiceManifest.fallbackReason || "raison inconnue"}`
                    : ""}
                </small>
              ) : null}
            </div>
          )}
          {status && <p className="vivy-studio-status-msg">{status}</p>}
          {activeMode === "song" && vivyArrangementCues.length > 0 ? (
            <p className="vivy-studio-arrangement">
              <strong>Arrangement instrumental</strong>
              <span>{vivyArrangementCues.join(" · ")}</span>
            </p>
          ) : null}
          {diagnosticsAllowed ? <VivyD9DiagnosticsPanel prosody={vivyDiagnostics} /> : null}
          {activeMode === "song" && vivyLyrics && (
            <div className="vivy-studio-lyrics" style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 13, color: "#a78bfa" }}>Paroles</strong>
              <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}>{vivyLyrics}</pre>
              <button type="button" style={{ marginTop: 6, fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(vivyLyrics).catch(() => {}); }}>Copier paroles</button>
            </div>
          )}
          {showAgentDebug ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#94a3b8", userSelect: "none" }}>Debug agents</summary>
              <pre style={{ marginTop: 8 }}>{brief}</pre>
              <div>
                <button type="button" onClick={() => copyInternalBrief()}>Copier debug</button>
                <button type="button" onClick={shareStudioPublicOutput}>Partager sortie</button>
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      <div className="vivy-studio-runtime">
        <PinkWardPanel
          embedded
          title="Janus Vision"
          subtitle="Vision reliée au LLM Vivy: Janus quand il répond, fallback vision LLM si le worker dort, Qflush et runtime local en contrôle."
        />
      </div>
    </section>
  );
}

function VivyPublicChat({ hasSession }: VivySessionProps) {
  const [messages, setMessages] = useState<VivyPublicChatMessage[]>(() => hasSession ? readVivyPublicChat() : [buildVivyLockedMessage()]);
  const [conversationId, setConversationId] = useState(() => readOrCreateVivyConversationId("default"));
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
  const activeChatSessionRef = useRef("default");
  const [copiedMsgId, setCopiedMsgId] = useState("");
  const [chatSessions, setChatSessions] = useState<VivyChatSessionMeta[]>(() => hasSession ? listVivyChatSessions() : []);
  const [activeChatSessionId, setActiveChatSessionId] = useState("default");
  const compositionWorkspace = readVivyStudioCompositionWorkspace();
  const nossenBangerReadiness = useMemo(
    () => buildVivyNossenBangerReadiness(messages, draft, attachedFiles, compositionWorkspace.canvas),
    [messages, draft, attachedFiles, compositionWorkspace.canvas]
  );
  const nossenBangerCanLaunch = hasSession && !isSending;

  function getActiveSessionName(id = activeChatSessionId) {
    if (id === "default") return "Session principale";
    return chatSessions.find((session) => session.id === id)?.name || `Session ${id}`;
  }

  function rememberVivyConversationIdForSession(sessionId: string, nextConversationId: string) {
    const safeConversationId = String(nextConversationId || "").trim();
    if (!safeConversationId) return;
    try {
      globalThis.localStorage?.setItem(getVivyConversationStorageKey(sessionId), safeConversationId);
    } catch { }
  }

  function applyRemoteVivySession(session: VivyChatSessionRecord, options: { replaceOnlyPlaceholder?: boolean } = {}) {
    const sessionId = normalizeVivyChatSessionId(session?.id || "default");
    if (activeChatSessionRef.current !== sessionId) return;
    const remoteConversationId = String(session?.conversationId || "").trim() || buildVivyConversationIdForChatSession(sessionId);
    rememberVivyConversationIdForSession(sessionId, remoteConversationId);
    setConversationId(remoteConversationId);
    const hasRemoteMessages = Array.isArray(session?.messages) && session.messages.length > 0;
    if (!hasRemoteMessages) return;
    const remoteMessages = mapVivyRemoteMessages(session.messages);
    setMessages((current) => options.replaceOnlyPlaceholder && !isOnlyVivyPlaceholderMessages(current)
      ? current
      : remoteMessages);
  }

  async function hydrateVivySessionFromServer(sessionId: string, options: { replaceOnlyPlaceholder?: boolean } = {}) {
    try {
      const remote = await fetchVivyChatSession(sessionId);
      applyRemoteVivySession(remote, options);
    } catch {
      void reloadVivySessionsFromServer({ replaceOnlyPlaceholder: true });
    }
  }

  async function reloadVivySessionsFromServer(options: { replaceOnlyPlaceholder?: boolean } = {}) {
    if (!hasSession) return false;
    try {
      const payload = await fetchVivyChatSessions();
      const remoteSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const remoteMetas = remoteSessions
        .map(normalizeVivyRemoteChatSession)
        .filter(Boolean) as VivyChatSessionMeta[];
      const localMetas = listVivyChatSessions();
      const mergedById = new Map(localMetas.map((session) => [session.id, session]));
      remoteMetas.forEach((session) => mergedById.set(session.id, session));
      const mergedMetas = Array.from(mergedById.values())
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
        .slice(0, VIVY_CHAT_MAX_SESSIONS);
      saveVivyChatSessions(mergedMetas);
      setChatSessions(mergedMetas);
      for (const session of remoteSessions) {
        if (session?.conversationId) rememberVivyConversationIdForSession(normalizeVivyChatSessionId(session.id), session.conversationId);
      }
      const activeId = activeChatSessionRef.current;
      const activeStillExists = activeId === "default"
        || mergedMetas.some((session) => session.id === activeId);
      if (!activeStillExists) {
        switchSession("default");
        return true;
      }
      const activeRemote = remoteSessions.find((session) => normalizeVivyChatSessionId(session.id) === activeId)
        || remoteSessions.find((session) => normalizeVivyChatSessionId(session.id) === "default");
      if (activeRemote) applyRemoteVivySession(activeRemote, options);
      return true;
    } catch {
      return false;
    }
  }

  function switchSession(id: string) {
    const safeId = normalizeVivyChatSessionId(id);
    const msgs = safeId === "default" ? readVivyPublicChat() : readVivyChatSession(safeId);
    const nextConversationId = readOrCreateVivyConversationId(safeId);
    setMessages(msgs);
    setActiveChatSessionId(safeId);
    activeChatSessionRef.current = safeId;
    setConversationId(nextConversationId);
    setAttachedFiles([]);
    setStatus("");
    void hydrateVivySessionFromServer(safeId);
  }

  async function addSession() {
    const name = prompt("Nom de la nouvelle session (ex: Saint Seiya, Moto, Zodiaque):");
    if (!name?.trim()) return;
    try {
      const remote = await createVivyChatSessionOnServer(name.trim());
      const meta = normalizeVivyRemoteChatSession(remote);
      if (meta) {
        rememberVivyConversationIdForSession(meta.id, remote.conversationId);
        await reloadVivySessionsFromServer();
        switchSession(meta.id);
        return;
      }
    } catch (error: any) {
      setStatus(`Création de session indisponible côté compte: ${error?.message || error}`);
      return;
    }
  }

  async function deleteCurrentSession() {
    if (activeChatSessionId === "default") return;
    const targetSessionId = activeChatSessionId;
    try {
      await deleteVivyChatSessionOnServer(targetSessionId);
    } catch (error: any) {
      setStatus(`Suppression de session indisponible côté compte: ${error?.message || error}`);
      return;
    }
    deleteVivyChatSession(targetSessionId);
    const synced = await reloadVivySessionsFromServer();
    if (!synced) switchSession("default");
  }

  useEffect(() => {
    activeChatSessionRef.current = activeChatSessionId;
  }, [activeChatSessionId]);

  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void reloadVivySessionsFromServer({ replaceOnlyPlaceholder: true });
    };
    refresh();
    const timer = window.setInterval(() => { void reloadVivySessionsFromServer({ replaceOnlyPlaceholder: true }); }, 12000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasSession]);

  useEffect(() => {
    if (activeChatSessionId === "default") { writeVivyPublicChat(messages); } else { writeVivyChatSession(activeChatSessionId, messages); }
  }, [messages, activeChatSessionId]);

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
    let viewportSettleTimer = 0;

    const setKeyboardInset = () => {
      const inset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty("--vivy-keyboard-inset", `${Math.round(inset)}px`);
      return inset;
    };

    const keepComposerVisible = (behavior: ScrollBehavior = "auto") => {
      setKeyboardInset();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        const target = draftInputRef.current || composeRef.current || root;
        const bounds = target.getBoundingClientRect();
        const visibleTop = viewport?.offsetTop || 0;
        const visibleBottom = visibleTop + (viewport?.height || window.innerHeight);
        const margin = 12;
        if (bounds.top < visibleTop + margin || bounds.bottom > visibleBottom - margin) {
          const scrollOptions: ScrollIntoViewOptions = { behavior, block: "nearest", inline: "nearest" };
          target.scrollIntoView(scrollOptions);
        }
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
    };

    const onViewportResize = () => {
      if (!document.body.classList.contains("vivy-keyboard-open")) return;
      setKeyboardInset();
      window.clearTimeout(viewportSettleTimer);
      viewportSettleTimer = window.setTimeout(() => {
        const target = draftInputRef.current;
        if (!target) return;
        const bounds = target.getBoundingClientRect();
        const visibleTop = viewport?.offsetTop || 0;
        const visibleBottom = visibleTop + (viewport?.height || window.innerHeight);
        if (bounds.top < visibleTop + 8 || bounds.bottom > visibleBottom - 8) {
          target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
        }
      }, 80);
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("resize", onViewportResize);
    viewport?.addEventListener("scroll", onViewportChange);
    window.addEventListener("orientationchange", onViewportResize);

    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("resize", onViewportResize);
      viewport?.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("orientationchange", onViewportResize);
      window.clearTimeout(settleTimer);
      window.clearTimeout(viewportSettleTimer);
      document.body.classList.remove("vivy-keyboard-open");
      document.documentElement.style.setProperty("--vivy-keyboard-inset", "0px");
    };
  }, []);

  function openStudioModeFromChat(mode: VivyStudioMode) {
    openVivyStudioMode(mode);
    const label = mode === "song" ? "Composition" : mode === "voice" ? "Création voix" : "Scène";
    setStatus(`${label}: écris ton idée dans la bulle, ou remplis le bloc Studio.`);
  }

  function sendModeFromComposer(mode: VivyStudioProductionMode) {
    const hasDraft = Boolean(draft.trim() || attachedFiles.length);
    if (!hasDraft) {
      openStudioModeFromChat(mode);
      return;
    }
    void sendMessage({ mode });
  }

  async function sendMessage(options: { mode?: VivyPublicChatMode } = {}) {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connecte-toi à Funesterie avant d'envoyer un message.");
      return;
    }
    const mode = options.mode || "chat";
    const text = toUnicodeText(draft.trim());
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
    const nextMessages = [...messages, userMessage].slice(-36);
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
      const messageText = text || userMessage.content;
      const apiFiles = filesForMessage.map((file) => ({
          id: file.id,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          url: file.url || file.downloadUrl,
          downloadUrl: file.downloadUrl,
          description: file.description,
          textPreview: file.textPreview,
          visualDescription: file.visualDescription,
          analysisSummary: file.analysisSummary,
          analysis: file.analysis,
          uploaded: file.uploaded,
        }));
      const apiHistory = nextMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
          ts: entry.ts,
        }));
      const activeSessionName = getActiveSessionName(activeChatSessionId);
      const vivyLanguage = normalizeA11LanguageCode(getAuthAccountLanguage(localStorage.getItem("a11:language") || "fr"));
      const songWorkspace = mode === "song" ? readVivyStudioCompositionWorkspace() : null;
      const payload = await chatWithVivy({
          mode,
          language: vivyLanguage,
          message: messageText,
          conversationId,
          sessionId: activeChatSessionId,
          sessionName: activeSessionName,
          files: apiFiles,
          history: mode === "song" && songWorkspace?.canvas ? [] : apiHistory,
          songText: songWorkspace?.canvas || undefined,
          songMood: songWorkspace?.notes || undefined,
          songArtists: songWorkspace?.songArtists.length ? songWorkspace.songArtists : undefined,
          workspace: songWorkspace ? {
            canvas: songWorkspace.canvas,
            notes: songWorkspace.notes,
            sessionId: activeChatSessionId,
            sessionName: activeSessionName,
            conversationId,
          } : undefined,
          useWorkspaceForSong: Boolean(songWorkspace),
        });
      const assistantText = toUnicodeText(payload.publicLyrics || payload.publicText || payload.assistant || payload.content || payload.summary)
        || (mode === "song"
          ? "Je suis là, mais je n'ai pas encore assez de matière pour structurer la chanson."
          : "Je suis là, je garde le fil.");
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-assistant-${Date.now()}`,
        role: "assistant",
        content: assistantText,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-36));
      const memoryText = payload.semanticMemory?.stored || payload.memoryStored
        ? "Idée rangée dans la mémoire Vivy"
        : "Vivy prête";
      setStatus(payload.aiMode === "llm"
        ? `${memoryText} - IA active`
        : memoryText);
    } catch (error: any) {
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-error-${Date.now()}`,
        role: "assistant",
        content: `Je n'arrive pas à joindre le studio Vivy pour l'instant: ${error?.message || error}`,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-36));
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
    setMessages((current) => [...current, assistantMessage].slice(-36));
  }

  async function launchNossenBanger() {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connecte-toi à Funesterie avant de lancer NOSSEN.");
      return;
    }
    if (isSending) return;
    const songWorkspace = readVivyStudioCompositionWorkspace();
    const readiness = buildVivyNossenBangerReadiness(
      messages,
      draft,
      attachedFiles,
      songWorkspace.canvas
    );
    const launchReadiness = buildVivyNossenLaunchReadiness(readiness, draft);
    playVivyNossenBangerCall();

    const filesForMessage = attachedFiles.slice(0, 6);
    const inferredArtists = inferVivyNossenBangerArtists(launchReadiness.source);
    const manualArtists = songWorkspace.songArtists.length ? songWorkspace.songArtists : inferredArtists;
    let artists = songWorkspace.castingAuto ? inferredArtists : manualArtists;
    let castLabel = describeVivyNossenBangerCast(artists);
    const useCompositionWorkspace = launchReadiness.sourceKind === "composition";
    let routedMood = useCompositionWorkspace ? songWorkspace.notes.trim() : "";
    let routedReadiness: VivyNossenBangerReadiness = {
      ...launchReadiness,
      styleHints: routedMood ? [routedMood] : launchReadiness.styleHints,
    };
    const useBangerWord = wantsVivyNossenBangerWord(launchReadiness.source);
    const productionLabel = useBangerWord ? "NOSSEN Banger" : "NOSSEN";
    const apiFiles = filesForMessage.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      url: file.url || file.downloadUrl,
      downloadUrl: file.downloadUrl,
      description: file.description,
      textPreview: file.textPreview,
      visualDescription: file.visualDescription,
      analysisSummary: file.analysisSummary,
      analysis: file.analysis,
      uploaded: file.uploaded,
    }));
    const productionHistory: VivyStudioProductionInput["history"] = [];

    setDraft("");
    setAttachedFiles([]);
    setIsSending(true);
    setStatus(`${productionLabel}: Vivy écrit les paroles...`);

    try {
      const sunoSessionKey = readVivySessionSunoKey();
      const activeSessionName = getActiveSessionName(activeChatSessionId);
      const vivyLanguage = normalizeA11LanguageCode(getAuthAccountLanguage(localStorage.getItem("a11:language") || "fr"));
      if (songWorkspace.castingAuto && launchReadiness.source.trim()) {
        setStatus(`${productionLabel}: routage du canevas...`);
        const routingPlan = await routeVivyNossenComposition({
          canvas: launchReadiness.source,
          notes: useCompositionWorkspace ? songWorkspace.notes || undefined : undefined,
          songText: useCompositionWorkspace ? songWorkspace.canvas || undefined : undefined,
          sessionId: activeChatSessionId,
          conversationId,
        });
        artists = normalizeVivyStudioArtists(routingPlan.artists, inferredArtists);
        castLabel = describeVivyNossenBangerCast(artists);
        routedMood = useCompositionWorkspace
          ? songWorkspace.notes.trim() || routingPlan.songMood
          : routingPlan.songMood;
        routedReadiness = {
          ...launchReadiness,
          styleHints: routedMood ? [routedMood] : launchReadiness.styleHints,
        };
        setStatus(`${productionLabel}: ${castLabel}, paroles en cours...`);
      }
      const lyricsPayload = await chatWithVivy({
        mode: "song",
        language: vivyLanguage,
        conversationId,
        sessionId: activeChatSessionId,
        sessionName: activeSessionName,
        files: apiFiles,
        history: productionHistory,
        message: buildVivyNossenLyricsRequest(routedReadiness, artists),
        songText: launchReadiness.source,
        songMood: routedMood || undefined,
        songArtists: artists,
        artistCount: artists.length,
        singerCount: artists.length,
        vocalCast: castLabel,
        workspace: useCompositionWorkspace ? {
          canvas: songWorkspace.canvas,
          notes: songWorkspace.notes,
          sessionId: activeChatSessionId,
          sessionName: activeSessionName,
          conversationId,
        } : undefined,
        useWorkspaceForSong: useCompositionWorkspace,
        disableSongcraftFallback: true,
      });
      const vocalLyricsForProduction = sanitizeVivyNossenSongSeed(toUnicodeText(
        lyricsPayload.vocalLyrics || lyricsPayload.publicLyrics || "",
        VIVY_STUDIO_SONG_MAX_CHARS
      ));
      const publicLyricsForChat = sanitizeVivyNossenSongSeed(toUnicodeText(
        lyricsPayload.publicLyrics || vocalLyricsForProduction,
        VIVY_STUDIO_SONG_MAX_CHARS
      ));
      if (!isValidVivyNossenSongSeed(vocalLyricsForProduction)) throw new Error("paroles_vivy_invalides");
      const productionBrief = buildVivyNossenBangerProductionBrief(routedReadiness, artists);
      const requestedSonicMood = routedMood || inferVivyNossenSonicMood(routedReadiness, artists);
      const songMood = requestedSonicMood || undefined;
      setStatus(`${productionLabel}: paroles prêtes, Suno démarre...`);
      const waitForNossenSunoJob = async (safeTaskId: string, label = "Suno") => {
        const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        let lastJob: any = null;
        for (let attempt = 1; attempt <= 60; attempt += 1) {
          await pause(attempt <= 3 ? 6000 : 10000);
          let job: any;
          try {
            job = await getVivyStudioMusicJob(safeTaskId, sunoSessionKey || undefined);
          } catch (error: any) {
            if (attempt < 60 && isRetryableVivyMusicJobError(error)) {
              setStatus(`${productionLabel} attend ${label}... réponse lente ${attempt}/60`);
              continue;
            }
            throw error;
          }
          lastJob = job;
          const media = getVivyProductionMediaPreview(job);
          if (media) return job;
          const state = String(job?.mediaStatus?.state || job?.musicJob?.state || (job as any)?.state || "").toLowerCase();
          if (state === "error" || state === "failed") {
            throw new Error(job?.mediaStatus?.message || job?.message || "generation_suno_echouee");
          }
          setStatus(`${productionLabel} attend ${label}... ${attempt}/60`);
        }
        throw new Error(lastJob?.mediaStatus?.message || "generation_suno_trop_longue");
      };
      const payload = await runVivyStudioProduction({
        mode: "song",
        language: vivyLanguage,
        conversationId,
        sessionId: activeChatSessionId,
        sessionName: activeSessionName,
        files: apiFiles,
        history: productionHistory,
        message: `${productionLabel}: production finale.`,
        prompt: productionBrief,
        voiceTool: voiceReferenceName
          ? `${productionLabel} - voix de référence privée: ${voiceReferenceName}`
          : `${productionLabel} - casting officiel ${castLabel}`,
        voiceReferenceName: voiceReferenceName || undefined,
        songSource: `${productionLabel} - seed de paroles propre`,
        songArtists: artists,
        artistCount: artists.length,
        singerCount: artists.length,
        vocalCast: castLabel,
        songMood,
        lyrics: vocalLyricsForProduction,
        songText: vocalLyricsForProduction,
        sessionSunoApiKey: sunoSessionKey || undefined,
        forceRealMusic: true,
        generateMusic: true,
        makeSong: true,
        preserveSelectedVoice: true,
        allowExternalVoiceMix: false,
        previewInstrumental: true,
        disableEmergencyMedia: true,
        musicProvider: "suno",
        musicModel: VIVY_NOSSEN_SUNO_LONG_MODEL,
        longSong: true,
        targetDurationSeconds: VIVY_NOSSEN_SUNO_TARGET_SECONDS,
      });

      let finalPayload: any = payload;
      let preparedMedia = getVivyProductionMediaPreview(finalPayload);
      const taskId = String(payload?.mediaStatus?.taskId || payload?.musicJob?.taskId || payload?.media?.taskId || "").trim();
      if (!preparedMedia && taskId) {
        finalPayload = await waitForNossenSunoJob(taskId, "Suno");
        preparedMedia = getVivyProductionMediaPreview(finalPayload);
      }
      if (!preparedMedia) {
        throw new Error(finalPayload?.mediaStatus?.message || finalPayload?.mediaStatus?.reason || "audio_url_missing");
      }

      let sunoExtended = false;
      if (preparedMedia.kind === "audio") {
        let durationSeconds = getVivyProductionDurationSeconds(finalPayload, preparedMedia);
        for (let extensionIndex = 1; extensionIndex <= VIVY_NOSSEN_SUNO_MAX_EXTENSIONS; extensionIndex += 1) {
          const sunoAudioId = getVivyProductionSunoAudioId(finalPayload, preparedMedia);
          if (!(durationSeconds > 0 && durationSeconds < VIVY_NOSSEN_SUNO_TARGET_SECONDS && sunoAudioId)) break;
          try {
            setStatus(`${productionLabel}: ${Math.round(durationSeconds)}s, extension Suno ${extensionIndex}/${VIVY_NOSSEN_SUNO_MAX_EXTENSIONS} vers 5 min...`);
            const extensionStart = await extendVivyStudioSunoMusic({
              audioId: sunoAudioId,
              model: getVivyProductionSunoModel(finalPayload, preparedMedia) || undefined,
              sourceTaskId: taskId || preparedMedia.taskId || undefined,
              sessionSunoApiKey: sunoSessionKey || undefined,
            });
            let extendedPayload: any = extensionStart;
            let extendedMedia = getVivyProductionMediaPreview(extendedPayload, preparedMedia.filename || "vivy-nossen-extended.mp3");
            const extensionTaskId = String(
              extensionStart?.mediaStatus?.taskId
              || extensionStart?.musicJob?.taskId
              || extensionStart?.media?.taskId
              || ""
            ).trim();
            if (!extendedMedia && extensionTaskId) {
              extendedPayload = await waitForNossenSunoJob(extensionTaskId, "l'extension Suno");
              extendedMedia = getVivyProductionMediaPreview(extendedPayload, preparedMedia.filename || "vivy-nossen-extended.mp3");
            }
            if (extendedMedia?.url) {
              finalPayload = {
                ...extendedPayload,
                publicLyrics: finalPayload?.publicLyrics,
                vocalLyrics: finalPayload?.vocalLyrics,
                summary: finalPayload?.summary,
              };
              preparedMedia = extendedMedia;
              sunoExtended = true;
              durationSeconds = getVivyProductionDurationSeconds(finalPayload, preparedMedia);
              if (!(durationSeconds > 0)) break;
            }
          } catch {
            setStatus(`${productionLabel}: extension indisponible, je garde la prise Suno originale.`);
            break;
          }
        }
        const finalDurationSeconds = getVivyProductionDurationSeconds(finalPayload, preparedMedia);
        if (finalDurationSeconds > 0 && finalDurationSeconds < VIVY_NOSSEN_SUNO_MIN_ACCEPTABLE_SECONDS) {
          throw new Error(`generation_suno_trop_courte_${Math.round(finalDurationSeconds)}s`);
        }
      }

      let d40Applied = false;
      if (preparedMedia.kind === "audio") {
        try {
          setStatus(sunoExtended ? "Finalisation audio après extension..." : "Finalisation audio...");
          const sourceUrl = preparedMedia.downloadUrl || preparedMedia.url;
          let response: Response;
          try {
            response = await fetch(sourceUrl, { credentials: "include" });
            if (!response.ok) throw new Error(`status_${response.status}`);
          } catch {
            response = await fetch(sourceUrl, { credentials: "omit" });
            if (!response.ok) throw new Error(`status_${response.status}`);
          }
          const blob = await response.blob();
          const fallbackAudioName = useBangerWord ? "vivy-banger-nossen.mp3" : "vivy-nossen.mp3";
          const sourceName = sanitizeMediaDisplayName(preparedMedia.filename || fallbackAudioName) || fallbackAudioName;
          const sourceFile = new File([blob], sourceName, { type: blob.type || preparedMedia.contentType || "audio/mpeg" });
          const d40 = await processDoubleHarmonicAudio(sourceFile, {
            profile: "blend",
            intensity: D40_V8_DEFAULT_INTENSITY,
            format: "mp3",
            name: sourceName,
            mode: "v9turbo",
          });
          const d40Url = String(d40.shareUrl || d40.audioUrl || "").trim();
          if (d40Url) {
            const d40DownloadUrl = String(d40.audioUrl || d40.shareUrl || "").trim();
            preparedMedia = {
              kind: "audio",
              url: resolveApiAssetUrl(d40Url) || d40Url,
              downloadUrl: resolveApiAssetUrl(d40DownloadUrl) || d40DownloadUrl || resolveApiAssetUrl(d40Url) || d40Url,
              provider: "funesterie-d40-v9turbo",
              contentType: String(d40.contentType || "audio/mpeg"),
              filename: String(d40.filename || sourceName.replace(/\.[^.]+$/, "-d40-v9.mp3")),
            };
            d40Applied = true;
          }
        } catch (error: any) {
          setStatus(`${productionLabel} prêt; mix final à relancer dans le Studio: ${error?.message || error}`);
        }
      }

      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-nossen-assistant-${Date.now()}`,
        role: "assistant",
        content: buildVivyNossenBangerAssistantText(finalPayload, preparedMedia, artists, d40Applied, publicLyricsForChat || vocalLyricsForProduction),
        ts: new Date().toISOString(),
        media: preparedMedia,
      };
      setMessages((current) => [...current, assistantMessage].slice(-36));
      void appendVivyChatSessionMessageOnServer({
        id: assistantMessage.id,
        sessionId: activeChatSessionId,
        sessionName: activeSessionName,
        conversationId,
        role: "assistant",
        content: assistantMessage.content,
        media: preparedMedia,
        mode: "song",
      }).catch(() => {});
      setStatus(d40Applied ? `${productionLabel} prêt avec mix final.` : `${productionLabel} prêt.`);
    } catch (error: any) {
      const rawErrorMessage = String(error?.message || error || "").trim();
      const shortSunoMatch = rawErrorMessage.match(/^generation_suno_trop_courte_(\d+)s$/);
      const publicErrorMessage = shortSunoMatch
        ? `Suno a rendu ${shortSunoMatch[1]}s après les essais d'extension; je refuse de sortir un mix final NOSSEN trop court. Relance avec la même matière ou ajoute une consigne de style plus précise.`
        : rawErrorMessage || "erreur inconnue";
      const assistantMessage: VivyPublicChatMessage = {
        id: `vivy-nossen-error-${Date.now()}`,
        role: "assistant",
        content: `${productionLabel} stoppé: ${publicErrorMessage}`,
        ts: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage].slice(-36));
      setStatus(`${productionLabel} à relancer`);
    } finally {
      setIsSending(false);
    }
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
      setMessages((current) => [...current, assistantMessage].slice(-36));
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
      const isImage = isVivyImageFile(file);
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
          storagePreference: isImage ? "server-local" : "session-drive",
          preferExternalStorage: !isImage,
        });
        const resource = upload.conversationResource || upload.file || null;
        const analysis = upload.analysis || (resource as any)?.metadata?.analysis || null;
        const analysisSummary = describeVivyUploadAnalysis(analysis);
        nextFiles.push({
          ...baseFile,
          id: String(resource?.id || resource?.storageKey || baseFile.id),
          url: resource?.url,
          downloadUrl: resource?.downloadUrl || resource?.url,
          contentType: resource?.contentType || baseFile.contentType,
          sizeBytes: resource?.sizeBytes || baseFile.sizeBytes,
          description: analysisSummary || (isImage ? "Image stockée pour analyse visuelle A11." : baseFile.description),
          textPreview: textPreview || (analysis?.preview ? toUnicodeText(analysis.preview, 6000) : baseFile.textPreview),
          visualDescription: analysisSummary,
          analysisSummary,
          analysis,
          uploaded: true,
          uploadState: "stored",
          storageBackend: (upload as any)?.storageBackend || (resource as any)?.storageBackend || (isImage ? "server-local" : "session-drive"),
        });
      } catch (error: any) {
        const errorCode = String(error?.payload?.error || error?.code || "").trim();
        const targets = Array.isArray(error?.payload?.storageTargets) ? error.payload.storageTargets : [];
        const linkedTargets = targets
          .filter((target: any) => target?.linked)
          .map((target: any) => String(target?.label || target?.destination || target?.provider || "").trim())
          .filter(Boolean);
        const description = isImage
          ? `Image gardée localement dans le navigateur; upload A11 indisponible.${error?.message ? ` (${error.message})` : ""}`
          : errorCode === "session_drive_writer_missing"
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

  async function resetChat() {
    if (!hasSession) {
      setMessages([buildVivyLockedMessage()]);
      setStatus("Connexion requise pour utiliser Vivy.");
      return;
    }
    // Vider le localStorage pour cette session
    try { globalThis.localStorage?.removeItem(getVivyChatStorageKeyForSession(activeChatSessionId)); } catch { }
    const next = [buildVivyGreeting()];
    setMessages(next);
    setAttachedFiles([]);
    // Effacer aussi la memoire episodique backend
    try {
      const result = await clearVivyMemory(conversationId);
      setStatus(`Conversation et mémoire remises à zéro (${result.cleared} épisode(s) effacé(s)).`);
    } catch {
      setStatus("Conversation locale remise à zéro. Mémoire backend inchangée.");
    }
    try { globalThis.localStorage?.removeItem(getVivyConversationStorageKey(activeChatSessionId)); } catch { }
    setConversationId(readOrCreateVivyConversationId(activeChatSessionId));
  }

  return (
    <section ref={chatRootRef} className="vivy-chat" id="vivy-chat" aria-label="Chat Vivy">
      <div className="vivy-chat-head">
        <div>
          <h2>Parler à Vivy</h2>
          <p>Voix, chanson, ambiance ou scène: Vivy transforme l'idée en direction exploitable.</p>
        </div>
        <div className="vivy-chat-sessions">
          <div className="vivy-chat-session-list" role="tablist" aria-label="Sessions Vivy">
            <button
              type="button"
              className={`vivy-chat-session-tab${activeChatSessionId === "default" ? " is-active" : ""}`}
              onClick={() => switchSession("default")}
              disabled={!hasSession}
              aria-selected={activeChatSessionId === "default"}
            >
              Principale
            </button>
            {chatSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`vivy-chat-session-tab${activeChatSessionId === s.id ? " is-active" : ""}`}
                onClick={() => switchSession(s.id)}
                disabled={!hasSession}
                aria-selected={activeChatSessionId === s.id}
                title={s.name}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="vivy-chat-session-actions">
            <button type="button" onClick={addSession} disabled={!hasSession} title="Nouvelle session">+</button>
            {activeChatSessionId !== "default" && (
              <button type="button" onClick={deleteCurrentSession} disabled={!hasSession} title="Supprimer cette session">x</button>
            )}
            <button type="button" onClick={resetChat} disabled={!hasSession}>Réinit.</button>
          </div>
        </div>
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
            {message.media ? (
              <div className="vivy-chat-media-link">
                {message.media.kind === "audio" ? (
                  <audio controls preload="metadata" src={message.media.url} />
                ) : null}
                {message.media.kind === "video" ? (
                  <video controls preload="metadata" src={message.media.url} />
                ) : null}
                <a
                  href={message.media.downloadUrl || message.media.url}
                  download={message.media.filename || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Télécharger la musique
                </a>
              </div>
            ) : null}
            <button
              type="button"
              className="vivy-chat-copy-btn"
              onClick={() => {
                void writeClipboardText(message.content).then(() => {
                  setCopiedMsgId(message.id);
                  setTimeout(() => setCopiedMsgId((current) => current === message.id ? "" : current), 2000);
                }).catch(() => setStatus("Copie impossible dans ce navigateur."));
              }}
              title="Copier ce message"
            >
              {copiedMsgId === message.id ? "Copié" : "Copier"}
            </button>
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

      <form ref={composeRef} className="vivy-chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage({ mode: "chat" }); }}>
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
          <button type="button" disabled={!hasSession} onClick={() => sendModeFromComposer("voice")}>Voix</button>
          <button type="button" disabled={!hasSession} onClick={() => sendModeFromComposer("song")}>Chanson</button>
          <button type="button" disabled={!hasSession} onClick={() => sendModeFromComposer("share")}>Scène</button>
          <button
            type="button"
            className={`vivy-nossen-banger-button${nossenBangerCanLaunch ? " is-ready" : ""}${isSending ? " is-running" : ""}`}
            disabled={!hasSession || isSending}
            onClick={() => void launchNossenBanger()}
            aria-label="NOSSEN Banger"
            aria-pressed={nossenBangerCanLaunch}
            title={nossenBangerReadiness.ready ? nossenBangerReadiness.reason : "NOSSEN peut partir maintenant; Vivy écrira d'abord les paroles avec le contexte disponible."}
          >
            <span className="vivy-nossen-flames" aria-hidden="true">
              <span className="vivy-nossen-flame-tongue is-left" />
              <span className="vivy-nossen-flame-tongue is-center" />
              <span className="vivy-nossen-flame-tongue is-right" />
            </span>
            <span className="vivy-nossen-button-label">NOSSEN</span>
          </button>
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

function VivyPublicSurface({ hasSession, diagnosticsAllowed = false }: VivySessionProps) {
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
      <VivyStudioLab hasSession={hasSession} diagnosticsAllowed={diagnosticsAllowed} />
    </>
  );
}

type VivyPublicPageProps = {
  authenticated: boolean;
  displayName: string;
  diagnosticsAllowed?: boolean;
};

// CANONICAL React Vivy shell. Static production copy lives in public/vivy/index.html;
// keep both aligned for session/logout behavior and never rely on localStorage alone.
function VivyPublicPage({ authenticated, displayName, diagnosticsAllowed = false }: VivyPublicPageProps) {
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
  const [vivyMenuLanguage, setVivyMenuLanguage] = useState<A11LanguageCode>(() => {
    try {
      return normalizeA11LanguageCode(getAuthAccountLanguage(localStorage.getItem("a11:language") || "fr"));
    } catch {
      return "fr";
    }
  });

  useEffect(() => {
    const nextHasSession = authenticated || hasVivyAuthenticatedSession();
    setVivyHasSession(nextHasSession);
    setVivyDisplayName(nextHasSession ? (displayName || getAuthDisplayName() || "Utilisateur") : "Connexion requise");
    if (nextHasSession) setVivyMenuLanguage(normalizeA11LanguageCode(getAuthAccountLanguage("fr")));
  }, [authenticated, displayName]);

  useEffect(() => {
    try {
      localStorage.setItem("a11:language", vivyMenuLanguage);
      document.documentElement.lang = A11_LANGUAGE_CHOICES.find((choice) => choice.code === vivyMenuLanguage)?.speechLang || "fr-FR";
      translateLegacyStaticUi(document.getElementById("root") || document.body, vivyMenuLanguage);
      translateLegacyStaticDocumentTitle(vivyMenuLanguage);
    } catch {
      // ignore storage/document access issues
    }
  }, [vivyMenuLanguage]);

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
          <a className="vivy-agent-home" href={surfaceLinks.home}>
            Accueil
          </a>
          <a className="vivy-agent-discussion" href="#vivy-chat">
            Discussion
          </a>
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
                  value={vivyMenuLanguage}
                  onChange={(event) => setVivyMenuLanguage(normalizeA11LanguageCode(event.target.value))}
                >
                  {A11_LANGUAGE_CHOICES.map((choice) => (
                    <option key={choice.code} value={choice.code}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </section>
              <section className="vivy-agent-menu-section" aria-label="Agents">
                <p className="vivy-agent-menu-title">Agents</p>
                <div className="vivy-agent-menu-grid">
                  <a className="vivy-agent-menu-card" href={buildSessionBridgeUrl(surfaceLinks.kaen44Cockpit)}>
                    <img src={KAEN44_AVATAR_SRC} alt="" />
                    <span>
                      <strong>K44</strong>
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
              <section className="vivy-agent-menu-section" aria-label="Légal">
                <p className="vivy-agent-menu-title">Légal</p>
                <a className="vivy-agent-menu-row" href={surfaceLinks.vivyPrivacy}>
                  <span>Confidentialité</span>
                  <span>Vie privée</span>
                </a>
                <a className="vivy-agent-menu-row" href={surfaceLinks.vivyTerms}>
                  <span>Conditions</span>
                  <span>Utilisation</span>
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
      <VivyPublicSurface hasSession={vivyHasSession} diagnosticsAllowed={diagnosticsAllowed} />
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
      name: "K44",
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
    name: "K44",
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
    signal: "A11 ref.wav",
    detail: "Analyse, cadrage, vidéo, synthèse et réponse posée.",
    sample: "A11 en ligne. Je garde le cap: analyse propre, action courte, résultat vérifiable.",
    image: NOSSEN_A11_DERBI_SRC,
    tone: "blue",
    voiceStyle: "a11-official-stern-french",
  },
  {
    id: "kaen44",
    name: "K44",
    role: "Voix bureau, vive, copilote quotidien",
    signal: "K44 Ref.wav",
    detail: "Priorités, documents, organisation et retour au calme.",
    sample: "K44 prête. On range le chaos, on choisit la prochaine action, et on avance.",
    image: NOSSEN_K44_TZR_SRC,
    tone: "violet",
    voiceStyle: "kaen44-official-french-narrator",
  },
  {
    id: "vivy",
    name: "Vivy",
    role: "Voix musicale, sensible, scène créative",
    signal: "Vivy ref.wav",
    detail: "Chansons, ambiance, voix, harmonies et présence de scène.",
    sample: "Je suis Vivy. Donne-moi une émotion, je la transforme en scène, en voix, en lumière.",
    image: NOSSEN_VIVY_BOOSTER_SRC,
    tone: "pink",
    voiceStyle: "vivy-official-french-conversational",
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
    log: "Vivy cadence, K44 synchronise, A11 verrouille le timing.",
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

type NossenFeaturedModule = {
  id: string;
  name: string;
  family: string;
  status: string;
  summary: string;
  proof: string[];
  href: string;
};

const NOSSEN_FEATURED_MODULES = [
  {
    id: "bat",
    name: "@nossen/bat",
    family: "Réactivité locale",
    status: "Claude review follow-up",
    summary: "Module BAT durci après revue Claude: attente par promesse, mesures RTT réelles et concurrence bornée.",
    proof: ["wait queue sans spin 10 ms", "RTT succès/échec mesuré", "maxConcurrency clampé"],
    href: buildNpmPackageUrl("@nossen/bat"),
  },
  {
    id: "bat-system",
    name: "@nossen/bat-system",
    family: "Coordination runtime",
    status: "Claude review follow-up",
    summary: "Couche système BAT nettoyée: profils d'aile plus stables, branche remote simplifiée et hormones qui décroissent quand le stress est relu.",
    proof: ["wing heal vers baseline", "remote branch dédupliquée", "hormones decay sur lecture stress"],
    href: buildNpmPackageUrl("@nossen/bat-system"),
  },
  {
    id: "a11-director",
    name: "A11 Director",
    family: "Pré-planner vidéo",
    status: "Prod 20260616-034716",
    summary: "Module Director branché avant la génération vidéo: object cards, spatial locks, reference board et vérification positive-first.",
    proof: ["cas 50cc OKO/Metrakit couvert", "radiateurs latéraux verrouillés", "radiateur frontal rejeté"],
    href: "https://github.com/Funesterie/alphaonze/blob/master/docs/superpowers/specs/a11-director-clip-director.md",
  },
] as const satisfies ReadonlyArray<NossenFeaturedModule>;

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
  { id: "nossenBat", label: "@nossen/bat", kind: "module", x: 1060, y: 310 },
  { id: "a11Director", label: "A11 Director", kind: "module", x: 1035, y: 390 },
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
  { from: "nossenBat", to: "mcp", label: "réactivité", kind: "runtime" },
  { from: "a11Director", to: "a11", label: "pré-plan", kind: "data" },
  { from: "qflush", to: "k44", label: "contrôle", kind: "runtime" },
  { from: "allInOne", to: "agents", label: "agrège", kind: "runtime" },
  { from: "github", to: "nossenBus", label: "source", kind: "publish" },
  { from: "github", to: "nossenMemory", label: "source", kind: "publish" },
  { from: "github", to: "nossenSecurity", label: "source", kind: "publish" },
  { from: "github", to: "nossenBat", label: "source", kind: "publish" },
  { from: "github", to: "a11Director", label: "source", kind: "publish" },
  { from: "npm", to: "nossenBus", label: "publie", kind: "publish" },
  { from: "npm", to: "nossenMemory", label: "publie", kind: "publish" },
  { from: "npm", to: "nossenSecurity", label: "publie", kind: "publish" },
  { from: "npm", to: "nossenBat", label: "publie", kind: "publish" },
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
        alt="Nossen Ride Crew avec Vivy, K44 et A11."
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    </section>
  );
}

const VIVY_STUDIO_VALID_VOICE_TOOLS = [
  "Voix Vivy officielle",
  "Voix Vivy chant",
  "Voix Djeff officielle",
  "Voix A11 officielle",
  "Voix K44 officielle",
  "Duo Djeff + Vivy",
  "Voix Vivy + référence privée",
  "Voix catalogue premium",
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
  const [voiceStatus, setVoiceStatus] = useState("Voix officielles prêtes: A11, K44, Vivy.");
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
        voiceReferenceRequired: false,
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
        <h2>A11, K44 et Vivy parlent avec leur identité.</h2>
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
  { id: "kaen44", label: "K44", detail: "Agent bureau", url: "https://k44.funesterie.me/health" },
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
  const [privateResult, setPrivateResult] = useState("En attente de vérification MCP.");
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
      setPrivateResult("MCP public vérifiable. Le contrôle privé reste réservé aux comptes autorisés.");
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
            <span>MCP</span>
          </header>
          <p>Contrôle du statut MCP et des droits associés au compte connecté.</p>
          <footer>
            <button type="button" onClick={() => void testPrivateMcp()} disabled={busy === "mcp"}>
              {busy === "mcp" ? "Vérification..." : "Vérifier MCP"}
            </button>
          </footer>
        </article>
      </div>

      <div className="fun-mcp-console">
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
          ["K44", "Agent bureau accessible depuis sa route dédiée."],
          ["Vivy", "Présence musicale accessible depuis sa route dédiée."],
        ] as const,
      }
      : {
        brand: "Funesterie",
        title: "Funesterie",
        subtitle: "NOSSEN ride crew : créer, comprendre, connecter.",
        blocks: [
          ["Accueil", "Point d'entrée public du projet NOSSEN."],
          ["Agents", "Vivy, A11 et K44 restent visibles sans changer de charte."],
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

function FunesterieFeaturedModulesPanel() {
  return (
    <section className="fun-architecture-modules" aria-label="Modules NOSSEN retravaillés">
      <header>
        <div>
          <span>Modules retravaillés</span>
          <h2>Claude a renforcé la couche BAT, A11 Director est en prod.</h2>
        </div>
        <a href="https://www.npmjs.com/search?q=%40nossen" target="_blank" rel="noreferrer">
          Catalogue @nossen
        </a>
      </header>
      <div className="fun-architecture-module-grid">
        {NOSSEN_FEATURED_MODULES.map((module) => (
          <article key={module.id} className={`fun-architecture-module-card fun-architecture-module-card--${module.id}`}>
            <div>
              <span>{module.family}</span>
              <h3>{module.name}</h3>
              <em>{module.status}</em>
            </div>
            <p>{module.summary}</p>
            <ul>
              {module.proof.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <a href={module.href} target={module.href.startsWith("http") ? "_blank" : undefined} rel={module.href.startsWith("http") ? "noreferrer" : undefined}>
              Ouvrir
            </a>
          </article>
        ))}
      </div>
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

      <FunesterieFeaturedModulesPanel />

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
              Les accès personnels ne sont pas affichés sur la page publique.
            </p>
          </div>
          <aside>
            <strong>Privé</strong>
            <small>verrouillé</small>
          </aside>
        </header>
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
            <a href={surfaceLinks.cockpit}>Vérifier MCP</a>
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

type FunesterieAccountInventory = {
  conversations: Record<FunesterieSurface, A11HistoryItem[]>;
  files: A11UserStoredFile[];
  resources: A11ConversationResource[];
  subscription: SubscriptionStatus | null;
  mcpAccess: McpAccessCatalogResponse | null;
  accessPreferences: FunesterieAccessPreferences;
  loadedAt: string | null;
  loading: boolean;
  error: string;
};

type FunesterieAccessPreferences = Record<string, boolean>;
type FunesterieSessionAppTokenMap = Record<string, string>;

type FunesterieInventoryFileItem = {
  key: string;
  source: "resource" | "file";
  resource?: A11ConversationResource;
  file?: A11UserStoredFile;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  conversationId?: string | null;
};

type FunesterieSessionAppTokenConfig = {
  id: string;
  label: string;
  scope: string;
  placeholder: string;
  help: string;
};

const ACCOUNT_ACCESS_STORAGE_PREFIX = "funesterie:account-access:";
const FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY = "funesterie:session-app-tokens:v1";

const FUNESTERIE_SESSION_APP_TOKENS: FunesterieSessionAppTokenConfig[] = [
  {
    id: "suno",
    label: "Suno",
    scope: "Vivy chanson",
    placeholder: "Clé API Suno personnelle",
    help: "Utilisée par Vivy Studio pour générer une vraie chanson avec la clé de cette session.",
  },
  {
    id: "runcomfy",
    label: "RunComfy",
    scope: "Vidéo cloud",
    placeholder: "Clé API RunComfy",
    help: "Prévue pour les générations vidéo cloud quand le PC local n'est pas suffisant.",
  },
  {
    id: "comfy",
    label: "Comfy Cloud",
    scope: "Vidéo cloud",
    placeholder: "Clé API Comfy Cloud",
    help: "Utilisée en session pour les workflows Comfy Cloud ou un pont compatible.",
  },
  {
    id: "civitai",
    label: "Civitai",
    scope: "Modèles image",
    placeholder: "Jeton Civitai",
    help: "Prévu pour retrouver modèles, LoRA et références visuelles par session.",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    scope: "Modèles IA",
    placeholder: "Jeton Hugging Face",
    help: "Prévu pour jobs, modèles et téléchargements autorisés par le compte utilisateur.",
  },
  {
    id: "xai",
    label: "Grok / xAI",
    scope: "Vidéo Grok Imagine",
    placeholder: "Clé API xAI personnelle",
    help: "Utilisée uniquement dans cette session pour tester Grok Imagine sans consommer les crédits serveur.",
  },
  {
    id: "replicate",
    label: "Replicate",
    scope: "Vidéo/image",
    placeholder: "Jeton Replicate",
    help: "Prévu pour les pipelines image/vidéo externes quand ils sont explicitement demandés.",
  },
];

function readSessionAppTokens(): FunesterieSessionAppTokenMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [String(key), String(value || "").trim()])
        .filter(([, value]) => value)
    );
  } catch {
    return {};
  }
}

function writeSessionAppTokens(tokens: FunesterieSessionAppTokenMap) {
  if (typeof window === "undefined") return;
  try {
    const safeTokens = Object.fromEntries(
      Object.entries(tokens)
        .map(([key, value]) => [String(key), String(value || "").trim()])
        .filter(([, value]) => value)
    );
    if (Object.keys(safeTokens).length) {
      window.sessionStorage.setItem(FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY, JSON.stringify(safeTokens));
    } else {
      window.sessionStorage.removeItem(FUNESTERIE_SESSION_APP_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Session keys are optional and should never block account rendering.
  }
}

function writeSessionAppToken(id: string, value: string) {
  const safeId = String(id || "").trim();
  if (!safeId) return;
  const nextTokens = readSessionAppTokens();
  const safeValue = String(value || "").trim();
  if (safeValue) nextTokens[safeId] = safeValue;
  else delete nextTokens[safeId];
  writeSessionAppTokens(nextTokens);
}

function forgetSessionAppTokens() {
  writeSessionAppTokens({});
  try {
    globalThis.sessionStorage?.removeItem(VIVY_STUDIO_SUNO_SESSION_KEY);
  } catch {
    // Ignore session storage failures.
  }
}

function getSessionAppTokenPresence(tokens: FunesterieSessionAppTokenMap) {
  return Object.fromEntries(FUNESTERIE_SESSION_APP_TOKENS.map((token) => [token.id, Boolean(tokens[token.id])]));
}

const EMPTY_ACCOUNT_CONVERSATIONS: Record<FunesterieSurface, A11HistoryItem[]> = {
  a11: [],
  kaen44: [],
  vivy: [],
};

function getMcpAccountStorageKey(account: McpAccountProfile | null, displayName = "") {
  const identity = String(
    account?.user?.id
    || account?.user?.email
    || displayName
    || account?.tier
    || "anonymous"
  ).trim().toLowerCase();
  return `${ACCOUNT_ACCESS_STORAGE_PREFIX}${identity || "anonymous"}`;
}

function readAccessPreferences(key: string): FunesterieAccessPreferences {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as FunesterieAccessPreferences : {};
  } catch {
    return {};
  }
}

function writeAccessPreferences(key: string, preferences: FunesterieAccessPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Local settings are comfort only. Server permissions remain authoritative.
  }
}

function resetAccessPreferencesForKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore local storage failures.
  }
}

function isCapabilityEnabled(capability: McpAccessCapability, preferences: FunesterieAccessPreferences) {
  if (!capability.allowed) return false;
  if (Object.prototype.hasOwnProperty.call(preferences, capability.id)) return preferences[capability.id] === true;
  return capability.recommended !== false;
}

function formatTierPriceLabel(tier: McpAccessTierCard) {
  const monthlyEur = tier.pricing?.monthlyEur;
  if (monthlyEur == null) return tier.pricing?.publicLabel || "Interne";
  if (monthlyEur <= 0) return tier.pricing?.publicLabel || "0 EUR";
  return `${monthlyEur.toFixed(2).replace(".", ",")} EUR/mois`;
}

function formatMcpTierLabel(tier?: string) {
  const normalized = String(tier || "").trim().toLowerCase();
  if (normalized === "basic") return "Basic";
  if (normalized === "premium") return "Premium";
  if (normalized === "founder") return "Fondateur";
  if (normalized === "admin_family") return "Admin famille";
  if (normalized === "admin") return "Admin";
  return tier || "niveau supérieur";
}

function getStoredFileSize(file: A11UserStoredFile | A11ConversationResource) {
  return Number((file as A11UserStoredFile).sizeBytes ?? (file as A11UserStoredFile).size_bytes ?? (file as A11ConversationResource).sizeBytes ?? 0);
}

function formatCompactFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "taille inconnue";
  if (sizeBytes < 1024) return `${sizeBytes} o`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} Ko`;
  return `${(sizeBytes / 1024 / 1024).toFixed(sizeBytes >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function formatAccountDate(value?: string | null) {
  if (!value) return "date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date inconnue";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function getStoredFileDate(file: A11UserStoredFile | A11ConversationResource) {
  return String(
    (file as A11UserStoredFile).createdAt
    || (file as A11UserStoredFile).created_at
    || (file as A11ConversationResource).updatedAt
    || (file as A11ConversationResource).createdAt
    || ""
  );
}

function getStoredFileUrl(file: A11UserStoredFile | A11ConversationResource) {
  return String((file as A11ConversationResource).downloadUrl || (file as A11UserStoredFile).downloadUrl || (file as A11ConversationResource).url || (file as A11UserStoredFile).url || "");
}

function redactAccountInventoryText(value: unknown) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[lien masque]")
    .replace(/\b(token|access_token|refresh_token|api[_-]?key|secret|signature|sig)=([^&\s"'<>]+)/gi, "$1=[masque]")
    .replace(/\b(gsk|sk|rk|pk|hf|ghp|glpat|xox[baprs])_[A-Za-z0-9_\-]{12,}\b/g, "[secret masque]")
    .replace(/\b[A-Za-z0-9_\-]{28,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/g, "[jeton masque]")
    .trim();
}

function getInventoryMediaKind(file: A11UserStoredFile | A11ConversationResource) {
  const contentType = String((file as A11ConversationResource).contentType || (file as A11UserStoredFile).contentType || (file as A11UserStoredFile).content_type || "").toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "vidéo";
  const name = String(file.filename || "").toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|flac|aac|webm)$/.test(name)) return "audio";
  if (/\.(mp4|mov|mkv|avi|webm|m4v)$/.test(name)) return "vidéo";
  return "fichier";
}

function buildAccountInventoryFiles(files: A11UserStoredFile[], resources: A11ConversationResource[]): FunesterieInventoryFileItem[] {
  const seen = new Set<string>();
  const items: FunesterieInventoryFileItem[] = [];
  const remember = (key: string) => {
    const normalized = String(key || "").trim();
    if (!normalized) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  };

  for (const resource of resources) {
    const key = String(resource.storageKey || resource.downloadUrl || resource.url || `${resource.id || ""}:${resource.filename || ""}`).trim();
    if (!remember(key)) continue;
    items.push({
      key: `resource:${resource.id || key}`,
      source: "resource",
      resource,
      filename: redactAccountInventoryText(resource.filename || "fichier"),
      contentType: String(resource.contentType || ""),
      sizeBytes: getStoredFileSize(resource),
      createdAt: getStoredFileDate(resource),
      conversationId: resource.conversationId || null,
    });
  }

  for (const file of files) {
    const key = String(file.storageKey || file.storage_key || file.downloadUrl || file.url || `${file.id || ""}:${file.filename || ""}`).trim();
    if (!remember(key)) continue;
    items.push({
      key: `file:${file.id || key}`,
      source: "file",
      file,
      filename: redactAccountInventoryText(file.filename || "fichier"),
      contentType: String(file.contentType || file.content_type || ""),
      sizeBytes: getStoredFileSize(file),
      createdAt: getStoredFileDate(file),
      conversationId: null,
    });
  }

  return items.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function getSubscriptionAccountLabel(status: SubscriptionStatus | null, authenticated: boolean) {
  if (!authenticated) return "Connexion requise";
  const tier = String(status?.tier || status?.plan || "").toLowerCase();
  if (status?.fullAccess || tier.includes("admin")) return "Accès complet";
  if (tier.includes("founder") || tier.includes("fondateur")) return "Fondateur";
  if (status?.active || tier.includes("premium")) return "Premium actif";
  return "Sans abonnement";
}

function getSubscriptionAccountText(status: SubscriptionStatus | null, authenticated: boolean) {
  if (!authenticated) return "Connecte-toi pour voir l'état exact du compte et les moyens de paiement.";
  if (!status) return "Statut abonnement non chargé.";
  if (status.fullAccess) return "Compte autorisé en accès complet.";
  if (status.active) {
    const end = status.stripeStatus?.currentPeriodEnd || status.endDate || null;
    if (status.stripeStatus?.cancelAtPeriodEnd) {
      return end
        ? `Désabonnement programmé. Accès maintenu jusqu'au ${formatAccountDate(typeof end === "number" ? new Date(end * 1000).toISOString() : end)}.`
        : "Désabonnement programmé à la fin de la période en cours.";
    }
    return end ? `Actif jusqu'au ${formatAccountDate(typeof end === "number" ? new Date(end * 1000).toISOString() : end)}` : "Abonnement actif.";
  }
  return "Aucun abonnement actif. Premium et Fondateur passent par le paiement automatique.";
}

function downloadFunesterieJson(filename: string, payload: unknown) {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [inventory, setInventory] = useState<FunesterieAccountInventory>({
    conversations: EMPTY_ACCOUNT_CONVERSATIONS,
    files: [],
    resources: [],
    subscription: null,
    mcpAccess: null,
    accessPreferences: {},
    loadedAt: null,
    loading: false,
    error: "",
  });
  const [paymentBusy, setPaymentBusy] = useState<"" | "premium" | "founder" | "portal" | "cancel">("");
  const [inventoryDownloadBusy, setInventoryDownloadBusy] = useState("");
  const [sessionAppTokens, setSessionAppTokens] = useState<FunesterieSessionAppTokenMap>(() => readSessionAppTokens());
  const [sessionAppTokenDrafts, setSessionAppTokenDrafts] = useState<FunesterieSessionAppTokenMap>(() => readSessionAppTokens());
  const [providerHealth, setProviderHealth] = useState<ProviderHealthResponse | null>(null);
  const [providerHealthBusy, setProviderHealthBusy] = useState(false);
  const [providerHealthError, setProviderHealthError] = useState("");

  async function testProviderHealth() {
    if (!authenticated || providerHealthBusy) return;
    setProviderHealthBusy(true);
    setProviderHealthError("");
    try {
      setProviderHealth(await fetchProviderHealth(true));
    } catch (error) {
      setProviderHealthError((error as Error)?.message || "Test des fournisseurs impossible");
    } finally {
      setProviderHealthBusy(false);
    }
  }

  async function loadAccountInventory() {
    if (!authenticated) {
      setInventory({
        conversations: EMPTY_ACCOUNT_CONVERSATIONS,
        files: [],
        resources: [],
        subscription: null,
        mcpAccess: null,
        accessPreferences: {},
        loadedAt: null,
        loading: false,
        error: "",
      });
      return;
    }

    setInventory((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [
        a11History,
        kaen44History,
        vivyHistory,
        storedFiles,
        resources,
        subscription,
        mcpAccess,
      ] = await Promise.all([
        fetchA11HistoryList({ surface: "a11" }).catch(() => []),
        fetchA11HistoryList({ surface: "kaen44" }).catch(() => []),
        fetchA11HistoryList({ surface: "vivy" }).catch(() => []),
        fetchMyStoredFiles({ limit: 100 }).catch(() => ({ ok: false, files: [] })),
        fetchMyConversationResources({ limit: 100 }).catch(() => ({ ok: false, resources: [] })),
        getSubscriptionStatus().catch(() => null),
        fetchMcpAccessCatalog().catch(() => null),
      ]);

      const accessStorageKey = getMcpAccountStorageKey(mcpAccess?.account || null, displayName);
      setInventory({
        conversations: {
          a11: Array.isArray(a11History) ? a11History : [],
          kaen44: Array.isArray(kaen44History) ? kaen44History : [],
          vivy: Array.isArray(vivyHistory) ? vivyHistory : [],
        },
        files: Array.isArray(storedFiles.files) ? storedFiles.files : [],
        resources: Array.isArray(resources.resources) ? resources.resources : [],
        subscription,
        mcpAccess,
        accessPreferences: readAccessPreferences(accessStorageKey),
        loadedAt: new Date().toISOString(),
        loading: false,
        error: "",
      });
    } catch (error) {
      setInventory((current) => ({
        ...current,
        loading: false,
        error: (error as Error).message || "Inventaire indisponible",
      }));
    }
  }

  useEffect(() => {
    loadAccountInventory();
  }, [authenticated]);

  const conversationTotal = Object.values(inventory.conversations).reduce((sum, entries) => sum + entries.length, 0);
  const messageTotal = Object.values(inventory.conversations).reduce((sum, entries) => (
    sum + entries.reduce((inner, entry) => inner + Number(entry.messageCount || 0), 0)
  ), 0);
  const inventoryFiles = useMemo(
    () => buildAccountInventoryFiles(inventory.files, inventory.resources),
    [inventory.files, inventory.resources]
  );
  const conversationRecap = useMemo(() => FUNESTERIE_CHAT_SURFACES.flatMap((surface) => (
    (inventory.conversations[surface] || []).map((entry) => ({
      surface,
      label: FUNESTERIE_SURFACE_LABELS[surface],
      id: redactAccountInventoryText(entry.id),
      name: redactAccountInventoryText(entry.name || "Conversation"),
      updated: entry.updated || "",
      messageCount: Number(entry.messageCount || 0),
    }))
  )).sort((left, right) => String(right.updated || "").localeCompare(String(left.updated || ""))), [inventory.conversations]);
  const subscriptionLabel = getSubscriptionAccountLabel(inventory.subscription, authenticated);
  const subscriptionText = getSubscriptionAccountText(inventory.subscription, authenticated);
  const accessAccount = inventory.mcpAccess?.account || null;
  const accessCapabilities = inventory.mcpAccess?.catalog?.capabilities || [];
  const accessTiers = inventory.mcpAccess?.catalog?.tiers || [];
  const accessStorageKey = getMcpAccountStorageKey(accessAccount, displayName);
  const allowedAccessCount = accessCapabilities.filter((capability) => capability.allowed).length;
  const enabledAccessCount = accessCapabilities.filter((capability) => isCapabilityEnabled(capability, inventory.accessPreferences)).length;
  const lockedAccessCount = Math.max(0, accessCapabilities.length - allowedAccessCount);

  function exportAccountInventory() {
    const today = new Date().toISOString().slice(0, 10);
    downloadFunesterieJson(`funesterie-recap-conversations-${today}.json`, {
      exportedAt: new Date().toISOString(),
      compte: {
        nom: redactAccountInventoryText(displayName || "Compte Funesterie"),
        connecte: authenticated,
      },
      conversations: {
        total: conversationTotal,
        messages: messageTotal,
        parAgent: Object.fromEntries(FUNESTERIE_CHAT_SURFACES.map((surface) => [
          FUNESTERIE_SURFACE_LABELS[surface],
          inventory.conversations[surface].length,
        ])),
        recap: conversationRecap.map((entry) => ({
          agent: entry.label,
          titre: entry.name,
          messages: entry.messageCount,
          derniereMiseAJour: entry.updated || null,
          conversationId: entry.id || null,
        })),
      },
      mediasEtFichiers: {
        total: inventoryFiles.length,
        items: inventoryFiles.map((item) => ({
          type: getInventoryMediaKind(item.resource || item.file || ({ filename: item.filename } as A11ConversationResource)),
          source: item.source === "resource" ? "conversation" : "compte",
          nom: item.filename,
          taille: item.sizeBytes || null,
          contentType: item.contentType || null,
          date: item.createdAt || null,
          conversationId: item.conversationId ? redactAccountInventoryText(item.conversationId) : null,
        })),
      },
      note: "Export recapitulatif sans jeton, sans URL signee et sans cle technique.",
    });
  }

  async function downloadInventoryFile(item: FunesterieInventoryFileItem) {
    const busyKey = item.key;
    setInventoryDownloadBusy(busyKey);
    try {
      const result = item.source === "resource" && item.resource
        ? await downloadConversationResource(item.resource)
        : item.file
          ? await downloadStoredAccountFile(item.file)
          : null;
      if (!result) return;
      setInventory((current) => ({
        ...current,
        error: `Téléchargement lancé: ${redactAccountInventoryText(result.filename)}`,
      }));
    } catch (error) {
      setInventory((current) => ({
        ...current,
        error: (error as Error).message || "Téléchargement impossible",
      }));
    } finally {
      setInventoryDownloadBusy("");
    }
  }

  async function downloadInventoryArchive() {
    setInventoryDownloadBusy("zip");
    try {
      const result = await downloadAccountInventoryZip();
      setInventory((current) => ({
        ...current,
        error: `Archive lancée: ${redactAccountInventoryText(result.filename)}`,
      }));
    } catch (error) {
      setInventory((current) => ({
        ...current,
        error: (error as Error).message || "Archive ZIP indisponible",
      }));
    } finally {
      setInventoryDownloadBusy("");
    }
  }

  function toggleAccessCapability(id: string, enabled: boolean) {
    setInventory((current) => {
      const nextPreferences = { ...current.accessPreferences, [id]: enabled };
      writeAccessPreferences(accessStorageKey, nextPreferences);
      return { ...current, accessPreferences: nextPreferences };
    });
  }

  function resetAccessPreferences() {
    resetAccessPreferencesForKey(accessStorageKey);
    setInventory((current) => ({ ...current, accessPreferences: {} }));
  }

  function updateSessionAppTokenDraft(id: string, value: string) {
    setSessionAppTokenDrafts((current) => ({ ...current, [id]: value }));
  }

  function saveSessionAppToken(id: string) {
    const safeValue = String(sessionAppTokenDrafts[id] || "").trim();
    writeSessionAppToken(id, safeValue);
    if (id === "suno") writeVivySessionSunoKey(safeValue);
    const nextTokens = readSessionAppTokens();
    setSessionAppTokens(nextTokens);
    setSessionAppTokenDrafts(nextTokens);
  }

  function forgetSessionAppToken(id: string) {
    writeSessionAppToken(id, "");
    if (id === "suno") writeVivySessionSunoKey("");
    const nextTokens = readSessionAppTokens();
    setSessionAppTokens(nextTokens);
    setSessionAppTokenDrafts(nextTokens);
  }

  function forgetAllSessionAppTokens() {
    forgetSessionAppTokens();
    setSessionAppTokens({});
    setSessionAppTokenDrafts({});
  }

  async function openPayment(plan: "premium" | "founder" | "portal" = "premium") {
    if (!authenticated) {
      if (typeof window !== "undefined") window.location.assign(buildCentralLoginUrl(surfaceLinks.account));
      return;
    }

    setPaymentBusy(plan);
    try {
      if (plan === "portal" || inventory.subscription?.active) {
        const data = await createCustomerPortal();
        if (data.url) window.location.href = data.url;
        return;
      }

      const data = await createCheckoutSession(plan);
      if (data.url) window.location.href = data.url;
    } catch {
      if (typeof window !== "undefined") {
        const target = surfaceLinks.account.includes("#") ? surfaceLinks.account : `${surfaceLinks.account}#paiements`;
        window.location.assign(target);
      }
    } finally {
      setPaymentBusy("");
    }
  };

  async function cancelAccountSubscription() {
    if (!authenticated) {
      if (typeof window !== "undefined") window.location.assign(buildCentralLoginUrl(surfaceLinks.account));
      return;
    }

    if (!window.confirm("Programmer le désabonnement à la fin de la période déjà payée ?")) return;
    setPaymentBusy("cancel");
    try {
      await cancelSubscription();
      await loadAccountInventory();
    } catch (error) {
      setInventory((current) => ({
        ...current,
        error: (error as Error).message || "Désabonnement indisponible",
      }));
    } finally {
      setPaymentBusy("");
    }
  }

  return (
    <main id="top" className="fun-home-shell fun-public-surface fun-account-shell" aria-label="Compte Funesterie">
      <FunesteriePublicNav surfaceLinks={surfaceLinks} brandLabel="Compte" />
      <section className="fun-account-panel" aria-label="Réglages compte Funesterie">
        <img src={FUNESTERIE_LOGO_SRC} alt="Funesterie" />
        <div className="fun-account-copy">
          <h1>Compte</h1>
          <p>{authenticated ? (displayName || "Compte connecté") : "Connecte-toi pour gérer ton compte Funesterie."}</p>
        </div>
      </section>

      <section id="paiements" className="fun-token-panel" aria-label="Actions compte">
        <header className="fun-token-head">
          <div>
            <span>Réglages</span>
            <h2>Accès et données</h2>
            <p>Inventaire récupérable du compte, des discussions, médias et fichiers liés à ta session.</p>
          </div>
          <aside>
            <strong>{inventory.loading ? "Synchro" : (authenticated ? "Privé" : "Public")}</strong>
            <small>{inventory.loadedAt ? `maj ${formatAccountDate(inventory.loadedAt)}` : (authenticated ? (displayName || "connecté") : "connexion requise")}</small>
          </aside>
        </header>
        {inventory.error && (
          <p className="fun-account-alert">{inventory.error}</p>
        )}
        <div className="fun-integration-grid">
          <article className="fun-token-card">
            <header>
              <h3>Connexion</h3>
              <span>Compte</span>
            </header>
            <p>Connexion Funesterie centrale pour A11, K44 et Vivy.</p>
            <footer>
              {authenticated ? (
                <button type="button" onClick={onLogout}>Se déconnecter</button>
              ) : (
                <a href={buildCentralLoginUrl(surfaceLinks.account)}>Se connecter</a>
              )}
            </footer>
          </article>
          <article className="fun-token-card fun-token-card--conversation-recap">
            <header>
              <h3>Conversations</h3>
              <span>Récap</span>
            </header>
            <p>
              {conversationTotal} conversation{conversationTotal > 1 ? "s" : ""} serveur,
              {messageTotal ? ` ${messageTotal} message${messageTotal > 1 ? "s" : ""}.` : " aucun message serveur détaillé."}
            </p>
            <div className="fun-account-mini-list" aria-label="Conversations par agent">
              <span>A11: {inventory.conversations.a11.length}</span>
              <span>K44: {inventory.conversations.kaen44.length}</span>
              <span>Vivy: {inventory.conversations.vivy.length}</span>
            </div>
            <ul className="fun-conversation-recap-list" aria-label="Dernières conversations">
              {conversationRecap.slice(0, 6).map((entry) => (
                <li key={`${entry.surface}-${entry.id || entry.name}`}>
                  <strong>{entry.name || "Conversation"}</strong>
                  <span>{entry.label} · {entry.messageCount || 0} message{entry.messageCount > 1 ? "s" : ""}{entry.updated ? ` · ${formatAccountDate(entry.updated)}` : ""}</span>
                </li>
              ))}
              {!conversationRecap.length && (
                <li>
                  <strong>Aucune conversation serveur chargée</strong>
                  <span>Le cache local indique {overview.conversations} conversation{overview.conversations > 1 ? "s" : ""}.</span>
                </li>
              )}
            </ul>
            <footer>
              <div className="fun-token-card-actions">
                <button type="button" onClick={loadAccountInventory} disabled={!authenticated || inventory.loading}>
                  {inventory.loading ? "Chargement" : "Actualiser"}
                </button>
                <button type="button" onClick={exportAccountInventory} disabled={!authenticated}>
                  Exporter le récap
                </button>
              </div>
            </footer>
          </article>
          <article className="fun-token-card fun-token-card--media-inventory">
            <header>
              <h3>Fichiers</h3>
              <span>Médias</span>
            </header>
            <p>
              {inventoryFiles.length} élément{inventoryFiles.length > 1 ? "s" : ""} disponible{inventoryFiles.length > 1 ? "s" : ""}: images, audio, vidéos et fichiers de conversation.
            </p>
            <ul className="fun-media-inventory-list" aria-label="Inventaire des médias et fichiers">
              {inventoryFiles.map((item) => {
                const rawFile = item.resource || item.file;
                const previewUrl = rawFile && getInventoryMediaKind(rawFile) === "image"
                  ? (resolveApiAssetUrl(getStoredFileUrl(rawFile)) || getStoredFileUrl(rawFile))
                  : "";
                const kind = rawFile ? getInventoryMediaKind(rawFile) : "fichier";
                const busy = inventoryDownloadBusy === item.key;
                return (
                  <li key={item.key}>
                    <div className="fun-media-inventory-main">
                      {previewUrl ? (
                        <img src={previewUrl} alt="" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <span className="fun-media-inventory-badge">{kind}</span>
                      )}
                      <span>
                        <strong title={item.filename}>{item.filename}</strong>
                        <small>
                          {item.source === "resource" ? "Conversation" : "Compte"} · {kind} · {formatCompactFileSize(item.sizeBytes)}
                          {item.createdAt ? ` · ${formatAccountDate(item.createdAt)}` : ""}
                        </small>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadInventoryFile(item)}
                      disabled={!authenticated || busy || inventoryDownloadBusy === "zip"}
                      aria-label={`Télécharger ${item.filename}`}
                    >
                      {busy ? "..." : "Télécharger"}
                    </button>
                  </li>
                );
              })}
              {!inventoryFiles.length && (
                <li>
                  <div className="fun-media-inventory-main">
                    <span className="fun-media-inventory-badge">vide</span>
                    <span>
                      <strong>Aucun fichier serveur chargé</strong>
                      <small>{overview.files} élément{overview.files > 1 ? "s" : ""} local{overview.files > 1 ? "aux" : ""}; Vivy: {overview.vivyMessages} message{overview.vivyMessages > 1 ? "s" : ""}</small>
                    </span>
                  </div>
                </li>
              )}
            </ul>
            <footer>
              <div className="fun-token-card-actions">
                <button type="button" onClick={downloadInventoryArchive} disabled={!authenticated || inventory.loading || !!inventoryDownloadBusy || !inventoryFiles.length}>
                  {inventoryDownloadBusy === "zip" ? "Préparation" : "Tout télécharger ZIP"}
                </button>
                <button type="button" onClick={exportAccountInventory} disabled={!authenticated}>
                  Exporter le récap
                </button>
              </div>
            </footer>
          </article>
          <article className="fun-token-card">
            <header>
              <h3>Abonnement</h3>
              <span>Paiement</span>
            </header>
            <p>{subscriptionText}</p>
            <div className="fun-account-mini-list">
              <span>Voix: {overview.voiceReference}</span>
              <span>Plan: {subscriptionLabel}</span>
            </div>
            <footer>
              <div className="fun-token-card-actions">
                {inventory.subscription?.active ? (
                  <>
                    <button type="button" onClick={() => openPayment("portal")} disabled={!!paymentBusy}>
                      {paymentBusy === "portal" ? "Ouverture" : "Gérer"}
                    </button>
                    {inventory.subscription.stripeStatus?.cancelAtPeriodEnd ? (
                      <span>Désabonnement programmé</span>
                    ) : (
                      <button type="button" onClick={cancelAccountSubscription} disabled={!!paymentBusy}>
                        {paymentBusy === "cancel" ? "En cours" : "Se désabonner"}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => openPayment("premium")} disabled={!!paymentBusy}>
                      {paymentBusy === "premium" ? "Ouverture" : "Premium"}
                    </button>
                    <button type="button" onClick={() => openPayment("founder")} disabled={!!paymentBusy}>
                      {paymentBusy === "founder" ? "Ouverture" : "Fondateur"}
                    </button>
                  </>
                )}
              </div>
            </footer>
          </article>
        </div>
      </section>

      <section className="fun-token-panel fun-provider-health-panel" aria-label="État des fournisseurs IA">
        <header className="fun-token-head">
          <div>
            <span>Clés serveur</span>
            <h2>Fournisseurs IA</h2>
            <p>État réel sans afficher les clés. Les crédits sont montrés seulement quand le fournisseur les communique.</p>
          </div>
          <aside>
            <button type="button" onClick={() => void testProviderHealth()} disabled={!authenticated || providerHealthBusy}>
              {providerHealthBusy ? "Test en cours" : "Tester les fournisseurs"}
            </button>
            <small>{providerHealth?.checkedAt ? `maj ${formatAccountDate(providerHealth.checkedAt)}` : "sur demande"}</small>
          </aside>
        </header>
        {providerHealthError ? <p className="fun-account-alert">{providerHealthError}</p> : null}
        <div className="fun-provider-health-table-wrap">
          <table className="fun-provider-health-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Clé</th>
                <th>Test</th>
                <th>Modèle</th>
                <th>Crédits restants</th>
              </tr>
            </thead>
            <tbody>
              {(providerHealth?.providers || [
                { id: "groq", label: "Groq", configured: false, available: null, model: "Llama 3.3 70B", credits: { remaining: null, unit: "not_reported" } },
                { id: "elevenlabs", label: "ElevenLabs", configured: false, available: null, model: "Text to Speech", credits: { remaining: null, unit: "characters" } },
              ]).map((provider) => {
                const remaining = provider.credits?.remaining;
                const creditsText = typeof remaining === "number"
                  ? `${new Intl.NumberFormat("fr-FR").format(remaining)} ${provider.credits?.unit === "characters" ? "caractères" : "crédits"}`
                  : "Non communiqué";
                const testText = provider.available === true ? "Disponible" : provider.available === false ? "Échec" : "Non testé";
                const modelText = provider.model
                  ? `${provider.model}${provider.modelAvailable === false ? " indisponible" : ""}`
                  : "-";
                return (
                  <tr key={provider.id}>
                    <td><strong>{provider.label}</strong></td>
                    <td>{providerHealth ? (provider.configured ? "Présente" : "Absente") : "À vérifier"}</td>
                    <td>{testText}</td>
                    <td>{modelText}</td>
                    <td>{creditsText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fun-token-panel fun-session-token-panel" aria-label="Jetons applicatifs de session">
        <header className="fun-token-head">
          <div>
            <span>Session</span>
            <h2>Jetons applicatifs</h2>
            <p>Ajoute des clés temporaires pour les services de création. Elles restent dans cette session navigateur et ne partent jamais dans l'export.</p>
          </div>
          <aside>
            <strong>{Object.values(getSessionAppTokenPresence(sessionAppTokens)).filter(Boolean).length} actif{Object.values(getSessionAppTokenPresence(sessionAppTokens)).filter(Boolean).length > 1 ? "s" : ""}</strong>
            <small>{authenticated ? "session locale" : "connexion requise"}</small>
          </aside>
        </header>
        {!authenticated && (
          <p className="fun-account-alert">Connecte-toi avant d'ajouter un jeton applicatif. Les clés restent privées dans le navigateur et expirent avec la session.</p>
        )}
        <div className="fun-integration-grid fun-session-token-grid">
          {FUNESTERIE_SESSION_APP_TOKENS.map((token) => {
            const present = Boolean(sessionAppTokens[token.id]);
            return (
              <article key={token.id} className={present ? "fun-token-card fun-token-card--connected" : "fun-token-card"}>
                <header>
                  <h3>{token.label}</h3>
                  <span>{present ? "Prêt" : token.scope}</span>
                </header>
                <p>{token.help}</p>
                <label className="fun-session-token-field">
                  <span>{token.scope}</span>
                  <input
                    id={`fun-session-token-${token.id}`}
                    name={`sessionToken_${token.id}`}
                    type="password"
                    value={sessionAppTokenDrafts[token.id] || ""}
                    disabled={!authenticated}
                    onChange={(event) => updateSessionAppTokenDraft(token.id, event.currentTarget.value)}
                    placeholder={present ? "Jeton déjà présent" : token.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <footer>
                  <div className="fun-token-card-actions">
                    <button type="button" onClick={() => saveSessionAppToken(token.id)} disabled={!authenticated || !String(sessionAppTokenDrafts[token.id] || "").trim()}>
                      Enregistrer
                    </button>
                    <button type="button" onClick={() => forgetSessionAppToken(token.id)} disabled={!authenticated || !present}>
                      Oublier
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
        <div className="fun-session-token-footer">
          <p>Les comptes admin/fondateur peuvent garder les clés serveur privées. Ces jetons de session servent seulement quand l'utilisateur veut brancher son propre service.</p>
          <button type="button" onClick={forgetAllSessionAppTokens} disabled={!authenticated || !Object.values(sessionAppTokens).some(Boolean)}>
            Oublier tous les jetons
          </button>
        </div>
      </section>

      <section className="fun-access-panel" aria-label="Outils et accès autorisés">
        <header className="fun-token-head">
          <div>
            <span>Outils</span>
            <h2>Accès autorisés</h2>
            <p>Choisis les outils actifs pour cette session. Les limites serveur restent liées à ton type de compte.</p>
          </div>
          <aside>
            <strong>{accessAccount?.label || subscriptionLabel}</strong>
            <small>
              {accessCapabilities.length
                ? `${enabledAccessCount} actif${enabledAccessCount > 1 ? "s" : ""}, ${lockedAccessCount} verrouillé${lockedAccessCount > 1 ? "s" : ""}`
                : "catalogue en attente"}
            </small>
          </aside>
        </header>

        {!authenticated ? (
          <p className="fun-account-alert">Connecte-toi avec Google ou Microsoft pour vérifier les accès MCP liés à ton compte.</p>
        ) : (
          <>
            <div className="fun-access-summary">
              <article>
                <strong>Compte actuel</strong>
                <span>{accessAccount?.label || subscriptionLabel}</span>
              </article>
              <article>
                <strong>Autorisés</strong>
                <span>{allowedAccessCount}/{accessCapabilities.length || 0}</span>
              </article>
              <article>
                <strong>Actifs session</strong>
                <span>{enabledAccessCount}</span>
              </article>
              <article>
                <strong>Sécurité</strong>
                <span>{inventory.mcpAccess?.catalog?.sessionSafety?.crossAccountAccess ? "Support multi-compte" : "Session personnelle"}</span>
              </article>
            </div>

            <div className="fun-access-actions">
              <button type="button" onClick={loadAccountInventory} disabled={inventory.loading}>
                {inventory.loading ? "Vérification" : "Vérifier MCP"}
              </button>
              <button type="button" onClick={resetAccessPreferences} disabled={!accessCapabilities.length}>
                Réglages recommandés
              </button>
              <button type="button" onClick={() => openPayment(inventory.subscription?.active ? "portal" : "premium")} disabled={!!paymentBusy}>
                Voir les abonnements
              </button>
            </div>

            <div className="fun-access-controls" aria-label="Réglages outils par session">
              {accessCapabilities.length ? accessCapabilities.map((capability) => {
                const enabled = isCapabilityEnabled(capability, inventory.accessPreferences);
                const locked = !capability.allowed;
                const fixed = capability.adjustable === false;
                return (
                  <label
                    key={capability.id}
                    className={[
                      "fun-access-toggle",
                      enabled ? "fun-access-toggle--enabled" : "",
                      locked || fixed ? "fun-access-toggle--locked" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={locked || fixed}
                      onChange={(event) => toggleAccessCapability(capability.id, event.currentTarget.checked)}
                    />
                    <span className="fun-access-switch" aria-hidden="true" />
                    <span className="fun-access-toggle-copy">
                      <strong>{capability.label}</strong>
                      <small>
                        {capability.category || "MCP"} · {locked
                          ? `Requis: ${formatMcpTierLabel(capability.minimumTier)}`
                          : fixed
                            ? "Géré par le serveur"
                            : "Autorisé"}
                      </small>
                      {capability.description && <em>{capability.description}</em>}
                    </span>
                  </label>
                );
              }) : (
                <p className="fun-account-alert">Catalogue des outils indisponible pour le moment. Réessaie avec “Vérifier MCP”.</p>
              )}
            </div>

            <div className="fun-plan-comparison" aria-label="Comparatif des abonnements">
              {accessTiers.length ? accessTiers.map((tier) => {
                const current = String(tier.tier || "").toLowerCase() === String(accessAccount?.tier || "").toLowerCase();
                return (
                  <article key={tier.tier} className={current ? "fun-plan-card fun-plan-card--current" : "fun-plan-card"}>
                    <header>
                      <strong>{tier.label || formatMcpTierLabel(tier.tier)}</strong>
                      <span>{formatTierPriceLabel(tier)}</span>
                    </header>
                    <ul>
                      {(tier.features || []).slice(0, 6).map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    {current && <small>Plan actuel</small>}
                  </article>
                );
              }) : (
                <p className="fun-account-alert">Comparatif des abonnements non chargé.</p>
              )}
            </div>
          </>
        )}
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
      <h1>Réinitialiser le mot de passe</h1>
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
            Mot de passe modifié. Tu peux revenir sur la page de connexion.
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
      title={muted ? "Rétablir la voix d'A11" : "Couper la voix d'A11"}
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
        <span aria-label="Sortie coupée">Off</span>
      ) : (
        <span aria-label="Sortie automatique">On</span>
      )}
      {showLabel ? <span>{muted ? "Sortie coupée" : "Sortie auto"}</span> : null}
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
      ["Agents", "A11, K44 et Vivy traitent le contexte nécessaire."],
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
  onOpenArena,
  onQuickPrompt,
}: {
  isCompactLayout: boolean;
  onBackToChat: () => void;
  onOpenStudio: () => void;
  onOpenAccount: () => void;
  onOpenArena: () => void;
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
            <button type="button" className="kaen-service-secondary" onClick={onOpenArena}>
              Match
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

const MATCH_ARENA_CONTROLS = [
  { id: "up", label: "Haut", short: "H" },
  { id: "left", label: "Gauche", short: "G" },
  { id: "down", label: "Bas", short: "B" },
  { id: "right", label: "Droite", short: "D" },
  { id: "a", label: "A", short: "A" },
  { id: "b", label: "B", short: "B" },
  { id: "x", label: "X", short: "X" },
  { id: "y", label: "Y", short: "Y" },
  { id: "l", label: "L", short: "L" },
  { id: "r", label: "R", short: "R" },
  { id: "start", label: "Start", short: "START" },
  { id: "select", label: "Select", short: "SELECT" },
] as const;

type MatchArenaControl = typeof MATCH_ARENA_CONTROLS[number]["id"];
type MatchArenaKeyBindings = Record<MatchArenaControl, string[]>;

const MATCH_ARENA_DEFAULT_KEY_BINDINGS: MatchArenaKeyBindings = {
  up: ["ArrowUp", "z", "w"],
  down: ["ArrowDown", "s"],
  left: ["ArrowLeft", "q", "a"],
  right: ["ArrowRight", "d"],
  a: ["j"],
  b: ["k"],
  x: ["u"],
  y: ["i"],
  l: ["o"],
  r: ["p"],
  start: ["Enter"],
  select: ["Backspace"],
};

const MATCH_ARENA_GAMEPAD_BUTTONS: Record<number, MatchArenaControl> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "l",
  5: "r",
  8: "select",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

function formatMatchArenaKey(key: string) {
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === " ") return "Espace";
  if (key === "Backspace") return "Retour";
  return key.length === 1 ? key.toUpperCase() : key;
}

function readMatchArenaKeyBindings(): MatchArenaKeyBindings {
  if (typeof window === "undefined") return MATCH_ARENA_DEFAULT_KEY_BINDINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem("funesterie.matchArena.keyBindings") || "{}");
    const next = { ...MATCH_ARENA_DEFAULT_KEY_BINDINGS };
    for (const control of MATCH_ARENA_CONTROLS) {
      const values = Array.isArray(parsed?.[control.id]) ? parsed[control.id] : [];
      const clean = values.map((value: unknown) => String(value || "").trim()).filter(Boolean).slice(0, 4);
      if (clean.length) next[control.id] = clean;
    }
    return next;
  } catch {
    return MATCH_ARENA_DEFAULT_KEY_BINDINGS;
  }
}

function MatchArenaPanel({ isCompactLayout }: { isCompactLayout: boolean }) {
  const [status, setStatus] = useState<MatchArenaStatus | null>(null);
  const [games, setGames] = useState<MatchArenaGame[]>([]);
  const [lobbySessions, setLobbySessions] = useState<MatchArenaSession[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [matchMode, setMatchMode] = useState<MatchArenaMode>("user-vs-a11");
  const [priorityTier, setPriorityTier] = useState<"admin" | "family" | "public">(
    hasAdminApiAccess() ? "admin" : "public"
  );
  const [mcpAccess, setMcpAccess] = useState<McpAccessCatalogResponse | null>(null);
  const [session, setSession] = useState<MatchArenaSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [sendingInput, setSendingInput] = useState("");
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [gamepadEnabled, setGamepadEnabled] = useState(true);
  const [gamepadLabel, setGamepadLabel] = useState("Aucune manette");
  const [captureControl, setCaptureControl] = useState<MatchArenaControl | "">("");
  const [keyBindings, setKeyBindings] = useState<MatchArenaKeyBindings>(() => readMatchArenaKeyBindings());

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextGames, nextAccess] = await Promise.all([
        fetchMatchArenaStatus(),
        fetchMatchArenaGames(),
        fetchMcpAccessCatalog().catch(() => null),
      ]);
      const nextSessions = await fetchMatchArenaSessions().catch(() => []);
      setStatus(nextStatus);
      setGames(nextGames);
      setMcpAccess(nextAccess);
      setLobbySessions(nextSessions);
      setSelectedGameId((current) => current || nextGames[0]?.id || "");
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session?.id) return undefined;
    let cancelled = false;
    const pollSession = async () => {
      try {
        const nextSession = await fetchMatchArenaSession(session.id);
        if (!cancelled) setSession(nextSession);
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message || err));
      }
    };
    void pollSession();
    const timer = window.setInterval(() => {
      void pollSession();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.id]);

  const selectedGame = games.find((game) => game.id === selectedGameId) || null;
  const workerOnline = status?.worker?.online === true;
  const streamUrl = session?.stream?.embedUrl || session?.stream?.url || "";
  const inputReady = session?.input?.ready !== false && Boolean(session?.id);
  const publicLobbySessions = lobbySessions.filter((item) => item.visibility === "public" && item.id !== session?.id);
  const localPlayerSlot = session?.playerSlot || 1;
  const accessCapabilities = mcpAccess?.catalog?.capabilities || [];
  const hasAllowedCapability = (permission: string) => accessCapabilities.some((capability) => (
    capability.allowed === true
    && (capability.permission === permission || capability.id === permission)
  ));
  const accountTier = String(mcpAccess?.account?.tier || status?.access?.accountTier || "").toLowerCase();
  const a11MatchAllowed = Boolean(
    status?.access?.a11MatchAllowed
    || (hasAllowedCapability("romstationControl") && hasAllowedCapability("localRuntimeControl"))
    || hasAdminApiAccess()
  );
  const matchAccessLoaded = Boolean(status?.access || mcpAccess);
  const canUseAdminPriority = a11MatchAllowed || accountTier === "founder" || accountTier === "admin_family";
  const canUseFamilyPriority = canUseAdminPriority || accountTier === "premium";
  const matchModeOptions: Array<{ mode: MatchArenaMode; label: string; detail: string; restricted: boolean }> = [
    { mode: "user-vs-a11", label: "Contre A11", detail: "A11 prend le second camp via les outils autorisés.", restricted: true },
    { mode: "user-with-a11", label: "Avec A11", detail: "A11 copilote: conseils, lecture d’état et actions bornées.", restricted: true },
    { mode: "user-vs-player", label: "Joueur en ligne", detail: "Session publique pour affronter un autre joueur.", restricted: false },
  ];
  const streamMessage = session?.stream?.message
    || (workerOnline
      ? "Le worker est prêt. L'image s'affichera automatiquement dès qu'un pont vidéo local ou tunnel public est disponible."
      : "Le worker local n'est pas encore connecté. La session reste en file et les joueurs n'ont rien à installer.");

  useEffect(() => {
    if (!matchAccessLoaded) return;
    if (!a11MatchAllowed && matchMode !== "user-vs-player") {
      setMatchMode("user-vs-player");
    }
  }, [a11MatchAllowed, matchAccessLoaded, matchMode]);

  useEffect(() => {
    if (priorityTier === "admin" && !canUseAdminPriority) setPriorityTier(canUseFamilyPriority ? "family" : "public");
    if (priorityTier === "family" && !canUseFamilyPriority) setPriorityTier("public");
  }, [canUseAdminPriority, canUseFamilyPriority, priorityTier]);

  const startSession = async () => {
    if (!selectedGameId) return;
    if (matchMode !== "user-vs-player" && matchAccessLoaded && !a11MatchAllowed) {
      setError("Le mode Match Arena contre/avec A11 est réservé aux comptes Fondateur ou Admin famille.");
      return;
    }
    setStarting(true);
    setError("");
    try {
      const nextSession = await createMatchArenaSession({
        gameId: selectedGameId,
        mode: matchMode,
        opponent: matchMode === "user-with-a11" ? "a11-copilot" : matchMode === "user-vs-player" ? "public-player" : "a11",
        priorityTier,
        visibility: matchMode === "user-vs-player" ? "public" : "private",
      });
      setSession(nextSession);
      void refresh();
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setStarting(false);
    }
  };

  const joinSession = async (sessionId: string) => {
    setStarting(true);
    setError("");
    try {
      const nextSession = await joinMatchArenaSession(sessionId);
      setSession(nextSession);
      void refresh();
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setStarting(false);
    }
  };

  const sendControl = useCallback(async (control: string) => {
    if (!session?.id) return;
    setSendingInput(control);
    setError("");
    try {
      const nextSession = await sendMatchArenaInput(session.id, {
        control,
        action: "press",
        value: 1,
        durationMs: 80,
        player: localPlayerSlot,
      });
      setSession(nextSession);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setSendingInput("");
    }
  }, [localPlayerSlot, session?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("funesterie.matchArena.keyBindings", JSON.stringify(keyBindings));
    } catch {
      // Local preferences are best-effort.
    }
  }, [keyBindings]);

  useEffect(() => {
    if (!captureControl || typeof window === "undefined") return undefined;
    const captureKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const key = event.key || event.code;
      if (!key) return;
      setKeyBindings((current) => ({
        ...current,
        [captureControl]: [key],
      }));
      setCaptureControl("");
    };
    window.addEventListener("keydown", captureKey, true);
    return () => window.removeEventListener("keydown", captureKey, true);
  }, [captureControl]);

  useEffect(() => {
    if (!keyboardEnabled || !inputReady || captureControl || typeof window === "undefined") return undefined;
    const lookup = new Map<string, MatchArenaControl>();
    for (const control of MATCH_ARENA_CONTROLS) {
      for (const key of keyBindings[control.id] || []) lookup.set(String(key).toLowerCase(), control.id);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || "").toLowerCase();
      if (["input", "textarea", "select", "button"].includes(tagName) || target?.isContentEditable) return;
      const control = lookup.get(String(event.key || event.code || "").toLowerCase());
      if (!control) return;
      event.preventDefault();
      void sendControl(control);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureControl, inputReady, keyBindings, keyboardEnabled, sendControl]);

  useEffect(() => {
    if (!gamepadEnabled || !inputReady || typeof window === "undefined") return undefined;
    let frame = 0;
    let lastName = "";
    const activeControls = new Set<MatchArenaControl>();
    const emitControl = (control: MatchArenaControl, active: boolean) => {
      if (active && !activeControls.has(control)) {
        activeControls.add(control);
        void sendControl(control);
      }
      if (!active) activeControls.delete(control);
    };
    const tick = () => {
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = pads.find(Boolean);
      const nextName = pad?.id ? String(pad.id).slice(0, 72) : "Aucune manette";
      if (nextName !== lastName) {
        lastName = nextName;
        setGamepadLabel(nextName);
      }
      if (pad) {
        Object.entries(MATCH_ARENA_GAMEPAD_BUTTONS).forEach(([index, control]) => {
          emitControl(control, Boolean(pad.buttons[Number(index)]?.pressed));
        });
        const horizontal = Number(pad.axes[0] || 0);
        const vertical = Number(pad.axes[1] || 0);
        emitControl("left", horizontal < -0.55);
        emitControl("right", horizontal > 0.55);
        emitControl("up", vertical < -0.55);
        emitControl("down", vertical > 0.55);
      } else {
        activeControls.clear();
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [gamepadEnabled, inputReady, sendControl]);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    minHeight: 34,
    borderRadius: 7,
    border: `1px solid ${active ? "#38bdf8" : "#334155"}`,
    background: active ? "rgba(14, 165, 233, 0.18)" : "rgba(15, 23, 42, 0.72)",
    color: active ? "#e0f2fe" : "#cbd5e1",
    fontWeight: 800,
    fontSize: 12,
    padding: "0 10px",
    cursor: "pointer",
  });
  const controlStyle: React.CSSProperties = {
    minHeight: 42,
    minWidth: 48,
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#111827",
    color: "#e2e8f0",
    fontWeight: 900,
    cursor: inputReady ? "pointer" : "not-allowed",
  };

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 14,
        background: "#0b1220",
        padding: isCompactLayout ? 14 : 16,
        width: "100%",
        maxWidth: 1180,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      aria-label="Match Arena"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0", fontSize: 18 }}>Match Arena</h3>
          <p style={{ color: "#94a3b8", margin: "6px 0 0", fontSize: 13, maxWidth: 760 }}>
            Sessions jeu en ligne avec file priorisée, clavier/manette navigateur et image publiée par le worker dès que le pont vidéo est prêt.
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={refresh} disabled={loading} style={{ alignSelf: "flex-start" }}>
          {loading ? "..." : "Actualiser"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompactLayout ? "1fr" : "repeat(4, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {[
          ["Jeux", String(status?.catalog?.count ?? games.length)],
          ["Worker", workerOnline ? "En ligne" : status?.worker?.configured ? "Attente" : "Token manquant"],
          ["File", String(status?.queue?.active ?? 0)],
          ["Stream", status?.worker?.heartbeat?.streamReady ? "Prêt" : session?.stream?.ready ? "Prêt" : "Attente"],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 12, background: "#08101d" }}>
            <div style={{ color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
            <div style={{ color: "#e2e8f0", fontWeight: 800, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isCompactLayout ? "1fr" : "minmax(260px, 420px) 1fr", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 800 }} htmlFor="match-arena-game">
            Jeu local
          </label>
          <select
            id="match-arena-game"
            name="matchArenaGame"
            value={selectedGameId}
            onChange={(event) => setSelectedGameId(event.target.value)}
            style={{
              minHeight: 42,
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#020817",
              color: "#e2e8f0",
              padding: "0 10px",
            }}
          >
            {games.length === 0 ? <option value="">Aucun jeu detecte</option> : null}
            {games.map((game) => (
              <option key={game.id} value={game.id}>{game.title}</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Mode de match">
            {matchModeOptions.map((option) => {
              const disabled = option.restricted && matchAccessLoaded && !a11MatchAllowed;
              return (
              <button
                key={option.mode}
                type="button"
                onClick={() => setMatchMode(option.mode)}
                disabled={disabled}
                title={disabled ? "Réservé Fondateur / Admin famille" : option.detail}
                style={{
                  ...pillStyle(matchMode === option.mode),
                  opacity: disabled ? 0.48 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {option.label}
              </button>
              );
            })}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
            {matchMode !== "user-vs-player"
              ? (a11MatchAllowed
                ? matchModeOptions.find((option) => option.mode === matchMode)?.detail
                : "Modes A11 réservés aux comptes Fondateur ou Admin famille.")
              : "Le mode joueur en ligne ouvre une session publique rejoignable depuis Funesterie."}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Priorité session">
            {[
              ["admin", "Admin"],
              ["family", "Famille"],
              ["public", "Public"],
            ].map(([tier, label]) => (
              <button
                key={tier}
                type="button"
                onClick={() => setPriorityTier(tier as "admin" | "family" | "public")}
                disabled={(tier === "admin" && !canUseAdminPriority) || (tier === "family" && !canUseFamilyPriority)}
                style={{
                  ...pillStyle(priorityTier === tier),
                  opacity: (tier === "admin" && !canUseAdminPriority) || (tier === "family" && !canUseFamilyPriority) ? 0.48 : 1,
                  cursor: (tier === "admin" && !canUseAdminPriority) || (tier === "family" && !canUseFamilyPriority) ? "not-allowed" : "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={startSession}
            disabled={!selectedGameId || starting}
            className="btn primary"
            style={{ justifyContent: "center", minHeight: 42 }}
          >
            {starting
              ? "Préparation..."
              : matchMode === "user-vs-player"
                ? "Créer une session publique"
                : matchMode === "user-with-a11"
                  ? "Créer avec A11"
                  : "Créer contre A11"}
          </button>

          {publicLobbySessions.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                Sessions publiques
              </div>
              {publicLobbySessions.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="btn ghost"
                  onClick={() => void joinSession(item.id)}
                  disabled={starting || !item.joinable}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    minHeight: 38,
                  }}
                >
                  <span>{item.gameTitle}</span>
                  <span style={{ color: "#94a3b8", fontWeight: 800 }}>
                    {item.joinable ? "Rejoindre" : "Complet"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 12, background: "#08101d", color: "#cbd5e1", fontSize: 12 }}>
          <div style={{ color: "#e2e8f0", fontWeight: 800, marginBottom: 8 }}>
            {selectedGame?.title || "Inventaire"}
          </div>
          {selectedGame ? (
            <>
              <div>Source: {selectedGame.source || "local"}</div>
              <div>Fichiers jouables: {selectedGame.playableCount ?? selectedGame.playableFiles?.length ?? 0}</div>
              <div>Cover: {selectedGame.hasCover ? "oui" : "non"}</div>
              <div style={{ marginTop: 8, color: "#94a3b8" }}>
                {selectedGame.playableFiles?.slice(0, 4).map((file) => file.name).join(" | ") || "Aucun fichier affiché"}
              </div>
            </>
          ) : (
            <div>Le worker local publie l'inventaire de C:\Users\Djeff\Desktop\jeux.</div>
          )}
          {session ? (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #1f2937" }}>
              <div style={{ color: "#e2e8f0", fontWeight: 800 }}>Session {session.state}</div>
              <div>{session.gameTitle}</div>
              <div>Priorité: {session.priorityLabel || session.priorityTier || "Public"}</div>
              <div>Mode: {session.visibility === "public" ? "public" : "privé"} · joueur {localPlayerSlot}</div>
              {session.a11Mode?.enabled ? (
                <div>A11: {session.a11Mode.label || (session.a11Mode.role === "copilot" ? "copilote" : "adversaire")}</div>
              ) : null}
              <div>Participants: {session.players?.length || 1}</div>
              {session.players?.length ? (
                <div style={{ color: "#94a3b8" }}>
                  {session.players.map((player) => `${player.label || `Joueur ${player.slot}`}${player.automated ? " (IA)" : ""}`).join(" · ")}
                </div>
              ) : null}
              <div>Worker: {session.workerId || "en attente"}</div>
              <div>Runtime: {session.runtime?.playable ? "jouable" : session.stream?.ready ? "stream prêt" : "stream en attente"}</div>
              {session.export?.localPath ? <div>Export: {session.export.localPath}</div> : null}
              {session.message ? <div style={{ marginTop: 6 }}>{session.message}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      {session ? (
        <div style={{ display: "grid", gridTemplateColumns: isCompactLayout ? "1fr" : "minmax(0, 1.4fr) minmax(260px, 0.6fr)", gap: 12 }}>
          <div
            style={{
              border: "1px solid #1f2937",
              borderRadius: 10,
              minHeight: isCompactLayout ? 220 : 360,
              overflow: "hidden",
              background: "#020817",
              aspectRatio: "16 / 9",
              display: "grid",
              placeItems: "center",
            }}
          >
            {streamUrl ? (
              <iframe
                title="Match Arena stream"
                src={streamUrl}
                style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#020817" }}
                allow="fullscreen; gamepad"
              />
            ) : (
              <div style={{ color: "#94a3b8", padding: 24, textAlign: "center", maxWidth: 520 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 900, marginBottom: 8 }}>Image en attente</div>
                <div>{streamMessage}</div>
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  Commandes actives: clavier, boutons et manette passent par la file du worker.
                </div>
              </div>
            )}
          </div>
          <div style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 12, background: "#08101d", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setKeyboardEnabled((value) => !value)}
                style={{ justifyContent: "center", minHeight: 36 }}
              >
                Clavier {keyboardEnabled ? "actif" : "coupé"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setGamepadEnabled((value) => !value)}
                style={{ justifyContent: "center", minHeight: 36 }}
              >
                Manette {gamepadEnabled ? "active" : "coupée"}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gap: 8, justifyContent: "center" }}>
              <span />
              <button type="button" style={controlStyle} disabled={!inputReady || sendingInput === "up"} onClick={() => sendControl("up")}>H</button>
              <span />
              <button type="button" style={controlStyle} disabled={!inputReady || sendingInput === "left"} onClick={() => sendControl("left")}>G</button>
              <button type="button" style={controlStyle} disabled={!inputReady || sendingInput === "down"} onClick={() => sendControl("down")}>B</button>
              <button type="button" style={controlStyle} disabled={!inputReady || sendingInput === "right"} onClick={() => sendControl("right")}>D</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(42px, 1fr))", gap: 8 }}>
              {["a", "b", "x", "y", "l", "r", "start", "select"].map((control) => (
                <button
                  key={control}
                  type="button"
                  style={controlStyle}
                  disabled={!inputReady || sendingInput === control}
                  onClick={() => sendControl(control)}
                >
                  {control.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              Input: {session.input?.mode || "queued-json"} {session.input?.sequence ? `#${session.input.sequence}` : ""} · {gamepadLabel}
            </div>
            <div style={{ borderTop: "1px solid #1f2937", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                Touches
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                {MATCH_ARENA_CONTROLS.map((control) => (
                  <button
                    key={control.id}
                    type="button"
                    className="btn ghost"
                    onClick={() => setCaptureControl(control.id)}
                    style={{
                      minHeight: 34,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "0 9px",
                      fontSize: 11,
                    }}
                  >
                    <span>{control.label}</span>
                    <span style={{ color: captureControl === control.id ? "#fef3c7" : "#94a3b8", fontWeight: 900 }}>
                      {captureControl === control.id
                        ? "Appuie..."
                        : (keyBindings[control.id] || []).map(formatMatchArenaKey).slice(0, 2).join(" / ")}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setKeyBindings(MATCH_ARENA_DEFAULT_KEY_BINDINGS);
                  setCaptureControl("");
                }}
                style={{ justifyContent: "center", minHeight: 34 }}
              >
                Touches par défaut
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div style={{ border: "1px solid #7f1d1d", background: "#2a0f0f", color: "#fecaca", borderRadius: 8, padding: 10, fontSize: 12 }}>
          {error}
        </div>
      ) : null}
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
      name: "K44",
      role: "Agent bureau",
      text: "Accueil, suivi, organisation et interface quotidienne pour garder le travail clair.",
      image: NOSSEN_K44_TZR_SRC,
      alt: "K44, agent bureau NOSSEN",
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
  type AdminSection = "cockpit" | "arena" | "memory" | "runtime" | "console" | "ai" | "subscription";
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
  const productName = isVivy ? "Vivy" : isKaen44 ? "K44" : "A11";
  const surfaceLinks = getSurfaceLinks();
  const agentShortcuts = useMemo(() => getFunesterieAgentShortcuts(surfaceLinks), [surfaceLinks]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authSessionReady, setAuthSessionReady] = useState(false);
  const [isFunesterieAdmin, setIsFunesterieAdmin] = useState(false);
  const [voiceAccountTier, setVoiceAccountTier] = useState("basic");
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
  const [pendingMobileAudioUrl, setPendingMobileAudioUrl] = useState<string | null>(null);
  const [preparingMobileAudio, setPreparingMobileAudio] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [audioSyncReady, setAudioSyncReady] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [micDictationFallbackActive, setMicDictationFallbackActive] = useState(false);
  const [micPermissionBlocked, setMicPermissionBlocked] = useState(false);
  const [micStatusMessage, setMicStatusMessage] = useState("");
  const [voiceLearningStatus, setVoiceLearningStatus] = useState<VoiceLearningStatus | null>(null);
  const [voiceLearningConsentEnabled, setVoiceLearningConsentEnabled] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const authInvalidatedRef = useRef(false);
  const micDictationFallbackActiveRef = useRef(false);
  const micDictationFallbackStartingRef = useRef(false);
  const hasPrivateSession = isAuthenticated && authSessionReady && !authInvalidatedRef.current;
  const hasConfirmedAdminAccess = hasPrivateSession && isFunesterieAdmin;
  const canUseReadyMadeVoiceProviders = hasPrivateSession && (
    isFunesterieAdmin
    || ["premium", "founder", "admin_family"].includes(String(voiceAccountTier || "").trim().toLowerCase())
  );
  const voiceLearningPersona = surfaceKind === "a11"
    ? "a11"
      : surfaceKind === "kaen44"
        ? "kaen44"
        : surfaceKind === "vivy"
          ? "vivy"
          : "";
  const voiceLearningConsentStorageKey = voiceLearningPersona ? `funesterie:voice-learning-consent:${voiceLearningPersona}` : "";
  const canOptIntoVoiceLearning = Boolean(voiceLearningPersona && voiceLearningStatus?.canCapture);
  const canCaptureVoiceLearning = Boolean(canOptIntoVoiceLearning && voiceLearningConsentEnabled);
  const voiceLearningPersonaLabel = voiceLearningPersona === "kaen44" ? "K44" : voiceLearningPersona === "vivy" ? "Vivy" : "A11";

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
                          ? "K44 - Assistante bureau Funesterie"
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
        setAudioBlockedUrl(url ? (resolveApiAssetUrl(String(url)) || String(url)) : null);
        setMicStatusMessage("Voix mobile prête: touche le bouton lecture après un appui utilisateur.");
        return;
      }
      if (!url) return;
      setAudioBlockedUrl(resolveApiAssetUrl(String(url)) || String(url));
    };
    const onSpeechStart = () => {
      setAudioBlockedUrl(null);
      setPendingMobileAudioUrl(null);
      setPendingMobileSpeech("");
      setPreparingMobileAudio(false);
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
    micDictationFallbackActiveRef.current = micDictationFallbackActive;
  }, [micDictationFallbackActive]);

  useEffect(() => {
    const onMicError = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: string; message?: string }>).detail || {};
      const error = String(detail.error || "");
      const directSpeechFallbackErrors = new Set(["network", "audio-capture", "no-speech", "aborted"]);
      setMicStarting(false);
      setVoiceListening(false);
      if (error === "not-allowed" || error === "service-not-allowed") {
        setMicDictationFallbackActive(false);
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
      if (directSpeechFallbackErrors.has(error)) {
        setMicStatusMessage("Reconnaissance vocale directe indisponible: j'essaie le micro de secours.");
        if (error !== "aborted" && !micDictationFallbackActiveRef.current && !micDictationFallbackStartingRef.current) {
          void startMicDictationFallback("Reconnaissance vocale directe indisponible: micro de secours actif.");
        }
        console.info("[A11] reconnaissance vocale directe indisponible:", error);
        return;
      }
      if (error) {
        setMicDictationFallbackActive(false);
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
          setDisplayName(session?.user?.displayName || session?.user?.username || session?.user?.email || "Utilisateur");
          const sessionRole = String(session?.user?.role || "").trim().toLowerCase();
          setIsFunesterieAdmin(Boolean(
            session?.user?.isAdmin
            || sessionRole === "admin"
          ));
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
      setVoiceAccountTier("basic");
      return;
    }
    let cancelled = false;
    fetchMcpCockpitAccount()
      .then((account) => {
        if (!cancelled) setVoiceAccountTier(String(account?.tier || "basic").trim().toLowerCase() || "basic");
      })
      .catch(() => {
        if (!cancelled) setVoiceAccountTier(isFunesterieAdmin ? "admin_family" : "basic");
      });
    return () => {
      cancelled = true;
    };
  }, [hasPrivateSession, isFunesterieAdmin, isFunesteriePublicShell]);

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
          : via.includes("elevenlabs") ? "ElevenLabs"
            : via.includes("cartesia") ? "Cartesia"
            : via.includes("xtts") || via.includes("rvc") ? "XTTS/RVC privé"
            : via === "spawn" || via === "piper" ? "Voix serveur locale"
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

  useEffect(() => {
    if (isFunesteriePublicShell || !hasPrivateSession || !voiceLearningConsentStorageKey) {
      setVoiceLearningConsentEnabled(false);
      return;
    }
    try {
      setVoiceLearningConsentEnabled(localStorage.getItem(voiceLearningConsentStorageKey) === "1");
    } catch {
      setVoiceLearningConsentEnabled(false);
    }
  }, [hasPrivateSession, isFunesteriePublicShell, voiceLearningConsentStorageKey]);

  useEffect(() => {
    let cancelled = false;
    if (isFunesteriePublicShell || !hasPrivateSession || !voiceLearningPersona) {
      setVoiceLearningStatus(null);
      return;
    }
    fetchVoiceLearningStatus(voiceLearningPersona)
      .then((status) => {
        if (!cancelled) setVoiceLearningStatus(status);
      })
      .catch(() => {
        if (!cancelled) setVoiceLearningStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPrivateSession, isFunesteriePublicShell, voiceLearningPersona]);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [portraitFramebook, setPortraitFramebook] = useState<A11PortraitFramebook>(DEFAULT_A11_PORTRAIT_FRAMEBOOK);
  const [portraitFrameIndex, setPortraitFrameIndex] = useState(0);
  // File d'attente : messages envoyés pendant qu'A11 réfléchit
  const messageQueueRef = useRef<QueuedChatItem[]>([]);
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
    return readStoredTtsProviderMode(surfaceKind);
  });
  const effectiveTtsProviderMode = useMemo(
    () => resolveEffectiveTtsProviderMode(ttsProviderMode, surfaceKind),
    [surfaceKind, ttsProviderMode]
  );
  const [a11Language, setA11Language] = useState<A11LanguageCode>(() => {
    try {
      return normalizeA11LanguageCode(getAuthAccountLanguage(localStorage.getItem("a11:language") || "fr"));
    } catch {
      return "fr";
    }
  });
  const selectedA11Language = useMemo(
    () => A11_LANGUAGE_CHOICES.find((choice) => choice.code === a11Language) || A11_LANGUAGE_CHOICES[0],
    [a11Language]
  );
  useEffect(() => {
    if (!hasPrivateSession) return;
    const accountLanguage = normalizeA11LanguageCode(getAuthAccountLanguage(a11Language));
    if (accountLanguage !== a11Language) setA11Language(accountLanguage);
  }, [a11Language, hasPrivateSession]);
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
  const ttsProviderStorageKey = useMemo(() => getTtsProviderStorageKey(surfaceKind), [surfaceKind]);
  useEffect(() => {
    setSelectedVoiceReferenceId(readStoredVoiceReferenceId(surfaceKind));
    setTtsProviderMode(readStoredTtsProviderMode(surfaceKind));
  }, [surfaceKind]);
  useEffect(() => {
    try {
      localStorage.setItem(voiceReferenceStorageKey, selectedVoiceReferenceId || "");
      localStorage.setItem("a11:tts:vocal-mode", ttsVocalMode);
      localStorage.setItem(ttsProviderStorageKey, ttsProviderMode);
    } catch {
      // ignore storage access errors
    }
  }, [selectedVoiceReferenceId, ttsProviderMode, ttsProviderStorageKey, ttsVocalMode, voiceReferenceStorageKey]);
  useEffect(() => {
    try {
      localStorage.setItem("a11:language", selectedA11Language.code);
      document.documentElement.lang = selectedA11Language.speechLang;
    } catch {
      // ignore storage/document access errors
    }
    setSpeechRecognitionLanguage(selectedA11Language.speechLang);
  }, [selectedA11Language]);

  useEffect(() => attachLegacyStaticUiTranslator(selectedA11Language.code), [selectedA11Language.code]);

  useEffect(() => {
    translateLegacyStaticDocumentTitle(selectedA11Language.code);
  }, [
    selectedA11Language.code,
    isGeneralAccount,
    isGeneralAgents,
    isGeneralArchitecture,
    isGeneralCockpit,
    isGeneralContact,
    isGeneralHome,
    isGeneralLogin,
    isGeneralPrivacy,
    isGeneralTerms,
    isKaen44,
    isVivy,
  ]);
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
  const resetComposerTextareaHeight = useCallback(() => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.style.height = "";
    textarea.style.overflowY = "";
  }, []);
  const [model, setModel] = useState(DEFAULT_REMOTE_CHAT_MODEL_CHOICES[0].value);
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
  const [mediaImporting, setMediaImporting] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [imageJobActive, setImageJobActive] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPreviewUrls, setDragPreviewUrls] = useState<ComposerPreviewItem[]>([]);
  const [libraryImages, setLibraryImages] = useState<A11ConversationResource[]>([]);
  const [libraryAudio, setLibraryAudio] = useState<A11ConversationResource[]>([]);
  const [libraryVideo, setLibraryVideo] = useState<A11ConversationResource[]>([]);
  const [libraryTab, setLibraryTab] = useState<'image' | 'audio' | 'video'>('image');
  const [librarySelection, setLibrarySelection] = useState<{ images: string[]; audios: string[]; videos: string[] }>({ images: [], audios: [], videos: [] });
  const [showLibraryPanel, setShowLibraryPanel] = useState(false);
  const [previewCarouselIndex, setPreviewCarouselIndex] = useState(0);
  const dragCounterRef = useRef(0);
  const recentFileImportRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const pendingImportedImageUrlsRef = useRef<string[]>([]);
  const pendingImportedAudioUrlsRef = useRef<string[]>([]);
  const pendingImportedVideoUrlsRef = useRef<string[]>([]);
  const pendingImportedFileUrlsRef = useRef<string[]>([]);
  const pendingAudioUrlRef = useRef<string | null>(null);
  const mediaImportingRef = useRef(false);
  const dismissedImportedNamesRef = useRef<Set<string>>(new Set());
  const mobileAudioPrepKeyRef = useRef("");
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
  const mobileVoiceReady = isCompactLayout && Boolean(audioBlockedUrl || pendingMobileSpeech.trim() || pendingMobileAudioUrl);
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
    if (adminSection !== "cockpit" && adminSection !== "arena" && adminSection !== "subscription") {
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
      const legacyScopes = getLegacyAuthStorageScopes();
      const legacyKeys = [
        ...legacyScopes.flatMap((scope) => [
          buildSurfaceScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope, surfaceKind),
          surfaceKind === "a11" ? buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, scope) : "",
        ]),
        surfaceKind === "a11" ? buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope) : "",
        surfaceKind === "a11" ? CHAT_STORAGE_KEY_PREFIX : "",
      ].filter((key) => key && key !== chatStorageKey);
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
      const raw = currentRaw || legacyChatRaw;
      if (raw) {
        if (!currentRaw) {
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
                  imageUrl: typeof m.imageUrl === 'string' ? resolveRenderableAssetUrl(m.imageUrl) : null,
                  videoUrl: typeof m.videoUrl === 'string' ? resolveRenderableAssetUrl(m.videoUrl) : null,
                  fileUrl: typeof m.fileUrl === 'string' ? resolveRenderableAssetUrl(m.fileUrl) : null,
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
            }).filter(isRenderableChatMessage) : [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO, ts: new Date().toISOString() }]
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
  }, [isAuthenticated, authStorageScope, chatStorageKey, surfaceKind]);

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
    const renderableMessages = newMessages.filter(isRenderableChatMessage);
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, messages: renderableMessages, updated: Date.now() } : c
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
            ? resolveRenderableAssetUrl(message?.imageUrl || message?.image_url || message?.imagePath)
            : null,
          videoUrl: typeof (message?.videoUrl || message?.video_url || message?.videoPath) === "string"
            ? resolveRenderableAssetUrl(message?.videoUrl || message?.video_url || message?.videoPath)
            : null,
          fileUrl: typeof (message?.fileUrl || message?.file_url || message?.filePath) === "string"
            ? resolveRenderableAssetUrl(message?.fileUrl || message?.file_url || message?.filePath)
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
    }).filter(isRenderableChatMessage);
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
    if (isFunesteriePublicShell || !hasPrivateSession || !hasConfirmedAdminAccess) {
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
        setModel(DEFAULT_REMOTE_CHAT_MODEL_CHOICES[0].value);
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

  async function refreshLibrary() {
    if (!hasPrivateSession) { setLibraryImages([]); setLibraryAudio([]); setLibraryVideo([]); return; }
    try {
      const [images, audios, videos] = await Promise.all([
        fetchUserLibrary({ kind: 'image', limit: 30 }),
        fetchUserLibrary({ kind: 'audio', limit: 20 }),
        fetchUserLibrary({ kind: 'video', limit: 20 }),
      ]);
      setLibraryImages(images);
      setLibraryAudio(audios);
      setLibraryVideo(videos);
    } catch {
      setLibraryImages([]); setLibraryAudio([]); setLibraryVideo([]);
    }
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
    const buildFileImportFingerprint = (file: File) => {
      const name = String(file.name || "").trim();
      const stableName = /^paste-\d+\.[a-z0-9]+$/i.test(name)
        ? "clipboard-image"
        : name;
      return `${stableName}:${file.size}:${file.type}`;
    };
    const buildLibraryAlias = (file: File) => (
      toUnicodeLine(String(file.name || "").replace(/\.[^.]+$/, ""), "référence média", 80)
    );
    const seenFileKeys = new Set<string>();
    let duplicateImportCount = 0;
    const allFiles = Array.from(files).filter((file) => {
      const key = buildFileImportFingerprint(file);
      if (seenFileKeys.has(key)) {
        duplicateImportCount += 1;
        return false;
      }
      seenFileKeys.add(key);
      return true;
    });
    if (allFiles.length === 0) {
      setUploadFeedback("Doublon ignoré: ce fichier est déjà dans l'import en cours.");
      return;
    }
    const importKey = allFiles
      .map(buildFileImportFingerprint)
      .sort()
      .join("|");
    const now = Date.now();
    if (
      importKey
      && recentFileImportRef.current.key === importKey
      && now - recentFileImportRef.current.at < 120000
    ) {
      console.info("[A11] duplicate file import ignored", importKey);
      setUploadFeedback("Doublon ignoré: ce fichier est déjà prêt dans cette conversation.");
      return;
    }
    recentFileImportRef.current = { key: importKey, at: now };

    mediaImportingRef.current = true;
    setMediaImporting(true);
    try {
    const conversationId = buildSurfaceConversationId(a11ConvId || selectedChatId || undefined, surfaceKind) || undefined;
    const audioFiles = allFiles.filter(isAudioLikeFile);
    const videoFiles = allFiles.filter((file) => !isAudioLikeFile(file) && isVideoLikeFile(file));
    const importerFiles = allFiles.filter((file) => !isAudioLikeFile(file) && !isVideoLikeFile(file));
    let libraryNeedsRefresh = false;
    let conversationResourcesNeedRefresh = false;
    allFiles.forEach((file) => dismissedImportedNamesRef.current.delete(file.name));

    // Previews locaux immédiats (object URL, pas de réseau) : accumulés, pas remplacés
    const newPreviews: ComposerPreviewItem[] = [];
    for (const file of allFiles) {
      const mediaKind = getFilePreviewKind(file);
      const hasLocalPreview = mediaKind === "image" || mediaKind === "video" || mediaKind === "audio";
      newPreviews.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
        name: file.name,
        url: hasLocalPreview ? URL.createObjectURL(file) : "",
        isImage: mediaKind === "image",
        mediaKind,
      });
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
    if (duplicateImportCount > 0) {
      setUploadFeedback(`${duplicateImportCount} doublon(s) ignoré(s) avant analyse.`);
    }

    // Upload des images: garder les URLs en metadata interne, pas dans le texte visible.
    if (importerFiles.length > 0) {
      await handleImportFiles(toSyntheticFileList(importerFiles), (txt: string) => {
        setInput((prev) => (prev ? prev + "\n" + txt : txt));
      }, {
        uploadImages: true,
        conversationId,
        onAttachment: (attachment: ImportedConversationAttachment) => {
          if (attachment.kind !== "image" || !attachment.url) return;
          if (dismissedImportedNamesRef.current.has(attachment.name)) return;
          const resolvedUrl = resolveApiAssetUrl(attachment.url) || attachment.url;
          pendingImportedImageUrlsRef.current = appendUniqueUrl(pendingImportedImageUrlsRef.current, resolvedUrl);
          libraryNeedsRefresh = true;
          conversationResourcesNeedRefresh = true;
          setDragPreviewUrls((prev) => prev.map((item) => (
            item.name === attachment.name && getComposerPreviewKind(item) === "image"
              ? { ...item, remoteUrl: resolvedUrl }
              : item
          )));
          setUploadFeedback(`${pendingImportedImageUrlsRef.current.length} image(s) prêtes pour l'analyse.`);
        },
      });
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
            transcriptBlocks.push(transcript.text);
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
        ? (transcriptBlocks.length > 0
          ? `Transcription audio partielle: ${transcriptBlocks.length} ok. Le reste reste joint sans texte.`
          : `Audio joint sans transcription exploitable.`)
        : `${transcriptBlocks.length} audio(s) transcrit(s).`
      );
      // Upload audio refs for backend sync analysis BEFORE releasing the transcribing lock.
      // The first one remains audioUrl for backward compatibility; the full list is sent as referenceAudioUrls.
      setAudioSyncReady(false);
      for (const file of audioFiles) {
        if (dismissedImportedNamesRef.current.has(file.name)) continue;
        try {
          const audioUpload = await uploadConversationFile(file, {
            conversationId,
            surface: surfaceKind,
            pinToLibrary: true,
            alias: buildLibraryAlias(file),
            resourceKind: "audio",
          });
          const audioResource = audioUpload.conversationResource || audioUpload.file || null;
          const audioResourceUrl = String(audioResource?.downloadUrl || audioResource?.url || "").trim();
          if (audioResourceUrl && !dismissedImportedNamesRef.current.has(file.name)) {
            const resolvedAudioUrl = resolveApiAssetUrl(audioResourceUrl) || audioResourceUrl;
            pendingImportedAudioUrlsRef.current = appendUniqueUrl(pendingImportedAudioUrlsRef.current, resolvedAudioUrl);
            pendingAudioUrlRef.current = pendingImportedAudioUrlsRef.current[0] || resolvedAudioUrl;
            setDragPreviewUrls((prev) => prev.map((item) => (
              item.name === file.name && getComposerPreviewKind(item) === "audio"
                ? { ...item, remoteUrl: resolvedAudioUrl }
                : item
            )));
            setAudioSyncReady(true);
            libraryNeedsRefresh = true;
            conversationResourcesNeedRefresh = true;
          }
        } catch (error_) {
          console.warn("[A11] audio reference upload failed", file.name, error_);
        }
      }
      setAudioTranscribing(false);
    }

    if (videoFiles.length > 0) {
      const uploadedVideos: string[] = [];
      const failedVideos: string[] = [];
      setUploadFeedback(`Import de ${videoFiles.length} référence(s) vidéo...`);
      for (const file of videoFiles) {
        if (dismissedImportedNamesRef.current.has(file.name)) continue;
        try {
          const upload = await uploadConversationFile(file, {
            conversationId,
            surface: surfaceKind,
            pinToLibrary: true,
            alias: buildLibraryAlias(file),
            resourceKind: "video",
          });
          const resource = upload.conversationResource || upload.file || null;
          const resourceUrl = String(resource?.downloadUrl || resource?.url || "").trim();
          if (resourceUrl && !dismissedImportedNamesRef.current.has(file.name)) {
            const resolvedVideoUrl = resolveApiAssetUrl(resourceUrl) || resourceUrl;
            pendingImportedVideoUrlsRef.current = appendUniqueUrl(pendingImportedVideoUrlsRef.current, resolvedVideoUrl);
            setDragPreviewUrls((prev) => prev.map((item) => (
              item.name === file.name && getComposerPreviewKind(item) === "video"
                ? { ...item, remoteUrl: resolvedVideoUrl }
                : item
            )));
            uploadedVideos.push(file.name);
            libraryNeedsRefresh = true;
            conversationResourcesNeedRefresh = true;
          } else {
            failedVideos.push(file.name);
          }
        } catch (error_) {
          console.warn("[A11] video reference upload failed", file.name, error_);
          failedVideos.push(file.name);
        }
      }
      if (uploadedVideos.length && failedVideos.length) {
        setUploadFeedback(`Refs vidéo partielles: ${uploadedVideos.length} ok, ${failedVideos.length} en échec.`);
      } else if (uploadedVideos.length) {
        setUploadFeedback(`${uploadedVideos.length} référence(s) vidéo prête(s).`);
      } else if (failedVideos.length) {
        setUploadFeedback(`Échec refs vidéo: ${failedVideos.join(", ")}`);
      }
    }

    // Upload des fichiers non-image dans la conversation (PDF, etc.) — exclure les audios déjà traités
    const nonImageFiles = allFiles.filter((f) => !f.type.startsWith('image/') && !isAudioLikeFile(f) && !isVideoLikeFile(f));
    if (nonImageFiles.length > 0) {
      const uploaded: string[] = [];
      const failed: string[] = [];
      setUploadFeedback(`Import de ${nonImageFiles.length} fichier(s) en cours...`);
      for (const file of nonImageFiles) {
        try {
          const upload = await uploadConversationFile(file, { conversationId });
          const resource = upload.conversationResource || upload.file || null;
          const resourceUrl = String(resource?.downloadUrl || resource?.url || "").trim();
          if (resourceUrl) {
            const resolvedFileUrl = resolveApiAssetUrl(resourceUrl) || resourceUrl;
            pendingImportedFileUrlsRef.current = appendUniqueUrl(pendingImportedFileUrlsRef.current, resolvedFileUrl);
            setDragPreviewUrls((prev) => prev.map((item) => (
              item.name === file.name && getComposerPreviewKind(item) === "file"
                ? { ...item, remoteUrl: resolvedFileUrl }
                : item
            )));
          }
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
    if (conversationResourcesNeedRefresh && conversationId) {
      await refreshConversationActivity(conversationId);
      await refreshConversationResources(conversationId);
    }
    if (libraryNeedsRefresh) {
      await refreshLibrary();
    }
    } finally {
      mediaImportingRef.current = false;
      setMediaImporting(false);
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
    resetComposerTextareaHeight();
    mobileAudioPrepKeyRef.current = "";
    setPendingMobileSpeech("");
    setPendingMobileAudioUrl(null);
    setAudioBlockedUrl(null);
    setPreparingMobileAudio(false);
    setConversationActivity([]);
    setConversationResources([]);
    setActivityError("");
    setUploadFeedback("");
    pendingImportedImageUrlsRef.current = [];
    pendingImportedAudioUrlsRef.current = [];
    pendingImportedVideoUrlsRef.current = [];
    pendingImportedFileUrlsRef.current = [];
    pendingAudioUrlRef.current = null;
    mediaImportingRef.current = false;
    setMediaImporting(false);
    setAudioSyncReady(false);
    dismissedImportedNamesRef.current.clear();
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
        resetComposerTextareaHeight();
        sendMessage(txt); // envoie direct le texte reconnu
      } else {
        setInput(() => txt);
      }
    }, { lang: selectedA11Language.speechLang });
  }, [selectedA11Language.speechLang]);

  function normalizeOutgoingMessageKey(value: string) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function buildAssistantSpeechOptions(vocalMode: "speech" | "adaptive" | "sing" = ttsVocalMode) {
    const officialVoicePersonas = new Set(["a11", "kaen44", "k44", "kaen", "vivy"]);
    const useOfficialIdentityVoice = officialVoicePersonas.has(surfaceKind);
    const selectedProviderMode = effectiveTtsProviderMode;
    const wantsCloudProvider = CLOUD_TTS_PROVIDER_MODES.has(selectedProviderMode);
    const canUseSelectedCloudProvider = wantsCloudProvider && canUseReadyMadeVoiceProviders;
    const useOwnedOfficialReference = useOfficialIdentityVoice
      && LOCAL_OFFICIAL_TTS_REFERENCE_ENABLED
      && selectedProviderMode === "official";
    const useCloudIdentityVoice = useOfficialIdentityVoice
      && canUseSelectedCloudProvider
      && selectedProviderMode !== "official";
    const useIdentityVoice = useOwnedOfficialReference || useCloudIdentityVoice;
    const provider = useOwnedOfficialReference
      ? "xtts-rvc"
      : useCloudIdentityVoice ? selectedProviderMode
      : (selectedProviderMode === "piper" ? "piper" : undefined);
    const forceNeutralOfficialVoice = useOfficialIdentityVoice && !useIdentityVoice;
    return {
      lang: selectedA11Language.speechLang,
      voiceReferenceId: speechVoiceReferenceId || undefined,
      vocalMode,
      audioFormat: "mp3",
      latencyMode: "interactive",
      voiceConversion: useOwnedOfficialReference,
      convertVoice: useOwnedOfficialReference,
      morphVoice: useOwnedOfficialReference,
      rvc: useOwnedOfficialReference,
      persona: surfaceKind,
      voicePersona: surfaceKind,
      voiceReferenceRequired: useIdentityVoice,
      referenceVoiceRequired: useIdentityVoice,
      useDefaultVoiceReference: useIdentityVoice,
      defaultVoiceReference: useIdentityVoice,
      usePersonaVoiceReference: useIdentityVoice,
      identityVoice: useIdentityVoice,
      useIdentityVoice,
      neutralVoice: forceNeutralOfficialVoice ? true : (useIdentityVoice ? false : undefined),
      allowPaidTtsVoice: useOwnedOfficialReference ? false : (useCloudIdentityVoice ? true : undefined),
      paidTtsAllowed: useOwnedOfficialReference ? false : (useCloudIdentityVoice ? true : undefined),
      allowCloudTts: useOwnedOfficialReference ? false : (useCloudIdentityVoice ? true : undefined),
      allowReadyMadeCloudVoice: useOwnedOfficialReference ? false : (useCloudIdentityVoice ? true : undefined),
      useReadyMadeCloudVoice: useOwnedOfficialReference ? false : (useCloudIdentityVoice ? true : undefined),
      allowOfficialCloudVoice: useCloudIdentityVoice || undefined,
      allowIdentityCloudVoice: useCloudIdentityVoice || undefined,
      forceCloudTts: useCloudIdentityVoice || undefined,
      allowRvc: useOwnedOfficialReference,
      allowXttsRvc: useOwnedOfficialReference,
      allowLegacyVoiceBridge: useOwnedOfficialReference,
      xttsRvcOptIn: useOwnedOfficialReference,
      ttsCostPolicy: useOwnedOfficialReference ? `${surfaceKind}_official_reference` : undefined,
      allowBrowserSpeechFallback: !useIdentityVoice,
      provider,
      ttsProvider: provider || "auto",
    };
  }

  function resolvePlayableAudioUrl(rawUrl: unknown) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    return resolveApiAssetUrl(value) || value;
  }

  async function prepareMobileSpeechAudio(text: string, vocalMode: "speech" | "adaptive" | "sing" = ttsVocalMode) {
    const spokenText = String(text || "").trim();
    if (!spokenText || !isCompactViewportNow()) return;
    const prepKey = normalizeOutgoingMessageKey(`${surfaceKind}:${effectiveTtsProviderMode}:${vocalMode}:${spokenText}`);
    mobileAudioPrepKeyRef.current = prepKey;
    setPreparingMobileAudio(true);
    setPendingMobileAudioUrl(null);
    setMicStatusMessage("Voix mobile: je prépare le MP3, puis le bouton lecture le lancera.");
    try {
      const payload = await ttsSpeak(
        spokenText,
        selectedA11Language.ttsVoice || "fr_FR-siwis-medium",
        effectiveTtsProviderMode,
        buildAssistantSpeechOptions(vocalMode)
      );
      if (mobileAudioPrepKeyRef.current !== prepKey) return;
      const mediaUrl = resolvePlayableAudioUrl(
        (payload as any)?.audioUrl
        || (payload as any)?.audio_url
        || (payload as any)?.url
        || (payload as any)?.body?.audioUrl
        || (payload as any)?.body?.audio_url
      );
      if (!mediaUrl) throw new Error("audio_url_missing");
      setPendingMobileAudioUrl(mediaUrl);
      setMicStatusMessage("Voix mobile prête: touche lecture pour lancer le son.");
    } catch (error) {
      if (mobileAudioPrepKeyRef.current === prepKey) {
        setMicStatusMessage(`Voix mobile prête, mais le MP3 n'a pas été préchargé: ${String((error as any)?.message || error)}`);
      }
    } finally {
      if (mobileAudioPrepKeyRef.current === prepKey) {
        setPreparingMobileAudio(false);
      }
    }
  }

  function playAssistantSpeech(text: string, vocalMode: "speech" | "adaptive" | "sing" = ttsVocalMode) {
    const spokenText = String(text || "").trim();
    if (!spokenText) return;
    speak(spokenText, {
      ...buildAssistantSpeechOptions(vocalMode),
      onError: (error: unknown) => {
        const message = String((error as any)?.message || error || "audio_unavailable");
        setMicStatusMessage(`Voix ${productName} indisponible: ${message}`);
      },
    });
  }

  // Modifie la fonction sendMessage pour accepter un texte forcé

  function extractImageUrlsFromText(text: string): { cleanText: string; imageUrls: string[] } {
    const imageUrls: string[] = [];
    const cleanText = text
      .replace(/\[image:([^\]]+)\]/g, (_match, url) => { imageUrls.push(url.trim()); return ''; })
      .replace(/\[image-data:(data:image\/[^;]+;base64,[^\]]+)\]/g, (_match, dataUrl) => { imageUrls.push(dataUrl.trim()); return ''; })
      .replace(/\[image-jointe:[^\]]+\]/gi, '')
      .replace(/\[(?:fichier|audio)-joint:[^\]]+\]/gi, '')
      .replace(/\b(?:id|url|analyse|action-probable)=[^\s]+/gi, '')
      .replace(/Image rattachee a la conversation;?\s*/gi, '')
      .replace(/analyse-la avec la vision[^.?!]*(?:[.?!]|$)/gi, '')
      .replace(/Fichier rattache a la conversation;?\s*/gi, '')
      .replace(/analyse-le et decide quoi en faire avant de repondre\.?/gi, '')
      .trim();
    return { cleanText, imageUrls };
  }
  // File d'attente : l'utilisateur peut écrire pendant qu'A11 réfléchit
  async function sendMessage(forcedText?: string) {
    if (mediaImportingRef.current) {
      setUploadFeedback("Import refs en cours: attends la fin pour que les médias restent attachés.");
      return;
    }
    const text = (forcedText ?? input).trim();
    const { cleanText: cleanedInput, imageUrls } = extractImageUrlsFromText(text);
    const hasPendingAudioPreview = dragPreviewUrls.some((item) => getComposerPreviewKind(item) === "audio");
    const hasPendingVideoPreview = dragPreviewUrls.some((item) => getComposerPreviewKind(item) === "video");
    const pendingAudioUrls = Array.from(new Set([
      ...pendingImportedAudioUrlsRef.current,
      ...(pendingAudioUrlRef.current ? [pendingAudioUrlRef.current] : []),
    ].map((u) => resolveApiAssetUrl(u) || u).filter(Boolean)));
    const pendingAudioUrl = pendingAudioUrls[0] || null;
    const pendingVideoUrls = pendingImportedVideoUrlsRef.current
      .map((u) => resolveApiAssetUrl(u) || u)
      .filter(Boolean);
    const pendingImageUrls = pendingImportedImageUrlsRef.current
      .map((u) => resolveApiAssetUrl(u) || u)
      .filter(Boolean);
    const pendingFileUrls = pendingImportedFileUrlsRef.current
      .map((u) => resolveApiAssetUrl(u) || u)
      .filter(Boolean);
    const rawImageUrls = Array.from(new Set([
      ...imageUrls.map((u) => resolveApiAssetUrl(u) || u).filter(Boolean),
      ...pendingImageUrls,
    ]));
    const MAX_VIDEO_REFS = 3;
    const allImageUrls = rawImageUrls.slice(0, MAX_VIDEO_REFS);
    if (rawImageUrls.length > MAX_VIDEO_REFS) {
      setUploadFeedback(`3 références max utilisées pour la vidéo (${rawImageUrls.length - MAX_VIDEO_REFS} ignorée(s)).`);
    }
    const previewImageUrl = allImageUrls[0] ?? "";
    const explicitSourceImageUrl = previewImageUrl || undefined;
    const MAX_MEDIA_REFS = 3;
    const allVideoUrls = Array.from(new Set(pendingVideoUrls)).slice(0, MAX_MEDIA_REFS);
    if (pendingVideoUrls.length > MAX_MEDIA_REFS) {
      setUploadFeedback(`${MAX_MEDIA_REFS} références vidéo max utilisées (${pendingVideoUrls.length - MAX_MEDIA_REFS} ignorée(s)).`);
    }
    const sourceVideoUrl = allVideoUrls[0] || undefined;
    const effectiveText = cleanedInput
      || (explicitSourceImageUrl ? "Image jointe."
        : sourceVideoUrl || hasPendingVideoPreview ? "Vidéo jointe."
        : pendingFileUrls.length ? "Fichier joint."
        : (pendingAudioUrl || hasPendingAudioPreview) ? "Audio joint."
        : text);
    if (!effectiveText) return;
    const lastMediaForVision = !explicitSourceImageUrl
      && isImageInspectionRequest(effectiveText)
      ? findLastVisibleMedia(messages)
      : null;
    const sourceImageUrl = explicitSourceImageUrl
      || (lastMediaForVision?.kind === "image" ? lastMediaForVision.url : undefined);
    const submitKey = normalizeOutgoingMessageKey(`${effectiveText}\n${sourceImageUrl || ""}\n${allImageUrls.join("|")}\n${sourceVideoUrl || ""}\n${allVideoUrls.join("|")}\n${pendingAudioUrls.join("|")}`);
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
    mobileAudioPrepKeyRef.current = "";
    setPendingMobileSpeech("");
    setPendingMobileAudioUrl(null);
    setAudioBlockedUrl(null);
    setPreparingMobileAudio(false);

    // Afficher le message utilisateur immédiatement : sans bloquer l'input
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: effectiveText,
      imageUrl: previewImageUrl || (sourceImageUrl && canReuseLastMediaForRequest(effectiveText) ? sourceImageUrl : null),
      imageUrls: allImageUrls.length > 1 ? allImageUrls : null,
      audioUrl: pendingAudioUrl || null,
      audioUrls: pendingAudioUrls.length > 0 ? pendingAudioUrls : null,
      videoUrl: sourceVideoUrl || null,
      videoUrls: allVideoUrls.length > 0 ? allVideoUrls : null,
      fileUrl: pendingFileUrls[0] || null,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => {
      const nm = [...prev, userMsg];
      updateChatMessages(selectedChatId, nm);
      return nm;
    });
    setInput("");
    resetComposerTextareaHeight();
    requestAnimationFrame(resetComposerTextareaHeight);
    pendingImportedImageUrlsRef.current = [];
    pendingImportedAudioUrlsRef.current = [];
    pendingImportedVideoUrlsRef.current = [];
    pendingImportedFileUrlsRef.current = [];
    const capturedAudioUrl = pendingAudioUrl;
    const capturedAudioUrls = pendingAudioUrls;
    const capturedVideoUrl = sourceVideoUrl;
    const capturedVideoUrls = allVideoUrls;
    pendingAudioUrlRef.current = null;
    setAudioSyncReady(false);
    recentFileImportRef.current = { key: "", at: 0 };
    dismissedImportedNamesRef.current.clear();
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
        audioUrl: lastMedia?.kind === "audio" ? lastMedia.url : null,
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
      messageQueueRef.current.push({
        text: effectiveText,
        imageUrl: sourceImageUrl,
        imageUrls: allImageUrls,
        audioUrl: capturedAudioUrl ?? undefined,
        audioUrls: capturedAudioUrls,
        videoUrl: capturedVideoUrl,
        videoUrls: capturedVideoUrls,
      });
      return;
    }

    // Sinon démarrer le traitement
    void processMessageQueue({
      text: effectiveText,
      imageUrl: sourceImageUrl,
      imageUrls: allImageUrls,
      audioUrl: capturedAudioUrl ?? undefined,
      audioUrls: capturedAudioUrls,
      videoUrl: capturedVideoUrl,
      videoUrls: capturedVideoUrls,
    });
  }

  async function processMessageQueue(firstItem: QueuedChatItem) {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    setSending(true);
    startActivity();

    const toProcess: QueuedChatItem[] = [firstItem];

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
          toProcess.push(messageQueueRef.current.shift()!);
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
            conversationId: buildSurfaceConversationId(currentConversationId || selectedChatId || undefined, surfaceKind) || undefined,
            providerProfileId: resolvedChatModelChoice.providerProfileId,
            surface: surfaceKind,
            persona: surfaceKind,
            voicePersona: surfaceKind,
            language: selectedA11Language.code,
            sourceImageUrl: item.imageUrl,
            referenceImageUrls: item.imageUrls && item.imageUrls.length > 1 ? item.imageUrls : undefined,
            audioUrl: item.audioUrl || undefined,
            referenceAudioUrls: item.audioUrls && item.audioUrls.length > 0 ? item.audioUrls : undefined,
            sourceVideoUrl: item.videoUrl || undefined,
            referenceVideoUrls: item.videoUrls && item.videoUrls.length > 0 ? item.videoUrls : undefined,
            referenceVisualContext: item.referenceVisualContext || undefined,
          }
        );
        const normalizedAssistant = normalizeAssistantMessagePayload(
          String(assistantReply.content || ""),
          assistantReply.imageUrl || null,
          assistantReply.videoUrl || null,
          assistantReply.fileUrl || null
        );
        const assistantContent = String(normalizedAssistant.content || "").trim()
          || (
            normalizedAssistant.imageUrl || normalizedAssistant.videoUrl || normalizedAssistant.fileUrl
              ? ""
              : buildClientAssistantFallback(item.text, surfaceKind)
          );
        detectAndPushFromResponse(assistantReply.raw || assistantReply);

        const aiMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: assistantContent,
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
          setPendingMobileAudioUrl(null);
          playAssistantSpeech(spokenText, effectiveVocalMode);
        } else if (mobileAudioNeedsGesture) {
          setPendingMobileSpeech(spokenText);
          setAudioBlockedUrl(null);
          void prepareMobileSpeechAudio(spokenText, effectiveVocalMode);
        }
        lastCompletedMessageRef.current = { key: messageKey, at: Date.now() };
      } catch (err: any) {
        lastCompletedMessageRef.current = { key: "", at: 0 };
        const errMsg: ChatMessage = {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: formatChatErrorForUser(err, surfaceKind),
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
        toProcess.push(messageQueueRef.current.shift()!);
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

  function getCaptureFileExtension(mimeType: string) {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
    if (normalized.includes("ogg")) return "ogg";
    if (normalized.includes("wav")) return "wav";
    return "webm";
  }

  function setVoiceLearningContribution(next: boolean) {
    setVoiceLearningConsentEnabled(next);
    if (voiceLearningConsentStorageKey) {
      try {
        if (next) localStorage.setItem(voiceLearningConsentStorageKey, "1");
        else localStorage.removeItem(voiceLearningConsentStorageKey);
      } catch {
        // ignore storage access errors
      }
    }
    setMicStatusMessage(next
      ? `Contribution voix ${voiceLearningPersonaLabel} active: le prochain micro ajoute du flux audio au corpus.`
      : `Contribution voix ${voiceLearningPersonaLabel} coupee.`);
  }

  async function removeVoiceLearningCorpus() {
    if (!voiceLearningPersona) return;
    const confirmed = window.confirm(`Retirer tes extraits voix du corpus ${voiceLearningPersonaLabel} ?`);
    if (!confirmed) return;
    try {
      const status = await deleteVoiceLearningCorpus(voiceLearningPersona);
      setVoiceLearningStatus(status);
      setVoiceLearningContribution(false);
      setMicStatusMessage(`Corpus voix ${voiceLearningPersonaLabel} retire pour ce compte.`);
    } catch (error) {
      setMicStatusMessage("Retrait du corpus voix impossible pour l'instant.");
      console.info("[A11] voice learning corpus delete failed", error);
    }
  }

  async function submitVoiceLearningCapture(capture: MicAudioCaptureResult | null) {
    if (!capture?.blob?.size || !canCaptureVoiceLearning || !voiceLearningPersona) return;
    if (capture.durationMs < 700) return;
    try {
      const ext = getCaptureFileExtension(capture.mimeType);
      const file = new File(
        [capture.blob],
        `${voiceLearningPersona}-micro-${Date.now()}.${ext}`,
        { type: capture.mimeType || "audio/webm" }
      );
      const status = await uploadVoiceLearningSnippet(file, {
        persona: voiceLearningPersona,
        durationMs: capture.durationMs,
        source: "micro",
        consent: "voice-learning-v1",
      });
      setVoiceLearningStatus(status);
      if (!status.duplicate) {
        const current = Number(status.secondsCollected || 0);
        const required = Number(status.requiredSeconds || 180);
        setMicStatusMessage(`Corpus voix ${voiceLearningPersonaLabel}: ${Math.round(current)}s/${Math.round(required)}s collectées.`);
      }
    } catch (error) {
      console.info("[A11] voice learning capture ignored", error);
    }
  }

  async function transcribeMicDictationCapture(capture: MicAudioCaptureResult | null) {
    if (!capture?.blob?.size) {
      setMicStatusMessage("Je n'ai pas capté d'audio micro.");
      return;
    }
    if (capture.durationMs < 1200) {
      setMicStatusMessage("Micro trop court: garde PTT appuyé un peu plus longtemps.");
      return;
    }
    const captureDbfs = Number(capture.dbfs);
    const capturePeak = Number(capture.peak);
    const captureRms = Number(capture.rms);
    if (
      Number.isFinite(captureDbfs)
      && Number.isFinite(capturePeak)
      && Number.isFinite(captureRms)
      && captureDbfs < -55
      && capturePeak < 0.015
      && captureRms < 0.003
    ) {
      setMicStatusMessage("Micro trop bas ou silence: rapproche-toi, parle plus fort, puis retente.");
      return;
    }
    try {
      setAudioTranscribing(true);
      setMicStatusMessage("Je transcris ton micro...");
      const ext = getCaptureFileExtension(capture.mimeType);
      const file = new File(
        [capture.blob],
        `a11-dictee-${Date.now()}.${ext}`,
        { type: capture.mimeType || "audio/webm" }
      );
      const transcript = await transcribeAudioFile(file, {
        language: selectedA11Language.sttCode,
        provider: "auto",
        durationMs: capture.durationMs,
        dbfs: Number.isFinite(captureDbfs) ? captureDbfs : null,
        peak: Number.isFinite(capturePeak) ? capturePeak : null,
      });
      const text = toUnicodeText(transcript.text, 2400).trim();
      if (!text) {
        setMicStatusMessage("Je n'ai pas reconnu de texte dans le micro.");
        return;
      }
      setMicStatusMessage("Micro transcrit, j'envoie.");
      await sendMessage(text);
    } catch (error) {
      const message = String((error as any)?.message || error || "transcription_failed");
      setMicStatusMessage(`Transcription micro impossible: ${message}`);
      console.info("[A11] mic dictation transcription failed", error);
    } finally {
      setAudioTranscribing(false);
    }
  }

  async function startMicDictationFallback(reason = "") {
    if (micDictationFallbackActiveRef.current || micDictationFallbackStartingRef.current) return true;
    micDictationFallbackStartingRef.current = true;
    try {
      setMicStarting(true);
      setMicStatusMessage(reason || "Micro de secours: parle, puis retouche le bouton pour envoyer.");
      await startMicAudioCapture();
      setMicPermissionBlocked(false);
      setTtsFallback(false);
      try {
        localStorage.removeItem("a11:tts-only");
      } catch {
        // ignore storage access errors
      }
      setMicDictationFallbackActive(true);
      micDictationFallbackActiveRef.current = true;
      setVoiceListening(true);
      setMicStatusMessage(
        shouldUseServerPushToTalk(surfaceKind)
          ? `Micro ${productName} actif: parle, puis retouche le bouton pour envoyer.`
          : "Micro de secours actif: parle, puis retouche le bouton pour envoyer."
      );
      return true;
    } catch (error) {
      setMicDictationFallbackActive(false);
      micDictationFallbackActiveRef.current = false;
      setVoiceListening(false);
      setMicPermissionBlocked(true);
      setTtsFallback(true);
      setMicStatusMessage("Micro bloqué par le navigateur. Autorise le micro dans le cadenas du site.");
      try {
        localStorage.setItem("a11:tts-only", "1");
      } catch {
        // ignore storage access errors
      }
      console.info("[A11] mic dictation fallback unavailable", error);
      return false;
    } finally {
      micDictationFallbackStartingRef.current = false;
      setMicStarting(false);
    }
  }

  async function stopMicDictationFallback() {
    const captured = await stopMicAudioCapture().catch(() => null);
    setMicDictationFallbackActive(false);
    micDictationFallbackActiveRef.current = false;
    setVoiceListening(false);
    setMicStatusMessage("");
    void submitVoiceLearningCapture(captured);
    await transcribeMicDictationCapture(captured);
  }

  async function toggleMic() {
    console.log("[A11] toggleMic clicked, current voiceListening=", voiceListening);
    if (micStarting || audioTranscribing) {
      console.log("[A11] toggle ignored while mic is starting");
      return;
    }
    if (mobileVoiceReady && !voiceListening) {
      void unlockAudioOutput();
      if (audioBlockedUrl) {
        retryPlayUrl(audioBlockedUrl);
        setAudioBlockedUrl(null);
        setPendingMobileAudioUrl(null);
        setPendingMobileSpeech("");
        setMicStatusMessage("");
        return;
      }
      if (pendingMobileAudioUrl) {
        retryPlayUrl(pendingMobileAudioUrl);
        setPendingMobileAudioUrl(null);
        setPendingMobileSpeech("");
        setMicStatusMessage("");
        return;
      }
      if (preparingMobileAudio) {
        setMicStatusMessage("Voix mobile: le MP3 finit de se préparer, retouche lecture dans une seconde.");
        return;
      }
      const text = pendingMobileSpeech.trim();
      if (text) {
        setPendingMobileSpeech("");
        setMicStatusMessage("");
        const effectiveVocalMode = ttsVocalMode;
        playAssistantSpeech(text, effectiveVocalMode);
        return;
      }
    }
    void unlockAudioOutput();
    if (voiceListening && micDictationFallbackActive) {
      await stopMicDictationFallback();
      return;
    }
    if (!voiceListening && shouldUseServerPushToTalk(surfaceKind)) {
      if (toggleLockRef.current) {
        console.log("[A11] toggle ignored due to lock");
        return;
      }
      toggleLockRef.current = true;
      setTimeout(() => { toggleLockRef.current = false; }, 600);
      await startMicDictationFallback(`Micro ${productName}: parle, puis retouche le bouton pour envoyer.`);
      return;
    }
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
      await startMicDictationFallback("Reconnaissance vocale directe absente: j'active le micro de secours.");
      return;
    }

    if (voiceListening) {
      try { stopMic(); } catch { };
      const captured = await stopMicAudioCapture().catch(() => null);
      setVoiceListening(false);
      setMicStatusMessage("");
      void submitVoiceLearningCapture(captured);
    } else {
      let rawCaptureStarted = false;
      try {
        setMicStarting(true);
        setMicStatusMessage("");
        if (canCaptureVoiceLearning) {
          try {
            await startMicAudioCapture();
            rawCaptureStarted = true;
          } catch (captureError) {
            console.info("[A11] raw mic capture unavailable, dictation continues", captureError);
          }
        }
        await startMic({ lang: selectedA11Language.speechLang });
        setMicPermissionBlocked(false);
        setTtsFallback(false);
        try {
          localStorage.removeItem('a11:tts-only');
        } catch {
          // ignore storage access errors
        }
        setVoiceListening(true);
      } catch (e) {
        const fallbackStarted = await startMicDictationFallback("Micro direct indisponible: j'essaie le micro de secours.");
        if (!fallbackStarted) {
          if (rawCaptureStarted) {
            await stopMicAudioCapture().catch(() => null);
          }
          setVoiceListening(false);
          setMicPermissionBlocked(true);
          setTtsFallback(true);
          setMicStatusMessage("Micro bloqué ou indisponible. Mode voix sortie actif; autorise le micro dans le cadenas du site pour dicter.");
          try {
            localStorage.setItem('a11:tts-only', '1');
          } catch {
            // ignore storage access errors
          }
        }
        console.info('startMic unavailable, fallback checked', e);
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
      if (surface === "vivy") return "Salut Jeffrey. Je suis Vivy. Je parle doucement, avec une voix claire et proche.";
      if (surface === "kaen44") return "Salut Jeffrey. Je suis K44. Interface claire, ton posé, et réponse courte.";
      return "Salut Jeffrey. Je suis A11. Je parle doucement, clairement, avec une voix posée. Si tu m'entends bien, le test vocal est bon.";
    };
    const testVoice = (surfaceOrText?: string, maybeText?: string, extraOptions?: Record<string, unknown>) => {
      const first = String(surfaceOrText || "").trim();
      const firstAsSurface = /^(a11|k44|kaen44|vivy)$/i.test(first);
      const targetSurface = normalizeConsoleSurface(firstAsSurface ? first : undefined);
      const text = String(firstAsSurface ? maybeText : first || maybeText || "").trim()
        || defaultVoiceTextForSurface(targetSurface);
      const vocalMode = targetSurface === "vivy" ? "adaptive" : ttsVocalMode;
      const usesOfficialIdentityVoice = ["a11", "kaen44", "k44", "kaen", "vivy"].includes(targetSurface);
      const requestedProvider = String(
        extraOptions?.provider
        || extraOptions?.ttsProvider
        || extraOptions?.voiceProvider
        || ""
      ).trim().toLowerCase();
      const usesOwnedOfficialReference = LOCAL_OFFICIAL_TTS_REFERENCE_ENABLED
        && ["a11", "kaen44", "k44", "kaen", "vivy"].includes(targetSurface)
        && ["official", "xtts-rvc", "rvc", "local-reference", "reference"].includes(requestedProvider);
      const usesCloudIdentityVoice = usesOfficialIdentityVoice
        && ["openai", "elevenlabs", "cartesia", "azure"].includes(requestedProvider);
      const usesIdentityVoice = usesOwnedOfficialReference || usesCloudIdentityVoice;
      const voiceProvider = usesOwnedOfficialReference ? "xtts-rvc" : (usesCloudIdentityVoice ? requestedProvider : "auto");
      const voiceOptions: Record<string, unknown> = {
        lang: selectedA11Language.speechLang,
        voice: targetSurface === "kaen44" ? "kaen44" : targetSurface,
        persona: targetSurface,
        surface: targetSurface,
        voicePersona: targetSurface,
        provider: voiceProvider,
        ttsProvider: voiceProvider,
        audioFormat: "mp3",
        responseFormat: "mp3",
        latencyMode: "interactive",
        vocalMode,
        voiceConversion: usesOwnedOfficialReference,
        convertVoice: usesOwnedOfficialReference,
        morphVoice: usesOwnedOfficialReference,
        rvc: usesOwnedOfficialReference,
        useDefaultVoiceReference: usesIdentityVoice,
        defaultVoiceReference: usesIdentityVoice,
        usePersonaVoiceReference: usesIdentityVoice,
        voiceReferenceRequired: usesIdentityVoice,
        referenceVoiceRequired: usesIdentityVoice,
        identityVoice: usesIdentityVoice,
        useIdentityVoice: usesIdentityVoice,
        neutralVoice: usesOfficialIdentityVoice && !usesIdentityVoice ? true : (usesIdentityVoice ? false : undefined),
        allowPaidTtsVoice: usesOwnedOfficialReference ? false : (usesCloudIdentityVoice ? true : undefined),
        paidTtsAllowed: usesOwnedOfficialReference ? false : (usesCloudIdentityVoice ? true : undefined),
        allowCloudTts: usesOwnedOfficialReference ? false : (usesCloudIdentityVoice ? true : undefined),
        allowReadyMadeCloudVoice: usesOwnedOfficialReference ? false : (usesCloudIdentityVoice ? true : undefined),
        useReadyMadeCloudVoice: usesOwnedOfficialReference ? false : (usesCloudIdentityVoice ? true : undefined),
        allowOfficialCloudVoice: usesCloudIdentityVoice || undefined,
        allowIdentityCloudVoice: usesCloudIdentityVoice || undefined,
        forceCloudTts: usesCloudIdentityVoice || undefined,
        allowRvc: usesOwnedOfficialReference,
        allowXttsRvc: usesOwnedOfficialReference,
        allowLegacyVoiceBridge: usesOwnedOfficialReference,
        xttsRvcOptIn: usesOwnedOfficialReference,
        ttsCostPolicy: usesOwnedOfficialReference ? `${targetSurface}_official_reference` : undefined,
        allowBrowserSpeechFallback: !usesIdentityVoice,
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
    if (!hasConfirmedAdminAccess) {
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      return;
    }
    refreshRemoteAiProfiles();
  }, [hasPrivateSession, hasConfirmedAdminAccess, isResetRoute, isKaen44, isFunesteriePublicShell]);

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
    mobileAudioPrepKeyRef.current = "";
    setPendingMobileSpeech("");
    setPendingMobileAudioUrl(null);
    setAudioBlockedUrl(null);
    setPreparingMobileAudio(false);
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
    resetComposerTextareaHeight();
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
      window.location.replace(buildSessionBridgeUrl(getFunesteriePostLoginHomeUrl()));
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
    const diagnosticsAllowed = isLocalDevSurface()
      || isFunesterieAdmin
      || ["founder", "admin_family", "admin"].includes(String(voiceAccountTier || "").trim().toLowerCase());
    return <VivyPublicPage authenticated={hasPrivateSession} displayName={displayName} diagnosticsAllowed={diagnosticsAllowed} />;
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
  const menuActionStackStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 3,
    textAlign: "left",
    whiteSpace: "normal",
  };
  const menuActionSubLabelStyle: React.CSSProperties = {
    color: "#94a3b8",
    fontWeight: 760,
    fontSize: 11,
    lineHeight: 1.15,
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
              alt={isKaen44 ? "K44" : "A11"}
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
            <div style={a11TitleStyle}>{isKaen44 ? "K44" : "A11"}</div>
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
                    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#cbd5e1", fontWeight: 800 }}>
                      Voix IA
                      <select
                        id="a11-tts-provider-mode"
                        name="ttsProviderMode"
                        value={ttsProviderMode}
                        onChange={(e) => setTtsProviderMode(normalizeTtsProviderMode(e.target.value, getDefaultTtsProviderMode(surfaceKind)))}
                        style={{ ...headerSelectStyle, width: "100%", maxWidth: "100%" }}
                        title="Choisir la route voix pour cette IA"
                      >
                        <option value="official" disabled={!LOCAL_OFFICIAL_TTS_REFERENCE_ENABLED}>
                          Voix officielle
                        </option>
                        <option value="elevenlabs" disabled={!canUseReadyMadeVoiceProviders}>
                          ElevenLabs
                        </option>
                        <option value="cartesia" disabled={!canUseReadyMadeVoiceProviders}>
                          Cartesia
                        </option>
                        <option value="openai" disabled={!canUseReadyMadeVoiceProviders}>
                          OpenAI
                        </option>
                        <option value="piper">Secours local</option>
                        <option value="auto">Auto</option>
                      </select>
                    </label>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.35 }}>
                      Défaut: voix claire automatique. Cloud réservé Premium/Famille/Admin.
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
                      style={menuActionStackStyle}
                      title="Afficher les ressources et l'activite de conversation"
                    >
                      <span>Panneau conversation</span>
                      <span style={menuActionSubLabelStyle}>
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
                      style={menuActionStackStyle}
                    >
                      <span>Chat</span>
                      <span style={menuActionSubLabelStyle}>Direct</span>
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
                        style={menuActionStackStyle}
                      >
                        <span>Aides connectees</span>
                        <span style={menuActionSubLabelStyle}>{remoteProviderProfiles.length}</span>
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
                      style={menuActionStackStyle}
                    >
                      <span>{isKaen44 ? "Services" : "Pilotage"}</span>
                      <span style={menuActionSubLabelStyle}>{isKaen44 ? "Client" : "A11"}</span>
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
                      style={menuActionStackStyle}
                    >
                      <span>Plan</span>
                      <span style={menuActionSubLabelStyle}>Compte</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={menuSectionTitleStyle}>Légal</div>
                    <a
                      href={isKaen44 ? surfaceLinks.kaen44Privacy : surfaceLinks.privacy}
                      className="btn ghost"
                      style={{
                        ...menuActionStackStyle,
                        textDecoration: "none",
                      }}
                    >
                      <span>Confidentialité</span>
                      <span style={menuActionSubLabelStyle}>Vie privée</span>
                    </a>
                    <a
                      href={isKaen44 ? surfaceLinks.kaen44Terms : surfaceLinks.terms}
                      className="btn ghost"
                      style={{
                        ...menuActionStackStyle,
                        textDecoration: "none",
                      }}
                    >
                      <span>Conditions</span>
                      <span style={menuActionSubLabelStyle}>Utilisation</span>
                    </a>
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
                        ...menuActionStackStyle,
                        color: "#fecaca",
                        borderColor: "#991b1b",
                      }}
                      title="Se deconnecter de Funesterie partout"
                    >
                      <span>Se deconnecter</span>
                      <span style={{ ...menuActionSubLabelStyle, color: "#fecaca" }}>Global</span>
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
                        mobileAudioPrepKeyRef.current = "";
                        setPendingMobileSpeech("");
                        setPendingMobileAudioUrl(null);
                        setAudioBlockedUrl(null);
                        setPreparingMobileAudio(false);
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
                {(!isKaen44 || adminSection === 'arena' || adminSection === 'subscription') ? (
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
                          {isKaen44 ? "K44" : "Espace pilotage"}
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
                      <button type="button" onClick={() => setAdminSection('arena')} style={adminTabButtonStyle('arena')}>
                        Match
                      </button>
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('memory')} style={adminTabButtonStyle('memory')}>
                          Memoire
                        </button>
                      ) : null}
                      {!isKaen44 ? (
                        <button type="button" onClick={() => setAdminSection('runtime')} style={adminTabButtonStyle('runtime')}>
                          État
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
                      onOpenArena={() => setAdminSection('arena')}
                      onQuickPrompt={openKaenQuickPrompt}
                    />
                  ) : <A11ControlCenterPanel />
                ) : null}

                {adminSection === 'arena' ? (
                  <MatchArenaPanel isCompactLayout={isCompactLayout} />
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
                            a: ({ node: _node, ref: _ref, href, children, ...props }: any) => {
                              const resourceDownloadId = parseA11ResourceDownloadId(href);
                              if (resourceDownloadId) {
                                // Never expose or navigate to a public `?token=` URL: render a
                                // clean authenticated href and route the click through the
                                // credentialed blob download so we never fetch a 401 error JSON.
                                const cleanHref = buildAuthenticatedResourceDownloadPath(resourceDownloadId);
                                const labelText = String(
                                  Array.isArray(children) ? children.join(" ") : (children ?? "")
                                ).replace(/^[⬇\s]*(?:télécharger|telecharger|download|ouvrir)\s*/i, "").trim();
                                return (
                                  <a
                                    {...props}
                                    href={cleanHref}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      setUploadFeedback("Préparation du téléchargement...");
                                      void downloadResourceById(resourceDownloadId, labelText || undefined)
                                        .then((result) => {
                                          setUploadFeedback(`Téléchargement lancé: ${result.filename}`);
                                        })
                                        .catch((error_) => {
                                          const message = (error_ as Error)?.message || String(error_);
                                          setUploadFeedback(`Échec du téléchargement: ${message}`);
                                        });
                                    }}
                                  >
                                    {children}
                                  </a>
                                );
                              }
                              return (
                                <a
                                  {...props}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {children}
                                </a>
                              );
                            },
                            img: ({ node: _node, ref: _ref, src, alt, ...props }: any) => {
                              const safeSrc = resolveRenderableAssetUrl(src);
                              if (!safeSrc) return null;
                              return (
                                <img
                                  {...props}
                                  src={safeSrc}
                                  alt={String(alt || "")}
                                  loading="lazy"
                                />
                              );
                            },
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
                                </button>
                                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                                  <button type="button" className="image-preview-trigger" onClick={() => setPreviewImageUrl(imgs[0])} style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#93c5fd', cursor: 'pointer' }}>
                                    Agrandir l'image
                                  </button>
                                  <button
                                    type="button"
                                    style={{ fontSize: 12, color: '#86efac', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                                    onClick={() => {
                                      const imgUrl = resolveApiAssetUrl(imgs[0]) || imgs[0];
                                      void downloadMediaUrl(imgUrl)
                                        .then(() => setUploadFeedback("Téléchargement lancé."))
                                        .catch((error_) => setUploadFeedback(`Échec du téléchargement: ${(error_ as Error)?.message || error_}`));
                                    }}
                                  >
                                    ⬇ Télécharger
                                  </button>
                                </div>
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
                        {(() => {
                          const audioRefs = uniqueMediaUrls(m.audioUrl, m.audioUrls || []);
                          if (audioRefs.length === 0) return null;
                          return (
                            <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 420 }}>
                              {audioRefs.map((audioRef, audioIndex) => (
                                <div key={`${audioRef}-${audioIndex}`} style={{ display: "grid", gap: 6 }}>
                                  {audioRefs.length > 1 && (
                                    <div style={{ fontSize: 11, color: "#93c5fd", fontWeight: 700 }}>
                                      Audio ref {audioIndex + 1}/{audioRefs.length}
                                    </div>
                                  )}
                                  <audio src={audioRef} controls preload="metadata" style={{ width: "100%" }} />
                                  <a
                                    href={audioRef}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: 12, color: "#93c5fd", textDecoration: "none" }}
                                  >
                                    Ouvrir l'audio
                                  </a>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {(() => {
                          const videoRefs = uniqueMediaUrls(m.videoUrl, m.videoUrls || []);
                          if (videoRefs.length === 0) return null;
                          return (
                            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                              {videoRefs.map((videoRef, videoIndex) => (
                                <div key={`${videoRef}-${videoIndex}`} style={{ display: "grid", gap: 8 }}>
                                  {videoRefs.length > 1 && (
                                    <div style={{ fontSize: 11, color: "#c084fc", fontWeight: 700 }}>
                                      Vidéo ref {videoIndex + 1}/{videoRefs.length}
                                    </div>
                                  )}
                                  {/\.gif(?:[?#].*)?$/i.test(String(videoRef || "")) ? (
                                    <a
                                      href={videoRef}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ display: "inline-block", width: "fit-content" }}
                                    >
                                      <img
                                        src={videoRef}
                                        alt={`Animation generee par ${productName}`}
                                        style={{ maxWidth: "320px", borderRadius: 12 }}
                                      />
                                    </a>
                                  ) : (
                                    <video
                                      src={videoRef}
                                      controls
                                      preload="metadata"
                                      playsInline
                                      style={{ maxWidth: "320px", borderRadius: 12, background: "#020617" }}
                                    />
                                  )}
                                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <a
                                      href={videoRef}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ fontSize: 12, color: "#93c5fd", textDecoration: "none" }}
                                    >
                                      Ouvrir la vidéo
                                    </a>
                                    <button
                                      type="button"
                                      style={{ fontSize: 12, color: "#86efac", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600 }}
                                      onClick={() => {
                                        const vidUrl = resolveApiAssetUrl(videoRef) || videoRef;
                                        void downloadMediaUrl(vidUrl, `video-${videoIndex + 1}.mp4`)
                                          .then(() => setUploadFeedback("Téléchargement lancé."))
                                          .catch((error_) => setUploadFeedback(`Échec du téléchargement: ${(error_ as Error)?.message || error_}`));
                                      }}
                                    >
                                      ⬇ Télécharger
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {m.fileUrl && (
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
                    style={{ marginRight: 4, padding: isCompactLayout ? "0 10px" : undefined }}
                  >
                    {isCompactLayout ? "Import" : "Importer"}
                  </button>
                  <div className="a11-refs-wrap" style={{ position: 'relative', marginRight: 8 }}>
                    <button
                      type="button"
                      className="btn ghost import-inline"
                      title="Mes images de référence"
                      style={{ padding: isCompactLayout ? "0 10px" : undefined }}
                      onClick={() => { refreshLibrary(); setShowLibraryPanel((v) => !v); }}
                    >
                      {isCompactLayout ? "Réfs" : "Références"}
                    </button>
                    {showLibraryPanel && (() => {
                      // MIME-type filters so each tab only shows its real format
                      const isImgRes = (r: A11ConversationResource) => { const ct = (r.contentType || '').toLowerCase(); const fn = r.filename.toLowerCase(); return ct.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic)$/.test(fn); };
                      const isAudRes = (r: A11ConversationResource) => { const ct = (r.contentType || '').toLowerCase(); const fn = r.filename.toLowerCase(); return ct.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/.test(fn); };
                      const isVidRes = (r: A11ConversationResource) => { const ct = (r.contentType || '').toLowerCase(); const fn = r.filename.toLowerCase(); return ct.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|flv|m4v)$/.test(fn); };
                      const filteredImages = libraryImages.filter(isImgRes);
                      const filteredAudio = libraryAudio.filter(isAudRes);
                      const filteredVideo = libraryVideo.filter(isVidRes);

                      const totalSelected = librarySelection.images.length + librarySelection.audios.length + librarySelection.videos.length;

                      const toggleSel = (kind: 'images' | 'audios' | 'videos', url: string) => {
                        setLibrarySelection((prev) => {
                          const cur = prev[kind];
                          if (cur.includes(url)) return { ...prev, [kind]: cur.filter((u) => u !== url) };
                          if (cur.length >= 3) { setUploadFeedback(`Max 3 références ${kind}.`); return prev; }
                          return { ...prev, [kind]: [...cur, url] };
                        });
                      };

                      const commitSelection = () => {
                        librarySelection.images.forEach((url) => {
                          const item = filteredImages.find((r) => ((r as any).downloadUrl || r.url) === url);
                          const lbl = item ? getLibraryResourceDisplayName(item, 'image') : sanitizeMediaDisplayNameFromUrl(url, composerReferenceFallbackName('image'));
                          pendingImportedImageUrlsRef.current = Array.from(new Set([...pendingImportedImageUrlsRef.current, url]));
                          setDragPreviewUrls((prev) => appendUniqueComposerPreview(prev, buildComposerReferencePreviewItem('image', url, lbl, 'lib-img')));
                        });
                        librarySelection.audios.forEach((url) => {
                          const item = filteredAudio.find((r) => ((r as any).downloadUrl || r.url) === url);
                          const lbl = item ? getLibraryResourceDisplayName(item, 'audio') : sanitizeMediaDisplayNameFromUrl(url, composerReferenceFallbackName('audio'));
                          pendingImportedAudioUrlsRef.current = Array.from(new Set([...pendingImportedAudioUrlsRef.current, url]));
                          if (!pendingAudioUrlRef.current) pendingAudioUrlRef.current = url;
                          setDragPreviewUrls((prev) => appendUniqueComposerPreview(prev, buildComposerReferencePreviewItem('audio', url, lbl, 'lib-aud')));
                        });
                        librarySelection.videos.forEach((url) => {
                          const item = filteredVideo.find((r) => ((r as any).downloadUrl || r.url) === url);
                          const lbl = item ? getLibraryResourceDisplayName(item, 'video') : sanitizeMediaDisplayNameFromUrl(url, composerReferenceFallbackName('video'));
                          pendingImportedVideoUrlsRef.current = Array.from(new Set([...pendingImportedVideoUrlsRef.current, url]));
                          setDragPreviewUrls((prev) => appendUniqueComposerPreview(prev, buildComposerReferencePreviewItem('video', url, lbl, 'lib-vid')));
                        });
                        const parts = [librarySelection.images.length && `${librarySelection.images.length} image(s)`, librarySelection.audios.length && `${librarySelection.audios.length} audio(s)`, librarySelection.videos.length && `${librarySelection.videos.length} vidéo(s)`].filter(Boolean);
                        if (parts.length) setUploadFeedback(`Références insérées: ${parts.join(', ')}`);
                        setLibrarySelection({ images: [], audios: [], videos: [] });
                        setShowLibraryPanel(false);
                      };

                      const btnBase = { flexShrink: 0 as const, width: 22, height: 22, background: 'var(--bg-3, #2a2a3e)', border: '1px solid var(--border, #555)', borderRadius: 5, cursor: 'pointer' as const, color: '#aaa', fontSize: 11, display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 0 as const };

                      return (
                        <div
                          style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 200, background: 'var(--bg-2, #1e1e2e)', border: '1px solid var(--border, #444)', borderRadius: 8, padding: 8, minWidth: 310, maxWidth: 460, boxShadow: '0 4px 20px #0008' }}
                          onMouseLeave={() => setShowLibraryPanel(false)}
                        >
                          {/* Tabs */}
                          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            {(['image', 'audio', 'video'] as const).map((tab) => {
                              const cnt = tab === 'image' ? filteredImages.length : tab === 'audio' ? filteredAudio.length : filteredVideo.length;
                              const selCnt = tab === 'image' ? librarySelection.images.length : tab === 'audio' ? librarySelection.audios.length : librarySelection.videos.length;
                              const icon = tab === 'image' ? '🖼' : tab === 'audio' ? '🎵' : '🎬';
                              const label = tab === 'image' ? 'Images' : tab === 'audio' ? 'Audio' : 'Vidéo';
                              return (
                                <button key={tab} type="button" onClick={() => setLibraryTab(tab)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: libraryTab === tab ? 'var(--accent, #7c3aed)' : 'var(--bg-3, #2a2a3e)', color: libraryTab === tab ? '#fff' : 'var(--text-muted, #aaa)', position: 'relative' as const }}>
                                  {icon} {label}{cnt ? ` (${cnt})` : ''}{selCnt ? <span style={{ marginLeft: 4, background: '#22c55e', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{selCnt}</span> : null}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 6 }}>
                            Clic = sélectionner • ✕ = supprimer de la bibliothèque • max 3/type
                          </div>

                          {/* Image tab */}
                          {libraryTab === 'image' && (filteredImages.length === 0
                            ? <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '8px 0' }}>Aucune image sauvegardée.</div>
                            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto', paddingRight: 2 }}>
                              {filteredImages.map((img) => {
                                const lbl = getLibraryResourceDisplayName(img, 'image');
                                const url = (img as any).downloadUrl || img.url || '';
                                const selected = librarySelection.images.includes(url);
                                return (
                                  <div key={img.id} style={{ position: 'relative', width: 72 }}>
                                    <button type="button" title={lbl} onClick={() => toggleSel('images', url)} style={{ background: selected ? 'rgba(124,58,237,0.25)' : 'none', border: `2px solid ${selected ? '#7c3aed' : 'var(--border, #555)'}`, borderRadius: 6, padding: 2, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                                      <img src={url} alt={lbl} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                      <span style={{ fontSize: 10, color: 'var(--text-muted, #aaa)', marginTop: 2, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl.split('.')[0].slice(0, 10)}</span>
                                    </button>
                                    <button type="button" title="Retirer de la bibliothèque" style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', cursor: 'pointer', color: '#ccc', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const resourceId = Number(img.id || 0);
                                        if (!resourceId) return;
                                        void unpinResourceFromLibrary(resourceId).then(() => refreshLibrary());
                                      }}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Audio tab */}
                          {libraryTab === 'audio' && (filteredAudio.length === 0
                            ? <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '8px 0' }}>Aucun audio sauvegardé.</div>
                            : <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', paddingRight: 2 }}>
                              {filteredAudio.map((item) => {
                                const lbl = getLibraryResourceDisplayName(item, 'audio');
                                const url = (item as any).downloadUrl || item.url || '';
                                const selected = librarySelection.audios.includes(url);
                                return (
                                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <button type="button" title={lbl} onClick={() => toggleSel('audios', url)} style={{ flex: 1, background: selected ? 'rgba(124,58,237,0.2)' : 'var(--bg-3, #2a2a3e)', border: `1px solid ${selected ? '#7c3aed' : 'var(--border, #555)'}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minWidth: 0 }}>
                                      <span style={{ fontSize: 14, flexShrink: 0 }}>🎵</span>
                                      <span style={{ fontSize: 12, color: 'var(--text, #eee)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</span>
                                    </button>
                                    <button type="button" title="Retirer de la bibliothèque" style={btnBase} onClick={() => {
                                      const resourceId = Number(item.id || 0);
                                      if (!resourceId) return;
                                      void unpinResourceFromLibrary(resourceId).then(() => refreshLibrary());
                                    }}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Video tab */}
                          {libraryTab === 'video' && (filteredVideo.length === 0
                            ? <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '8px 0' }}>Aucune vidéo sauvegardée.</div>
                            : <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', paddingRight: 2 }}>
                              {filteredVideo.map((item) => {
                                const lbl = getLibraryResourceDisplayName(item, 'video');
                                const url = (item as any).downloadUrl || item.url || '';
                                const selected = librarySelection.videos.includes(url);
                                return (
                                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <button type="button" title={lbl} onClick={() => toggleSel('videos', url)} style={{ flex: 1, background: selected ? 'rgba(124,58,237,0.2)' : 'var(--bg-3, #2a2a3e)', border: `1px solid ${selected ? '#7c3aed' : 'var(--border, #555)'}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minWidth: 0 }}>
                                      <span style={{ fontSize: 14, flexShrink: 0 }}>🎬</span>
                                      <span style={{ fontSize: 12, color: 'var(--text, #eee)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</span>
                                    </button>
                                    <button type="button" title="Retirer de la bibliothèque" style={btnBase} onClick={() => {
                                      const resourceId = Number(item.id || 0);
                                      if (!resourceId) return;
                                      void unpinResourceFromLibrary(resourceId).then(() => refreshLibrary());
                                    }}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Insert button — shown when at least one item selected */}
                          {totalSelected > 0 && (
                            <button type="button" onClick={commitSelection} style={{ marginTop: 8, width: '100%', padding: '7px 0', background: 'var(--accent, #7c3aed)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                              Insérer {totalSelected} référence{totalSelected > 1 ? 's' : ''} →
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="a11-input-wrap" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                    <textarea
                      id="a11-chat-composer"
                      name="message"
                      ref={composerInputRef}
                      placeholder={isCompactLayout
                        ? (isKaen44 ? "Message K44..." : "Message A11...")
                        : (isKaen44 ? "Demande quelque chose à K44... (Ctrl+V pour coller une image)" : "Demande quelque chose à A11... (Ctrl+V pour coller une image)")}
                      value={input.replace(/\[image:[^\]]+\]/g, '').replace(/\[image-data:[^\]]+\]/g, '').replace(/\n+/g, '\n').trimStart()}
                      onChange={(e) => {
                        const imageTokens = (input.match(/\[image:[^\]]+\]|\[image-data:[^\]]+\]/g) || []).join('\n');
                        const newText = e.target.value;
                        setInput(imageTokens ? (imageTokens + (newText ? '\n' + newText : '')) : newText);
                        // Auto-resize
                        const el = e.target as HTMLTextAreaElement;
                        el.style.height = 'auto';
                        el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.28, 220) + 'px';
                        el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
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
                        fontSize: 16,
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
                    disabled={mediaImporting || audioTranscribing || (!input.trim() && dragPreviewUrls.length === 0)}
                    title={mediaImporting ? "Import des références en cours" : "Entrée pour envoyer, Shift+Entrée pour aller à la ligne"}
                    style={{ ...(sending && { opacity: 0.7 }) }}
                  >
                    {mediaImporting
                      ? "Import..."
                      : sending
                      ? (messageQueueRef.current.length > 0 ? `+${messageQueueRef.current.length}` : "...")
                      : "Envoyer"
                    }
                  </button>

                  <div className="a11-ekko-wrap"><EkkoIndicator /></div>

                  <button
                    type="button"
                    className={`nossen-mic-btn inline ${(voiceListening || micStarting || audioPlaying || audioTranscribing) ? "listening" : ""}`}
                    onClick={toggleMic}
                    disabled={micStarting || audioTranscribing || mediaImporting}
                    aria-pressed={voiceListening}
                    aria-label={mobileVoiceReady ? `Jouer la voix ${productName}` : audioTranscribing ? "Transcription du micro" : micPermissionBlocked ? "Micro bloqué" : voiceListening ? "Arrêter le micro" : shouldUseServerPushToTalk(surfaceKind) ? "Démarrer le push-to-talk serveur" : "Démarrer le micro"}
                    title={mobileVoiceReady ? (preparingMobileAudio ? "Préparation audio mobile" : `Jouer la voix ${productName}`) : audioTranscribing ? "Transcription du micro" : micPermissionBlocked ? "Micro bloqué par le navigateur" : voiceListening ? "Arrêter le micro" : shouldUseServerPushToTalk(surfaceKind) ? "Push-to-talk serveur: touche pour enregistrer, retouche pour envoyer" : "Démarrer le micro"}
                    style={{
                      marginLeft: 8,
                      opacity: micPermissionBlocked ? 0.78 : 1,
                      borderColor: micPermissionBlocked ? "#7f1d1d" : undefined,
                      color: micPermissionBlocked ? "#fecaca" : undefined,
                    }}
                  >
                    {micStarting || audioTranscribing || mediaImporting ? "..." : mobileVoiceReady ? (preparingMobileAudio ? "..." : "Play") : voiceListening ? "ON" : micPermissionBlocked ? "!" : shouldUseServerPushToTalk(surfaceKind) ? "PTT" : "MIC"}
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
                {canOptIntoVoiceLearning && (
                  <div className="voice-learning-row">
                    <label className="voice-learning-consent" htmlFor={`voice-learning-consent-${voiceLearningPersona}`}>
                      <input
                        id={`voice-learning-consent-${voiceLearningPersona}`}
                        name={`voice-learning-consent-${voiceLearningPersona}`}
                        type="checkbox"
                        checked={voiceLearningConsentEnabled}
                        onChange={(event) => setVoiceLearningContribution(event.target.checked)}
                      />
                      <span>Contribuer ma voix {voiceLearningPersonaLabel}</span>
                    </label>
                    {Number(voiceLearningStatus?.clipCount || 0) > 0 && (
                      <button
                        type="button"
                        className="voice-learning-remove"
                        onClick={() => void removeVoiceLearningCorpus()}
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                )}
                {dragPreviewUrls.length > 0 && (() => {
                  const total = dragPreviewUrls.length;
                  const idx = Math.min(previewCarouselIndex, total - 1);
                  const p = dragPreviewUrls[idx];
                  const previewKind = getComposerPreviewKind(p);
                  const previewName = sanitizeMediaDisplayName(p.name, composerReferenceFallbackName(previewKind));
                  return (
                    <div className="a11-drop-carousel">
                      {/* Thumbnail ou icône */}
                      <div className="a11-drop-carousel-media">
                        {previewKind === "image"
                          ? <img src={p.url} alt={previewName} className="a11-drop-carousel-img" />
                          : previewKind === "video"
                            ? <span className="a11-drop-carousel-file-icon" style={{
                                background: '#3b0764',
                                color: '#f0abfc',
                                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              }}>
                                VIDEO REF
                              </span>
                          : previewKind === "audio"
                            ? <span className="a11-drop-carousel-file-icon" style={{
                                background: audioSyncReady ? '#166534' : audioTranscribing ? '#78350f' : '#1e3a5f',
                                color: audioSyncReady ? '#86efac' : audioTranscribing ? '#fde68a' : '#93c5fd',
                                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              }}>
                                {audioSyncReady ? 'AUDIO SYNC' : audioTranscribing ? 'ANALYSE...' : 'AUDIO'}
                              </span>
                            : <span className="a11-drop-carousel-file-icon">FILE</span>
                        }
                      </div>

                      {/* Infos + navigation */}
                      <div className="a11-drop-carousel-info">
                        <span className="a11-drop-carousel-name">{previewName}</span>
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
                        aria-label={`Retirer ${previewName}`}
                        onClick={() => {
                          const removedKind = getComposerPreviewKind(p);
                          const remoteUrl = String(p.remoteUrl || (removedKind === "image" ? p.url : "") || "").trim();
                          if (p.url) URL.revokeObjectURL(p.url);
                          dismissedImportedNamesRef.current.add(previewName);
                          setDragPreviewUrls((prev) => {
                            const next = prev.filter((_, j) => j !== idx);
                            if (removedKind === "image") {
                              pendingImportedImageUrlsRef.current = remoteUrl
                                ? pendingImportedImageUrlsRef.current.filter((url) => url !== remoteUrl)
                                : pendingImportedImageUrlsRef.current.filter((_, entryIndex) => entryIndex !== prev.slice(0, idx + 1).filter((entry) => getComposerPreviewKind(entry) === "image").length - 1);
                            } else if (removedKind === "audio") {
                              pendingImportedAudioUrlsRef.current = remoteUrl
                                ? pendingImportedAudioUrlsRef.current.filter((url) => url !== remoteUrl)
                                : pendingImportedAudioUrlsRef.current;
                              pendingAudioUrlRef.current = pendingImportedAudioUrlsRef.current[0] || null;
                              setAudioSyncReady(pendingImportedAudioUrlsRef.current.length > 0);
                            } else if (removedKind === "video") {
                              pendingImportedVideoUrlsRef.current = remoteUrl
                                ? pendingImportedVideoUrlsRef.current.filter((url) => url !== remoteUrl)
                                : pendingImportedVideoUrlsRef.current;
                            } else {
                              pendingImportedFileUrlsRef.current = remoteUrl
                                ? pendingImportedFileUrlsRef.current.filter((url) => url !== remoteUrl)
                                : pendingImportedFileUrlsRef.current.filter((_, entryIndex) => entryIndex !== prev.slice(0, idx + 1).filter((entry) => getComposerPreviewKind(entry) === "file").length - 1);
                            }
                            if (!next.some((entry) => getComposerPreviewKind(entry) === "image")) pendingImportedImageUrlsRef.current = [];
                            if (!next.some((entry) => getComposerPreviewKind(entry) === "audio")) {
                              pendingImportedAudioUrlsRef.current = [];
                              pendingAudioUrlRef.current = null;
                              setAudioSyncReady(false);
                            }
                            if (!next.some((entry) => getComposerPreviewKind(entry) === "video")) pendingImportedVideoUrlsRef.current = [];
                            if (!next.some((entry) => getComposerPreviewKind(entry) === "file")) pendingImportedFileUrlsRef.current = [];
                            if (next.length === 0) setUploadFeedback("");
                            setPreviewCarouselIndex(Math.max(0, Math.min(idx, next.length - 1)));
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
            {isKaen44 ? "K44 local - voix - documents - Funesterie" : "A11 - chat - fichiers - voix - creation"}
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
        confirmLabel="Réinitialiser"
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
