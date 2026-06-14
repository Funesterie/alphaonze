'use strict';

const crypto = require('node:crypto');

const SCHEMA = 'funesterie.a11-request-planner.v1';
const SECRET_SCHEMA = 'funesterie.nez-secret-envelope.v1';

function cleanText(value = '') {
  return String(value || '').trim();
}

function foldText(value = '') {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function buildTraceId(explicit = '') {
  const value = cleanText(explicit);
  if (value) return value;
  return `a11plan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function unique(values = []) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function baseNeeds(overrides = {}) {
  return {
    llm: true,
    memory: false,
    neo4j: false,
    mcp: false,
    nez: false,
    redis: false,
    voice: false,
    webOrExternal: false,
    systemTool: false,
    ...overrides,
  };
}

function buildPlan({
  traceId,
  mode,
  intent,
  complexityScore,
  needs,
  latencyBudgetMs,
  toolsRequired,
  toolsOptional = [],
  toolsForbidden = [],
  backgroundJobs = [],
  fallbackResponse = '',
  requiresConfirmation = false,
} = {}) {
  return {
    schema: SCHEMA,
    traceId: buildTraceId(traceId),
    mode,
    intent,
    complexityScore,
    needs,
    toolsRequired: unique(toolsRequired),
    toolsOptional: unique(toolsOptional),
    toolsForbidden: unique(toolsForbidden),
    latencyBudgetMs,
    timeoutsMs: {
      llm: mode === 'deep' ? 45000 : 2500,
      mcp: needs.mcp ? 8000 : 0,
      neo4j: needs.neo4j ? 8000 : 0,
      nez: needs.nez ? 5000 : 0,
      redis: needs.redis ? 1500 : 0,
      voice: needs.voice ? 12000 : 0,
    },
    cache: {
      enabled: mode === 'fast' || needs.redis,
      scope: mode === 'fast' ? 'session_short' : 'session_context',
      ttlMs: mode === 'fast' ? 60000 : 300000,
    },
    backgroundJobs: unique(backgroundJobs),
    fallbackResponse,
    policy: {
      requiresConfirmation,
      rawSecretsAllowed: false,
      blockPromptSecrets: true,
      heavyToolsDefaultToBackground: mode !== 'deep',
    },
    plannedAt: new Date().toISOString(),
  };
}

function isSimpleGreeting(normalized = '') {
  if (!normalized || normalized.length > 90) return false;
  if (/\b(mcp|neo4j|nez|redis|token|secret|api key|cle api|architecture|analyse|corrige|debug|deploie|deploy|image|video|voix|tts|fichier|mail|email)\b/.test(normalized)) {
    return false;
  }
  return /^(salut|bonjour|bonsoir|coucou|hello|yo|wesh|allo)\b/.test(normalized)
    || /\b(ca va|comment tu vas|tu es la|t es la)\b/.test(normalized);
}

function wantsVoice(normalized = '', body = {}) {
  if (body.voice === true || body.tts === true || body.needsVoice === true) return true;
  return /\b(voix|tts|vocal|parle avec ta voix|reponds en audio|audio)\b/.test(normalized);
}

function wantsAdmin(normalized = '') {
  const target = /\b(token|secret|api key|cle api|env|dotenv|terminal|shell|systeme|system|windows|caddy|deploy|deploie|push|prod|delete|supprime|rotation|oauth)\b/.test(normalized);
  const action = /\b(utilise|verifie|configure|change|modifie|corrige|lance|installe|connecte|repare|deploy|deploie|supprime|delete|rotate|rotation)\b/.test(normalized);
  return target && action;
}

function wantsDeep(normalized = '') {
  const architecture = /\b(architecture|mcp|neo4j|nez|redis|qflush|workers?|agents?|timeout|latence|lent|galere|pipeline|orchestr|routeur|outils?|tools?|memoire|graphe|diagnostic|analyse|debug)\b/.test(normalized);
  const action = /\b(analyse|diagnostique|explique|corrige|pourquoi|optimise|implemente|implemente|planifie|route|gere|debug)\b/.test(normalized);
  return architecture && action;
}

function wantsWebOrExternal(normalized = '') {
  return /\b(web|internet|cherche|recherche|site|url|http|github|drive|google|microsoft|mail|email)\b/.test(normalized);
}

function planA11Request({ message = '', body = {}, traceId = '', secretIntake = null } = {}) {
  const normalized = foldText(message);
  const id = buildTraceId(traceId);
  const voice = wantsVoice(normalized, body);
  const secretDetected = secretIntake?.detected === true;

  if (isSimpleGreeting(normalized)) {
    return buildPlan({
      traceId: id,
      mode: 'fast',
      intent: 'chat.greeting',
      complexityScore: 0.1,
      needs: baseNeeds({ voice }),
      latencyBudgetMs: 3000,
      toolsRequired: ['llm.chat'],
      toolsForbidden: ['mcp.full', 'neo4j.query', 'nez.deep_context', 'redis.blocking', 'tts.blocking', 'system.tool'],
      backgroundJobs: voice ? ['log_message', 'tts.generate_async'] : ['log_message'],
      fallbackResponse: 'Oui, je suis la. Je reprends simplement.',
    });
  }

  if (wantsAdmin(normalized) || secretDetected) {
    return buildPlan({
      traceId: id,
      mode: 'admin',
      intent: secretDetected ? 'secret.intake' : 'admin.action',
      complexityScore: 0.85,
      needs: baseNeeds({
        memory: false,
        nez: secretDetected,
        redis: true,
        voice,
        webOrExternal: wantsWebOrExternal(normalized),
        systemTool: true,
      }),
      latencyBudgetMs: 15000,
      toolsRequired: ['llm.chat'],
      toolsOptional: secretDetected ? ['nez.secret_envelope', 'redis.cache'] : ['redis.cache'],
      toolsForbidden: ['raw_secret.prompt', 'raw_secret.log', 'raw_secret.memory', 'raw_secret.mcp'],
      backgroundJobs: ['audit_event', 'log_message'],
      fallbackResponse: 'Je peux preparer cette action, mais je garde les secrets hors du modele et je demande confirmation avant une action sensible.',
      requiresConfirmation: true,
    });
  }

  if (wantsDeep(normalized)) {
    return buildPlan({
      traceId: id,
      mode: 'deep',
      intent: 'architecture.diagnostic',
      complexityScore: 0.75,
      needs: baseNeeds({
        memory: true,
        neo4j: true,
        mcp: true,
        nez: true,
        redis: true,
        voice,
        webOrExternal: wantsWebOrExternal(normalized),
      }),
      latencyBudgetMs: 60000,
      toolsRequired: ['llm.chat'],
      toolsOptional: ['mcp.context', 'nez.context', 'neo4j.memory', 'redis.cache'],
      toolsForbidden: ['tts.blocking', 'raw_secret.prompt', 'raw_secret.log'],
      backgroundJobs: voice
        ? ['save_summary', 'index_memory', 'mcp_trace_log', 'tts.generate_async']
        : ['save_summary', 'index_memory', 'mcp_trace_log'],
      fallbackResponse: 'Je peux repondre vite avec un diagnostic court, puis approfondir avec les outils lourds si necessaire.',
    });
  }

  return buildPlan({
    traceId: id,
    mode: voice ? 'background' : 'fast',
    intent: voice ? 'chat.voice_async' : 'chat.reply',
    complexityScore: voice ? 0.35 : 0.25,
    needs: baseNeeds({
      memory: true,
      redis: true,
      voice,
      webOrExternal: wantsWebOrExternal(normalized),
    }),
    latencyBudgetMs: voice ? 5000 : 8000,
    toolsRequired: ['llm.chat'],
    toolsOptional: ['redis.cache', 'memory.summary'],
    toolsForbidden: ['mcp.full', 'neo4j.query', 'nez.deep_context', 'tts.blocking', 'system.tool'],
    backgroundJobs: voice ? ['log_message', 'maybe_summarize', 'tts.generate_async'] : ['log_message', 'maybe_summarize'],
    fallbackResponse: 'Je reponds directement; les traitements lourds passent derriere si besoin.',
  });
}

const SECRET_PATTERNS = [
  { provider: 'github', kind: 'api_token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g },
  { provider: 'openai', kind: 'api_key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/g },
  { provider: 'huggingface', kind: 'api_token', regex: /\bhf_[A-Za-z0-9]{20,255}\b/g },
  { provider: 'stripe', kind: 'api_key', regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}\b/g },
  { provider: 'discord', kind: 'bot_token', regex: /\b(?:mfa\.[A-Za-z0-9_-]{20,}|[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})\b/g },
  { provider: 'generic', kind: 'secret', regex: /\b(?:bearer|token|api[_ -]?key|secret|client[_ -]?secret)\s*[:=]\s*([A-Za-z0-9._~+/=-]{24,})/gi, capture: 1 },
];

function collectSecretCandidates(text = '') {
  const source = String(text || '');
  const candidates = [];
  if (!source) return candidates;

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(source)) !== null) {
      const raw = String(pattern.capture ? match[pattern.capture] : match[0] || '').trim();
      if (!raw) continue;
      const rawIndex = pattern.capture && match[0]
        ? match.index + String(match[0]).indexOf(raw)
        : match.index;
      candidates.push({
        provider: pattern.provider,
        kind: pattern.kind,
        raw,
        index: rawIndex,
        end: rawIndex + raw.length,
      });
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.index !== right.index) return left.index - right.index;
      return (right.end - right.index) - (left.end - left.index);
    })
    .filter((candidate, index, sorted) => {
      return !sorted.slice(0, index).some((previous) => candidate.index < previous.end && candidate.end > previous.index);
    });
}

function deriveSecretKey(secret = '') {
  const resolved = cleanText(secret || process.env.A11_NEZ_SECRET_INTAKE_KEY || process.env.NEZ_SECRET_INTAKE_KEY);
  if (!resolved) return null;
  return crypto.createHash('sha256').update(`${SECRET_SCHEMA}|${resolved}`).digest();
}

function fingerprintSecret(rawSecret = '', secret = '') {
  const key = cleanText(secret || process.env.A11_SECRET_FINGERPRINT_KEY || process.env.A11_NEZ_SECRET_INTAKE_KEY || process.env.NEZ_SECRET_INTAKE_KEY);
  if (key) {
    return crypto.createHmac('sha256', key).update(String(rawSecret)).digest('hex').slice(0, 12);
  }
  return crypto.createHash('sha256').update(`${SECRET_SCHEMA}|${rawSecret}`).digest('hex').slice(0, 12);
}

function encryptSecretEnvelope(rawSecret = '', {
  vaultSecret = '',
  aad = '',
  now = () => new Date(),
} = {}) {
  const key = deriveSecretKey(vaultSecret);
  const createdAt = now().toISOString();
  if (!key) {
    return {
      schema: SECRET_SCHEMA,
      alg: 'not-persisted',
      status: 'vault_key_missing',
      createdAt,
    };
  }
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(cleanText(aad) || SECRET_SCHEMA, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(String(rawSecret), 'utf8'),
    cipher.final(),
  ]);
  return {
    schema: SECRET_SCHEMA,
    alg: 'aes-256-gcm',
    kid: 'nez-secret-intake-local',
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
    createdAt,
  };
}

function buildSecretRecord(rawSecret = '', {
  provider = 'generic',
  kind = 'secret',
  vaultSecret = '',
  now = () => new Date(),
} = {}) {
  const fingerprint = fingerprintSecret(rawSecret, vaultSecret);
  const normalizedProvider = cleanText(provider) || 'generic';
  const placeholder = `secret://nez/${normalizedProvider}/${fingerprint}`;
  return {
    provider: normalizedProvider,
    kind: cleanText(kind) || 'secret',
    placeholder,
    fingerprint,
    scope: [normalizedProvider],
    ttl: '30d',
    envelope: encryptSecretEnvelope(rawSecret, {
      vaultSecret,
      aad: placeholder,
      now,
    }),
  };
}

function sanitizeTextSecrets(text = '', context) {
  const source = String(text || '');
  const candidates = collectSecretCandidates(source);
  if (!candidates.length) return source;

  let sanitized = source;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    let record = context.recordsByRaw.get(candidate.raw);
    if (!record) {
      record = buildSecretRecord(candidate.raw, {
        provider: candidate.provider,
        kind: candidate.kind,
        vaultSecret: context.vaultSecret,
        now: context.now,
      });
      context.recordsByRaw.set(candidate.raw, record);
      context.records.push(record);
    }
    sanitized = `${sanitized.slice(0, candidate.index)}${record.placeholder}${sanitized.slice(candidate.end)}`;
  }
  return sanitized;
}

function sanitizeMessageContent(content, context) {
  if (typeof content === 'string') return sanitizeTextSecrets(content, context);
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return sanitizeTextSecrets(part, context);
      if (!part || typeof part !== 'object') return part;
      if (typeof part.text === 'string') {
        return { ...part, text: sanitizeTextSecrets(part.text, context) };
      }
      return { ...part };
    });
  }
  return content;
}

function extractLatestUserMessage(body = {}) {
  const direct = cleanText(body.message || body.prompt || body.input);
  if (direct) return direct;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (cleanText(message?.role).toLowerCase() !== 'user') continue;
    if (typeof message?.content === 'string') return cleanText(message.content);
    if (Array.isArray(message?.content)) {
      const text = message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
          return '';
        })
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

function buildSecretIntakeSummary(records = []) {
  const safeRecords = records.map((record) => ({
    provider: record.provider,
    kind: record.kind,
    placeholder: record.placeholder,
    fingerprint: record.fingerprint,
    scope: record.scope,
    ttl: record.ttl,
    envelope: record.envelope,
  }));
  return {
    detected: safeRecords.length > 0,
    count: safeRecords.length,
    secrets: safeRecords,
  };
}

function prepareA11Request({
  body = {},
  traceId = '',
  vaultSecret = '',
  now = () => new Date(),
} = {}) {
  const context = {
    recordsByRaw: new Map(),
    records: [],
    vaultSecret,
    now,
  };
  const nextBody = body && typeof body === 'object' ? { ...body } : {};

  for (const key of ['message', 'prompt', 'input']) {
    if (typeof nextBody[key] === 'string') {
      nextBody[key] = sanitizeTextSecrets(nextBody[key], context);
    }
  }

  if (Array.isArray(nextBody.messages)) {
    nextBody.messages = nextBody.messages.map((message) => {
      if (!message || typeof message !== 'object') return message;
      return {
        ...message,
        content: sanitizeMessageContent(message.content, context),
      };
    });
  }

  const secretIntake = buildSecretIntakeSummary(context.records);
  const latestUserMessage = extractLatestUserMessage(nextBody);
  const plan = planA11Request({
    message: latestUserMessage,
    body: nextBody,
    traceId,
    secretIntake,
  });

  return {
    body: nextBody,
    latestUserMessage,
    plan,
    secretIntake,
  };
}

function summarizeA11PlanForClient(plan = {}, secretIntake = null) {
  const secrets = secretIntake?.detected
    ? {
        detected: true,
        count: secretIntake.count,
        placeholders: (secretIntake.secrets || []).map((secret) => secret.placeholder).filter(Boolean),
      }
    : { detected: false, count: 0, placeholders: [] };
  return {
    traceId: cleanText(plan.traceId),
    mode: cleanText(plan.mode),
    intent: cleanText(plan.intent),
    latencyBudgetMs: Number(plan.latencyBudgetMs || 0),
    toolsRequired: Array.isArray(plan.toolsRequired) ? plan.toolsRequired : [],
    toolsOptional: Array.isArray(plan.toolsOptional) ? plan.toolsOptional : [],
    toolsForbidden: Array.isArray(plan.toolsForbidden) ? plan.toolsForbidden : [],
    backgroundJobs: Array.isArray(plan.backgroundJobs) ? plan.backgroundJobs : [],
    requiresConfirmation: plan?.policy?.requiresConfirmation === true,
    secretIntake: secrets,
  };
}

module.exports = {
  collectSecretCandidates,
  encryptSecretEnvelope,
  planA11Request,
  prepareA11Request,
  summarizeA11PlanForClient,
};
