/**
 * Canonical Cerbere router.
 *
 * This file is the source of truth for the embedded LLM router used by
 * `server.cjs`. It can also be mounted by a standalone runner, but it should
 * remain a pure router module and not create its own HTTP server directly.
 */
require("dotenv").config();
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const child_process = require("node:child_process");

// -------------------------------------------
// DEV_MODE doit être défini avant toute utilisation
// -------------------------------------------
const DEV_MODE = String(process.env.DEV_MODE || "").toLowerCase() === "true";
console.log(`[Cerbère] DEV_MODE=${DEV_MODE ? "true" : "false"}`);

// Ollama backend config (env or default)
const OLLAMA_HOST = process.env.OLLAMA_HOST || "127.0.0.1";
const OLLAMA_PORT = process.env.OLLAMA_PORT || "11434";
const DEFAULT_OLLAMA_BASE = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;

// Import A-11 agent prompts
const {
  A11_AGENT_SYSTEM_PROMPT,
  A11_AGENT_DEV_PROMPT,
} = require("./lib/a11Agent.js");

/// IMPORTANT: on utilise TOOL_IMPL comme “catalogue”
const { TOOL_IMPL } = require("./src/a11/tools-dispatcher.cjs");

const fsp = require("node:fs/promises");

const DATA_ROOT = process.env.A11_DATA_ROOT || "D:/A12";
const LTM_DIR = path.join(DATA_ROOT, "a11_memory", "long_term");
const ARCHIVE_DIR = path.join(DATA_ROOT, "a11_memory", "archives");
const BOOT_MEMO_PATH = path.join(DATA_ROOT, "a11_memory", "boot_memo.txt");
const MODULES_ROOT = process.env.A11_MODULES_ROOT || path.join(DATA_ROOT, "modules");

const router = express.Router();
router.use(express.json({ limit: "2mb" }));
router.use(cors());

// ─────────────────────────────────────────────────────────────
// Configuration globale
// ─────────────────────────────────────────────────────────────
const PORT = process.env.CERBERE_PORT || 4545;

// -------------------------------------------
// SECTION 1.3 — ANSI COLORS (Debug mode)
// -------------------------------------------
const COLOR = {
  reset: "\x1b[0m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m", // ✅ corrigé (t’avais un ] en trop)
};

function logStrategist(msg) {
  if (DEV_MODE) console.log(COLOR.blue + msg + COLOR.reset);
  else console.log(msg);
}
function logThinker(msg) {
  if (DEV_MODE) console.log(COLOR.yellow + msg + COLOR.reset);
  else console.log(msg);
}
function logMaker(msg) {
  if (DEV_MODE) console.log(COLOR.green + msg + COLOR.reset);
  else console.log(msg);
}
function logPipeline(msg) {
  if (DEV_MODE) console.log(COLOR.red + msg + COLOR.reset);
  else console.log(msg);
}
function logTool(msg) {
  if (DEV_MODE) console.log(COLOR.cyan + msg + COLOR.reset);
  else console.log(msg);
}
function logInfo(msg) {
  if (DEV_MODE) console.log(COLOR.magenta + msg + COLOR.reset);
  else console.log(msg);
}
function logError(msg) {
  if (DEV_MODE) console.error(COLOR.red + msg + COLOR.reset);
  else console.error(msg);
}
function logWarn(msg) {
  if (DEV_MODE) console.warn(COLOR.yellow + msg + COLOR.reset);
  else console.warn(msg);
}

// Workspace : dossier dans lequel A-11 a le droit d’écrire
const DEFAULT_WORKSPACE = String.raw`D:\A12`;
let WORKSPACE_ROOT = path.resolve(process.env.A11_WORKSPACE_ROOT || DEFAULT_WORKSPACE);
console.log("[Cerbère] Workspace root:", WORKSPACE_ROOT);

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeLlmProvider(value, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "ollama") return "ollama";
  if (normalized === "openai") return "openai";
  if (["llama_server", "llama-server", "llama", "local"].includes(normalized)) return "llama_server";
  if (["none", "disabled", "off"].includes(normalized)) return "none";
  return fallback;
}

function deriveDefaultLlmProvider() {
  const explicit = normalizeLlmProvider(process.env.A11_LLM_PROVIDER, "");
  if (explicit) return explicit;
  if (process.env.OLLAMA_BASE || process.env.OLLAMA_HOST || process.env.OLLAMA_PORT) return "ollama";
  if (process.env.LLAMA_BASE || process.env.LOCAL_LLM_URL) return "llama_server";
  if (process.env.A11_OPENAI_API_KEY || process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

// ========================================================================
//    SECTION 2 — BACKENDS & MODEL SELECTION
// ========================================================================
const BACKENDS = {
  openai: normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
  ollama: normalizeBaseUrl(process.env.OLLAMA_BASE || DEFAULT_OLLAMA_BASE),
  llama_server: normalizeBaseUrl(process.env.LLAMA_BASE || process.env.LOCAL_LLM_URL || ""),
};
const OLLAMA_BASE = BACKENDS.ollama;
const LLM_PROVIDER = deriveDefaultLlmProvider();
const LLM_FALLBACK_PROVIDER = normalizeLlmProvider(process.env.A11_LLM_FALLBACK_PROVIDER, "llama_server");
const OLLAMA_PRIMARY_MODEL = String(process.env.A11_OLLAMA_PRIMARY_MODEL || "gemma4:e4b").trim() || "gemma4:e4b";
const OLLAMA_FALLBACK_MODEL = String(process.env.A11_OLLAMA_FALLBACK_MODEL || "gemma4:e2b").trim() || "gemma4:e2b";
const DEFAULT_LOCAL_MODEL = String(
  process.env.LOCAL_DEFAULT_MODEL
  || process.env.DEFAULT_MODEL
  || process.env.LLAMA_MODEL
  || "llama3.2:latest"
).trim() || "llama3.2:latest";
const DEFAULT_OPENAI_MODEL = String(process.env.OPENAI_MODEL || process.env.A11_OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
const THINKER_MODEL = String(process.env.CERBERE_THINKER_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
const MAKER_MODEL = String(process.env.CERBERE_MAKER_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
const LLM_REQUEST_TIMEOUT_MS = Number(process.env.A11_LLM_REQUEST_TIMEOUT_MS || 15000) || 15000;
const OLLAMA_TAGS_CACHE_TTL_MS = Number(process.env.A11_OLLAMA_TAGS_CACHE_TTL_MS || 5000) || 5000;

const llmRuntimeState = {
  lastResolvedTarget: null,
  lastResolvedAt: null,
  lastOllamaTags: null,
  lastOllamaTagsAt: 0,
  lastError: null,
};

logInfo("[Cerbère] Backends configurés: " + JSON.stringify(BACKENDS));
logInfo(`[Cerbère] LLM provider=${LLM_PROVIDER} primary=${OLLAMA_PRIMARY_MODEL} fallback=${OLLAMA_FALLBACK_MODEL} finalFallback=${LLM_FALLBACK_PROVIDER}`);

function rememberLlmError(error, extra = {}) {
  llmRuntimeState.lastError = {
    at: new Date().toISOString(),
    message: String(error?.message || error || "unknown_error"),
    ...extra,
  };
}

function rememberResolvedTarget(target, extra = {}) {
  const snapshot = {
    provider: target.provider,
    model: target.model,
    baseUrl: target.baseUrl,
    url: target.url,
    reason: target.reason || null,
    resolvedAt: new Date().toISOString(),
    ...extra,
  };
  llmRuntimeState.lastResolvedTarget = snapshot;
  llmRuntimeState.lastResolvedAt = snapshot.resolvedAt;
  llmRuntimeState.lastError = null;
  return snapshot;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = LLM_REQUEST_TIMEOUT_MS) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data, text };
}

function buildOllamaTagsUrl() {
  return `${BACKENDS.ollama}/api/tags`;
}

function buildOllamaChatUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/chat`;
}

function buildLlamaServerCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";
  if (/\/v1\/chat\/completions$/i.test(normalized) || /\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

function normalizeOllamaModelNames(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return Array.from(new Set(
    models
      .map((entry) => String(entry?.model || entry?.name || "").trim())
      .filter(Boolean)
  ));
}

function getConfiguredOllamaCandidates(requestedModel = "") {
  const candidates = [];
  const explicit = String(requestedModel || "").trim();
  if (explicit && [OLLAMA_PRIMARY_MODEL, OLLAMA_FALLBACK_MODEL].includes(explicit)) {
    candidates.push(explicit);
  }
  for (const candidate of [OLLAMA_PRIMARY_MODEL, OLLAMA_FALLBACK_MODEL]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

async function getOllamaTags({ force = false } = {}) {
  if (!BACKENDS.ollama) {
    return { ok: false, error: "ollama_base_missing", models: [] };
  }

  const now = Date.now();
  if (
    !force
    && Array.isArray(llmRuntimeState.lastOllamaTags)
    && (now - llmRuntimeState.lastOllamaTagsAt) < OLLAMA_TAGS_CACHE_TTL_MS
  ) {
    return {
      ok: true,
      cached: true,
      models: [...llmRuntimeState.lastOllamaTags],
      baseUrl: BACKENDS.ollama,
    };
  }

  try {
    const { response, data, text } = await fetchJsonWithTimeout(buildOllamaTagsUrl(), {}, Math.min(LLM_REQUEST_TIMEOUT_MS, 6000));
    if (!response.ok) {
      return {
        ok: false,
        error: `ollama_http_${response.status}`,
        detail: text || "",
        status: response.status,
        models: [],
        baseUrl: BACKENDS.ollama,
      };
    }
    const models = normalizeOllamaModelNames(data);
    llmRuntimeState.lastOllamaTags = models;
    llmRuntimeState.lastOllamaTagsAt = now;
    return {
      ok: true,
      cached: false,
      models,
      raw: data,
      baseUrl: BACKENDS.ollama,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "TimeoutError" ? "ollama_timeout" : "ollama_unreachable",
      detail: error?.message || String(error),
      models: [],
      baseUrl: BACKENDS.ollama,
    };
  }
}

async function probeLlamaServerHealth() {
  if (!BACKENDS.llama_server) {
    return { ok: false, error: "llama_server_base_missing", baseUrl: "" };
  }
  const healthUrl = `${BACKENDS.llama_server}/health`;
  try {
    const { response, data, text } = await fetchJsonWithTimeout(healthUrl, {}, Math.min(LLM_REQUEST_TIMEOUT_MS, 5000));
    return {
      ok: response.ok,
      status: response.status,
      baseUrl: BACKENDS.llama_server,
      healthUrl,
      detail: response.ok ? data : (text || data || ""),
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "TimeoutError" ? "llama_server_timeout" : "llama_server_unreachable",
      detail: error?.message || String(error),
      baseUrl: BACKENDS.llama_server,
      healthUrl,
    };
  }
}

function resolveLlamaServerTarget(requestedModel = "", reason = "") {
  if (!BACKENDS.llama_server) return null;
  const model = String(requestedModel || DEFAULT_LOCAL_MODEL).trim() || DEFAULT_LOCAL_MODEL;
  return {
    provider: "llama_server",
    model,
    baseUrl: BACKENDS.llama_server,
    url: buildLlamaServerCompletionsUrl(BACKENDS.llama_server),
    reason: reason || null,
  };
}

function resolveOpenAITarget(requestedModel = "", reason = "") {
  const model = String(requestedModel || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  return {
    provider: "openai",
    model,
    baseUrl: BACKENDS.openai,
    url: buildOpenAICompletionsUrl(BACKENDS.openai),
    reason: reason || null,
  };
}

async function resolveOllamaTarget(requestedModel = "", { emitLogs = true } = {}) {
  const tags = await getOllamaTags();
  if (!tags.ok) {
    return { ok: false, reason: tags.error || "ollama_unavailable", detail: tags.detail || "", tags };
  }

  const candidates = getConfiguredOllamaCandidates(requestedModel);
  for (const candidate of candidates) {
    if (tags.models.includes(candidate)) {
      if (emitLogs && candidate === OLLAMA_FALLBACK_MODEL && candidate !== OLLAMA_PRIMARY_MODEL) {
        logWarn(`[LLM] fallback=${candidate} reason=primary_unavailable`);
      }
      return {
        ok: true,
        target: {
          provider: "ollama",
          model: candidate,
          baseUrl: BACKENDS.ollama,
          url: buildOllamaChatUrl(BACKENDS.ollama),
          reason: candidate === OLLAMA_PRIMARY_MODEL ? null : "primary_unavailable",
        },
        tags,
      };
    }
  }

  return {
    ok: false,
    reason: "ollama_model_missing",
    detail: `Configured models not installed on Ollama (${candidates.join(", ")})`,
    tags,
  };
}

async function resolveLlmTarget(requestedModel = "", { emitLogs = true } = {}) {
  const provider = normalizeLlmProvider(LLM_PROVIDER, "openai");

  if (provider === "ollama") {
    const ollamaResult = await resolveOllamaTarget(requestedModel, { emitLogs });
    if (ollamaResult.ok) {
      if (emitLogs) logInfo(`[LLM] provider=ollama model=${ollamaResult.target.model}`);
      rememberResolvedTarget(ollamaResult.target, {
        availableOllamaModels: ollamaResult.tags?.models || [],
      });
      return ollamaResult.target;
    }

    if (emitLogs) {
      rememberLlmError(ollamaResult.detail || ollamaResult.reason, {
        provider: "ollama",
        reason: ollamaResult.reason,
      });
    }

    if (LLM_FALLBACK_PROVIDER === "llama_server") {
      const llamaTarget = resolveLlamaServerTarget(requestedModel, ollamaResult.reason || "ollama_unavailable");
      if (llamaTarget) {
        if (emitLogs) logWarn(`[LLM] fallback=llama-server reason=${ollamaResult.reason || "ollama_unavailable"}`);
        rememberResolvedTarget(llamaTarget, {
          availableOllamaModels: ollamaResult.tags?.models || [],
        });
        return llamaTarget;
      }
    }

    if (LLM_FALLBACK_PROVIDER === "openai") {
      const openAiTarget = resolveOpenAITarget(requestedModel, ollamaResult.reason || "ollama_unavailable");
      if (emitLogs) logWarn(`[LLM] fallback=openai reason=${ollamaResult.reason || "ollama_unavailable"}`);
      rememberResolvedTarget(openAiTarget, {
        availableOllamaModels: ollamaResult.tags?.models || [],
      });
      return openAiTarget;
    }

    throw new Error(ollamaResult.detail || ollamaResult.reason || "ollama_resolution_failed");
  }

  if (provider === "llama_server") {
    const llamaTarget = resolveLlamaServerTarget(requestedModel, "provider_forced");
    if (!llamaTarget) {
      throw new Error("llama_server_base_missing");
    }
    if (emitLogs) logInfo(`[LLM] provider=llama-server model=${llamaTarget.model}`);
    rememberResolvedTarget(llamaTarget);
    return llamaTarget;
  }

  const openAiTarget = resolveOpenAITarget(requestedModel, "provider_forced");
  if (emitLogs) logInfo(`[LLM] provider=openai model=${openAiTarget.model}`);
  rememberResolvedTarget(openAiTarget);
  return openAiTarget;
}

function normalizeMessageContentForOllama(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && entry.type === "text") {
          return String(entry.text || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  return String(content || "");
}

function buildOllamaMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    role: String(message?.role || "user"),
    content: normalizeMessageContentForOllama(message?.content),
  }));
}

function toOpenAIStyleResponseFromOllama(payload, model) {
  const content = sanitizeAssistantText(String(payload?.message?.content || ""));
  const promptTokens = Number(payload?.prompt_eval_count || 0) || 0;
  const completionTokens = Number(payload?.eval_count || 0) || 0;
  const finishReason = String(payload?.done_reason || "").trim() || (payload?.done ? "stop" : "length");

  return {
    id: `cerbere-ollama-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    provider: "ollama",
  };
}

async function getLlmDebugSnapshot({ force = false } = {}) {
  const ollamaTags = await getOllamaTags({ force });
  const llamaHealth = await probeLlamaServerHealth();

  let active = llmRuntimeState.lastResolvedTarget;
  try {
    const target = await resolveLlmTarget("", { emitLogs: false });
    active = {
      provider: target.provider,
      model: target.model,
      baseUrl: target.baseUrl,
      url: target.url,
      reason: target.reason || null,
      resolvedAt: new Date().toISOString(),
    };
  } catch (error) {
    rememberLlmError(error, { provider: LLM_PROVIDER });
    active = {
      provider: null,
      model: null,
      baseUrl: null,
      url: null,
      reason: String(error?.message || error || "resolution_failed"),
      resolvedAt: new Date().toISOString(),
    };
  }

  return {
    configured: {
      provider: LLM_PROVIDER,
      fallbackProvider: LLM_FALLBACK_PROVIDER,
      ollamaPrimaryModel: OLLAMA_PRIMARY_MODEL,
      ollamaFallbackModel: OLLAMA_FALLBACK_MODEL,
      openaiModel: DEFAULT_OPENAI_MODEL,
      localModel: DEFAULT_LOCAL_MODEL,
    },
    active,
    providers: {
      openai: {
        configured: true,
        baseUrl: BACKENDS.openai,
        model: DEFAULT_OPENAI_MODEL,
        apiKeyConfigured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()),
      },
      ollama: {
        configured: Boolean(BACKENDS.ollama),
        baseUrl: BACKENDS.ollama,
        ok: ollamaTags.ok,
        error: ollamaTags.ok ? null : ollamaTags.error || null,
        detail: ollamaTags.ok ? null : ollamaTags.detail || null,
        models: ollamaTags.models || [],
        primaryInstalled: (ollamaTags.models || []).includes(OLLAMA_PRIMARY_MODEL),
        fallbackInstalled: (ollamaTags.models || []).includes(OLLAMA_FALLBACK_MODEL),
      },
      llama_server: {
        configured: Boolean(BACKENDS.llama_server),
        baseUrl: BACKENDS.llama_server,
        ok: llamaHealth.ok,
        error: llamaHealth.ok ? null : llamaHealth.error || null,
        detail: llamaHealth.ok ? llamaHealth.detail || null : llamaHealth.detail || null,
        healthUrl: llamaHealth.healthUrl || null,
      },
    },
    lastError: llmRuntimeState.lastError,
    lastResolvedAt: llmRuntimeState.lastResolvedAt,
  };
}

// expose simple stats for frontend dev checks
router.get(["/api/stats", "/api/llm/stats"], (req, res) => {
  res.json({
    service: "cerbere-router",
    version: "2.0.0",
    routerKind: "embedded-router",
    routerEntrypoint: "llm-router.cjs",
    standaloneRunner: "llm-router-runner.cjs",
    canonical: true,
    mode: DEV_MODE ? "developer" : "production",
    backends: BACKENDS,
    llm: {
      provider: LLM_PROVIDER,
      fallbackProvider: LLM_FALLBACK_PROVIDER,
      ollamaPrimaryModel: OLLAMA_PRIMARY_MODEL,
      ollamaFallbackModel: OLLAMA_FALLBACK_MODEL,
      localModel: DEFAULT_LOCAL_MODEL,
      openaiModel: DEFAULT_OPENAI_MODEL,
    },
    features: ["strict_proxy", "multi_backend_routing", "smart_prompting", "ollama_fallback"],
  });
});
console.log("[Cerbère] Registered debug stats routes: /api/stats, /api/llm/stats");

router.get("/api/llm/models", async (_req, res) => {
  try {
    const snapshot = await getLlmDebugSnapshot();
    return res.json({
      ok: true,
      configured: snapshot.configured,
      models: {
        ollamaInstalled: snapshot.providers.ollama.models,
        localDefault: snapshot.configured.localModel,
        openaiDefault: snapshot.configured.openaiModel,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

router.get("/api/llm/active", async (_req, res) => {
  try {
    const snapshot = await getLlmDebugSnapshot();
    return res.json({
      ok: true,
      active: snapshot.active,
      configured: snapshot.configured,
      lastError: snapshot.lastError,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

router.get("/api/llm/health", async (_req, res) => {
  try {
    const snapshot = await getLlmDebugSnapshot({ force: true });
    return res.json({
      ok: true,
      configured: snapshot.configured,
      active: snapshot.active,
      providers: snapshot.providers,
      lastError: snapshot.lastError,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

// -------------------------------------------
// 2.2 — STRATEGISTE 64K (Ollama)
// -------------------------------------------
const STRATEGIST_BACKEND = {
  url: `${OLLAMA_BASE}/api/generate`,
  model: process.env.CERBERE_STRATEGIST_MODEL || "llama32-64k",
  options: {
    num_ctx: 64000,
    temperature: 0.2,
    top_p: 0.9,
  },
};

logStrategist("[Cerbère] Strategist 64K initialisé");

// -------------------------------------------
// 2.3 — SAFE BACKEND SELECTOR
// -------------------------------------------
function selectBackend(model) {
  return BACKENDS.openai;
}

function buildOpenAICompletionsUrl(baseUrl) {
  const normalized = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function buildUpstreamHeaders(backendBase, provider = "openai") {
  const headers = { "Content-Type": "application/json" };
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
  }
  return headers;
}

// -------------------------------------------
// 2.4 — Extract last user message
// -------------------------------------------
function extractUserPrompt(messages = []) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return (lastUser?.content || "").toString();
}

// ========================================================================
//   SECTION 3 — STRATEGIST / THINKER / MAKER / PIPELINE
// ========================================================================
async function callStrategist(userPrompt) {
  logStrategist("[Cerbère][STRATÉGISTE] Analyse OpenAI");
  return await callThinker(`Planifie clairement la meilleure réponse à cette demande:\n${userPrompt}`);
}

async function callThinker(prompt) {
  logThinker(`[Cerbère][THINKER] ${THINKER_MODEL} engagé pour analyse`);

  const backendURL = buildOpenAICompletionsUrl(BACKENDS.openai);
  const body = { model: THINKER_MODEL, messages: [{ role: "user", content: prompt }] };

  try {
    const resp = await fetch(backendURL, {
      method: "POST",
      headers: buildUpstreamHeaders(BACKENDS.openai),
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || "[Thinker: Pas de sortie]";
    return String(text).trim();
  } catch (err) {
    logThinker("[Cerbère][THINKER] ERREUR : " + err.message);
    return "ERREUR_THINKER";
  }
}

async function callMaker(input) {
  logMaker(`[Cerbère][MAKER] ${MAKER_MODEL} engagé pour exécution`);

  const backendURL = buildOpenAICompletionsUrl(BACKENDS.openai);
  const messages = Array.isArray(input) ? input : [{ role: "user", content: input }];

  const body = { model: MAKER_MODEL, messages };

  try {
    const resp = await fetch(backendURL, {
      method: "POST",
      headers: buildUpstreamHeaders(BACKENDS.openai),
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || "[Maker: Pas de sortie]";
    return String(text).trim();
  } catch (err) {
    logMaker("[Cerbère][MAKER] ERREUR : " + err.message);
    return "ERREUR_MAKER";
  }
}

async function cerberePipeline(prompt) {
  logPipeline("🚀 [Cerbère] PIPELINE 3-TÊTES activé");

  const plan = await callStrategist(prompt);
  const thinker = await callThinker(`Analyse et améliore ce plan :\n${plan}`);
  const maker = await callMaker(
    `Voici un plan validé :\n${thinker}\n\nÉcris maintenant le résultat final complet, sans commentaire technique.`
  );

  return { plan, thinker, maker };
}

// ========================================================================
//   SECTION 4 — TOOLS A-11 (Fichiers, Web, QFlush, Actions)
// ========================================================================

// 4.1 — SAFE PATH (pas de ../ hack)
function resolveSafePath(relPath) {
  if (!relPath || typeof relPath !== "string") throw new Error("resolveSafePath: chemin invalide");
  const full = path.resolve(WORKSPACE_ROOT, relPath);
  if (!full.startsWith(WORKSPACE_ROOT)) throw new Error(`Tentative de sortie de la racine : ${relPath}`);
  return full;
}

const PROTECTED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.env',
  '.a11_backups',
  '.qflash',
  '.qflush'
]);

const SAFE_MODE = String(process.env.A11_SAFE_MODE ?? 'true').toLowerCase() !== 'false';

function hasDeleteConfirmation(msg = {}) {
  const token = String(msg.confirm || msg.confirmation || '').trim();
  return msg.confirmDelete === true && token === 'DELETE';
}

function isProtectedPath(targetPath) {
  const normalized = path.resolve(String(targetPath || '')).toLowerCase();
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment));
}

function assertNotProtectedPath(targetPath) {
  if (isProtectedPath(targetPath)) {
    throw new Error(`delete operation refused on protected path: ${targetPath}`);
  }
}

// 4.2 — BACKUP SYSTEM (pour UNDO)
const BACKUP_DIR = path.join(WORKSPACE_ROOT, ".a11_backups");
function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
function makeBackup(relPath) {
  try {
    const fullPath = resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) return;
    ensureBackupDir();
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const backupName = relPath.replaceAll(/[\\/]/g, "__") + "__" + stamp;
    const backupPath = path.join(BACKUP_DIR, backupName);
    fs.copyFileSync(fullPath, backupPath);
    logTool(`Backup créé : ${backupName}`);
    return backupPath;
  } catch (err) {
    logTool("Backup error: " + err.message);
  }
}
function getLastBackup(relPath) {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const prefix = relPath.replaceAll(/[\\/]/g, "__") + "__";
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix));
  if (!files.length) return null;
  files.sort((left, right) => left.localeCompare(right));
  return path.join(BACKUP_DIR, files.at(-1));
}

// 4.3 — FILE OPERATIONS
function handleWriteFile(msg) {
  const full = resolveSafePath(msg.path);
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, msg.content ?? "", msg.encoding || "utf8");
    const stats = fs.statSync(full);
    logTool("[write_file] " + full);
    return { ok: true, path: full, bytes: stats.size };
  } catch (err) {
    logTool("[write_file][ERROR] " + full + " : " + err.message);
    return { ok: false, error: err.message, path: full, code: err.code || null };
  }
}
function handleAppendFile(msg) {
  const full = resolveSafePath(msg.path);
  makeBackup(msg.path);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, msg.content ?? "", msg.encoding || "utf8");
  logTool("[append_file] " + full);
  return { ok: true, path: full };
}
function handleMkdir(msg) {
  const full = resolveSafePath(msg.path);
  fs.mkdirSync(full, { recursive: true });
  logTool("[mkdir] " + full);
  return { ok: true, path: full };
}
function handleReadFile(msg) {
  const full = resolveSafePath(msg.path);
  if (!fs.existsSync(full)) return { ok: false, error: "File not found" };
  const data = fs.readFileSync(full, "utf8");
  logTool("[read_file] " + full);
  return { ok: true, path: full, content: data };
}
function handleListDir(msg) {
  const full = resolveSafePath(msg.path);
  if (!fs.existsSync(full)) return { ok: false, error: "Dir not found" };
  const items = fs.readdirSync(full, { withFileTypes: true }).map((d) => ({
    name: d.name,
    type: d.isDirectory() ? "dir" : "file",
  }));
  logTool("[list_dir] " + full);
  return { ok: true, path: full, items };
}

function getInternalApiBaseUrl() {
  const configured = String(process.env.A11_INTERNAL_API_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = String(process.env.PORT || 3000).trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

function getAuthTokenFromContext(context = {}) {
  return String(context.authToken || "").trim();
}

function guessContentType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

async function fetchInternalJson(pathname, options = {}, context = {}) {
  const authToken = getAuthTokenFromContext(context);
  if (!authToken) {
    throw new Error("authenticated user context required");
  }

  const url = `${getInternalApiBaseUrl()}${pathname}`;
  const headers = {
    "Content-Type": "application/json",
    "X-NEZ-TOKEN": authToken,
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(async () => ({ ok: false, error: await res.text().catch(() => "invalid_response") }));
  if (!res.ok) {
    return { ok: false, status: res.status, ...(data && typeof data === "object" ? data : { error: String(data) }) };
  }
  return data;
}

function listAttachmentPaths(msg = {}) {
  const items = [];
  if (typeof msg.path === "string" && msg.path.trim()) items.push(msg.path);
  if (typeof msg.attachmentPath === "string" && msg.attachmentPath.trim()) items.push(msg.attachmentPath);
  if (typeof msg.filePath === "string" && msg.filePath.trim()) items.push(msg.filePath);
  if (typeof msg.outputPath === "string" && msg.outputPath.trim()) items.push(msg.outputPath);
  if (Array.isArray(msg.paths)) items.push(...msg.paths);
  if (Array.isArray(msg.attachments)) {
    for (const item of msg.attachments) {
      if (typeof item === "string" && item.trim()) items.push(item);
      else if (item && typeof item === "object" && typeof item.path === "string" && item.path.trim()) items.push(item.path);
    }
  }
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeRecipientsInput(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ));
  }

  const raw = String(value || "").trim();
  if (!raw) return [];
  return Array.from(new Set(
    raw
      .split(/[;,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function buildAttachmentPayload(fullPath, index = 0, forcedFilename = "") {
  if (!fs.existsSync(fullPath)) {
    throw new Error(`attachment file not found: ${fullPath}`);
  }
  const stats = fs.statSync(fullPath);
  if (!stats.isFile()) {
    throw new Error(`attachment path is not a file: ${fullPath}`);
  }
  const buffer = fs.readFileSync(fullPath);
  return {
    filename: forcedFilename && index === 0 ? String(forcedFilename).trim() : path.basename(fullPath),
    contentBase64: buffer.toString("base64"),
    contentType: guessContentType(fullPath),
    sizeBytes: stats.size,
  };
}

async function handleShareFile(msg) {
  const context = msg._context || {};
  const full = resolveSafePath(msg.path);
  if (!fs.existsSync(full)) return { ok: false, error: "File not found", path: full };
  const stats = fs.statSync(full);
  if (!stats.isFile()) return { ok: false, error: "Path is not a file", path: full };

  const buffer = fs.readFileSync(full);
  const recipients = normalizeRecipientsInput(msg.emailTo || msg.to || msg.email || msg.recipient || msg.recipients || "");
  const payload = {
    filename: msg.filename || path.basename(full),
    contentBase64: buffer.toString("base64"),
    contentType: msg.contentType || guessContentType(full),
    emailTo: recipients.length ? recipients : "",
    emailSubject: msg.emailSubject || msg.subject || "",
    emailMessage: msg.emailMessage || msg.message || "",
    attachToEmail: msg.attachToEmail === true || msg.asAttachment === true,
  };

  const result = await fetchInternalJson("/api/files/upload", {
    method: "POST",
    body: payload,
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      path: full,
      file: result.file || null,
      mail: result.mail || null,
    };
  }
  return {
    ok: false,
    path: full,
    error: result?.error || result?.message || "share_file_failed",
    detail: result,
  };
}

async function handleListStoredFiles(msg) {
  const context = msg._context || {};
  const limit = Number.isFinite(Number(msg.limit)) ? Math.max(1, Math.min(100, Number(msg.limit))) : 20;
  const result = await fetchInternalJson(`/api/files/my?limit=${limit}`, { method: "GET" }, context);
  if (result?.ok) return result;
  return { ok: false, error: result?.error || result?.message || "list_stored_files_failed", detail: result };
}

async function handleListResources(msg) {
  const context = msg._context || {};
  const limit = Number.isFinite(Number(msg.limit)) ? Math.max(1, Math.min(100, Number(msg.limit))) : 20;
  const search = new URLSearchParams();
  search.set("limit", String(limit));
  if (String(msg.conversationId || msg.convId || msg.sessionId || "").trim()) {
    search.set("conversationId", String(msg.conversationId || msg.convId || msg.sessionId).trim());
  }
  if (String(msg.kind || msg.resourceKind || "").trim()) {
    search.set("kind", String(msg.kind || msg.resourceKind).trim());
  }
  const result = await fetchInternalJson(`/api/resources/my?${search.toString()}`, { method: "GET" }, context);
  if (result?.ok) return result;
  return { ok: false, error: result?.error || result?.message || "list_resources_failed", detail: result };
}

async function handleEmailResource(msg) {
  const context = msg._context || {};
  const resourceId = Number(msg.resourceId || msg.resource_id || msg.id || msg.conversationResourceId || 0);
  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error("email_resource: missing valid \"resourceId\"");
  }

  const recipients = normalizeRecipientsInput(msg.to || msg.emailTo || msg.email || msg.recipient || msg.recipients || "");
  if (!recipients.length) {
    throw new Error("email_resource: missing \"to\"");
  }

  const result = await fetchInternalJson("/api/resources/email", {
    method: "POST",
    body: {
      resourceId,
      to: recipients,
      subject: msg.subject || msg.emailSubject || "",
      message: msg.message || msg.emailMessage || msg.body || msg.text || "",
      attachToEmail: msg.attachToEmail === true || msg.asAttachment === true || msg.attach === true,
    },
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      resourceId,
      to: recipients,
      mail: result.mail || null,
      resource: result.resource || null,
    };
  }

  return {
    ok: false,
    resourceId,
    to: recipients,
    error: result?.error || result?.message || "email_resource_failed",
    detail: result,
  };
}

async function handleSendEmail(msg) {
  const context = msg._context || {};
  const recipients = normalizeRecipientsInput(msg.to || msg.emailTo || msg.email || msg.recipient || msg.recipients || "");
  if (!recipients.length) {
    throw new Error("send_email: missing \"to\"");
  }

  const includeAttachments = msg.attachToEmail !== false;
  const attachmentPaths = includeAttachments ? listAttachmentPaths(msg) : [];
  const attachments = attachmentPaths.map((candidate, index) => {
    const fullPath = resolveSafePath(candidate);
    return buildAttachmentPayload(fullPath, index, msg.filename || "");
  });

  const result = await fetchInternalJson("/api/mail/send", {
    method: "POST",
    body: {
      to: recipients,
      subject: msg.subject || msg.emailSubject || "A11",
      message: msg.message || msg.emailMessage || msg.body || msg.text || msg.content || "",
      html: msg.html || "",
      conversationId: msg.conversationId || msg.convId || msg.sessionId || null,
      attachments,
    },
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      to: recipients,
      subject: msg.subject || msg.emailSubject || "A11",
      attachmentCount: attachments.length,
      mail: result.mail || null,
    };
  }

  return {
    ok: false,
    to: recipients,
    subject: msg.subject || msg.emailSubject || "A11",
    error: result?.error || result?.message || "send_email_failed",
    detail: result,
  };
}

function handleDeleteFile(msg) {
  const full = resolveSafePath(msg.path);
  logTool("[A11 ACTION] " + JSON.stringify({
    action: 'delete',
    path: full,
    user: msg.user || msg.requestedBy || 'unknown',
    timestamp: Date.now()
  }));
  if (SAFE_MODE) {
    throw new Error('delete_file refused: SAFE_MODE is enabled');
  }
  if (!hasDeleteConfirmation(msg)) {
    throw new Error("delete_file refused: explicit confirmation required (confirmDelete=true and confirm=\"DELETE\")");
  }
  assertNotProtectedPath(full);
  makeBackup(msg.path);
  fs.rmSync(full, { recursive: true, force: true });
  logTool("[delete_file] " + full);
  return { ok: true };
}
function handleRename(msg) {
  const from = resolveSafePath(msg.from);
  const to = resolveSafePath(msg.to);
  makeBackup(msg.from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  logTool(`[rename] ${from} → ${to}`);
  return { ok: true };
}
function handleCopy(msg) {
  const from = resolveSafePath(msg.from);
  const to = resolveSafePath(msg.to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  logTool(`[copy] ${from} → ${to}`);
  return { ok: true };
}
function handleMove(msg) {
  const from = resolveSafePath(msg.from);
  assertNotProtectedPath(from);
  const res = handleCopy(msg);
  fs.rmSync(from, { recursive: true, force: true });
  return res;
}

// 4.4 — APPLY PATCH (search → replace)
function handleApplyPatch(msg) {
  const full = resolveSafePath(msg.path);
  if (!fs.existsSync(full)) return { ok: false, error: "File not found" };
  const src = fs.readFileSync(full, "utf8");
  const search = msg.patch?.search;
  const replace = msg.patch?.replace;
  if (!search || replace === undefined) return { ok: false, error: "Invalid patch" };
  if (!src.includes(search)) return { ok: false, error: "Search term not found" };
  makeBackup(msg.path);
  const output = src.replaceAll(search, replace);
  fs.writeFileSync(full, output, "utf8");
  logTool("[apply_patch] " + full);
  return { ok: true };
}

// 4.5 — EXECUTE SHELL COMMAND
function handleExec(msg) {
  try {
    const out = child_process
      .execSync(msg.command, { cwd: WORKSPACE_ROOT, stdio: ["ignore", "pipe", "pipe"] })
      .toString();
    logTool("[exec] " + msg.command);
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 4.6 — UNDO
function handleUndo(msg) {
  const backup = getLastBackup(msg.path);
  if (!backup) return { ok: false, error: "No backup found" };
  const full = resolveSafePath(msg.path);
  fs.copyFileSync(backup, full);
  logTool("[undo_last] Restauré depuis " + backup);
  return { ok: true };
}

const ROUTER_TOOL_REGISTRY = [
  {
    name: "share_file",
    description: "Publie un fichier local dans le stockage A-11 et peut l'envoyer par mail.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        filename: { type: "string" },
        emailTo: { type: "string" },
        emailSubject: { type: "string" },
        emailMessage: { type: "string" },
        attachToEmail: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: true,
    },
  },
  {
    name: "list_stored_files",
    description: "Liste les fichiers déjà stockés pour l'utilisateur courant.",
    schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "list_resources",
    description: "Liste les ressources de conversation déjà stockées pour l'utilisateur courant.",
    schema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        kind: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "email_resource",
    description: "Envoie une ressource déjà stockée par A11 par email à partir de son resourceId.",
    schema: {
      type: "object",
      properties: {
        resourceId: { type: "number" },
        to: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        subject: { type: "string" },
        message: { type: "string" },
        attachToEmail: { type: "boolean" },
      },
      required: ["resourceId", "to"],
      additionalProperties: true,
    },
  },
  {
    name: "send_email",
    description: "Envoie un email texte avec pièces jointes locales optionnelles.",
    schema: {
      type: "object",
      properties: {
        to: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        subject: { type: "string" },
        message: { type: "string" },
        html: { type: "string" },
        path: { type: "string" },
        paths: {
          type: "array",
          items: { type: "string" },
        },
        attachToEmail: { type: "boolean" },
      },
      required: ["to"],
      additionalProperties: true,
    },
  },
];

// ========================================================================
//   SECTION 5 — TOOL REGISTRY (✅ getTools implémenté)
// ========================================================================
async function loadModulesCatalog(modulesRoot = MODULES_ROOT) {
  const registry = [];
  try {
    const entries = await fsp.readdir(modulesRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const modDir = path.join(modulesRoot, ent.name);
      const jsonPath = path.join(modDir, "module.json");
      if (!fs.existsSync(jsonPath)) continue;
      try {
        const raw = await fsp.readFile(jsonPath, "utf8");
        const meta = JSON.parse(raw);
        const name = (meta.name || meta.tool || meta.id || ent.name || "").toString();
        if (!name) continue;
        // Autorisation stricte
        if (!(meta.enabled === true || MODULES_WHITELIST.has(name))) continue;
        const description = (meta.description || meta.desc || meta.summary || "").toString() || "module tool";
        const schema =
          meta.schema ||
          meta.input_schema ||
          meta.inputSchema ||
          meta.inputs ||
          { type: "object", additionalProperties: true };
        registry.push({ name, description, schema, _moduleDir: modDir });
      } catch (e) {
        logWarn(`[Cerbère] module.json invalide: ${jsonPath} (${e.message})`);
      }
    }
  } catch (e) {
    logWarn(`[Cerbère] Impossible de lire modulesRoot=${modulesRoot} (${e.message})`);
  }
  registry.sort((a, b) => a.name.localeCompare(b.name));
  return registry;
}

async function getTools({ workspaceRoot } = {}) {
  // Source de vérité exécution: TOOL_IMPL
  const impl = TOOL_IMPL || {};

  // Catalogue depuis module.json
  const dynamicRegistry = await loadModulesCatalog(MODULES_ROOT);
  const routerRegistry = ROUTER_TOOL_REGISTRY.map((tool) => ({ ...tool }));

  // Fusion: si un module existe mais pas d’impl, on le tag (sinon agent va l’appeler et ça va fail)
  const implNames = new Set([...Object.keys(impl), ...routerRegistry.map((tool) => tool.name)]);
  const registry = [...routerRegistry, ...dynamicRegistry].map(t => ({
    ...t,
    description: t.description + (implNames.has(t.name) ? "" : " [NO_IMPL_IN_ROUTER]")
  }));

  // Ajoute aussi les tools "impl-only" pas décrites en module.json
  for (const name of Object.keys(impl).sort((left, right) => left.localeCompare(right))) {
    if (!registry.some((r) => r.name === name)) {
      registry.push({
        name,
        description: "tool",
        schema: { type: "object", additionalProperties: true }
      });
    }
  }

  return { TOOL_IMPL: impl, registry };
}

async function runDynamicModuleTool(toolName, args) {
  const modDir = path.join(MODULES_ROOT, toolName);
  const jsonPath = path.join(modDir, "module.json");
  const entry = path.join(modDir, "index.js");
  if (!fs.existsSync(entry) || !fs.existsSync(jsonPath)) {
    return { ok: false, error: `[NO_IMPL] Module ${toolName} not found or missing module.json` };
  }
  try {
    const meta = JSON.parse(await fsp.readFile(jsonPath, "utf8"));
    if (!(meta.enabled === true || MODULES_WHITELIST.has(toolName))) {
      return { ok: false, error: `[MODULE_DISABLED] Module ${toolName} is not enabled or whitelisted` };
    }
    delete require.cache[require.resolve(entry)];
    const mod = require(entry);
    const fn = typeof mod === "function" ? mod : mod.run;
    if (typeof fn !== "function") {
      return { ok: false, error: `[NO_IMPL] Module ${toolName} does not export a function` };
    }
    const result = await fn(args || {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: `[MODULE_ERROR] ${toolName}: ${e.message}` };
  }
}

// --- PATCH: Anti-placeholder/anti-fake download_file enforcement ---
function isPlaceholderUrl(url = "") {
  return (
    /(^https?:\/\/)?(www\.)?(example\.com|example\.org|example\.net)\b/i.test(url) ||
    /placeholder|dummy|fake/i.test(url)
  );
}
function isUrlProven(url, toolResults = []) {
  const hay = JSON.stringify(toolResults || []);
  return hay.includes(url);
}
function sanitizeActions(envelope, toolResults) {
  if (!envelope?.actions?.length) return envelope;
  const before = envelope.actions.length;

  envelope.actions = envelope.actions.filter((a) => {
    const name = a.name || a.action;
    if (name !== "download_file") return true;
    const url = a.arguments?.url || a.input?.url || "";
    if (isPlaceholderUrl(url)) {
      logWarn(`[Cerbère] Action download_file supprimée (placeholder URL): ${url}`);
      return false;
    }
    if (!isUrlProven(url, toolResults)) {
      logWarn(`[Cerbère] Action download_file supprimée (URL non prouvée): ${url}`);
      return false;
    }
    return true;
  });

  if (envelope.actions.length !== before) {
    logWarn(`[Cerbère] ${before - envelope.actions.length} action(s) download_file supprimée(s).`);
  }
  return envelope;
}

// --- Policy: refuse actions not explicitly requested by user ---
function actionAllowedByUser(userPrompt, actName) {
  const p = (userPrompt || "").toLowerCase();
  if (actName === "generate_pdf") return p.includes("pdf");
  if (actName === "download_file") return p.includes("télécharge") || p.includes("telecharge") || p.includes("download");
  if (actName === "websearch" || actName === "web_search") return p.includes("cherche") || p.includes("recherche") || p.includes("search");
  return true;
}

function assertDataOnly(toolName, out) {
  if (out && typeof out === "object") {
    const forbidden = ["mode", "version", "actions", "question", "choices", "answer"];
    for (const k of forbidden) {
      if (k in out) {
        throw new Error(`TOOL_CONTRACT_VIOLATION:${toolName}: key "${k}" is forbidden in tool output`);
      }
    }
  }
  return out;
}

async function runEnvelopeActionsWithPolicy(envelope, userPrompt, toolResults = [], context = {}) {
  envelope = sanitizeActions(envelope, toolResults);

  const actions = envelope.actions || [];
  const results = [];

  for (const a of actions) {
    const actName = getActionName(a) || "action";
    const args = a.arguments || a.input || {};

    if (!actionAllowedByUser(userPrompt, actName)) {
      results.push({ tool: actName, arguments: args, result: { ok: false, error: "Action not requested by user" } });
      continue;
    }

    logTool(`[envelope] → ${actName}`);
    let res = await handleDevAction({ action: actName, ...args, _context: context });
    try {
      res = assertDataOnly(actName, res);
    } catch (e) {
      logError(`[Cerbère][TOOL_CONTRACT_VIOLATION] ${e.message}`);
      res = { ok: false, error: e.message };
    }
    results.push({ tool: actName, arguments: args, result: res });
  }

  return results;
}

// ========================================================================
//   SECTION 7 — ENDPOINT PRINCIPAL /v1/chat/completions (✅ UN SEUL)
// ========================================================================
router.post("/v1/chat/completions", async (req, res) => {
  const body = req.body || {};
  const model = body.model || "llama3.2:latest";
  const messages = body.messages || [];
  const stream = body.stream === true;

  const head = (body.cerbereHead || "maker").toLowerCase();
  const userPrompt = extractUserPrompt(messages || []);

  logInfo(`[Cerbère] /v1/chat/completions head=${head} | prompt="${userPrompt}"`);

  const usesLegacyHead = head !== "maker";
  const wantsDev = /\[DEV_ENGINE\]/i.test(userPrompt) || body.dev_engine === true;

  if (usesLegacyHead) {
    return res.status(410).json({
      error: "cerbere_special_heads_removed",
      message: "Les modes strategist/thinker/pipeline ont ete retires du router public. Utilisez le proxy strict.",
    });
  }

  if (wantsDev) {
    return res.status(410).json({
      error: "dev_engine_removed",
      message: "Le mode DEV_ENGINE a ete retire du router public Cerbere.",
    });
  }

  try {
    const target = await resolveLlmTarget(model, { emitLogs: true });

    if (target.provider === "ollama") {
      const ollamaPayload = {
        model: target.model,
        messages: buildOllamaMessages(messages),
        stream: false,
      };

      const upstreamRes = await fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaPayload),
        signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      });

      const rawText = await upstreamRes.text();
      let rawJson = null;
      if (rawText) {
        try {
          rawJson = JSON.parse(rawText);
        } catch {
          rawJson = null;
        }
      }

      if (!upstreamRes.ok) {
        logError(`[Cerbère] Upstream error ${upstreamRes.status} from ${target.url}: ${rawText}`);
        return res.status(upstreamRes.status).json({
          error: "upstream_error",
          provider: target.provider,
          status: upstreamRes.status,
          detail: rawText,
        });
      }

      return res.json(toOpenAIStyleResponseFromOllama(rawJson || {}, target.model));
    }

    const upstreamBody = { ...body, model: target.model, messages, stream };
    const upstreamRes = await fetch(target.url, {
      method: "POST",
      headers: buildUpstreamHeaders(target.baseUrl, target.provider),
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      logError(`[Cerbère] Upstream error ${upstreamRes.status} from ${target.url}: ${errText}`);
      return res.status(upstreamRes.status).json({
        error: "upstream_error",
        provider: target.provider,
        status: upstreamRes.status,
        detail: errText,
      });
    }
    const data = await upstreamRes.json();
    if (typeof data?.choices?.[0]?.message?.content === "string") {
      data.choices[0].message.content = sanitizeAssistantText(data.choices[0].message.content);
    }
    return res.json(data);
  } catch (err) {
    logError("[Cerbère] router_error: " + err.message);
    return res.status(502).json({ error: "router_error", message: err.message, detail: String(err) });
  }
});

// Exporte à la fois le router et BACKENDS pour usage externe
module.exports = { router, BACKENDS };

// Ajoute la whitelist en haut du fichier
const MODULES_WHITELIST = new Set([
  "generate_pdf",
  "zip",
  "unzip",
  // Ajoute ici les noms sûrs que tu veux autoriser
]);

// Remplace la fonction handleDevAction par une version avec websearch normalisé
async function handleDevAction(msg = {}) {
  try {
    const action = (msg.action || msg.tool || "").toString().toLowerCase();
    switch (action) {
      case "write_file":
      case "writefile":
      case "write-file":
        return handleWriteFile(msg);
      case "append_file":
      case "appendfile":
      case "append-file":
        return handleAppendFile(msg);
      case "mkdir":
      case "make_dir":
      case "mkdirp":
        return handleMkdir(msg);
      case "read_file":
      case "readfile":
        return handleReadFile(msg);
      case "list_dir":
      case "ls":
      case "listdir":
        return handleListDir(msg);
      case "delete_file":
      case "rm":
      case "remove_file":
        return handleDeleteFile(msg);
      case "rename":
        return handleRename(msg);
      case "copy":
        return handleCopy(msg);
      case "move":
        return handleMove(msg);
      case "apply_patch":
      case "applypatch":
        return handleApplyPatch(msg);
      case "exec":
      case "execute":
      case "shell":
        return handleExec(msg);
      case "undo":
      case "restore":
        return handleUndo(msg);

      // wrappers around tool modules
      case "fs_read":
        return await fs_read(msg);
      case "fs_write":
        return await fs_write(msg);
      case "fs_list":
        return await fs_list(msg);
      case "websearch":
      case "web_search":
      case "websearch_tool": {
        const args = normalizeWebsearchArgs(msg);
        if (!args.query) return { ok: false, error: "MISSING_QUERY" };
        if (TOOL_IMPL && typeof TOOL_IMPL.websearch === "function") {
          return await TOOL_IMPL.websearch(args);
        }
        return { ok: false, error: "NO_WEBSERCH_IMPL" };
      }
      case "web_fetch":
      case "web-fetch":
      case "fetch":
        return await web_fetch(msg);
      case "qflush":
      case "run_qflush_flow":
      case "qflush_flow":
        return await runQflushFlow(msg);
      case "share_file":
      case "share-file":
        return await handleShareFile(msg);
      case "list_stored_files":
      case "list-stored-files":
      case "list_files":
        return await handleListStoredFiles(msg);
      case "list_resources":
      case "list-resource":
      case "list_resource":
      case "list_conversation_resources":
        return await handleListResources(msg);
      case "email_resource":
      case "email-resource":
      case "send_resource_email":
      case "resource_email":
        return await handleEmailResource(msg);
      case "send_email":
      case "send-email":
      case "send_mail":
        return await handleSendEmail(msg);
      case "shell_exec":
      case "shell-exec":
        return await shell_exec(msg);

      default:
        // fallback: si TOOL_IMPL ne connaît pas, tente de charger un module dynamique
        if (MODULES_ROOT && fs.existsSync(path.join(MODULES_ROOT, action))) {
          return await runDynamicModuleTool(action, msg);
        }
        return { ok: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Ajout : normalisation des arguments websearch
function normalizeWebsearchArgs(args = {}) {
  if (!args.query && args.q) args.query = args.q;
  return { query: String(args.query || "").trim() };
}

function toolsCatalogText(registry = []) {
  const lines = ["[TOOLS_CATALOG]"];
  for (const t of registry) {
    lines.push(
      `- ${t.name}: ${t.description || "no_desc"}`,
      `  schema=${JSON.stringify(t.schema)}`
    );
  }
  return lines.join("\n");
}

function cleanJsonCandidate(text = "") {
  if (!text) return "";
  let s = String(text).trim();
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n");
    if (nl !== -1) s = s.slice(nl + 1);
    if (s.endsWith("```")) s = s.slice(0, -3);
    s = s.trim();
  }
  const start = s.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let prev = "";
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '"' && prev !== "\\") inString = false;
    } else {
      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    prev = c;
  }
  return s.slice(start);
}

function tryParseA11Envelope(raw) {
  if (!raw || typeof raw !== "string") return null;
  let obj = null;
  let trimmed = raw.trim();
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // Tentative de réparation : ajoute une } si manquante
    if (trimmed.endsWith("}")) {
      return null;
    }
    try {
      obj = JSON.parse(trimmed + "}");
    } catch {
      return null;
    }
  }

  if (obj?.version === "a11-envelope-1" && obj.mode === "actions" && Array.isArray(obj.actions)) return obj;

  if (obj?.version === "a11-action-1" && typeof obj.action?.tool === "string") {
    return {
      version: "a11-envelope-1",
      mode: "actions",
      actions: [
        { name: obj.action.tool, arguments: obj.action.input || {}, id: obj.action.id || "auto-1" },
      ],
    };
  }
  return null;
}

function parseEnvelope(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    logWarn(`[Cerbère] parseEnvelope JSON error (slice): ${e.message}`);
    return null;
  }
}

function normalizeTextForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeConsecutiveLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let prevNorm = "";
  for (const line of lines) {
    const norm = normalizeTextForCompare(line);
    if (norm && norm === prevNorm) continue;
    out.push(line);
    prevNorm = norm;
  }
  return out.join("\n");
}

function dedupeConsecutiveSentences(text) {
  const sentences = String(text || "").match(/[^.!?\n]+[.!?]?/g) || [String(text || "")];
  const out = [];
  let prevNorm = "";
  for (const sentence of sentences) {
    const norm = normalizeTextForCompare(sentence);
    if (norm && norm === prevNorm) continue;
    out.push(sentence);
    prevNorm = norm;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function sanitizeAssistantText(text) {
  const step1 = dedupeConsecutiveLines(text);
  const step2 = dedupeConsecutiveSentences(step1);
  return step2 || String(text || "").trim();
}

function summarizeActionsFallback(actionResults = []) {
  const lines = [];

  for (const entry of actionResults || []) {
    const tool = String(entry?.tool || "action");
    const result = entry?.result || {};

    if (result?.ok !== true) {
      lines.push(`${tool}: échec${result?.error ? ` (${result.error})` : ""}.`);
      continue;
    }

    if (tool === "share_file") {
      const filename = result?.file?.filename || path.basename(String(result?.path || "fichier"));
      const url = result?.file?.url || "";
      if (url) {
        lines.push(`Fichier prêt: ${filename}`);
        lines.push(`Lien: ${url}`);
      } else {
        lines.push(`Fichier stocké: ${filename}.`);
      }
      if (result?.mail?.ok && result?.mail?.to) {
        lines.push(`Mail envoyé à ${result.mail.to}.`);
      } else if (result?.mail?.ok) {
        lines.push("Mail envoyé.");
      }
      continue;
    }

    if (tool === "list_stored_files") {
      const files = Array.isArray(result?.files) ? result.files : [];
      if (!files.length) {
        lines.push("Aucun fichier stocké pour le moment.");
      } else {
        lines.push(`Fichiers stockés (${files.length}) :`);
        for (const file of files.slice(0, 5)) {
          const label = file?.filename || file?.storage_key || "fichier";
          const url = file?.url ? ` - ${file.url}` : "";
          lines.push(`- ${label}${url}`);
        }
      }
      continue;
    }

    lines.push(`${tool}: terminé.`);
  }

  return lines.join("\n").trim() || "Terminé.";
}

async function buildDevSummaryWithLLM({ upstreamUrl, model, userPrompt, actionResults, imageUrl }) {
  try {
    const imgBlock = imageUrl ? `\nVoici l'image générée :\n\n![image](${imageUrl})\n` : "";
    const messages = [
      {
        role: "system",
        content: "Tu es A-11. Résume ce que tu viens de faire. Pas de JSON, pas de code. Réponse claire uniquement. Si un résultat contient un lien de fichier, recopie le lien exact dans la réponse.",
      },
      {
        role: "user",
        content:
          `Demande utilisateur :\n${userPrompt}\n\n` +
          `Actions exécutées :\n${JSON.stringify(actionResults, null, 2)}\n` +
          imgBlock,
      },
    ];
    const body = { model, messages, stream: false };
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    logTool("[DevSummary] ERROR: " + err.message);
    return null;
  }
}

// --- PATCH: Anti-hallucination URL enforcer ---
function looksLikeAskingForUrl(envelope) {
  if (envelope?.mode !== "need_user") return false;
  const q = (envelope.question || "").toLowerCase();
  return q.includes("url") && q.includes("image");
}

function looksLikeAskingWebsearchResult(envelope) {
  if (envelope?.mode !== "need_user") return false;
  const q = (envelope.question || "").toLowerCase();
  return (
    q.includes("réponse de la recherche web") ||
    q.includes("websearch result") ||
    (q.includes("quelle est la réponse") && q.includes("recherche web"))
  );
}

function isFindImagePrompt(userPrompt) {
  const p = (userPrompt || "").toLowerCase();
  return (
    (p.includes("cherche") || p.includes("trouve") || p.includes("find")) &&
    p.includes("image")
  );
}

function extractQuery(userPrompt) {
  let p = userPrompt.replaceAll(/\[DEV_ENGINE\]/gi, "").trim();
  const m = p.match(/(?:cherche|trouve|find)(.*)/i);
  if (m?.[1]) return m[1].trim();
  return p;
}

function getActionName(a) {
  return (a?.action || a?.tool || a?.name || "").toString();
}

function getRequestAuthContext(req) {
  const headerToken = String(req.headers["x-nez-token"] || "").trim();
  const bearerToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return {
    authToken: headerToken || bearerToken,
  };
}

