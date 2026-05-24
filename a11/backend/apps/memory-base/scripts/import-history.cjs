#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MEMORY_ROOT = path.resolve(__dirname, '..');
const SERVER_ROOT = path.resolve(__dirname, '..', '..', 'server');
const DEFAULT_DATABASE_URL = 'postgres://127.0.0.1:5437/a11_memory';

const { Client } = require(path.join(SERVER_ROOT, 'node_modules', 'pg'));
const AdmZip = require(path.join(SERVER_ROOT, 'node_modules', 'adm-zip'));

function usage() {
  console.log([
    'Usage:',
    '  node scripts/import-history.cjs --init --codex-local --account local-codex-djeff',
    '  node scripts/import-history.cjs --input <export-dir|conversations.json|export.zip> --provider chatgpt --account perso',
    '  node scripts/import-history.cjs --input D:\\projets\\funesterie\\runtime\\Corpus --provider corpus --account funesterie-corpus',
    '',
    'Options:',
    '  --input <path>          Input file, directory, or ChatGPT export zip. Can repeat.',
    '  --provider <name>       chatgpt, codex, corpus, or auto. Default: auto.',
    '  --account <label>       Account/source label. Default: default.',
    '  --database-url <url>    Postgres URL. Default: A11_MEMORY_DATABASE_URL or local Docker URL.',
    '  --codex-local           Import C:\\Users\\<you>\\.codex\\sessions and archived_sessions.',
    '  --init                  Apply sql/001_schema.sql before importing.',
    '  --include-tools         Include Codex tool calls and outputs. Default: false.',
    '  --help                  Show this help.',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = {
    inputs: [],
    provider: 'auto',
    account: 'default',
    databaseUrl: process.env.A11_MEMORY_DATABASE_URL || DEFAULT_DATABASE_URL,
    codexLocal: false,
    init: false,
    includeTools: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--input' || arg === '-i') opts.inputs.push(argv[++index]);
    else if (arg === '--provider') opts.provider = String(argv[++index] || 'auto').trim().toLowerCase();
    else if (arg === '--account') opts.account = String(argv[++index] || 'default').trim() || 'default';
    else if (arg === '--database-url') opts.databaseUrl = String(argv[++index] || '').trim();
    else if (arg === '--codex-local') opts.codexLocal = true;
    else if (arg === '--init') opts.init = true;
    else if (arg === '--include-tools') opts.includeTools = true;
    else if (arg && !arg.startsWith('-')) opts.inputs.push(arg);
    else throw new Error(`Unknown option: ${arg}`);
  }

  return opts;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function toIsoFromUnix(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num < 100000000000 ? num * 1000 : num).toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === 'number') return toIsoFromUnix(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(root, predicate, output = []) {
  if (!fs.existsSync(root)) return output;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (!predicate || predicate(root)) output.push(root);
    return output;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, output);
    else if (entry.isFile() && (!predicate || predicate(full))) output.push(full);
  }
  return output;
}

function redactSecrets(input) {
  let text = String(input || '');
  let redactions = 0;
  const replace = (regex, replacement = '[REDACTED_SECRET]') => {
    text = text.replace(regex, (match, ...groups) => {
      redactions += 1;
      if (groups.length && typeof groups[0] === 'string' && regex.source.includes('(')) {
        return `${groups[0]}${replacement}`;
      }
      return replacement;
    });
  };

  replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g);
  replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g);
  replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g);
  replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g);
  replace(/\bwhsec_[A-Za-z0-9]{16,}\b/g);
  replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g);
  replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g);
  replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g);
  replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi, '[REDACTED_BEARER]');

  text = text.replace(
    /^(\s*(?:[\w.-]*?(?:api[_-]?key|secret|token|password|passwd|mdp|authorization|jwt)[\w.-]*?)\s*[:=]\s*)(.+)$/gim,
    (_match, prefix, value) => {
      if (!String(value || '').trim()) return `${prefix}`;
      redactions += 1;
      return `${prefix}[REDACTED_SECRET]`;
    }
  );

  return { text, redactions };
}

function chunkText(text, maxChars = 6000) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];
  const chunks = [];
  let offset = 0;
  while (offset < raw.length) {
    const slice = raw.slice(offset, offset + maxChars);
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
    const end = breakAt > maxChars * 0.55 ? offset + breakAt + 1 : offset + maxChars;
    chunks.push(raw.slice(offset, end).trim());
    offset = end;
  }
  return chunks.filter(Boolean);
}

async function applySchema(client) {
  const schemaPath = path.join(MEMORY_ROOT, 'sql', '001_schema.sql');
  await client.query(fs.readFileSync(schemaPath, 'utf8'));
}

async function createRun(client, opts, inputPath) {
  const result = await client.query(
    `INSERT INTO import_runs(provider, account_label, input_path)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [opts.provider, opts.account, inputPath || null]
  );
  return result.rows[0].id;
}

async function finishRun(client, runId, status, stats, error = null) {
  await client.query(
    `UPDATE import_runs
     SET status = $2,
         files_seen = $3,
         conversations_seen = $4,
         messages_seen = $5,
         chunks_seen = $6,
         redactions_seen = $7,
         error = $8,
         finished_at = now()
     WHERE id = $1`,
    [
      runId,
      status,
      stats.files || 0,
      stats.conversations || 0,
      stats.messages || 0,
      stats.chunks || 0,
      stats.redactions || 0,
      error,
    ]
  );
}

async function upsertSource(client, source) {
  const result = await client.query(
    `INSERT INTO memory_sources(provider, account_label, source_label, source_path, source_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (source_hash) DO UPDATE SET
       provider = EXCLUDED.provider,
       account_label = EXCLUDED.account_label,
       source_label = EXCLUDED.source_label,
       source_path = EXCLUDED.source_path,
       metadata = memory_sources.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      source.provider,
      source.accountLabel,
      source.sourceLabel,
      source.sourcePath,
      source.sourceHash,
      JSON.stringify(source.metadata || {}),
    ]
  );
  return result.rows[0].id;
}

async function upsertConversation(client, conv) {
  const result = await client.query(
    `INSERT INTO conversations(source_id, provider, account_label, external_id, title, created_at, updated_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (source_id, external_id) DO UPDATE SET
       title = EXCLUDED.title,
       created_at = COALESCE(conversations.created_at, EXCLUDED.created_at),
       updated_at = COALESCE(EXCLUDED.updated_at, conversations.updated_at),
       metadata = conversations.metadata || EXCLUDED.metadata
     RETURNING id`,
    [
      conv.sourceId,
      conv.provider,
      conv.accountLabel,
      conv.externalId,
      conv.title || 'Untitled conversation',
      conv.createdAt || null,
      conv.updatedAt || null,
      JSON.stringify(conv.metadata || {}),
    ]
  );
  return result.rows[0].id;
}

async function upsertMessageAndChunks(client, msg) {
  const contentHash = sha256(`${msg.provider}:${msg.accountLabel}:${msg.content}`);
  const result = await client.query(
    `INSERT INTO messages(source_id, conversation_id, external_id, ordinal, role, author, content, content_hash, redactions_count, created_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (conversation_id, external_id) DO UPDATE SET
       ordinal = EXCLUDED.ordinal,
       role = EXCLUDED.role,
       author = EXCLUDED.author,
       content = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       redactions_count = EXCLUDED.redactions_count,
       created_at = COALESCE(EXCLUDED.created_at, messages.created_at),
       metadata = messages.metadata || EXCLUDED.metadata
     RETURNING id`,
    [
      msg.sourceId,
      msg.conversationId,
      msg.externalId,
      msg.ordinal,
      msg.role || 'unknown',
      msg.author || null,
      msg.content,
      contentHash,
      msg.redactions || 0,
      msg.createdAt || null,
      JSON.stringify(msg.metadata || {}),
    ]
  );
  const messageId = result.rows[0].id;
  let chunks = 0;
  let chunkIndex = 0;
  for (const chunk of chunkText(msg.content)) {
    const chunkHash = sha256(`${contentHash}:${chunkIndex}:${chunk}`);
    await client.query(
      `INSERT INTO memory_chunks(source_id, conversation_id, message_id, chunk_index, role, content, content_hash, token_estimate, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (content_hash) DO UPDATE SET
         content = EXCLUDED.content,
         token_estimate = EXCLUDED.token_estimate,
         metadata = memory_chunks.metadata || EXCLUDED.metadata`,
      [
        msg.sourceId,
        msg.conversationId,
        messageId,
        chunkIndex,
        msg.role || 'unknown',
        chunk,
        chunkHash,
        estimateTokens(chunk),
        JSON.stringify({ ...msg.metadata, messageExternalId: msg.externalId }),
      ]
    );
    chunks += 1;
    chunkIndex += 1;
  }
  return { chunks };
}

function extractPart(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part === 'number' || typeof part === 'boolean') return String(part);
  if (Array.isArray(part)) return part.map(extractPart).filter(Boolean).join('\n');
  if (typeof part === 'object') {
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (Array.isArray(part.content)) return part.content.map(extractPart).filter(Boolean).join('\n');
    if (Array.isArray(part.parts)) return part.parts.map(extractPart).filter(Boolean).join('\n');
    if (part.name || part.mime_type || part.asset_pointer) {
      return `[attachment ${part.name || part.mime_type || 'asset'}]`;
    }
  }
  return '';
}

function extractChatGptContent(message) {
  const content = message?.content || {};
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractPart).filter(Boolean).join('\n');
  if (Array.isArray(content.parts)) return content.parts.map(extractPart).filter(Boolean).join('\n');
  if (content.text) return extractPart(content.text);
  if (content.result) return extractPart(content.result);
  return '';
}

function normalizeRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'assistant' || raw === 'user' || raw === 'system' || raw === 'tool') return raw;
  if (raw === 'agent') return 'assistant';
  return raw || 'unknown';
}

async function importChatGptFile(client, filePath, opts) {
  const raw = fs.readFileSync(filePath);
  const data = JSON.parse(raw.toString('utf8'));
  const conversations = Array.isArray(data) ? data : Array.isArray(data?.conversations) ? data.conversations : [];
  const provider = 'chatgpt';
  const sourceId = await upsertSource(client, {
    provider,
    accountLabel: opts.account,
    sourceLabel: path.basename(filePath),
    sourcePath: filePath,
    sourceHash: sha256(raw),
    metadata: { format: 'chatgpt-export' },
  });

  const stats = { files: 1, conversations: 0, messages: 0, chunks: 0, redactions: 0 };
  for (const conv of conversations) {
    const externalId = String(conv.id || conv.conversation_id || sha256(JSON.stringify(conv).slice(0, 500))).slice(0, 160);
    const conversationId = await upsertConversation(client, {
      sourceId,
      provider,
      accountLabel: opts.account,
      externalId,
      title: String(conv.title || 'ChatGPT conversation').slice(0, 300),
      createdAt: toIso(conv.create_time || conv.created_at),
      updatedAt: toIso(conv.update_time || conv.updated_at),
      metadata: { currentNode: conv.current_node || null },
    });
    stats.conversations += 1;

    const nodes = Object.entries(conv.mapping || {})
      .map(([nodeId, node]) => ({ nodeId, message: node?.message }))
      .filter((entry) => entry.message)
      .sort((a, b) => Number(a.message?.create_time || 0) - Number(b.message?.create_time || 0));

    let ordinal = 0;
    for (const entry of nodes) {
      const message = entry.message;
      const role = normalizeRole(message?.author?.role);
      if (role === 'system' || role === 'tool') continue;
      const extracted = extractChatGptContent(message).trim();
      if (!extracted) continue;
      const redacted = redactSecrets(extracted);
      await upsertMessageAndChunks(client, {
        sourceId,
        conversationId,
        provider,
        accountLabel: opts.account,
        externalId: String(message.id || entry.nodeId || `${externalId}:${ordinal}`),
        ordinal,
        role,
        author: message?.author?.name || role,
        content: redacted.text,
        redactions: redacted.redactions,
        createdAt: toIso(message?.create_time),
        metadata: {
          source: 'chatgpt',
          contentType: message?.content?.content_type || null,
          nodeId: entry.nodeId,
        },
      }).then((result) => {
        stats.chunks += result.chunks;
      });
      stats.messages += 1;
      stats.redactions += redacted.redactions;
      ordinal += 1;
    }
  }
  return stats;
}

function extractCodexMessage(payload) {
  if (!payload) return '';
  if (typeof payload.message === 'string') return payload.message;
  if (Array.isArray(payload.content)) return payload.content.map(extractPart).filter(Boolean).join('\n');
  if (typeof payload.content === 'string') return payload.content;
  if (payload.summary) return extractPart(payload.summary);
  return '';
}

function codexTitleFromFile(filePath) {
  const base = path.basename(filePath, '.jsonl');
  const match = base.match(/^rollout-(.+?)-([0-9a-f-]{20,})$/i);
  return match ? `Codex ${match[1]}` : base;
}

async function importCodexJsonl(client, filePath, opts) {
  const raw = fs.readFileSync(filePath);
  const provider = 'codex';
  const sourceId = await upsertSource(client, {
    provider,
    accountLabel: opts.account,
    sourceLabel: path.basename(filePath),
    sourcePath: filePath,
    sourceHash: sha256(raw),
    metadata: { format: 'codex-jsonl' },
  });

  const stats = { files: 1, conversations: 0, messages: 0, chunks: 0, redactions: 0 };
  let sessionId = path.basename(filePath, '.jsonl');
  let title = codexTitleFromFile(filePath);
  let createdAt = null;
  let updatedAt = null;
  const records = [];
  let lineNo = 0;

  for (const line of raw.toString('utf8').split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event.payload || {};
    if (event.type === 'session_meta') {
      sessionId = String(payload.id || sessionId);
      createdAt = toIso(payload.timestamp || event.timestamp) || createdAt;
      updatedAt = toIso(payload.timestamp || event.timestamp) || updatedAt;
      continue;
    }
    if (event.type === 'event_msg' && payload.type === 'thread_name_updated' && payload.thread_name) {
      title = String(payload.thread_name).slice(0, 300);
      continue;
    }
    if (event.type === 'event_msg' && (payload.type === 'user_message' || payload.type === 'agent_message')) {
      records.push({
        externalId: `${sessionId}:${lineNo}`,
        role: payload.type === 'user_message' ? 'user' : 'assistant',
        content: extractCodexMessage(payload),
        createdAt: toIso(event.timestamp || payload.started_at || payload.completed_at),
        metadata: { source: 'codex-event', eventType: payload.type, lineNo },
      });
      updatedAt = toIso(event.timestamp) || updatedAt;
      continue;
    }
    if (event.type === 'turn_context' && payload.summary) {
      records.push({
        externalId: `${sessionId}:${lineNo}`,
        role: 'summary',
        content: extractPart(payload.summary),
        createdAt: toIso(event.timestamp),
        metadata: { source: 'codex-turn-context', lineNo },
      });
      continue;
    }
    if (opts.includeTools && event.type === 'response_item') {
      const type = String(payload.type || '').trim();
      if (type === 'function_call' || type === 'function_call_output' || type === 'custom_tool_call' || type === 'custom_tool_call_output') {
        records.push({
          externalId: `${sessionId}:${lineNo}`,
          role: 'tool',
          content: JSON.stringify({
            type,
            name: payload.name || null,
            arguments: payload.arguments || payload.input || null,
            output: payload.output || null,
          }),
          createdAt: toIso(event.timestamp),
          metadata: { source: 'codex-tool', type, lineNo },
        });
      }
    }
  }

  const conversationId = await upsertConversation(client, {
    sourceId,
    provider,
    accountLabel: opts.account,
    externalId: sessionId,
    title,
    createdAt,
    updatedAt,
    metadata: { file: filePath },
  });
  stats.conversations += 1;

  let ordinal = 0;
  const seen = new Set();
  for (const record of records) {
    const rawContent = String(record.content || '').trim();
    if (!rawContent) continue;
    const redacted = redactSecrets(rawContent);
    const dedupeKey = sha256(`${record.role}:${redacted.text}`);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const result = await upsertMessageAndChunks(client, {
      sourceId,
      conversationId,
      provider,
      accountLabel: opts.account,
      externalId: record.externalId,
      ordinal,
      role: normalizeRole(record.role),
      author: normalizeRole(record.role),
      content: redacted.text,
      redactions: redacted.redactions,
      createdAt: record.createdAt,
      metadata: record.metadata,
    });
    stats.messages += 1;
    stats.chunks += result.chunks;
    stats.redactions += redacted.redactions;
    ordinal += 1;
  }

  return stats;
}

function isCorpusTextFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.includes('/node_modules/')
    || normalized.includes('/.git/')
    || normalized.includes('/dist/')
    || normalized.includes('/build/')
    || normalized.includes('/flowframesdata/pkgs/')
  ) {
    return false;
  }
  const base = path.basename(filePath).toLowerCase();
  if (base === 'package-lock.json' || base === 'pnpm-lock.yaml' || base === 'yarn.lock') return false;
  const ext = path.extname(filePath).toLowerCase();
  return ['.md', '.txt', '.json'].includes(ext);
}

function readCorpusText(filePath) {
  const raw = fs.readFileSync(filePath);
  if (raw.length > 1024 * 1024) return '';
  const text = raw.toString('utf8').trim();
  if (!text) return '';
  if (path.extname(filePath).toLowerCase() !== '.json') return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function importCorpusFile(client, filePath, opts) {
  const raw = fs.readFileSync(filePath);
  const text = readCorpusText(filePath);
  const stats = { files: 1, conversations: 0, messages: 0, chunks: 0, redactions: 0 };
  if (!text) return stats;

  const provider = 'corpus';
  const stat = fs.statSync(filePath);
  const workspaceRoot = path.resolve(MEMORY_ROOT, '..', '..', '..');
  const relativePath = path.relative(workspaceRoot, filePath) || filePath;
  const redacted = redactSecrets(text);
  const sourceId = await upsertSource(client, {
    provider,
    accountLabel: opts.account,
    sourceLabel: relativePath,
    sourcePath: filePath,
    sourceHash: sha256(raw),
    metadata: {
      format: 'corpus-file',
      extension: path.extname(filePath).toLowerCase(),
      bytes: raw.length,
      modifiedAt: stat.mtime.toISOString(),
    },
  });

  const conversationId = await upsertConversation(client, {
    sourceId,
    provider,
    accountLabel: opts.account,
    externalId: sha256(filePath).slice(0, 160),
    title: relativePath.slice(0, 300),
    createdAt: stat.birthtime?.toISOString?.() || null,
    updatedAt: stat.mtime.toISOString(),
    metadata: { file: filePath, relativePath },
  });
  stats.conversations += 1;

  const result = await upsertMessageAndChunks(client, {
    sourceId,
    conversationId,
    provider,
    accountLabel: opts.account,
    externalId: `${sha256(raw).slice(0, 32)}:document`,
    ordinal: 0,
    role: 'document',
    author: provider,
    content: redacted.text,
    redactions: redacted.redactions,
    createdAt: stat.mtime.toISOString(),
    metadata: {
      source: 'corpus-file',
      file: filePath,
      relativePath,
    },
  });
  stats.messages += 1;
  stats.chunks += result.chunks;
  stats.redactions += redacted.redactions;
  return stats;
}

function addStats(target, addition) {
  for (const key of ['files', 'conversations', 'messages', 'chunks', 'redactions']) {
    target[key] = (target[key] || 0) + (addition[key] || 0);
  }
}

function extractZip(inputPath) {
  const hash = sha256(fs.readFileSync(inputPath)).slice(0, 16);
  const outDir = path.join(os.tmpdir(), `a11-memory-import-${hash}`);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    new AdmZip(inputPath).extractAllTo(outDir, true);
  }
  return outDir;
}

function resolveInputs(opts) {
  const inputs = [...opts.inputs.filter(Boolean)];
  if (opts.codexLocal) {
    const codexRoot = path.join(os.homedir(), '.codex');
    inputs.push(path.join(codexRoot, 'sessions'));
    inputs.push(path.join(codexRoot, 'archived_sessions'));
  }
  return inputs;
}

function discoverImportFiles(inputPath, provider) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  let target = inputPath;
  if (fs.statSync(inputPath).isFile() && inputPath.toLowerCase().endsWith('.zip')) {
    target = extractZip(inputPath);
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return walkFiles(target, (file) => {
    const base = path.basename(file).toLowerCase();
    if (provider === 'chatgpt') return base === 'conversations.json';
    if (provider === 'codex') return base.endsWith('.jsonl') && base.startsWith('rollout-');
    if (provider === 'corpus') return isCorpusTextFile(file);
    return base === 'conversations.json' || (base.endsWith('.jsonl') && base.startsWith('rollout-')) || isCorpusTextFile(file);
  });
}

function detectProvider(filePath, requested) {
  if (requested && requested !== 'auto') return requested;
  const base = path.basename(filePath).toLowerCase();
  if (base === 'conversations.json') return 'chatgpt';
  if (base.endsWith('.jsonl')) return 'codex';
  if (isCorpusTextFile(filePath)) return 'corpus';
  return 'unknown';
}

async function importFile(client, filePath, opts) {
  const provider = detectProvider(filePath, opts.provider);
  if (provider === 'chatgpt') return importChatGptFile(client, filePath, opts);
  if (provider === 'codex') return importCodexJsonl(client, filePath, opts);
  if (provider === 'corpus') return importCorpusFile(client, filePath, opts);
  return { files: 0, conversations: 0, messages: 0, chunks: 0, redactions: 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  const inputs = resolveInputs(opts);
  if (!inputs.length && !opts.init) {
    usage();
    throw new Error('No input provided. Use --input or --codex-local.');
  }

  const client = new Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    if (opts.init) await applySchema(client);

    const total = { files: 0, conversations: 0, messages: 0, chunks: 0, redactions: 0 };
    const runId = await createRun(client, opts, inputs.join(';'));
    try {
      for (const input of inputs) {
        const files = discoverImportFiles(path.resolve(input), opts.provider);
        for (const file of files) {
          const stats = await importFile(client, file, opts);
          addStats(total, stats);
        }
      }
      await finishRun(client, runId, 'ok', total);
    } catch (error) {
      await finishRun(client, runId, 'failed', total, String(error?.message || error));
      throw error;
    }

    console.log(JSON.stringify({ ok: true, ...total }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[a11-memory-import] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
