'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MEDIA_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.m4v',
  '.mp3',
  '.mp4',
  '.ogg',
  '.opus',
  '.png',
  '.wav',
  '.webm',
  '.webp',
]);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.opus']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'dist',
  'node_modules',
  'temp',
  'tmp',
  'virtual hard disks',
]);

const COMMON_STOP_WORDS = new Set([
  'avec',
  'aux',
  'ces',
  'des',
  'donc',
  'elle',
  'est',
  'etre',
  'faire',
  'faut',
  'ici',
  'ils',
  'les',
  'leur',
  'mais',
  'mes',
  'mon',
  'nous',
  'par',
  'pas',
  'plus',
  'pour',
  'que',
  'qui',
  'quoi',
  'sur',
  'tes',
  'tout',
  'tous',
  'une',
  'vous',
  'the',
  'and',
  'for',
  'from',
  'with',
  'this',
  'that',
]);

const CREATIVE_TERMS = [
  'a11',
  'clip',
  'creative',
  'edm',
  'funesterie',
  'image',
  'jeffrey',
  'kaen44',
  'media',
  'musique',
  'nossen',
  'scene',
  'son',
  'video',
  'vivy',
  'voix',
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    return safeJsonParse(fs.readFileSync(filePath, 'utf8'), fallback);
  } catch {
    return fallback;
  }
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(authorization|bearer|token|password|passwd|secret|api[_-]?key|access[_-]?key|refresh[_-]?token)\b\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/=_-]{72,}\b/g, '[redacted]');
}

function stringifyForTerms(value, maxChars = 1200) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, maxChars);
  try {
    return redactSensitiveText(JSON.stringify(value)).slice(0, maxChars);
  } catch {
    return '';
  }
}

function tokenize(value, options = {}) {
  const minLength = clampNumber(options.minLength, 3, 1, 20);
  const text = normalizeText(redactSensitiveText(value));
  return unique(
    (text.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])
      .map((word) => word.replace(/^[_-]+|[_-]+$/g, ''))
      .filter((word) => word.length >= minLength && !COMMON_STOP_WORDS.has(word))
  );
}

function termWeightsFromText(value, weight = 1, target = new Map()) {
  for (const term of tokenize(value)) {
    target.set(term, (target.get(term) || 0) + weight);
  }
  return target;
}

function boundedPush(list, value, maxItems) {
  const text = redactSensitiveText(String(value || '').trim());
  if (!text) return;
  if (list.length >= maxItems) return;
  list.push(text.slice(0, 500));
}

function resolveWorkspaceRoot(workspaceRoot) {
  return path.resolve(
    String(
      workspaceRoot
      || process.env.A11_WORKSPACE_ROOT
      || process.env.WORKSPACE_ROOT
      || path.resolve(__dirname, '..', '..', '..')
    ).trim()
  );
}

function resolveRuntimeRoot(runtimeRoot, workspaceRoot) {
  return path.resolve(
    String(
      runtimeRoot
      || process.env.A11_RUNTIME_ROOT
      || path.join(resolveWorkspaceRoot(workspaceRoot), 'runtime')
    ).trim()
  );
}

function buildServedUrl(filePath, roots) {
  const absolute = path.resolve(filePath);
  const runtimeRoot = roots.runtimeRoot ? path.resolve(roots.runtimeRoot) : '';
  const workspaceRoot = roots.workspaceRoot ? path.resolve(roots.workspaceRoot) : '';
  const normalizedAbsolute = process.platform === 'win32' ? absolute.toLowerCase() : absolute;

  if (runtimeRoot) {
    const normalizedRuntime = process.platform === 'win32' ? runtimeRoot.toLowerCase() : runtimeRoot;
    if (normalizedAbsolute === normalizedRuntime || normalizedAbsolute.startsWith(normalizedRuntime + path.sep)) {
      const rel = path.relative(runtimeRoot, absolute).replace(/\\/g, '/');
      return `/files/runtime/${encodeURI(rel).replace(/%2F/g, '/')}`;
    }
  }

  if (workspaceRoot) {
    const normalizedWorkspace = process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot;
    if (normalizedAbsolute === normalizedWorkspace || normalizedAbsolute.startsWith(normalizedWorkspace + path.sep)) {
      const rel = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
      return `/files/${encodeURI(rel).replace(/%2F/g, '/')}`;
    }
  }

  return '';
}

function mediaTypeFromExtension(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (AUDIO_EXTENSIONS.has(normalized)) return 'audio';
  if (VIDEO_EXTENSIONS.has(normalized)) return 'video';
  if (IMAGE_EXTENSIONS.has(normalized)) return 'image';
  return 'media';
}

function candidateText(candidate) {
  return [
    candidate.id,
    candidate.type,
    candidate.title,
    candidate.description,
    candidate.prompt,
    candidate.source,
    candidate.path,
    candidate.url,
    ...(Array.isArray(candidate.tags) ? candidate.tags : []),
    ...(Array.isArray(candidate.colors) ? candidate.colors : []),
    ...(Array.isArray(candidate.creativeSignals) ? candidate.creativeSignals : []),
  ].filter(Boolean).join(' ');
}

function createFileCandidate(filePath, roots, source, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) return null;
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) return null;
  const rel = roots.runtimeRoot && path.resolve(filePath).startsWith(path.resolve(roots.runtimeRoot))
    ? path.relative(roots.runtimeRoot, filePath).replace(/\\/g, '/')
    : roots.workspaceRoot && path.resolve(filePath).startsWith(path.resolve(roots.workspaceRoot))
      ? path.relative(roots.workspaceRoot, filePath).replace(/\\/g, '/')
      : path.basename(filePath);
  const title = path.basename(filePath, ext).replace(/[_-]+/g, ' ').trim();
  return {
    id: `file:${crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16)}`,
    type: mediaTypeFromExtension(ext),
    source,
    title,
    description: '',
    prompt: '',
    tags: tokenize(title).slice(0, 12),
    colors: [],
    url: buildServedUrl(filePath, roots),
    path: rel,
    localPath: options.includeLocalPath ? path.resolve(filePath) : undefined,
    sizeBytes: stats.size,
    createdAt: stats.birthtime?.toISOString?.() || stats.mtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
    creativeSignals: [source, ext.replace('.', '')],
  };
}

function scanMediaDirectory(root, roots, source, options = {}) {
  const absoluteRoot = path.resolve(String(root || ''));
  if (!absoluteRoot || !fs.existsSync(absoluteRoot)) return [];
  const maxDepth = clampNumber(options.maxDepth, 2, 0, 8);
  const maxItems = clampNumber(options.maxItems, 200, 1, 1000);
  const candidates = [];

  function walk(dir, depth) {
    if (candidates.length >= maxItems || depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (candidates.length >= maxItems) break;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(normalizeText(entry.name))) walk(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(ext)) continue;
      try {
        const candidate = createFileCandidate(entryPath, roots, source, options);
        if (candidate) candidates.push(candidate);
      } catch {
        // Ignore unreadable media entries.
      }
    }
  }

  walk(absoluteRoot, 0);
  return candidates;
}

function listVisionCandidates(runtimeRoot, options = {}) {
  const dir = path.join(runtimeRoot, 'vision-memory');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.vision.json'));
  const limit = clampNumber(options.maxVisionEntries, 240, 1, 1000);
  const entries = files
    .map((name) => readJsonFile(path.join(dir, name), null))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);

  return entries.map((entry) => {
    const vision = entry.vision && typeof entry.vision === 'object' ? entry.vision : {};
    const imagePath = String(entry.imagePath || '').trim();
    const url = String(entry.imageUrl || '').trim()
      || (imagePath ? `/files/runtime/${encodeURI(imagePath).replace(/%2F/g, '/')}` : '');
    return {
      id: `vision:${entry.imageId || entry.id || crypto.randomUUID()}`,
      type: 'image',
      source: `vision:${entry.source || 'unknown'}`,
      title: String(vision.subject || entry.prompt || entry.imageId || entry.id || 'image').slice(0, 160),
      description: String(vision.description || '').trim(),
      prompt: String(entry.prompt || '').trim(),
      tags: unique([
        ...(Array.isArray(vision.tags) ? vision.tags : []),
        vision.mood,
        vision.style,
      ].map((item) => String(item || '').trim()).filter(Boolean)),
      colors: Array.isArray(vision.colors) ? vision.colors : [],
      url,
      path: imagePath,
      localPath: options.includeLocalPath && imagePath ? path.join(runtimeRoot, imagePath) : undefined,
      createdAt: entry.createdAt || null,
      updatedAt: vision.analyzedAt || entry.createdAt || null,
      creativeSignals: ['vision', vision.mood, vision.style].filter(Boolean),
      raw: options.includeRaw ? entry : undefined,
    };
  });
}

function listVivyTrackCandidates(runtimeRoot) {
  const manifestPath = path.join(runtimeRoot, 'music', 'vivy-songs.json');
  const manifest = readJsonFile(manifestPath, null);
  const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
  return tracks
    .filter((track) => track && track.enabled !== false)
    .map((track, index) => ({
      id: `vivy-track:${crypto.createHash('sha1').update(`${track.title || index}:${track.audioUrl || ''}`).digest('hex').slice(0, 16)}`,
      type: 'audio',
      source: track.source || 'vivy',
      title: String(track.title || `Vivy track ${index + 1}`).trim(),
      description: String(track.description || track.artist || 'Vivy audio').trim(),
      prompt: '',
      tags: unique(['vivy', 'music', 'voice', ...(Array.isArray(track.tags) ? track.tags : [])]),
      colors: [],
      url: String(track.audioUrl || track.url || '').trim(),
      path: '',
      sizeBytes: null,
      durationMs: Number(track.durationMs || 0) || null,
      createdAt: track.createdAt || null,
      updatedAt: track.updatedAt || null,
      creativeSignals: ['vivy', 'voice', 'music', track.audioFormat].filter(Boolean),
      raw: undefined,
    }));
}

function collectMediaCandidates(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const runtimeRoot = resolveRuntimeRoot(options.runtimeRoot, workspaceRoot);
  const roots = { workspaceRoot, runtimeRoot };
  const candidates = [];

  candidates.push(...listVisionCandidates(runtimeRoot, options));
  candidates.push(...listVivyTrackCandidates(runtimeRoot));

  const parentRoot = path.resolve(workspaceRoot, '..');
  const scanRoots = [
    { root: path.join(runtimeRoot, 'music'), source: 'runtime:music', maxDepth: 1 },
    { root: path.join(runtimeRoot, 'voice-library'), source: 'runtime:voice-library', maxDepth: 1 },
    { root: path.join(runtimeRoot, 'files', 'generated'), source: 'runtime:generated', maxDepth: 4 },
    { root: path.join(runtimeRoot, 'files', 'uploads'), source: 'runtime:uploads', maxDepth: 3 },
    { root: path.join(runtimeRoot, 'Corpus'), source: 'runtime:corpus', maxDepth: 1 },
    { root: path.join(parentRoot, 'runtime', 'Corpus'), source: 'corpus', maxDepth: 1 },
  ];

  for (const entry of scanRoots) {
    candidates.push(...scanMediaDirectory(entry.root, roots, entry.source, {
      ...options,
      maxDepth: entry.maxDepth,
      maxItems: clampNumber(options.maxPerDirectory, 180, 10, 800),
    }));
  }

  const byId = new Map();
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

function collectConversationUserSnippets(memoryRoot, options = {}) {
  const snippets = [];
  const dir = path.join(memoryRoot, 'conversations');
  if (!fs.existsSync(dir)) return snippets;
  const maxFiles = clampNumber(options.maxConversationFiles, 6, 1, 40);
  const maxLinesPerFile = clampNumber(options.maxLinesPerConversationFile, 80, 1, 300);
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, filePath: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, maxFiles);

  for (const file of files) {
    let lines = [];
    try {
      lines = fs.readFileSync(file.filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLinesPerFile);
    } catch {
      continue;
    }
    for (const line of lines) {
      const parsed = safeJsonParse(line, null);
      const messages = Array.isArray(parsed?.request?.messages) ? parsed.request.messages : [];
      for (const msg of messages) {
        if (String(msg?.role || '').toLowerCase() === 'user') {
          boundedPush(snippets, msg.content, clampNumber(options.maxUserSnippets, 80, 1, 200));
        }
      }
    }
  }

  return snippets;
}

function collectVectorUserSnippets(runtimeRoot, options = {}) {
  const snippets = [];
  const dir = path.join(runtimeRoot, 'vector-memory');
  if (!fs.existsSync(dir)) return snippets;
  const maxFiles = clampNumber(options.maxVectorFiles, 10, 1, 50);
  const maxLinesPerFile = clampNumber(options.maxLinesPerVectorFile, 80, 1, 400);
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, filePath: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, maxFiles);

  for (const file of files) {
    let lines = [];
    try {
      lines = fs.readFileSync(file.filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLinesPerFile);
    } catch {
      continue;
    }
    for (const line of lines) {
      const parsed = safeJsonParse(line, null);
      boundedPush(snippets, parsed?.userMessage, clampNumber(options.maxUserSnippets, 80, 1, 200));
      boundedPush(snippets, parsed?.assistantMessage, clampNumber(options.maxUserSnippets, 80, 1, 200));
    }
  }

  return snippets;
}

function collectMemoSnippets(memoryRoot, options = {}) {
  const snippets = [];
  const dir = path.join(memoryRoot, 'memos');
  if (!fs.existsSync(dir)) return snippets;
  const maxFiles = clampNumber(options.maxMemoFiles, 60, 1, 200);
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, filePath: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, maxFiles);

  for (const file of files) {
    const memo = readJsonFile(file.filePath, null);
    if (!memo) continue;
    const type = String(memo.type || '').toLowerCase();
    if (type === 'env_snapshot') continue;
    boundedPush(snippets, stringifyForTerms(memo, 900), clampNumber(options.maxUserSnippets, 80, 1, 200));
  }

  return snippets;
}

function buildUserProfile(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const runtimeRoot = resolveRuntimeRoot(options.runtimeRoot, workspaceRoot);
  const memoryRoot = path.join(workspaceRoot, 'a11_memory');
  const snippets = [];
  const termWeights = new Map();

  const directBlocks = [
    options.query,
    options.creativeBrief,
    options.intent,
    options.mood,
    options.userId,
    stringifyForTerms(options.tags || []),
    stringifyForTerms(options.user || {}),
    stringifyForTerms(options.userInfo || {}),
    stringifyForTerms(options.userContext || {}),
  ];

  for (const block of directBlocks) {
    if (!block) continue;
    boundedPush(snippets, block, clampNumber(options.maxUserSnippets, 80, 1, 200));
    termWeightsFromText(block, 5, termWeights);
  }

  if (options.includeUserMemory !== false) {
    const memorySnippets = [
      ...collectConversationUserSnippets(memoryRoot, options),
      ...collectVectorUserSnippets(runtimeRoot, options),
      ...collectMemoSnippets(memoryRoot, options),
    ];
    for (const snippet of memorySnippets) {
      boundedPush(snippets, snippet, clampNumber(options.maxUserSnippets, 80, 1, 200));
      termWeightsFromText(snippet, 1, termWeights);
    }
  }

  for (const term of CREATIVE_TERMS) {
    termWeights.set(term, (termWeights.get(term) || 0) + 0.6);
  }

  const terms = [...termWeights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, clampNumber(options.maxProfileTerms, 80, 10, 240))
    .map(([term, weight]) => ({ term, weight: Number(weight.toFixed(3)) }));

  return {
    userId: String(options.userId || options.user?.id || '').trim() || null,
    terms,
    snippets: options.includeProfileSnippets ? snippets.slice(0, 20) : [],
    snippetCount: snippets.length,
    memoryRoot: fs.existsSync(memoryRoot) ? memoryRoot : null,
    sources: {
      direct: directBlocks.filter(Boolean).length,
      snippets: snippets.length,
    },
  };
}

function scoreCandidate(candidate, profile, options = {}) {
  const text = normalizeText(candidateText(candidate));
  const queryTerms = tokenize([options.query, options.creativeBrief, options.intent, options.mood].filter(Boolean).join(' '));
  const profileTerms = Array.isArray(profile?.terms) ? profile.terms : [];
  const matched = [];
  let score = 0;
  let queryScore = 0;
  let userScore = 0;
  let creativeScore = 0;

  for (const term of queryTerms) {
    if (text.includes(term)) {
      queryScore += 14;
      matched.push(term);
    }
  }

  for (const entry of profileTerms) {
    const term = String(entry.term || '').trim();
    if (!term || term.length < 3) continue;
    if (text.includes(term)) {
      const gain = Math.min(9, Math.max(0.4, Number(entry.weight || 1) * 0.9));
      userScore += gain;
      if (matched.length < 16) matched.push(term);
    }
  }

  for (const term of CREATIVE_TERMS) {
    if (text.includes(term)) creativeScore += 2.3;
  }

  if (candidate.type === 'audio' && /\b(vivy|voix|voice|song|music|musique|son|audio)\b/i.test(String(options.query || options.creativeBrief || ''))) {
    creativeScore += 8;
  }
  if (candidate.type === 'video' && /\b(clip|video|motion|scene)\b/i.test(String(options.query || options.creativeBrief || ''))) {
    creativeScore += 8;
  }
  if (candidate.type === 'image' && /\b(image|visuel|photo|style|scene)\b/i.test(String(options.query || options.creativeBrief || ''))) {
    creativeScore += 6;
  }

  const hasRichMetadata = candidate.description || candidate.prompt || (Array.isArray(candidate.tags) && candidate.tags.length);
  const metadataScore = hasRichMetadata ? 3 : 0;
  const urlScore = candidate.url ? 1.5 : 0;
  const recencyScore = (() => {
    const raw = candidate.updatedAt || candidate.createdAt;
    const ts = raw ? new Date(raw).getTime() : 0;
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    const ageDays = Math.max(0, (Date.now() - ts) / 86400000);
    return Math.max(0, 5 - Math.min(5, ageDays / 14));
  })();

  score = queryScore + userScore + creativeScore + metadataScore + urlScore + recencyScore;

  if (score <= 0) {
    score = 0.2 + metadataScore + urlScore;
  }

  return {
    score: Number(score.toFixed(4)),
    queryScore: Number(queryScore.toFixed(4)),
    userScore: Number(userScore.toFixed(4)),
    creativeScore: Number(creativeScore.toFixed(4)),
    matchedTerms: unique(matched).slice(0, 16),
  };
}

function seededUnit(seed, id) {
  const hash = crypto.createHash('sha256').update(`${seed}:${id}`).digest();
  const number = hash.readUInt32BE(0);
  return Math.max(0.000001, number / 0xffffffff);
}

function pickWeighted(candidates, limit, seed) {
  const pool = candidates.slice();
  const selected = [];
  while (pool.length && selected.length < limit) {
    const tickets = pool.map((entry) => {
      const weight = Math.max(0.001, Number(entry.score || 0.001));
      const draw = -Math.log(seededUnit(seed, `${entry.id}:${selected.length}`)) / weight;
      return { entry, draw };
    }).sort((a, b) => a.draw - b.draw);
    const winner = tickets[0]?.entry;
    if (!winner) break;
    selected.push(winner);
    const index = pool.findIndex((entry) => entry.id === winner.id);
    if (index >= 0) pool.splice(index, 1);
  }
  return selected;
}

function sanitizeCandidate(candidate, includeLocalPaths = false) {
  const copy = { ...candidate };
  if (!includeLocalPaths) delete copy.localPath;
  delete copy.raw;
  return copy;
}

function buildSemanticMediaRoulette(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const runtimeRoot = resolveRuntimeRoot(options.runtimeRoot, workspaceRoot);
  const seed = String(options.seed || `${Date.now()}:${options.query || ''}`).trim();
  const limit = clampNumber(options.limit, 8, 1, 50);
  const rankedLimit = clampNumber(options.rankedLimit || options.poolLimit, 40, limit, 200);
  const profile = buildUserProfile({ ...options, workspaceRoot, runtimeRoot });
  const media = collectMediaCandidates({
    ...options,
    workspaceRoot,
    runtimeRoot,
  });

  const scored = media.map((candidate) => {
    const score = scoreCandidate(candidate, profile, options);
    return {
      ...candidate,
      ...score,
    };
  }).sort((a, b) => b.score - a.score || String(a.title || '').localeCompare(String(b.title || '')));

  const pool = scored.slice(0, rankedLimit);
  const selected = options.randomize === false
    ? pool.slice(0, limit)
    : pickWeighted(pool, limit, seed).sort((a, b) => b.score - a.score);

  const includeLocalPaths = options.includeLocalPaths === true;
  return {
    ok: true,
    mode: 'semantic_media_roulette',
    query: String(options.query || '').trim(),
    seed,
    selected: selected.map((item) => sanitizeCandidate(item, includeLocalPaths)),
    ranked: pool.slice(0, rankedLimit).map((item) => sanitizeCandidate(item, includeLocalPaths)),
    profile: {
      userId: profile.userId,
      terms: profile.terms,
      snippets: profile.snippets,
      snippetCount: profile.snippetCount,
      sources: profile.sources,
    },
    sources: {
      runtimeRoot,
      workspaceRoot,
      mediaCount: media.length,
      rankedCount: pool.length,
      selectedCount: selected.length,
      byType: media.reduce((acc, item) => {
        const key = item.type || 'media';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

module.exports = {
  buildSemanticMediaRoulette,
  buildUserProfile,
  collectMediaCandidates,
  scoreCandidate,
  tokenize,
  redactSensitiveText,
  resolveRuntimeRoot,
  resolveWorkspaceRoot,
};
