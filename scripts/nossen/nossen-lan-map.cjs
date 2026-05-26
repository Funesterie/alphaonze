#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.join(REPO_ROOT, 'a11', 'backend', 'apps', 'server');
const SIBLING_MAIN_ROOT = path.resolve(path.dirname(REPO_ROOT), 'funesterie');
const DEFAULT_CONFIG = path.join(__dirname, 'nossen-lan.example.json');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runtime', 'nossen', 'lan');
const DEFAULT_SCOPE_ID = 'nossen-lan-map';

const IMPORT_CONSTRAINTS = [
  'CREATE CONSTRAINT nossen_lan_map_id IF NOT EXISTS FOR (n:NossenLanMap) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT nossen_lan_host_id IF NOT EXISTS FOR (n:NossenLanHost) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT nossen_lan_endpoint_id IF NOT EXISTS FOR (n:NossenLanEndpoint) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT nossen_lan_runtime_id IF NOT EXISTS FOR (n:NossenLanRuntime) REQUIRE n.id IS UNIQUE',
];

const IMPORT_CYPHER = `
MERGE (scope:FunesterieEcosystemNode:NossenLanMap {id: $scope.id})
SET scope += $scope,
    scope.updatedAt = $now
MERGE (host:FunesterieEcosystemNode:NossenLanHost {id: $host.id})
SET host += $host,
    host.updatedAt = $now
MERGE (scope)-[hostLink:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'observes-lan-host',
  source: 'nossen-lan-map',
  targetId: host.id
}]->(host)
SET hostLink.label = host.name,
    hostLink.updatedAt = $now
WITH scope, host, [endpoint IN $endpoints | endpoint.id] AS endpointIds
CALL {
  WITH scope, endpointIds
  MATCH (scope)-[staleScope:FUNESTERIE_ECOSYSTEM_LINK {
    kind: 'tracks-lan-endpoint',
    source: 'nossen-lan-map'
  }]->(staleEndpoint:NossenLanEndpoint)
  WHERE NOT (staleEndpoint.id IN endpointIds)
  DELETE staleScope
  RETURN count(*) AS staleScopeLinks
}
CALL {
  WITH host, endpointIds
  MATCH (host)-[staleHost:FUNESTERIE_ECOSYSTEM_LINK {
    kind: 'can-reach-endpoint',
    source: 'nossen-lan-map'
  }]->(staleEndpoint:NossenLanEndpoint)
  WHERE NOT (staleEndpoint.id IN endpointIds)
  DELETE staleHost
  RETURN count(*) AS staleHostLinks
}
WITH scope, host
UNWIND $endpoints AS endpoint
MERGE (e:FunesterieEcosystemNode:NossenLanEndpoint {id: endpoint.id})
SET e += endpoint,
    e.updatedAt = $now
MERGE (scope)-[scopeLink:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'tracks-lan-endpoint',
  source: 'nossen-lan-map',
  targetId: endpoint.id
}]->(e)
SET scopeLink.label = endpoint.label,
    scopeLink.updatedAt = $now
MERGE (host)-[hostEndpoint:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'can-reach-endpoint',
  source: 'nossen-lan-map',
  targetId: endpoint.id
}]->(e)
SET hostEndpoint.status = endpoint.status,
    hostEndpoint.latencyMs = endpoint.latencyMs,
    hostEndpoint.updatedAt = $now
RETURN count(DISTINCT e) AS endpoints
`;

const IMPORT_RUNTIMES_CYPHER = `
MATCH (scope:NossenLanMap {id: $scopeId})
UNWIND $runtimes AS runtime
MERGE (r:FunesterieEcosystemNode:NossenLanRuntime {id: runtime.id})
SET r += runtime,
    r.updatedAt = $now
MERGE (scope)-[link:FUNESTERIE_ECOSYSTEM_LINK {
  kind: 'observes-local-runtime',
  source: 'nossen-lan-map',
  targetId: runtime.id
}]->(r)
SET link.status = runtime.status,
    link.updatedAt = $now
RETURN count(DISTINCT r) AS runtimes
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(args);
  const manifest = await buildLanManifest(config, args);
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
    host: manifest.host.name,
    endpoints: manifest.endpoints.length,
    runtimes: manifest.runtimes.length,
    reachable: manifest.stats.reachable,
    unreachable: manifest.stats.unreachable,
    files: outFiles,
    errors: manifest.errors,
    sync,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {
    config: '',
    endpoint: [],
    outDir: DEFAULT_OUT_DIR,
    timeoutMs: 2500,
    failOnUnreachable: false,
    sync: false,
    target: 'aura',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--config') args.config = next();
    else if (arg === '--endpoint') args.endpoint.push(next());
    else if (arg === '--out-dir') args.outDir = path.resolve(next());
    else if (arg === '--timeout-ms') args.timeoutMs = toPositiveInt(next(), args.timeoutMs);
    else if (arg === '--fail-on-unreachable') args.failOnUnreachable = true;
    else if (arg === '--sync') args.sync = true;
    else if (arg === '--target') args.target = String(next() || 'aura').toLowerCase();
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    else args.endpoint.push(arg);
  }

  if (!['aura', 'local', 'both'].includes(args.target)) {
    throw new Error('--target must be aura, local, or both');
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
NOSSEN radar

Usage:
  npm run nossen:lan:dry
  npm run nossen:radar
  npm run nossen:lan -- --endpoint https://mcp.funesterie.me/health --sync --target aura

Options:
  --config <file>            JSON config with endpoints.
  --endpoint <url>           Extra endpoint to probe. Can be repeated.
  --out-dir <path>           Output directory. Defaults to runtime/nossen/lan.
  --timeout-ms <n>           HTTP timeout per endpoint. Default: 2500.
  --fail-on-unreachable      Exit non-zero when an endpoint cannot be reached.
  --sync                     Write metadata to Neo4j.
  --target <aura|local|both> Neo4j target when --sync is used. Default: aura.

Safety:
  The radar stores DNS/TCP/HTTP/TLS status, host/runtime metadata and private interface names/IPs only.
  It never stores bearer tokens, passwords, request headers or response bodies.
`);
}

function loadConfig(args) {
  const configPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const base = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : { version: 1, endpoints: [] };

  const extraEndpoints = args.endpoint.map((url) => ({
    id: `manual-${hashText(url, 12)}`,
    label: url,
    url,
    kind: 'manual-http',
    zone: classifyZone(url),
    enabled: true,
  }));

  return {
    version: base.version || 1,
    scopeId: base.scopeId || DEFAULT_SCOPE_ID,
    label: base.label || 'NOSSEN LAN map',
    endpoints: [
      ...(Array.isArray(base.endpoints) ? base.endpoints : []),
      ...extraEndpoints,
    ],
  };
}

async function buildLanManifest(config, args) {
  const generatedAt = new Date().toISOString();
  const host = buildHostNode(generatedAt);
  const runtimes = detectLocalRuntimes(generatedAt);
  const manifest = {
    version: 1,
    kind: 'nossen-lan-map',
    generatedAt,
    scope: cleanProps({
      id: config.scopeId,
      kind: 'nossen-lan-map',
      label: config.label,
      name: 'NOSSEN LAN Map',
      summary: 'Reachability and runtime bridge for local and production Funesterie services.',
      mode: 'metadata-only',
      schema: 'nossen-lan-map/v1',
      updatedAt: generatedAt,
      generatedAt,
    }),
    host,
    runtimes,
    endpoints: [],
    errors: [],
    warnings: [],
    stats: {
      checked: 0,
      reachable: 0,
      unreachable: 0,
    },
  };

  const endpoints = config.endpoints.filter((endpoint) => endpoint && endpoint.enabled !== false && endpoint.url);
  for (const endpoint of endpoints) {
    const checked = await probeEndpoint(endpoint, args.timeoutMs, generatedAt);
    manifest.endpoints.push(checked);
    manifest.stats.checked += 1;
    if (checked.status === 'reachable') manifest.stats.reachable += 1;
    else manifest.stats.unreachable += 1;
    if (checked.status !== 'reachable') {
      const warning = { id: checked.id, url: checked.url, status: checked.status, message: checked.message };
      manifest.warnings.push(warning);
      if (args.failOnUnreachable) manifest.errors.push(warning);
    }
  }

  return manifest;
}

function buildHostNode(generatedAt) {
  const hostname = os.hostname();
  const interfaces = [];
  for (const [name, values] of Object.entries(os.networkInterfaces())) {
    for (const info of values || []) {
      if (info.internal || info.family !== 'IPv4') continue;
      interfaces.push({
        name,
        address: info.address,
        family: info.family,
        cidr: info.cidr || '',
      });
    }
  }

  return cleanProps({
    id: `nossen:lan-host:${hashText(`${hostname}|${os.platform()}|${os.arch()}`, 16)}`,
    kind: 'lan-host',
    label: hostname,
    name: hostname,
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    privateIpv4: interfaces.map((item) => item.address),
    interfaces: interfaces.map((item) => `${item.name}:${item.address}`),
    source: 'nossen-lan-map',
    updatedAt: generatedAt,
    lastSeenAt: generatedAt,
  });
}

function detectLocalRuntimes(generatedAt) {
  return [
    detectCommandRuntime('docker', ['--version'], generatedAt),
    detectCommandRuntime('podman', ['--version'], generatedAt),
    detectCommandRuntime('node', ['--version'], generatedAt),
    detectCommandRuntime('npm', ['--version'], generatedAt),
  ];
}

function detectCommandRuntime(command, args, generatedAt) {
  const id = `nossen:lan-runtime:${command}`;
  if (command === 'npm' && process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return cleanProps({
      id,
      kind: 'local-runtime',
      label: command,
      name: command,
      command: process.env.npm_execpath,
      status: 'available',
      version: pick(process.env.npm_config_user_agent, 'npm via npm_execpath').slice(0, 180),
      source: 'nossen-lan-map',
      updatedAt: generatedAt,
      lastSeenAt: generatedAt,
    });
  }

  const candidates = commandCandidates(command);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, args, {
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return cleanProps({
        id,
        kind: 'local-runtime',
        label: command,
        name: command,
        command: candidate,
        status: 'available',
        version: version.slice(0, 180),
        source: 'nossen-lan-map',
        updatedAt: generatedAt,
        lastSeenAt: generatedAt,
      });
    } catch {}
  }

  return cleanProps({
    id,
    kind: 'local-runtime',
    label: command,
    name: command,
    status: 'unavailable',
    source: 'nossen-lan-map',
    updatedAt: generatedAt,
    lastSeenAt: generatedAt,
  });
}

function commandCandidates(command) {
  if (process.platform !== 'win32') return [command];
  const fromWhere = [];
  try {
    const whereOutput = execFileSync('where.exe', [command], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    fromWhere.push(...whereOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {}

  return Array.from(new Set([
    ...fromWhere,
    command,
    `${command}.exe`,
    `${command}.cmd`,
    `${command}.bat`,
    `${command}.ps1`,
  ]));
}

async function probeEndpoint(endpoint, timeoutMs, generatedAt) {
  const startedAt = Date.now();
  const id = safeId(endpoint.id || `nossen:lan-endpoint:${hashText(endpoint.url, 24)}`);
  const urlMeta = parseEndpointUrl(endpoint.url);
  const base = {
    id,
    kind: endpoint.kind || 'http-endpoint',
    label: endpoint.label || endpoint.url,
    name: endpoint.label || endpoint.url,
    url: endpoint.url,
    protocol: urlMeta.protocol,
    hostname: urlMeta.hostname,
    port: urlMeta.port,
    path: urlMeta.path,
    routeKey: buildRouteKey(endpoint, urlMeta),
    zone: endpoint.zone || classifyZone(endpoint.url),
    agent: endpoint.agent || '',
    source: 'nossen-lan-map',
    updatedAt: generatedAt,
    lastSeenAt: generatedAt,
  };

  const dnsResult = await dnsProbe(urlMeta.hostname, timeoutMs);
  const tcpResult = await tcpProbe(urlMeta.hostname, urlMeta.port, timeoutMs);

  try {
    const result = await httpProbe(endpoint.url, timeoutMs);
    return cleanProps({
      ...base,
      ...dnsResult,
      ...tcpResult,
      status: result.ok ? 'reachable' : 'unreachable',
      httpStatus: result.statusCode,
      contentType: result.contentType,
      tlsStatus: result.tlsStatus,
      tlsSubject: result.tlsSubject,
      tlsIssuer: result.tlsIssuer,
      tlsValidFrom: result.tlsValidFrom,
      tlsValidTo: result.tlsValidTo,
      tlsFingerprintSha256: result.tlsFingerprintSha256,
      latencyMs: Date.now() - startedAt,
      message: result.message,
    });
  } catch (error) {
    return cleanProps({
      ...base,
      ...dnsResult,
      ...tcpResult,
      status: 'unreachable',
      tlsStatus: urlMeta.protocol === 'https:' ? classifyTlsError(error) : '',
      latencyMs: Date.now() - startedAt,
      message: String(error.message || error).slice(0, 240),
    });
  }
}

function parseEndpointUrl(url) {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol || '';
    return {
      protocol,
      hostname: parsed.hostname,
      port: Number(parsed.port || (protocol === 'https:' ? 443 : 80)),
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
    };
  } catch {
    return {
      protocol: '',
      hostname: '',
      port: 0,
      path: '',
    };
  }
}

function buildRouteKey(endpoint, urlMeta) {
  const agent = String(endpoint.agent || 'service').toLowerCase().replace(/[^\w.-]+/g, '-');
  const zone = String(endpoint.zone || classifyZone(endpoint.url)).toLowerCase().replace(/[^\w.-]+/g, '-');
  return `${zone}:${agent}:${urlMeta.hostname || 'invalid'}:${urlMeta.port || 0}`;
}

async function dnsProbe(hostname, timeoutMs) {
  if (!hostname) return { dnsStatus: 'invalid-host', dnsAddresses: [] };
  const startedAt = Date.now();
  try {
    const records = await withTimeout(dns.lookup(hostname, { all: true }), timeoutMs, 'dns timeout');
    const addresses = records.map((record) => `${record.address}/${record.family}`);
    return {
      dnsStatus: addresses.length ? 'resolved' : 'empty',
      dnsAddresses: addresses,
      dnsLatencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      dnsStatus: 'unresolved',
      dnsAddresses: [],
      dnsLatencyMs: Date.now() - startedAt,
      dnsMessage: String(error.code || error.message || error).slice(0, 120),
    };
  }
}

function tcpProbe(hostname, port, timeoutMs) {
  if (!hostname || !port) {
    return Promise.resolve({ tcpStatus: 'skipped', tcpLatencyMs: 0 });
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port, timeout: timeoutMs });
    const finish = (status, message = '') => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        tcpStatus: status,
        tcpLatencyMs: Date.now() - startedAt,
        tcpMessage: message.slice(0, 120),
      });
    };
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('timeout', `timeout after ${timeoutMs}ms`));
    socket.once('error', (error) => finish('closed', String(error.code || error.message || error)));
  });
}

function httpProbe(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'nossen-lan-map/1.0',
        Accept: 'application/json,text/plain,*/*',
      },
    }, (response) => {
      const tls = readTlsMetadata(response);
      response.resume();
      response.on('end', () => {
        const statusCode = Number(response.statusCode || 0);
        resolve({
          ok: statusCode >= 200 && statusCode < 500,
          statusCode,
          contentType: String(response.headers['content-type'] || '').slice(0, 120),
          ...tls,
          message: statusCode ? `HTTP ${statusCode}` : 'no status',
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

function readTlsMetadata(response) {
  const socket = response.socket;
  if (!socket || typeof socket.getPeerCertificate !== 'function') {
    return { tlsStatus: '' };
  }
  const cert = socket.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) {
    return { tlsStatus: 'none' };
  }
  return {
    tlsStatus: socket.authorized ? 'authorized' : `unauthorized:${socket.authorizationError || 'unknown'}`,
    tlsSubject: formatCertificateName(cert.subject),
    tlsIssuer: formatCertificateName(cert.issuer),
    tlsValidFrom: String(cert.valid_from || ''),
    tlsValidTo: String(cert.valid_to || ''),
    tlsFingerprintSha256: String(cert.fingerprint256 || '').replace(/:/g, '').toLowerCase(),
  };
}

function formatCertificateName(value) {
  if (!value || typeof value !== 'object') return '';
  return pick(value.CN, value.O, value.OU, JSON.stringify(value)).slice(0, 180);
}

function classifyTlsError(error) {
  const code = String(error?.code || '');
  if (code.startsWith('CERT_') || code.includes('CERT') || code.includes('TLS')) return `error:${code || 'tls'}`;
  return 'not-completed';
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function writeManifestFiles(manifest, args) {
  fs.mkdirSync(args.outDir, { recursive: true });
  const manifestPath = path.join(args.outDir, 'nossen-lan-map.json');
  const cypherPath = path.join(args.outDir, 'nossen-lan-map.cypher');
  const paramsPath = path.join(args.outDir, 'nossen-lan-map.params.json');

  writeJsonAtomic(manifestPath, manifest);
  fs.writeFileSync(cypherPath, `${IMPORT_CONSTRAINTS.join(';\n')};\n\n${IMPORT_CYPHER.trim()}\n\n${IMPORT_RUNTIMES_CYPHER.trim()}\n`, 'utf8');
  writeJsonAtomic(paramsPath, {
    scope: manifest.scope,
    host: manifest.host,
    endpoints: manifest.endpoints,
    runtimes: manifest.runtimes,
    scopeId: manifest.scope.id,
    now: manifest.generatedAt,
  });

  return { manifestPath, cypherPath, paramsPath };
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
          await session.run(IMPORT_CYPHER, {
            scope: manifest.scope,
            host: manifest.host,
            endpoints: manifest.endpoints,
            now: manifest.generatedAt,
          });
          await session.run(IMPORT_RUNTIMES_CYPHER, {
            scopeId: manifest.scope.id,
            runtimes: manifest.runtimes,
            now: manifest.generatedAt,
          });
          results.push({
            ok: true,
            name: endpoint.name,
            uri: endpoint.uri,
            database: endpoint.database,
            endpoints: manifest.endpoints.length,
            runtimes: manifest.runtimes.length,
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

function classifyZone(url) {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?/i.test(String(url || '')) ? 'local' : 'prod';
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

function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
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
  process.stderr.write(`[nossen-lan-map] ${error.stack || error.message || error}\n`);
  process.exit(1);
});
