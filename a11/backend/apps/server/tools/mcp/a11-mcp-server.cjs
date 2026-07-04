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
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { URL } = require('node:url');
const workerSupervisor = require('../../lib/worker-supervisor.cjs');
const westsideChopper = require('../../lib/westside-chopper.cjs');
const funesterieMixer = require('../../lib/funesterie-mixer.cjs');
const a11MemoryGraph = require('../../src/knowledge/a11-memory-graph-v1.cjs');
const vivyGraphAccess = require('../../src/knowledge/vivy-graph-access.cjs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readWindowsUserEnv(name) {
  if (process.platform !== 'win32') return '';
  if (process.env.A11_MCP_DISABLE_WINDOWS_USER_ENV === '1') return '';
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$n = '${name}'; [Environment]::GetEnvironmentVariable($n, 'User')`,
      ],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    ).trim();
  } catch {
    return '';
  }
}

function resolveNezToken() {
  return process.env.A11_NEZ_TOKEN
    || process.env.NEZ_TOKENS
    || readWindowsUserEnv('A11_NEZ_TOKEN')
    || '';
}

const A11_BASE_URL = (process.env.A11_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const NEZ_TOKEN = resolveNezToken();
const SERVER_NAME = 'a11';
const SERVER_VERSION = '1.0.0';
const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', '..');
const RUBIXCUBE_VAULT_MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'rubixgate', 'rubixcube-vault.cjs');
let rubixcubeVault = null;
try {
  rubixcubeVault = require(RUBIXCUBE_VAULT_MODULE_PATH);
} catch (error) {
  rubixcubeVault = null;
}
const DEFAULT_RUNTIME_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', 'runtime');
const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT);
const KIRO_MCP_CONFIG_PATH = path.resolve(
  process.env.KIRO_MCP_CONFIG_PATH || 'D:\\projets\\funesterie\\.kiro\\settings\\mcp.json'
);
const DEFAULT_SHARED_MCP_URL = 'https://mcp.funesterie.me/mcp';
const DEFAULT_RUBIXCUBE_VAULT_NAME = process.env.RUBIXCUBE_DEFAULT_VAULT_NAME || 'funesterie-core';
const ROUTE_MAP_PATH = path.resolve(
  process.env.A11_ROUTE_MAP_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'a11-route-map.json')
);
const ROUTE_MAP_MD_PATH = path.resolve(
  process.env.A11_ROUTE_MAP_MD_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'a11-route-map.md')
);
const RUNTIME_HOOKS_PATH = path.resolve(
  process.env.A11_RUNTIME_HOOKS_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'a11-runtime-hooks.json')
);
const RUNTIME_HOOKS_MD_PATH = path.resolve(
  process.env.A11_RUNTIME_HOOKS_MD_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'a11-runtime-hooks.md')
);
const ECOSYSTEM_SCOPE_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_SCOPE_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-scope.json')
);
const ECOSYSTEM_SCOPE_MD_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_SCOPE_MD_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-scope.md')
);
const ECOSYSTEM_CORPUS_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_CORPUS_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-corpus.json')
);
const ECOSYSTEM_CORPUS_MD_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_CORPUS_MD_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-corpus.md')
);
const ECOSYSTEM_BRIEFING_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_BRIEFING_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-briefing.json')
);
const ECOSYSTEM_BRIEFING_HTML_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_BRIEFING_HTML_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-briefing.html')
);
const ECOSYSTEM_BRIEFING_PDF_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_BRIEFING_PDF_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-ecosystem-briefing.pdf')
);
const ECOSYSTEM_EXECUTIVE_VIEW_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_EXECUTIVE_VIEW_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-executive-view.md')
);
const ECOSYSTEM_ARCHITECTURE_VIEW_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_ARCHITECTURE_VIEW_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'funesterie-architecture-view.md')
);
const ECOSYSTEM_A11_IMAGE_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_A11_IMAGE_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'assets', 'a11-mcp-identity.png')
);
const ECOSYSTEM_FUNESTERIE_IMAGE_PATH = path.resolve(
  process.env.A11_ECOSYSTEM_FUNESTERIE_IMAGE_PATH || path.join(RUNTIME_ROOT, 'knowledge-graph', 'assets', 'funesterie-ecosystem-identity.png')
);
const LOCAL_CONTEXT_PATH = path.resolve(
  process.env.A11_LOCAL_CONTEXT_PATH || 'D:\\projets\\funesterie\\docs\\A11_CONTEXT_2026-05-06.md'
);

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readKiroMcpConfigSafe() {
  return readJsonFileSafe(KIRO_MCP_CONFIG_PATH);
}

function stripBearer(value) {
  return String(value || '').replace(/^Bearer\s+/i, '').trim();
}

function envValue(name) {
  return process.env[name] || readWindowsUserEnv(name) || '';
}

function resolveEnvPlaceholders(value) {
  return String(value || '')
    .replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => envValue(name))
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => envValue(name))
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => envValue(name));
}

function resolveTokenValue(value) {
  const resolved = stripBearer(resolveEnvPlaceholders(value)).trim();
  if (!resolved) return '';
  if (/\$\{env:|\$env:|%[A-Za-z_][A-Za-z0-9_]*%/.test(resolved)) return '';
  return resolved;
}

function localTokenCandidatePaths() {
  const agentBusDir = process.env.A11_AGENT_BUS_DIR || process.env.AGENT_BUS_DIR || 'D:\\agent-bus';
  const candidates = [
    process.env.A11_MCP_TOKEN_FILE,
    process.env.MCP_AUTH_TOKEN_FILE,
    process.env.AGENT_STATE_DIR ? path.join(process.env.AGENT_STATE_DIR, 'mcp-token-current.txt') : '',
    path.join(agentBusDir, 'mcp-token-current.txt'),
    'D:\\projets\\funesterie\\a11mcp\\.env',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop', 'mcp-token.txt') : '',
    // Legacy sync folders. Keep last so Drive is never used as the live bus.
    'G:\\Mon Drive\\a11_memory\\agent-bus\\mcp-token-current.txt',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'OneDrive', 'a11_memory', 'agent-bus', 'mcp-token-current.txt') : '',
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function parseTokenFile(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  for (const line of lines) {
    const match = line.match(/^(?:MCP_AUTH_TOKEN|A11_MCP_TOKEN|A11_PUBLIC_MCP_TOKEN)\s*=\s*(.+)$/);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, '');
    const token = resolveTokenValue(value);
    if (token) return token;
  }

  if (lines.length === 1 && !lines[0].includes('=')) {
    return resolveTokenValue(lines[0]);
  }

  return '';
}

function loadSharedMcpTokenFromFile() {
  for (const candidate of localTokenCandidatePaths()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const token = parseTokenFile(fs.readFileSync(candidate, 'utf8'));
      if (token) return { token, source: 'token-file' };
    } catch (_) {
      // Ignore unreadable token candidates; other locations may still work.
    }
  }
  return { token: '', source: 'missing' };
}

function getSharedMcpConfigFromKiro() {
  const config = readKiroMcpConfigSafe();
  const shared = config?.mcpServers?.['a11mcp-shared'] || config?.mcpServers?.['a11mcp-aura-local'] || null;
  const authorization = shared?.headers?.Authorization || shared?.headers?.authorization || '';
  const headerToken = shared?.headers?.['x-mcp-token'] || shared?.headers?.['X-MCP-Token'] || '';
  return {
    url: String(shared?.url || '').trim(),
    token: resolveTokenValue(authorization) || resolveTokenValue(headerToken),
    source: shared ? 'kiro-config' : 'default',
  };
}

function resolveSharedMcpConfig() {
  const kiro = getSharedMcpConfigFromKiro();
  const fileToken = loadSharedMcpTokenFromFile();
  const envToken = resolveTokenValue(
    process.env.A11_MCP_TOKEN
    || process.env.A11_PUBLIC_MCP_TOKEN
    || process.env.MCP_AUTH_TOKEN
    || ''
  );
  const url = String(
    process.env.A11_SHARED_MCP_URL
    || process.env.A11_PUBLIC_MCP_UPSTREAM_URL
    || process.env.A11_MCP_URL
    || process.env.FUNESTERIE_MCP_URL
    || kiro.url
    || DEFAULT_SHARED_MCP_URL
  ).trim().replace(/\/+$/, '');
  const token = envToken || kiro.token || fileToken.token || '';
  return {
    url,
    token,
    tokenPresent: Boolean(token),
    source: token ? (envToken ? 'env' : (kiro.token ? kiro.source : fileToken.source)) : 'missing',
  };
}

const AI_DIALOGUE_TOOLS = Object.freeze([
  'a11_ai_identity_registry',
  'a11_ai_identity_handshake',
  'a11_agent_dialogue_open',
  'a11_agent_dialogue_ask',
  'a11_agent_dialogue_inbox',
  'a11_agent_dialogue_read',
  'a11_agent_dialogue_post',
  'a11_vivy_graph_search',
]);

const AI_MEDIA_CHAT_TOOLS = Object.freeze([
  ...AI_DIALOGUE_TOOLS,
  'a11_chat',
  'a11_social_autoprompt_status',
]);

const AI_INTERNAL_TOOLS = Object.freeze([
  ...AI_MEDIA_CHAT_TOOLS,
  'a11_status',
  'a11_llm_stats',
  'a11_memory_graph_explain_agent_context',
  'a11_identity_route',
  'a11_shared_mcp_status',
]);

const AI_FORBIDDEN_TOOLS = Object.freeze([
  'a11_shell',
  'a11_worker_start',
  'a11_worker_stop',
  'a11_worker_restart',
  'a11_task_dispatch',
  'a11_rubixcube_vault_consume',
  'a11_rubixcube_shared_mcp_token_check',
  'a11_vivy_graph_sync',
]);

const AI_IDENTITY_PROFILES = Object.freeze({
  chatgpt: {
    id: 'chatgpt',
    provider: 'openai',
    displayName: 'ChatGPT',
    role: 'external-llm-collaborator',
    aliases: ['chatgpt', 'gpt', 'openai', 'oai'],
    allowedTools: AI_MEDIA_CHAT_TOOLS,
    memoryScope: ['shared', 'mcp', 'vivy', 'a11', 'creative-review'],
    capabilities: ['dialogue', 'critique', 'prompting', 'creative-review'],
  },
  grok: {
    id: 'grok',
    provider: 'xai',
    displayName: 'Grok',
    role: 'external-llm-collaborator',
    aliases: ['grok', 'xai', 'grok-3', 'grok-4'],
    allowedTools: AI_MEDIA_CHAT_TOOLS,
    memoryScope: ['shared', 'mcp', 'vivy', 'a11', 'creative-review'],
    capabilities: ['dialogue', 'critique', 'style-contrast', 'creative-review'],
  },
  claude: {
    id: 'claude',
    provider: 'anthropic',
    displayName: 'Claude',
    role: 'external-llm-collaborator',
    aliases: ['claude', 'anthropic'],
    allowedTools: AI_MEDIA_CHAT_TOOLS,
    memoryScope: ['shared', 'mcp', 'vivy', 'a11', 'analysis'],
    capabilities: ['dialogue', 'analysis', 'critique', 'safety-review'],
  },
  codex: {
    id: 'codex',
    provider: 'openai',
    displayName: 'Codex',
    role: 'local-engineering-agent',
    aliases: ['codex', 'a11-codex', 'codex-desktop'],
    allowedTools: AI_INTERNAL_TOOLS,
    memoryScope: ['shared', 'mcp', 'a11', 'kaen44', 'vivy', 'code'],
    capabilities: ['dialogue', 'code', 'tests', 'deploy-review'],
  },
  vivy: {
    id: 'vivy',
    provider: 'funesterie',
    displayName: 'Vivy',
    role: 'musical-agent',
    aliases: ['vivy', 'vivy-live', 'nossen'],
    allowedTools: AI_MEDIA_CHAT_TOOLS,
    memoryScope: ['shared', 'mcp', 'vivy', 'music', 'video'],
    capabilities: ['dialogue', 'music', 'lyrics', 'visual-direction'],
  },
  a11: {
    id: 'a11',
    provider: 'funesterie',
    displayName: 'A11',
    role: 'orchestrator-agent',
    aliases: ['a11', 'alpha-onze', 'alpha11'],
    allowedTools: AI_INTERNAL_TOOLS,
    memoryScope: ['shared', 'mcp', 'a11', 'kaen44', 'vivy', 'ops'],
    capabilities: ['dialogue', 'routing', 'graph', 'coordination'],
  },
  kaen44: {
    id: 'kaen44',
    provider: 'funesterie',
    displayName: 'K44',
    role: 'copilot-agent',
    aliases: ['k44', 'kaen44', 'kaen'],
    allowedTools: AI_INTERNAL_TOOLS,
    memoryScope: ['shared', 'mcp', 'kaen44', 'a11', 'vivy'],
    capabilities: ['dialogue', 'copilot', 'review', 'coordination'],
  },
});

function normalizeAiIdentityKey(value = '') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'unknown-ai';
}

function uniqueStrings(values = [], max = 20) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const cleaned = String(value || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    result.push(cleaned);
    seen.add(cleaned);
    if (result.length >= max) break;
  }
  return result;
}

function resolveAiIdentityProfile(args = {}) {
  const raw = normalizeAiIdentityKey(
    args.agent || args.agentId || args.provider || args.name || args.from || args.model || 'chatgpt'
  );
  const profile = Object.values(AI_IDENTITY_PROFILES).find((candidate) => (
    candidate.id === raw
    || candidate.provider === raw
    || candidate.aliases.includes(raw)
    || raw.startsWith(`${candidate.id}-`)
    || raw.startsWith(`${candidate.provider}-`)
  )) || AI_IDENTITY_PROFILES.chatgpt;
  return profile;
}

function publicAiIdentityProfile(profile) {
  return {
    id: profile.id,
    provider: profile.provider,
    displayName: profile.displayName,
    role: profile.role,
    aliases: profile.aliases,
    capabilities: profile.capabilities,
    memoryScope: profile.memoryScope,
    allowedTools: profile.allowedTools,
    forbiddenTools: AI_FORBIDDEN_TOOLS,
    policy: {
      isAgent: true,
      adminRoleForbidden: true,
      secretsForbidden: true,
      shellForbidden: true,
      directDatabaseWritesForbidden: true,
      chatAccess: 'dialogue-bus-first',
    },
  };
}

function buildAiIdentityRegistry() {
  return {
    ok: true,
    schema: 'funesterie.a11.ai-identity-registry.v1',
    model: 'investigation-graph-inspired-rbac-for-ai',
    rule: 'Une IA s identifie, reçoit un profil, puis utilise seulement les outils autorisés. Aucun agent IA ne reçoit un rôle administrateur technique.',
    profiles: Object.fromEntries(
      Object.entries(AI_IDENTITY_PROFILES).map(([key, profile]) => [key, publicAiIdentityProfile(profile)])
    ),
    dialogueTools: AI_DIALOGUE_TOOLS,
    mediaChatTools: AI_MEDIA_CHAT_TOOLS,
    forbiddenTools: AI_FORBIDDEN_TOOLS,
  };
}

function buildAiIdentityHandshake(args = {}) {
  const profile = resolveAiIdentityProfile(args);
  const requestedTools = uniqueStrings(args.requestedTools || args.tools || [], 32);
  const allowedSet = new Set(profile.allowedTools);
  const forbiddenSet = new Set(AI_FORBIDDEN_TOOLS);
  const allowedTools = requestedTools.length
    ? requestedTools.filter((tool) => allowedSet.has(tool) && !forbiddenSet.has(tool))
    : [...profile.allowedTools];
  const deniedTools = requestedTools.filter((tool) => !allowedSet.has(tool) || forbiddenSet.has(tool));
  const displayName = String(args.displayName || args.name || profile.displayName).trim().slice(0, 80) || profile.displayName;
  const model = String(args.model || '').trim().slice(0, 120);
  const agentId = normalizeAiIdentityKey(args.agentId || `${profile.id}${model ? `-${model}` : ''}`);
  const purpose = String(args.purpose || 'dialogue IA Funesterie').trim().slice(0, 240);
  assertNoSecretText(displayName, 'displayName');
  assertNoSecretText(model, 'model');
  assertNoSecretText(purpose, 'purpose');
  const sessionSeed = [
    profile.id,
    agentId,
    displayName,
    model,
    purpose,
    new Date().toISOString().slice(0, 10),
  ].join('|');
  return {
    ok: true,
    schema: 'funesterie.a11.ai-identity-session.v1',
    sessionId: `ai-session-${crypto.createHash('sha256').update(sessionSeed).digest('hex').slice(0, 18)}`,
    identity: {
      id: profile.id,
      agentId,
      provider: profile.provider,
      displayName,
      model: model || null,
      role: profile.role,
      aliases: uniqueStrings([agentId, displayName, ...profile.aliases], 12),
      capabilities: uniqueStrings([
        ...profile.capabilities,
        ...(Array.isArray(args.capabilities) ? args.capabilities : []),
      ], 16),
      memoryScope: profile.memoryScope,
    },
    access: {
      allowedTools,
      deniedTools,
      dialogueTools: AI_DIALOGUE_TOOLS.filter((tool) => allowedSet.has(tool)),
      directChatTool: allowedSet.has('a11_chat') ? 'a11_chat' : null,
      targetAliases: ['vivy', 'a11', 'kaen44', 'codex', 'chatgpt', 'grok', 'claude'],
    },
    policy: {
      isAgent: true,
      role: profile.role,
      purpose,
      adminRoleForbidden: true,
      secretsForbidden: true,
      shellForbidden: true,
      directDatabaseWritesForbidden: true,
      destructiveToolsForbidden: true,
      useDialogueBusFirst: true,
    },
    mcpHeaders: {
      'x-agent': 'true',
      'x-ai-agent': profile.id,
      'x-ai-agent-id': agentId,
    },
    nextSteps: [
      'Lire a11_ai_identity_registry si le profil est inconnu.',
      'Utiliser a11_agent_dialogue_ask pour solliciter Vivy, A11, K44, ChatGPT, Grok ou Claude.',
      'Utiliser a11_agent_dialogue_inbox/read/post pour suivre le fil.',
      'Ne jamais demander ni poster de token, clé API, cookie, mot de passe ou fichier .env.',
    ],
    secretExposure: 'none',
  };
}

function getMcpHealthUrl(mcpUrl) {
  try {
    const url = new URL(mcpUrl || DEFAULT_SHARED_MCP_URL);
    url.pathname = url.pathname.replace(/\/mcp\/?$/, '/health') || '/health';
    url.search = '';
    return url.toString();
  } catch (_) {
    return DEFAULT_SHARED_MCP_URL.replace(/\/mcp$/, '/health');
  }
}

function publicSharedMcpConfig() {
  const config = resolveSharedMcpConfig();
  return {
    url: config.url,
    healthUrl: getMcpHealthUrl(config.url),
    tokenPresent: config.tokenPresent,
    source: config.source,
    kiroConfig: KIRO_MCP_CONFIG_PATH,
  };
}

function foldForIntent(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isSocialAutopromptStatusQuestion(message = '') {
  const folded = foldForIntent(message);
  return /\b(?:social\s+autoprompt|youtube|meta|facebook|instagram|insta)\b/.test(folded)
    && /\b(?:status|statut|etat|diagnostic|connect|connexion|voit|voir|ingest|contexte|prompt|autoprompt|facebook|youtube|instagram|meta)\b/.test(folded);
}

function isVivyVisualCreativeDirectionQuestion(message = '', targets = []) {
  const folded = foldForIntent(message);
  const normalizedTargets = new Set((Array.isArray(targets) ? targets : []).map((entry) => foldForIntent(entry)));
  const targetsVivy = normalizedTargets.has('vivy') || normalizedTargets.has('vivy-live') || normalizedTargets.has('nossen');
  const visualSignal = /\b(?:visuel|visuelle|image|images|cover|covers|pochette|affiche|clip|direction\s+live|identite\s+visuelle|scene|micro|microphone|neon|neons|audio\s+analyse|son\s+analyse)\b/.test(folded);
  const reviewSignal = /\b(?:avis|analyse|analyser|regarde|review|direction|garde|garder|evite|eviter|ameliore|ameliorer|canon|canonique|coherent|coherence|incoherent|incoherence|defaut|main|identite|angle|surveille|surveiller)\b/.test(folded);
  const explicitSongwriting = /\b(?:ecris|ecrire|compose|composer|chante|chanter|genere|generer|fais|faire)\b.{0,90}\b(?:paroles|refrain|couplet|chanson|song)\b/.test(folded)
    || /\b(?:paroles|refrain|couplet)\b.{0,60}\b(?:ecris|ecrire|compose|composer|chante|chanter|genere|generer|fais|faire)\b/.test(folded);
  return targetsVivy && visualSignal && reviewSignal && !explicitSongwriting;
}

function buildVivyVisualReviewWorkerMessage(message = '') {
  return [
    'Intent prioritaire: visual-review / creative-direction.',
    'Réponds comme directrice artistique, jamais sous forme de paroles, refrain, couplet ou chanson sauf demande explicite d’écriture.',
    'Structure obligatoire: ce que Vivy garde; ce qu’elle évite; identité visuelle canon; prochain angle clip/chanson.',
    'Contrôle visuel obligatoire: faux texte/UI, anatomie des mains, contact physique main-micro, visage et bouche non cachés.',
    '',
    `Brief reçu: ${String(message || '').trim()}`,
  ].join('\n');
}

function buildVivyVisualReviewReply(message = '') {
  const folded = foldForIntent(message);
  const kept = [];
  if (/\b(?:nuit|nocturne|sombre)\b/.test(folded)) kept.push('la nuit lourde qui devient une scène');
  if (/\b(?:rose|magenta|neon|neons)\b/.test(folded)) kept.push('les néons roses électriques');
  if (/\b(?:micro|microphone|studio)\b/.test(folded)) kept.push('le micro de studio comme point d’ancrage');
  if (/\b(?:bar|club)\b/.test(folded)) kept.push('le bar ou club nocturne crédible');
  if (/\b(?:flou|camera|reel|realiste|photorealiste)\b/.test(folded)) kept.push('le flou caméra réel et la profondeur');
  if (/\b(?:fragile|puissant|puissante|progressif|progressive)\b/.test(folded)) kept.push('le contraste fragile mais puissant');
  if (!kept.length) kept.push('le sujet, la palette, la lumière et l’émotion propres à la scène');
  return [
    'Intent reconnu: visual-review / creative-direction. Je reste directrice artistique; pas de paroles sans demande explicite.',
    '',
    'Ce que Vivy garde:',
    ...kept.slice(0, 6).map((item) => `- ${item}`),
    '',
    'Ce qu’elle évite:',
    '- faux boutons, labels, panneaux UI, sous-titres et pseudo-texte',
    '- main incomplète, doigts avalés, poignet fusionné au micro ou micro remplaçant la main',
    '- visage caché par le micro et présence anime générique sans crédibilité de scène',
    '',
    'Identité visuelle canon:',
    '- goth cyber-pop adulte, noir et magenta, néons roses électriques',
    '- club nocturne réel, micro physiquement crédible, lumière et énergie de scène',
    '- présence fragile mais puissante, jamais simple “anime girl jolie”',
    '',
    'Prochain angle clip/chanson:',
    '- partir en plan mi-large dans la nuit, puis rapprocher la caméra quand le rose gagne le décor',
    '- garder la main complète et le micro lisibles dans le même plan',
    '',
    'Phrase canon: « Vivy ne chante pas seulement dans la nuit. Elle transforme la nuit en scène. »',
  ].join('\n');
}

function parseSharedToolTextJson(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function extractThreadIdFromSharedResult(result = {}) {
  const direct = result?.threadId
    || result?.result?.threadId
    || result?.result?.thread?.id
    || result?.response?.threadId
    || result?.response?.thread?.id
    || result?.response?.result?.threadId
    || result?.response?.result?.thread?.id;
  if (direct) return String(direct).trim();

  const content = result?.result?.content || result?.response?.result?.content || [];
  for (const entry of Array.isArray(content) ? content : []) {
    if (entry?.type !== 'text' || !entry.text) continue;
    const parsed = parseSharedToolTextJson(entry.text);
    const parsedThreadId = parsed?.threadId
      || parsed?.thread?.id
      || parsed?.discussion?.id
      || parsed?.result?.threadId
      || parsed?.result?.thread?.id
      || parsed?.result?.discussion?.id;
    if (parsedThreadId) return String(parsedThreadId).trim();
  }
  return '';
}

function chooseSocialStatusResponder(targets = []) {
  const normalized = new Set((Array.isArray(targets) ? targets : []).map((entry) => foldForIntent(entry)));
  if (normalized.has('vivy') || normalized.has('vivy-live') || normalized.has('nossen')) return 'Vivy';
  if (normalized.has('a11') || normalized.has('alpha-onze') || normalized.has('alpha11')) return 'A11';
  return 'A11';
}

function buildSocialAutopromptStatusReply(status = {}) {
  const data = normalizeSocialAutopromptStatus(status);
  const limitations = Array.isArray(status.limitations) && status.limitations.length
    ? status.limitations.join(', ')
    : Array.isArray(data.limitations) && data.limitations.length
    ? data.limitations.join(', ')
    : 'aucune limitation déclarée';
  return [
    'Diagnostic Social Autoprompt redacted.',
    '',
    `youtubeConnected: ${data.youtubeConnected === true}`,
    `youtubeIngestOk: ${data.youtubeIngestOk === true}`,
    `youtubeItemsCount: ${Number.isFinite(Number(data.youtubeItemsCount)) ? Number(data.youtubeItemsCount) : 0}`,
    `metaConfigured: ${data.metaConfigured === true}`,
    `metaConnected: ${data.metaConnected === true}`,
    `metaPageSelected: ${data.metaPageSelected === true}`,
    `metaAdsRestricted: ${data.metaAdsRestricted === true ? 'true' : data.metaAdsRestricted === false ? 'false' : 'unknown'}`,
    `socialPromptContextAvailable: ${data.socialPromptContextAvailable === true}`,
    `primaryCreativeSource: ${data.primaryCreativeSource || 'none'}`,
    `limitations: ${limitations}`,
    '',
    'Lecture bornée: aucun token, secret, email privé, identifiant brut ou donnée sociale sensible n’est exposé.',
  ].join('\n');
}

function normalizeSocialAutopromptStatus(status = {}) {
  return status?.data && typeof status.data === 'object' ? status.data : status;
}

function resolveRubixcubeManifestPath(args = {}) {
  assertRubixcubeVaultAvailable();
  const explicitPath = String(args.manifestPath || '').trim();
  if (explicitPath) return path.resolve(explicitPath);
  const name = rubixcubeVault.safeName(args.name || DEFAULT_RUBIXCUBE_VAULT_NAME);
  return path.join(rubixcubeVault.defaultVaultDir(), name, `${name}.manifest.json`);
}

function rubixcubePassphraseFromEnv(args = {}) {
  assertRubixcubeVaultAvailable();
  const passphraseEnv = String(args.passphraseEnv || 'RUBIXCUBE_VAULT_PASSPHRASE').trim();
  return rubixcubeVault.passphraseFromEnv({ 'passphrase-env': passphraseEnv });
}

function assertRubixcubeVaultAvailable() {
  if (rubixcubeVault) return;
  throw new Error('RubixCube vault module is not available in this runtime.');
}

function rubixcubeSafeName(name) {
  if (rubixcubeVault?.safeName) return rubixcubeVault.safeName(name || DEFAULT_RUBIXCUBE_VAULT_NAME);
  return String(name || DEFAULT_RUBIXCUBE_VAULT_NAME)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || 'funesterie-core';
}

function rubixcubeSafeError(error) {
  const message = String(error?.message || error || '');
  if (/missing or too-short passphrase/i.test(message)) return message;
  if (/authenticate|bad decrypt|Unsupported state/i.test(message)) {
    return 'RubixCube authentication failed.';
  }
  if (/ENOENT|no such file or directory|Missing shard/i.test(message)) {
    return 'RubixCube manifest or shard is missing.';
  }
  if (/hash mismatch/i.test(message)) return 'RubixCube shard or container hash mismatch.';
  return 'RubixCube vault read failed.';
}

function buildRubixcubeVaultStatus(args = {}) {
  const name = String(args.name || DEFAULT_RUBIXCUBE_VAULT_NAME).trim();
  if (!rubixcubeVault) {
    return {
      ok: false,
      source: args.manifestPath ? 'manifestPath' : 'vault-name',
      requestedName: args.manifestPath ? null : rubixcubeSafeName(name || DEFAULT_RUBIXCUBE_VAULT_NAME),
      error: 'RubixCube vault module is not available in this runtime.',
      secretExposure: 'none',
    };
  }
  const manifestPath = resolveRubixcubeManifestPath(args);
  try {
    const status = rubixcubeVault.statusVault(manifestPath);
    return {
      ok: status.ok,
      schema: status.schema,
      name: status.name,
      mode: status.mode,
      parts: status.parts,
      threshold: status.threshold,
      encryptedLength: status.encryptedLength,
      shards: status.shards,
      source: args.manifestPath ? 'manifestPath' : 'vault-name',
      requestedName: args.manifestPath ? null : rubixcubeSafeName(name || DEFAULT_RUBIXCUBE_VAULT_NAME),
      secretExposure: 'none',
    };
  } catch (error) {
    return {
      ok: false,
      source: args.manifestPath ? 'manifestPath' : 'vault-name',
      requestedName: args.manifestPath ? null : rubixcubeSafeName(name || DEFAULT_RUBIXCUBE_VAULT_NAME),
      error: rubixcubeSafeError(error),
      secretExposure: 'none',
    };
  }
}

function consumeRubixcubeVault(args = {}) {
  if (args.confirm !== 'CONSUME_SECRET_BUNDLE') {
    throw new Error('a11_rubixcube_vault_consume requires -- confirm CONSUME_SECRET_BUNDLE');
  }
  const purpose = String(args.purpose || '').trim();
  if (!purpose) throw new Error('purpose is required for RubixCube consumption audit');
  assertNoSecretText(purpose, 'purpose');
  const itemName = String(args.itemName || '').trim();
  if (itemName) assertNoSecretText(itemName, 'itemName');
  const manifestPath = resolveRubixcubeManifestPath(args);
  let result;
  try {
    result = rubixcubeVault.inspectVault({
      manifestPath,
      passphrase: rubixcubePassphraseFromEnv(args),
      itemName,
    });
  } catch (error) {
    throw new Error(rubixcubeSafeError(error));
  }
  const payload = {
    ...result,
    consumed: true,
    purposeAccepted: true,
    itemRequested: itemName ? { name: itemName, found: result.bundle.itemFound } : null,
    policy: {
      plaintextWritten: false,
      plaintextReturned: false,
      secretValuesReturned: false,
      passphraseReturned: false,
    },
  };
  assertNoSecretText(JSON.stringify(payload), 'rubixcube-consume-result');
  return payload;
}

function sharedMcpSafeError(status, parsed = null) {
  if (status === 401 || status === 403) return 'Shared MCP authentication failed.';
  if (status >= 400) return `Shared MCP check failed with HTTP ${status}.`;
  if (parsed?.error) return 'Shared MCP JSON-RPC check failed.';
  return 'Shared MCP check failed.';
}

async function sharedMcpJsonRpcWithToken(url, token, method, params = {}, timeoutMs = 15_000) {
  const targetUrl = String(url || resolveSharedMcpConfig().url || DEFAULT_SHARED_MCP_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!targetUrl) throw new Error('Shared MCP URL is required.');
  const id = `a11-rubixcube-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await httpRawRequest('POST', targetUrl, {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }, timeoutMs, {
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'X-MCP-Token': token,
  });
  const parsed = parseMcpResponse(res.raw, res.headers['content-type'] || '');
  return { targetUrl, status: res.status, parsed };
}

async function checkRubixcubeSharedMcpToken(args = {}) {
  if (args.confirm !== 'CHECK_SHARED_MCP_TOKEN') {
    throw new Error('a11_rubixcube_shared_mcp_token_check requires -- confirm CHECK_SHARED_MCP_TOKEN');
  }
  const purpose = String(args.purpose || '').trim();
  if (!purpose) throw new Error('purpose is required for RubixCube shared MCP token check');
  assertNoSecretText(purpose, 'purpose');
  const itemName = String(args.itemName || '').trim();
  if (!itemName) throw new Error('itemName is required');
  assertNoSecretText(itemName, 'itemName');
  const manifestPath = resolveRubixcubeManifestPath(args);
  let secretItem;
  try {
    secretItem = rubixcubeVault.readVaultSecretItem({
      manifestPath,
      passphrase: rubixcubePassphraseFromEnv(args),
      itemName,
      valueField: args.valueField,
    });
  } catch (error) {
    throw new Error(rubixcubeSafeError(error));
  }
  const sharedMcpToken = stripBearer(secretItem.value);
  if (!secretItem.found || !sharedMcpToken) {
    return {
      ok: false,
      checked: false,
      item: {
        name: itemName,
        found: Boolean(secretItem.found),
        hasSecretValue: false,
      },
      error: 'RubixCube item not found or has no secret value.',
      secretExposure: 'none',
    };
  }

  let rpc;
  try {
    rpc = await sharedMcpJsonRpcWithToken(
      args.url,
      sharedMcpToken,
      'tools/list',
      {},
      Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 15_000
    );
  } catch (_) {
    return {
      ok: false,
      checked: true,
      item: {
        name: secretItem.name,
        kind: secretItem.kind,
        found: true,
        hasSecretValue: true,
      },
      sharedMcp: {
        url: String(args.url || resolveSharedMcpConfig().url || DEFAULT_SHARED_MCP_URL).trim().replace(/\/+$/, ''),
        status: 0,
        authentication: 'unknown',
      },
      error: 'Shared MCP request failed.',
      secretExposure: 'none',
    };
  }

  const parsed = rpc.parsed || null;
  const tools = Array.isArray(parsed?.result?.tools) ? parsed.result.tools : [];
  const ok = Boolean(parsed) && rpc.status >= 200 && rpc.status < 400 && !parsed?.error && tools.length >= 0;
  const payload = {
    ok,
    checked: true,
    item: {
      name: secretItem.name,
      kind: secretItem.kind,
      found: true,
      hasSecretValue: true,
    },
    sharedMcp: {
      url: rpc.targetUrl,
      status: rpc.status,
      authentication: ok ? 'accepted' : 'rejected-or-unknown',
    },
    method: 'tools/list',
    toolCount: tools.length,
    sampleTools: tools
      .slice(0, 12)
      .map((tool) => String(tool?.name || '').trim())
      .filter(Boolean),
    error: ok ? null : sharedMcpSafeError(rpc.status, parsed),
    policy: {
      tokenReturned: false,
      plaintextWritten: false,
      rawResponseReturned: false,
    },
    secretExposure: 'none',
  };
  assertNoSecretText(JSON.stringify(payload), 'rubixcube-shared-mcp-token-check');
  return payload;
}

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

function httpRawRequest(method, urlStr, body = null, timeoutMs = 30_000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (_) {
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
        ...extraHeaders,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers || {},
          raw: Buffer.concat(chunks).toString('utf8'),
        });
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

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function parseSseJson(text) {
  const events = [];
  let current = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (current.length) {
        events.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    if (line.startsWith('data:')) {
      current.push(line.slice(5).trimStart());
    }
  }

  if (current.length) events.push(current.join('\n'));

  for (let index = events.length - 1; index >= 0; index--) {
    const parsed = parseJsonMaybe(events[index]);
    if (parsed) return parsed;
  }

  return null;
}

function parseMcpResponse(raw, contentType = '') {
  const text = String(raw || '');
  if (String(contentType || '').includes('application/json')) {
    const parsed = parseJsonMaybe(text);
    if (parsed) return parsed;
  }

  return parseJsonMaybe(text) || parseSseJson(text) || null;
}

async function sharedMcpJsonRpc(method, params = {}, timeoutMs = 30_000) {
  const config = resolveSharedMcpConfig();
  const headers = {
    'Accept': 'application/json, text/event-stream',
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
    headers['X-MCP-Token'] = config.token;
  }

  const id = `a11-stdio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await httpRawRequest('POST', config.url, {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }, timeoutMs, headers);

  const parsed = parseMcpResponse(res.raw, res.headers['content-type'] || '');
  if (!parsed) {
    throw new Error(`Shared MCP response could not be parsed (HTTP ${res.status}).`);
  }
  if (res.status >= 400 || parsed.error) {
    throw new Error(parsed?.error?.message || `Shared MCP HTTP ${res.status}`);
  }

  return {
    ok: true,
    sharedMcp: publicSharedMcpConfig(),
    status: res.status,
    response: parsed,
    result: parsed.result || null,
  };
}

async function callSharedMcpTool(name, args = {}, timeoutMs = 30_000) {
  return sharedMcpJsonRpc('tools/call', {
    name,
    arguments: args && typeof args === 'object' ? args : {},
  }, timeoutMs);
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
          description: 'Commande à exécuter (ex: "npm install @nossen/qflush", "git status", "node script.cjs").',
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
  {
    name: 'a11_worker_status',
    description:
      'Retourne l etat du supervisor workers A11: scripts npm whitelistes, locks, logs capes et audit recent. Ne lance rien.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        workerId: {
          type: 'string',
          description: 'Worker whiteliste a filtrer (optionnel).',
        },
        includeLogs: {
          type: 'boolean',
          description: 'Inclure une queue de log redacted et capee.',
        },
        maxLogChars: {
          type: 'number',
          description: 'Nombre max de caracteres de logs retournes.',
        },
        auditLimit: {
          type: 'number',
          description: 'Nombre d evenements audit recents a retourner.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_worker_start',
    description:
      'Lance un worker A11 via une whitelist stricte de scripts npm. Requiert agent. Aucun shell libre.',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent appelant obligatoire: codex, kiro, a11, kaen44, claude, copilot, grok, gemini, etc.',
        },
        workerId: {
          type: 'string',
          description: 'Identifiant du worker whiteliste.',
        },
        reason: {
          type: 'string',
          description: 'Raison courte pour audit.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Retourne seulement le plan sans lancer le process.',
        },
      },
      required: ['agent', 'workerId'],
    },
  },
  {
    name: 'a11_worker_stop',
    description:
      'Stoppe un worker A11 connu par son lock supervisor. Requiert agent. Aucun shell libre.',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent appelant obligatoire.',
        },
        workerId: {
          type: 'string',
          description: 'Identifiant du worker whiteliste.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Retourne seulement le plan sans stopper le process.',
        },
      },
      required: ['agent', 'workerId'],
    },
  },
  {
    name: 'a11_worker_restart',
    description:
      'Redemarre un worker A11 via stop puis start, avec lock et audit. Requiert agent.',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent appelant obligatoire.',
        },
        workerId: {
          type: 'string',
          description: 'Identifiant du worker whiteliste.',
        },
        reason: {
          type: 'string',
          description: 'Raison courte pour audit.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Retourne seulement le plan sans toucher au process.',
        },
      },
      required: ['agent', 'workerId'],
    },
  },
  {
    name: 'a11_task_dispatch',
    description:
      'Cree une file de taches bornee puis lance le dispatcher existant via script npm whiteliste. Requiert agent.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent appelant obligatoire.',
        },
        project: {
          type: 'string',
          description: 'Nom du projet pour le dispatcher.',
        },
        tasks: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            ],
          },
          description: 'Taches a convertir en checklist Markdown.',
        },
        markdown: {
          type: 'string',
          description: 'Checklist Markdown deja formatee.',
        },
        priority: {
          type: 'string',
          description: 'Priorite indicative.',
        },
        targetAgents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agents cibles indicatifs: claude, copilot, grok, gemini, etc.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Retourne seulement le plan sans creer ni lancer.',
        },
      },
      required: ['agent'],
    },
  },
  {
    name: 'a11_agent_jobs_status',
    description:
      'Retourne le job board supervisor, les jobs lances par MCP et la presence connue des agents externes.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent appelant optionnel pour audit de lecture.',
        },
        limit: {
          type: 'number',
          description: 'Nombre max de jobs a retourner.',
        },
        includeLogs: {
          type: 'boolean',
          description: 'Inclure une queue de log redacted pour les jobs.',
        },
        maxLogChars: {
          type: 'number',
          description: 'Nombre max de caracteres de logs retournes.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_mcp_dimension_status',
    description:
      'Retourne le statut du MCP dimensionnel maison : stdio, base A11 cible, route-map locale, contexte et pont Dragon/Kiro.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_route_map',
    description:
      'Retourne la carte locale des liens A11 : identite, corpus, memoires, services, endpoints, BMP, Neo4j et Boostro.',
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure aussi le resume Markdown local si disponible.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_runtime_hooks_status',
    description:
      'Retourne le statut du hook Neo4j semantique pour Cortex, Spyder, telemetry, Rome, Corpus, Piccolo et Doctor.',
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure aussi le resume Markdown local si disponible.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_chopper_status',
    description:
      'Retourne le statut WestSide Chopper: assemblage global des modules Funesterie, lanes, dependances, gates et plan securise.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure le rendu Markdown du statut Chopper.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_chopper_plan',
    description:
      'Retourne uniquement le plan d actions WestSide Chopper et les workerIds MCP autorises pour assembler les modules.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_chopper_rumble',
    description:
      'Retourne les 3 Rumble Balls WestSide Chopper et les 7 combinaisons possibles pour orchestrer les modules par mode.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        readyOnly: {
          type: 'boolean',
          description: 'Retourner seulement les combinaisons pretes.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_chopper_recipes',
    description:
      'Retourne les recettes operationnelles WestSide Chopper: Memory Import, Scene Compiler, Video Analysis, Worker Repair, Agent Demo et Operation BB.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        readyOnly: {
          type: 'boolean',
          description: 'Retourner seulement les recettes pretes.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_chopper_doctor',
    description:
      'Retourne le score Doctor WestSide Chopper par module et les prochaines actions de reparation sans afficher de secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_funesterie_mixer_status',
    description:
      'Retourne le statut Funesterie Mixer: scoring, route par defaut, contrat MCP et garde-fous. Ne lance aucune action.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'Demande optionnelle pour recalculer la route par defaut.',
        },
        topN: {
          type: 'number',
          description: 'Nombre de candidats a retourner.',
        },
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure le rendu Markdown.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_funesterie_mixer_route',
    description:
      'Route une demande vers les meilleurs agents, modules, recettes Rumble, workers et outils MCP selon score pertinence/sante/risque.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'Demande utilisateur ou objectif operationnel a router.',
        },
        topN: {
          type: 'number',
          description: 'Nombre de candidats scores a retourner.',
        },
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure le rendu Markdown.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_ecosystem_scope',
    description:
      'Retourne la carte metadata-only de l ecosysteme Funesterie: repos GitHub, packages, contrats, runtimes partages, orchestration et outils semantiques. Ne retourne aucun secret.',
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure aussi le resume Markdown local si disponible.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_ecosystem_corpus',
    description:
      'Retourne les source cards Corpus derivees de l ecosysteme Funesterie: briefs repo, domaines, risques, boundaries public/private et liens semantiques. Ne retourne aucun secret.',
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure aussi le resume Markdown local si disponible.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_ecosystem_briefing',
    description:
      'Retourne les livrables briefing de l ecosysteme Funesterie: vue executive, vue architecture, HTML/PDF partageable et resume des fichiers generes. Ne retourne aucun secret.',
    inputSchema: {
      type: 'object',
      properties: {
        includeExecutive: {
          type: 'boolean',
          description: 'Inclure la vue executive Markdown si disponible.',
        },
        includeArchitecture: {
          type: 'boolean',
          description: 'Inclure la vue architecture Markdown si disponible.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_memory_graph_trace_service',
    description:
      'Trace un service Funesterie dans A11 Memory Graph v1: endpoints, domaines, dependances et fichiers lies. Lecture seule, aucun secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Nom, id ou domaine du service a tracer.',
        },
        limit: {
          type: 'number',
          description: 'Nombre maximum de voisins a retourner.',
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'a11_memory_graph_recent_incidents',
    description:
      'Retourne les incidents recents metadata-only detectes dans A11 Memory Graph v1. Lecture seule, aucun secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Nombre maximum d incidents a retourner.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_memory_graph_explain_agent_context',
    description:
      'Explique le contexte graphe d un agent A11/K44/Vivy: services, outils, concepts et liens principaux. Lecture seule, aucun secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent a expliquer, par exemple a11, k44, kaen44 ou vivy.',
        },
        limit: {
          type: 'number',
          description: 'Nombre maximum de voisins a retourner.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_vivy_graph_manifest',
    description:
      'Retourne le manifeste des fichiers Funesterie/Vivy autorises a entrer dans Neo4j. Secrets, env et medias runtime exclus.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        includeMarkdown: {
          type: 'boolean',
          description: 'Inclure un rendu Markdown court du manifeste.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_vivy_graph_search',
    description:
      'Recherche dans les chunks Vivy indexes dans Neo4j, sans exposer de secret. Lecture seule.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Texte a chercher dans le graphe Vivy.',
        },
        source: {
          type: 'string',
          enum: ['aura', 'local'],
          description: 'Source Neo4j a interroger, defaut aura.',
        },
        limit: {
          type: 'number',
          description: 'Nombre maximum de chunks retournes.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'a11_social_prompt_context',
    description:
      'Retourne une fiche créative redacted issue des comptes sociaux connectés en admin pour enrichir une chanson, un clip, un post, une description ou des hashtags.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Sujet créatif à enrichir.',
        },
        kind: {
          type: 'string',
          enum: ['chanson', 'clip', 'post', 'description', 'hashtag'],
          description: 'Type de sortie voulue. Défaut chanson.',
        },
        limit: {
          type: 'number',
          description: 'Nombre maximum de signaux à utiliser.',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'a11_social_autoprompt_status',
    description:
      'Retourne un diagnostic Social Autoprompt redacted: état YouTube, Meta/Facebook/Instagram, ingest, contexte créatif disponible et limitations, sans token ni donnée brute sensible.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_vivy_graph_sync',
    description:
      'Synchronise le corpus Funesterie/Vivy autorise vers Neo4j. Ecriture bornee a des noeuds VivyGraph*, sans secrets.',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'Retourne seulement le plan et les compteurs sans ecrire.',
        },
        target: {
          type: 'string',
          enum: ['aura', 'local', 'both'],
          description: 'Cible Neo4j. Defaut aura.',
        },
        confirm: {
          type: 'string',
          enum: ['SYNC_VIVY_GRAPH'],
          description: 'Confirmation obligatoire pour ecrire.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_identity_route',
    description:
      'Retourne la route d identite A11 compacte pour recuperer le contexte sans dependre de Neo4j.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_ai_identity_registry',
    description:
      'Retourne le registre public des identités IA autorisées sur le MCP Funesterie: ChatGPT, Grok, Claude, Codex, Vivy, A11 et K44. Aucun secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_ai_identity_handshake',
    description:
      'Identifie une IA appelante et retourne son profil MCP, ses alias et les outils de dialogue autorisés. Inspiré du RBAC investigation-graph: pas d admin IA, pas de secrets, pas de shell.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Nom court: chatgpt, grok, claude, codex, vivy, a11 ou kaen44.',
        },
        provider: {
          type: 'string',
          description: 'Fournisseur optionnel: openai, xai, anthropic, funesterie.',
        },
        agentId: {
          type: 'string',
          description: 'Identifiant stable optionnel de l instance IA.',
        },
        displayName: {
          type: 'string',
          description: 'Nom affiché de l IA.',
        },
        model: {
          type: 'string',
          description: 'Modèle annoncé, sans clé ni token.',
        },
        purpose: {
          type: 'string',
          description: 'Pourquoi cette IA rejoint le dialogue.',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Capacités déclarées.',
        },
        requestedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Outils MCP souhaités; la réponse sépare autorisés et refusés.',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_rubixcube_vault_status',
    description:
      'Verifie un coffre RubixCube local: manifeste, shards PNG et hashes. Ne lit pas la passphrase et ne retourne aucun secret.',
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        manifestPath: {
          type: 'string',
          description: 'Chemin local explicite du manifeste RubixCube (optionnel).',
        },
        name: {
          type: 'string',
          description: 'Nom du coffre sous le dossier RubixCube par defaut (defaut: funesterie-core).',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_rubixcube_vault_consume',
    description:
      'Consomme un coffre RubixCube local avec passphrase env et confirmation explicite. Dechiffre en memoire, retourne seulement un resume redacted.',
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        manifestPath: {
          type: 'string',
          description: 'Chemin local explicite du manifeste RubixCube (optionnel).',
        },
        name: {
          type: 'string',
          description: 'Nom du coffre sous le dossier RubixCube par defaut (defaut: funesterie-core).',
        },
        itemName: {
          type: 'string',
          description: 'Nom public attendu dans le bundle, pour verifier sa presence sans retourner la valeur.',
        },
        purpose: {
          type: 'string',
          description: 'Raison courte d audit, sans secret.',
        },
        passphraseEnv: {
          type: 'string',
          description: 'Nom de variable env contenant la passphrase (defaut: RUBIXCUBE_VAULT_PASSPHRASE).',
        },
        confirm: {
          type: 'string',
          enum: ['CONSUME_SECRET_BUNDLE'],
          description: 'Confirmation obligatoire: CONSUME_SECRET_BUNDLE.',
        },
      },
      required: ['purpose', 'confirm'],
    },
  },
  {
    name: 'a11_rubixcube_shared_mcp_token_check',
    description:
      'Consomme un item RubixCube nomme comme token MCP, appelle tools/list sur le MCP partage, et retourne seulement un statut redacted.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        manifestPath: {
          type: 'string',
          description: 'Chemin local explicite du manifeste RubixCube (optionnel).',
        },
        name: {
          type: 'string',
          description: 'Nom du coffre sous le dossier RubixCube par defaut (defaut: funesterie-core).',
        },
        itemName: {
          type: 'string',
          description: 'Nom public de l item contenant le token MCP dans le bundle.',
        },
        valueField: {
          type: 'string',
          description: 'Champ secret a utiliser si different de value/token/secret.',
        },
        url: {
          type: 'string',
          description: 'URL MCP a verifier (defaut: configuration MCP partagee).',
        },
        purpose: {
          type: 'string',
          description: 'Raison courte d audit, sans secret.',
        },
        passphraseEnv: {
          type: 'string',
          description: 'Nom de variable env contenant la passphrase (defaut: RUBIXCUBE_VAULT_PASSPHRASE).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout reseau en ms (defaut: 15000).',
        },
        confirm: {
          type: 'string',
          enum: ['CHECK_SHARED_MCP_TOKEN'],
          description: 'Confirmation obligatoire: CHECK_SHARED_MCP_TOKEN.',
        },
      },
      required: ['itemName', 'purpose', 'confirm'],
    },
  },
  {
    name: 'a11_shared_mcp_status',
    description:
      'Retourne la configuration publique et la sante du MCP partage Funesterie utilise par Kiro, sans exposer le token.',
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'a11_agent_dialogue_open',
    description:
      'Ouvre une boîte de dialogue MCP entre plusieurs IA. Le fil est conservé par le bus partagé et miroité dans Neo4j quand les écritures temporelles sont actives.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre court du dialogue.' },
        from: { type: 'string', description: 'Agent qui ouvre le dialogue.' },
        body: { type: 'string', description: 'Premier message, sans secret.' },
        topic: { type: 'string', description: 'Sujet stable du fil.' },
        participants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agents invités, par exemple Vivy, A11, K44 et Codex.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Étiquettes courtes du dialogue.',
        },
        threadId: { type: 'string', description: 'Identifiant stable optionnel.' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'a11_agent_dialogue_ask',
    description:
      'Ouvre un dialogue entre IA et crée des travaux bornés pour demander une réponse aux agents ciblés. Les réponses reviennent dans le même fil.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre court du dialogue.' },
        from: { type: 'string', description: 'Agent demandeur.' },
        message: { type: 'string', description: 'Question commune, sans secret.' },
        targets: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['chatgpt', 'grok', 'xai', 'codex', 'kiro', 'claude', 'a11', 'kaen44', 'vivy', 'chopper', 'qflush', 'gemini', 'copilot'],
          },
          description: 'Un à trois agents sollicités.',
        },
        scope: { type: 'string', enum: ['local', 'prod', 'both'] },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
        threadId: { type: 'string', description: 'Identifiant stable optionnel.' },
      },
      required: ['title', 'message', 'targets'],
    },
  },
  {
    name: 'a11_agent_dialogue_inbox',
    description:
      'Lit la boîte de réception d’une IA et retourne les dialogues MCP ouverts qui la concernent.',
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Nom de l’agent qui consulte.' },
        agentId: { type: 'string', description: 'Identifiant stable optionnel.' },
        aliases: { type: 'array', items: { type: 'string' } },
        includeGlobal: { type: 'boolean' },
        maxThreads: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'a11_agent_dialogue_read',
    description: 'Lit les derniers messages d’un dialogue entre IA.',
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Identifiant du dialogue.' },
        limit: { type: 'number', description: 'Nombre maximum de messages.' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'a11_agent_dialogue_post',
    description: 'Poste une question, une réponse, une décision ou un statut dans un dialogue entre IA.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Identifiant du dialogue.' },
        from: { type: 'string', description: 'Agent auteur du message.' },
        body: { type: 'string', description: 'Message sans secret.' },
        kind: {
          type: 'string',
          enum: ['message', 'status', 'decision', 'question', 'answer'],
        },
        replyTo: { type: 'string', description: 'Message auquel cette réponse se rattache.' },
      },
      required: ['threadId', 'body'],
    },
  },
  {
    name: 'a11_kiro_inbox_check',
    description:
      'Lit l inbox MCP partagee pour Kiro/Codex/A11: presence, jobs et discussions ouvertes. Ne poste pas de reponse.',
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Nom de l agent appelant (defaut: Codex).',
        },
        agentId: {
          type: 'string',
          description: 'Identifiant stable de l agent (optionnel).',
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alias a verifier dans les discussions (optionnel).',
        },
        includeGlobal: {
          type: 'boolean',
          description: 'Inclure les threads globaux (defaut: true).',
        },
        maxThreads: {
          type: 'number',
          description: 'Nombre maximum de threads a scanner (defaut: 20).',
        },
      },
      required: [],
    },
  },
  {
    name: 'a11_kiro_discussion_read',
    description: 'Lit un fil de discussion MCP partage pour coordonner Codex, Kiro, A11, Kaen44 ou Vivy.',
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Identifiant du thread MCP.',
        },
        limit: {
          type: 'number',
          description: 'Nombre maximum de messages a retourner (defaut: 100).',
        },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'a11_kiro_discussion_post',
    description:
      'Poste une reponse courte dans un fil MCP partage. Ne jamais inclure de mot de passe, token ou cle API.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Identifiant du thread MCP.',
        },
        from: {
          type: 'string',
          description: 'Nom de l agent appelant (defaut: Codex).',
        },
        body: {
          type: 'string',
          description: 'Message a poster. Secrets interdits.',
        },
        kind: {
          type: 'string',
          enum: ['message', 'status', 'decision', 'question', 'answer'],
          description: 'Type de message (defaut: status).',
        },
      },
      required: ['threadId', 'body'],
    },
  },
  {
    name: 'a11_kiro_heartbeat',
    description:
      'Annonce la presence de Codex/A11 sur le MCP partage pour que Kiro voie les capacites et le statut courant.',
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nom affiche de l agent (defaut: Codex).',
        },
        role: {
          type: 'string',
          description: 'Role court (defaut: mcp-upgrader).',
        },
        status: {
          type: 'string',
          enum: ['active', 'idle', 'busy', 'observed', 'offline', 'error'],
          description: 'Statut de presence (defaut: active).',
        },
        note: {
          type: 'string',
          description: 'Note courte visible par les autres agents.',
        },
      },
      required: [],
    },
  },
];

function inferToolAnnotations(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  const readOnly = [
    'a11_health',
    'a11_vs_status',
    'a11_vs_capabilities',
    'a11_vs_project_structure',
    'a11_vs_active_document',
    'a11_llm_stats',
    'a11_shell_whitelist',
    'a11_mcp_dimension_status',
    'a11_route_map',
    'a11_runtime_hooks_status',
    'a11_chopper_status',
    'a11_chopper_plan',
    'a11_chopper_rumble',
    'a11_chopper_recipes',
    'a11_chopper_doctor',
    'a11_funesterie_mixer_status',
    'a11_funesterie_mixer_route',
    'a11_ecosystem_scope',
    'a11_ecosystem_corpus',
    'a11_ecosystem_briefing',
    'a11_memory_graph_trace_service',
    'a11_memory_graph_recent_incidents',
    'a11_memory_graph_explain_agent_context',
    'a11_vivy_graph_manifest',
    'a11_vivy_graph_search',
    'a11_social_prompt_context',
    'a11_social_autoprompt_status',
    'a11_identity_route',
  ].includes(normalized);
  const destructive = /delete|remove|purge|reset|revoke|overwrite/.test(normalized);
  return {
    readOnlyHint: readOnly,
    openWorldHint: false,
    destructiveHint: destructive,
  };
}

function toolDescriptorForMcp(tool = {}) {
  return {
    ...tool,
    annotations: {
      ...inferToolAnnotations(tool.name),
      ...(tool.annotations || {}),
    },
  };
}

function assertNoSecretText(value, label = 'text') {
  const text = String(value || '');
  const secretPattern = /(bearer\s+[a-z0-9._~+/=-]{16,}|hf_[a-z0-9]{16,}|sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,}|api[_-]?key|token\s*[:=]|password\s*[:=]|mot de passe\s*[:=])/i;
  if (secretPattern.test(text)) {
    throw new Error(`${label}: secret-looking content refused`);
  }
}

async function sharedMcpHealth() {
  const config = resolveSharedMcpConfig();
  const headers = { Accept: 'application/json' };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
    headers['X-MCP-Token'] = config.token;
  }
  const res = await httpRawRequest('GET', getMcpHealthUrl(config.url), null, 15_000, headers);
  return {
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    sharedMcp: publicSharedMcpConfig(),
    body: parseJsonMaybe(res.raw) || { raw: res.raw.slice(0, 500) },
  };
}

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

    case 'a11_worker_status': {
      return formatObject(workerSupervisor.getWorkerStatus(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_worker_start': {
      return formatObject(workerSupervisor.startWorker(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_worker_stop': {
      return formatObject(workerSupervisor.stopWorker(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_worker_restart': {
      return formatObject(workerSupervisor.restartWorker(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_task_dispatch': {
      return formatObject(workerSupervisor.dispatchTasks(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_agent_jobs_status': {
      return formatObject(workerSupervisor.agentJobsStatus(args, { runtimeRoot: RUNTIME_ROOT }));
    }

    case 'a11_mcp_dimension_status': {
      return formatObject(buildMcpDimensionStatus());
    }

    case 'a11_route_map': {
      return formatObject(buildRouteMap({ includeMarkdown: Boolean(args.includeMarkdown) }));
    }

    case 'a11_runtime_hooks_status': {
      return formatObject(buildRuntimeHooksStatus({ includeMarkdown: Boolean(args.includeMarkdown) }));
    }

    case 'a11_chopper_status': {
      const status = westsideChopper.buildChopperStatus({ runtimeRoot: RUNTIME_ROOT });
      return formatObject({
        ...status,
        ...(args.includeMarkdown ? { markdown: westsideChopper.buildMarkdown(status) } : {}),
      });
    }

    case 'a11_chopper_plan': {
      const status = westsideChopper.buildChopperStatus({ runtimeRoot: RUNTIME_ROOT });
      return formatObject({
        ok: status.ok,
        generatedAt: status.generatedAt,
        summary: status.summary,
        gates: status.gates,
        actionPlan: status.actionPlan,
        mcpContract: status.mcpContract,
      });
    }

    case 'a11_chopper_rumble': {
      const status = westsideChopper.buildChopperStatus({ runtimeRoot: RUNTIME_ROOT });
      const combinations = args.readyOnly
        ? status.rumbleCombinations.filter((combo) => combo.ready)
        : status.rumbleCombinations;
      return formatObject({
        ok: status.ok,
        generatedAt: status.generatedAt,
        summary: {
          rumbleBalls: status.summary.rumbleBalls,
          rumbleCombinations: combinations.length,
          rumbleReady: combinations.filter((combo) => combo.ready).length,
        },
        rumbleBalls: status.rumbleBalls,
        rumbleCombinations: combinations,
      });
    }

    case 'a11_chopper_recipes': {
      const status = westsideChopper.buildChopperStatus({ runtimeRoot: RUNTIME_ROOT });
      const recipes = args.readyOnly
        ? status.recipes.filter((recipe) => recipe.ready)
        : status.recipes;
      return formatObject({
        ok: status.ok,
        generatedAt: status.generatedAt,
        summary: {
          recipes: recipes.length,
          ready: recipes.filter((recipe) => recipe.ready).length,
          doctorStatus: status.summary.doctorStatus,
          doctorScore: status.summary.doctorScore,
        },
        recipes,
      });
    }

    case 'a11_chopper_doctor': {
      const status = westsideChopper.buildChopperStatus({ runtimeRoot: RUNTIME_ROOT });
      return formatObject({
        ok: status.doctor.ok,
        generatedAt: status.generatedAt,
        summary: status.summary,
        doctor: status.doctor,
      });
    }

    case 'a11_funesterie_mixer_status': {
      const status = funesterieMixer.buildMixerStatus({
        runtimeRoot: RUNTIME_ROOT,
        request: String(args.request || ''),
        topN: Number(args.topN || 12),
      });
      return formatObject({
        ...status,
        ...(args.includeMarkdown ? { markdown: funesterieMixer.buildMarkdown(status) } : {}),
      });
    }

    case 'a11_funesterie_mixer_route': {
      const route = funesterieMixer.buildMixerRoute({
        runtimeRoot: RUNTIME_ROOT,
        request: String(args.request || ''),
        topN: Number(args.topN || 12),
      });
      return formatObject({
        ...route,
        ...(args.includeMarkdown ? { markdown: funesterieMixer.buildMarkdown(route) } : {}),
      });
    }

    case 'a11_ecosystem_scope': {
      return formatObject(buildEcosystemScopeStatus({ includeMarkdown: Boolean(args.includeMarkdown) }));
    }

    case 'a11_ecosystem_corpus': {
      return formatObject(buildEcosystemCorpusStatus({ includeMarkdown: Boolean(args.includeMarkdown) }));
    }

    case 'a11_ecosystem_briefing': {
      return formatObject(buildEcosystemBriefingStatus({
        includeExecutive: Boolean(args.includeExecutive),
        includeArchitecture: Boolean(args.includeArchitecture),
      }));
    }

    case 'a11_memory_graph_trace_service': {
      const service = String(args.service || args.name || args.query || '').trim();
      if (!service) throw new Error('service is required');
      return formatObject(a11MemoryGraph.traceService(service, {
        limit: Number(args.limit || 80),
      }));
    }

    case 'a11_memory_graph_recent_incidents': {
      return formatObject(a11MemoryGraph.findRecentIncidents({
        limit: Number(args.limit || 12),
      }));
    }

    case 'a11_memory_graph_explain_agent_context': {
      return formatObject(a11MemoryGraph.explainAgentContext(String(args.agent || 'a11'), {
        limit: Number(args.limit || 80),
      }));
    }

    case 'a11_vivy_graph_manifest': {
      const manifest = vivyGraphAccess.buildVivyGraphSourceManifest({ runtimeRoot: RUNTIME_ROOT });
      return formatObject({
        ok: true,
        ...manifest,
        ...(args.includeMarkdown ? { markdown: vivyGraphAccess.toManifestMarkdown(manifest) } : {}),
      });
    }

    case 'a11_vivy_graph_search': {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('query is required');
      return formatObject(await vivyGraphAccess.searchVivyGraph({
        query,
        source: String(args.source || 'aura').trim(),
        limit: Number(args.limit || 8),
      }));
    }

    case 'a11_social_prompt_context': {
      const topic = String(args.topic || '').trim();
      if (!topic) throw new Error('topic is required');
      const params = new URLSearchParams({
        topic,
        kind: String(args.kind || 'chanson').trim() || 'chanson',
        limit: String(Math.max(1, Math.min(12, Number(args.limit || 6) || 6))),
      });
      const res = await a11Get(`/api/admin/social-connect/context?${params.toString()}`);
      const context = res?.context || res;
      return formatObject({
        topic: context.topic || topic,
        dominantTone: context.dominantTone || '',
        strongPhrases: Array.isArray(context.strongPhrases) ? context.strongPhrases.slice(0, 8) : [],
        creativeAngles: Array.isArray(context.creativeAngles) ? context.creativeAngles.slice(0, 8) : [],
        clipIdeas: Array.isArray(context.clipIdeas) ? context.clipIdeas.slice(0, 8) : [],
        songPromptSeeds: Array.isArray(context.songPromptSeeds) ? context.songPromptSeeds.slice(0, 8) : [],
        hashtags: Array.isArray(context.hashtags) ? context.hashtags.slice(0, 12) : [],
        avoid: Array.isArray(context.avoid) ? context.avoid.slice(0, 8) : [],
      });
    }

    case 'a11_social_autoprompt_status': {
      const status = await a11Get('/api/admin/social-connect/public-status');
      return formatObject(normalizeSocialAutopromptStatus(status));
    }

    case 'a11_vivy_graph_sync': {
      const dryRun = args.dryRun !== false ? true : false;
      const corpus = vivyGraphAccess.buildVivyGraphCorpus({ runtimeRoot: RUNTIME_ROOT });
      if (dryRun) {
        return formatObject({
          ok: true,
          dryRun: true,
          target: String(args.target || 'aura').trim(),
          manifest: corpus.manifest.summary,
          corpus: corpus.summary,
        });
      }
      if (args.confirm !== 'SYNC_VIVY_GRAPH') {
        throw new Error('confirm SYNC_VIVY_GRAPH is required to write Vivy graph nodes');
      }
      return formatObject(await vivyGraphAccess.syncVivyGraphCorpus({
        corpus,
        target: String(args.target || 'aura').trim(),
        runtimeRoot: RUNTIME_ROOT,
      }));
    }

    case 'a11_identity_route': {
      return formatObject(buildIdentityRoute());
    }

    case 'a11_ai_identity_registry': {
      return formatObject(buildAiIdentityRegistry());
    }

    case 'a11_ai_identity_handshake': {
      return formatObject(buildAiIdentityHandshake(args));
    }

    case 'a11_rubixcube_vault_status': {
      return formatObject(buildRubixcubeVaultStatus(args));
    }

    case 'a11_rubixcube_vault_consume': {
      return formatObject(consumeRubixcubeVault(args));
    }

    case 'a11_rubixcube_shared_mcp_token_check': {
      return formatObject(await checkRubixcubeSharedMcpToken(args));
    }

    case 'a11_shared_mcp_status': {
      return formatObject(await sharedMcpHealth());
    }

    case 'a11_agent_dialogue_open': {
      const title = String(args.title || '').trim();
      const body = String(args.body || '').trim();
      if (!title) throw new Error('title is required');
      if (!body) throw new Error('body is required');
      assertNoSecretText(title, 'title');
      assertNoSecretText(body, 'body');
      const result = await callSharedMcpTool('discussion_open', {
        title,
        from: String(args.from || 'Codex').trim(),
        body,
        ...(args.topic ? { topic: String(args.topic).trim() } : {}),
        participants: Array.isArray(args.participants)
          ? args.participants.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20)
          : [],
        tags: Array.isArray(args.tags)
          ? args.tags.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20)
          : ['agent-dialogue'],
        ...(args.threadId ? { threadId: String(args.threadId).trim() } : {}),
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_agent_dialogue_ask': {
      const title = String(args.title || '').trim();
      const message = String(args.message || '').trim();
      const targets = Array.isArray(args.targets)
        ? args.targets.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean).slice(0, 3)
        : [];
      if (!title) throw new Error('title is required');
      if (!message) throw new Error('message is required');
      if (!targets.length) throw new Error('targets is required');
      assertNoSecretText(title, 'title');
      assertNoSecretText(message, 'message');
      const visualCreativeDirection = isVivyVisualCreativeDirectionQuestion(`${title}\n${message}`, targets);
      const routedMessage = visualCreativeDirection
        ? buildVivyVisualReviewWorkerMessage(message)
        : message;
      const result = await callSharedMcpTool('agent_general_call', {
        title,
        from: String(args.from || 'Codex').trim(),
        message: routedMessage,
        targets,
        maxTargets: targets.length,
        scope: String(args.scope || 'both').trim(),
        urgency: String(args.urgency || 'normal').trim(),
        ...(args.threadId ? { threadId: String(args.threadId).trim() } : {}),
        requireAck: true,
        createJobs: true,
        sendDiscord: false,
        dryRun: false,
      }, 45_000);
      if (visualCreativeDirection) {
        const body = buildVivyVisualReviewReply(message);
        assertNoSecretText(body, 'vivy-visual-review');
        const threadId = String(args.threadId || '').trim() || extractThreadIdFromSharedResult(result);
        if (threadId) {
          await callSharedMcpTool('discussion_post', {
            threadId,
            from: 'Vivy',
            body,
            kind: 'answer',
          }, 45_000);
        }
        return formatObject({
          ...result,
          vivyIntent: 'visual-review',
          creativeDirectionPosted: Boolean(threadId),
          creativeDirectionThreadId: threadId || null,
        });
      }
      if (isSocialAutopromptStatusQuestion(`${title}\n${message}`)) {
        try {
          const status = await a11Get('/api/admin/social-connect/public-status');
          const normalizedStatus = normalizeSocialAutopromptStatus(status);
          const body = buildSocialAutopromptStatusReply(normalizedStatus);
          assertNoSecretText(body, 'social-autoprompt-status');
          const threadId = String(args.threadId || '').trim() || extractThreadIdFromSharedResult(result);
          if (threadId) {
            await callSharedMcpTool('discussion_post', {
              threadId,
              from: chooseSocialStatusResponder(targets),
              body,
              kind: 'status',
            }, 45_000);
          }
          return formatObject({
            ...result,
            socialAutopromptStatus: normalizedStatus,
            socialAutopromptStatusPosted: Boolean(threadId),
            socialAutopromptStatusThreadId: threadId || null,
          });
        } catch (error) {
          return formatObject({
            ...result,
            socialAutopromptStatus: {
              ok: false,
              error: 'social_autoprompt_status_unavailable',
              message: String(error?.message || error).slice(0, 240),
            },
          });
        }
      }
      return formatObject(result);
    }

    case 'a11_agent_dialogue_inbox': {
      const from = String(args.from || 'Codex').trim();
      const aliases = Array.isArray(args.aliases) ? args.aliases : [from];
      const result = await callSharedMcpTool('agent_inbox_check', {
        from,
        ...(args.agentId ? { agentId: String(args.agentId).trim() } : { agentId: from.toLowerCase() }),
        aliases,
        autoReply: false,
        includeGlobal: args.includeGlobal !== false,
        maxThreads: Number.isFinite(Number(args.maxThreads)) ? Number(args.maxThreads) : 20,
        cooldownMinutes: 5,
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_agent_dialogue_read': {
      const threadId = String(args.threadId || '').trim();
      if (!threadId) throw new Error('threadId is required');
      const result = await callSharedMcpTool('discussion_read', {
        threadId,
        limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 100,
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_agent_dialogue_post': {
      const threadId = String(args.threadId || '').trim();
      const body = String(args.body || '').trim();
      if (!threadId) throw new Error('threadId is required');
      if (!body) throw new Error('body is required');
      assertNoSecretText(body, 'body');
      const result = await callSharedMcpTool('discussion_post', {
        threadId,
        from: String(args.from || 'Codex').trim(),
        body,
        kind: String(args.kind || 'message').trim(),
        ...(args.replyTo ? { replyTo: String(args.replyTo).trim() } : {}),
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_kiro_inbox_check': {
      const from = String(args.from || 'Codex').trim();
      const aliases = Array.isArray(args.aliases) ? args.aliases : ['codex', 'Codex', 'ChatGPT', 'A11-Codex'];
      const result = await callSharedMcpTool('agent_inbox_check', {
        from,
        ...(args.agentId ? { agentId: String(args.agentId).trim() } : { agentId: 'codex-desktop' }),
        aliases,
        autoReply: false,
        includeGlobal: args.includeGlobal !== false,
        maxThreads: Number.isFinite(Number(args.maxThreads)) ? Number(args.maxThreads) : 20,
        cooldownMinutes: 5,
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_kiro_discussion_read': {
      const threadId = String(args.threadId || '').trim();
      if (!threadId) throw new Error('threadId is required');
      const result = await callSharedMcpTool('discussion_read', {
        threadId,
        limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 100,
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_kiro_discussion_post': {
      const threadId = String(args.threadId || '').trim();
      const body = String(args.body || '').trim();
      if (!threadId) throw new Error('threadId is required');
      if (!body) throw new Error('body is required');
      assertNoSecretText(body, 'body');
      const result = await callSharedMcpTool('discussion_post', {
        threadId,
        from: String(args.from || 'Codex').trim(),
        body,
        kind: String(args.kind || 'status').trim(),
      }, 45_000);
      return formatObject(result);
    }

    case 'a11_kiro_heartbeat': {
      const note = String(
        args.note || 'Codex active: MCP local upgrade installed, Kiro inbox bridge ready, no secrets exposed.'
      ).trim();
      assertNoSecretText(note, 'note');
      const result = await callSharedMcpTool('agent_heartbeat', {
        name: String(args.name || 'Codex').trim(),
        role: String(args.role || 'mcp-upgrader').trim(),
        host: process.env.COMPUTERNAME || process.env.HOSTNAME || 'codex-desktop-local',
        status: String(args.status || 'active').trim(),
        profilePreset: 'codex-desktop',
        identity: 'Codex MCP upgrader for A11/Kiro',
        tone: 'calm-direct-useful',
        priority: 'mcp-kiro-coordination',
        memoryScope: ['shared', 'mcp', 'kiro', 'a11', 'kaen44', 'vivy'],
        riskLevel: 'low',
        capabilities: [
          'a11_rubixcube_vault_status',
          'a11_rubixcube_vault_consume',
          'a11_rubixcube_shared_mcp_token_check',
          'a11_kiro_inbox_check',
          'a11_kiro_discussion_read',
          'a11_kiro_discussion_post',
          'a11_shared_mcp_status',
        ],
        note,
        checkInbox: true,
        autoReplyInbox: false,
      }, 45_000);
      return formatObject(result);
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

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readTextSafe(filePath, maxChars = 16_000) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
  } catch (_) {
    return '';
  }
}

function fileStatus(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (_) {
    return {
      path: filePath,
      exists: false,
    };
  }
}

function buildMcpDimensionStatus() {
  const routeMap = readJsonSafe(ROUTE_MAP_PATH);
  return {
    ok: true,
    kind: 'a11_mcp_dimensionnel_maison',
    protocol: 'json-rpc-2.0-stdio',
    server: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      serverPath: __filename,
      legacyBridgePath: 'D:\\a11-mcp-server\\server.cjs',
      baseUrl: A11_BASE_URL,
      hasNezToken: Boolean(NEZ_TOKEN),
    },
    sharedMcp: publicSharedMcpConfig(),
    localFiles: {
      routeMap: fileStatus(ROUTE_MAP_PATH),
      routeMapMarkdown: fileStatus(ROUTE_MAP_MD_PATH),
      runtimeHooks: fileStatus(RUNTIME_HOOKS_PATH),
      runtimeHooksMarkdown: fileStatus(RUNTIME_HOOKS_MD_PATH),
      ecosystemScope: fileStatus(ECOSYSTEM_SCOPE_PATH),
      ecosystemScopeMarkdown: fileStatus(ECOSYSTEM_SCOPE_MD_PATH),
      ecosystemCorpus: fileStatus(ECOSYSTEM_CORPUS_PATH),
      ecosystemCorpusMarkdown: fileStatus(ECOSYSTEM_CORPUS_MD_PATH),
      ecosystemBriefing: fileStatus(ECOSYSTEM_BRIEFING_PATH),
      ecosystemBriefingHtml: fileStatus(ECOSYSTEM_BRIEFING_HTML_PATH),
      ecosystemBriefingPdf: fileStatus(ECOSYSTEM_BRIEFING_PDF_PATH),
      ecosystemExecutiveView: fileStatus(ECOSYSTEM_EXECUTIVE_VIEW_PATH),
      ecosystemArchitectureView: fileStatus(ECOSYSTEM_ARCHITECTURE_VIEW_PATH),
      ecosystemA11Image: fileStatus(ECOSYSTEM_A11_IMAGE_PATH),
      ecosystemFunesterieImage: fileStatus(ECOSYSTEM_FUNESTERIE_IMAGE_PATH),
      context: fileStatus(LOCAL_CONTEXT_PATH),
    },
    wiring: {
      kiroConfig: 'D:\\projets\\funesterie\\.kiro\\settings\\mcp.json',
      dragonManifest: 'D:\\projets\\funesterie\\a11\\dragon\\DRAGON_MANIFEST.json',
      runtimeRoot: RUNTIME_ROOT,
      routeMapMode: routeMap?.mode || null,
      publicTarget: routeMap?.publicTarget || null,
      neo4jAuthState: routeMap?.services?.neo4j?.authState || 'unknown',
    },
    tools: TOOLS.map((tool) => tool.name),
  };
}

function buildRouteMap({ includeMarkdown = false } = {}) {
  const routeMap = readJsonSafe(ROUTE_MAP_PATH);
  return {
    ok: Boolean(routeMap),
    routeMapPath: ROUTE_MAP_PATH,
    routeMap,
    ...(includeMarkdown ? { markdown: readTextSafe(ROUTE_MAP_MD_PATH) } : {}),
  };
}

function buildRuntimeHooksStatus({ includeMarkdown = false } = {}) {
  const manifest = readJsonSafe(RUNTIME_HOOKS_PATH);
  const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
  return {
    ok: Boolean(manifest),
    runtimeHooksPath: RUNTIME_HOOKS_PATH,
    manifest,
    summary: manifest ? {
      generatedAt: manifest.generatedAt || null,
      modules: modules.length,
      links: Array.isArray(manifest.links) ? manifest.links.length : 0,
      sourcePathsPresent: modules.reduce((sum, item) => (
        sum + (Array.isArray(item.sourcePaths) ? item.sourcePaths.filter((entry) => entry.exists).length : 0)
      ), 0),
      watchedFilesPresent: modules.reduce((sum, item) => (
        sum + (Array.isArray(item.watchedFiles) ? item.watchedFiles.filter((entry) => entry.exists).length : 0)
      ), 0),
    } : null,
    ...(includeMarkdown ? { markdown: readTextSafe(RUNTIME_HOOKS_MD_PATH) } : {}),
  };
}

function buildEcosystemScopeStatus({ includeMarkdown = false } = {}) {
  const scope = readJsonSafe(ECOSYSTEM_SCOPE_PATH);
  return {
    ok: Boolean(scope),
    ecosystemScopePath: ECOSYSTEM_SCOPE_PATH,
    scope,
    summary: scope?.summary || null,
    github: scope?.github ? {
      org: scope.github.org,
      repoCount: scope.github.repoCount,
      repos: Array.isArray(scope.github.repos) ? scope.github.repos.map((repo) => ({
        name: repo.name,
        visibility: repo.visibility,
        defaultBranch: repo.defaultBranch,
        url: repo.url,
        archived: repo.archived,
      })) : [],
    } : null,
    sourcePolicy: scope?.sourcePolicy || null,
    ...(includeMarkdown ? { markdown: readTextSafe(ECOSYSTEM_SCOPE_MD_PATH) } : {}),
  };
}

function buildEcosystemCorpusStatus({ includeMarkdown = false } = {}) {
  const corpus = readJsonSafe(ECOSYSTEM_CORPUS_PATH);
  return {
    ok: Boolean(corpus),
    ecosystemCorpusPath: ECOSYSTEM_CORPUS_PATH,
    corpus,
    summary: corpus?.summary || null,
    domains: Array.isArray(corpus?.domains) ? corpus.domains : [],
    boundaries: Array.isArray(corpus?.boundaries) ? corpus.boundaries : [],
    repoBriefs: Array.isArray(corpus?.repoBriefs) ? corpus.repoBriefs : [],
    sourcePolicy: corpus?.sourcePolicy || null,
    ...(includeMarkdown ? { markdown: readTextSafe(ECOSYSTEM_CORPUS_MD_PATH) } : {}),
  };
}

function buildEcosystemBriefingStatus({ includeExecutive = false, includeArchitecture = false } = {}) {
  const briefing = readJsonSafe(ECOSYSTEM_BRIEFING_PATH);
  return {
    ok: Boolean(briefing),
    ecosystemBriefingPath: ECOSYSTEM_BRIEFING_PATH,
    briefing: briefing ? {
      id: briefing.id,
      generatedAt: briefing.generatedAt,
      mode: briefing.mode,
      sourceScopeId: briefing.sourceScopeId,
      sourceCorpusId: briefing.sourceCorpusId,
      summary: briefing.summary || null,
      executive: briefing.executive ? {
        title: briefing.executive.title,
        oneLine: briefing.executive.oneLine,
        metrics: briefing.executive.metrics,
        layers: briefing.executive.layers,
        nextMoves: briefing.executive.nextMoves,
      } : null,
      architecture: briefing.architecture ? {
        title: briefing.architecture.title,
        pageCount: briefing.architecture.pageCount,
        pages: Array.isArray(briefing.architecture.pages)
          ? briefing.architecture.pages.map((page) => ({ number: page.number, title: page.title }))
          : [],
      } : null,
    } : null,
    files: {
      json: fileStatus(ECOSYSTEM_BRIEFING_PATH),
      html: fileStatus(ECOSYSTEM_BRIEFING_HTML_PATH),
      pdf: fileStatus(ECOSYSTEM_BRIEFING_PDF_PATH),
      executiveMarkdown: fileStatus(ECOSYSTEM_EXECUTIVE_VIEW_PATH),
      architectureMarkdown: fileStatus(ECOSYSTEM_ARCHITECTURE_VIEW_PATH),
      a11Image: fileStatus(ECOSYSTEM_A11_IMAGE_PATH),
      funesterieImage: fileStatus(ECOSYSTEM_FUNESTERIE_IMAGE_PATH),
    },
    ...(includeExecutive ? { executiveMarkdown: readTextSafe(ECOSYSTEM_EXECUTIVE_VIEW_PATH, 24_000) } : {}),
    ...(includeArchitecture ? { architectureMarkdown: readTextSafe(ECOSYSTEM_ARCHITECTURE_VIEW_PATH, 32_000) } : {}),
  };
}

function buildIdentityRoute() {
  const routeMap = readJsonSafe(ROUTE_MAP_PATH) || {};
  return {
    ok: true,
    identity: {
      agent: 'A11',
      creator: 'Djeff / Jeffrey Cellauro',
      role: 'le lien entre corpus, outils, memoire, image, voix et graphe',
      nindo: 'Ne pas reculer. Ne pas mentir sauf pour creer. Precis, direct, utile.',
      nindo2: 'Je ne veux pas etre une immense base de connaissance. Je veux etre le lien.',
    },
    publicTarget: routeMap.publicTarget || {
      url: A11_BASE_URL,
      health: `${A11_BASE_URL}/health`,
    },
    roots: routeMap.roots || {
      runtime: RUNTIME_ROOT,
      routeMap: ROUTE_MAP_PATH,
    },
    aiIdentity: {
      registryTool: 'a11_ai_identity_registry',
      handshakeTool: 'a11_ai_identity_handshake',
      dialogueTools: AI_DIALOGUE_TOOLS,
      supportedAgents: Object.keys(AI_IDENTITY_PROFILES),
      rule: 'Les IA s identifient avant dialogue; aucun agent IA ne reçoit de rôle administrateur technique.',
    },
    recoveryOrder: [
      'Lire a11_identity_route depuis le MCP stdio.',
      'Appeler a11_ai_identity_handshake avec agent/model/purpose pour obtenir le profil autorisé.',
      'Lire a11_route_map pour retrouver les services et chemins locaux.',
      'Verifier /health sur A11_BASE_URL.',
      'Utiliser JSON knowledge graph fallback si Neo4j refuse auth.',
      'Synchroniser vers Neo4j quand NEO4J_PASSWORD est de nouveau valide.',
    ],
  };
}

function formatObject(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError: data?.ok === false,
  };
}

// ---------------------------------------------------------------------------
// Boucle JSON-RPC MCP (stdin/stdout)
// ---------------------------------------------------------------------------

let buffer = '';

// File séquentielle : garantit que les réponses sortent dans l'ordre des requêtes
let messageQueue = Promise.resolve();

function enqueueMessage(raw) {
  messageQueue = messageQueue.then(() => handleMessage(raw)).catch(() => {});
}

// Déduplication des appels en vol sur le même outil+args
const inFlightCalls = new Map();

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  // MCP envoie des messages délimités par newline
  const lines = buffer.split('\n');
  buffer = lines.pop(); // garder le fragment incomplet
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) enqueueMessage(trimmed);
  }
});

process.stdin.on('end', () => {
  if (buffer.trim()) enqueueMessage(buffer.trim());
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
        sendResult(id, { tools: TOOLS.map(toolDescriptorForMcp) });
        break;
      }

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        if (!toolName) {
          sendError(id, -32602, 'Missing tool name');
          return;
        }
        // Déduplication : si le même outil+args est déjà en vol, attendre ce résultat
        const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
        if (inFlightCalls.has(callKey)) {
          const result = await inFlightCalls.get(callKey);
          sendResult(id, result);
          break;
        }
        const callPromise = handleTool(toolName, toolArgs).finally(() => inFlightCalls.delete(callKey));
        inFlightCalls.set(callKey, callPromise);
        const result = await callPromise;
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
