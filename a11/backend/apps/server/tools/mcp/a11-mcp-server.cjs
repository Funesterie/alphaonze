#!/usr/bin/env node
/**
 * A11 MCP Server
 * Expose les capacités d'A11 comme outils MCP pour Kiro.
 *
 * Protocole : JSON-RPC 2.0 sur stdin/stdout (MCP standard).
 * Chaque outil fait un appel HTTP vers le backend A11 local.
 *
 * Usage : node a11-mcp-server.cjs
 * Env   : A11_BASE_URL (défaut: http://localhost:3000)
 *         A11_NEZ_TOKEN (optionnel, pour les routes protégées)
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const A11_BASE_URL = (process.env.A11_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const NEZ_TOKEN = process.env.A11_NEZ_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro';
const SERVER_NAME = 'a11';
const SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// HTTP helper (pas de dépendance externe, node:http natif)
// ---------------------------------------------------------------------------

function httpRequest(method, urlStr, body = null, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body != null ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-NEZ-TOKEN': NEZ_TOKEN,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { raw };
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function a11Get(path) {
  return httpRequest('GET', `${A11_BASE_URL}${path}`);
}

async function a11Post(path, body, timeoutMs) {
  return httpRequest('POST', `${A11_BASE_URL}${path}`, body, timeoutMs);
}

// ---------------------------------------------------------------------------
// Définition des outils MCP
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'a11_health',
    description: 'Vérifie que le backend A11 est en ligne et retourne son statut.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_chat',
    description:
      'Envoie un message au pipeline de chat A11. A11 détecte automatiquement l\'intention (génération d\'image, vidéo, recherche web, réponse LLM) et retourne la réponse appropriée.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Le message ou la question à envoyer à A11.',
        },
        conversationId: {
          type: 'string',
          description: 'ID de conversation pour maintenir le contexte multi-tour (optionnel).',
        },
        model: {
          type: 'string',
          description: 'Modèle LLM à utiliser, ex: "gemma4:e4b", "gpt-4o" (optionnel, utilise le défaut sinon).',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'a11_generate_image',
    description:
      'Génère une image via le pipeline Stable Diffusion d\'A11. Retourne l\'URL ou les données de l\'image générée.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description de l\'image à générer (en français ou anglais).',
        },
        negativePrompt: {
          type: 'string',
          description: 'Ce qu\'il ne faut pas inclure dans l\'image (optionnel).',
        },
        width: {
          type: 'number',
          description: 'Largeur en pixels (optionnel, défaut: 512).',
        },
        height: {
          type: 'number',
          description: 'Hauteur en pixels (optionnel, défaut: 512).',
        },
        steps: {
          type: 'number',
          description: 'Nombre d\'étapes de diffusion (optionnel, défaut: 20).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'a11_generate_video',
    description:
      'Génère une vidéo frame-par-frame via le pipeline A11 (SD + FFmpeg). Peut prendre plusieurs minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description de la vidéo à générer.',
        },
        frames: {
          type: 'number',
          description: 'Nombre de frames (optionnel, défaut selon config A11).',
        },
        fps: {
          type: 'number',
          description: 'Frames par seconde (optionnel).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'a11_vs_status',
    description:
      'Retourne le statut du bridge A11Host (VS Code VSIX ou mode headless) : disponibilité, capacités, workspace root.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_vs_capabilities',
    description:
      'Retourne la liste complète des capacités disponibles dans le bridge A11Host (lecture fichier, shell, build, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_vs_project_structure',
    description:
      'Retourne la structure du projet ouvert dans le workspace A11 (arborescence de fichiers).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_vs_active_document',
    description:
      'Retourne le contenu du document actif dans l\'éditeur VS Code connecté à A11.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_vs_execute_shell',
    description:
      'Exécute une commande shell via le bridge A11Host (liste blanche de commandes autorisées). Retourne stdout/stderr.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'La commande shell à exécuter (doit être dans la liste blanche A11).',
        },
        cwd: {
          type: 'string',
          description: 'Répertoire de travail (optionnel).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'a11_llm_stats',
    description:
      'Retourne les statistiques du routeur LLM d\'A11 (modèles disponibles, latences, usage).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_shell',
    description:
      'Exécute une commande shell dans le workspace Funesterie via A11. Liste blanche stricte : node, npm, npx, git, tsc, vitest, cat, ls, find, grep, echo, pwsh. Permet à A11 d\'installer des packages npm, lancer des builds, lire des fichiers, exécuter des scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Commande à exécuter (ex: "npm install @funeste38/qflush", "git status", "node script.cjs").',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments séparés (optionnel, sinon parsés depuis command).',
        },
        cwd: {
          type: 'string',
          description: 'Répertoire de travail relatif au workspace root (optionnel).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout en ms (défaut: 30000, max: 120000).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'a11_shell_whitelist',
    description: 'Retourne la liste des commandes shell autorisées pour A11.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers des outils
// ---------------------------------------------------------------------------

async function handleTool(name, args) {
  switch (name) {
    case 'a11_health': {
      const res = await a11Get('/health');
      return formatResult(res);
    }

    case 'a11_chat': {
      const body = {
        message: args.message,
        max_tokens: 4096,
        n_predict: 4096,
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
        ...(args.model ? { model: args.model } : {}),
      };
      // Le chat peut prendre du temps si génération d'image/vidéo
      const res = await a11Post('/api/chat', body, 120_000);
      return formatResult(res);
    }

    case 'a11_generate_image': {
      const body = {
        prompt: args.prompt,
        ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
        ...(args.width ? { width: args.width } : {}),
        ...(args.height ? { height: args.height } : {}),
        ...(args.steps ? { steps: args.steps } : {}),
      };
      const res = await a11Post('/api/tools/generate_sd', body, 180_000);
      return formatResult(res);
    }

    case 'a11_generate_video': {
      const body = {
        prompt: args.prompt,
        ...(args.frames ? { frames: args.frames } : {}),
        ...(args.fps ? { fps: args.fps } : {}),
      };
      // La vidéo peut prendre très longtemps
      const res = await a11Post('/api/video/generate', body, 600_000);
      return formatResult(res);
    }

    case 'a11_vs_status': {
      const res = await a11Get('/api/v1/vs/status');
      return formatResult(res);
    }

    case 'a11_vs_capabilities': {
      const res = await a11Get('/api/v1/vs/capabilities');
      return formatResult(res);
    }

    case 'a11_vs_project_structure': {
      const res = await a11Get('/api/v1/vs/project-structure');
      return formatResult(res);
    }

    case 'a11_vs_active_document': {
      const res = await a11Get('/api/v1/vs/active-document');
      return formatResult(res);
    }

    case 'a11_vs_execute_shell': {
      const body = {
        command: args.command,
        ...(args.cwd ? { cwd: args.cwd } : {}),
      };
      const res = await a11Post('/api/v1/vs/execute-shell', body, 60_000);
      return formatResult(res);
    }

    case 'a11_llm_stats': {
      const res = await a11Get('/api/llm/stats');
      return formatResult(res);
    }

    case 'a11_shell': {
      const body = {
        command: args.command,
        ...(args.args ? { args: args.args } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(args.timeout ? { timeout: args.timeout } : {}),
      };
      const res = await a11Post('/api/agent/shell', body, (args.timeout || 30_000) + 5_000);
      return formatResult(res);
    }

    case 'a11_shell_whitelist': {
      const res = await a11Get('/api/agent/shell/whitelist');
      return formatResult(res);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatResult(res) {
  const text = JSON.stringify(res.data, null, 2);
  return {
    content: [
      {
        type: 'text',
        text: res.status >= 400
          ? `[HTTP ${res.status}] ${text}`
          : text,
      },
    ],
    isError: res.status >= 400,
  };
}

// ---------------------------------------------------------------------------
// Boucle JSON-RPC MCP (stdin/stdout)
// ---------------------------------------------------------------------------

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  // MCP envoie des messages délimités par newline
  const lines = buffer.split('\n');
  buffer = lines.pop(); // garder le fragment incomplet
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) handleMessage(trimmed);
  }
});

process.stdin.on('end', () => {
  if (buffer.trim()) handleMessage(buffer.trim());
  process.exit(0);
});

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize': {
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        break;
      }

      case 'notifications/initialized':
        // Pas de réponse attendue pour les notifications
        break;

      case 'tools/list': {
        sendResult(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        if (!toolName) {
          sendError(id, -32602, 'Missing tool name');
          return;
        }
        const result = await handleTool(toolName, toolArgs);
        sendResult(id, result);
        break;
      }

      case 'ping': {
        sendResult(id, {});
        break;
      }

      default: {
        // Méthodes inconnues : répondre avec une erreur seulement si c'est une requête (a un id)
        if (id !== undefined && id !== null) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
      }
    }
  } catch (err) {
    const isToolError = err?.message?.includes('ECONNREFUSED') || err?.message?.includes('timeout');
    const message = isToolError
      ? `A11 backend unreachable at ${A11_BASE_URL} — ${err.message}`
      : err.message || 'Internal error';
    sendError(id, -32603, message);
  }
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Signaler que le serveur est prêt (log sur stderr pour ne pas polluer stdout)
process.stderr.write(`[A11 MCP] Server started — A11_BASE_URL=${A11_BASE_URL}\n`);
