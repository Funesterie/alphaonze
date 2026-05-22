#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const neo4j = require('neo4j-driver');

const {
  buildEcosystemScope,
  summarizeScope,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/ecosystem-scope.cjs');
const { hashtagNodeId } = require('../src/knowledge/identity-hashtags.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');

loadEnvIfExists(path.join(SERVER_ROOT, '.env.local'), true);
loadEnvIfExists(path.join(SERVER_ROOT, '.env'), false);
loadEnvIfExists(path.join(WORKSPACE_ROOT, 'a11mcp', '.env'), false);

const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');
const args = parseArgs(process.argv.slice(2));

async function main() {
  const githubRepos = args.skipGh ? null : fetchGithubRepos();
  const scope = buildEcosystemScope({
    workspaceRoot: WORKSPACE_ROOT,
    ...(githubRepos ? { githubRepos } : {}),
  });

  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  const jsonPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json');
  const markdownPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.md');
  const cypherPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.cypher');

  fs.writeFileSync(jsonPath, JSON.stringify(scope, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, toMarkdown(scope), 'utf8');
  fs.writeFileSync(cypherPath, toCypher(scope), 'utf8');

  if (args.dryRun) {
    return output({
      ok: true,
      dryRun: true,
      githubSource: githubRepos ? 'gh-cli' : 'fallback',
      scope: summarizeScope(scope),
      files: { jsonPath, markdownPath, cypherPath },
    });
  }

  const endpoints = resolveTargetEndpoints(args.target);
  const results = [];
  for (const endpoint of endpoints) results.push(await syncEndpoint(endpoint, scope));

  output({
    ok: results.every((result) => result.ok),
    dryRun: false,
    target: args.target,
    githubSource: githubRepos ? 'gh-cli' : 'fallback',
    scope: summarizeScope(scope),
    endpoints: results,
    files: { jsonPath, markdownPath, cypherPath },
  });
}

function fetchGithubRepos() {
  try {
    const raw = execFileSync('gh', [
      'repo',
      'list',
      'Funesterie',
      '--limit',
      '200',
      '--json',
      'name,visibility,url,defaultBranchRef,isArchived,description,primaryLanguage,languages',
    ], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const repos = JSON.parse(raw);
    return Array.isArray(repos) ? repos : null;
  } catch {
    return null;
  }
}

function resolveTargetEndpoints(target) {
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return [config.aura];
  if (target === 'both') return [config.local, config.aura];
  return [config.local];
}

async function syncEndpoint(endpoint, scope) {
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
        await syncScope(session, scope, endpoint);
        const summary = await session.run(`
          MATCH (scope:FunesterieEcosystemScope {id: $scopeId})
          OPTIONAL MATCH (scope)-[:DESCRIBES_REPO]->(repo:FunesterieRepository)
          OPTIONAL MATCH (scope)-[:DESCRIBES_MODULE]->(module:FunesterieLocalModule)
          OPTIONAL MATCH (scope)-[:DESCRIBES_PACKAGE]->(pkg:FunesteriePackage)
          OPTIONAL MATCH (scope)-[:DESCRIBES_CONTRACT]->(contract:FunesterieContract)
          OPTIONAL MATCH (:FunesterieEcosystemNode)-[r:FUNESTERIE_ECOSYSTEM_LINK]->(:FunesterieEcosystemNode)
          RETURN count(DISTINCT repo) AS repos,
                 count(DISTINCT module) AS modules,
                 count(DISTINCT pkg) AS packages,
                 count(DISTINCT contract) AS contracts,
                 count(DISTINCT r) AS links
        `, { scopeId: scope.id });
        const record = summary.records[0];
        return {
          ok: true,
          name: endpoint.name,
          uri: endpoint.uri,
          database: endpoint.database,
          repos: toPlain(record.get('repos')),
          modules: toPlain(record.get('modules')),
          packages: toPlain(record.get('packages')),
          contracts: toPlain(record.get('contracts')),
          links: toPlain(record.get('links')),
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        await session.close().catch(() => {});
      }
    } finally {
      await driver.close().catch(() => {});
    }
  } catch (error) {
    return {
      ok: false,
      name: endpoint?.name || 'unknown',
      uri: endpoint?.uri || '',
      database: endpoint?.database || '',
      error: error.code || error.name || 'Neo4jError',
      message: String(error.message || error).slice(0, 300),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function syncScope(session, scope, endpoint) {
  const constraints = [
    'CREATE CONSTRAINT funesterie_ecosystem_node_id IF NOT EXISTS FOR (n:FunesterieEcosystemNode) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_ecosystem_scope_id IF NOT EXISTS FOR (n:FunesterieEcosystemScope) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_repo_id IF NOT EXISTS FOR (n:FunesterieRepository) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_module_id IF NOT EXISTS FOR (n:FunesterieLocalModule) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_package_id IF NOT EXISTS FOR (n:FunesteriePackage) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_contract_id IF NOT EXISTS FOR (n:FunesterieContract) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_runtime_id IF NOT EXISTS FOR (n:FunesterieSharedRuntime) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_semantic_tool_id IF NOT EXISTS FOR (n:FunesterieSemanticTool) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_access_profile_id IF NOT EXISTS FOR (n:FunesterieAccessProfile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_identity_profile_id IF NOT EXISTS FOR (n:FunesterieIdentityProfile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_identity_hashtag_id IF NOT EXISTS FOR (n:FunesterieIdentityHashtag) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  await session.run(`
    MERGE (scope:FunesterieEcosystemNode:FunesterieEcosystemScope {id: $id})
    SET scope.label = $label,
        scope.org = $org,
        scope.schema = $schema,
        scope.mode = $mode,
        scope.workspaceRoot = $workspaceRoot,
        scope.generatedAt = datetime($generatedAt),
        scope.endpointName = $endpointName,
        scope.endpointUri = $endpointUri,
        scope.endpointDatabase = $endpointDatabase,
        scope.summary = $summary,
        scope.updatedAt = datetime($generatedAt)
  `, {
    id: scope.id,
    label: scope.label,
    org: scope.org,
    schema: scope.schema,
    mode: scope.mode,
    workspaceRoot: scope.workspaceRoot,
    generatedAt: scope.generatedAt,
    endpointName: endpoint.name,
    endpointUri: endpoint.uri,
    endpointDatabase: endpoint.database,
    summary: JSON.stringify(scope.summary),
  });

  await session.run(`
    MATCH (scope:FunesterieEcosystemScope {id: $scopeId})-[r:DESCRIBES_REPO|DESCRIBES_MODULE|DESCRIBES_PACKAGE|DESCRIBES_CONTRACT|DESCRIBES_RUNTIME|DESCRIBES_SEMANTIC_TOOL|DESCRIBES_ACCESS_PROFILE]->()
    DELETE r
  `, { scopeId: scope.id });

  await session.run(`
    MATCH ()-[r]->()
    WHERE r.source = 'funesterie-ecosystem-scope'
       OR type(r) = 'FUNESTERIE_ECOSYSTEM_LINK'
    DELETE r
  `);

  await upsertNodes(session, 'FunesterieRepository', scope.github.repos.map((repo) => ({
    id: `repo:${repo.name}`,
    props: {
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      archived: repo.archived,
      primaryLanguage: repo.primaryLanguage,
      languages: repo.languages || [],
      technicalRole: repo.profile?.technicalRole || '',
      category: repo.profile?.category || '',
      domains: repo.profile?.domains || [],
      confidence: repo.profile?.confidence || 'unknown',
      evidence: repo.profile?.evidence || [],
      curationNeeded: Boolean(repo.profile?.curationNeeded),
      restricted: Boolean(repo.profile?.restricted),
      identityProfileId: repo.identity?.id || '',
      identityType: repo.identity?.identityType || '',
      identityHashtags: repo.identityHashtags || [],
      functionalHashtags: repo.functionalHashtags || repo.identity?.functionalHashtags || [],
      narrativeHashtags: repo.narrativeHashtags || repo.identity?.narrativeHashtags || [],
      visualHashtags: repo.visualHashtags || repo.identity?.visualHashtags || [],
      visualStyle: repo.identity?.visualIdentity?.style || '',
      visualRepresentation: repo.identity?.visualIdentity?.representation || '',
      kind: 'github-repo',
    },
  })), scope, 'DESCRIBES_REPO');

  await upsertNodes(session, 'FunesterieLocalModule', scope.localModules.map((moduleInfo) => ({
    id: moduleInfo.id,
    props: {
      name: moduleInfo.name,
      kind: moduleInfo.kind,
      summary: moduleInfo.summary,
      relativePath: moduleInfo.relativePath,
      pathHash: moduleInfo.status.pathHash,
      exists: moduleInfo.status.exists,
      fileKind: moduleInfo.status.kind,
      modifiedAt: moduleInfo.status.modifiedAt,
      identityProfileId: moduleInfo.identity?.id || '',
      identityType: moduleInfo.identity?.identityType || '',
      identityHashtags: moduleInfo.identityHashtags || [],
      functionalHashtags: moduleInfo.functionalHashtags || moduleInfo.identity?.functionalHashtags || [],
      narrativeHashtags: moduleInfo.narrativeHashtags || moduleInfo.identity?.narrativeHashtags || [],
      visualHashtags: moduleInfo.visualHashtags || moduleInfo.identity?.visualHashtags || [],
      visualStyle: moduleInfo.identity?.visualIdentity?.style || '',
      visualRepresentation: moduleInfo.identity?.visualIdentity?.representation || '',
    },
  })), scope, 'DESCRIBES_MODULE');

  await upsertNodes(session, 'FunesteriePackage', scope.packages.map((pkg) => ({
    id: pkg.id,
    props: {
      name: pkg.name,
      version: pkg.version,
      relativePath: pkg.relativePath,
      private: pkg.private,
      scripts: pkg.scripts,
      dependencyCount: pkg.dependencyCount,
      funesterieDependencies: pkg.funesterieDependencies,
      publishedVersion: pkg.publishedVersion || '',
      releaseTag: pkg.releaseTag || '',
      registrySources: pkg.registrySources || [],
      sourceDoc: pkg.sourceDoc || '',
      packageSource: pkg.packageSource || 'local-package-json',
      summary: pkg.summary || '',
      exists: pkg.status.exists,
      pathHash: pkg.status.pathHash,
      identityProfileId: pkg.identity?.id || '',
      identityType: pkg.identity?.identityType || '',
      identityHashtags: pkg.identityHashtags || [],
      functionalHashtags: pkg.functionalHashtags || pkg.identity?.functionalHashtags || [],
      narrativeHashtags: pkg.narrativeHashtags || pkg.identity?.narrativeHashtags || [],
      visualHashtags: pkg.visualHashtags || pkg.identity?.visualHashtags || [],
      visualStyle: pkg.identity?.visualIdentity?.style || '',
      visualRepresentation: pkg.identity?.visualIdentity?.representation || '',
      kind: 'package',
    },
  })), scope, 'DESCRIBES_PACKAGE');

  await upsertNodes(session, 'FunesterieContract', scope.contracts.map((contract) => ({
    id: contract.id,
    props: {
      name: contract.name,
      kind: contract.kind,
      summary: contract.summary,
      relativePath: contract.relativePath,
      exists: contract.status.exists,
      pathHash: contract.status.pathHash,
      identityProfileId: contract.identity?.id || '',
      identityType: contract.identity?.identityType || '',
      identityHashtags: contract.identityHashtags || [],
      functionalHashtags: contract.functionalHashtags || contract.identity?.functionalHashtags || [],
      narrativeHashtags: contract.narrativeHashtags || contract.identity?.narrativeHashtags || [],
      visualHashtags: contract.visualHashtags || contract.identity?.visualHashtags || [],
      visualStyle: contract.identity?.visualIdentity?.style || '',
      visualRepresentation: contract.identity?.visualIdentity?.representation || '',
    },
  })), scope, 'DESCRIBES_CONTRACT');

  await upsertNodes(session, 'FunesterieSharedRuntime', scope.sharedRuntimes.map((runtime) => ({
    id: runtime.id,
    props: {
      ...runtime,
      identityProfileId: runtime.identity?.id || '',
      identityType: runtime.identity?.identityType || '',
      identityHashtags: runtime.identityHashtags || [],
      functionalHashtags: runtime.functionalHashtags || runtime.identity?.functionalHashtags || [],
      narrativeHashtags: runtime.narrativeHashtags || runtime.identity?.narrativeHashtags || [],
      visualHashtags: runtime.visualHashtags || runtime.identity?.visualHashtags || [],
      visualStyle: runtime.identity?.visualIdentity?.style || '',
      visualRepresentation: runtime.identity?.visualIdentity?.representation || '',
    },
  })), scope, 'DESCRIBES_RUNTIME');

  await upsertNodes(session, 'FunesterieSemanticTool', scope.semanticTools.map((tool) => ({
    id: tool.id,
    props: {
      ...tool,
      identityProfileId: tool.identity?.id || '',
      identityType: tool.identity?.identityType || '',
      identityHashtags: tool.identityHashtags || [],
      functionalHashtags: tool.functionalHashtags || tool.identity?.functionalHashtags || [],
      narrativeHashtags: tool.narrativeHashtags || tool.identity?.narrativeHashtags || [],
      visualHashtags: tool.visualHashtags || tool.identity?.visualHashtags || [],
      visualStyle: tool.identity?.visualIdentity?.style || '',
      visualRepresentation: tool.identity?.visualIdentity?.representation || '',
    },
  })), scope, 'DESCRIBES_SEMANTIC_TOOL');

  await upsertNodes(session, 'FunesterieAccessProfile', scope.accessProfiles.map((profile) => ({
    id: profile.id,
    props: {
      ...profile,
      identityProfileId: profile.identity?.id || '',
      identityType: profile.identity?.identityType || '',
      identityHashtags: profile.identityHashtags || [],
      functionalHashtags: profile.functionalHashtags || profile.identity?.functionalHashtags || [],
      narrativeHashtags: profile.narrativeHashtags || profile.identity?.narrativeHashtags || [],
      visualHashtags: profile.visualHashtags || profile.identity?.visualHashtags || [],
      visualStyle: profile.identity?.visualIdentity?.style || '',
      visualRepresentation: profile.identity?.visualIdentity?.representation || '',
    },
  })), scope, 'DESCRIBES_ACCESS_PROFILE');

  const identityProfiles = scope.identityLayer?.profiles || [];
  await upsertNodes(session, 'FunesterieIdentityProfile', identityProfiles.map((identity) => ({
    id: identity.id,
    props: {
      label: identity.label,
      identityType: identity.identityType,
      canonicalId: identity.canonicalId,
      hashtags: identity.hashtags || [],
      functionalHashtags: identity.functionalHashtags || [],
      narrativeHashtags: identity.narrativeHashtags || [],
      visualHashtags: identity.visualHashtags || [],
      routingTags: identity.routingTags || [],
      visualStyle: identity.visualIdentity?.style || '',
      palette: identity.visualIdentity?.palette || [],
      visualRepresentation: identity.visualIdentity?.representation || '',
      symbolicRepresentation: identity.visualIdentity?.symbolicRepresentation || '',
      humanRepresentationAllowed: identity.visualIdentity?.humanRepresentationAllowed === true,
      promptAnchor: identity.visualIdentity?.promptAnchor || '',
      sourceCardUse: identity.sourceCardUse || '',
      kind: 'identity-profile',
    },
  })), scope, 'DESCRIBES_IDENTITY_PROFILE');

  const hashtags = Array.from(new Set(identityProfiles.flatMap((identity) => identity.hashtags || []))).sort();
  await upsertNodes(session, 'FunesterieIdentityHashtag', hashtags.map((hashtag) => ({
    id: hashtagNodeId(hashtag),
    props: {
      label: hashtag,
      normalized: hashtag.replace(/^#/, ''),
      kind: 'identity-hashtag',
    },
  })), scope, 'DESCRIBES_IDENTITY_HASHTAG');

  const nodeIds = Array.from(new Set([
    scope.id,
    'github-org:funesterie',
    ...scope.links.flatMap((link) => [link.from, link.to]),
  ]));
  await session.run(`
    UNWIND $nodeIds AS id
    MERGE (node:FunesterieEcosystemNode {id: id})
    SET node.updatedAt = datetime($generatedAt)
  `, {
    nodeIds,
    generatedAt: scope.generatedAt,
  });

  for (const link of scope.links) {
    await session.run(`
      MATCH (a:FunesterieEcosystemNode {id: $from})
      MATCH (b:FunesterieEcosystemNode {id: $to})
      MERGE (a)-[r:${safeRel(link.type)}]->(b)
      SET r.label = $type,
          r.source = 'funesterie-ecosystem-scope',
          r.updatedAt = datetime($generatedAt)
      MERGE (a)-[generic:FUNESTERIE_ECOSYSTEM_LINK {kind: $type}]->(b)
      SET generic.source = 'funesterie-ecosystem-scope',
          generic.updatedAt = datetime($generatedAt)
    `, {
      from: link.from,
      to: link.to,
      type: link.type,
      generatedAt: scope.generatedAt,
    });
  }
}

async function upsertNodes(session, label, nodes, scope, scopeRelType) {
  const safeLabel = safeNeo4jToken(label);
  const safeScopeRel = safeRel(scopeRelType);
  const rows = nodes.map((node) => ({
    id: node.id,
    props: sanitizePropertyMap({ ...node.props, id: node.id }),
  }));
  await session.run(`
    MATCH (scope:FunesterieEcosystemScope {id: $scopeId})
    UNWIND $rows AS item
    MERGE (node:FunesterieEcosystemNode:${safeLabel} {id: item.id})
    SET node += item.props,
        node.updatedAt = datetime($generatedAt)
    MERGE (scope)-[r:${safeScopeRel}]->(node)
    SET r.updatedAt = datetime($generatedAt)
  `, {
    scopeId: scope.id,
    rows,
    generatedAt: scope.generatedAt,
  });
}

function safeNeo4jToken(value) {
  const token = String(value || 'Node').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(token) ? token : `L_${token}`;
}

function safeRel(value) {
  return safeNeo4jToken(String(value || 'RELATED_TO').toUpperCase());
}

function toPlain(value) {
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  return value;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    target: process.env.A11_ECOSYSTEM_SCOPE_TARGET || 'local',
    skipGh: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--skip-gh') parsed.skipGh = true;
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
  }
  if (!['local', 'aura', 'both'].includes(parsed.target)) parsed.target = 'local';
  return parsed;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

function loadEnvIfExists(filePath, override = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && (override || !Object.prototype.hasOwnProperty.call(process.env, key))) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

module.exports = {
  fetchGithubRepos,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}
