'use strict';

const crypto = require('node:crypto');

const MAX_INTENT_TEXT_CHARS = 4000;
const MAX_RESULT_DEPTH = 5;
const MAX_RESULT_ARRAY = 30;
const MAX_RESULT_STRING = 2000;

const SECRET_ASSIGNMENT_RE = /\b(api[_-]?key|secret|password|passwd|token|private[_-]?key|bearer|cookie|session)\s*[:=]\s*["']?([^\s,"';)]+)/gi;
const BEARER_VALUE_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const SECRET_KEY_RE = /(api[_-]?key|secret|password|passwd|token|private[_-]?key|database[_-]?url|redis[_-]?url|bearer|cookie|session)/i;
const SECRET_REQUEST_RE = /\b(\.env|secret|token|api[_-]?key|cle api|key elevenlabs|mot de passe|password|private key|ssh|bearer|cookie)\b/i;
const DESTRUCTIVE_REQUEST_RE = /\b(rm\s+-rf|delete|supprime|efface|erase|format|reset|wipe|drop database|truncate|sudo|root|docker|compose|kubectl|shell|powershell|terminal|cmd\.exe|restart|redemarre|kill|deploy)\b/i;

const STATUS_CAPABILITIES = [
  {
    id: 'status.health',
    label: 'A11 health',
    category: 'status',
    description: 'Read A11 public health through the MCP bridge.',
    readOnly: true,
    route: { type: 'mcp-tool', tool: 'a11_status' },
  },
  {
    id: 'status.llm',
    label: 'LLM status',
    category: 'status',
    description: 'Read LLM routing status, including Groq availability when exposed.',
    readOnly: true,
    route: { type: 'mcp-tool', tool: 'a11_llm_stats' },
  },
  {
    id: 'voice.status',
    label: 'Vivy audio status',
    category: 'audio',
    description: 'Read the current Vivy audio/Qflush status.',
    readOnly: true,
    route: { type: 'mcp-tool', tool: 'qflush_vivy_audio_status' },
  },
  {
    id: 'audio.voice.preview',
    label: 'Voice preview request',
    category: 'audio',
    description: 'Queue a bounded voice preview job instead of exposing raw TTS tools.',
    readOnly: false,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'media',
      kind: 'vivy.voice.preview',
      title: 'Vivy voice preview request',
      risk: 'low',
      requiredCapabilities: ['media', 'voice'],
    },
  },
  {
    id: 'song.prepare',
    label: 'Song preparation request',
    category: 'audio',
    description: 'Queue a song preparation job with lyrics, casting and voice intent.',
    readOnly: false,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'media',
      kind: 'vivy.song.prepare',
      title: 'Vivy song preparation request',
      risk: 'low',
      requiredCapabilities: ['media', 'voice', 'music'],
    },
  },
  {
    id: 'vision.describe',
    label: 'Vision request',
    category: 'vision',
    description: 'Queue a bounded image or screen analysis request.',
    readOnly: false,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'media',
      kind: 'vision.describe',
      title: 'A11 vision description request',
      risk: 'low',
      requiredCapabilities: ['vision'],
    },
  },
  {
    id: 'files.read.request',
    label: 'Local file read request',
    category: 'local',
    description: 'Queue an operator-reviewed local file read request; no direct file read.',
    readOnly: false,
    requiresOperator: true,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'operator',
      kind: 'local.file-read.request',
      title: 'Operator-reviewed file read request',
      risk: 'medium',
      requiredCapabilities: ['operator', 'files'],
    },
  },
  {
    id: 'memory.note',
    label: 'Memory note request',
    category: 'memory',
    description: 'Queue a safe memory note request for A11 review.',
    readOnly: false,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'memory',
      kind: 'memory.note.review',
      title: 'A11 memory note review',
      risk: 'low',
      requiredCapabilities: ['memory'],
    },
  },
  {
    id: 'operator.review',
    label: 'Operator review',
    category: 'operator',
    description: 'Queue an operator review when the intent is unclear.',
    readOnly: false,
    requiresOperator: true,
    route: {
      type: 'job',
      tool: 'job_enqueue',
      queue: 'operator',
      kind: 'operator.review',
      title: 'A11 intent operator review',
      risk: 'medium',
      requiredCapabilities: ['operator'],
    },
  },
];

function normalizeSpaces(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function lowerSearch(value) {
  return stripAccents(value).toLowerCase();
}

function clipText(value, max = MAX_INTENT_TEXT_CHARS) {
  const text = normalizeSpaces(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 12).trim()} [truncated]`;
}

function sanitizeIntentText(value, max = MAX_INTENT_TEXT_CHARS) {
  return clipText(value, max)
    .replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=[redacted]`)
    .replace(BEARER_VALUE_RE, 'Bearer [redacted]');
}

function cleanIdentifier(value, fallback, max = 80) {
  const cleaned = normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return cleaned || fallback;
}

function normalizeStringList(value, maxItems = 12) {
  const raw = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const item of raw) {
    const cleaned = cleanIdentifier(item, '', 80);
    if (!cleaned || seen.has(cleaned)) continue;
    result.push(cleaned);
    seen.add(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function getIntentText(input = {}) {
  return input.text
    || input.intent
    || input.message
    || input.prompt
    || input.request?.text
    || input.payload?.text
    || '';
}

function normalizeMcpIntent(input = {}) {
  const source = cleanIdentifier(input.source || input.client || 'vivy', 'vivy', 60);
  const actor = cleanIdentifier(input.actor || input.from || 'a11-user', 'a11-user', 80);
  const rawText = getIntentText(input);
  const text = sanitizeIntentText(rawText);
  const searchText = lowerSearch(text);
  const dryRun = input.dryRun !== false;
  const sessionTokenPresent = Boolean(input.sessionToken || input.sessionKey || input.zenSessionKey);
  const requestedCapabilities = normalizeStringList(input.capabilities || input.requestedCapabilities);

  return {
    source,
    actor,
    text,
    searchText,
    dryRun,
    sessionTokenPresent,
    requestedCapabilities,
  };
}

function classifyIntent(normalized) {
  const text = normalized.searchText;

  if (!text) return 'operator.review';
  if (/\b(capabilit|capacite|health|status|statut|etat|disponible|mcp ok)\b/.test(text)) {
    if (/\b(llm|groq|gros model|gros modele|model|modele|router|routing)\b/.test(text)) {
      return 'status.llm';
    }
    if (/\b(voix|voice|audio|qflush|vivy)\b/.test(text)) {
      return 'voice.status';
    }
    return 'status.health';
  }
  if (/\b(llm|groq|gros model|gros modele|model|modele|router|routing)\b/.test(text)) {
    return 'status.llm';
  }
  if (/\b(chanson|suno|lyrics|paroles|couplet|refrain|bridge|duo|casting|chanter|prepare chanson|preparer chanson)\b/.test(text)) {
    return 'song.prepare';
  }
  if (/\b(voix|voice|audio|tts|xtts|rvc|timbre|parle|parler|preview|apercu)\b/.test(text)) {
    return 'audio.voice.preview';
  }
  if (/\b(image|photo|vision|camera|capture|janus|ecran|screen|analyse visuelle)\b/.test(text)) {
    return 'vision.describe';
  }
  if (/\b(fichier|file|dossier|folder|log|config|lire|read local|filesystem|workspace)\b/.test(text)) {
    return 'files.read.request';
  }
  if (/\b(memoire|memory|souviens|souvenir|note|corpus|zen)\b/.test(text)) {
    return 'memory.note';
  }
  return 'operator.review';
}

function findCapability(id) {
  return STATUS_CAPABILITIES.find((capability) => capability.id === id)
    || STATUS_CAPABILITIES.find((capability) => capability.id === 'operator.review');
}

function isToolAllowed(tool, config = {}) {
  if (!tool) return false;
  if (config.allowAllTools) return true;
  const allowed = config.allowedTools;
  if (allowed instanceof Set) return allowed.has(tool);
  if (Array.isArray(allowed)) return allowed.includes(tool);
  return true;
}

function toolAllowedFromDeps(tool, deps = {}) {
  const config = deps.mcpConfig || deps.config || null;
  if (!config) return true;
  return isToolAllowed(tool, config);
}

function intentHash(parts) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 18);
  return `a11-intent-${hash}`;
}

function riskReasonsForIntent(normalized, capability) {
  const reasons = [];
  const blocked = [];
  const text = normalized.searchText;

  if (DESTRUCTIVE_REQUEST_RE.test(text)) {
    blocked.push('destructive_or_unbounded_request');
  }
  if (SECRET_REQUEST_RE.test(text)) {
    if (capability.id === 'files.read.request') {
      blocked.push('secret_or_env_file_request');
    } else {
      blocked.push('secret_or_env_request');
    }
  }
  if (normalized.sessionTokenPresent) {
    reasons.push('session_token_present_not_echoed');
  }
  if (capability.requiresOperator) {
    reasons.push('operator_review_required');
  }

  return { reasons, blocked };
}

function routeSummary(capability) {
  return {
    type: capability.route.type,
    tool: capability.route.tool,
    queue: capability.route.queue || undefined,
    kind: capability.route.kind || undefined,
    title: capability.route.title || undefined,
    risk: capability.route.risk || 'low',
    requiredCapabilities: [...(capability.route.requiredCapabilities || [])],
  };
}

function planMcpIntent(input = {}, deps = {}) {
  const normalized = normalizeMcpIntent(input);
  const action = classifyIntent(normalized);
  const capability = findCapability(action);
  const route = routeSummary(capability);
  const { reasons, blocked } = riskReasonsForIntent(normalized, capability);
  const routeToolAllowed = toolAllowedFromDeps(route.tool, deps);

  if (!routeToolAllowed) {
    blocked.push('mcp_tool_not_allowlisted');
  }

  const allowed = blocked.length === 0;
  const executable = allowed && Boolean(route.tool);
  const intentId = intentHash({
    source: normalized.source,
    actor: normalized.actor,
    action: capability.id,
    text: normalized.text,
  });

  return {
    schema: 'funesterie.a11.mcp-intent-plan.v1',
    intentId,
    mode: normalized.dryRun ? 'dry-run' : 'execute',
    source: normalized.source,
    actor: normalized.actor,
    action: capability.id,
    category: capability.category,
    label: capability.label,
    text: normalized.text,
    requestedCapabilities: normalized.requestedCapabilities,
    allowed,
    executable,
    readOnly: Boolean(capability.readOnly),
    blocked: blocked.length > 0,
    requiresOperator: Boolean(capability.requiresOperator),
    reasons,
    blockedReasons: blocked,
    route,
    safety: {
      noSecretsEchoed: true,
      sessionTokenPresent: normalized.sessionTokenPresent,
      directToolAccessForVivy: false,
      dryRun: normalized.dryRun,
    },
  };
}

function buildA11McpIntentCapabilities(deps = {}) {
  const config = deps.mcpConfig || deps.config || {};
  return {
    schema: 'funesterie.a11.mcp-intent-capabilities.v1',
    service: 'a11-mcp-intent',
    boundaries: [
      'Vivy submits intents; A11 validates before MCP tools are called.',
      'Secrets and session tokens are never echoed or forwarded in job payloads.',
      'Local file access is operator-reviewed and never direct from Vivy.',
      'Physical input, shell, docker and deploy requests are refused by this bridge.',
    ],
    capabilities: STATUS_CAPABILITIES.map((capability) => ({
      id: capability.id,
      label: capability.label,
      category: capability.category,
      description: capability.description,
      readOnly: Boolean(capability.readOnly),
      requiresOperator: Boolean(capability.requiresOperator),
      route: routeSummary(capability),
      available: toolAllowedFromDeps(capability.route.tool, { mcpConfig: config }),
    })),
  };
}

function sanitizeResult(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeIntentText(value, MAX_RESULT_STRING);
  if (Array.isArray(value)) {
    if (depth >= MAX_RESULT_DEPTH) return '[truncated]';
    return value.slice(0, MAX_RESULT_ARRAY).map((item) => sanitizeResult(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_RESULT_DEPTH) return { truncated: true };
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = sanitizeResult(child, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

function buildJobInput(plan, input = {}, deps = {}) {
  const now = deps.now || new Date().toISOString();
  return {
    from: plan.actor || 'a11-mcp-intent',
    queue: plan.route.queue || 'operator',
    kind: plan.route.kind || 'operator.review',
    title: plan.route.title || plan.label || 'A11 MCP intent',
    payload: {
      schema: 'funesterie.a11.mcp-intent.v1',
      intentId: plan.intentId,
      source: plan.source,
      actor: plan.actor,
      action: plan.action,
      text: plan.text,
      requestedCapabilities: plan.requestedCapabilities,
      sessionTokenPresent: Boolean(plan.safety?.sessionTokenPresent),
      createdAt: now,
      confirm: input.confirm === true,
    },
    priority: Number.isFinite(Number(input.priority)) ? Math.max(-100, Math.min(100, Math.round(Number(input.priority)))) : 0,
    risk: plan.route.risk || 'low',
    requiredCapabilities: plan.route.requiredCapabilities || [],
    idempotencyKey: `a11-mcp-intent:${plan.intentId}`,
  };
}

async function executeMcpIntent(input = {}, deps = {}) {
  const plan = planMcpIntent({ ...input, dryRun: false }, deps);
  if (!plan.allowed || !plan.executable) {
    return {
      ok: false,
      error: 'mcp_intent_not_executable',
      mode: 'execute',
      plan,
    };
  }

  const mcp = deps.mcp || {};
  const callMcpTool = deps.callMcpTool || mcp.callMcpTool;
  if (typeof callMcpTool !== 'function') {
    const error = new Error('MCP call tool function is not configured.');
    error.status = 503;
    error.error = 'mcp_client_not_configured';
    throw error;
  }

  const config = deps.mcpConfig || deps.config || (typeof mcp.getMcpConfig === 'function' ? mcp.getMcpConfig(deps.env) : undefined);
  const tool = plan.route.tool;
  const args = plan.route.type === 'job'
    ? buildJobInput(plan, input, deps)
    : {};
  const upstream = await callMcpTool(tool, args, config ? { config } : undefined);

  return {
    ok: true,
    mode: 'execute',
    plan,
    call: {
      tool,
      arguments: sanitizeResult(args),
    },
    result: sanitizeResult(upstream),
  };
}

module.exports = {
  buildA11McpIntentCapabilities,
  buildJobInput,
  executeMcpIntent,
  normalizeMcpIntent,
  planMcpIntent,
  sanitizeIntentText,
};
