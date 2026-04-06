// apps/server/lib/a11-conv-history.cjs
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function resolveWorkspaceRoot() {
  const envCandidates = [
    process.env.A11_WORKSPACE_ROOT,
    process.env.WORKSPACE_ROOT,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of envCandidates) {
    return path.resolve(candidate);
  }

  const filesystemCandidates = [
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd(),
    path.resolve(__dirname, '..'),
  ];

  for (const candidate of filesystemCandidates) {
    if (fs.existsSync(path.join(candidate, 'a11_memory'))) {
      return candidate;
    }
  }

  return process.cwd();
}

const WORKSPACE = resolveWorkspaceRoot();
const CONV_ROOT = path.join(WORKSPACE, "a11_memory", "conversations");
const INDEX_PATH = path.join(CONV_ROOT, "conversations-index.json");

async function ensureDir() {
  await fsp.mkdir(CONV_ROOT, { recursive: true });
}

async function loadIndex() {
  try {
    const raw = await fsp.readFile(INDEX_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveIndex(index) {
  await ensureDir();
  await fsp.writeFile(
    INDEX_PATH,
    JSON.stringify(index, null, 2),
    "utf8"
  );
}

function generateId() {
  return new Date().toISOString().replace(/[:.]/g, "-") +
    "-" + Math.floor(Math.random() * 9999);
}

async function appendMessage({ conversationId, role, content, meta }) {
  await ensureDir();
  let index = await loadIndex();

  let conv = index.find(c => c.id === conversationId);
  if (!conv) {
    conversationId = conversationId || generateId();
    conv = {
      id: conversationId,
      title: (meta && meta.title) || content.slice(0, 40),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: meta && meta.tags || []
    };
    index.unshift(conv); // en haut de la liste
  } else {
    conv.updatedAt = new Date().toISOString();
  }

  await saveIndex(index);

  const line = JSON.stringify({
    role,
    content,
    ts: new Date().toISOString(),
    meta: meta || {}
  }) + "\n";

  const convPath = path.join(CONV_ROOT, `conv-${conv.id}.jsonl`);
  await fsp.appendFile(convPath, line, "utf8");

  return conv.id;
}

async function getConversationList() {
  return loadIndex();
}

async function getConversationMessages(id) {
  const convPath = path.join(CONV_ROOT, `conv-${id}.jsonl`);
  const raw = await fsp.readFile(convPath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

module.exports = {
  appendMessage,
  getConversationList,
  getConversationMessages,
};
