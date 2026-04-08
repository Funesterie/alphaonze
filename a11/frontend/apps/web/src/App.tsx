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
  fetchRemoteProviderProfiles,
  hasAdminApiAccess,
  emailConversationResource,
  getAuthDisplayName,
  getAuthStorageScope,
  login,
  logout,
  getAuthToken,
  hasAuthToken,
  register,
  forgotPassword,
  resetPassword,
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
} from "./lib/api";
import { A11HistoryPanel } from "./components/A11HistoryPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { A11ControlCenterPanel } from "./components/A11ControlCenterPanel";
import { A11OpsStatusPanel } from "./components/A11OpsStatusPanel";
import { A11CommandConsolePanel } from "./components/A11CommandConsolePanel";
import { A11RemoteProvidersPanel } from "./components/A11RemoteProvidersPanel";
import { ConversationActivityPanel } from "./components/ConversationActivityPanel";
import { ConversationResourcesPanel } from "./components/ConversationResourcesPanel";
import { CreateArtifactModal } from "./components/CreateArtifactModal";
import { EmailResourceModal } from "./components/EmailResourceModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { RenameConversationModal } from "./components/RenameConversationModal";
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
} from "./lib/speech";
import handleImportFiles from "./lib/importer";
import { chatCompletionDetailed, extractAssistantDisplayContent, resolveApiAssetUrl, type Provider } from "./lib/api";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string | null;
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

const LOCAL_CHAT_MODEL_CHOICES: ChatModelChoice[] = [
  {
    value: "local:llama3.2:latest",
    label: "llama3.2 local",
    provider: "local",
    model: "llama3.2:latest",
  },
  {
    value: "local:qwen2.5-coder:latest",
    label: "qwen2.5-coder local",
    provider: "local",
    model: "qwen2.5-coder:latest",
  },
];

const DEFAULT_REMOTE_CHAT_MODEL_CHOICES: ChatModelChoice[] = [
  {
    value: "remote-default:gpt-4o-mini",
    label: "gpt-4o-mini",
    provider: "openai",
    model: "gpt-4o-mini",
  },
  {
    value: "remote-default:gpt-4.1-mini",
    label: "gpt-4.1-mini",
    provider: "openai",
    model: "gpt-4.1-mini",
  },
];

function buildChatModelChoices(remoteProfiles: RemoteProviderProfile[]) {
  const remoteChoices = remoteProfiles.map((profile) => ({
    value: `remote-profile:${profile.id}`,
    label: `${profile.label} · ${profile.model}`,
    provider: "openai" as const,
    model: profile.model,
    providerProfileId: profile.id,
  }));
  return [...LOCAL_CHAT_MODEL_CHOICES, ...remoteChoices, ...DEFAULT_REMOTE_CHAT_MODEL_CHOICES];
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
  const replacementCount = (text.match(/�/g) || []).length;
  if (replacementCount >= 3) return true;
  const suspiciousGlyphs = (text.match(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u2018-\u201F\u2026]/g) || []).length;
  return text.length >= 40 && suspiciousGlyphs / text.length > 0.2;
}

function isAssistantHistoryPoisoned(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (looksLikeLeakedActionTranscript(text)) return true;
  if (looksCorruptedAssistantText(text)) return true;
  return [
    "Je n'ai pas recu une reponse lisible. Reessaie une fois avec cette conversation.",
    "Je n'ai pas recu une reponse exploitable.",
    "Je n'ai pas recu une confirmation exploitable pour cette action.",
  ].includes(text);
}

function normalizeAssistantMessagePayload(content: string, explicitImageUrl?: string | null) {
  let resolvedImageUrl = explicitImageUrl ? resolveApiAssetUrl(explicitImageUrl) : null;
  const rawContent = String(content || "");
  let cleanedContent = extractAssistantDisplayContent(rawContent) || rawContent.trim();
  let qflushVerification: ChatMessage["qflushVerification"] = null;

  if (looksLikeLeakedActionTranscript(cleanedContent) || looksLikeLeakedActionTranscript(rawContent)) {
    cleanedContent = "Je n'ai pas recu une confirmation exploitable pour cette action.";
  }

  const qflushVerifyMatch = cleanedContent.match(/^\[QFLUSH VERIFY\]\s*Réponse potentiellement non vérifiée:\s*(.+?)(?:\n{2,}([\s\S]*))?$/i);
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
    const looksImageLink = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(String(rawUrl || "").trim())
      || label.includes("image")
      || label.includes("apercu")
      || label.includes("aperçu")
      || label.includes("ouvrir");
    if (!resolvedImageUrl && resolvedCandidate && looksImageLink) {
      resolvedImageUrl = resolvedCandidate;
    }
    if (looksImageLink) {
      return "";
    }
    return fullMatch;
  });

  if (/<!doctype html|<html/i.test(cleanedContent)) {
    cleanedContent = "Je n'ai pas recu une reponse exploitable.";
  }

  if (looksLikeActionEnvelope(cleanedContent) || looksLikeActionEnvelope(rawContent)) {
    cleanedContent = "Je n'ai pas recu une confirmation exploitable pour cette action.";
  }

  if (looksCorruptedAssistantText(cleanedContent)) {
    cleanedContent = "Je n'ai pas recu une reponse lisible. Reessaie une fois avec cette conversation.";
  }

  cleanedContent = cleanedContent
    .replace(/^(?:voici|voila)\s+la\s+reponse\s+finale\s*:\s*/i, "")
    .replace(/^la\s+reponse\s+finale\s+est\s*:\s*/i, "")
    .replace(/^reponse\s+finale(?:\s+utilisateur)?\s*:\s*/i, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/^["“][\s\S]*["”]$/.test(cleanedContent)) {
    cleanedContent = cleanedContent.slice(1, -1).trim();
  }

  cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();
  if (!cleanedContent && resolvedImageUrl) {
    cleanedContent = "Image générée par A-11.";
  } else if (!cleanedContent && rawContent.trim()) {
    cleanedContent = "A11 a traité la demande.";
  }

  return {
    content: cleanedContent,
    imageUrl: resolvedImageUrl || null,
    qflushVerification,
  };
}

function sanitizeConversationHistoryForModel(messages: ChatMessage[]) {
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    if (!message || message.role === "system") return false;
    if (message.role !== "assistant") return true;
    return !isAssistantHistoryPoisoned(message.content);
  });
}

function shouldAutoplayAssistantMessage(content: string) {
  const text = String(content || "").trim();
  if (!text) return false;
  return !isAssistantHistoryPoisoned(text);
}

function shouldSuppressAudioBlockedBannerOnCurrentDevice() {
  try {
    const hasTouchPoints = Number((globalThis as any)?.navigator?.maxTouchPoints || 0) > 0;
    const coarsePointer = typeof (globalThis as any)?.matchMedia === "function"
      ? !!(globalThis as any).matchMedia("(pointer: coarse)").matches
      : false;
    const userAgent = String((globalThis as any)?.navigator?.userAgent || "").toLowerCase();
    return hasTouchPoints || coarsePointer || /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  } catch {
    return false;
  }
}

const CHAT_STORAGE_KEY_PREFIX = "a11:chats";
const PURGE_HISTORY_STORAGE_KEY_PREFIX = "a11:memory-purge-history";

function buildScopedStorageKey(prefix: string, scope?: string | null) {
  const normalizedScope = String(scope || "").trim();
  return normalizedScope ? `${prefix}:${normalizedScope}` : prefix;
}

function suggestConsoleCommandForDiagnosticRequest(rawValue: string) {
  const text = String(rawValue || "").trim().toLowerCase();
  if (!text) return null;

  const buildKeywords = /(build|compile|compilation|compiler|erreur de build|erreur build|ca compile pas|ça compile pas|failing build|build failed)/i;
  const nodeKeywords = /(npm|vite|react|frontend|front|web|javascript|typescript|node)/i;
  const dotnetKeywords = /(dotnet|c#|csharp|csproj|solution|visual studio|sln|backend c#)/i;

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

  if (/npm\s+test|\btests?\b/i.test(text)) {
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
}

const DEFAULT_SYSTEM_NINDO =
  "Tu es A-11, assistant local. Réponds de façon concise, claire et directe. N'invente pas de contexte. Ne fais aucune action et ne proposes aucune action non demandée explicitement. Si la question est triviale, réponds en une phrase maximum.";

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
      hint: "Liste ou plan detecte, pret a etre exporte.",
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

// ✅ LOGIN PANEL
function LoginPanel({ onLoginSuccess }: { onLoginSuccess: () => void }) {
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
      await login(username, password);
      onLoginSuccess();
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
        onLoginSuccess();
        return;
      }
      setInfo("Compte cree. Connecte-toi avec ton nouveau mot de passe.");
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
  };
  const authTabsStyle: React.CSSProperties = {
    display: "flex",
    gap: "10px",
    marginBottom: "8px",
    flexWrap: "wrap",
    justifyContent: "center",
  };
  const authFormStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    width: "min(100%, 340px)",
  };
  const authInputStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: "4px",
    border: "1px solid #ccc",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={authShellStyle}>
      <h1>🔐 Connexion A11</h1>
      <div style={authTabsStyle}>
        <button
          type="button"
          onClick={() => switchMode("login")}
          style={{
            padding: "10px 16px",
            borderRadius: "999px",
            border: "1px solid #334155",
            background: mode === "login" ? "#7c3aed" : "#0f172a",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          Connexion
        </button>
        <button
          type="button"
          onClick={() => switchMode("register")}
          style={{
            padding: "10px 16px",
            borderRadius: "999px",
            border: "1px solid #334155",
            background: mode === "register" ? "#7c3aed" : "#0f172a",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          S'inscrire
        </button>
        <button
          type="button"
          onClick={() => switchMode("forgot")}
          style={{
            padding: "10px 16px",
            borderRadius: "999px",
            border: "1px solid #334155",
            background: mode === "forgot" ? "#7c3aed" : "#0f172a",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          Reinitialiser
        </button>
      </div>
      {mode === "login" && (
        <form onSubmit={handleLogin} style={authFormStyle}>
          <input
            type="text"
            placeholder="Pseudo"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            style={authInputStyle}
          />
          <input
            type="password"
            placeholder="Mot de passe"
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
              borderRadius: "4px",
              border: "none",
              background: "#007bff",
              color: "white",
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
            type="text"
            placeholder="Pseudo"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            style={authInputStyle}
          />
          <input
            type="email"
            placeholder="Email"
            value={registerEmail}
            onChange={(e) => setRegisterEmail(e.target.value)}
            disabled={loading}
            style={authInputStyle}
          />
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            style={authInputStyle}
          />
          <input
            type="password"
            placeholder="Confirmer le mot de passe"
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
              borderRadius: "4px",
              border: "none",
              background: "#7c3aed",
              color: "white",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {loading ? "Creation..." : "Creer le compte"}
          </button>
        </form>
      )}
      {mode === "forgot" && (
        <form onSubmit={handleForgot} style={{ ...authFormStyle, gap: "10px", marginTop: "10px" }}>
          <div style={{ fontSize: "13px", color: "#94a3b8" }}>Mot de passe oublie ?</div>
          <input
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
              borderRadius: "4px",
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e2e8f0",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {forgotLoading ? "Envoi..." : "Envoyer le lien de reinitialisation"}
          </button>
          {forgotError && <div style={{ color: "red", fontSize: "13px" }}>{forgotError}</div>}
          {forgotSent && <div style={{ color: "#22c55e", fontSize: "13px" }}>Si l&apos;email existe, un lien a ete envoye.</div>}
        </form>
      )}
      {error && <div style={{ color: "red", fontSize: "14px", maxWidth: "340px", textAlign: "center" }}>{error}</div>}
      {info && <div style={{ color: "#22c55e", fontSize: "14px", maxWidth: "340px", textAlign: "center" }}>{info}</div>}
    </div>
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
          type="password"
          placeholder="Nouveau mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          style={{ padding: "10px", borderRadius: "4px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
        />
        <input
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
          {loading ? "Reinitialisation..." : "Valider"}
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
        <span role="img" aria-label="Audio coupé">🔇</span>
      ) : (
        <span role="img" aria-label="Audio actif">🔊</span>
      )}
      {showLabel ? <span>{muted ? "Voix coupée" : "Voix active"}</span> : null}
    </button>
  );
}

export function App() {
  type AdminSection = "cockpit" | "memory" | "runtime" | "console" | "ai";
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Audio-blocked banner: listen for autoplay block events
  useEffect(() => {
    const onBlocked = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (shouldSuppressAudioBlockedBannerOnCurrentDevice()) return;
      if (url) setAudioBlockedUrl(url);
    };
    const onSpeechStart = () => {
      setAudioBlockedUrl(null);
      setAudioPlaying(true);
    };
    const onSpeechEnd = () => setAudioPlaying(false);
    globalThis.addEventListener('a11:audioBlocked', onBlocked);
    globalThis.addEventListener('a11:speechstart', onSpeechStart);
    globalThis.addEventListener('a11:speechend', onSpeechEnd);
    return () => {
      globalThis.removeEventListener('a11:audioBlocked', onBlocked);
      globalThis.removeEventListener('a11:speechstart', onSpeechStart);
      globalThis.removeEventListener('a11:speechend', onSpeechEnd);
    };
  }, []);

  // Check if already authenticated on mount
  useEffect(() => {
    if (hasAuthToken()) {
      setIsAuthenticated(true);
      setDisplayName(getAuthDisplayName() || "Utilisateur");
    }
    const pathname = window.location.pathname.toLowerCase();
    setIsResetRoute(pathname.includes('/reset-password') || pathname.includes('/reset'));
  }, []);

  useEffect(() => {
    const onAuthInvalid = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; message?: string; status?: number }>).detail || {};
      console.warn("[A11] auth invalidated", detail);
      cancelSpeech();
      setDisplayName("Utilisateur");
      setIsAuthenticated(false);
      setSending(false);
      sendLockRef.current = false;
      setLoadingHistory(false);
      setLoadingActivity(false);
      setLoadingResources(false);
      setLoadingRemoteProviders(false);
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      setA11History([]);
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
  }, []);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toggleLockRef = useRef(false);
  const sendLockRef = useRef(false);
  const authStorageScope = useMemo(
    () => (isAuthenticated ? getAuthStorageScope() : ""),
    [isAuthenticated]
  );
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [model, setModel] = useState("local:llama3.2:latest");
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
  const [activeView, setActiveView] = useState<'chat' | 'admin'>('chat');
  const [adminSection, setAdminSection] = useState<AdminSection>("cockpit");
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    try {
      return window.innerWidth <= 900;
    } catch {
      return false;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    if (!isCompactLayout) {
      setSidebarOpen(false);
    }
  }, [isCompactLayout]);

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
    if (!isAuthenticated || !authStorageScope) return;

    try {
      localStorage.removeItem(CHAT_STORAGE_KEY_PREFIX);
    } catch {
      // ignore legacy storage cleanup issues
    }

    try {
      const raw = localStorage.getItem(buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope));
      if (raw) {
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
                ? normalizeAssistantMessagePayload(rawContent, typeof m.imageUrl === 'string' ? m.imageUrl : null)
                : {
                    content: rawContent,
                    imageUrl: typeof m.imageUrl === 'string' ? resolveApiAssetUrl(m.imageUrl) : null,
                  };
              return {
                id: String(m.id || (`m-${Date.now()}`)),
                role,
                content: role === 'system' ? normalizeSystemContent(rawContent) : normalizedAssistant.content,
                imageUrl: role === 'system' ? null : normalizedAssistant.imageUrl,
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
  }, [isAuthenticated, authStorageScope]);

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
      const raw = localStorage.getItem(buildScopedStorageKey(PURGE_HISTORY_STORAGE_KEY_PREFIX, authStorageScope));
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
  }, [isAuthenticated, authStorageScope]);

  useEffect(() => {
    if (!isAuthenticated || !authStorageScope) return;
    try {
      localStorage.setItem(
        buildScopedStorageKey(PURGE_HISTORY_STORAGE_KEY_PREFIX, authStorageScope),
        JSON.stringify(purgeHistory.slice(0, 10))
      );
    } catch {
      // ignore storage failures
    }
  }, [purgeHistory, isAuthenticated, authStorageScope]);

  // persist chats whenever changed
  useEffect(() => {
    if (!isAuthenticated || !authStorageScope) return;
    try {
      localStorage.setItem(
        buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope),
        JSON.stringify(chats)
      );
    } catch (e) {
      console.warn("[A11] failed to save chats", e);
    }
  }, [chats, isAuthenticated, authStorageScope]);

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
              : null
          )
        : {
            content: String(message?.content || ""),
            imageUrl: typeof (message?.imageUrl || message?.image_url || message?.imagePath) === "string"
              ? resolveApiAssetUrl(message?.imageUrl || message?.image_url || message?.imagePath)
              : null,
          };
      return {
        id: String(message?.id || `backend-msg-${Date.now()}-${index}`),
        role,
        content: normalizedAssistant.content,
        imageUrl: normalizedAssistant.imageUrl,
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
    if (!targetConversationId) {
      setConversationActivity([]);
      setActivityError("");
      return;
    }

    setLoadingActivity(true);
    setActivityError("");
    try {
      const payload = await fetchA11ConversationActivity(targetConversationId, { limit: 12 });
      setConversationActivity(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (error_) {
      console.warn("[A11] failed to load conversation activity", error_);
      setConversationActivity([]);
      setActivityError((error_ as Error).message || "Chargement de l'activite impossible");
    } finally {
      setLoadingActivity(false);
    }
  }

  async function refreshConversationResources(conversationId?: string | null) {
    const targetConversationId = String(conversationId || "").trim();
    if (!targetConversationId) {
      setConversationResources([]);
      setResourceError("");
      return;
    }

    setLoadingResources(true);
    setResourceError("");
    try {
      const payload = await fetchA11ConversationResources(targetConversationId, { limit: 24 });
      setConversationResources(Array.isArray(payload?.resources) ? payload.resources : []);
    } catch (error_) {
      console.warn("[A11] failed to load conversation resources", error_);
      setConversationResources([]);
      setResourceError((error_ as Error).message || "Chargement des ressources impossible");
    } finally {
      setLoadingResources(false);
    }
  }

  async function refreshRemoteAiProfiles() {
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
    const conversationId = currentConversationId || selectedChatId || undefined;
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
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} cree, telecharge et pret a etre envoye.`);
      } else if (payload.openEmailAfterCreate) {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} cree et pret pour l'envoi mail.`);
      } else if (payload.downloadAfterCreate) {
        setUploadFeedback(`Artefact ${result.artifact?.filename || payload.filename} cree et telecharge.`);
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
      setUploadFeedback(`Mail envoye vers ${payload.to.trim()} ${attachmentLabel}.`);
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

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    handleImportFiles(files, (txt: string) => {
      setInput((prev) => (prev ? prev + "\n" + txt : txt));
    }).catch(console.error);

    if (!files || files.length === 0) return;

    const conversationId = a11ConvId || selectedChatId || undefined;
    const uploaded: string[] = [];
    const failed: string[] = [];
    setUploadFeedback(`Import de ${files.length} fichier(s) en cours...`);
    for (const file of Array.from(files)) {
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
      setUploadFeedback(`${uploaded.length} fichier(s) rattache(s) a la conversation.`);
    } else if (failed.length) {
      setUploadFeedback(`Echec import: ${failed.join(", ")}`);
    }

    e.target.value = "";
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

  // Speech recognition callback
  useEffect(() => {
    initSpeech((txt: string, isFinal?: boolean) => {
      if (isFinal) {
        setInput(""); // vide l'input
        sendMessage(txt); // envoie direct le texte reconnu
      } else {
        setInput(() => txt);
      }
    });
  }, []);

  // Modifie la fonction sendMessage pour accepter un texte forcé
  async function sendMessage(forcedText?: string) {
    const text = (forcedText ?? input).trim();
    if (!text || sending || sendLockRef.current) return;
    sendLockRef.current = true;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => {
      const nm = [...prev, userMsg];
      updateChatMessages(selectedChatId, nm);
      return nm;
    });
    setInput("");
    setSending(true);

    const suggestion = suggestConsoleCommandForDiagnosticRequest(text);
    if (suggestion) {
      openAdminConsoleWithSuggestedCommand(suggestion.command, suggestion.reason);
    }

    try {
      // Utilisation de chatCompletion pour transmettre le prompt et le flag dev
      // On reconstruit l'historique sans les messages système (le prompt système est passé séparément)
      const history = sanitizeConversationHistoryForModel(messages).concat(userMsg);
      const provider: Provider = resolvedChatModelChoice.provider;
      const assistantReply = await chatCompletionDetailed(
        history,
        provider,
        {
          model: resolvedChatModelChoice.model,
          systemPrompt: systemPrompt,
          conversationId: selectedChatId || undefined,
          providerProfileId: resolvedChatModelChoice.providerProfileId,
        }
      );
      const normalizedAssistant = normalizeAssistantMessagePayload(
        String(assistantReply.content || ""),
        assistantReply.imageUrl || null
      );

      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: normalizedAssistant.content,
        imageUrl: normalizedAssistant.imageUrl,
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
      if (shouldAutoplayAssistantMessage(spokenText)) {
        speak(spokenText, { lang: "fr-FR" });
      }
    } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `e-${Date.now()}`,
          role: "assistant",
          content:
          "Erreur lors de l'appel au chat A11 : " + (err?.message || err),
          ts: new Date().toISOString(),
        };
      setMessages((prev) => {
        const nm = [...prev, errMsg];
        updateChatMessages(selectedChatId, nm);
        return nm;
      });
    } finally {
      setSending(false);
      sendLockRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function toggleMic() {
    console.log("[A11] toggleMic clicked, current voiceListening=", voiceListening);
    // If audio is playing, stop it immediately and do not toggle modes
    if (audioPlaying) {
      console.log("[A11] canceling audio playback via toggle");
      cancelSpeech();
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
      // fallback: toggle TTS-only mode
      setTtsFallback((v) => {
        const next = !v;
        // keep voiceListening false when using fallback
        if (next) {
          // enable TTS playback
          console.log("[A11] SpeechRecognition not available — enabling TTS-only mode");
        } else {
          console.log("[A11] Disabling TTS-only mode");
        }
        return next;
      });
      return;
    }

    if (voiceListening) {
      try { stopMic(); } catch {};
      setVoiceListening(false);
      cancelSpeech();
    } else {
      try { await startMic(); setVoiceListening(true); } catch (e) { console.warn('startMic failed', e); }
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

  // NINDO layers (à adapter selon ton code)
  const nindoLayers = {
    core: DEFAULT_SYSTEM_NINDO,
    dev: '',
    project: '',
    session: '',
  };

  // Prompt système pour le mode CHAT normal
  const systemPromptChat = useMemo(() => {
    const parts: string[] = [];
    parts.push(`# NINDO CORE\n${nindoLayers.core}`);
    if (nindoLayers.project.trim()) {
      parts.push(`# NINDO PROJET\n${nindoLayers.project}`);
    }
    if (nindoLayers.session.trim()) {
      parts.push(`# NINDO SESSION\n${nindoLayers.session}`);
    }
    // Règle anti-blabla
    parts.push(
      `# RÈGLES\n- Réponds uniquement à la demande de l'utilisateur.\n- N'invente jamais de contexte ou de scénario.\n- Ne propose aucune action non demandée explicitement.\n- Ne réponds jamais par un JSON d'action, une enveloppe d'outil ou une pseudo commande.\n- Si la demande n'est pas claire, pose une seule question de clarification.\n- Si la question est triviale, réponds en une phrase maximum.`
    );
    return parts.join("\n\n---\n\n");
  }, [nindoLayers]);

  const systemPrompt = systemPromptChat;

  // Initialisation globale de window.speak au montage pour garantir le son
  useEffect(() => {
    (globalThis as any).speak = speak;
  }, []);

  // Chargement de l'historique backend au montage
  useEffect(() => {
    if (!isAuthenticated || isResetRoute) return;
    refreshA11History();
  }, [isAuthenticated, isResetRoute]);

  useEffect(() => {
    if (!isAuthenticated || isResetRoute) return;
    if (!hasAdminApiAccess()) {
      setRemoteProviderProfiles([]);
      setRemoteProviderError("");
      return;
    }
    refreshRemoteAiProfiles();
  }, [isAuthenticated, isResetRoute]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeView !== 'chat') return;
    refreshConversationActivity(currentConversationId);
    refreshConversationResources(currentConversationId);
  }, [isAuthenticated, activeView, currentConversationId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeView !== 'admin' || adminSection !== 'memory') return;
    if (!hasAdminApiAccess()) {
      setTechnicalMemoSummary(null);
      setTechnicalMemoError("");
      return;
    }
    refreshTechnicalMemoSummary();
  }, [isAuthenticated, activeView, adminSection]);

  useEffect(() => {
    if (!uploadFeedback) return;
    const timeout = globalThis.setTimeout(() => setUploadFeedback(""), 5000);
    return () => globalThis.clearTimeout(timeout);
  }, [uploadFeedback]);

  // Handler pour rafraîchir la liste de l'historique
  async function refreshA11History() {
    setLoadingHistory(true);
    try {
      const list = await fetchA11HistoryList();
      setA11History(list);
    } catch (error_) {
      console.warn('[A11] failed to refresh history', error_);
      setA11History([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function refreshTechnicalMemoSummary() {
    if (!hasAdminApiAccess()) {
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
      const conv = await fetchA11Conversation(convId);
      const normalizedMessages = mapBackendConversationMessages(conv.messages || []);
      setA11ConvMsgs(normalizedMessages);
      setActiveView('chat');
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
            name: convId === 'default' ? 'Session par defaut' : convId,
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
          ? `Dry run OK (${removedTotal} candidats) • facts ${effectiveRemoved.facts}, tasks ${effectiveRemoved.tasks}, files ${effectiveRemoved.files}`
          : `Purge OK (${removedTotal} supprimés) • facts ${result.before.facts}->${result.after.facts}, tasks ${result.before.tasks}->${result.after.tasks}, files ${result.before.files}->${result.after.files}`
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
      setTechnicalMemoFeedback("Suppression impossible: acces admin requis.");
      return;
    }
    setPurgingTechnicalMemos(true);
    setTechnicalMemoConfirmOpen(false);
    setTechnicalMemoFeedback("Reinitialisation de la memoire non cruciale en cours...");
    setTechnicalMemoError("");

    try {
      const result = await purgeTechnicalMemos();
      const removedEntries = Number(result?.removedEntries || 0);
      const removedFiles = Number(result?.removedFiles || 0);
      setTechnicalMemoFeedback(
        removedEntries > 0
          ? `Memoire non cruciale reinitialisee. ${removedEntries} entree(s), ${removedFiles} fichier(s).`
          : "La memoire non cruciale etait deja vide."
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
      const result = await clearA11History();
      const removedCount = Number(result?.removedConversations || 0);
      feedback = removedCount > 0
        ? `Historique supprime. ${removedCount} conversation(s) A-11 effacee(s).`
        : "Historique supprime. Cote A-11, il n'y avait plus rien a effacer.";
    } catch (error_) {
      const errorMessage = (error_ as Error).message || String(error_);
      feedback = `Historique local efface, mais la purge A-11 a echoue: ${errorMessage}`;
    }

    try {
      localStorage.removeItem(buildScopedStorageKey(CHAT_STORAGE_KEY_PREFIX, authStorageScope));
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
      await clearA11History(convId);

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

  // HEADER avec bouton Mode DEV centré, select modèle à droite, mute à l'extrême droite
  
  // ✅ Check authentication
  if (isResetRoute) {
    return <ResetPasswordPanel />;
  }

  if (!isAuthenticated) {
    return <LoginPanel onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  const userDisplayName = String(displayName || "").trim() || "Utilisateur";
  const inspectorBadgeCount = conversationResources.length + conversationActivity.length;
  const utilityButtonStyle: React.CSSProperties = {
    padding: isCompactLayout ? "8px 10px" : "8px 12px",
    borderRadius: 10,
    border: "1px solid #1f2937",
    background: "#020617",
    color: "#e2e8f0",
    cursor: "pointer",
    fontSize: isCompactLayout ? 12 : 13,
    fontWeight: 600,
    minHeight: 40,
  };
  const headerSelectStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    background: "#181f2a",
    color: "#e5e7eb",
    border: "1px solid #22293a",
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
    fontSize: isCompactLayout ? 18 : 22,
    lineHeight: 1,
    letterSpacing: 0.6,
    whiteSpace: "nowrap",
    background: "linear-gradient(135deg, #f5d0fe 0%, #c084fc 30%, #a855f7 58%, #7c3aed 100%)",
    WebkitBackgroundClip: "text",
    color: "transparent",
    textShadow: "0 0 24px rgba(168, 85, 247, 0.22)",
  };
  const adminTabButtonStyle = (section: AdminSection): React.CSSProperties => ({
    padding: isCompactLayout ? "8px 10px" : "9px 12px",
    borderRadius: 999,
    border: `1px solid ${adminSection === section ? "#7c3aed" : "#1f2937"}`,
    background: adminSection === section ? "rgba(124, 58, 237, 0.2)" : "#0b1220",
    color: adminSection === section ? "#f3e8ff" : "#cbd5e1",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  });

  return (
    <div className="app-container a11-shell" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      <header
        className="header"
        style={{
          width: "100%",
          minHeight: isCompactLayout ? 56 : 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isCompactLayout ? "10px 12px" : "10px 20px",
          borderBottom: "1px solid #111827",
          background: "#0a101a",
          zIndex: settingsMenuOpen ? 90 : 50,
          gap: 12,
          flexWrap: isCompactLayout ? "wrap" : "nowrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: isCompactLayout ? 10 : 16, minWidth: 0 }}>
          <div
            id="a11-avatar"
            style={{
              position: "relative",
              width: isCompactLayout ? 42 : 56,
              height: isCompactLayout ? 42 : 56,
              borderRadius: 999,
              overflow: "hidden",
              boxShadow: "0 0 12px #22d3ee99",
              flexShrink: 0,
            }}
          >
            <img
              id="a11-avatar-idle"
              src={A11_AVATAR_IDLE_SRC}
              alt="A11"
              fetchPriority="high"
              onError={(event) => applyImageFallback(event, A11_AVATAR_IDLE_FALLBACK_SRC)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: audioPlaying ? 0 : 1,
                transition: "opacity 160ms linear",
              }}
            />
            <img
              id="a11-avatar-gif"
              src={A11_AVATAR_TALKING_SRC}
              alt=""
              aria-hidden="true"
              onError={(event) => applyImageFallback(event, A11_AVATAR_TALKING_FALLBACK_SRC)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: audioPlaying ? 1 : 0,
                transition: "opacity 160ms linear",
                pointerEvents: "none",
              }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={a11TitleStyle}>A11</div>
            {!isCompactLayout ? (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>Assistant local NOSSEN</div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
          {isCompactLayout ? (
            <button
              type="button"
              onClick={() => setSidebarOpen((value) => !value)}
              style={utilityButtonStyle}
              title="Ouvrir les conversations et l'historique"
            >
              {sidebarOpen ? "Fermer" : "Discussions"}
            </button>
          ) : null}
          <div ref={settingsMenuRef} style={{ position: "relative" }}>
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
              title="Afficher les réglages"
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
                  <div style={menuSectionTitleStyle}>Options</div>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectorOpen((value) => !value);
                      if (isCompactLayout) setSettingsMenuOpen(false);
                    }}
                    className="btn ghost"
                    style={{ width: "100%", justifyContent: "space-between" }}
                    title="Afficher les ressources et l'activite de conversation"
                  >
                    <span>Panneau conversation</span>
                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>
                      {inspectorOpen ? "Ouvert" : (inspectorBadgeCount ? `${inspectorBadgeCount}` : "Ferme")}
                    </span>
                  </button>
                  <MuteButton showLabel fullWidth />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={menuSectionTitleStyle}>Navigation</div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("admin");
                      setAdminSection("ai");
                      setSettingsMenuOpen(false);
                      setSidebarOpen(false);
                    }}
                    className="btn ghost"
                    style={{ width: "100%", justifyContent: "space-between" }}
                  >
                    <span>Profils IA</span>
                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>{remoteProviderProfiles.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("admin");
                      setAdminSection("cockpit");
                      setSettingsMenuOpen(false);
                      setSidebarOpen(false);
                    }}
                    className="btn ghost"
                    style={{ width: "100%", justifyContent: "space-between" }}
                  >
                    <span>Espace admin</span>
                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>Cockpit</span>
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={menuSectionTitleStyle}>Session</div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      setDisplayName("Utilisateur");
                      logout();
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
                      justifyContent: "space-between",
                      color: "#fca5a5",
                      borderColor: "#7f1d1d",
                    }}
                    title="Se deconnecter"
                  >
                    <span>Se deconnecter</span>
                    <span style={{ fontWeight: 700 }}>Quitter</span>
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

        {(!isCompactLayout || sidebarOpen) ? (
        <aside
          className="sidebar"
          style={{
            width: isCompactLayout ? 'min(86vw, 320px)' : 300,
            borderRight: "1px solid #22293a",
            background: "#0a101a",
            display: 'flex',
            flexDirection: 'column',
            minWidth: isCompactLayout ? 'min(86vw, 320px)' : 300,
            position: isCompactLayout ? 'absolute' : 'relative',
            inset: isCompactLayout ? '0 auto 0 0' : 'auto',
            zIndex: 30,
            boxShadow: isCompactLayout ? '18px 0 42px rgba(2, 6, 23, 0.55)' : 'none',
          }}
        >
          {/* Bloc conversations locales */}
          <div style={{ borderBottom: '1px solid #22293a', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 4px 16px' }}>
              <span className="text-xs uppercase tracking-wide text-slate-400">Conversations locales</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={newConversation} className="btn ghost" style={{ fontSize: 13, padding: '2px 10px' }}>+ Nouvelle</button>
                <button
                  type="button"
                  onClick={() => setClearHistoryConfirmOpen(true)}
                  className="btn ghost"
                  disabled={clearingHistory}
                  title="Supprimer toutes les conversations locales et l'historique A-11"
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
                      setActiveView('chat');
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
                    <button onClick={e => { e.stopPropagation(); renameChat(chat.id); }} title="Renommer" className="btn ghost" style={{ fontSize: 13 }}>✏️</button>
                    <button onClick={e => { e.stopPropagation(); deleteChat(chat.id); }} title="Supprimer" className="btn ghost" style={{ fontSize: 13 }}>🗑️</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* Historique backend */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Historique A-11
              </span>
              <button onClick={refreshA11History} className="text-[11px] text-slate-400 hover:text-slate-200">
                ↻
              </button>
            </div>
            {loadingHistory ? (
              <div className="p-3 text-xs text-slate-400">Chargement…</div>
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
          {activeView === 'admin' ? (
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: isCompactLayout ? 12 : 20,
              }}
            >
              <div style={{ width: '100%', maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                        Vue admin
                      </div>
                      <h2 style={{ margin: '6px 0 0', color: '#e2e8f0' }}>Cockpit A11</h2>
                      <p style={{ color: '#94a3b8', margin: '8px 0 0', maxWidth: 720 }}>
                        Les éléments système restent ici, hors de l’interface utilisateur principale. La vue chat conserve uniquement l’usage normal et les outils utiles.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('chat')}
                      className="btn ghost"
                      style={{ alignSelf: 'flex-start', justifyContent: 'center' }}
                    >
                      Retour au chat
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" onClick={() => setAdminSection('cockpit')} style={adminTabButtonStyle('cockpit')}>
                      Cockpit
                    </button>
                    <button type="button" onClick={() => setAdminSection('memory')} style={adminTabButtonStyle('memory')}>
                      Memoire
                    </button>
                    <button type="button" onClick={() => setAdminSection('runtime')} style={adminTabButtonStyle('runtime')}>
                      Runtime
                    </button>
                    <button type="button" onClick={() => setAdminSection('ai')} style={adminTabButtonStyle('ai')}>
                      IA
                    </button>
                    <button type="button" onClick={() => setAdminSection('console')} style={adminTabButtonStyle('console')}>
                      Console
                    </button>
                  </div>
                </div>

                {adminSection === 'cockpit' ? <A11ControlCenterPanel /> : null}

                {adminSection === 'ai' ? (
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

                {adminSection === 'memory' ? (
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
                        <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: 15 }}>Memoire non cruciale</h4>
                        <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: 13 }}>
                          Snapshots techniques admin, etat Qflush et traces internes. Cela n&apos;efface pas l&apos;historique global du chat utilisateur ni la memoire critique.
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
                            {loadingTechnicalMemos ? '...' : (technicalMemoSummary?.total ?? '—')}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2937', background: '#0b1220', color: '#cbd5e1', fontSize: 12 }}>
                          <div style={{ color: '#8b9bb4', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 11 }}>Plus recent</div>
                          <div style={{ marginTop: 6, color: '#e2e8f0' }}>
                            {technicalMemoSummary?.latestTs ? new Date(technicalMemoSummary.latestTs).toLocaleString() : '—'}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2937', background: '#0b1220', color: '#cbd5e1', fontSize: 12 }}>
                          <div style={{ color: '#8b9bb4', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, fontSize: 11 }}>Types</div>
                          <div style={{ marginTop: 6, color: '#e2e8f0' }}>
                            {technicalMemoSummary?.byType && Object.keys(technicalMemoSummary.byType).length
                              ? Object.entries(technicalMemoSummary.byType).map(([type, count]) => `${type} (${count})`).join(' · ')
                              : '—'}
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
                          {purgingTechnicalMemos ? 'Reinitialisation...' : 'Reinitialiser la memoire non cruciale'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {adminSection === 'runtime' ? <A11OpsStatusPanel /> : null}
                {adminSection === 'console' ? (
                  <A11CommandConsolePanel
                    prefillCommand={consoleSuggestion?.command || null}
                    prefillReason={consoleSuggestion?.reason || null}
                    prefillNonce={consoleSuggestion?.nonce || 0}
                  />
                ) : null}
              </div>
            </div>
          ) : (
          <>
          <div className="scroll-frame" style={{ margin: isCompactLayout ? 8 : 12 }}>
            <div className="log">
              {messages.map((m, idx) => {
                const exportSuggestion = m.role === "assistant" ? detectAssistantExportSuggestion(m.content) : null;
                let messageClassName = "message ";
                let roleLabel = "Système / Nindo";
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
                  roleLabel = "A11";
                  roleStyle = {
                    color: "#c084fc",
                    textShadow: "0 0 16px rgba(192, 132, 252, 0.24)",
                  };
                }
                const contentNode = m.role === "assistant"
                  ? (
                    <ReactMarkdown
                      components={{
                        a: ({ node: _node, ...props }) => (
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

                return (
                  <div
                    key={m.id || idx}
                    className={messageClassName}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div className="role" style={roleStyle}>{roleLabel}</div>
                      {messageTimestamp ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            letterSpacing: 0.2,
                          }}
                        >
                          {messageTimestamp}
                        </div>
                      ) : null}
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
                          Réponse Qflush non vérifiée
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>
                          {String(m.qflushVerification.summary || "Cette réponse a été marquée comme douteuse par le garde-fou Qflush.")}
                        </div>
                      </div>
                    ) : null}
                    {contentNode}
                    {m.imageUrl && (
                      <div className="msg-image">
                        <button
                          type="button"
                          className="image-preview-trigger"
                          onClick={() => setPreviewImageUrl(m.imageUrl || null)}
                          aria-label="Agrandir l'image"
                        >
                          <img
                            src={m.imageUrl}
                            alt="Résultat A11"
                            style={{ maxWidth: "320px", borderRadius: 12 }}
                          />
                          <span style={{ fontSize: 12, color: "#93c5fd" }}>Agrandir l'image</span>
                        </button>
                      </div>
                    )}
                    {exportSuggestion ? (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: `1px solid ${exportSuggestion.accent}`,
                          background: "#0b1220",
                          color: "#e2e8f0",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: exportSuggestion.accent, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Pret a exporter · {exportSuggestion.label}
                        </div>
                        <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
                          {exportSuggestion.hint}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="composer"
            style={{
              padding: isCompactLayout ? "8px 10px calc(10px + env(safe-area-inset-bottom))" : undefined,
            }}
          >
            <div className="row">
              <button
                type="button"
                className="btn ghost import-inline"
                onClick={onImportClick}
                title="Importer un fichier texte"
                style={{ marginRight: 8, padding: isCompactLayout ? "0 10px" : undefined }}
              >
                {isCompactLayout ? "Import" : "Importer"}
              </button>

              <textarea
                placeholder="Demande quelque chose à A11…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />

              <button
                type="button"
                className="send-button"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                title="Entrée pour envoyer, Shift+Entrée pour aller à la ligne"
              >
                {sending ? "…" : "➤"}
              </button>

              <button
                type="button"
                className={`nossen-mic-btn inline ${(voiceListening || ttsFallback || audioPlaying) ? 'listening' : ''}`}
                onClick={toggleMic}
                title="Toggle microphone / TTS"
                style={{ marginLeft: 8 }}
              >
                {(voiceListening || ttsFallback || audioPlaying) ? '🎙️' : '🎤'}
              </button>
            </div>
            <div className="hint">
              Entrée pour envoyer · Shift+Entrée pour aller à la ligne
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={onFileChange}
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
      {!isCompactLayout ? (
      <footer className="footer">
        A11 / Qflush UI · Cerbère 4545 · LLaMA local · Funesterie
      </footer>
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
        message="Cette action va vider toutes les conversations locales du navigateur et l'historique A-11 cote serveur. Une nouvelle session propre sera recreee juste apres."
        confirmLabel="Tout supprimer"
        confirmTone="danger"
        loading={clearingHistory}
        onClose={() => setClearHistoryConfirmOpen(false)}
        onConfirm={handleClearAllConversationHistory}
      />
      <ConfirmModal
        open={!!deleteA11HistoryId}
        title="Supprimer cette conversation A-11"
        message="Cette conversation sera retiree de l'historique A-11 cote serveur et de la copie locale si elle est ouverte."
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
        title="Reinitialiser la memoire non cruciale"
        message="Cette action efface les snapshots techniques locaux d'A11 (env, qflush, journaux memo). Cela ne touche pas l'historique de conversation utilisateur ni la memoire critique."
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
          aria-label="Aperçu de l'image"
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
              aria-label="Fermer l'aperçu"
            >
              ×
            </button>
            <img
              src={previewImageUrl}
              alt="Aperçu agrandi"
              className="image-preview-modal-image"
            />
          </div>
        </div>
      )}
      {audioBlockedUrl && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
          padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)', zIndex: 9999,
          color: '#e2e8f0', fontSize: 14, whiteSpace: 'nowrap',
        }}>
          <span>🔇 Audio bloqué</span>
          <button
            type="button"
            onClick={() => { retryPlayUrl(audioBlockedUrl); setAudioBlockedUrl(null); }}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            ▶ Jouer
          </button>
          <button
            type="button"
            onClick={() => setAudioBlockedUrl(null)}
            style={{ background: 'none', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
            title="Ignorer"
          >×</button>
        </div>
      )}
    </div>
  );
}

export default App;
