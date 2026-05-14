'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CODEX_ROLLOUT_RE = /^rollout-.*\.jsonl$/i;
const CHATGPT_EXPORT_RE = /^conversations\.json$/i;
const CHATGPT_INDEX_RE = /^conversation_index\.jsonl$/i;
const A11_CONVERSATION_RE = /^\d{8}\.jsonl$/i;

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').trim();
}

function truncateText(value, maxChars = 400) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(40, maxChars - 3)).trimEnd()}...`;
}

function normalizeIsoTimestamp(value, fallback = '') {
  if (value == null || value === '') return fallback || '';

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return fallback || '';

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw === String(numeric)) {
    return normalizeIsoTimestamp(numeric, fallback);
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return fallback || '';
}

function normalizeSourceList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDefaultArchiveSources() {
  const homeDir = String(process.env.USERPROFILE || os.homedir() || '').trim();
  if (!homeDir) return [];

  const sources = [
    path.join(homeDir, '.codex', 'sessions'),
  ];

  for (const folderName of ['Downloads', 'Documents', 'Desktop']) {
    const exportFile = path.join(homeDir, folderName, 'conversations.json');
    if (fs.existsSync(exportFile)) {
      sources.push(exportFile);
    }
  }

  return sources;
}

function resolveArchiveSources(options = {}) {
  const explicit = [
    ...normalizeSourceList(options.roots),
    ...normalizeSourceList(options.archiveRoots),
    ...normalizeSourceList(options.sources),
    ...normalizeSourceList(process.env.A11_CHAT_ARCHIVE_ROOTS),
    ...normalizeSourceList(process.env.A11_CHATGPT_ARCHIVE_ROOTS),
  ];

  const sources = explicit.length ? explicit : getDefaultArchiveSources();
  const seen = new Set();
  const resolved = [];

  for (const entry of sources) {
    const raw = String(entry || '').trim();
    if (!raw) continue;

    let absolute = raw;
    try {
      absolute = path.resolve(raw);
    } catch {
      continue;
    }

    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!fs.existsSync(absolute)) continue;
    resolved.push(absolute);
  }

  return resolved;
}

function isArchiveFileName(filename) {
  const name = String(filename || '').trim();
  return CODEX_ROLLOUT_RE.test(name)
    || CHATGPT_EXPORT_RE.test(name)
    || CHATGPT_INDEX_RE.test(name)
    || A11_CONVERSATION_RE.test(name);
}

function collectArchiveFiles(sources) {
  const files = [];
  const seen = new Set();

  function addFile(filePath) {
    const absolute = path.resolve(filePath);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(absolute);
  }

  for (const source of sources) {
    let stat;
    try {
      stat = fs.statSync(source);
    } catch {
      continue;
    }

    if (stat.isFile()) {
      if (isArchiveFileName(path.basename(source))) {
        addFile(source);
      }
      continue;
    }

    if (!stat.isDirectory()) continue;

    const pending = [source];
    while (pending.length) {
      const current = pending.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        if (entry.isFile() && isArchiveFileName(entry.name)) {
          addFile(fullPath);
        }
      }
    }
  }

  return files;
}

function readJsonLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractResponseItemText(content) {
  if (typeof content === 'string') return normalizeText(content);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim()) parts.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
    } else if (typeof item.output_text === 'string' && item.output_text.trim()) {
      parts.push(item.output_text.trim());
    }
  }
  return normalizeText(parts.join('\n'));
}

function buildTranscriptSummary(messages) {
  const firstUser = messages.find((entry) => entry.role === 'user' && entry.text);
  const lastAssistant = [...messages].reverse().find((entry) => entry.role === 'assistant' && entry.text);
  const pieces = [];
  if (firstUser?.text) pieces.push(firstUser.text);
  if (lastAssistant?.text && lastAssistant.text !== firstUser?.text) pieces.push(lastAssistant.text);
  return truncateText(pieces.join(' | '), 400);
}

function parseCodexRolloutArchive(filePath) {
  const entries = readJsonLines(filePath);
  const stat = fs.statSync(filePath);
  const messages = [];
  let sessionId = '';
  let createdAt = '';
  let updatedAt = normalizeIsoTimestamp(stat.mtime, new Date(stat.mtime).toISOString());
  let cwd = '';
  let title = '';

  for (const entry of entries) {
    const timestamp = normalizeIsoTimestamp(entry?.timestamp);
    if (timestamp) updatedAt = timestamp;

    if (entry?.type === 'session_meta' && entry.payload && typeof entry.payload === 'object') {
      sessionId = String(entry.payload.id || sessionId || '').trim() || sessionId;
      createdAt = normalizeIsoTimestamp(entry.payload.timestamp, createdAt) || createdAt;
      cwd = String(entry.payload.cwd || cwd || '').trim() || cwd;
      continue;
    }

    if (entry?.type === 'event_msg' && entry.payload && typeof entry.payload === 'object') {
      const payloadType = String(entry.payload.type || '').trim();
      if (payloadType === 'thread_name_updated') {
        title = String(entry.payload.thread_name || title || '').trim() || title;
        continue;
      }
      if (payloadType === 'user_message') {
        const text = normalizeText(entry.payload.message);
        if (text) {
          messages.push({
            role: 'user',
            phase: null,
            timestamp,
            text,
          });
        }
        continue;
      }
      if (payloadType === 'agent_message') {
        const text = normalizeText(entry.payload.message);
        if (text) {
          messages.push({
            role: 'assistant',
            phase: String(entry.payload.phase || '').trim() || null,
            timestamp,
            text,
          });
        }
        continue;
      }
    }
  }

  if (!messages.length) {
    for (const entry of entries) {
      if (entry?.type !== 'response_item' || !entry.payload || typeof entry.payload !== 'object') continue;
      if (entry.payload.type !== 'message') continue;
      const role = String(entry.payload.role || '').trim();
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractResponseItemText(entry.payload.content);
      if (!text) continue;
      messages.push({
        role,
        phase: String(entry.payload.phase || '').trim() || null,
        timestamp: normalizeIsoTimestamp(entry.timestamp),
        text,
      });
    }
  }

  if (!title) {
    title = sessionId
      ? `Session ${sessionId}`
      : path.basename(filePath, path.extname(filePath));
  }

  if (!createdAt) {
    createdAt = messages[0]?.timestamp || normalizeIsoTimestamp(stat.birthtime, updatedAt) || updatedAt;
  }

  const archiveId = `codex:${sessionId || path.basename(filePath)}`;
  return {
    source: 'codex_rollout',
    archiveId,
    sessionId: sessionId || path.basename(filePath),
    conversationId: null,
    title,
    createdAt,
    updatedAt,
    cwd,
    file: filePath,
    summary: buildTranscriptSummary(messages),
    messageCount: messages.length,
    messages,
  };
}

function extractChatGptConversationMessages(conversation) {
  const mapping = conversation && typeof conversation.mapping === 'object' ? conversation.mapping : {};
  const items = [];

  for (const node of Object.values(mapping)) {
    const message = node && typeof node === 'object' ? node.message : null;
    if (!message || typeof message !== 'object') continue;
    const role = String(message.author?.role || '').trim();
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;

    const parts = Array.isArray(message.content?.parts)
      ? message.content.parts
      : Array.isArray(message.content)
        ? message.content
        : [];
    const text = normalizeText(parts.filter((part) => typeof part === 'string').join('\n'));
    if (!text) continue;

    items.push({
      role,
      phase: null,
      timestamp: normalizeIsoTimestamp(message.create_time || node.create_time),
      text,
    });
  }

  items.sort((left, right) => {
    const leftTime = Date.parse(left.timestamp || '') || 0;
    const rightTime = Date.parse(right.timestamp || '') || 0;
    return leftTime - rightTime;
  });

  return items;
}

function parseChatGptExportFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const conversations = JSON.parse(raw);
  if (!Array.isArray(conversations)) return [];

  return conversations.map((conversation) => {
    const messages = extractChatGptConversationMessages(conversation);
    const createdAt = normalizeIsoTimestamp(
      conversation?.create_time,
      messages[0]?.timestamp || normalizeIsoTimestamp(stat.birthtime)
    );
    const updatedAt = normalizeIsoTimestamp(
      conversation?.update_time,
      messages[messages.length - 1]?.timestamp || normalizeIsoTimestamp(stat.mtime, new Date(stat.mtime).toISOString())
    );
    const conversationId = String(conversation?.id || '').trim() || path.basename(filePath);

    return {
      source: 'chatgpt_export',
      archiveId: `chatgpt:${conversationId}`,
      sessionId: null,
      conversationId,
      title: String(conversation?.title || `Conversation ${conversationId}`).trim(),
      createdAt,
      updatedAt,
      cwd: '',
      file: filePath,
      summary: buildTranscriptSummary(messages),
      messageCount: messages.length,
      messages,
    };
  });
}

function parseChatGptIndexFile(filePath) {
  const entries = readJsonLines(filePath);
  const stat = fs.statSync(filePath);

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const conversationId = String(entry.id || entry.conversationId || '').trim()
        || `${path.basename(filePath)}:${cryptoSafeHash(JSON.stringify(entry).slice(0, 500))}`;
      const createdAt = normalizeIsoTimestamp(entry.created || entry.createdAt, normalizeIsoTimestamp(stat.birthtime));
      const updatedAt = normalizeIsoTimestamp(
        entry.updated || entry.updatedAt,
        normalizeIsoTimestamp(stat.mtime, new Date(stat.mtime).toISOString())
      );
      const summaryParts = [
        entry.hint,
        Array.isArray(entry.themes) ? `themes: ${entry.themes.join(', ')}` : '',
        Array.isArray(entry.modules) ? `modules: ${entry.modules.join(', ')}` : '',
      ].filter(Boolean);
      const messages = summaryParts.length
        ? [{
            role: 'system',
            phase: 'indexed-summary',
            timestamp: updatedAt,
            text: normalizeText(summaryParts.join('\n')),
          }]
        : [];

      return {
        source: 'chatgpt_index',
        archiveId: `chatgpt-index:${conversationId}`,
        sessionId: null,
        conversationId,
        title: String(entry.title || `Conversation ${conversationId}`).trim(),
        createdAt,
        updatedAt,
        cwd: '',
        file: filePath,
        summary: truncateText(summaryParts.join(' | ') || String(entry.title || ''), 400),
        messageCount: Number(entry.message_count || entry.messageCount || messages.length || 0),
        messages,
      };
    });
}

function cryptoSafeHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function parseA11ConversationFile(filePath) {
  const entries = readJsonLines(filePath);
  const stat = fs.statSync(filePath);
  const messagesById = new Map();
  let conversationId = '';
  let createdAt = '';
  let updatedAt = normalizeIsoTimestamp(stat.mtime, new Date(stat.mtime).toISOString());

  function addMessage(message = {}, fallbackTimestamp = '') {
    const role = String(message.role || '').trim();
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return;
    const text = normalizeText(message.content || message.text || message.message || '');
    if (!text) return;
    const timestamp = normalizeIsoTimestamp(message.ts || message.timestamp, fallbackTimestamp);
    const id = String(message.id || `${role}:${timestamp}:${cryptoSafeHash(text.slice(0, 160))}`).trim();
    if (messagesById.has(id)) return;
    messagesById.set(id, {
      role,
      phase: null,
      timestamp,
      text,
    });
    if (!createdAt && timestamp) createdAt = timestamp;
    if (timestamp) updatedAt = timestamp;
  }

  for (const entry of entries) {
    const entryTimestamp = normalizeIsoTimestamp(entry?.ts || entry?.timestamp);
    if (entryTimestamp) updatedAt = entryTimestamp;
    conversationId = String(entry?.conversationId || entry?.request?.conversationId || conversationId || '').trim() || conversationId;

    if (Array.isArray(entry?.request?.messages)) {
      for (const message of entry.request.messages) addMessage(message, entryTimestamp);
    }
    if (entry?.response && typeof entry.response === 'object') {
      addMessage({ role: 'assistant', content: entry.response.content || entry.response.text, ts: entryTimestamp }, entryTimestamp);
    }
  }

  const messages = [...messagesById.values()].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp || '') || 0;
    const rightTime = Date.parse(right.timestamp || '') || 0;
    return leftTime - rightTime;
  });

  if (!createdAt) {
    createdAt = messages[0]?.timestamp || normalizeIsoTimestamp(stat.birthtime, updatedAt) || updatedAt;
  }
  if (!conversationId) {
    conversationId = path.basename(filePath, path.extname(filePath));
  }

  return {
    source: 'a11_conversation_jsonl',
    archiveId: `a11-conv:${conversationId}:${path.basename(filePath, path.extname(filePath))}`,
    sessionId: null,
    conversationId,
    title: `A11 conversation ${conversationId}`,
    createdAt,
    updatedAt,
    cwd: '',
    file: filePath,
    summary: buildTranscriptSummary(messages),
    messageCount: messages.length,
    messages,
  };
}

function matchesArchiveQuery(item, query) {
  const needle = normalizeText(query).toLowerCase();
  if (!needle) return true;

  const haystack = [
    item.title,
    item.summary,
    item.cwd,
    item.sessionId,
    item.conversationId,
    ...item.messages.map((entry) => entry.text),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return haystack.includes(needle);
}

function sortArchivesByRecentFirst(items) {
  return [...items].sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
    const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

function cloneArchiveItem(item, { includeMessages = false, maxMessages = 80 } = {}) {
  const cloned = {
    source: item.source,
    archiveId: item.archiveId,
    sessionId: item.sessionId || null,
    conversationId: item.conversationId || null,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    cwd: item.cwd,
    file: item.file,
    summary: item.summary,
    messageCount: Number(item.messageCount || 0),
  };

  if (includeMessages) {
    cloned.messages = item.messages.slice(0, Math.max(1, Number(maxMessages || 80))).map((entry) => ({
      role: entry.role,
      phase: entry.phase || null,
      timestamp: entry.timestamp || '',
      text: entry.text,
    }));
  }

  return cloned;
}

function loadAllArchiveItems(options = {}) {
  const sources = resolveArchiveSources(options);
  const files = collectArchiveFiles(sources);
  const items = [];

  for (const filePath of files) {
    try {
      if (CODEX_ROLLOUT_RE.test(path.basename(filePath))) {
        items.push(parseCodexRolloutArchive(filePath));
        continue;
      }
      if (CHATGPT_EXPORT_RE.test(path.basename(filePath))) {
        items.push(...parseChatGptExportFile(filePath));
        continue;
      }
      if (CHATGPT_INDEX_RE.test(path.basename(filePath))) {
        items.push(...parseChatGptIndexFile(filePath));
        continue;
      }
      if (A11_CONVERSATION_RE.test(path.basename(filePath))) {
        items.push(parseA11ConversationFile(filePath));
      }
    } catch {
      // Skip invalid archive files so one bad export does not block the rest.
    }
  }

  return sortArchivesByRecentFirst(items);
}

async function listConversationArchives(options = {}) {
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(200, Number(options.limit || 25)));
  const items = loadAllArchiveItems(options);
  const filtered = items.filter((item) => matchesArchiveQuery(item, query));

  return {
    ok: true,
    total: items.length,
    filtered: filtered.length,
    items: filtered.slice(0, limit).map((item) => cloneArchiveItem(item, options)),
  };
}

async function readConversationArchive(options = {}) {
  const archiveId = String(options.archiveId || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  const conversationId = String(options.conversationId || '').trim();
  const filePath = String(options.file || options.path || '').trim();
  const maxMessages = Math.max(1, Math.min(500, Number(options.maxMessages || 160)));

  const items = loadAllArchiveItems(options);
  const normalizedFile = filePath ? path.resolve(filePath) : '';

  const match = items.find((item) => {
    if (archiveId && item.archiveId === archiveId) return true;
    if (sessionId && item.sessionId === sessionId) return true;
    if (conversationId && item.conversationId === conversationId) return true;
    if (normalizedFile && path.resolve(item.file) === normalizedFile) return true;
    return false;
  });

  if (!match) {
    return {
      ok: false,
      error: 'archive_not_found',
    };
  }

  return {
    ok: true,
    ...cloneArchiveItem(match, { includeMessages: true, maxMessages }),
  };
}

module.exports = {
  listConversationArchives,
  readConversationArchive,
  resolveArchiveSources,
};
