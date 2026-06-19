'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildIdentityLayer,
  compactIdentityProfile,
  hashtagNodeId,
  identityLinksForEntity,
  resolveIdentityProfile,
} = require('./identity-hashtags.cjs');

const ORG = 'Funesterie';
const SCHEMA = 'funesterie.ecosystem-scope.v1';

const FALLBACK_REPOS = [
  ['alphaonze', 'AlphaOnze monorepo', 'PRIVATE', 'master'],
  ['a11mcp', 'A11 MCP bridge for Funesterie agents, Neo4j Aura, Podman, and shared agent bus', 'PRIVATE', 'main'],
  ['flush', 'Unified flush repository, formerly qflush', 'PRIVATE', 'main'],
  ['rome', 'Tous les chemins menent a rome, utilitaire pour indexer plus facilement', 'PRIVATE', 'main'],
  ['spyder', 'minimoteur logique', 'PRIVATE', 'main'],
  ['freeland', 'Freeland - Universal System Decoder', 'PRIVATE', 'main'],
  ['nezlephant', 'endoage rgba + oc8', 'PRIVATE', 'main'],
  ['katana', '', 'PRIVATE', 'main'],
  ['nossen', '', 'PRIVATE', 'main'],
  ['funesterie', '', 'PUBLIC', ''],
].map(([name, description, visibility, defaultBranch]) => ({
  name,
  description,
  visibility,
  defaultBranch,
  url: `https://github.com/${ORG}/${name}`,
  archived: false,
}));

const LOCAL_MODULES = [
  ['alphaonze-root', 'AlphaOnze workspace root', '.', 'monorepo-root', 'Shared git root, docs, scripts and high-level deployment files.'],
  ['a11-backend-server', 'A11 backend server', 'a11/backend/apps/server', 'backend', 'Express/API/MCP-facing backend, image/video/audio routes and Neo4j sync scripts.'],
  ['a11-frontend-web', 'A11/K44/Vivy web surfaces', 'a11/frontend/apps/web', 'frontend', 'React/Vite surfaces for A11, K44, Vivy, casino and cockpit-style UI.'],
  ['a11mcp-bridge', 'A11 MCP shared bridge', 'a11mcp', 'mcp', 'HTTP/stdio MCP bridge, agent bus, discussions, public/private tool boundaries.'],
  ['qflush-libs', 'QFlush shared libs', 'a11/backend/libs', 'runtime-library', 'QFlush/Cortex/Spyder/Rome/Piccolo/Doctor module layer.'],
  ['dragon-runtime', 'Dragon runtime', 'a11/dragon', 'runtime-app', 'Dragon daemon/API/web contracts and shared packages.'],
  ['funesterie-desktop', 'Funesterie Desktop', 'a11/funesterie-desktop', 'desktop', 'Electron desktop shell and bundled MCP bridge runtime.'],
  ['a11-vsix', 'A11 VS Code extension', 'a11/vsix', 'developer-tool', 'VS Code extension bridge for local project interaction.'],
  ['alphaonze-afk', 'AlphaOnze AFK', 'alphaonze-afk', 'sidecar', 'AFK/runtime helper package and deployment surface.'],
  ['cockpit-netlify', 'Funesterie cockpit', 'scripts/cockpit', 'frontend-deploy', 'Netlify cockpit and MCP proxy entrypoints.'],
  ['runtime-shared', 'Shared runtime folder', 'runtime', 'runtime-data', 'Shared local runtime data, corpus, generated material and agent state.'],
  ['docs-shared', 'Shared docs', 'docs', 'documentation', 'Cross-ecosystem design notes, ops docs, handoffs and plans.'],
];

const PACKAGE_PATHS = [
  'package.json',
  'a11/package.json',
  'a11/backend/apps/server/package.json',
  'a11/frontend/package.json',
  'a11/frontend/apps/web/package.json',
  'a11/backend/libs/package.json',
  'a11mcp/package.json',
  'a11/dragon/package.json',
  'a11/dragon/apps/dragon-api/package.json',
  'a11/dragon/apps/dragon-daemon/package.json',
  'a11/dragon/apps/dragon-web/package.json',
  'a11/dragon/packages/contracts/package.json',
  'a11/dragon/packages/upstream/package.json',
  'a11/funesterie-desktop/package.json',
  'a11/vsix/package.json',
  'alphaonze-afk/package.json',
];

const NOSSEN_PUBLISHED_PACKAGES = [
  ['@nossen/allmight', '1.0.0', '@nossen/allmight@1.0.0'],
  ['@nossen/bat', '1.0.0', '@nossen/bat@1.0.0'],
  ['@nossen/bat-system', '1.0.0', '@nossen/bat-system@1.0.0'],
  ['@nossen/beam', '1.0.0', '@nossen/beam@1.0.0'],
  ['@nossen/envapt-superimg', '1.0.0', '@nossen/envapt-superimg@1.0.0'],
  ['@nossen/envaptex', '1.0.0', '@nossen/envaptex@1.0.0'],
  ['@nossen/freeland', '1.0.0', '@nossen/freeland@1.0.0'],
  ['@nossen/morphing', '1.0.0', '@nossen/morphing@1.0.0'],
  ['@nossen/nezlephant', '1.0.0', '@nossen/nezlephant@1.0.0'],
  ['@nossen/rome', '1.0.0', '@nossen/rome@1.0.0'],
  ['@nossen/scentgate', '1.0.0', '@nossen/scentgate@1.0.0'],
  ['@nossen/scream', '1.0.0', '@nossen/scream@1.0.0'],
  ['@nossen/spyder', '1.0.0', '@nossen/spyder@1.0.0'],
  ['@nossen/katana', '1.0.0', '@nossen/katana@1.0.0'],
  ['@nossen/freeland-bros', '1.0.0', '@nossen/freeland-bros@1.0.0'],
  ['@nossen/qflush-runner', '1.0.0', '@nossen/qflush-runner@1.0.0'],
  ['@nossen/dragon-contracts', '1.0.0', '@nossen/dragon-contracts@1.0.0'],
  ['@nossen/dragon-upstream', '1.0.0', '@nossen/dragon-upstream@1.0.0'],
  ['@nossen/dragon', '1.0.0', '@nossen/dragon@1.0.0'],
  ['@nossen/qflush', '1.0.1', '@nossen/qflush@1.0.1'],
];

const CONTRACTS = [
  ['a11-mcp-stdio', 'A11 MCP stdio contract', 'a11/backend/apps/server/tools/mcp/a11-mcp-server.cjs', 'mcp-contract', 'Local stdio MCP tool surface for Codex/Kiro/A11.'],
  ['a11mcp-http-jsonrpc', 'A11MCP HTTP JSON-RPC', 'a11mcp/README.md', 'mcp-contract', 'Shared HTTP MCP endpoint, public/private split, token policy and agent bus docs.'],
  ['route-map-json', 'A11 route map JSON', 'a11/runtime/knowledge-graph/a11-route-map.json', 'semantic-contract', 'Recovery map for local services, identities, endpoints and graph roots.'],
  ['runtime-hooks-json', 'A11 runtime hooks JSON', 'a11/runtime/knowledge-graph/a11-runtime-hooks.json', 'semantic-contract', 'Runtime hook map for Cortex, Spyder, Rome, Doctor, Piccolo, Corpus and Neo4j.'],
  ['agent-domain-pack-json', 'Agent domain pack JSON', 'a11/runtime/knowledge-graph/a11-agent-domain-pack.json', 'semantic-contract', 'A11/K44/Vivy domains, tools, SFX, culture lanes and source policy.'],
  ['ecosystem-scope-json', 'Ecosystem scope JSON', 'a11/runtime/knowledge-graph/funesterie-ecosystem-scope.json', 'semantic-contract', 'Full org/module/package/contract/runtime connector visibility map.'],
  ['dragon-manifest', 'Dragon manifest', 'a11/dragon/DRAGON_MANIFEST.json', 'runtime-contract', 'Dragon package/app/daemon/API manifest.'],
  ['kiro-mcp-settings', 'Kiro MCP settings', '.kiro/settings/mcp.json', 'mcp-config', 'Local MCP server wiring; secrets must stay redacted and out of graph properties.'],
  ['chatgpt-mcp-oauth-tests', 'MCP OAuth tests', 'a11/backend/apps/server/test/mcp-oauth.node.test.cjs', 'auth-contract', 'Regression guard for ChatGPT Enterprise/OAuth MCP behavior.'],
];

const SHARED_RUNTIMES = [
  ['neo4j-local', 'Neo4j local graph', 'graph', 'Local semantic memory and route graph.'],
  ['neo4j-aura', 'Neo4j Aura / Kiro2 graph', 'graph', 'Remote graph endpoint for cross-agent memory and topology.'],
  ['agent-bus', 'Agent bus', 'coordination', 'Append-only presence, jobs, discussions and coordination messages.'],
  ['r2-files', 'Cloudflare R2 files', 'object-storage', 'Generated/public assets and controlled downloadable artifacts.'],
  ['netlify-surfaces', 'Netlify surfaces', 'frontend-hosting', 'Cockpit, public pages and static deployment routes.'],
  ['render-services', 'Render services', 'backend-hosting', 'A11/K44/Vivy backend deployment targets.'],
  ['qflush-runtime', 'QFlush runtime bus', 'local-action', 'Bounded gamepad, keyboard, mouse and demo/runtime actions.'],
  ['corpus-library', 'Corpus library', 'knowledge-store', 'Future source-card and educational corpus library.'],
];

const SEMANTIC_TOOLS = [
  ['rome', 'Rome', 'index-and-route', 'Routes paths, links artifacts and keeps the ecosystem navigable.'],
  ['doctor', 'Doctor', 'diagnostics', 'Checks broken wiring, missing files, auth state and runtime health.'],
  ['piccolo', 'Piccolo', 'repair', 'Runs small safe repair passes and snapshots.'],
  ['spyder', 'Spyder', 'scanner', 'Scans routes, configs and memory hints without storing secrets.'],
  ['cortex', 'Cortex', 'packet-router', 'Routes runtime packets and action hints.'],
  ['telemetry', 'Telemetry', 'events', 'Keeps runtime history and event traces queryable.'],
  ['corpus', 'Corpus', 'source-index', 'Indexes curated source cards, local docs and safe summaries.'],
  ['agent-domain-pack', 'Agent Domain Pack', 'domain-index', 'Maps A11/K44/Vivy domains, culture lanes and SFX.'],
  ['ecosystem-scope', 'Ecosystem Scope', 'org-index', 'Maps repos, packages, contracts, runtimes and connector visibility.'],
  ['neo4j-memory-router', 'Neo4j Memory Router', 'graph-router', 'Routes safe memory writes/searches between local and Aura graphs.'],
];

const ACCESS_PROFILES = [
  {
    id: 'codex-local-github-cli',
    label: 'Codex local GitHub CLI',
    kind: 'trusted-local',
    currentScopesHint: ['repo', 'read:org', 'workflow'],
    canSee: ['github-org-repos', 'private-repos', 'actions-workflows'],
    boundary: 'CLI token stays in OS credential store; graph stores scope names only.',
  },
  {
    id: 'a11-mcp-stdio-local',
    label: 'A11 MCP stdio local',
    kind: 'trusted-local',
    canSee: ['a11-workspace', 'route-map', 'runtime-hooks', 'ecosystem-scope'],
    boundary: 'Safe tool annotations, no raw secrets in tool output.',
  },
  {
    id: 'a11mcp-private-http',
    label: 'A11MCP private HTTP',
    kind: 'trusted-private',
    canSee: ['agent-bus', 'discussions', 'neo4j-status', 'safe-memory-write'],
    boundary: 'Bearer token required; shell/files/secrets stay off public profile.',
  },
  {
    id: 'a11mcp-chatgpt-public',
    label: 'A11MCP ChatGPT public',
    kind: 'public-limited',
    canSee: ['public-docs', 'status', 'safe-readonly-metadata'],
    boundary: 'No local files, no tokens, no Neo4j writes, no shell.',
  },
];

const REPO_PROFILES = {
  alphaonze: ['monorepo', 'Main application monorepo for A11, K44, Vivy, backend routes, frontend surfaces, desktop packaging, runtime scripts and deployment glue.', ['a11', 'frontend', 'backend', 'desktop', 'mcp', 'neo4j', 'runtime'], 'high', ['github-description', 'local-workspace']],
  a11mcp: ['mcp-bridge', 'Shared MCP bridge for Funesterie agents, Neo4j/Aura, Podman profiles, public/private tool boundaries, discussions and agent bus coordination.', ['mcp', 'agent-bus', 'neo4j', 'coordination'], 'high', ['github-description', 'local-workspace']],
  flush: ['runtime-orchestrator', 'Unified QFlush runtime repository for bounded orchestration, command surfaces, gamepad/demo control and shared automation primitives.', ['qflush', 'runtime', 'orchestration', 'local-actions'], 'high', ['github-description', 'language-map']],
  carmelo: ['game-ui', 'Pirate-slots React/Vite/Electron game or demo surface with smoke playtests and Netlify/Vite packaging.', ['game', 'react', 'vite', 'electron', 'playtest'], 'medium', ['package-name:pirate-slots', 'root-files:index.html,src,public']],
  nossen: ['unity-game', 'Unity/ShaderLab moto drag game project; README identifies it as the Nossen motorcycle drag game depot.', ['unity', 'shaderlab', 'game', 'nossen'], 'high', ['readme', 'languages:ShaderLab,C#', 'root-files:Assets,ProjectSettings']],
  katana: ['code-refactor-tool', 'Node/Express oversized-file scanner that produces extraction plans for routes, helpers and service families before refactors.', ['code-analysis', 'refactor', 'node', 'express'], 'high', ['readme', 'package-name:funesterie-katana']],
  'katana-c710f792': ['placeholder', 'Empty or generated Katana placeholder repository; keep indexed for visibility but mark for triage before agent use.', ['triage'], 'low', ['no-default-branch', 'no-languages'], true],
  allmight: ['code-audit-tool', 'Duplicate-family auditor that finds exact/near duplicates, chooses canonical sources and proposes safe transition patches.', ['code-analysis', 'dedupe', 'safe-refactor'], 'high', ['readme', 'package-name:@nossen/allmight']],
  'demo-repository': ['demo', 'GitHub demo repository kept as low-priority reference material, not a core runtime component.', ['github-demo'], 'medium', ['github-description']],
  freeland: ['decoder', 'Universal System Decoder package used to normalize, inspect and classify values across Funesterie systems.', ['semantic-decoder', 'runtime-values'], 'high', ['github-description', 'package-family']],
  scream: ['semantic-prototype', 'Semantic prototype exposing SCREAM, WAZAA and MASK layers for resonance graphs, intermediate semantic structures and normalization/compilation.', ['semantic', 'mask', 'wazaa', 'text-structure'], 'high', ['readme', 'package-name:@nossen/scream']],
  morphing: ['binary-primitive', 'Compact 4-byte value shape shared across RGBA pixels, OC8 payloads, QFlush memory, A11 state and Spyder graphs.', ['rgba', 'oc8', 'binary', 'interop'], 'high', ['readme', 'package-name:@nossen/morphing']],
  nezlephant: ['encoding-tool', 'RGBA/OC8-oriented package in the Funesterie value/encoding family; linked to endoage and low-level media/state encoding.', ['rgba', 'oc8', 'encoding'], 'medium', ['github-description', 'package-dependency']],
  rome: ['navigator', 'Navigation/linking/indexing utility: keeps paths, route maps and execution context discoverable for agents.', ['paths', 'links', 'indexing', 'agent-navigation'], 'high', ['github-description', 'runtime-hooks']],
  'envapt-multi': ['env-config-library', 'Environment configuration library/workspace for typed env parsing, transformations, templates and Nezlephant-related package work.', ['env', 'configuration', 'typescript', 'nezlephant'], 'high', ['readme', 'package-name:@nossen/envaptex']],
  spyder: ['scanner', 'Scanner and memory-hint runtime module; collects routes/config signals and feeds agent-visible diagnostics.', ['scan', 'memory-hints', 'runtime-diagnostics'], 'high', ['github-description', 'runtime-hooks']],
  bat: ['request-control', 'Adaptive request-control family that classifies, adapts and retries network/tool execution channels carefully.', ['network', 'retry', 'tool-execution', 'adaptive-control'], 'high', ['readme', 'package-name:@nossen/bat']],
  funesterie: ['identity-anchor', 'Public organization placeholder/repo with no default branch content visible yet; keep as public identity anchor only.', ['public-identity'], 'low', ['public-repo', 'no-default-branch'], true],
  'freeland-bros': ['diagnostic-visualizer', 'Visual and diagnostic layer on top of Freeland for explaining decoded values, normalization and runtime compatibility.', ['freeland', 'diagnostics', 'visualization'], 'high', ['readme', 'package-name:@nossen/freeland-bros']],
  envaptex: ['placeholder', 'Empty or package-name holder for the Envapt/Envaptex family; use envapt-multi as the active source until this repo is clarified.', ['env', 'triage'], 'low', ['no-default-branch', 'no-languages'], true],
  beam: ['pipeline-vocabulary', 'Pipeline vocabulary layer for QFlush, normalizing execution styles such as beam, drill, bomb, fusion and ultra.', ['qflush', 'pipeline', 'execution-model'], 'high', ['readme', 'package-name:@nossen/beam']],
  marvin: ['static-site', 'Small static/Netlify site surface with HTML/CSS/JS assets; likely presentation or lightweight public page.', ['netlify', 'static-site', 'presentation'], 'medium', ['root-files:site,netlify.toml,logo.PNG', 'languages:HTML,CSS,JavaScript']],
  chat: ['placeholder', 'Empty chat placeholder repository; keep indexed but require curation before routing agent work here.', ['chat', 'triage'], 'low', ['no-default-branch', 'no-languages'], true],
  secret: ['restricted-artifact-store', 'Restricted artifact/package holding area; metadata-only indexing, never expose or ingest contents into public MCP.', ['restricted', 'package-artifact'], 'medium', ['root-file:tgz-artifact'], true, true],
  'moto2.html': ['placeholder', 'Tiny placeholder/static experiment repository; not enough content for autonomous agent routing yet.', ['static-experiment', 'triage'], 'low', ['minimal-root-files'], true],
};

function buildEcosystemScope(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '..', '..', '..', '..', '..'));
  const githubRepos = normalizeRepos(options.githubRepos || FALLBACK_REPOS);
  const localModules = LOCAL_MODULES.map(([id, name, relPath, kind, summary]) => withIdentity({
    id,
    name,
    kind,
    summary,
    path: path.join(workspaceRoot, relPath),
    relativePath: relPath,
    status: fileStatus(path.join(workspaceRoot, relPath)),
  }, id, { type: 'module' }));
  const discoveredPackages = PACKAGE_PATHS
    .map((relPath) => readPackageInfo(workspaceRoot, relPath))
    .filter(Boolean);
  const packages = mergePublishedNossenPackages(workspaceRoot, discoveredPackages)
    .map((pkg) => withIdentity(pkg, pkg.id, { type: 'package', domains: pkg.funesterieDependencies || [] }));
  const contracts = CONTRACTS.map(([id, name, relPath, kind, summary]) => withIdentity({
    id,
    name,
    kind,
    summary,
    path: path.join(workspaceRoot, relPath),
    relativePath: relPath,
    status: fileStatus(path.join(workspaceRoot, relPath)),
  }, id, { type: 'contract' }));
  const sharedRuntimes = SHARED_RUNTIMES.map(([id, name, kind, summary]) => withIdentity({ id, name, kind, summary }, id, { type: 'runtime' }));
  const semanticTools = SEMANTIC_TOOLS.map(([id, name, kind, summary]) => withIdentity({ id, name, kind, summary }, id, { type: 'module' }));
  const accessProfiles = ACCESS_PROFILES.map((profile) => withIdentity(profile, profile.id, { type: 'access-profile', kind: profile.kind }));
  const identityLayer = buildIdentityLayer([
    ...githubRepos.map((repo) => ({ id: `repo:${repo.name}`, name: repo.name, identity: repo.identity })),
    ...localModules,
    ...packages,
    ...contracts,
    ...sharedRuntimes,
    ...semanticTools,
    ...accessProfiles,
  ]);
  const links = buildLinks({ githubRepos, localModules, packages, contracts, sharedRuntimes, semanticTools, accessProfiles, identityLayer });

  return {
    ok: true,
    schema: SCHEMA,
    id: 'funesterie-ecosystem-scope',
    org: ORG,
    label: 'Funesterie ecosystem connector scope',
    mode: 'metadata-only-cross-repo-index',
    generatedAt,
    workspaceRoot,
    sourcePolicy: {
      noSecrets: true,
      metadataOnly: true,
      githubScopeNeeded: ['repo', 'read:org', 'workflow'],
      connectorGoal: 'Expose the whole Funesterie org graph to trusted Codex/MCP profiles while keeping public MCP profiles read-only and secret-free.',
      publicBoundary: 'Public ChatGPT/MCP tools receive status, docs and generated summaries only.',
    },
    github: {
      org: ORG,
      repoCount: githubRepos.length,
      repos: githubRepos,
    },
    localModules,
    packages,
    contracts,
    sharedRuntimes,
    semanticTools,
    accessProfiles,
    identityLayer,
    links,
    summary: {
      repos: githubRepos.length,
      privateRepos: githubRepos.filter((repo) => repo.visibility === 'PRIVATE').length,
      publicRepos: githubRepos.filter((repo) => repo.visibility === 'PUBLIC').length,
      curatedRepoProfiles: githubRepos.filter((repo) => repo.profile?.confidence === 'high').length,
      reposNeedingCuration: githubRepos.filter((repo) => repo.profile?.curationNeeded).length,
      localModules: localModules.length,
      localModulesPresent: localModules.filter((item) => item.status.exists).length,
      packages: packages.length,
      contracts: contracts.length,
      contractsPresent: contracts.filter((item) => item.status.exists).length,
      sharedRuntimes: sharedRuntimes.length,
      semanticTools: semanticTools.length,
      accessProfiles: accessProfiles.length,
      identityProfiles: identityLayer.summary.profiles,
      identityHashtags: identityLayer.summary.hashtags,
      links: links.length,
    },
  };
}

function withIdentity(entity, entityId, context = {}) {
  const identity = compactIdentityProfile(resolveIdentityProfile(entityId, {
    ...context,
    ...entity,
    id: entityId,
    name: entity.name || entity.label || entityId,
    domains: entity.domains || entity.profile?.domains || context.domains || [],
    category: entity.profile?.category || context.category || entity.kind,
    summary: entity.summary || entity.description || entity.profile?.technicalRole || context.summary,
  }));
  return {
    ...entity,
    identity,
    identityHashtags: identity.hashtags,
    functionalHashtags: identity.functionalHashtags,
    narrativeHashtags: identity.narrativeHashtags,
    visualHashtags: identity.visualHashtags,
  };
}

function normalizeRepos(repos) {
  return (Array.isArray(repos) ? repos : [])
    .map((repo) => {
      const defaultBranch = typeof repo.defaultBranch === 'string'
        ? repo.defaultBranch
        : repo.defaultBranchRef?.name || '';
      return {
        name: String(repo.name || '').trim(),
        description: String(repo.description || '').trim(),
        visibility: String(repo.visibility || 'UNKNOWN').trim().toUpperCase(),
        defaultBranch,
        url: String(repo.url || '').trim() || `https://github.com/${ORG}/${repo.name || ''}`,
        archived: Boolean(repo.archived ?? repo.isArchived),
        primaryLanguage: repo.primaryLanguage?.name || repo.primaryLanguage || null,
        languages: (repo.languages || []).map((entry) => entry?.node?.name || entry?.name || entry).filter(Boolean),
      };
    })
    .filter((repo) => repo.name)
    .map((repo) => {
      const profile = deriveRepoProfile(repo);
      return withIdentity({ ...repo, profile }, `repo:${repo.name}`, {
        type: 'repo',
        kind: profile.category,
        domains: profile.domains,
        summary: profile.technicalRole,
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function deriveRepoProfile(repo) {
  const known = REPO_PROFILES[repo.name];
  if (known) {
    const [category, technicalRole, domains, confidence, evidence, curationNeeded = false, restricted = false] = known;
    return { category, technicalRole, domains, confidence, evidence, curationNeeded, restricted };
  }
  const language = repo.primaryLanguage || repo.languages?.[0] || 'unknown';
  const hasDescription = Boolean(String(repo.description || '').trim());
  return {
    technicalRole: hasDescription
      ? repo.description
      : `Unclassified ${language} repository in the Funesterie org; needs a README or package description before autonomous routing.`,
    category: hasDescription ? 'described-repo' : 'unclassified',
    domains: language === 'unknown' ? ['triage'] : [String(language).toLowerCase(), 'triage'],
    confidence: hasDescription ? 'medium' : 'low',
    evidence: hasDescription ? ['github-description'] : ['missing-description'],
    curationNeeded: !hasDescription,
    restricted: false,
  };
}

function readPackageInfo(workspaceRoot, relPath) {
  const fullPath = path.join(workspaceRoot, relPath);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return null;
  }
  const deps = {
    ...json.dependencies,
    ...json.devDependencies,
    ...json.optionalDependencies,
    ...json.peerDependencies,
  };
  const dependencyNames = Object.keys(deps || {}).sort();
  const funesterieDependencies = dependencyNames.filter((name) => /^@nossen\//.test(name) || /funesterie|qflush|rome|spyder|nezlephant/i.test(name));
  return {
    id: `package:${normalizeId(json.name || relPath)}:${hashText(relPath).slice(0, 8)}`,
    name: String(json.name || path.dirname(relPath) || 'package'),
    version: String(json.version || ''),
    relativePath: relPath,
    path: fullPath,
    private: Boolean(json.private),
    scripts: Object.keys(json.scripts || {}).sort(),
    dependencyCount: dependencyNames.length,
    funesterieDependencies,
    status: fileStatus(fullPath),
  };
}

function mergePublishedNossenPackages(workspaceRoot, packages) {
  const releaseDocRelPath = 'docs/ops/NOSSEN_RELEASE_ALIGNMENT_2026-05-18.md';
  const releaseDocPath = path.join(workspaceRoot, releaseDocRelPath);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  for (const [name, version, releaseTag] of NOSSEN_PUBLISHED_PACKAGES) {
    const existing = byName.get(name);
    if (existing) {
      existing.publishedVersion = version;
      existing.releaseTag = releaseTag;
      existing.registrySources = uniqueStrings([...(existing.registrySources || []), 'npmjs', 'jfrog']);
      existing.sourceDoc = releaseDocRelPath;
      existing.packageSource = existing.packageSource || 'local-package-json';
      continue;
    }

    packages.push({
      id: `package:${normalizeId(name)}:published`,
      name,
      version,
      publishedVersion: version,
      releaseTag,
      relativePath: releaseDocRelPath,
      path: releaseDocPath,
      private: false,
      scripts: [],
      dependencyCount: 0,
      funesterieDependencies: [],
      status: fileStatus(releaseDocPath),
      registrySources: ['npmjs', 'jfrog'],
      sourceDoc: releaseDocRelPath,
      packageSource: 'nossen-release-alignment',
      summary: `Published NOSSEN package ${name} recorded by the release alignment manifest.`,
    });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map(String).filter(Boolean))).sort();
}

function buildLinks({ githubRepos, localModules, packages, contracts, sharedRuntimes, semanticTools, accessProfiles, identityLayer }) {
  const links = [];
  links.push(['ecosystem-scope', 'HAS_IDENTITY_LAYER', identityLayer.id]);
  for (const identity of identityLayer.profiles || []) {
    links.push(['ecosystem-scope', 'HAS_IDENTITY_PROFILE', identity.id]);
    for (const hashtag of identity.hashtags || []) links.push([identity.id, 'HAS_HASHTAG', hashtagNodeId(hashtag)]);
  }
  for (const repo of githubRepos) {
    links.push(['github-org:funesterie', 'OWNS_REPO', `repo:${repo.name}`]);
    pushIdentityLinks(links, `repo:${repo.name}`, repo.identity);
  }
  for (const moduleInfo of localModules) {
    links.push(['ecosystem-scope', 'INDEXES_MODULE', moduleInfo.id]);
    pushIdentityLinks(links, moduleInfo.id, moduleInfo.identity);
    const repoName = inferRepoForModule(moduleInfo);
    if (repoName) links.push([moduleInfo.id, 'LOCAL_VIEW_OF_REPO', `repo:${repoName}`]);
  }
  for (const pkg of packages) {
    links.push(['ecosystem-scope', 'INDEXES_PACKAGE', pkg.id]);
    pushIdentityLinks(links, pkg.id, pkg.identity);
    const moduleId = inferModuleForPath(pkg.relativePath);
    if (moduleId) links.push([moduleId, 'HAS_PACKAGE', pkg.id]);
    for (const dep of pkg.funesterieDependencies || []) {
      links.push([pkg.id, 'USES_FUNESTERIE_PACKAGE', `dependency:${dep}`]);
    }
  }
  for (const contract of contracts) {
    links.push(['ecosystem-scope', 'INDEXES_CONTRACT', contract.id]);
    pushIdentityLinks(links, contract.id, contract.identity);
    const moduleId = inferModuleForPath(contract.relativePath);
    if (moduleId) links.push([moduleId, 'USES_CONTRACT', contract.id]);
  }
  for (const runtime of sharedRuntimes) {
    links.push(['ecosystem-scope', 'INDEXES_RUNTIME', runtime.id]);
    pushIdentityLinks(links, runtime.id, runtime.identity);
  }
  for (const tool of semanticTools) {
    links.push(['ecosystem-scope', 'INDEXES_SEMANTIC_TOOL', tool.id]);
    pushIdentityLinks(links, tool.id, tool.identity);
    links.push([tool.id, 'WRITES_OR_ROUTES_CONTEXT_FOR', 'neo4j-local']);
  }
  for (const profile of accessProfiles || []) pushIdentityLinks(links, profile.id, profile.identity);
  links.push(['a11mcp-bridge', 'EXPOSES_SCOPE', 'ecosystem-scope']);
  links.push(['a11-backend-server', 'READS_SCOPE', 'ecosystem-scope']);
  links.push(['ecosystem-scope', 'FEEDS', 'corpus-library']);
  links.push(['ecosystem-scope', 'WRITES_TO', 'neo4j-local']);
  links.push(['ecosystem-scope', 'WRITES_TO', 'neo4j-aura']);
  links.push(['codex-local-github-cli', 'CAN_INDEX', 'github-org:funesterie']);
  links.push(['a11-mcp-stdio-local', 'CAN_READ', 'ecosystem-scope']);
  links.push(['a11mcp-private-http', 'CAN_READ', 'ecosystem-scope']);
  links.push(['a11mcp-chatgpt-public', 'CAN_READ_SUMMARY_OF', 'ecosystem-scope']);
  return links.map(([from, type, to]) => ({ from, type, to }));
}

function pushIdentityLinks(links, entityId, identity) {
  for (const link of identityLinksForEntity(entityId, identity)) links.push([link.from, link.type, link.to]);
}

function inferRepoForModule(moduleInfo) {
  if (moduleInfo.id === 'a11mcp-bridge') return 'a11mcp';
  if (moduleInfo.id === 'qflush-libs') return 'flush';
  if (moduleInfo.id === 'alphaonze-afk') return 'alphaonze-afk';
  return 'alphaonze';
}

function inferModuleForPath(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  const sorted = LOCAL_MODULES
    .map(([id, , modulePath]) => ({ id, modulePath: modulePath.replace(/\\/g, '/') }))
    .filter((entry) => entry.modulePath !== '.')
    .sort((a, b) => b.modulePath.length - a.modulePath.length);
  const found = sorted.find((entry) => normalized === entry.modulePath || normalized.startsWith(`${entry.modulePath}/`));
  return found?.id || 'alphaonze-root';
}

function fileStatus(targetPath) {
  const fullPath = path.resolve(targetPath);
  try {
    const stat = fs.statSync(fullPath);
    return {
      exists: true,
      kind: stat.isDirectory() ? 'directory' : 'file',
      sizeBytes: stat.isDirectory() ? null : stat.size,
      modifiedAt: stat.mtime.toISOString(),
      pathHash: hashText(fullPath),
    };
  } catch {
    return {
      exists: false,
      kind: 'missing',
      sizeBytes: null,
      modifiedAt: null,
      pathHash: hashText(fullPath),
    };
  }
}

function summarizeScope(scope) {
  return {
    id: scope.id,
    generatedAt: scope.generatedAt,
    repos: scope.summary.repos,
    privateRepos: scope.summary.privateRepos,
    publicRepos: scope.summary.publicRepos,
    curatedRepoProfiles: scope.summary.curatedRepoProfiles,
    reposNeedingCuration: scope.summary.reposNeedingCuration,
    localModules: scope.summary.localModules,
    localModulesPresent: scope.summary.localModulesPresent,
    packages: scope.summary.packages,
    contracts: scope.summary.contracts,
    contractsPresent: scope.summary.contractsPresent,
    semanticTools: scope.summary.semanticTools,
    accessProfiles: scope.summary.accessProfiles,
    identityProfiles: scope.summary.identityProfiles,
    identityHashtags: scope.summary.identityHashtags,
    links: scope.summary.links,
  };
}

function toMarkdown(scope) {
  const lines = [
    '# Funesterie Ecosystem Scope',
    '',
    `Generated: ${scope.generatedAt}`,
    `Org: ${scope.org}`,
    `Mode: ${scope.mode}`,
    '',
    '## GitHub Repos',
    '',
  ];
  for (const repo of scope.github.repos) {
    const confidence = repo.profile?.confidence ? `, ${repo.profile.confidence}` : '';
    const curation = repo.profile?.curationNeeded ? ', needs curation' : '';
    lines.push(`- ${repo.name} (${repo.visibility}${repo.defaultBranch ? `, ${repo.defaultBranch}` : ''}${confidence}${curation}): ${repo.profile?.technicalRole || repo.description || repo.url}`);
  }
  lines.push('', '## Local Modules', '');
  for (const moduleInfo of scope.localModules) {
    lines.push(`- ${moduleInfo.name} (${moduleInfo.kind}): ${moduleInfo.relativePath} [${moduleInfo.status.exists ? 'present' : 'missing'}]`);
  }
  lines.push('', '## Packages', '');
  for (const pkg of scope.packages) {
    lines.push(`- ${pkg.name}${pkg.version ? `@${pkg.version}` : ''}: ${pkg.relativePath} (${pkg.dependencyCount} deps)`);
  }
  lines.push('', '## Contracts', '');
  for (const contract of scope.contracts) {
    lines.push(`- ${contract.name}: ${contract.relativePath} [${contract.status.exists ? 'present' : 'missing'}]`);
  }
  lines.push('', '## Access Profiles', '');
  for (const profile of scope.accessProfiles) {
    lines.push(`- ${profile.label}: ${profile.boundary}`);
  }
  lines.push('', '## Identity Hashtags', '');
  for (const identity of scope.identityLayer.profiles) {
    lines.push(`- ${identity.label} (${identity.identityType}): ${identity.hashtags.join(' ')}`);
    lines.push(`  - visual: ${identity.visualIdentity.style}; ${identity.visualIdentity.representation}`);
  }
  lines.push('', '## Source Policy', '');
  lines.push(`- ${scope.sourcePolicy.connectorGoal}`);
  lines.push(`- ${scope.sourcePolicy.publicBoundary}`);
  return `${lines.join('\n')}\n`;
}

function toCypher(scope) {
  const lines = [
    '// Funesterie ecosystem scope export',
    `// Generated at ${scope.generatedAt}`,
    'CREATE CONSTRAINT funesterie_ecosystem_scope_id IF NOT EXISTS FOR (n:FunesterieEcosystemScope) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_repo_id IF NOT EXISTS FOR (n:FunesterieRepository) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_module_id IF NOT EXISTS FOR (n:FunesterieLocalModule) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_package_id IF NOT EXISTS FOR (n:FunesteriePackage) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_contract_id IF NOT EXISTS FOR (n:FunesterieContract) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_profile_id IF NOT EXISTS FOR (n:FunesterieIdentityProfile) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_hashtag_id IF NOT EXISTS FOR (n:FunesterieIdentityHashtag) REQUIRE n.id IS UNIQUE;',
    '',
    `MERGE (scope:FunesterieEcosystemScope {id: ${q(scope.id)}})`,
    `SET scope.label = ${q(scope.label)}, scope.mode = ${q(scope.mode)}, scope.generatedAt = datetime(${q(scope.generatedAt)});`,
    '',
  ];
  for (const identity of scope.identityLayer.profiles) {
    lines.push(
      `MERGE (identity:FunesterieIdentityProfile {id: ${q(identity.id)}})`,
      `SET identity.label = ${q(identity.label)}, identity.identityType = ${q(identity.identityType)}, identity.hashtags = ${qa(identity.hashtags)}, identity.functionalHashtags = ${qa(identity.functionalHashtags)}, identity.narrativeHashtags = ${qa(identity.narrativeHashtags)}, identity.visualHashtags = ${qa(identity.visualHashtags || [])}, identity.visualStyle = ${q(identity.visualIdentity.style)}, identity.palette = ${qa(identity.visualIdentity.palette)}, identity.representation = ${q(identity.visualIdentity.representation)}, identity.humanRepresentationAllowed = ${identity.visualIdentity.humanRepresentationAllowed ? 'true' : 'false'};`,
      ''
    );
  }
  const hashtags = Array.from(new Set(scope.identityLayer.profiles.flatMap((identity) => identity.hashtags || []))).sort();
  for (const hashtag of hashtags) {
    lines.push(
      `MERGE (tag:FunesterieIdentityHashtag {id: ${q(hashtagNodeId(hashtag))}})`,
      `SET tag.label = ${q(hashtag)}, tag.normalized = ${q(hashtag.replace(/^#/, ''))};`,
      ''
    );
  }
  for (const repo of scope.github.repos) {
    lines.push(
      `MERGE (n:FunesterieRepository {id: ${q(`repo:${repo.name}`)}})`,
      `SET n.name = ${q(repo.name)}, n.url = ${q(repo.url)}, n.visibility = ${q(repo.visibility)}, n.defaultBranch = ${q(repo.defaultBranch)}, n.technicalRole = ${q(repo.profile?.technicalRole || '')}, n.confidence = ${q(repo.profile?.confidence || 'unknown')}, n.identityProfileId = ${q(repo.identity?.id || '')}, n.identityType = ${q(repo.identity?.identityType || '')}, n.identityHashtags = ${qa(repo.identityHashtags || [])}, n.functionalHashtags = ${qa(repo.functionalHashtags || [])}, n.narrativeHashtags = ${qa(repo.narrativeHashtags || [])}, n.visualHashtags = ${qa(repo.visualHashtags || [])}, n.visualStyle = ${q(repo.identity?.visualIdentity?.style || '')}, n.visualRepresentation = ${q(repo.identity?.visualIdentity?.representation || '')};`,
      ''
    );
  }
  for (const moduleInfo of scope.localModules) {
    lines.push(
      `MERGE (n:FunesterieLocalModule {id: ${q(moduleInfo.id)}})`,
      `SET n.name = ${q(moduleInfo.name)}, n.kind = ${q(moduleInfo.kind)}, n.relativePath = ${q(moduleInfo.relativePath)}, n.exists = ${moduleInfo.status.exists ? 'true' : 'false'}, n.identityProfileId = ${q(moduleInfo.identity?.id || '')}, n.identityType = ${q(moduleInfo.identity?.identityType || '')}, n.identityHashtags = ${qa(moduleInfo.identityHashtags || [])}, n.functionalHashtags = ${qa(moduleInfo.functionalHashtags || [])}, n.narrativeHashtags = ${qa(moduleInfo.narrativeHashtags || [])}, n.visualHashtags = ${qa(moduleInfo.visualHashtags || [])}, n.visualStyle = ${q(moduleInfo.identity?.visualIdentity?.style || '')}, n.visualRepresentation = ${q(moduleInfo.identity?.visualIdentity?.representation || '')};`,
      ''
    );
  }
  return `${lines.join('\n')}\n`;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._/-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function q(value) {
  return JSON.stringify(String(value || ''));
}

function qa(values) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value || '')));
}

module.exports = {
  buildEcosystemScope,
  summarizeScope,
  toCypher,
  toMarkdown,
};
