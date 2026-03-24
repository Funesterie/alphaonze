#!/usr/bin/env node
// apps/server/llm-router.mjs - Cerbère DEV ENGINE

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.LLM_ROUTER_PORT || process.env.PORT || 4545;

// Backend configuration
const BACKENDS = {
  llama_local: process.env.LLAMA_BASE || "http://127.0.0.1:8000",
  ollama: "http://127.0.0.1:11434",
  openai: process.env.OPENAI_API_URL || null
};

console.log('[Cerbère] DEV ENGINE initialized');
console.log('[Cerbère] Available backends:', BACKENDS);

// Backend selection based on explicit provider first, then model fallback
function selectBackend(model, provider) {
  const providerLower = String(provider || '').toLowerCase();
  if (providerLower === 'openai') return BACKENDS.openai;
  if (providerLower === 'ollama') return BACKENDS.ollama;
  if (providerLower === 'local' || providerLower === 'llama') return BACKENDS.llama_local;

  if (!model) return BACKENDS.llama_local;

  const modelLower = String(model).toLowerCase();
  
  // OpenAI models
  if (modelLower.includes('gpt-')) {
    return BACKENDS.openai;
  }
  
  // Ollama models (qwen, mistral, codellama, etc.)
  if (modelLower.includes('qwen') || 
      modelLower.includes('mistral') || 
      modelLower.includes('codellama') ||
      modelLower.includes('deepseek')) {
    return BACKENDS.ollama;
  }
  
  // LLaMA models (default)
  return BACKENDS.llama_local;
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
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'cerbere-dev-engine',
    port: PORT,
    backends: Object.keys(BACKENDS).filter(k => BACKENDS[k])
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
  const provider = body.provider;
  const messages = body.messages || [];
  const stream = body.stream === true;

  // Contexte dev (comme tu l'avais)
  const devContext = {
    files: req.headers["x-dev-files"] || body.dev_context?.files || "",
    errors: req.headers["x-dev-errors"] || body.dev_context?.errors || "",
    mode: req.headers["x-dev-mode"] || body.dev_context?.mode || "DEV_ENGINE",
  };

  const isDeveloperMode =
    devContext.files ||
    devContext.errors ||
    messages.some(
      (m) =>
        typeof m.content === "string" &&
        (m.content.includes("[DEV_ENGINE]") || m.content.includes("[NOSSEN]"))
    );

  let enhancedMessages = [...messages];

  // Si mode DEV, on emballe le dernier message avec buildDeveloperPrompt
  if (isDeveloperMode && messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "user") {
      const enhancedPrompt = buildDeveloperPrompt(lastMessage.content, devContext);
      enhancedMessages = [
        ...messages.slice(0, -1),
        { role: "user", content: enhancedPrompt },
      ];
    }
  }

  const backend = selectBackend(model, provider);
  if (!backend) {
    return res.status(502).json({
      error: "no_backend_available",
      detail: `No backend configured for model/provider: ${model}/${provider || 'n/a'}`,
    });
  }

  const upstreamUrl = `${backend.replace(/\/$/, "")}/v1/chat/completions`;
  console.log(`[Cerbère] Routing to: ${upstreamUrl}`);
  console.log(`[Cerbère] Model: ${model}`);
  console.log(`[Cerbère] Provider: ${provider || 'auto'}`);
  console.log(`[Cerbère] Dev mode: ${isDeveloperMode}`);

  const upstreamBody = {
    ...body,
    model,
    messages: enhancedMessages,
    stream,
  };

  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "upstream_error",
        status: response.status,
        detail: errorText,
      });
    }

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
    const envelope = parseEnvelope(rawContent);

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
        data.choices[0].message.content = summary;
      }

      data.a11_actions = actions;
      data.a11_results = results;
    }

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
app.get(['/api/stats', '/api/llm/stats'], (req, res) => {
  res.json({
    service: 'cerbere-dev-engine',
    version: '2.0.0',
    mode: 'developer',
    backends: BACKENDS,
    features: [
      'dev_engine',
      'nossen_protocol',
      'multi_backend_routing',
      'smart_prompting'
    ]
  });
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Cerbère] 🔮 DEV ENGINE listening on http://127.0.0.1:${PORT}`);
  console.log('[Cerbère] Features: DEV_ENGINE + NOSSEN Protocol');
  console.log('[Cerbère] Ready to assist with development tasks');
});
