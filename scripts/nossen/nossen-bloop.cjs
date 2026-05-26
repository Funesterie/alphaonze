#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SIBLING_MAIN_ROOT = path.resolve(path.dirname(REPO_ROOT), 'funesterie');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runtime', 'nossen', 'bloop');
const DEFAULT_LIMIT = 5000;
const DEFAULT_DUPLICATE_LIMIT = 200;
const DEFAULT_HASH_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_URL_TIMEOUT_MS = 2500;

const SECRET_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])[^\\/]*\.env(\.|$)/i,
  /(^|[\\/])\.npmrc(\.|$)/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])client_secret[^\\/]*\.json$/i,
  /(^|[\\/])pass\.txt$/i,
  /(^|[\\/])bucket\.txt$/i,
  /(^|[\\/])docker.*\.txt$/i,
  /(^|[\\/])dockersavecode\.txt$/i,
  /(^|[\\/])jfrog.*token.*\.txt$/i,
  /(^|[\\/])redhat.*tok.*\.txt$/i,
  /(^|[\\/])a11npm\.txt$/i,
  /(^|[\\/])neo4j\.txt$/i,
  /(^|[\\/])mdp\.txt$/i,
  /(^|[\\/])id_rsa$/i,
  /(^|[\\/])id_ed25519$/i,
  /\.(pem|p12|pfx|key)$/i,
  /(password|passwd|secret|token|credential|api[_ -]?key|private[_-]?key|recovery|license)/i,
];

const HASH_QUERY = `
MATCH (n)
WITH n,
     labels(n) AS labels,
     CASE
       WHEN n.sha256 IS NOT NULL THEN 'sha256'
       WHEN n.checksum IS NOT NULL THEN 'checksum'
       WHEN n.contentHash IS NOT NULL THEN 'contentHash'
       WHEN n.fileHash IS NOT NULL THEN 'fileHash'
       ELSE ''
     END AS hashProperty,
     coalesce(n.sha256, n.checksum, n.contentHash, n.fileHash) AS expectedHash
WHERE expectedHash IS NOT NULL
RETURN elementId(n) AS elementId,
       labels,
       hashProperty,
       toString(expectedHash) AS expectedHash,
       coalesce(toString(n.id), elementId(n)) AS id,
       coalesce(toString(n.kind), '') AS kind,
       coalesce(toString(n.name), toString(n.label), '') AS name,
       coalesce(toString(n.path), '') AS path,
       coalesce(toString(n.relativePath), '') AS relativePath,
       coalesce(toString(n.url), '') AS url,
       coalesce(toString(n.source), '') AS source,
       coalesce(toString(n.updatedAt), toString(n.updated_at), '') AS updatedAt
ORDER BY id
LIMIT $limit
`;

const TOTAL_QUERY = `
MATCH (n)
WHERE n.sha256 IS NOT NULL
   OR n.checksum IS NOT NULL
   OR n.contentHash IS NOT NULL
   OR n.fileHash IS NOT NULL
RETURN count(n) AS total
`;

const WRITE_REPORT_CONSTRAINTS = [
  'CREATE CONSTRAINT nossen_bloop_report_id IF NOT EXISTS FOR (n:NossenBloopReport) REQUIRE n.id IS UNIQUE',
];

const WRITE_REPORT_CYPHER = `
MERGE (report:FunesterieEcosystemNode:NossenBloopReport {id: $report.id})
SET report += $report,
    report.updatedAt = $now
RETURN report.id AS id
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  loadKnownEnv();

  const report = await buildBloopReport(args);
  const files = writeReportFiles(report, args);

  let sync = null;
  if (args.writeReportNode) {
    sync = await writeReportNode(report, args.target);
  }

  const summary = {
    ok: (!sync || sync.ok),
    findingsOk: !report.summary.mismatch && !report.summary.missing,
    dryRun: !args.writeReportNode,
    target: report.target,
    generatedAt: report.generatedAt,
    totalHashNodes: report.summary.totalHashNodes,
    checkedEntries: report.entries.length,
    statuses: report.summary.statuses,
    files,
    sync,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok || (args.failOnFinding && !summary.findingsOk)) process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {
    target: 'aura',
    outDir: DEFAULT_OUT_DIR,
    limit: DEFAULT_LIMIT,
    duplicateLimit: DEFAULT_DUPLICATE_LIMIT,
    hashMaxBytes: DEFAULT_HASH_MAX_BYTES,
    urlTimeoutMs: DEFAULT_URL_TIMEOUT_MS,
    root: [],
    checkUrls: true,
    writeReportNode: false,
    failOnFinding: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--target') args.target = String(next() || 'aura').toLowerCase();
    else if (arg === '--out-dir') args.outDir = path.resolve(next());
    else if (arg === '--limit') args.limit = toPositiveInt(next(), args.limit);
    else if (arg === '--duplicate-limit') args.duplicateLimit = toPositiveInt(next(), args.duplicateLimit);
    else if (arg === '--hash-max-bytes') args.hashMaxBytes = toPositiveInt(next(), args.hashMaxBytes);
    else if (arg === '--url-timeout-ms') args.urlTimeoutMs = toPositiveInt(next(), args.urlTimeoutMs);
    else if (arg === '--root') args.root.push(path.resolve(expandEnv(next())));
    else if (arg === '--no-url-check') args.checkUrls = false;
    else if (arg === '--dry-run') args.writeReportNode = false;
    else if (arg === '--write-report-node') args.writeReportNode = true;
    else if (arg === '--fail-on-finding') args.failOnFinding = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['aura', 'local'].includes(args.target)) {
    throw new Error('--target must be aura or local');
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
NOSSEN BLOOP

Usage:
  npm run nossen:bloop:dry
  npm run nossen:bloop -- --target aura --limit 2000
  npm run nossen:bloop -- --write-report-node

Options:
  --target <aura|local>     Neo4j source to read. Default: aura.
  --limit <n>               Maximum hash nodes to inspect. Default: 5000.
  --duplicate-limit <n>     Maximum duplicate groups in the report. Default: 200.
  --root <path>             Extra local root for resolving relative paths. Can be repeated.
  --hash-max-bytes <n>      Maximum local file size to hash. Default: 64 MiB.
  --url-timeout-ms <n>      HEAD/GET timeout for allowlisted URLs. Default: 2500.
  --no-url-check            Skip URL reachability checks.
  --write-report-node       Explicitly writes a NossenBloopReport node to Neo4j.
  --fail-on-finding         Exit non-zero when missing or mismatch findings exist.

Safety:
  BLOOP never generates hashes, never brute-forces URLs and never scans the network.
  It only verifies hashes already present in Neo4j and skips secret-like paths.
`);
}

async function buildBloopReport(args) {
  const generatedAt = new Date().toISOString();
  const neo4j = requireNeo4jDriver();
  const endpoint = resolveRouterConfigFromEnv(process.env)[args.target];
  const startedAt = Date.now();
  const driver = neo4j.driver(endpoint.uri, neo4j.auth.basic(endpoint.username, endpoint.password), {
    connectionAcquisitionTimeout: 15000,
    maxConnectionPoolSize: 5,
    disableLosslessIntegers: true,
  });

  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: endpoint.database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const records = await session.run(HASH_QUERY, { limit: neo4j.int(args.limit) });
      const total = await session.run(TOTAL_QUERY);

      const rawEntries = records.records.map((record) => recordToObject(record));
      const duplicateMap = buildDuplicateMap(rawEntries);
      const entries = [];
      for (const entry of rawEntries) {
        entries.push(await verifyEntry(entry, duplicateMap, args));
      }

      const duplicates = Array.from(duplicateMap.entries())
        .filter(([, values]) => values.length > 1)
        .slice(0, args.duplicateLimit)
        .map(([hash, values]) => ({
          hash,
          count: values.length,
          nodes: values.map((item) => ({
            id: item.id,
            labels: item.labels,
            path: item.path,
            relativePath: item.relativePath,
            url: item.url,
            semanticGroup: classifySemanticGroup(item),
          })),
        }));

      return finalizeReport({
        id: `nossen-bloop-${hashText(`${generatedAt}:${endpoint.name}`, 12)}`,
        kind: 'nossen-bloop-report',
        schema: 'nossen-bloop/v1',
        generatedAt,
        target: endpoint.name,
        database: endpoint.database,
        sourceUri: redactUri(endpoint.uri),
        elapsedMs: Date.now() - startedAt,
        limit: args.limit,
        totalHashNodes: numberValue(total.records[0]?.get('total')),
        entries,
        duplicates,
        safety: {
          mode: args.writeReportNode ? 'explicit-write-report-node' : 'dry-run',
          urlAllowlist: ['*.funesterie.me', 'funesterie.me', 'localhost', '127.0.0.1', '::1'],
          secretPathPolicy: 'skip-secret-like-paths',
          hashPolicy: 'verify-known-hashes-only',
        },
        semanticPass: {
          status: 'prepared-not-written',
          description: 'Each entry receives semanticGroup and semanticKey hints. The next pass can turn these hints into explicit SHA semantic relations after review.',
        },
      });
    } finally {
      await session.close().catch(() => {});
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

function recordToObject(record) {
  const out = {};
  for (const key of record.keys) out[key] = record.get(key);
  out.labels = Array.isArray(out.labels) ? out.labels.map(String) : [];
  for (const key of ['elementId', 'hashProperty', 'expectedHash', 'id', 'kind', 'name', 'path', 'relativePath', 'url', 'source', 'updatedAt']) {
    out[key] = String(out[key] || '');
  }
  out.expectedHash = normalizeHash(out.expectedHash);
  out.semanticGroup = classifySemanticGroup(out);
  out.semanticKey = buildSemanticKey(out);
  return out;
}

function buildDuplicateMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const hash = normalizeHash(entry.expectedHash);
    if (!hash) continue;
    if (!map.has(hash)) map.set(hash, []);
    map.get(hash).push(entry);
  }
  return map;
}

async function verifyEntry(entry, duplicateMap, args) {
  const issues = [];
  const checks = {};
  const duplicateCount = duplicateMap.get(entry.expectedHash)?.length || 0;
  if (duplicateCount > 1) issues.push('duplicate');

  const hashLooksSha256 = /^[a-f0-9]{64}$/i.test(entry.expectedHash);
  if (!hashLooksSha256) issues.push('hash-format-unknown');

  const local = verifyLocalPath(entry, args);
  checks.local = local;
  if (local.status === 'missing') issues.push('missing');
  if (local.status === 'secret-like-skipped') issues.push('secret-like-skipped');
  if (local.status === 'too-large') issues.push('too-large');
  if (local.status === 'unreadable') issues.push('unreadable');
  if (local.status === 'exists' && hashLooksSha256) {
    const actualHash = await hashFile(local.resolvedPath);
    checks.local.actualHash = actualHash;
    if (actualHash === entry.expectedHash) checks.local.status = 'hash-ok';
    else {
      checks.local.status = 'mismatch';
      issues.push('mismatch');
    }
  }

  if (entry.url && args.checkUrls) {
    checks.url = await verifyUrl(entry.url, args.urlTimeoutMs);
    if (checks.url.status === 'unreachable') issues.push('unreachable');
    if (checks.url.status === 'not-allowlisted') issues.push('url-not-allowlisted');
  } else if (entry.url && !args.checkUrls) {
    checks.url = { status: 'skipped' };
  }

  if (!entry.path && !entry.relativePath && !entry.url) issues.push('orphan');

  return stripUndefined({
    elementId: entry.elementId,
    labels: entry.labels,
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    hashProperty: entry.hashProperty,
    expectedHash: entry.expectedHash,
    path: entry.path,
    relativePath: entry.relativePath,
    url: entry.url,
    source: entry.source,
    updatedAt: entry.updatedAt,
    status: chooseStatus(issues, checks),
    issues,
    checks,
    semanticGroup: entry.semanticGroup,
    semanticKey: entry.semanticKey,
    semanticBasis: 'labels-kind-name-path-extension',
  });
}

function verifyLocalPath(entry, args) {
  const candidate = resolveLocalCandidate(entry, args);
  if (!candidate) {
    return { status: entry.path || entry.relativePath ? 'missing' : 'no-local-path' };
  }

  if (isSecretLike(candidate.resolvedPath) || isSecretLike(entry.path) || isSecretLike(entry.relativePath)) {
    return {
      status: 'secret-like-skipped',
      resolvedPath: candidate.displayPath,
      reason: 'Path looks like a secret, token, password or private key.',
    };
  }

  if (!fs.existsSync(candidate.resolvedPath)) {
    return { status: 'missing', resolvedPath: candidate.displayPath };
  }

  let stats;
  try {
    stats = fs.statSync(candidate.resolvedPath);
  } catch (error) {
    return {
      status: 'unreadable',
      resolvedPath: candidate.displayPath,
      error: error.code || error.name || 'fs-error',
    };
  }

  if (!stats.isFile()) {
    return { status: 'not-file', resolvedPath: candidate.displayPath };
  }
  if (stats.size > args.hashMaxBytes) {
    return { status: 'too-large', resolvedPath: candidate.displayPath, sizeBytes: stats.size };
  }

  return {
    status: 'exists',
    resolvedPath: candidate.displayPath,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function resolveLocalCandidate(entry, args) {
  const candidates = [];
  const roots = Array.from(new Set([
    ...args.root,
    REPO_ROOT,
    SIBLING_MAIN_ROOT,
  ].filter(Boolean).map((root) => path.resolve(root)))).filter((root) => fs.existsSync(root));

  for (const value of [entry.path, entry.relativePath].filter(Boolean)) {
    const expanded = expandEnv(value);
    if (path.isAbsolute(expanded)) {
      candidates.push(path.resolve(expanded));
    } else {
      for (const root of roots) candidates.push(path.resolve(root, expanded));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { resolvedPath: candidate, displayPath: candidate };
    }
  }

  if (candidates.length) return { resolvedPath: candidates[0], displayPath: candidates[0] };
  return null;
}

async function verifyUrl(url, timeoutMs) {
  if (!isAllowlistedUrl(url)) {
    return { status: 'not-allowlisted', url: safeUrl(url) };
  }

  try {
    const head = await requestWithoutBody(url, 'HEAD', timeoutMs);
    if (head.statusCode === 405 || head.statusCode === 501) {
      const get = await requestWithoutBody(url, 'GET', timeoutMs);
      return classifyHttpResult(get);
    }
    return classifyHttpResult(head);
  } catch (error) {
    return {
      status: 'unreachable',
      url: safeUrl(url),
      error: error.code || error.name || 'request-error',
      message: String(error.message || error).slice(0, 180),
    };
  }
}

function requestWithoutBody(url, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method,
      timeout: timeoutMs,
      headers: {
        'user-agent': 'nossen-bloop/1.0',
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({
        url: safeUrl(url),
        method,
        statusCode: response.statusCode || 0,
        statusMessage: response.statusMessage || '',
      }));
    });
    request.on('timeout', () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end();
  });
}

function classifyHttpResult(result) {
  const statusCode = Number(result.statusCode || 0);
  return {
    ...result,
    status: statusCode > 0 && statusCode < 500 ? 'reachable' : 'unreachable',
  };
}

function chooseStatus(issues, checks) {
  if (issues.includes('mismatch')) return 'mismatch';
  if (issues.includes('missing')) return 'missing';
  if (issues.includes('unreachable')) return 'unreachable';
  if (issues.includes('orphan')) return 'orphan';
  if (issues.includes('duplicate')) return 'duplicate';
  if (issues.some((issue) => issue.endsWith('skipped') || issue === 'too-large' || issue === 'url-not-allowlisted')) return 'skipped';
  if (checks.local?.status === 'hash-ok' || checks.url?.status === 'reachable') return 'ok';
  return 'orphan';
}

function finalizeReport(report) {
  const statuses = {};
  const issues = {};
  for (const entry of report.entries) {
    statuses[entry.status] = (statuses[entry.status] || 0) + 1;
    for (const issue of entry.issues || []) issues[issue] = (issues[issue] || 0) + 1;
  }

  report.summary = {
    totalHashNodes: report.totalHashNodes,
    returnedEntries: report.entries.length,
    statuses,
    issues,
    ok: statuses.ok || 0,
    duplicate: statuses.duplicate || 0,
    missing: statuses.missing || 0,
    mismatch: statuses.mismatch || 0,
    orphan: statuses.orphan || 0,
    unreachable: statuses.unreachable || 0,
    skipped: statuses.skipped || 0,
    duplicateGroups: report.duplicates.length,
    semanticGroups: countBy(report.entries, 'semanticGroup'),
  };

  return report;
}

function writeReportFiles(report, args) {
  fs.mkdirSync(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, 'bloop-report.json');
  const markdownPath = path.join(args.outDir, 'bloop-report.md');
  const cypherPath = path.join(args.outDir, 'bloop-report.cypher');

  writeJsonAtomic(jsonPath, report);
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), 'utf8');
  fs.writeFileSync(cypherPath, `${WRITE_REPORT_CONSTRAINTS.join(';\n')};\n\n${WRITE_REPORT_CYPHER.trim()}\n`, 'utf8');
  return { jsonPath, markdownPath, cypherPath };
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# NOSSEN BLOOP Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Target: ${report.target} / ${report.database}`);
  lines.push(`Mode: ${report.safety.mode}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Hash nodes in Neo4j: ${report.summary.totalHashNodes}`);
  lines.push(`- Entries checked: ${report.summary.returnedEntries}`);
  lines.push(`- Duplicate groups: ${report.summary.duplicateGroups}`);
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('| --- | ---: |');
  for (const [status, count] of Object.entries(report.summary.statuses).sort()) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- Only hashes already present in Neo4j were inspected.');
  lines.push('- Secret-like paths were skipped.');
  lines.push('- URL checks were limited to Funesterie/localhost allowlist.');
  lines.push('- No Neo4j mutation was performed unless `--write-report-node` was used.');
  lines.push('');
  lines.push('## Duplicates');
  lines.push('');
  if (!report.duplicates.length) {
    lines.push('No duplicate hash groups found in the returned window.');
  } else {
    for (const duplicate of report.duplicates.slice(0, 25)) {
      lines.push(`- \`${duplicate.hash.slice(0, 16)}...\` (${duplicate.count})`);
      for (const node of duplicate.nodes.slice(0, 5)) {
        lines.push(`  - ${node.id} [${node.labels.join(', ')}] ${node.semanticGroup}`);
      }
    }
  }
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  const findings = report.entries.filter((entry) => entry.status !== 'ok').slice(0, 50);
  if (!findings.length) {
    lines.push('No blocking finding in the returned window.');
  } else {
    for (const entry of findings) {
      lines.push(`- ${entry.status}: ${entry.id} [${entry.labels.join(', ')}] issues=${(entry.issues || []).join(', ') || 'none'} semantic=${entry.semanticGroup}`);
    }
  }
  lines.push('');
  lines.push('## Semantic Next Pass');
  lines.push('');
  lines.push('BLOOP now emits `semanticGroup` and `semanticKey` hints. The next pass can create reviewed semantic relations between hashes, for example same visual family, same source pack, same runtime surface, or same agent domain.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeReportNode(report, target) {
  const neo4j = requireNeo4jDriver();
  const endpoint = resolveRouterConfigFromEnv(process.env)[target];
  const startedAt = Date.now();
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
      for (const constraint of WRITE_REPORT_CONSTRAINTS) await session.run(constraint);
      const props = cleanProps({
        id: report.id,
        kind: report.kind,
        schema: report.schema,
        name: 'NOSSEN BLOOP Report',
        label: 'NOSSEN BLOOP Report',
        summary: JSON.stringify(report.summary),
        target: report.target,
        generatedAt: report.generatedAt,
        reportPath: path.join(DEFAULT_OUT_DIR, 'bloop-report.json'),
        mode: report.safety.mode,
      });
      await session.run(WRITE_REPORT_CYPHER, {
        report: props,
        now: new Date().toISOString(),
      });
      return {
        ok: true,
        target,
        uri: redactUri(endpoint.uri),
        database: endpoint.database,
        reportId: report.id,
        elapsedMs: Date.now() - startedAt,
      };
    } finally {
      await session.close().catch(() => {});
    }
  } catch (error) {
    return {
      ok: false,
      target,
      uri: redactUri(endpoint.uri),
      database: endpoint.database,
      error: error.code || error.name || 'Neo4jError',
      message: String(error.message || error).slice(0, 300),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await driver.close().catch(() => {});
  }
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

function loadKnownEnv() {
  for (const workspaceRoot of resolveWorkspaceRoots()) {
    loadEnvIfExists(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env.local'), false);
    loadEnvIfExists(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env'), false);
    loadEnvIfExists(path.join(workspaceRoot, 'a11mcp', '.env'), false);
  }
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

function isAllowlistedUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === 'funesterie.me'
      || host.endsWith('.funesterie.me')
      || host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1';
  } catch {
    return false;
  }
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = parsed.search ? '?...' : '';
    return parsed.toString();
  } catch {
    return String(value || '').slice(0, 180);
  }
}

function redactUri(uri) {
  try {
    const parsed = new URL(uri);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return String(uri || '').replace(/\/\/[^@/]+@/, '//[redacted]@');
  }
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase();
}

function classifySemanticGroup(entry) {
  const text = [
    ...(entry.labels || []),
    entry.kind,
    entry.name,
    entry.path,
    entry.relativePath,
    entry.url,
  ].filter(Boolean).join(' ').toLowerCase();
  const fileName = path.basename(String(entry.path || entry.relativePath || '')).toLowerCase();
  const extension = path.extname(fileName).toLowerCase();
  const configNames = new Set([
    '.dockerignore',
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    '.gitleaksignore',
    '.npmignore',
    'dockerfile',
    'package-lock.json',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'vite.config.js',
    'vite.config.ts',
    'yarn.lock',
  ]);

  if (isSecretLike(entry.path || entry.relativePath || '')) return 'private';
  if (/\b(source|repo|module|package|contract|config)\b/.test(text) || configNames.has(fileName) || ['.js', '.ts', '.tsx', '.cjs', '.mjs', '.ps1', '.md', '.json', '.yml', '.yaml', '.toml'].includes(extension)) return 'source';
  if (/\b(image|avatar|visual)\b/.test(text) || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) return 'image';
  if (/\b(runtime|hook|route|mcp|endpoint|service)\b/.test(text)) return 'runtime';
  if (/\b(vivy|song|voice|music|scene)\b/.test(text)) return 'music';
  if (/\b(a11|audio|video|media|transcript|clip)\b/.test(text) || ['.mp3', '.wav', '.mp4', '.mov', '.webm'].includes(extension)) return 'media';
  if (/\b(k44|kaen|nossen|agent)\b/.test(text)) return 'agent';
  if (/\b(backup|archive|zip)\b/.test(text) || ['.zip', '.7z', '.rar'].includes(extension)) return 'archive';
  if (entry.url) return 'web';
  return 'unknown';
}

function buildSemanticKey(entry) {
  return [
    'sha',
    classifySemanticGroup(entry),
    ...(entry.labels || []).slice(0, 3).map((label) => slug(label)),
    slug(entry.kind || entry.name || 'node'),
  ].filter(Boolean).join(':').slice(0, 160);
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function isSecretLike(filePath) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(String(filePath || '')));
}

function countBy(entries, key) {
  const out = {};
  for (const entry of entries) {
    const value = String(entry[key] || 'unknown');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
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

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    out[key] = stripUndefined(item);
  }
  return out;
}

function numberValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
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

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

main().catch((error) => {
  process.stderr.write(`[nossen-bloop] ${error.stack || error.message || error}\n`);
  process.exit(1);
});
