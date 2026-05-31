#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.join(REPO_ROOT, 'a11', 'backend', 'apps', 'server');
const SIBLING_MAIN_ROOT = path.resolve(path.dirname(REPO_ROOT), 'funesterie');
const DEFAULT_CONFIG = path.join(__dirname, 'nossen-sources.example.json');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runtime', 'nossen', 'source-index');
const DEFAULT_SCOPE_ID = 'nossen-source-index';
const DEFAULT_HASH_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_PREVIEW_MAX_BYTES = 64 * 1024;

const DEFAULT_EXCLUDED_DIRS = new Set([
  '$RECYCLE.BIN',
  '.cache',
  '.codex-tmp',
  '.git',
  '.idea',
  '.jfrog',
  '.next',
  '.nuxt',
  '.pnpm-store',
  '.turbo',
  '.venv',
  '.vscode',
  'AppData',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'Program Files',
  'Program Files (x86)',
  'System Volume Information',
  'Temp',
  'tmp',
  'venv',
  'Windows',
]);

const SECRET_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])[^\\/]*\.env(\.|$)/i,
  /(^|[\\/])\.npmrc(\.|$)/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])client_secret[^\\/]*\.json$/i,
  /(^|[\\/])pass\.txt$/i,
  /(^|[\\/])bucket\.txt$/i,
  /(^|[\\/])jfrog.*token.*\.txt$/i,
  /(^|[\\/])a11npm\.txt$/i,
  /(^|[\\/])id_rsa$/i,
  /(^|[\\/])id_ed25519$/i,
  /\.(pem|p12|pfx|key)$/i,
  /(password|passwd|secret|token|credential|private[_-]?key)/i,
];

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.ps1',
  '.py',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const CATEGORY_BY_EXTENSION = new Map([
  ['.aac', 'audio'],
  ['.avi', 'video'],
  ['.cjs', 'code'],
  ['.css', 'code'],
  ['.csv', 'data'],
  ['.doc', 'document'],
  ['.docx', 'document'],
  ['.flac', 'audio'],
  ['.gif', 'image'],
  ['.html', 'code'],
  ['.jpeg', 'image'],
  ['.jpg', 'image'],
  ['.js', 'code'],
  ['.json', 'data'],
  ['.jsx', 'code'],
  ['.m4a', 'audio'],
  ['.md', 'document'],
  ['.mjs', 'code'],
  ['.mov', 'video'],
  ['.mp3', 'audio'],
  ['.mp4', 'video'],
  ['.pdf', 'document'],
  ['.png', 'image'],
  ['.ps1', 'code'],
  ['.py', 'code'],
  ['.sql', 'code'],
  ['.svg', 'image'],
  ['.toml', 'config'],
  ['.ts', 'code'],
  ['.tsx', 'code'],
  ['.txt', 'document'],
  ['.wav', 'audio'],
  ['.webm', 'video'],
  ['.webp', 'image'],
  ['.xml', 'data'],
  ['.yaml', 'config'],
  ['.yml', 'config'],
  ['.zip', 'archive'],
]);

const IMPORT_CONSTRAINTS = [
  'CREATE CONSTRAINT nossen_source_index_id IF NOT EXISTS FOR (n:NossenSourceIndex) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT nossen_source_root_id IF NOT EXISTS FOR (n:NossenSourceRoot) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT nossen_source_entry_id IF NOT EXISTS FOR (n:NossenSourceEntry) REQUIRE n.id IS UNIQUE',
];

const IMPORT_SCOPE_CYPHER = `
CREATE CONSTRAINT nossen_source_index_id IF NOT EXISTS FOR (n:NossenSourceIndex) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT nossen_source_root_id IF NOT EXISTS FOR (n:NossenSourceRoot) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT nossen_source_entry_id IF NOT EXISTS FOR (n:NossenSourceEntry) REQUIRE n.id IS UNIQUE;

${scopeCypher().trim()}
`;

const IMPORT_SCOPE_RUN_CYPHER = scopeCypher();

function scopeCypher() {
  return `
MERGE (scope:FunesterieEcosystemNode:NossenSourceIndex {id: $scope.id})
SET scope += $scope,
    scope.updatedAt = $now
WITH scope
UNWIND $roots AS root
MERGE (r:FunesterieEcosystemNode:NossenSourceRoot {id: root.id})
SET r += root,
    r.updatedAt = $now
MERGE (scope)-[link:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'indexes-source-root',
  source: 'nossen-source-index',
  targetId: root.id
}]->(r)
SET link.label = root.label,
    link.updatedAt = $now
RETURN count(DISTINCT r) AS roots
`;
}

const IMPORT_ENTRIES_CYPHER = `
UNWIND $entries AS entry
MATCH (root:NossenSourceRoot {id: entry.rootId})
MERGE (e:FunesterieEcosystemNode:NossenSourceEntry {id: entry.id})
SET e += entry,
    e.updatedAt = $now
MERGE (root)-[link:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'contains-source-entry',
  source: 'nossen-source-index',
  targetId: entry.id
}]->(e)
SET link.label = entry.label,
    link.updatedAt = $now
RETURN count(DISTINCT e) AS entries
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(args);
  const manifest = scanSources(config, args);
  const outFiles = writeManifestFiles(manifest, args);

  let sync = null;
  if (args.sync) {
    for (const workspaceRoot of resolveWorkspaceRoots()) {
      loadEnvIfExists(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env.local'), false);
      loadEnvIfExists(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env'), false);
      loadEnvIfExists(path.join(workspaceRoot, 'a11mcp', '.env'), false);
    }
    sync = await syncNeo4j(manifest, args.target || 'aura');
  }

  const summary = {
    ok: manifest.errors.length === 0 && (!sync || sync.ok),
    dryRun: !args.sync,
    scopeId: manifest.scope.id,
    generatedAt: manifest.generatedAt,
    roots: manifest.roots.length,
    entries: manifest.entries.length,
    files: outFiles,
    stats: manifest.stats,
    errors: manifest.errors,
    sync,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {
    config: '',
    roots: [],
    maxEntries: 1000,
    maxDepth: 8,
    hashMaxBytes: DEFAULT_HASH_MAX_BYTES,
    includePreview: false,
    outDir: DEFAULT_OUT_DIR,
    sync: false,
    target: 'aura',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--config') args.config = next();
    else if (arg === '--root' || arg === '--roots') args.roots.push(...splitRoots(next()));
    else if (arg === '--out-dir') args.outDir = path.resolve(next());
    else if (arg === '--max-entries') args.maxEntries = toPositiveInt(next(), args.maxEntries);
    else if (arg === '--max-depth') args.maxDepth = toPositiveInt(next(), args.maxDepth);
    else if (arg === '--hash-max-bytes') args.hashMaxBytes = toPositiveInt(next(), args.hashMaxBytes);
    else if (arg === '--include-preview') args.includePreview = true;
    else if (arg === '--sync') args.sync = true;
    else if (arg === '--target') args.target = String(next() || 'aura').toLowerCase();
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    else args.roots.push(...splitRoots(arg));
  }

  if (!['aura', 'local', 'both'].includes(args.target)) {
    throw new Error('--target must be aura, local, or both');
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
NOSSEN source index

Usage:
  node scripts/nossen/nossen-source-index.cjs --root D:\\projets\\funesterie
  node scripts/nossen/nossen-source-index.cjs --config scripts/nossen/nossen-sources.example.json --sync --target aura

Options:
  --config <file>          JSON config with roots and exclusions.
  --root <path>            Root to scan. Can be repeated or separated with ;.
  --out-dir <path>         Output directory. Defaults to runtime/nossen/source-index.
  --max-entries <n>        Max entries across all roots. Default: 1000.
  --max-depth <n>          Max directory depth. Default: 8.
  --hash-max-bytes <n>     Hash files up to this size. Default: 16777216.
  --include-preview        Store redacted preview for small text files.
  --sync                   Write metadata to Neo4j.
  --target <aura|local|both> Neo4j target when --sync is used. Default: aura.

Safety:
  Secret-looking files are skipped. The index stores metadata, not file bytes.
`);
}

function loadConfig(args) {
  const configPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const base = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : { version: 1, roots: [] };

  if (args.roots.length > 0) {
    base.roots = args.roots.map((rootPath, index) => {
      const resolved = path.resolve(expandEnv(rootPath));
      return {
        id: `nossen-root-${hashText(normalizePath(resolved).toLowerCase(), 16)}`,
        label: path.basename(resolved) || `Root ${index + 1}`,
        path: rootPath,
        kind: 'manual-root',
        privacy: 'private',
        enabled: true,
      };
    });
  }

  return {
    version: base.version || 1,
    scopeId: base.scopeId || DEFAULT_SCOPE_ID,
    label: base.label || 'NOSSEN source index',
    defaultPrivacy: base.defaultPrivacy || 'private',
    roots: Array.isArray(base.roots) ? base.roots : [],
    excludeDirectories: [
      ...DEFAULT_EXCLUDED_DIRS,
      ...((base.excludeDirectories || []).map(String)),
    ],
    excludePatterns: [
      ...SECRET_PATTERNS,
      ...((base.excludePatterns || []).map((pattern) => new RegExp(pattern, 'i'))),
    ],
  };
}

function scanSources(config, args) {
  const generatedAt = new Date().toISOString();
  const enabledRoots = config.roots.filter((root) => root.enabled !== false);
  const manifest = {
    version: 1,
    kind: 'nossen-source-index',
    generatedAt,
    scope: cleanProps({
      id: config.scopeId,
      kind: 'nossen-source-index',
      label: config.label,
      name: 'NOSSEN Source Index',
      summary: 'Metadata bridge between authorized local/cloud roots and the Funesterie graph.',
      mode: 'metadata-only',
      schema: 'nossen-source-index/v1',
      updatedAt: generatedAt,
      generatedAt,
    }),
    options: {
      maxEntries: args.maxEntries,
      maxDepth: args.maxDepth,
      hashMaxBytes: args.hashMaxBytes,
      includePreview: args.includePreview,
    },
    roots: [],
    entries: [],
    errors: [],
    stats: {
      scannedRoots: 0,
      skippedRoots: 0,
      skippedEntries: 0,
      skippedLinks: 0,
      skippedCycles: 0,
      skippedSecrets: 0,
      skippedTooDeep: 0,
      hashedFiles: 0,
      tooLargeToHash: 0,
    },
  };

  const excludeDirectoryNames = new Set(config.excludeDirectories.map((name) => normalizePath(name).toLowerCase()));
  for (const root of enabledRoots) {
    if (manifest.entries.length >= args.maxEntries) break;
    const rootPath = path.resolve(expandEnv(String(root.path || '')));
    if (!rootPath || !fs.existsSync(rootPath)) {
      manifest.errors.push({ root: root.id || root.path, message: `Root not found: ${rootPath}` });
      manifest.stats.skippedRoots += 1;
      continue;
    }

    const resolved = fs.realpathSync.native(rootPath);
    const rootId = safeId(root.id || `root:${hashText(normalizePath(resolved), 16)}`);
    const rootNode = cleanProps({
      id: rootId,
      kind: root.kind || 'source-root',
      label: root.label || path.basename(resolved) || resolved,
      name: root.label || path.basename(resolved) || resolved,
      path: resolved,
      normalizedPath: normalizePath(resolved),
      privacy: root.privacy || config.defaultPrivacy,
      status: 'indexed',
      source: 'nossen-source-index',
      updatedAt: generatedAt,
      lastSeenAt: generatedAt,
    });
    manifest.roots.push(rootNode);
    manifest.stats.scannedRoots += 1;

    scanRoot({
      rootNode,
      rootPath: resolved,
      rootConfig: root,
      manifest,
      args,
      excludeDirectoryNames,
      excludePatterns: config.excludePatterns,
      defaultPrivacy: config.defaultPrivacy,
      generatedAt,
    });
  }

  manifest.stats.files = manifest.entries.filter((entry) => entry.kind === 'file').length;
  manifest.stats.directories = manifest.entries.filter((entry) => entry.kind === 'directory').length;
  return manifest;
}

function scanRoot(context) {
  const visitedDirectories = new Set([normalizePath(context.rootPath).toLowerCase()]);
  const stack = [{ dir: context.rootPath, depth: 0 }];
  while (stack.length > 0 && context.manifest.entries.length < context.args.maxEntries) {
    const current = stack.pop();
    let children = [];
    try {
      children = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (error) {
      context.manifest.errors.push({
        root: context.rootNode.id,
        path: current.dir,
        message: String(error.message || error).slice(0, 240),
      });
      continue;
    }

    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of children) {
      if (context.manifest.entries.length >= context.args.maxEntries) break;
      if (dirent.isSymbolicLink()) {
        context.manifest.stats.skippedLinks += 1;
        context.manifest.stats.skippedEntries += 1;
        continue;
      }

      const absolutePath = path.join(current.dir, dirent.name);
      const relativePath = path.relative(context.rootPath, absolutePath);
      const secretLike = isSecretLike(absolutePath, context.excludePatterns);
      if (secretLike) {
        context.manifest.stats.skippedSecrets += 1;
        continue;
      }

      let stats;
      try {
        stats = fs.lstatSync(absolutePath);
      } catch {
        context.manifest.stats.skippedEntries += 1;
        continue;
      }

      if (stats.isSymbolicLink()) {
        context.manifest.stats.skippedLinks += 1;
        context.manifest.stats.skippedEntries += 1;
        continue;
      }

      const isDirectory = stats.isDirectory();
      if (isDirectory && isExcludedDirectory(dirent.name, relativePath, context.excludeDirectoryNames)) {
        context.manifest.stats.skippedEntries += 1;
        continue;
      }

      let realDirectory = '';
      if (isDirectory) {
        try {
          realDirectory = fs.realpathSync.native(absolutePath);
        } catch {
          context.manifest.stats.skippedEntries += 1;
          continue;
        }

        const normalizedRealDirectory = normalizePath(realDirectory).toLowerCase();
        if (visitedDirectories.has(normalizedRealDirectory)) {
          context.manifest.stats.skippedCycles += 1;
          context.manifest.stats.skippedEntries += 1;
          continue;
        }
      }

      const entry = buildEntry({
        rootNode: context.rootNode,
        absolutePath,
        relativePath,
        stats,
        isDirectory,
        depth: current.depth + 1,
        privacy: context.rootConfig.privacy || context.defaultPrivacy,
        generatedAt: context.generatedAt,
        args: context.args,
        manifest: context.manifest,
      });
      context.manifest.entries.push(entry);

      if (isDirectory) {
        if (current.depth + 1 >= context.args.maxDepth) {
          context.manifest.stats.skippedTooDeep += 1;
        } else {
          visitedDirectories.add(normalizePath(realDirectory || absolutePath).toLowerCase());
          stack.push({ dir: absolutePath, depth: current.depth + 1 });
        }
      }
    }
  }
}

function buildEntry({ rootNode, absolutePath, relativePath, stats, isDirectory, depth, privacy, generatedAt, args, manifest }) {
  const extension = isDirectory ? '' : path.extname(absolutePath).toLowerCase();
  const category = isDirectory ? 'directory' : (CATEGORY_BY_EXTENSION.get(extension) || 'file');
  const normalizedPath = normalizePath(absolutePath);
  const id = `nossen:source-entry:${hashText(`${rootNode.id}\0${normalizePath(relativePath)}`, 32)}`;
  const entry = {
    id,
    rootId: rootNode.id,
    kind: isDirectory ? 'directory' : 'file',
    category,
    label: path.basename(absolutePath),
    name: path.basename(absolutePath),
    path: absolutePath,
    normalizedPath,
    relativePath: normalizePath(relativePath),
    extension,
    depth,
    privacy,
    status: 'indexed',
    source: 'nossen-source-index',
    sizeBytes: isDirectory ? 0 : Number(stats.size || 0),
    modifiedAt: stats.mtime.toISOString(),
    createdAt: stats.birthtime.toISOString(),
    updatedAt: generatedAt,
    lastSeenAt: generatedAt,
  };

  if (!isDirectory) {
    const hashResult = hashFileIfAllowed(absolutePath, stats, args.hashMaxBytes);
    if (hashResult.sha256) {
      entry.sha256 = hashResult.sha256;
      manifest.stats.hashedFiles += 1;
    } else {
      entry.hashStatus = hashResult.status;
      if (hashResult.status === 'too-large') manifest.stats.tooLargeToHash += 1;
    }

    if (args.includePreview && TEXT_EXTENSIONS.has(extension) && stats.size <= DEFAULT_PREVIEW_MAX_BYTES) {
      const preview = readTextPreview(absolutePath);
      if (preview) entry.preview = preview;
    }
  }

  return cleanProps(entry);
}

function hashFileIfAllowed(filePath, stats, maxBytes) {
  if (!stats.isFile()) return { status: 'not-file' };
  if (stats.size > maxBytes) return { status: 'too-large' };
  try {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return { sha256: hash.digest('hex'), status: 'hashed' };
  } catch {
    return { status: 'unreadable' };
  }
}

function readTextPreview(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    return redact(raw)
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .slice(0, 4096);
  } catch {
    return '';
  }
}

function redact(value) {
  return String(value || '')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

function writeManifestFiles(manifest, args) {
  fs.mkdirSync(args.outDir, { recursive: true });
  const manifestPath = path.join(args.outDir, 'nossen-source-index.json');
  const cypherPath = path.join(args.outDir, 'nossen-source-index.cypher');
  const paramsPath = path.join(args.outDir, 'nossen-source-index.params.json');

  writeJsonAtomic(manifestPath, manifest);
  fs.writeFileSync(cypherPath, `${IMPORT_SCOPE_CYPHER.trim()}\n\n${IMPORT_ENTRIES_CYPHER.trim()}\n`, 'utf8');
  writeJsonAtomic(paramsPath, {
    scope: manifest.scope,
    roots: manifest.roots,
    entries: manifest.entries,
    now: manifest.generatedAt,
  });

  return { manifestPath, cypherPath, paramsPath };
}

function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

async function syncNeo4j(manifest, target) {
  const neo4j = requireNeo4jDriver();
  const config = resolveRouterConfigFromEnv(process.env);
  const endpoints = target === 'both'
    ? [config.local, config.aura]
    : [target === 'local' ? config.local : config.aura];
  const results = [];

  for (const endpoint of endpoints) {
    const startedAt = Date.now();
    try {
      const driver = neo4j.driver(endpoint.uri, neo4j.auth.basic(endpoint.username, endpoint.password), {
        connectionAcquisitionTimeout: 15000,
        maxConnectionPoolSize: 5,
        disableLosslessIntegers: true,
      });
      try {
        await driver.verifyConnectivity();
        const session = driver.session({
          database: endpoint.database,
          defaultAccessMode: neo4j.session.WRITE,
        });
        try {
          for (const constraint of IMPORT_CONSTRAINTS) await session.run(constraint);

          await session.run(IMPORT_SCOPE_RUN_CYPHER, {
            scope: manifest.scope,
            roots: manifest.roots,
            now: manifest.generatedAt,
          });

          let written = 0;
          for (const chunk of chunks(manifest.entries, 500)) {
            if (chunk.length === 0) continue;
            await session.run(IMPORT_ENTRIES_CYPHER, {
              entries: chunk,
              now: manifest.generatedAt,
            });
            written += chunk.length;
          }

          results.push({
            ok: true,
            name: endpoint.name,
            uri: endpoint.uri,
            database: endpoint.database,
            roots: manifest.roots.length,
            entries: written,
            elapsedMs: Date.now() - startedAt,
          });
        } finally {
          await session.close().catch(() => {});
        }
      } finally {
        await driver.close().catch(() => {});
      }
    } catch (error) {
      results.push({
        ok: false,
        name: endpoint?.name || target,
        uri: endpoint?.uri || '',
        database: endpoint?.database || '',
        error: error.code || error.name || 'Neo4jError',
        message: String(error.message || error).slice(0, 300),
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return {
    ok: results.every((result) => result.ok),
    target,
    endpoints: results,
  };
}

function requireNeo4jDriver() {
  const candidates = ['neo4j-driver'];
  for (const workspaceRoot of resolveWorkspaceRoots()) {
    candidates.push(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', 'node_modules', 'neo4j-driver'));
    candidates.push(path.join(workspaceRoot, 'node_modules', 'neo4j-driver'));
  }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('neo4j-driver not found. Run npm install in a11/backend/apps/server first.');
}

function resolveWorkspaceRoots() {
  return Array.from(new Set([
    REPO_ROOT,
    process.env.FUNESTERIE_WORKSPACE_ROOT,
    SIBLING_MAIN_ROOT,
  ].filter(Boolean).map((root) => path.resolve(root)))).filter((root) => fs.existsSync(root));
}

function resolveRouterConfigFromEnv(env = process.env) {
  const aura = {
    name: 'aura',
    uri: pick(env.KIRO_V2, env.NEO4J_AURA_URI, env.A11_AURA_NEO4J_URI),
    username: pick(env.KIRO_V2_USER, env.NEO4J_AURA_USER, env.A11_AURA_NEO4J_USER),
    password: pick(env.KIRO_V2_PASSWORD, env.NEO4J_AURA_PASSWORD, env.A11_AURA_NEO4J_PASSWORD),
    database: pick(env.KIRO_V2_DATABASE, env.NEO4J_AURA_DATABASE, env.A11_AURA_NEO4J_DATABASE, 'aa4680d2'),
  };

  const envLocalUri = isLocalNeo4jUri(env.NEO4J_URI) ? env.NEO4J_URI : '';
  const local = {
    name: 'local',
    uri: pick(env.A11_LOCAL_NEO4J_URI, env.NEO4J_LOCAL_URI, envLocalUri, 'neo4j://127.0.0.1:7687'),
    username: pick(env.A11_LOCAL_NEO4J_USER, env.NEO4J_LOCAL_USER, env.NEO4J_USERNAME, 'neo4j'),
    password: pick(env.A11_LOCAL_NEO4J_PASSWORD, env.NEO4J_LOCAL_PASSWORD, env.NEO4J_PASSWORD),
    database: pick(env.A11_LOCAL_NEO4J_DATABASE, env.NEO4J_LOCAL_DATABASE, env.NEO4J_DATABASE, 'a11-knowledge-graph'),
  };

  return { aura, local };
}

function isLocalNeo4jUri(uri) {
  return /^(neo4j|bolt)(\+s|\+ssc)?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?/i.test(String(uri || ''));
}

function pick(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function loadEnvIfExists(filePath, override) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!override && process.env[key]) continue;
    process.env[key] = unquote(match[2].trim());
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitRoots(value) {
  return String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function expandEnv(value) {
  return String(value || '')
    .replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')
    .replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
}

function isSecretLike(filePath, patterns) {
  return patterns.some((pattern) => pattern.test(filePath));
}

function isExcludedDirectory(name, relativePath, excluded) {
  const lowerName = String(name || '').toLowerCase();
  const lowerPath = normalizePath(relativePath).toLowerCase();
  if (excluded.has(lowerName)) return true;
  for (const value of excluded) {
    if (value.includes('/') && (lowerPath === value || lowerPath.startsWith(`${value}/`))) return true;
  }
  return false;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function safeId(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w:.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `nossen:${hashText(Date.now(), 12)}`;
}

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function cleanProps(properties) {
  const out = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = value.map((item) => String(item)).filter(Boolean);
      continue;
    }
    if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

main().catch((error) => {
  process.stderr.write(`[nossen-source-index] ${error.stack || error.message || error}\n`);
  process.exit(1);
});
