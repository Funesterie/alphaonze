'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const REFERENCE_SCAN_BYTES = 512 * 1024;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vs', '.vscode-test',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'coverage', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.turbo', '.parcel-cache', '.pnpm-store',
  '.venv', 'venv', '__pycache__', '.pytest_cache',
  '.codex-tmp', 'tmp', 'temp', 'logs',
  'uploads', 'backups', 'neo4j-dumps',
]);

const SECRET_DIRECTORY_NAMES = new Set([
  'secrets', '.secrets', 'credentials', 'private-keys', 'keystores',
]);

const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.aac', '.aiff', '.apk', '.avi', '.bin', '.bmp', '.bz2',
  '.class', '.db', '.dll', '.dmg', '.doc', '.docx', '.eot', '.exe', '.flac',
  '.gif', '.gguf', '.gz', '.ico', '.iso', '.jar', '.jpeg', '.jpg', '.lib',
  '.lockb', '.m4a', '.m4v', '.mdb', '.mid', '.mkv', '.mov', '.mp3', '.mp4',
  '.msi', '.onnx', '.otf', '.p12', '.pdf', '.png', '.ppt', '.pptx', '.pyc',
  '.rar', '.safetensors', '.so', '.sqlite', '.sqlite3', '.tar', '.tflite',
  '.ttf', '.wav', '.webm', '.webp', '.whl', '.woff', '.woff2', '.xls', '.xlsx',
  '.xz', '.zip', '.zst', '.ckpt', '.pt', '.pth', '.engine', '.pack', '.pak',
  '.uasset', '.umap', '.asset', '.unitypackage',
]);

const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/i,
  /(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?)(?:[._-]|$)/i,
  /\.(?:key|pem|pfx|p12|jks|keystore)$/i,
  /^(?:\.npmrc|\.pypirc|\.netrc|auth\.json)$/i,
];

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  '.c': 'C', '.cc': 'C++', '.cpp': 'C++', '.cs': 'C#', '.css': 'CSS',
  '.cjs': 'JavaScript', '.go': 'Go', '.graphql': 'GraphQL', '.h': 'C/C++',
  '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript', '.json': 'JSON',
  '.jsonc': 'JSON', '.jsx': 'JavaScript', '.kt': 'Kotlin', '.lua': 'Lua',
  '.md': 'Markdown', '.mjs': 'JavaScript', '.ps1': 'PowerShell', '.py': 'Python',
  '.rb': 'Ruby', '.rs': 'Rust', '.scss': 'SCSS', '.sh': 'Shell', '.sql': 'SQL',
  '.toml': 'TOML', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.vue': 'Vue',
  '.xml': 'XML', '.yaml': 'YAML', '.yml': 'YAML', '.cypher': 'Cypher',
}));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function stableId(kind, rootId, relativePath = '') {
  return `${kind}:${rootId}:${sha256(normalizeRelativePath(relativePath).toLowerCase()).slice(0, 32)}`;
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'workspace';
}

function defaultRootId(rootPath) {
  const resolved = path.resolve(rootPath);
  return `${slug(path.basename(resolved))}-${sha256(resolved.toLowerCase()).slice(0, 12)}`;
}

function assertSafeWorkspaceRoot(rootPath) {
  const resolved = path.resolve(rootPath);
  const filesystemRoot = path.parse(resolved).root;
  const homeRoot = path.resolve(os.homedir());
  const normalized = resolved.replace(/\\+/g, '/').replace(/\/+$/g, '').toLowerCase();
  const broadRoots = new Set(['/home', '/srv', '/var', '/usr', '/opt', '/mnt', '/media']);
  const unsafeNames = new Set(['runtime', 'uploads', 'models', 'backups', 'secrets', 'node_modules']);

  if (resolved === filesystemRoot) throw new Error(`Refusing filesystem root as workspace: ${resolved}`);
  if (resolved.toLowerCase() === homeRoot.toLowerCase()) throw new Error(`Refusing home directory as workspace: ${resolved}`);
  if (broadRoots.has(normalized)) throw new Error(`Refusing broad system directory as workspace: ${resolved}`);
  if (unsafeNames.has(path.basename(resolved).toLowerCase())) {
    throw new Error(`Refusing runtime/data directory as workspace: ${resolved}`);
  }
  return resolved;
}

function runtimePrivateReason(normalized) {
  const lower = normalized.toLowerCase();
  if (/^runtime\//.test(lower)) return 'runtime-private';
  if (/^a11\/runtime\//.test(lower)) return 'runtime-private';
  if (/^a11\/backend\/runtime\//.test(lower)) return 'runtime-private';
  if (/^a11\/backend\/apps\/[^/]+\/runtime\//.test(lower)) return 'runtime-private';
  if (/(?:^|\/)runtime\/(?:private|uploads|sessions|cache)(?:\/|$)/.test(lower)) return 'runtime-private';
  if (/(?:^|\/)corpus\/private(?:\/|$)/.test(lower)) return 'runtime-private';
  return null;
}

function exclusionReason(relativePath, options = {}) {
  const raw = String(relativePath || '');
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return 'invalid-path';
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized.split('/').includes('..')) return 'invalid-path';

  const runtimeReason = runtimePrivateReason(normalized);
  if (runtimeReason && !options.includeRuntimeMetadata) return runtimeReason;

  const segments = normalized.split('/');
  const lowerSegments = segments.map((part) => part.toLowerCase());
  if (lowerSegments.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) return 'excluded-directory';
  if (lowerSegments.some((part) => SECRET_DIRECTORY_NAMES.has(part))) return 'secret-path';

  const fileName = segments.at(-1) || '';
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) return 'secret-file';
  const extension = path.extname(fileName).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return 'binary-or-model';
  return null;
}

function isProbablyBinary(buffer) {
  const limit = Math.min(buffer.length, 8192);
  if (!limit) return false;
  let suspicious = 0;
  for (let index = 0; index < limit; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / limit > 0.15;
}

function containsHighConfidenceSecret(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString('utf8');
  return HIGH_CONFIDENCE_SECRET_PATTERNS.some((pattern) => pattern.test(sample));
}

function countLines(buffer) {
  if (!buffer.length) return 0;
  let count = 1;
  for (const byte of buffer) if (byte === 10) count += 1;
  return count;
}

function inferDomains(relativePath) {
  const text = normalizeRelativePath(relativePath).toLowerCase();
  const domains = new Set();
  const add = (pattern, name) => { if (pattern.test(text)) domains.add(name); };
  add(/(?:audio|music|voice|tts|suno|acestep|vivy)/, 'audio-voice');
  add(/(?:^|\/)(?:video|media|comfy|wan|image)(?:\/|[._-])/, 'image-video');
  add(/(?:unity|unreal|game|gamedev|niagara)/, 'game-development');
  add(/(?:neo4j|memory|knowledge|corpus|graph)/, 'memory-knowledge');
  add(/(?:persona|holocron|identity)/, 'persona-identity');
  add(/(?:mcp|agent|router|orchestrat|qflush)/, 'agents-orchestration');
  add(/(?:deploy|docker|compose|caddy|cloudflare|hetzner|ops\/)/, 'operations');
  add(/(?:security|auth|oauth|scentgate|fortress)/, 'security');
  add(/(?:frontend|react|vite|public\/|\.css$|\.html$)/, 'frontend');
  add(/(?:backend|server|api|route)/, 'backend');
  add(/(?:docs?\/|research|\.md$)/, 'documentation-research');
  add(/(?:test|spec|fixture)/, 'testing');
  if (!domains.size) domains.add('workspace');
  return Array.from(domains).sort();
}

function extractReferenceCandidates(text, extension) {
  const references = [];
  const push = (kind, target) => {
    const clean = String(target || '').trim().replace(/[?#].*$/, '');
    if (!clean || clean.startsWith('#') || /^(?:[a-z]+:)?\/\//i.test(clean)) return;
    if (!clean.startsWith('.') && !clean.startsWith('/')) return;
    references.push({ kind, target: clean });
  };

  if (['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.vue'].includes(extension)) {
    const importPattern = /(?:from\s+|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g;
    for (const match of text.matchAll(importPattern)) push('code-import', match[1]);
  }
  if (extension === '.md' || extension === '.mdx') {
    const markdownPattern = /\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g;
    for (const match of text.matchAll(markdownPattern)) push('markdown-link', match[1]);
  }
  if (['.html', '.htm'].includes(extension)) {
    const htmlPattern = /(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi;
    for (const match of text.matchAll(htmlPattern)) push('html-link', match[1]);
  }
  return references.slice(0, 500);
}

function gitBuffer(rootPath, args) {
  try {
    return execFileSync('git', ['-C', rootPath, ...args], {
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function gitText(rootPath, args) {
  const result = gitBuffer(rootPath, args);
  return result ? result.toString('utf8').trim() : '';
}

function splitNull(buffer) {
  if (!buffer) return [];
  return buffer.toString('utf8').split('\0').map(normalizeRelativePath).filter(Boolean);
}

async function walkFallback(rootPath) {
  const out = [];
  async function visit(relativeDir) {
    const absoluteDir = path.join(rootPath, ...relativeDir.split('/').filter(Boolean));
    const entries = await fsp.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!exclusionReason(`${relativePath}/placeholder`)) await visit(relativePath);
      } else if (entry.isFile()) {
        out.push(relativePath);
      }
    }
  }
  await visit('');
  return out;
}

async function discoverPaths(rootPath) {
  const tracked = splitNull(gitBuffer(rootPath, ['ls-files', '-z', '--cached']));
  const visible = splitNull(gitBuffer(rootPath, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  if (visible.length || tracked.length) {
    return {
      source: 'git-ls-files',
      candidates: Array.from(new Set(visible.length ? visible : tracked)).sort(),
      tracked: new Set(tracked.map((item) => item.toLowerCase())),
    };
  }
  return {
    source: 'filesystem-walk',
    candidates: (await walkFallback(rootPath)).sort(),
    tracked: new Set(),
  };
}

function directoryRows(rootId, fileRows) {
  const paths = new Set(['.']);
  for (const file of fileRows) {
    let current = path.posix.dirname(file.relativePath);
    while (current && current !== '.') {
      paths.add(current);
      current = path.posix.dirname(current);
    }
  }
  return Array.from(paths).sort().map((relativePath) => ({
    id: stableId('workspace-directory', rootId, relativePath),
    rootId,
    relativePath,
    name: relativePath === '.' ? '.' : path.posix.basename(relativePath),
    parentId: relativePath === '.'
      ? null
      : stableId('workspace-directory', rootId, path.posix.dirname(relativePath)),
  }));
}

function resolveReference(sourceRelativePath, target, knownPaths) {
  if (!target || /^[A-Za-z]:[\\/]/.test(target)) return null;
  const base = target.startsWith('/')
    ? normalizeRelativePath(target)
    : normalizeRelativePath(path.posix.join(path.posix.dirname(sourceRelativePath), target));
  if (!base || base.startsWith('..')) return null;
  const candidates = [base];
  if (!path.posix.extname(base)) {
    for (const extension of ['.cjs', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.json', '.md']) {
      candidates.push(`${base}${extension}`);
      candidates.push(`${base}/index${extension}`);
    }
  }
  return candidates.find((candidate) => knownPaths.has(candidate.toLowerCase())) || null;
}

function topCounts(values, limit = 20) {
  const counts = new Map();
  for (const value of values) counts.set(value || '(none)', (counts.get(value || '(none)') || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

async function collectWorkspaceInventory(options = {}) {
  const rootPath = assertSafeWorkspaceRoot(options.rootPath || process.cwd());
  const rootStat = await fsp.stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error(`Workspace root is not a directory: ${rootPath}`);

  const rootId = options.rootId || defaultRootId(rootPath);
  const maxFileBytes = Math.max(1024, Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES);
  const maxFiles = Math.max(0, Number(options.maxFiles) || 0);
  const discovered = await discoverPaths(rootPath);
  const exclusions = new Map();
  const files = [];
  let bytesHashed = 0;
  const exclude = (reason) => exclusions.set(reason, (exclusions.get(reason) || 0) + 1);

  for (const relativePath of discovered.candidates) {
    if (maxFiles && files.length >= maxFiles) {
      exclude('max-files');
      continue;
    }
    const pathReason = exclusionReason(relativePath, options);
    if (pathReason) {
      exclude(pathReason);
      continue;
    }

    const absolutePath = path.resolve(rootPath, ...relativePath.split('/'));
    if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${path.sep}`)) {
      exclude('outside-root');
      continue;
    }

    let stat;
    try {
      stat = await fsp.lstat(absolutePath);
    } catch (_) {
      exclude('unreadable');
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      exclude('non-regular-file');
      continue;
    }
    if (stat.size > maxFileBytes) {
      exclude('oversize');
      continue;
    }

    let buffer;
    try {
      buffer = await fsp.readFile(absolutePath);
    } catch (_) {
      exclude('unreadable');
      continue;
    }
    if (isProbablyBinary(buffer)) {
      exclude('binary-content');
      continue;
    }
    if (containsHighConfidenceSecret(buffer)) {
      exclude('secret-content');
      continue;
    }

    const extension = path.extname(relativePath).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION.get(extension) || (extension ? extension.slice(1).toUpperCase() : 'Text');
    const textForReferences = buffer.length <= REFERENCE_SCAN_BYTES ? buffer.toString('utf8') : '';
    const references = textForReferences ? extractReferenceCandidates(textForReferences, extension) : [];
    const file = {
      id: stableId('workspace-file', rootId, relativePath),
      rootId,
      relativePath,
      name: path.posix.basename(relativePath),
      directoryId: stableId('workspace-directory', rootId, path.posix.dirname(relativePath)),
      extension: extension || '(none)',
      language,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: sha256(buffer),
      lineCount: countLines(buffer),
      gitTracked: discovered.tracked.has(relativePath.toLowerCase()),
      boundary: 'private-metadata',
      domains: inferDomains(relativePath),
      provenance: discovered.source,
      _references: references,
    };
    files.push(file);
    bytesHashed += buffer.length;
  }

  const knownPaths = new Map(files.map((file) => [file.relativePath.toLowerCase(), file]));
  const references = [];
  for (const file of files) {
    const seen = new Set();
    for (const candidate of file._references) {
      const targetPath = resolveReference(file.relativePath, candidate.target, knownPaths);
      if (!targetPath) continue;
      const target = knownPaths.get(targetPath.toLowerCase());
      const key = `${candidate.kind}:${target.id}`;
      if (seen.has(key) || target.id === file.id) continue;
      seen.add(key);
      references.push({ fromId: file.id, toId: target.id, kind: candidate.kind });
    }
    file.localReferenceCount = seen.size;
    delete file._references;
  }

  const directories = directoryRows(rootId, files);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const gitHead = gitText(rootPath, ['rev-parse', 'HEAD']);
  const gitBranch = gitText(rootPath, ['branch', '--show-current']);
  const gitDirty = Boolean(gitText(rootPath, ['status', '--porcelain', '--untracked-files=no']));
  const snapshotId = `workspace-snapshot:${rootId}:${generatedAt.replace(/[^0-9]/g, '').slice(0, 17)}`;

  return {
    schema: 'funesterie.workspace-file-index.v1',
    generatedAt,
    root: {
      id: rootId,
      name: path.basename(rootPath),
      pathHash: sha256(rootPath.toLowerCase()),
      discovery: discovered.source,
      gitHead: gitHead || null,
      gitBranch: gitBranch || null,
      gitDirty,
    },
    snapshot: { id: snapshotId, rootId, generatedAt },
    files,
    directories,
    references,
    metrics: {
      candidates: discovered.candidates.length,
      files: files.length,
      directories: directories.length,
      references: references.length,
      bytesHashed,
      trackedFiles: files.filter((file) => file.gitTracked).length,
      untrackedFiles: files.filter((file) => !file.gitTracked).length,
      exclusions: Array.from(exclusions.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, count]) => ({ reason, count })),
      languages: topCounts(files.map((file) => file.language)),
      extensions: topCounts(files.map((file) => file.extension)),
      domains: topCounts(files.flatMap((file) => file.domains)),
    },
  };
}

module.exports = {
  BINARY_EXTENSIONS,
  DEFAULT_MAX_FILE_BYTES,
  assertSafeWorkspaceRoot,
  collectWorkspaceInventory,
  containsHighConfidenceSecret,
  defaultRootId,
  exclusionReason,
  extractReferenceCandidates,
  inferDomains,
  isProbablyBinary,
  normalizeRelativePath,
  resolveReference,
  stableId,
};
