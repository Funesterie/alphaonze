#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const neo4j = require('neo4j-driver');

const { loadRouterEnv } = require('./a11-env-loader.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');

const DEFAULT_EXPORT_ID = 'chatgpt-export-2026-05-07';
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_CHUNK_SIZE = 5000;
const DEFAULT_PREVIEW_SIZE = 900;

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bhf_[A-Za-z0-9]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\b(?:api|secret|token|password|passwd|client_secret|webhook_secret)\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  /\b[A-Za-z0-9+/]{48,}={0,2}\b/g,
];

const TAG_RULES = [
  ['numa', /\bnuma\b|force des nombres|valeurs? des num[ée]ros?|valeurs? des chiffres|maison blanche|white house|\b1600\b|GHOST88|ENTERA|ligne magenta/i],
  ['zen_container', /\bzen\b|\.zen\b|zero-exposed nez|nez invers[ée]|zip invers[ée]|archive chiffr[ée]e?|conteneur opaque|conteneur chiffr[ée]|dump nez|cube rgba|cubes couleur|multi-load/i],
  ['neo4j_memory', /\bneo4j\b|cypher|knowledge[-\s]?graph|graph memory|m[ée]moire graphe/i],
  ['mcp_tools', /\bmcp\b|model context protocol|outils?|tools?|pont d.orchestration/i],
  ['qflush', /\bqflush\b|\bqflash\b|rgba cube|cube qflush|bat|rome|allmight/i],
  ['voice_audio', /\btts\b|xtts|rvc|piper|siwis|voix|audio|wav|mp3|cartesia|elevenlabs/i],
  ['image_vision', /\bimage\b|vision|janus|analyse d.image|tesseract|ocr|stable diffusion/i],
  ['video_generation', /\bvid[ée]o\b|comfyui|mochi|wan video|runcomfy|civitai/i],
  ['payments', /\bstripe\b|paypal|wero|abonnement|premium|fondateur|webhook|checkout/i],
  ['infra_runtime', /\bdocker\b|podman|render|hetzner|cloudflare|tunnel|ngrok|ssh|gpu|ollama/i],
  ['match_arena', /\bretroarch\b|romstation|roms?\b|match arena|noVNC|webrtc|manette|jeu local/i],
  ['agent_a11', /\ba11\b|alpha onze|alphaonze/i],
  ['agent_kaen44', /\bkaen44\b|\bk44\b/i],
  ['agent_vivy', /\bvivy\b/i],
];

function parseArgs(argv = []) {
  const out = {
    input: '',
    target: 'local',
    dryRun: false,
    exportId: DEFAULT_EXPORT_ID,
    batchSize: DEFAULT_BATCH_SIZE,
    chunkSize: DEFAULT_CHUNK_SIZE,
    previewSize: DEFAULT_PREVIEW_SIZE,
    limitConversations: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--input') out.input = argv[++i] || '';
    else if (arg === '--target') out.target = argv[++i] || 'local';
    else if (arg === '--export-id') out.exportId = argv[++i] || DEFAULT_EXPORT_ID;
    else if (arg === '--batch-size') out.batchSize = Math.max(1, Number(argv[++i] || DEFAULT_BATCH_SIZE));
    else if (arg === '--chunk-size') out.chunkSize = Math.max(500, Number(argv[++i] || DEFAULT_CHUNK_SIZE));
    else if (arg === '--preview-size') out.previewSize = Math.max(80, Number(argv[++i] || DEFAULT_PREVIEW_SIZE));
    else if (arg === '--limit') out.limitConversations = Math.max(0, Number(argv[++i] || 0));
  }
  if (!out.input) {
    out.input = process.env.CHATGPT_EXPORT_RAW_DIR || path.resolve('E:/Funesterie/corpus/chatgpt-export-2026-05-07/raw');
  }
  return out;
}

function sha256(value, length = 32) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function redactSensitiveText(text = '') {
  let out = String(text || '');
  let redactionCount = 0;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redactionCount += 1;
      return '[REDACTED]';
    });
  }
  return { text: out, redactionCount };
}

function normalizeWhitespace(text = '') {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function textFromContent(content = {}) {
  if (!content || typeof content !== 'object') return '';
  const out = [];
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (typeof part === 'string') out.push(part);
    else if (part && typeof part === 'object') {
      for (const key of ['text', 'caption', 'alt_text']) {
        if (typeof part[key] === 'string') out.push(part[key]);
      }
    }
  }
  if (typeof content.text === 'string') out.push(content.text);
  return normalizeWhitespace(out.join('\n'));
}

function classifyTagsFromText(text = '') {
  const tags = new Set();
  for (const [tag, pattern] of TAG_RULES) {
    if (pattern.test(text)) tags.add(tag);
  }
  return Array.from(tags).sort();
}

function toIsoFromSeconds(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return new Date(numeric * 1000).toISOString();
}

function buildChunks({ messageId, text, chunkSize }) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const chunkText = text.slice(offset, offset + chunkSize);
    chunks.push({
      id: `${messageId}:chunk:${chunks.length}`,
      messageId,
      index: chunks.length,
      offset,
      text: chunkText,
      sha256: sha256(chunkText, 40),
      length: chunkText.length,
    });
  }
  return chunks;
}

function collectMessages(conversation, options = {}) {
  const convId = String(conversation.id || conversation.conversation_id || '').trim();
  if (!convId) return [];
  const nodes = Object.values(conversation.mapping || {});
  const rows = [];
  for (const node of nodes) {
    const message = node?.message;
    if (!message || typeof message !== 'object') continue;
    const rawText = textFromContent(message.content || {});
    if (!rawText) continue;
    const { text, redactionCount } = redactSensitiveText(rawText);
    const author = message.author || {};
    const messageId = String(message.id || node.id || `${convId}:${rows.length}`).trim();
    const tags = classifyTagsFromText(`${conversation.title || ''}\n${text}`);
    rows.push({
      id: messageId,
      conversationId: convId,
      nodeId: String(node.id || ''),
      parentId: String(node.parent || ''),
      role: String(author.role || ''),
      authorName: String(author.name || ''),
      channel: String(message.channel || ''),
      recipient: String(message.recipient || ''),
      createTime: Number(message.create_time || 0),
      createIso: toIsoFromSeconds(message.create_time),
      status: String(message.status || ''),
      contentHash: sha256(rawText, 40),
      contentLength: rawText.length,
      contentPreview: text.slice(0, options.previewSize || DEFAULT_PREVIEW_SIZE),
      redactionCount,
      tags,
      chunks: buildChunks({ messageId, text, chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE }),
    });
  }
  rows.sort((left, right) => {
    const timeDiff = Number(left.createTime || 0) - Number(right.createTime || 0);
    if (timeDiff) return timeDiff;
    return left.id.localeCompare(right.id);
  });
  return rows.map((row, index) => ({ ...row, sequence: index }));
}

function readConversationFile(filePath, options = {}) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`Expected conversation array in ${filePath}`);

  const conversationRows = [];
  const messageRows = [];
  const chunkRows = [];
  const conversationTagLinks = [];
  const messageTagLinks = [];
  let totalRedactions = 0;

  for (const conversation of data) {
    const convId = String(conversation.id || conversation.conversation_id || '').trim();
    if (!convId) continue;
    const messages = collectMessages(conversation, options);
    const textForTags = [
      conversation.title || '',
      ...messages.map((message) => message.contentPreview),
    ].join('\n');
    const convTags = classifyTagsFromText(textForTags);
    conversationRows.push({
      id: convId,
      title: String(conversation.title || ''),
      sourceFile: path.basename(filePath),
      createTime: Number(conversation.create_time || 0),
      updateTime: Number(conversation.update_time || 0),
      createIso: toIsoFromSeconds(conversation.create_time),
      updateIso: toIsoFromSeconds(conversation.update_time),
      model: String(conversation.default_model_slug || ''),
      origin: String(conversation.conversation_origin || ''),
      templateId: String(conversation.conversation_template_id || ''),
      gizmoType: String(conversation.gizmo_type || ''),
      archived: conversation.is_archived === true,
      starred: conversation.is_starred === true,
      memoryScope: String(conversation.memory_scope || ''),
      messageCount: messages.length,
      tags: convTags,
    });
    for (const tag of convTags) conversationTagLinks.push({ conversationId: convId, tag });
    for (const message of messages) {
      totalRedactions += message.redactionCount;
      messageRows.push({
        id: message.id,
        conversationId: message.conversationId,
        nodeId: message.nodeId,
        parentId: message.parentId,
        role: message.role,
        authorName: message.authorName,
        channel: message.channel,
        recipient: message.recipient,
        createTime: message.createTime,
        createIso: message.createIso,
        status: message.status,
        contentHash: message.contentHash,
        contentLength: message.contentLength,
        contentPreview: message.contentPreview,
        redactionCount: message.redactionCount,
        sequence: message.sequence,
        tags: message.tags,
      });
      for (const tag of message.tags) messageTagLinks.push({ messageId: message.id, tag });
      chunkRows.push(...message.chunks);
    }
  }

  return {
    conversationRows,
    messageRows,
    chunkRows,
    conversationTagLinks,
    messageTagLinks,
    tags: Array.from(new Set([
      ...conversationTagLinks.map((link) => link.tag),
      ...messageTagLinks.map((link) => link.tag),
    ])).sort(),
    totalRedactions,
  };
}

function readAssetManifest(inputDir) {
  const manifestPath = path.join(inputDir, 'export_manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.export_files) ? manifest.export_files : [];
  return files.map((file) => {
    const filePath = String(file.path || '');
    const firstSlash = filePath.indexOf('/');
    const conversationId = firstSlash > 0 ? filePath.slice(0, firstSlash) : '';
    const mediaKind = /\baudio\//i.test(filePath) || /\.(wav|mp3|m4a|ogg)$/i.test(filePath)
      ? 'audio'
      : /\.(png|jpe?g|webp|gif)$/i.test(filePath)
        ? 'image'
        : /\.(mp4|mov|webm|mkv)$/i.test(filePath)
          ? 'video'
          : 'file';
    return {
      id: `asset:${sha256(filePath, 32)}`,
      path: filePath,
      conversationId,
      sizeBytes: Number(file.size_bytes || 0),
      mediaKind,
      extension: path.extname(filePath).slice(1).toLowerCase(),
    };
  });
}

function summarizeRead(reads = []) {
  return reads.reduce((acc, entry) => {
    acc.conversations += entry.conversationRows.length;
    acc.messages += entry.messageRows.length;
    acc.chunks += entry.chunkRows.length;
    acc.redactions += entry.totalRedactions;
    for (const tag of entry.tags) acc.tags.add(tag);
    return acc;
  }, { conversations: 0, messages: 0, chunks: 0, redactions: 0, tags: new Set() });
}

function resolveEndpoint(target) {
  loadRouterEnv();
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return config.aura;
  return config.local;
}

function createDriver(endpoint) {
  const auth = endpoint.auth === 'none'
    ? neo4j.auth.none()
    : neo4j.auth.basic(endpoint.username, endpoint.password);
  return neo4j.driver(endpoint.uri, auth, {
    connectionAcquisitionTimeout: 20000,
    maxConnectionPoolSize: 8,
    disableLosslessIntegers: true,
  });
}

async function runBatched(session, cypher, rows, batchSize, params = {}) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize).map((row) => sanitizePropertyMap(row));
    if (batch.length) await session.run(cypher, { ...params, rows: batch });
  }
}

async function ensureConstraints(session) {
  const constraints = [
    'CREATE CONSTRAINT chatgpt_export_id IF NOT EXISTS FOR (n:FunesterieChatGptExport) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT chatgpt_conversation_id IF NOT EXISTS FOR (n:FunesterieChatGptConversation) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT chatgpt_message_id IF NOT EXISTS FOR (n:FunesterieChatGptMessage) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT chatgpt_chunk_id IF NOT EXISTS FOR (n:FunesterieChatGptMessageChunk) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT chatgpt_asset_id IF NOT EXISTS FOR (n:FunesterieChatGptAsset) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT corpus_tag_id IF NOT EXISTS FOR (n:FunesterieCorpusTag) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);
}

async function syncToNeo4j(session, payload, options) {
  await ensureConstraints(session);
  const now = new Date().toISOString();

  await session.run(`
    MERGE (export:FunesterieChatGptExport {id: $id})
    SET export.label = $label,
        export.inputDir = $inputDir,
        export.updatedAt = $updatedAt,
        export.conversationFiles = $conversationFiles,
        export.assetCount = $assetCount,
        export.mode = 'local-private-corpus'
  `, {
    id: options.exportId,
    label: 'ChatGPT export 2026-05-07',
    inputDir: options.input,
    updatedAt: now,
    conversationFiles: payload.files,
    assetCount: payload.assets.length,
  });

  await runBatched(session, `
    UNWIND $rows AS row
    MERGE (tag:FunesterieCorpusTag {id: row.id})
    SET tag.label = row.label,
        tag.updatedAt = row.updatedAt
  `, payload.tags.map((tag) => ({ id: tag, label: tag, updatedAt: now })), options.batchSize);

  await runBatched(session, `
    UNWIND $rows AS row
    MERGE (conv:FunesterieChatGptConversation {id: row.id})
    SET conv += row,
        conv.updatedAt = $updatedAt
    WITH conv
    MATCH (export:FunesterieChatGptExport {id: $exportId})
    MERGE (export)-[:HAS_CONVERSATION]->(conv)
  `, payload.conversations, options.batchSize, {
    exportId: options.exportId,
    updatedAt: now,
  });

  await runBatched(session, `
    UNWIND $rows AS row
    MERGE (msg:FunesterieChatGptMessage {id: row.id})
    SET msg += row,
        msg.updatedAt = $updatedAt
    WITH msg, row
    MATCH (conv:FunesterieChatGptConversation {id: row.conversationId})
    MERGE (conv)-[:HAS_MESSAGE]->(msg)
  `, payload.messages, options.batchSize, {
    updatedAt: now,
  });

  await runBatched(session, `
    UNWIND $rows AS row
    MERGE (chunk:FunesterieChatGptMessageChunk {id: row.id})
    SET chunk += row,
        chunk.updatedAt = $updatedAt
    WITH chunk, row
    MATCH (msg:FunesterieChatGptMessage {id: row.messageId})
    MERGE (msg)-[:HAS_CHUNK]->(chunk)
  `, payload.chunks, options.batchSize, {
    updatedAt: now,
  });

  await runBatched(session, `
    UNWIND $rows AS row
    MATCH (conv:FunesterieChatGptConversation {id: row.conversationId})
    MATCH (tag:FunesterieCorpusTag {id: row.tag})
    MERGE (conv)-[:MENTIONS_TAG]->(tag)
  `, payload.conversationTagLinks, options.batchSize);

  await runBatched(session, `
    UNWIND $rows AS row
    MATCH (msg:FunesterieChatGptMessage {id: row.messageId})
    MATCH (tag:FunesterieCorpusTag {id: row.tag})
    MERGE (msg)-[:MENTIONS_TAG]->(tag)
  `, payload.messageTagLinks, options.batchSize);

  await runBatched(session, `
    UNWIND $rows AS row
    MERGE (asset:FunesterieChatGptAsset {id: row.id})
    SET asset += row,
        asset.updatedAt = $updatedAt
    WITH asset, row
    MATCH (export:FunesterieChatGptExport {id: $exportId})
    MERGE (export)-[:HAS_ASSET]->(asset)
    WITH asset, row
    OPTIONAL MATCH (conv:FunesterieChatGptConversation {id: row.conversationId})
    FOREACH (_ IN CASE WHEN conv IS NULL THEN [] ELSE [1] END |
      MERGE (conv)-[:HAS_ASSET]->(asset)
    )
  `, payload.assets, options.batchSize, {
    exportId: options.exportId,
    updatedAt: now,
  });
}

function readAll(options) {
  const input = path.resolve(options.input);
  const files = fs.readdirSync(input)
    .filter((name) => /^conversations-\d+\.json$/i.test(name))
    .sort()
    .map((name) => path.join(input, name));
  if (!files.length) throw new Error(`No conversations-*.json files found in ${input}`);

  const reads = [];
  let conversationBudget = options.limitConversations || 0;
  for (const file of files) {
    const read = readConversationFile(file, options);
    if (conversationBudget > 0 && read.conversationRows.length > conversationBudget) {
      const allowed = new Set(read.conversationRows.slice(0, conversationBudget).map((row) => row.id));
      read.conversationRows = read.conversationRows.filter((row) => allowed.has(row.id));
      read.messageRows = read.messageRows.filter((row) => allowed.has(row.conversationId));
      const messageIds = new Set(read.messageRows.map((row) => row.id));
      read.chunkRows = read.chunkRows.filter((row) => messageIds.has(row.messageId));
      read.conversationTagLinks = read.conversationTagLinks.filter((row) => allowed.has(row.conversationId));
      read.messageTagLinks = read.messageTagLinks.filter((row) => messageIds.has(row.messageId));
      reads.push(read);
      break;
    }
    reads.push(read);
    if (conversationBudget > 0) {
      conversationBudget -= read.conversationRows.length;
      if (conversationBudget <= 0) break;
    }
  }

  const summary = summarizeRead(reads);
  const payload = {
    files: files.map((file) => path.basename(file)),
    conversations: reads.flatMap((entry) => entry.conversationRows),
    messages: reads.flatMap((entry) => entry.messageRows),
    chunks: reads.flatMap((entry) => entry.chunkRows),
    conversationTagLinks: reads.flatMap((entry) => entry.conversationTagLinks),
    messageTagLinks: reads.flatMap((entry) => entry.messageTagLinks),
    tags: Array.from(summary.tags),
    redactions: summary.redactions,
    assets: readAssetManifest(input),
  };
  if (options.limitConversations > 0) {
    const allowedConversations = new Set(payload.conversations.map((row) => row.id));
    payload.assets = payload.assets.filter((asset) => !asset.conversationId || allowedConversations.has(asset.conversationId));
  }
  return payload;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = readAll(options);
  const summary = {
    ok: true,
    dryRun: options.dryRun,
    input: path.resolve(options.input),
    target: options.target,
    exportId: options.exportId,
    conversations: payload.conversations.length,
    messages: payload.messages.length,
    chunks: payload.chunks.length,
    tags: payload.tags,
    assets: payload.assets.length,
    redactions: payload.redactions,
  };

  if (options.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const endpoint = resolveEndpoint(options.target);
  const driver = createDriver(endpoint);
  const session = driver.session({
    database: endpoint.database,
    defaultAccessMode: neo4j.session.WRITE,
  });
  try {
    await driver.verifyConnectivity();
    await syncToNeo4j(session, payload, options);
    const verify = await session.run(`
      MATCH (export:FunesterieChatGptExport {id: $exportId})
      OPTIONAL MATCH (export)-[:HAS_CONVERSATION]->(conv:FunesterieChatGptConversation)
      OPTIONAL MATCH (conv)-[:HAS_MESSAGE]->(msg:FunesterieChatGptMessage)
      OPTIONAL MATCH (msg)-[:HAS_CHUNK]->(chunk:FunesterieChatGptMessageChunk)
      OPTIONAL MATCH (export)-[:HAS_ASSET]->(asset:FunesterieChatGptAsset)
      RETURN count(DISTINCT conv) AS conversations,
             count(DISTINCT msg) AS messages,
             count(DISTINCT chunk) AS chunks,
             count(DISTINCT asset) AS assets
    `, { exportId: options.exportId });
    const record = verify.records[0];
    console.log(JSON.stringify({
      ...summary,
      neo4j: {
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
        conversations: record.get('conversations'),
        messages: record.get('messages'),
        chunks: record.get('chunks'),
        assets: record.get('assets'),
      },
    }, null, 2));
  } finally {
    await session.close().catch(() => {});
    await driver.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error.code || error.name || 'ChatGptExportIndexError',
      message: String(error.message || error).slice(0, 300),
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  buildChunks,
  classifyTagsFromText,
  collectMessages,
  parseArgs,
  readAssetManifest,
  readConversationFile,
  redactSensitiveText,
  textFromContent,
};
