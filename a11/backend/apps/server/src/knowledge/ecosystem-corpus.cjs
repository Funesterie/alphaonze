'use strict';

const crypto = require('node:crypto');
const {
  buildIdentityPromptFragment,
  hashtagNodeId,
  identityLinksForEntity,
} = require('./identity-hashtags.cjs');

const SCHEMA = 'funesterie.ecosystem-corpus.v1';

const DOMAINS = [
  ['orchestration', 'Orchestration', 'Routing, sequencing, MCP coordination, QFlush control and agent handoff.'],
  ['memory', 'Memory', 'Corpus, graph memory, source cards, route maps and recall surfaces.'],
  ['runtime', 'Runtime', 'Local execution, services, game/demo state, generated artifacts and live workers.'],
  ['compression', 'Compression', 'RGBA, OC8, compact values, binary primitives and semantic compaction.'],
  ['diagnostic', 'Diagnostic', 'Scanners, auditors, health checks, duplicate detection and safe repair advice.'],
  ['agent-tools', 'Agent tools', 'Tools agents can use to inspect, transform, test, refactor or coordinate work.'],
  ['frontend', 'Frontend', 'Web, desktop, UI, static sites, Unity/WebGL and client-facing surfaces.'],
  ['control-plane', 'Control plane', 'Configuration, deployments, auth boundaries, package contracts and governance.'],
  ['restricted', 'Restricted', 'Metadata-only areas that must not be exposed through public MCP or copied into corpus.'],
];

const BOUNDARIES = [
  {
    id: 'public-summary',
    label: 'Public summary',
    canGoToGooglePresentation: true,
    canGoToPublicMcp: true,
    corpusMode: 'short-summary-and-links',
    rule: 'Use short human-readable summaries and public URLs only.',
  },
  {
    id: 'private-metadata',
    label: 'Private metadata',
    canGoToGooglePresentation: false,
    canGoToPublicMcp: false,
    corpusMode: 'metadata-only-internal',
    rule: 'Internal agents may use role, status, paths and summaries; do not expose raw private source or local paths publicly.',
  },
  {
    id: 'restricted-vault',
    label: 'Restricted vault',
    canGoToGooglePresentation: false,
    canGoToPublicMcp: false,
    corpusMode: 'metadata-only-redacted',
    rule: 'Never ingest contents, filenames that reveal secrets, tokens, archives, credentials or private artifacts.',
  },
];

function buildEcosystemCorpus(scope, options = {}) {
  if (!scope || typeof scope !== 'object') throw new Error('scope object is required');
  const generatedAt = options.generatedAt || new Date().toISOString();
  const domains = DOMAINS.map(([id, label, summary]) => ({ id, label, summary }));
  const boundaries = BOUNDARIES.map((boundary) => ({ ...boundary }));

  const repoCards = (scope.github?.repos || []).map((repo) => buildRepoCard(repo));
  const moduleCards = (scope.localModules || []).map((moduleInfo) => buildModuleCard(moduleInfo));
  const packageCards = (scope.packages || []).map((pkg) => buildPackageCard(pkg));
  const contractCards = (scope.contracts || []).map((contract) => buildContractCard(contract));
  const runtimeCards = (scope.sharedRuntimes || []).map((runtime) => buildRuntimeCard(runtime));
  const sourceCards = [...repoCards, ...moduleCards, ...packageCards, ...contractCards, ...runtimeCards];
  const repoBriefs = repoCards.map((card) => buildRepoBrief(card));
  const links = buildLinks({ sourceCards, repoBriefs, scope });

  return {
    ok: true,
    schema: SCHEMA,
    id: 'funesterie-ecosystem-corpus',
    label: 'Funesterie ecosystem corpus bridge',
    mode: 'metadata-only-source-card-index',
    generatedAt,
    sourceScopeId: scope.id || 'funesterie-ecosystem-scope',
    sourceScopeGeneratedAt: scope.generatedAt || null,
    sourcePolicy: {
      noSecrets: true,
      noRawPrivateSource: true,
      noRawCopyrightCorpus: true,
      publicSummariesOnly: true,
      nextWebPass: 'Use source cards with URL, publisher, license/terms, retrievedAt, summary and domain fit before ingesting external material.',
      identityHashtags: 'Every source card can carry functional/narrative hashtags, visual identity and representation rules for routing, UI and prompts.',
    },
    domains,
    boundaries,
    sourceCards,
    repoBriefs,
    links,
    summary: {
      sourceCards: sourceCards.length,
      repoCards: repoCards.length,
      moduleCards: moduleCards.length,
      packageCards: packageCards.length,
      contractCards: contractCards.length,
      runtimeCards: runtimeCards.length,
      repoBriefs: repoBriefs.length,
      domains: domains.length,
      boundaries: boundaries.length,
      restrictedCards: sourceCards.filter((card) => card.boundary === 'restricted-vault').length,
      privateMetadataCards: sourceCards.filter((card) => card.boundary === 'private-metadata').length,
      publicSummaryCards: sourceCards.filter((card) => card.boundary === 'public-summary').length,
      links: links.length,
      identityProfiles: Array.from(new Set(sourceCards.map((card) => card.identity?.id).filter(Boolean))).length,
      identityHashtags: Array.from(new Set(sourceCards.flatMap((card) => card.identityHashtags || []))).length,
    },
  };
}

function buildRepoCard(repo) {
  const profile = repo.profile || {};
  const boundary = boundaryForRepo(repo);
  const domains = domainsForRepo(repo);
  const status = profile.restricted
    ? 'restricted'
    : profile.curationNeeded
      ? 'needs-curation'
      : profile.confidence === 'high'
        ? 'curated'
        : 'described';
  return {
    id: `source-card:repo:${repo.name}`,
    kind: 'repo',
    subjectId: `repo:${repo.name}`,
    title: `${repo.name} repo`,
    name: repo.name,
    role: profile.technicalRole || repo.description || 'Repository needs a short role description.',
    status,
    confidence: profile.confidence || 'unknown',
    boundary,
    domains,
    ...identityFields(repo.identity),
    filesKey: [
      repo.defaultBranch ? `defaultBranch:${repo.defaultBranch}` : 'defaultBranch:missing',
      repo.primaryLanguage ? `primaryLanguage:${repo.primaryLanguage}` : null,
      Array.isArray(repo.languages) && repo.languages.length ? `languages:${repo.languages.slice(0, 6).join(',')}` : null,
      repo.url ? `url:${repo.url}` : null,
    ].filter(Boolean),
    evidence: profile.evidence || [],
    risks: risksForBoundary(boundary, repo),
    publicSummary: publicSummaryForRepo(repo),
    agentUse: agentUseForDomains(domains),
  };
}

function buildModuleCard(moduleInfo) {
  const domains = domainsForModule(moduleInfo);
  const boundary = moduleInfo.kind === 'documentation' ? 'private-metadata' : 'private-metadata';
  return {
    id: `source-card:module:${moduleInfo.id}`,
    kind: 'module',
    subjectId: moduleInfo.id,
    title: `${moduleInfo.name} module`,
    name: moduleInfo.name,
    role: moduleInfo.summary,
    status: moduleInfo.status?.exists ? 'present' : 'missing',
    confidence: moduleInfo.status?.exists ? 'high' : 'low',
    boundary,
    domains,
    ...identityFields(moduleInfo.identity),
    filesKey: [moduleInfo.relativePath, moduleInfo.status?.kind].filter(Boolean),
    evidence: ['ecosystem-scope', moduleInfo.status?.exists ? 'local-path-present' : 'local-path-missing'],
    risks: risksForBoundary(boundary, moduleInfo),
    publicSummary: `${moduleInfo.name}: ${moduleInfo.summary}`,
    agentUse: agentUseForDomains(domains),
  };
}

function buildPackageCard(pkg) {
  const domains = domainsForPackage(pkg);
  return {
    id: `source-card:package:${pkg.id.replace(/^package:/, '')}`,
    kind: 'package',
    subjectId: pkg.id,
    title: `${pkg.name} package`,
    name: pkg.name,
    role: `Package ${pkg.name}${pkg.version ? ` version ${pkg.version}` : ''} with ${pkg.dependencyCount || 0} dependencies and ${pkg.scripts?.length || 0} scripts.`,
    status: 'present',
    confidence: 'high',
    boundary: 'private-metadata',
    domains,
    ...identityFields(pkg.identity),
    filesKey: [pkg.relativePath, ...(pkg.scripts || []).slice(0, 8).map((script) => `script:${script}`)],
    evidence: ['package.json', ...(pkg.funesterieDependencies || []).map((dep) => `dep:${dep}`)],
    risks: ['Do not expose package scripts if they include deployment or secret-handling commands without review.'],
    publicSummary: `${pkg.name}: package metadata, scripts and dependency counts only.`,
    agentUse: agentUseForDomains(domains),
  };
}

function buildContractCard(contract) {
  const domains = domainsForContract(contract);
  return {
    id: `source-card:contract:${contract.id}`,
    kind: 'contract',
    subjectId: contract.id,
    title: `${contract.name} contract`,
    name: contract.name,
    role: contract.summary,
    status: contract.status?.exists ? 'present' : 'missing',
    confidence: contract.status?.exists ? 'high' : 'medium',
    boundary: contract.kind === 'mcp-config' ? 'restricted-vault' : 'private-metadata',
    domains,
    ...identityFields(contract.identity),
    filesKey: [contract.relativePath, contract.kind].filter(Boolean),
    evidence: ['ecosystem-scope-contract', contract.status?.exists ? 'file-present' : 'file-missing'],
    risks: risksForBoundary(contract.kind === 'mcp-config' ? 'restricted-vault' : 'private-metadata', contract),
    publicSummary: `${contract.name}: ${contract.summary}`,
    agentUse: agentUseForDomains(domains),
  };
}

function buildRuntimeCard(runtime) {
  const domains = domainsForRuntime(runtime);
  const boundary = ['agent-bus', 'r2-files', 'render-services'].includes(runtime.id) ? 'private-metadata' : 'private-metadata';
  return {
    id: `source-card:runtime:${runtime.id}`,
    kind: 'runtime',
    subjectId: runtime.id,
    title: `${runtime.name} runtime`,
    name: runtime.name,
    role: runtime.summary,
    status: 'tracked',
    confidence: 'high',
    boundary,
    domains,
    ...identityFields(runtime.identity),
    filesKey: [runtime.kind],
    evidence: ['ecosystem-scope-runtime'],
    risks: risksForBoundary(boundary, runtime),
    publicSummary: `${runtime.name}: ${runtime.summary}`,
    agentUse: agentUseForDomains(domains),
  };
}

function buildRepoBrief(card) {
  const lines = [
    `# ${card.name}`,
    `Role: ${card.role}`,
    `Status: ${card.status}.`,
    `Confidence: ${card.confidence}.`,
    `Domains: ${card.domains.join(', ')}.`,
    `Identity: ${(card.identityHashtags || []).join(' ') || 'none'}.`,
    `Visual: ${card.visualIdentity?.style || 'none'}; ${card.visualIdentity?.representation || 'none'}.`,
    `Boundary: ${card.boundary}.`,
    `Key signals: ${card.filesKey.length ? card.filesKey.join('; ') : 'not enough signals yet'}.`,
    `Agent use: ${card.agentUse}`,
    `Do not expose: ${card.risks.join(' ')}`,
  ];
  return {
    id: `repo-brief:${card.name}`,
    repo: card.name,
    sourceCardId: card.id,
    boundary: card.boundary,
    lineCount: lines.length,
    text: lines.join('\n'),
  };
}

function buildLinks({ sourceCards, repoBriefs, scope }) {
  const links = [
    ['funesterie-ecosystem-corpus', 'GENERATED_FROM', scope.id || 'funesterie-ecosystem-scope'],
    ['funesterie-ecosystem-corpus', 'FEEDS', 'corpus-library'],
    ['funesterie-ecosystem-corpus', 'WRITES_TO', 'neo4j-local'],
    ['funesterie-ecosystem-corpus', 'WRITES_TO', 'neo4j-aura'],
  ];
  for (const card of sourceCards) {
    links.push(['funesterie-ecosystem-corpus', 'HAS_SOURCE_CARD', card.id]);
    links.push([card.id, 'DESCRIBES', card.subjectId]);
    links.push([card.id, 'HAS_BOUNDARY', card.boundary]);
    for (const domain of card.domains) {
      links.push([card.id, 'IN_DOMAIN', domain]);
      links.push([card.subjectId, 'BELONGS_TO_DOMAIN', domain]);
    }
    for (const link of identityLinksForEntity(card.id, card.identity)) links.push([link.from, link.type, link.to]);
    for (const link of identityLinksForEntity(card.subjectId, card.identity)) links.push([link.from, link.type, link.to]);
  }
  for (const brief of repoBriefs) {
    links.push(['funesterie-ecosystem-corpus', 'HAS_REPO_BRIEF', brief.id]);
    links.push([brief.id, 'SUMMARIZES_CARD', brief.sourceCardId]);
  }
  return links.map(([from, type, to]) => ({ from, type, to }));
}

function identityFields(identity) {
  if (!identity) return {
    identity: null,
    identityHashtags: [],
    visualIdentity: null,
    identityPrompt: '',
  };
  return {
    identity,
    identityHashtags: identity.hashtags || [],
    functionalHashtags: identity.functionalHashtags || [],
    narrativeHashtags: identity.narrativeHashtags || [],
    visualHashtags: identity.visualHashtags || [],
    visualIdentity: identity.visualIdentity || null,
    identityPrompt: buildIdentityPromptFragment({
      id: identity.canonicalId || identity.id,
      profileId: identity.id,
      label: identity.label,
      identityType: identity.identityType,
      hashtags: identity.hashtags || [],
      functionalHashtags: identity.functionalHashtags || [],
      narrativeHashtags: identity.narrativeHashtags || [],
      visualHashtags: identity.visualHashtags || [],
      visualIdentity: identity.visualIdentity,
      routingTags: identity.routingTags || [],
      sourceCardUse: identity.sourceCardUse || '',
    }),
  };
}

function boundaryForRepo(repo) {
  if (repo.profile?.restricted) return 'restricted-vault';
  if (repo.visibility === 'PUBLIC') return 'public-summary';
  return 'private-metadata';
}

function domainsForRepo(repo) {
  const category = repo.profile?.category || '';
  const declared = new Set(repo.profile?.domains || []);
  const out = new Set();
  if (/monorepo|control|config|env|mcp/.test(category) || declared.has('mcp') || declared.has('configuration')) out.add('control-plane');
  if (/runtime|orchestrator|pipeline|request/.test(category) || declared.has('qflush')) out.add('orchestration');
  if (/runtime|game|unity/.test(category) || declared.has('runtime')) out.add('runtime');
  if (/decoder|semantic|binary|encoding|primitive/.test(category) || declared.has('rgba') || declared.has('oc8')) out.add('compression');
  if (/scanner|audit|refactor|diagnostic/.test(category) || declared.has('diagnostics')) out.add('diagnostic');
  if (/tool|scanner|audit|refactor|decoder|navigator|pipeline|request/.test(category)) out.add('agent-tools');
  if (/frontend|site|ui|game|unity/.test(category) || declared.has('react') || declared.has('netlify')) out.add('frontend');
  if (/memory|semantic|navigator|mcp|corpus/.test(category) || declared.has('neo4j') || declared.has('semantic')) out.add('memory');
  if (repo.profile?.restricted) out.add('restricted');
  if (!out.size) out.add('control-plane');
  return Array.from(out).sort();
}

function domainsForModule(moduleInfo) {
  const kind = moduleInfo.kind || '';
  const id = moduleInfo.id || '';
  const out = new Set();
  if (/mcp|deploy|control|desktop|developer/.test(kind) || /mcp|desktop|vsix|cockpit/.test(id)) out.add('control-plane');
  if (/frontend|desktop|site|web/.test(kind) || /frontend|desktop|cockpit/.test(id)) out.add('frontend');
  if (/runtime|sidecar|data|backend/.test(kind) || /runtime|backend|qflush|dragon/.test(id)) out.add('runtime');
  if (/documentation|data/.test(kind) || /docs|runtime/.test(id)) out.add('memory');
  if (/runtime-library|mcp|developer/.test(kind) || /qflush|vsix|mcp/.test(id)) out.add('agent-tools');
  if (/qflush|dragon/.test(id)) out.add('orchestration');
  if (!out.size) out.add('control-plane');
  return Array.from(out).sort();
}

function domainsForPackage(pkg) {
  const text = `${pkg.name} ${pkg.relativePath} ${(pkg.funesterieDependencies || []).join(' ')}`.toLowerCase();
  const out = new Set(['agent-tools']);
  if (/web|frontend|react|vite|desktop|vsix/.test(text)) out.add('frontend');
  if (/server|backend|qflush|dragon|runtime/.test(text)) out.add('runtime');
  if (/mcp|dragon|env|config/.test(text)) out.add('control-plane');
  if (/qflush|rome|bat|beam/.test(text)) out.add('orchestration');
  if (/freeland|morphing|nezlephant|scream/.test(text)) out.add('compression');
  if (/neo4j|memory|corpus/.test(text)) out.add('memory');
  return Array.from(out).sort();
}

function domainsForContract(contract) {
  const text = `${contract.id} ${contract.kind} ${contract.summary}`.toLowerCase();
  const out = new Set(['control-plane']);
  if (/mcp|oauth|auth/.test(text)) out.add('agent-tools');
  if (/route|runtime|dragon/.test(text)) out.add('runtime');
  if (/graph|domain|corpus|knowledge|scope/.test(text)) out.add('memory');
  if (/hooks|ecosystem|route/.test(text)) out.add('orchestration');
  if (/config|auth/.test(text)) out.add('restricted');
  return Array.from(out).sort();
}

function domainsForRuntime(runtime) {
  const text = `${runtime.id} ${runtime.kind} ${runtime.summary}`.toLowerCase();
  const out = new Set(['runtime']);
  if (/neo4j|corpus|graph|knowledge/.test(text)) out.add('memory');
  if (/agent|mcp|qflush|coordination/.test(text)) out.add('orchestration');
  if (/netlify|render|r2/.test(text)) out.add('control-plane');
  if (/qflush|agent/.test(text)) out.add('agent-tools');
  return Array.from(out).sort();
}

function risksForBoundary(boundary, item) {
  if (boundary === 'restricted-vault') {
    return [
      'Never expose raw contents, tokens, keys, credentials, archive contents or local secret paths.',
      'Keep only redacted metadata, role and high-level routing notes.',
    ];
  }
  if (boundary === 'public-summary') {
    return [
      'Do not imply access to private repos or private runtime internals.',
      'Keep summary short and source-attributed.',
    ];
  }
  const name = item?.name || item?.id || 'item';
  return [
    `Do not expose raw private source, local absolute paths, env values or credentials for ${name}.`,
    'Use metadata and short summaries for internal agent navigation.',
  ];
}

function publicSummaryForRepo(repo) {
  if (repo.profile?.restricted) return `${repo.name}: restricted artifact area, metadata-only.`;
  if (repo.visibility === 'PUBLIC') return `${repo.name}: public Funesterie identity or presentation repository.`;
  return `${repo.name}: ${repo.profile?.technicalRole || repo.description || 'private Funesterie repository'}`;
}

function agentUseForDomains(domains) {
  const parts = [];
  if (domains.includes('orchestration')) parts.push('route tasks and handoffs');
  if (domains.includes('memory')) parts.push('find context and source cards');
  if (domains.includes('runtime')) parts.push('understand live services');
  if (domains.includes('compression')) parts.push('decode compact representations');
  if (domains.includes('diagnostic')) parts.push('debug, audit and repair safely');
  if (domains.includes('agent-tools')) parts.push('choose the right helper tool');
  if (domains.includes('frontend')) parts.push('orient UI/client work');
  if (domains.includes('control-plane')) parts.push('respect deployment and auth boundaries');
  if (domains.includes('restricted')) parts.push('avoid public exposure');
  return parts.length ? parts.join('; ') : 'general orientation';
}

function summarizeCorpus(corpus) {
  return {
    id: corpus.id,
    generatedAt: corpus.generatedAt,
    sourceCards: corpus.summary.sourceCards,
    repoCards: corpus.summary.repoCards,
    repoBriefs: corpus.summary.repoBriefs,
    domains: corpus.summary.domains,
    restrictedCards: corpus.summary.restrictedCards,
    privateMetadataCards: corpus.summary.privateMetadataCards,
    publicSummaryCards: corpus.summary.publicSummaryCards,
    identityProfiles: corpus.summary.identityProfiles,
    identityHashtags: corpus.summary.identityHashtags,
    links: corpus.summary.links,
  };
}

function toMarkdown(corpus) {
  const lines = [
    '# Funesterie Ecosystem Corpus',
    '',
    `Generated: ${corpus.generatedAt}`,
    `Mode: ${corpus.mode}`,
    '',
    '## Domains',
    '',
  ];
  for (const domain of corpus.domains) lines.push(`- ${domain.id}: ${domain.summary}`);
  lines.push('', '## Repository Briefs', '');
  for (const brief of corpus.repoBriefs) {
    lines.push(brief.text, '');
  }
  lines.push('## Identity Hashtags', '');
  const identityRows = Array.from(new Map(
    corpus.sourceCards
      .filter((card) => card.identity?.id)
      .map((card) => [card.identity.id, card.identity])
  ).values()).sort((a, b) => a.id.localeCompare(b.id));
  for (const identity of identityRows) {
    lines.push(`- ${identity.label} (${identity.identityType}): ${(identity.hashtags || []).join(' ')}`);
    lines.push(`  - visual: ${identity.visualIdentity?.style || 'n/a'}; ${identity.visualIdentity?.representation || 'n/a'}`);
  }
  lines.push('## Boundaries', '');
  for (const boundary of corpus.boundaries) lines.push(`- ${boundary.id}: ${boundary.rule}`);
  return `${lines.join('\n')}\n`;
}

function toCypher(corpus) {
  const lines = [
    '// Funesterie ecosystem corpus export',
    `// Generated at ${corpus.generatedAt}`,
    'CREATE CONSTRAINT funesterie_corpus_pack_id IF NOT EXISTS FOR (n:FunesterieCorpusPack) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_source_card_id IF NOT EXISTS FOR (n:FunesterieSourceCard) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_corpus_domain_id IF NOT EXISTS FOR (n:FunesterieCorpusDomain) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_profile_id IF NOT EXISTS FOR (n:FunesterieIdentityProfile) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_hashtag_id IF NOT EXISTS FOR (n:FunesterieIdentityHashtag) REQUIRE n.id IS UNIQUE;',
    '',
    `MERGE (pack:FunesterieCorpusPack {id: ${q(corpus.id)}})`,
    `SET pack.label = ${q(corpus.label)}, pack.mode = ${q(corpus.mode)}, pack.generatedAt = datetime(${q(corpus.generatedAt)});`,
    '',
  ];
  const identities = Array.from(new Map(
    corpus.sourceCards
      .filter((card) => card.identity?.id)
      .map((card) => [card.identity.id, card.identity])
  ).values()).sort((a, b) => a.id.localeCompare(b.id));
  for (const identity of identities) {
    lines.push(
      `MERGE (identity:FunesterieIdentityProfile {id: ${q(identity.id)}})`,
      `SET identity.label = ${q(identity.label)}, identity.identityType = ${q(identity.identityType)}, identity.hashtags = ${qa(identity.hashtags)}, identity.functionalHashtags = ${qa(identity.functionalHashtags || [])}, identity.narrativeHashtags = ${qa(identity.narrativeHashtags || [])}, identity.visualHashtags = ${qa(identity.visualHashtags || [])}, identity.visualStyle = ${q(identity.visualIdentity?.style || '')}, identity.palette = ${qa(identity.visualIdentity?.palette || [])}, identity.representation = ${q(identity.visualIdentity?.representation || '')}, identity.humanRepresentationAllowed = ${identity.visualIdentity?.humanRepresentationAllowed === true ? 'true' : 'false'};`,
      ''
    );
  }
  const hashtags = Array.from(new Set(identities.flatMap((identity) => identity.hashtags || []))).sort();
  for (const hashtag of hashtags) {
    lines.push(
      `MERGE (tag:FunesterieIdentityHashtag {id: ${q(hashtagNodeId(hashtag))}})`,
      `SET tag.label = ${q(hashtag)}, tag.normalized = ${q(hashtag.replace(/^#/, ''))};`,
      ''
    );
  }
  for (const card of corpus.sourceCards) {
    lines.push(
      `MERGE (card:FunesterieSourceCard {id: ${q(card.id)}})`,
      `SET card.title = ${q(card.title)}, card.kind = ${q(card.kind)}, card.boundary = ${q(card.boundary)}, card.status = ${q(card.status)}, card.role = ${q(card.role)}, card.identityProfileId = ${q(card.identity?.id || '')}, card.identityType = ${q(card.identity?.identityType || '')}, card.identityHashtags = ${qa(card.identityHashtags || [])}, card.functionalHashtags = ${qa(card.functionalHashtags || [])}, card.narrativeHashtags = ${qa(card.narrativeHashtags || [])}, card.visualHashtags = ${qa(card.visualHashtags || [])}, card.visualStyle = ${q(card.visualIdentity?.style || '')}, card.visualRepresentation = ${q(card.visualIdentity?.representation || '')};`,
      ''
    );
    for (const link of identityLinksForEntity(card.id, card.identity).filter((item) => item.type === 'HAS_IDENTITY_TAG' || item.type === 'HAS_IDENTITY_HASHTAG')) {
      lines.push(`MATCH (card:FunesterieSourceCard {id: ${q(link.from)}}), (tag:FunesterieIdentityHashtag {id: ${q(link.to)}}) MERGE (card)-[:${link.type}]->(tag);`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function q(value) {
  return JSON.stringify(String(value || ''));
}

function qa(values) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value || '')));
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

module.exports = {
  buildEcosystemCorpus,
  summarizeCorpus,
  toCypher,
  toMarkdown,
  hashText,
};
