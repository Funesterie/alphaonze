#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========= CONFIG =========
const A11_API_URL = "http://127.0.0.1:3000/v1/chat/completions";
const A11_MODEL = "a11-phi3";
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "a11-mcp.log");

// ========= LOGGING UTILS =========
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logEvent(type, payload) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    ...payload,
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    console.error("[A11-MCP] Failed to write log:", e);
  }
}

// ========= APPEL A11 GÉNÉRIQUE =========
async function callA11({ system, user, temperature = 0.6 }) {
  const body = {
    model: A11_MODEL,
    messages: [],
    temperature,
  };

  if (system) {
    body.messages.push({ role: "system", content: system });
  }
  body.messages.push({ role: "user", content: user });

  logEvent("request", { body });

  const res = await fetch(A11_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logEvent("error", { status: res.status, text });
    throw new Error(
      `A11 HTTP ${res.status} – ${text?.slice(0, 200) || "no body"}`
    );
  }

  const json = await res.json();
  logEvent("response", { json });

  const msg = json.choices?.[0]?.message?.content || "";
  return msg;
}

// ========= MCP SERVER (SIMPLE JSON-RPC OVER STDIO) =========
const tools = {
  a11_chat: {
    description:
      "Discussion générale avec l'IA A11 (réponses naturelles, explications, brainstorming).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        temperature: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["prompt"],
    },
  },
  a11_code: {
    description:
      "Assistant orienté code. Donne la stack (langage, fichier, contexte) pour des réponses précises.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        language: { type: "string" },
        filepath: { type: "string" },
        snippet: { type: "string" },
      },
      required: ["prompt"],
    },
  },
  a11_system: {
    description:
      "Envoie des instructions système à A11 (mode NOSSEN, persona, debug, etc.). À utiliser avec prudence.",
    inputSchema: {
      type: "object",
      properties: {
        systemPrompt: { type: "string" },
        userPrompt: { type: "string" },
      },
      required: ["systemPrompt", "userPrompt"],
    },
  },
};

let messageId = 0;

function sendResponse(id, result) {
  const response = {
    jsonrpc: "2.0",
    id,
    result,
  };
  console.log(JSON.stringify(response));
}

function sendError(id, error) {
  const response = {
    jsonrpc: "2.0",
    id,
    error,
  };
  console.log(JSON.stringify(response));
}

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: {
        name: "a11-mcp-server",
        version: "0.1.0",
      },
    });
  } else if (method === "tools/list") {
    const toolList = Object.keys(tools).map((name) => ({
      name,
      description: tools[name].description,
      inputSchema: tools[name].inputSchema,
    }));
    sendResponse(id, {
      tools: toolList,
    });
  } else if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      let result;
      if (name === "a11_chat") {
        const content = await callA11({
          user: args.prompt,
          temperature: args.temperature ?? 0.7,
        });
        result = {
          content: [{ type: "text", text: content }],
        };
      } else if (name === "a11_code") {
        const sys = [
          "Tu es A-11, assistant de développement de Jeffrey.",
          "Réponds avec du code propre, commenté si nécessaire.",
          "Si le fichier et un extrait sont fournis, respecte leur style.",
        ].join("\n");

        const contextParts = [];
        if (args.language) contextParts.push(`Langage : ${args.language}`);
        if (args.filepath) contextParts.push(`Fichier : ${args.filepath}`);
        if (args.snippet) {
          contextParts.push("Contexte du fichier :");
          contextParts.push(args.snippet);
        }

        const fullPrompt = [
          contextParts.join("\n\n"),
          "",
          "Demande :",
          args.prompt,
        ].join("\n\n");

        const content = await callA11({
          system: sys,
          user: fullPrompt,
          temperature: 0.4,
        });
        result = {
          content: [{ type: "text", text: content }],
        };
      } else if (name === "a11_system") {
        const content = await callA11({
          system: args.systemPrompt,
          user: args.userPrompt,
          temperature: 0.6,
        });
        result = {
          content: [{ type: "text", text: content }],
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      sendResponse(id, result);
    } catch (e) {
      sendError(id, {
        code: -32000,
        message: e.message,
      });
    }
  } else {
    sendError(id, {
      code: -32601,
      message: "Method not found",
    });
  }
}

// Listen on stdin
process.stdin.on("data", (data) => {
  const lines = data.toString().trim().split("\n");
  for (const line of lines) {
    if (line.trim()) {
      try {
        const request = JSON.parse(line);
        handleRequest(request);
      } catch (e) {
        console.error("[A11-MCP] Failed to parse request:", e);
      }
    }
  }
});

console.error("[A11-MCP] Server started on STDIN/STDOUT.");
console.error(`[A11-MCP] A11 endpoint: ${A11_API_URL} (${A11_MODEL})`);
console.error(`[A11-MCP] Logs: ${LOG_FILE}`);
