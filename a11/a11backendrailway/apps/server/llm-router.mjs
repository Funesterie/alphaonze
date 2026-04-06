#!/usr/bin/env node
// Legacy standalone Cerbere engine.
// This file remains available for experiments and debugging, but the canonical
// router lives in `llm-router.cjs` and the canonical standalone process entry
// is `llm-router-runner.cjs`.

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function sanitizeUtf8Text(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\u2028|\u2029/g, '\n')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

function sanitizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const role = String(message?.role || '').trim().toLowerCase();
      const content = typeof message?.content === 'string'
        ? sanitizeUtf8Text(message.content).trim()
        : '';
      if (!content) return null;
      return { ...message, role, content };
    })
    .filter((message) => message && (message.role === 'system' || message.role === 'assistant' || message.role === 'user'));
}

const PORT = process.env.LLM_ROUTER_PORT || process.env.PORT || 4545;
const DEV_MODE = String(process.env.DEV_MODE || '').toLowerCase() === 'true';

// Backend configuration
const LOCAL_LLM_PORT = process.env.LLAMA_PORT || process.env.LOCAL_LLM_PORT || 8080;
const LLAMA_LOCAL_FALLBACK = process.env.NODE_ENV === 'production'
  ? null
  : `http://127.0.0.1:${LOCAL_LLM_PORT}`;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OLLAMA_BASE = String(process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').trim();
const PRIMARY_BACKEND_KEY = 'llama_server';
const CIRCUIT_BREAKER_THRESHOLD = Number(process.env.CERBERE_CIRCUIT_BREAKER_THRESHOLD || 3);
const CIRCUIT_BREAKER_WINDOW_MS = Number(process.env.CERBERE_CIRCUIT_BREAKER_WINDOW_MS || 90_000);
const CIRCUIT_BREAKER_COOLDOWN_MS = Number(process.env.CERBERE_CIRCUIT_BREAKER_COOLDOWN_MS || 60_000);
const BACKEND_PROBE_INTERVAL_MS = Number(process.env.CERBERE_BACKEND_PROBE_INTERVAL_MS || 30_000);
const BACKEND_HEALTH_CACHE_MS = Number(process.env.CERBERE_BACKEND_HEALTH_CACHE_MS || 8_000);

const BACKEND_REGISTRY = {
  llama_server: {
    key: 'llama_server',
    label: 'llama-server',
    baseUrl: String(process.env.LOCAL_LLM_URL || process.env.LLAMA_BASE || LLAMA_LOCAL_FALLBACK || '').trim() || null,
    chatPath: '/v1/chat/completions',
    healthPath: '/health',
  },
  ollama: {
    key: 'ollama',
    label: 'ollama',
    baseUrl: OLLAMA_BASE || null,
    chatPath: '/v1/chat/completions',
    healthPath: '/api/tags',
  },
  openai: {
    key: 'openai',
    label: 'openai',
    baseUrl: String(process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || '').trim() || null,
    chatPath: '/chat/completions',
    healthPath: '/models',
    apiKey: OPENAI_API_KEY,
  },
};

const BACKENDS = {
  llama_local: BACKEND_REGISTRY.llama_server.baseUrl,
  ollama: BACKEND_REGISTRY.ollama.baseUrl,
  openai: BACKEND_REGISTRY.openai.baseUrl,
};

const routerState = {
  primaryBackend: BACKEND_REGISTRY[PRIMARY_BACKEND_KEY]?.label || 'llama-server',
  activeBackend: BACKEND_REGISTRY[PRIMARY_BACKEND_KEY]?.label || 'llama-server',
  lastSuccessfulBackend: null,
  lastPrimaryError: null,
  lastPrimaryFailureAt: null,
  lastFailoverAt: null,
  failoverHistory: [],
  backendState: Object.fromEntries(Object.keys(BACKEND_REGISTRY).map((key) => [key, {
    healthy: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    circuitOpenUntil: null,
    failureTimestamps: [],
  }])),
};

console.log(`[Cerbère] DEV ENGINE initialized (DEV_MODE=${DEV_MODE ? 'true' : 'false'})`);
console.log('[Cerbère] Available backends:', BACKENDS);
console.log('[Cerbère] Local LLM fallback:', LLAMA_LOCAL_FALLBACK || '(disabled)');

function isoNow() {
  return new Date().toISOString();
}

function joinBackendUrl(baseUrl, routePath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(routePath || '').startsWith('/') ? String(routePath || '') : `/${String(routePath || '')}`;
  return `${base}${suffix}`;
}

function getBackendDefinition(key) {
  return BACKEND_REGISTRY[String(key || '').trim()] || null;
}

function getBackendHeaders(key) {
  const backend = getBackendDefinition(key);
  const headers = {
    'Content-Type': 'application/json',
  };
  if (backend?.key === 'openai' && backend.apiKey) {
    headers.Authorization = `Bearer ${backend.apiKey}`;
  }
  return headers;
}

function pruneRecentFailures(key, now = Date.now()) {
  const state = routerState.backendState[key];
  if (!state) return [];
  state.failureTimestamps = state.failureTimestamps.filter((value) => now - value <= 24 * 60 * 60 * 1000);
  return state.failureTimestamps;
}

function computeFailoverCount24h(now = Date.now()) {
  routerState.failoverHistory = routerState.failoverHistory.filter((entry) => now - entry.atMs <= 24 * 60 * 60 * 1000);
  return routerState.failoverHistory.length;
}

function recordBackendSuccess(key, { promoteActive = false } = {}) {
  const state = routerState.backendState[key];
  if (!state) return;
  state.healthy = true;
  state.lastCheckedAt = isoNow();
  state.lastSuccessAt = state.lastCheckedAt;
  state.lastError = null;
  state.failureTimestamps = [];
  state.circuitOpenUntil = null;
  if (promoteActive) {
    routerState.lastSuccessfulBackend = getBackendDefinition(key)?.label || key;
    routerState.activeBackend = getBackendDefinition(key)?.label || key;
  }
}

function summarizeError(error) {
  if (!error) return 'unknown error';
  const status = Number(error?.status || 0);
  if (status > 0) {
    return `${error.message || 'http_error'} (status=${status})`;
  }
  if (error.code && error.message) {
    return `${error.code}: ${error.message}`;
  }
  return String(error.message || error);
}

function recordBackendFailure(key, error) {
  const state = routerState.backendState[key];
  if (!state) return;
  const now = Date.now();
  const summary = summarizeError(error);
  state.healthy = false;
  state.lastCheckedAt = isoNow();
  state.lastFailureAt = state.lastCheckedAt;
  state.lastError = summary;
  state.failureTimestamps.push(now);
  const recentFailures = pruneRecentFailures(key, now).filter((value) => now - value <= CIRCUIT_BREAKER_WINDOW_MS);
  if (recentFailures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    state.circuitOpenUntil = new Date(now + CIRCUIT_BREAKER_COOLDOWN_MS).toISOString();
  }
  if (key === PRIMARY_BACKEND_KEY) {
    routerState.lastPrimaryError = summary;
    routerState.lastPrimaryFailureAt = state.lastFailureAt;
  }
}

function recordFailover(fromKey, toKey, reason) {
  const fromBackend = getBackendDefinition(fromKey);
  const toBackend = getBackendDefinition(toKey);
  const entry = {
    at: isoNow(),
    atMs: Date.now(),
    from: fromBackend?.label || fromKey,
    to: toBackend?.label || toKey,
    reason: String(reason || '').trim() || null,
  };
  routerState.lastFailoverAt = entry.at;
  routerState.failoverHistory.push(entry);
  computeFailoverCount24h(entry.atMs);
}

function isCircuitOpen(key) {
  const state = routerState.backendState[key];
  if (!state?.circuitOpenUntil) return false;
  return Date.parse(state.circuitOpenUntil) > Date.now();
}

async function probeBackendHealth(key, { force = false } = {}) {
  const backend = getBackendDefinition(key);
  const state = routerState.backendState[key];
  if (!backend || !state) {
    return { ok: false, configured: false, reason: 'unknown_backend' };
  }
  if (!backend.baseUrl) {
    state.healthy = false;
    state.lastCheckedAt = isoNow();
    state.lastError = 'not_configured';
    return { ok: false, configured: false, reason: 'not_configured' };
  }
  if (backend.key === 'openai' && !backend.apiKey) {
    state.healthy = false;
    state.lastCheckedAt = isoNow();
    state.lastError = 'missing_api_key';
    return { ok: false, configured: false, reason: 'missing_api_key' };
  }

  const lastCheckedMs = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;
  if (!force && lastCheckedMs && Date.now() - lastCheckedMs < BACKEND_HEALTH_CACHE_MS) {
    return {
      ok: state.healthy === true,
      configured: true,
      reason: state.lastError,
      cached: true,
    };
  }

  const healthUrl = joinBackendUrl(backend.baseUrl, backend.healthPath);
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: getBackendHeaders(key),
    });
    if (!response.ok) {
      const error = new Error(`health_probe_failed:${response.status}`);
      error.status = response.status;
      throw error;
    }
    recordBackendSuccess(key);
    return { ok: true, configured: true, url: healthUrl };
  } catch (error) {
    recordBackendFailure(key, error);
    return {
      ok: false,
      configured: true,
      url: healthUrl,
      reason: summarizeError(error),
    };
  }
}

async function probeConfiguredBackends({ force = false } = {}) {
  const results = {};
  for (const key of Object.keys(BACKEND_REGISTRY)) {
    results[key] = await probeBackendHealth(key, { force });
  }
  return results;
}

function selectBackendOrder(model) {
  const modelLower = String(model || '').toLowerCase();
  if (!modelLower) {
    return ['llama_server', 'ollama', 'openai'];
  }
  if (modelLower.includes('gpt-')) {
    return ['llama_server', 'ollama', 'openai'];
  }
  if (
    modelLower.includes('qwen') ||
    modelLower.includes('mistral') ||
    modelLower.includes('codellama') ||
    modelLower.includes('deepseek')
  ) {
    return ['ollama', 'llama_server', 'openai'];
  }
  return ['llama_server', 'ollama', 'openai'];
}

function getBackendStateSnapshot() {
  const primaryState = routerState.backendState[PRIMARY_BACKEND_KEY] || {};
  const ollamaState = routerState.backendState.ollama || {};
  const openaiState = routerState.backendState.openai || {};
  return {
    primaryBackend: routerState.primaryBackend,
    activeBackend: routerState.activeBackend,
    primaryHealthy: primaryState.healthy === true,
    ollamaHealthy: ollamaState.healthy === true,
    openaiHealthy: openaiState.healthy === true,
    lastPrimaryError: routerState.lastPrimaryError,
    lastPrimaryFailureAt: routerState.lastPrimaryFailureAt,
    lastFailoverAt: routerState.lastFailoverAt,
    failoverCount24h: computeFailoverCount24h(),
    lastSuccessfulBackend: routerState.lastSuccessfulBackend,
    backendState: Object.fromEntries(
      Object.keys(routerState.backendState).map((key) => {
        const state = routerState.backendState[key];
        return [key, {
          backend: getBackendDefinition(key)?.label || key,
          url: getBackendDefinition(key)?.baseUrl || null,
          healthy: state.healthy,
          lastCheckedAt: state.lastCheckedAt,
          lastSuccessAt: state.lastSuccessAt,
          lastFailureAt: state.lastFailureAt,
          lastError: state.lastError,
          circuitOpenUntil: state.circuitOpenUntil,
        }];
      })
    ),
    recentFailovers: routerState.failoverHistory.slice(-10).map(({ atMs, ...entry }) => entry),
  };
}

// DEV ENGINE: Build developer-optimized prompt
function buildDeveloperPrompt(userPrompt, context = {}) {
  const { files = '', errors = '', mode = 'DEV_ENGINE' } = context;
  
  const systemPrompt = `[MODE:${mode}]
You are A-11 Developer Engine, a local AI coding assistant.
You work on a real development environment with:
- Node.js backend (Express)
- Visual Studio VSIX extension
- PowerShell automation
- Local LLM (LLaMA/Ollama)

WORKFLOW (always follow):
1. SCAN → Analyze context, files, and errors carefully
2. PLAN → Write a concise 3-5 step plan
3. CODE → Output production-ready code with minimal comments
4. PATCH → If errors detected, provide targeted fixes

${mode === 'NOSSEN' ? `
[NOSSEN_PROTOCOL]
- Rider = AI model (you)
- Circuit = workspace/project
- Modules = source files
- Core = error logs + build output
- Link = shell/terminal interface
- Black-Core = final instruction/goal

Your mission: restore Core stability through precise Modules modifications.
` : ''}

CONTEXT:
${files || '(no files provided)'}

ERRORS:
${errors || '(no errors detected)'}

RULES:
- Be concise and precise
- Output code ready to use (no explanations unless asked)
- If you need more context, ask specific questions
- Always verify your changes compile/run

USER REQUEST:
${userPrompt}
`;

  return systemPrompt;
}

// Health check
app.get('/health', async (req, res) => {
  await probeConfiguredBackends({ force: true });
  res.json({
    ok: true,
    service: 'cerbere-dev-engine',
    port: PORT,
    backends: Object.keys(BACKENDS).filter(k => BACKENDS[k]),
    ...getBackendStateSnapshot(),
  });
});

// PATCH 2: parseEnvelope plus tolérant
function parseEnvelope(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // 1. Cas simple : ça commence par { ou [
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && obj.mode) return obj;
    } catch (e) {
      console.warn("[Cerbère] parseEnvelope JSON error (direct):", e.message);
    }
  }

  // 2. Cas "je parle + json {...}" → on essaie d'extraire le 1er '{' jusqu'à la fin
  const idx = raw.indexOf("{");
  if (idx >= 0) {
    const candidate = raw.slice(idx);
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === "object" && obj.mode) return obj;
    } catch (e) {
      console.warn("[Cerbère] parseEnvelope JSON error (slice):", e.message);
    }
  }

  return null;
}

// PATCH 3: handleDevAction et handleGeneratePdf améliorés
function resolveSafePath(relPath) {
  // Simple safe path resolver (adapt as needed)
  return path.resolve(process.cwd(), relPath);
}

async function handleDevAction(msg) {
  switch (msg.action) {
    case "write_file":
      return handleWriteFile(msg);
    case "append_file":
      return handleAppendFile(msg);
    case "mkdir":
      return handleMkdir(msg);
    case "read_file":
      return handleReadFile(msg);
    case "list_dir":
      return handleListDir(msg);
    case "delete_file":
      return handleDeleteFile(msg);
    case "rename":
      return handleRename(msg);
    case "copy":
      return handleCopy(msg);
    case "move":
      return handleMove(msg);
    case "apply_patch":
      return handleApplyPatch(msg);
    case "batch":
      return handleBatch(msg);
    case "exec":
      return handleExec(msg);
    case "undo_last":
      return handleUndoLast(msg);
    case "generate_pdf":
    case "generatepdf": // alias pour ce que renvoie le LLM
      return handleGeneratePdf(msg);
    case "download_file":
      return await handleDownloadFile(msg);
    default:
      console.warn("[Cerbère] Unknown dev action:", msg.action);
      return { ok: false, error: "Unknown action: " + msg.action };
  }
}

function handleGeneratePdf(msg) {
  // chemin demandé par le LLM
  let relPath = msg.path || "document.pdf";

  // forcer l'extension .pdf
  if (!relPath.toLowerCase().endsWith(".pdf")) {
    relPath = relPath.replace(/\.[^./\\]+$/, "") + ".pdf";
  }

  const fullPath = resolveSafePath(relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const doc = new PDFDocument({
    autoFirstPage: true,
    margin: 50
  });
  const stream = fs.createWriteStream(fullPath);
  doc.pipe(stream);

  // --- Titre en première page ---
  if (msg.title) {
    doc.fontSize(24).text(msg.title, { align: "center" });
    doc.moveDown(1.5);
  }

  // Normalise les sections
  const sections = Array.isArray(msg.sections) ? msg.sections : [];
  if (sections.length === 0 && msg.text) {
    sections.push({
      heading: msg.title || "Introduction",
      text: msg.text
    });
  }

  let firstSection = true;
  for (const section of sections) {
    // pour les sections suivantes → nouvelle page
    if (!firstSection) {
      doc.addPage();
    }
    firstSection = false;

    if (section.heading) {
      doc.fontSize(18).text(section.heading, { underline: true });
      doc.moveDown(0.5);
    }

    if (section.text) {
      doc.fontSize(12).text(section.text, {
        align: "justify",
        lineGap: 4
      });
      doc.moveDown();
    }

    if (Array.isArray(section.images)) {
      for (const img of section.images) {
        const relImgPath =
          typeof img === "string" ? img : (img.path || img.file || img.url);
        if (!relImgPath) continue;

        try {
          const imgPath = resolveSafePath(relImgPath);
          if (fs.existsSync(imgPath)) {
            doc.moveDown();
            doc.image(imgPath, {
              fit: [400, 400],
              align: "center",
              valign: "center"
            });
          } else {
            console.warn("[Cerbère] image manquante:", imgPath);
          }
        } catch (e) {
          console.warn("[Cerbère] image error:", e.message);
        }
      }
    }
  }

  doc.end();
  console.log("[Cerbère] generate_pdf:", fullPath);
  return { ok: true, path: fullPath };
}

async function handleDownloadFile(msg) {
  try {
    const url = msg.url || msg.src || msg.href || msg.content;
    if (!url) {
      return { ok: false, error: "missing_url" };
    }

    // chemin ciblé par le LLM, ou nom de fichier dérivé de l’URL
    let relPath = msg.path;
    if (!relPath) {
      const u = new URL(url);
      const baseName = path.basename(u.pathname) || "download.bin";
      relPath = path.join("docs", baseName); // par défaut dans docs/
    }

    const fullPath = resolveSafePath(relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    console.log("[Cerbère] download_file:", url, "->", fullPath);

    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: "http_" + response.status };
    }

    const buf = await response.arrayBuffer();
    const nodeBuf = Buffer.from(buf);
    fs.writeFileSync(fullPath, nodeBuf);

    return {
      ok: true,
      path: fullPath,
      size: nodeBuf.length
    };
  } catch (e) {
    console.warn("[Cerbère] download_file error:", e.message);
    return { ok: false, error: String(e && e.message || e) };
  }
}

// PATCH 1: Enhanced /v1/chat/completions endpoint + exécution des actions
app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body || {};
  const model = body.model || "llama3.2:latest";
  const messages = sanitizeChatMessages(body.messages || []);
  const stream = body.stream === true;

  // Contexte dev (comme tu l'avais)
  const devContext = {
    files: req.headers["x-dev-files"] || body.dev_context?.files || "",
    errors: req.headers["x-dev-errors"] || body.dev_context?.errors || "",
    mode: req.headers["x-dev-mode"] || body.dev_context?.mode || "DEV_ENGINE",
  };

  const explicitDevRequest =
    body.dev_engine === true ||
    String(devContext.mode || '').toUpperCase() === 'DEV_ENGINE' ||
    messages.some(
      (m) =>
        typeof m.content === "string" &&
        (m.content.includes("[DEV_ENGINE]") || m.content.includes("[NOSSEN]"))
    );

  const isDeveloperMode = DEV_MODE && explicitDevRequest;

  let enhancedMessages = [...messages];

  // Si mode DEV, on emballe le dernier message avec buildDeveloperPrompt
  if (isDeveloperMode && messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "user") {
      const enhancedPrompt = buildDeveloperPrompt(lastMessage.content, devContext);
      enhancedMessages = [
        ...messages.slice(0, -1),
        { role: "user", content: sanitizeUtf8Text(enhancedPrompt) },
      ];
    }
  }

  const backendOrder = selectBackendOrder(model)
    .map((key) => getBackendDefinition(key))
    .filter((backend) => backend?.baseUrl);

  if (!backendOrder.length) {
    return res.status(502).json({
      error: "no_backend_available",
      detail: `No backend configured for model: ${model}`,
    });
  }

  const upstreamBody = {
    ...body,
    model,
    messages: enhancedMessages,
    stream,
  };
  const bypassActionExecution =
    String(req.headers["x-a11-passthrough"] || "").trim() === "1" ||
    body?.a11Passthrough === true;

  const primaryBackend = backendOrder[0];
  let successfulBackend = null;
  let upstreamUrl = null;
  let response = null;
  let lastError = null;
  const failureSummaries = [];

  console.log(`[Cerbère] Backend order for model ${model}: ${backendOrder.map((entry) => entry.label).join(' -> ')}`);
  console.log(`[Cerbère] Dev mode: ${isDeveloperMode}`);

  for (const backend of backendOrder) {
    const backendKey = backend.key;
    upstreamUrl = joinBackendUrl(backend.baseUrl, backend.chatPath);
    const probe = await probeBackendHealth(backendKey);

    if (isCircuitOpen(backendKey)) {
      const state = routerState.backendState[backendKey];
      const summary = `${backend.label} circuit breaker open until ${state?.circuitOpenUntil}`;
      failureSummaries.push({ backend: backend.label, reason: summary, skipped: true });
      console.warn(`[Cerbère] ${summary}`);
      continue;
    }

    if (probe.ok !== true) {
      const summary = String(probe.reason || 'health_probe_failed');
      failureSummaries.push({ backend: backend.label, reason: summary, skipped: true });
      console.warn(`[Cerbère] ${backend.label} unhealthy -> ${summary}`);
      if (backendKey === PRIMARY_BACKEND_KEY) {
        routerState.lastPrimaryError = summary;
        routerState.lastPrimaryFailureAt = isoNow();
      }
      continue;
    }

    console.log(`[Cerbère] Trying backend ${backend.label}: ${upstreamUrl}`);

    try {
      response = await fetch(upstreamUrl, {
        method: "POST",
        headers: getBackendHeaders(backendKey),
        body: JSON.stringify(upstreamBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`upstream_error:${response.status}`);
        error.status = response.status;
        error.detail = errorText;
        throw error;
      }

      successfulBackend = backend;
      recordBackendSuccess(backendKey, { promoteActive: true });
      if (primaryBackend && backend.key !== primaryBackend.key) {
        const failoverReason = summarizeError(lastError || routerState.backendState[PRIMARY_BACKEND_KEY]?.lastError || 'primary_unavailable');
        console.warn(`[Cerbère] failover to ${backend.label} (primary=${primaryBackend.label}, reason=${failoverReason})`);
        recordFailover(primaryBackend.key, backend.key, failoverReason);
      }
      console.log(`[Cerbère] ${backend.label} success`);
      break;
    } catch (error) {
      recordBackendFailure(backendKey, error);
      lastError = error;
      const summary = summarizeError(error);
      failureSummaries.push({ backend: backend.label, reason: summary, skipped: false });
      console.warn(`[Cerbère] ${backend.label} failed -> ${summary}`);
      if (backendKey === PRIMARY_BACKEND_KEY) {
        routerState.lastPrimaryError = summary;
        routerState.lastPrimaryFailureAt = isoNow();
      }
    }
  }

  if (!response || !successfulBackend) {
    const lastSummary = summarizeError(lastError);
    return res.status(502).json({
      error: "router_error",
      message: lastSummary,
      detail: lastError?.detail || String(lastError || 'no_backend_available'),
      failover: getBackendStateSnapshot(),
      attempts: failureSummaries,
    });
  }

  res.setHeader('X-Cerbere-Primary-Backend', primaryBackend?.label || routerState.primaryBackend);
  res.setHeader('X-Cerbere-Active-Backend', successfulBackend.label);
  res.setHeader('X-Cerbere-Failover', successfulBackend.key !== primaryBackend?.key ? '1' : '0');

  try {
    // STREAM -> on ne peut pas intercepter les actions
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      response.body.pipe(res);
      return;
    }

    // NON-STREAM -> on peut analyser la réponse et exécuter des actions
    const data = await response.json();

    const rawContent =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      "";

    // On essaie de trouver une enveloppe JSON dans le texte
    const envelope = bypassActionExecution ? null : parseEnvelope(rawContent);

    if (envelope && envelope.mode === "actions") {
      const actions = Array.isArray(envelope.actions) ? envelope.actions : [];
      const results = [];

      console.log(
        "[Cerbère] Envelope mode=actions, nb actions:",
        actions.length
      );

      for (const act of actions) {
        try {
          const r = await handleDevAction(act);
          results.push({ ok: true, action: act.action, result: r });
        } catch (err) {
          console.warn("[Cerbère] action error:", act.action, err.message);
          results.push({
            ok: false,
            action: act.action,
            error: String(err.message || err),
          });
        }
      }

      const summary =
        envelope.message ||
        `J'ai exécuté ${actions.length} action(s).`;

      if (data.choices && data.choices[0] && data.choices[0].message) {
      data.choices[0].message.content = sanitizeUtf8Text(summary);
    }

      data.a11_actions = actions;
      data.a11_results = results;
    }

    if (data?.choices?.[0]?.message?.content) {
      data.choices[0].message.content = sanitizeUtf8Text(data.choices[0].message.content);
    }
    data.cerbere = {
      ...(data.cerbere && typeof data.cerbere === 'object' ? data.cerbere : {}),
      primaryBackend: primaryBackend?.label || routerState.primaryBackend,
      activeBackend: successfulBackend.label,
      failover: successfulBackend.key !== primaryBackend?.key,
    };
    return res.json(data);
  } catch (err) {
    console.error("[Cerbère] Error:", err.message);
    res.status(502).json({
      error: "router_error",
      message: err.message,
      detail: String(err),
    });
  }
});

// Correction: endpoint stats compatible legacy et nouveau
app.get(['/api/stats', '/api/llm/stats'], async (req, res) => {
  await probeConfiguredBackends({ force: true });
  res.json({
    service: 'cerbere-dev-engine',
    version: '2.0.0',
    routerKind: 'legacy-standalone-runner',
    routerEntrypoint: 'llm-router.mjs',
    canonical: false,
    supersededBy: 'llm-router.cjs',
    canonicalStandaloneRunner: 'llm-router-runner.cjs',
    mode: DEV_MODE ? 'developer' : 'production',
    backends: BACKENDS,
    features: [
      'dev_engine',
      'nossen_protocol',
      'multi_backend_routing',
      'smart_prompting',
      'observable_failover',
      'circuit_breaker'
    ],
    ...getBackendStateSnapshot(),
  });
});

probeConfiguredBackends({ force: true }).catch((error) => {
  console.warn('[Cerbère] backend probe bootstrap failed:', error?.message || error);
});

setInterval(() => {
  probeConfiguredBackends().catch((error) => {
    console.warn('[Cerbère] backend probe refresh failed:', error?.message || error);
  });
}, BACKEND_PROBE_INTERVAL_MS).unref();

// Start server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Cerbère] 🔮 LEGACY standalone engine listening on http://127.0.0.1:${PORT}`);
  console.log('[Cerbère] Canonical router: llm-router.cjs');
  console.log('[Cerbère] Features: DEV_ENGINE + NOSSEN Protocol');
  console.log('[Cerbère] Ready to assist with development tasks');
});
