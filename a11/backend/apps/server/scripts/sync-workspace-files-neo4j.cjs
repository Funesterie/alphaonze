#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const neo4j = require('neo4j-driver');

const { resolveRouterConfig } = require('../lib/neo4j-memory-router.cjs');
const { collectWorkspaceInventory } = require('../src/knowledge/workspace-file-index.cjs');
const { loadRouterEnv } = require('./a11-env-loader.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const BATCH_SIZE = 500;

function resolveDefaultWorkspaceRoot() {
  try {
    const gitRoot = execFileSync('git', ['-C', SERVER_ROOT, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    if (gitRoot && path.resolve(gitRoot) !== path.parse(path.resolve(gitRoot)).root) return path.resolve(gitRoot);
  } catch (_) {
    // Production release archives may not contain .git; scanning SERVER_ROOT
    // is the bounded fail-safe. Operators can pass --root explicitly.
  }
  return SERVER_ROOT;
}

const WORKSPACE_ROOT = resolveDefaultWorkspaceRoot();

const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT workspace_root_id IF NOT EXISTS FOR (n:WorkspaceRoot) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT workspace_snapshot_id IF NOT EXISTS FOR (n:WorkspaceSnapshot) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT workspace_file_id IF NOT EXISTS FOR (n:WorkspaceFile) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT workspace_directory_id IF NOT EXISTS FOR (n:WorkspaceDirectory) REQUIRE n.id IS UNIQUE',
  'CREATE INDEX workspace_file_sha256 IF NOT EXISTS FOR (n:WorkspaceFile) ON (n.sha256)',
  'CREATE INDEX workspace_file_extension IF NOT EXISTS FOR (n:WorkspaceFile) ON (n.extension)',
  'CREATE INDEX workspace_file_root_status IF NOT EXISTS FOR (n:WorkspaceFile) ON (n.rootId, n.status)',
  'CREATE INDEX workspace_file_modified_at IF NOT EXISTS FOR (n:WorkspaceFile) ON (n.modifiedAt)',
  'CREATE FULLTEXT INDEX workspace_file_search IF NOT EXISTS FOR (n:WorkspaceFile) ON EACH [n.relativePath, n.name]',
];

function readOption(argv, name, fallback = '') {
  const directPrefix = `--${name}=`;
  const direct = argv.find((item) => item.startsWith(directPrefix));
  if (direct) return direct.slice(directPrefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  if (flags.has('--apply') && flags.has('--dry-run')) throw new Error('Choose either --apply or --dry-run, not both.');
  return {
    apply: flags.has('--apply'),
    rootPath: path.resolve(readOption(argv, 'root', process.env.A11_WORKSPACE_INDEX_ROOT || WORKSPACE_ROOT)),
    rootId: readOption(argv, 'root-id', process.env.A11_WORKSPACE_INDEX_ROOT_ID || ''),
    target: readOption(argv, 'target', process.env.A11_WORKSPACE_INDEX_TARGET || 'local').toLowerCase(),
    maxFileBytes: Number(readOption(argv, 'max-file-bytes', process.env.A11_WORKSPACE_INDEX_MAX_FILE_BYTES || 0)) || undefined,
    maxFiles: Number(readOption(argv, 'max-files', process.env.A11_WORKSPACE_INDEX_MAX_FILES || 0)) || 0,
    includeRuntimeMetadata: flags.has('--include-runtime-metadata'),
  };
}

function redact(value) {
  return String(value || '')
    .replace(/(password|token|secret|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;}]+/gi, '$1$2<redacted>')
    .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g, '://$1:<redacted>@');
}

function endpointForTarget(target) {
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return config.aura;
  if (target !== 'local') throw new Error(`Unsupported target "${target}". Use local or aura.`);
  return config.local;
}

function createDriver(endpoint) {
  if (!endpoint?.uri || !endpoint?.database) throw new Error('Neo4j endpoint is incomplete.');
  const auth = endpoint.auth === 'none'
    ? neo4j.auth.none()
    : neo4j.auth.basic(endpoint.username || '', endpoint.password || '');
  return neo4j.driver(endpoint.uri, auth, {
    connectionAcquisitionTimeout: 15000,
    maxConnectionPoolSize: 5,
    disableLosslessIntegers: true,
  });
}

function batches(rows, size = BATCH_SIZE) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

function buildDelta(inventory, existingRows = []) {
  const existing = new Map(existingRows.map((row) => [row.id, row]));
  const created = [];
  const changed = [];
  const unchanged = [];
  for (const file of inventory.files) {
    const previous = existing.get(file.id);
    if (!previous) {
      created.push(file);
    } else if (
      previous.sha256 !== file.sha256
      || Number(previous.sizeBytes) !== file.sizeBytes
      || String(previous.modifiedAt || '') !== file.modifiedAt
    ) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }
  const currentIds = new Set(inventory.files.map((file) => file.id));
  const missing = existingRows.filter((row) => !currentIds.has(row.id));
  return { created, changed, unchanged, missing };
}

function fileRow(file, snapshotId, generatedAt) {
  return {
    id: file.id,
    rootId: file.rootId,
    relativePath: file.relativePath,
    name: file.name,
    directoryId: file.directoryId,
    extension: file.extension,
    language: file.language,
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    sha256: file.sha256,
    lineCount: file.lineCount,
    gitTracked: file.gitTracked,
    boundary: file.boundary,
    domains: file.domains,
    provenance: file.provenance,
    localReferenceCount: file.localReferenceCount,
    snapshotId,
    generatedAt,
  };
}

async function fetchExisting(session, rootId) {
  const result = await session.run(`
    MATCH (file:WorkspaceFile {rootId: $rootId})
    RETURN file.id AS id,
           file.sha256 AS sha256,
           file.sizeBytes AS sizeBytes,
           toString(file.modifiedAt) AS modifiedAt,
           file.status AS status
  `, { rootId });
  return result.records.map((record) => ({
    id: record.get('id'),
    sha256: record.get('sha256'),
    sizeBytes: record.get('sizeBytes'),
    modifiedAt: record.get('modifiedAt'),
    status: record.get('status'),
  }));
}

async function ensureSchema(session) {
  for (const statement of SCHEMA_STATEMENTS) await session.run(statement);
}

async function syncInventory(session, inventory, existingRows) {
  const delta = buildDelta(inventory, existingRows);
  const { root, snapshot, generatedAt } = inventory;

  await session.run(`
    MERGE (root:WorkspaceRoot {id: $root.id})
    SET root.name = $root.name,
        root.pathHash = $root.pathHash,
        root.discovery = $root.discovery,
        root.gitHead = $root.gitHead,
        root.gitBranch = $root.gitBranch,
        root.gitDirty = $root.gitDirty,
        root.lastIndexedAt = datetime($generatedAt),
        root.schema = $schema
    MERGE (snapshot:WorkspaceSnapshot {id: $snapshot.id})
    SET snapshot.rootId = $snapshot.rootId,
        snapshot.generatedAt = datetime($snapshot.generatedAt),
        snapshot.metrics = $metrics,
        snapshot.schema = $schema
    MERGE (root)-[:HAS_INDEX_SNAPSHOT]->(snapshot)
    WITH root, snapshot
    OPTIONAL MATCH (root)-[old:CURRENT_INDEX_SNAPSHOT]->(:WorkspaceSnapshot)
    DELETE old
    MERGE (root)-[:CURRENT_INDEX_SNAPSHOT]->(snapshot)
  `, {
    root,
    snapshot,
    generatedAt,
    schema: inventory.schema,
    metrics: JSON.stringify(inventory.metrics),
  });

  for (const batch of batches(inventory.directories)) {
    await session.run(`
      MATCH (root:WorkspaceRoot {id: $rootId})
      UNWIND $rows AS row
      MERGE (directory:WorkspaceDirectory {id: row.id})
      SET directory.rootId = row.rootId,
          directory.relativePath = row.relativePath,
          directory.name = row.name,
          directory.parentId = row.parentId,
          directory.lastSeenSnapshotId = $snapshotId,
          directory.status = 'present',
          directory.updatedAt = datetime($generatedAt)
      MERGE (root)-[:CONTAINS_DIRECTORY]->(directory)
    `, {
      rootId: root.id,
      rows: batch,
      snapshotId: snapshot.id,
      generatedAt,
    });
  }

  const rootDirectory = inventory.directories.find((directory) => directory.relativePath === '.');
  for (const batch of batches(inventory.directories.filter((directory) => directory.parentId))) {
    await session.run(`
      UNWIND $rows AS row
      MATCH (parent:WorkspaceDirectory {id: row.parentId})
      MATCH (child:WorkspaceDirectory {id: row.id})
      MERGE (parent)-[:CONTAINS_DIRECTORY]->(child)
    `, { rows: batch });
  }

  const upsert = [...delta.created, ...delta.changed].map((file) => fileRow(file, snapshot.id, generatedAt));
  for (const batch of batches(upsert)) {
    await session.run(`
      MATCH (root:WorkspaceRoot {id: $rootId})
      UNWIND $rows AS row
      MERGE (file:WorkspaceFile {id: row.id})
      SET file.rootId = row.rootId,
          file.relativePath = row.relativePath,
          file.name = row.name,
          file.directoryId = row.directoryId,
          file.extension = row.extension,
          file.language = row.language,
          file.sizeBytes = row.sizeBytes,
          file.modifiedAt = datetime(row.modifiedAt),
          file.sha256 = row.sha256,
          file.lineCount = row.lineCount,
          file.gitTracked = row.gitTracked,
          file.boundary = row.boundary,
          file.domains = row.domains,
          file.provenance = row.provenance,
          file.localReferenceCount = row.localReferenceCount,
          file.lastSeenSnapshotId = row.snapshotId,
          file.status = 'present',
          file.missingSince = null,
          file.updatedAt = datetime(row.generatedAt)
      MERGE (root)-[:CONTAINS_FILE]->(file)
      WITH file, row
      MATCH (directory:WorkspaceDirectory {id: row.directoryId})
      MERGE (file)-[:IN_DIRECTORY]->(directory)
    `, { rootId: root.id, rows: batch });
  }

  // A content hash does not cover mutable catalogue metadata (Git provenance,
  // inferred domains, references or boundary). Refresh it even when the file
  // bytes did not change so an idempotent run cannot leave stale graph facts.
  for (const batch of batches(delta.unchanged.map((file) => fileRow(file, snapshot.id, generatedAt)))) {
    await session.run(`
      MATCH (root:WorkspaceRoot {id: $rootId})
      UNWIND $rows AS row
      MATCH (file:WorkspaceFile {id: row.id})
      SET file.gitTracked = row.gitTracked,
          file.boundary = row.boundary,
          file.domains = row.domains,
          file.provenance = row.provenance,
          file.localReferenceCount = row.localReferenceCount,
          file.directoryId = row.directoryId,
          file.language = row.language,
          file.lastSeenSnapshotId = row.snapshotId,
          file.status = 'present',
          file.missingSince = null,
          file.lastCheckedAt = datetime(row.generatedAt)
      MERGE (root)-[:CONTAINS_FILE]->(file)
      WITH file, row
      MATCH (directory:WorkspaceDirectory {id: row.directoryId})
      MERGE (file)-[:IN_DIRECTORY]->(directory)
    `, {
      rootId: root.id,
      rows: batch,
    });
  }

  for (const batch of batches(inventory.files.map((file) => file.id))) {
    await session.run(`
      MATCH (file:WorkspaceFile)
      WHERE file.id IN $ids
      OPTIONAL MATCH (file)-[reference:REFERENCES_FILE]->(:WorkspaceFile)
      DELETE reference
    `, { ids: batch });
  }
  for (const batch of batches(inventory.references)) {
    await session.run(`
      UNWIND $rows AS row
      MATCH (source:WorkspaceFile {id: row.fromId})
      MATCH (target:WorkspaceFile {id: row.toId})
      MERGE (source)-[reference:REFERENCES_FILE {kind: row.kind}]->(target)
      SET reference.updatedAt = datetime($generatedAt)
    `, { rows: batch, generatedAt });
  }

  // Reconcile the metadata inventory with the richer, curated/chunked corpora
  // already present in the graph. Exact relative paths only: no fuzzy merge.
  await session.run(`
    MATCH (file:WorkspaceFile {rootId: $rootId})
    MATCH (curated:VivyGraphFile)
    WHERE curated.path = file.relativePath
    MERGE (file)-[link:SAME_SOURCE_AS {kind: 'vivy-graph-file'}]->(curated)
    SET link.updatedAt = datetime($generatedAt)
  `, { rootId: root.id, generatedAt });
  await session.run(`
    MATCH (file:WorkspaceFile {rootId: $rootId})
    MATCH (research:ResearchDoc)
    WHERE research.path = file.relativePath
    MERGE (file)-[link:SAME_SOURCE_AS {kind: 'research-doc'}]->(research)
    SET link.updatedAt = datetime($generatedAt)
  `, { rootId: root.id, generatedAt });

  const staleResult = await session.run(`
    MATCH (file:WorkspaceFile {rootId: $rootId})
    WHERE file.lastSeenSnapshotId <> $snapshotId OR file.lastSeenSnapshotId IS NULL
    SET file.status = 'missing',
        file.missingSince = coalesce(file.missingSince, datetime($generatedAt))
    RETURN count(file) AS missing
  `, { rootId: root.id, snapshotId: snapshot.id, generatedAt });

  if (rootDirectory) {
    await session.run(`
      MATCH (root:WorkspaceRoot {id: $rootId})
      MATCH (directory:WorkspaceDirectory {id: $directoryId})
      MERGE (root)-[:ROOT_DIRECTORY]->(directory)
    `, { rootId: root.id, directoryId: rootDirectory.id });
  }

  return {
    created: delta.created.length,
    changed: delta.changed.length,
    unchanged: delta.unchanged.length,
    missing: staleResult.records[0]?.get('missing') || 0,
  };
}

async function applyInventory(inventory, target) {
  // Explicit process settings (for example a short-lived SSH tunnel) are the
  // operator's highest-priority choice. The shared loader historically lets
  // .env.local override values, so preserve these keys across that load.
  const explicitEndpointEnv = {};
  for (const key of [
    'A11_LOCAL_NEO4J_URI',
    'A11_LOCAL_NEO4J_USER',
    'A11_LOCAL_NEO4J_PASSWORD',
    'A11_LOCAL_NEO4J_DATABASE',
    'A11_LOCAL_NEO4J_AUTH',
    'NEO4J_LOCAL_URI',
    'NEO4J_LOCAL_USER',
    'NEO4J_LOCAL_PASSWORD',
    'NEO4J_LOCAL_DATABASE',
  ]) {
    if (process.env[key] !== undefined) explicitEndpointEnv[key] = process.env[key];
  }
  loadRouterEnv();
  Object.assign(process.env, explicitEndpointEnv);
  const endpoint = endpointForTarget(target);
  const driver = createDriver(endpoint);
  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: endpoint.database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      await ensureSchema(session);
      const existingRows = await fetchExisting(session, inventory.root.id);
      const delta = await syncInventory(session, inventory, existingRows);
      const status = await session.run(`
        MATCH (root:WorkspaceRoot {id: $rootId})
        OPTIONAL MATCH (root)-[:CONTAINS_FILE]->(file:WorkspaceFile)
        OPTIONAL MATCH (root)-[:CONTAINS_DIRECTORY]->(directory:WorkspaceDirectory)
        RETURN count(DISTINCT file) AS files,
               count(DISTINCT CASE WHEN file.status = 'present' THEN file END) AS presentFiles,
               count(DISTINCT directory) AS directories
      `, { rootId: inventory.root.id });
      const record = status.records[0];
      return {
        endpoint: { name: endpoint.name, uri: endpoint.uri, database: endpoint.database },
        delta,
        graph: {
          files: record?.get('files') || 0,
          presentFiles: record?.get('presentFiles') || 0,
          directories: record?.get('directories') || 0,
        },
      };
    } finally {
      await session.close().catch(() => {});
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs();
  const startedAt = Date.now();
  const inventory = await collectWorkspaceInventory(args);
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: true,
      note: 'No Neo4j connection or filesystem artifact was created. Use --apply explicitly to sync.',
      target: args.target,
      schema: inventory.schema,
      generatedAt: inventory.generatedAt,
      root: inventory.root,
      snapshot: inventory.snapshot,
      metrics: inventory.metrics,
      elapsedMs: Date.now() - startedAt,
    }, null, 2)}\n`);
    return;
  }

  const result = await applyInventory(inventory, args.target);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dryRun: false,
    schema: inventory.schema,
    generatedAt: inventory.generatedAt,
    root: inventory.root,
    metrics: inventory.metrics,
    ...result,
    elapsedMs: Date.now() - startedAt,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${redact(error.stack || error.message || error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCHEMA_STATEMENTS,
  buildDelta,
  parseArgs,
  resolveDefaultWorkspaceRoot,
  syncInventory,
};
