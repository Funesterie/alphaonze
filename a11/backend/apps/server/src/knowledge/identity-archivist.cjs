'use strict';

const {
  buildIdentityPromptFragment,
  compactIdentityProfile,
  hashtagNodeId,
  resolveIdentityProfile,
} = require('./identity-hashtags.cjs');

const SCHEMA = 'funesterie.identity-archivist.v1';

const WORKER = {
  id: 'identity-archivist-worker',
  role: 'Archiviste',
  purpose: 'scanner -> proposer hashtags -> classer -> verifier -> ecrire dans ecosystem-corpus',
  writes: ['identity-tags.json', 'identity-tags.md', 'HAS_IDENTITY_TAG Neo4j relations', 'source-card identity enrichments'],
};

const FAMILY_RULES = [
  'One entity must have three families: functional, narrative and visual hashtags.',
  'Agents are character identities; human rendering is allowed only when the profile explicitly allows it.',
  'Modules are artifacts, systems, structures or motifs.',
  'Universes are places, worlds or living nexuses.',
  'Pipelines are flows.',
  'Memory is represented as graphs, cards, libraries or shelves.',
  'Security is represented as capsules, seals, vaults or safes.',
  'The worker uses source evidence and existing profiles before proposing fallback tags.',
];

const TYPE_REPRESENTATION = {
  agent: 'character identity',
  module: 'artifact/system',
  runtime: 'runtime system',
  universe: 'place/nexus',
  pipeline: 'flow',
};

const DOMAIN_FUNCTIONAL_TAGS = new Map([
  ['orchestration', '#orchestration'],
  ['memory', '#memory-routing'],
  ['runtime', '#runtime-hooks'],
  ['compression', '#semantic-compression'],
  ['diagnostic', '#diagnostic'],
  ['agent-tools', '#agent-tools'],
  ['frontend', '#ui-surface'],
  ['control-plane', '#governance'],
  ['restricted', '#restricted-boundary'],
  ['audio', '#audio-video'],
  ['video', '#audio-video'],
  ['vision', '#visual-analysis'],
  ['music', '#audio-video'],
  ['voice', '#audio-video'],
  ['mcp', '#mcp-core'],
  ['neo4j', '#graph-memory'],
  ['qflush', '#runtime-hooks'],
]);

function buildIdentityArchivistReport(scope, corpus, options = {}) {
  if (!scope || typeof scope !== 'object') throw new Error('scope object is required');
  if (!corpus || typeof corpus !== 'object') throw new Error('corpus object is required');
  const generatedAt = options.generatedAt || new Date().toISOString();
  const entities = collectEntities(scope, corpus, options);
  const proposals = entities.map((entity) => buildProposal(entity));
  const identityTags = collectIdentityTags(proposals);
  const neo4jRelations = proposals.flatMap((proposal) => buildNeo4jRelations(proposal));
  const sourceCardPatches = proposals
    .filter((proposal) => proposal.sourceCardId)
    .map((proposal) => ({
      sourceCardId: proposal.sourceCardId,
      subjectId: proposal.entityId,
      identityProfileId: proposal.identityProfileId,
      identityType: proposal.identityType,
      identityHashtags: proposal.hashtags,
      functionalHashtags: proposal.families.functional,
      narrativeHashtags: proposal.families.narrative,
      visualHashtags: proposal.families.visual,
      representationRule: proposal.representationRule,
      archivistStatus: proposal.status,
      archivistConfidence: proposal.confidence,
    }));

  return {
    ok: true,
    schema: SCHEMA,
    id: 'funesterie-identity-tags',
    worker: WORKER,
    generatedAt,
    sourceScopeId: scope.id || null,
    sourceCorpusId: corpus.id || null,
    rules: FAMILY_RULES,
    proposals,
    identityTags,
    sourceCardPatches,
    neo4jRelations,
    summary: summarizeIdentityArchivistReport({ proposals, identityTags, neo4jRelations, sourceCardPatches }),
  };
}

function collectEntities(scope, corpus, options = {}) {
  const byId = new Map();
  for (const card of corpus.sourceCards || []) {
    const identity = ensureIdentity(card.identity, card.subjectId || card.id, {
      type: card.kind,
      kind: card.kind,
      name: card.name || card.title,
      domains: card.domains || [],
      summary: card.role,
    });
    byId.set(card.subjectId || card.id, {
      id: card.subjectId || card.id,
      sourceCardId: card.id,
      kind: card.kind || 'source-card',
      name: card.name || card.title || card.id,
      role: card.role || '',
      boundary: card.boundary || '',
      domains: card.domains || [],
      identity,
      evidence: cleanSignals([
        'ecosystem-corpus.source-card',
        ...(card.evidence || []),
        ...(card.filesKey || []),
      ]),
    });
  }
  for (const profile of scope.identityLayer?.profiles || []) {
    if (byId.has(profile.canonicalId) || byId.has(profile.id)) continue;
    byId.set(profile.id, {
      id: profile.id,
      kind: 'identity-profile',
      name: profile.label,
      role: profile.sourceCardUse || '',
      boundary: 'private-metadata',
      domains: profile.routingTags || [],
      identity: ensureIdentity(profile, profile.canonicalId || profile.id, profile),
      evidence: ['ecosystem-scope.identity-layer'],
    });
  }
  for (const discussion of options.discussions || []) {
    const id = discussion.id || `discussion:${hashish(discussion.title || discussion.text || '')}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      kind: 'discussion',
      name: discussion.title || id,
      role: discussion.summary || discussion.text || '',
      boundary: 'private-metadata',
      domains: discussion.domains || ['memory'],
      identity: ensureIdentity(discussion.identity, id, {
        type: 'module',
        kind: 'discussion',
        name: discussion.title || id,
        domains: discussion.domains || ['memory'],
      }),
      evidence: ['agent-discussion'],
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function buildProposal(entity) {
  const identity = ensureIdentity(entity.identity, entity.id, entity);
  const inferredFunctional = inferFunctionalTags(entity, identity);
  const inferredNarrative = inferNarrativeTags(entity, identity);
  const inferredVisual = inferVisualTags(entity, identity);
  const families = {
    functional: ensureFamily(identity.functionalHashtags, inferredFunctional),
    narrative: ensureFamily(identity.narrativeHashtags, inferredNarrative),
    visual: ensureFamily(identity.visualHashtags, inferredVisual),
  };
  const hashtags = mergeHashtags(families.functional, families.narrative, families.visual);
  const validation = validateProposal(entity, identity, families);
  return {
    id: `identity-proposal:${normalizeId(entity.id)}`,
    workerId: WORKER.id,
    entityId: entity.id,
    sourceCardId: entity.sourceCardId || null,
    name: entity.name,
    kind: entity.kind,
    identityProfileId: identity.id,
    identityType: identity.identityType,
    representationRule: representationRuleFor(entity, identity),
    families,
    hashtags,
    visualIdentity: identity.visualIdentity,
    identityPrompt: buildIdentityPromptFragment({
      id: identity.canonicalId || entity.id,
      profileId: identity.id,
      label: identity.label,
      identityType: identity.identityType,
      hashtags,
      functionalHashtags: families.functional,
      narrativeHashtags: families.narrative,
      visualHashtags: families.visual,
      visualIdentity: identity.visualIdentity,
      routingTags: identity.routingTags || [],
      sourceCardUse: identity.sourceCardUse || '',
    }),
    evidence: cleanSignals(entity.evidence || []),
    method: {
      firstPass: 'existing identity profile',
      fallback: 'domain/kind/boundary inference',
      check: 'three hashtag families plus representation guardrails',
    },
    status: validation.errors.length ? 'needs-review' : 'accepted',
    confidence: validation.errors.length ? 'medium' : confidenceFor(entity, identity),
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

function ensureIdentity(identity, entityId, context = {}) {
  if (identity?.id && identity?.identityType && identity?.visualIdentity) return compactIdentityProfile(identity);
  return compactIdentityProfile(resolveIdentityProfile(entityId, context));
}

function inferFunctionalTags(entity, identity) {
  const out = [];
  for (const domain of entity.domains || identity.routingTags || []) {
    const tag = DOMAIN_FUNCTIONAL_TAGS.get(String(domain).toLowerCase());
    if (tag) out.push(tag);
  }
  const haystack = `${entity.id} ${entity.kind} ${entity.name} ${entity.role}`.toLowerCase();
  if (/mcp|tool|capability/.test(haystack)) out.push('#mcp-core');
  if (/memory|corpus|graph|neo4j/.test(haystack)) out.push('#memory-routing');
  if (/audio|voice|music|video|frame|vision|janus|ekko/.test(haystack)) out.push('#audio-video');
  if (/worker|runtime|hook|qflush|scheduler|job/.test(haystack)) out.push('#runtime-hooks');
  if (/orchestr|route|dispatch|bus/.test(haystack)) out.push('#orchestration');
  return out;
}

function inferNarrativeTags(entity, identity) {
  const out = [];
  const haystack = `${entity.id} ${entity.kind} ${entity.name} ${entity.role}`.toLowerCase();
  if (identity.identityType === 'universe') out.push('#nexus-world');
  if (identity.identityType === 'pipeline') out.push('#flow-path');
  if (identity.identityType === 'agent') out.push('#field-agent');
  if (/(voice|vivy|audio|music|song|stage)/.test(haystack)) out.push('#voice-presence');
  if (/(memory|corpus|neo4j|graph|library)/.test(haystack)) out.push('#memory-library');
  if (/(auth|secret|token|vault|restricted|security|policy)/.test(haystack) || entity.boundary === 'restricted-vault') out.push('#vault-capsule');
  if (!out.length) out.push('#system-capsule');
  return out;
}

function inferVisualTags(entity, identity) {
  const out = [...(identity.visualHashtags || [])];
  const visual = identity.visualIdentity || {};
  const haystack = `${entity.id} ${entity.kind} ${entity.name} ${entity.role} ${visual.style || ''} ${(visual.palette || []).join(' ')} ${visual.representation || ''}`.toLowerCase();
  if (visual.humanRepresentationAllowed) out.push('#human-character');
  else out.push('#not-human-character', '#abstract-artifact');
  if (/violet|purple|lavender/.test(haystack)) out.push('#purple-neon');
  if (/blue|cyan/.test(haystack)) out.push('#blue-core');
  if (/pink|rose/.test(haystack)) out.push('#pink-signal');
  if (/gold|archive|card|brief|source/.test(haystack)) out.push('#source-card-ui');
  if (/graph|neo4j|node|relation|constellation/.test(haystack)) out.push('#graph-constellation');
  if (entity.boundary === 'restricted-vault' || /secret|auth|token|vault|security/.test(haystack)) out.push('#vault-visual');
  return out;
}

function validateProposal(entity, identity, families) {
  const errors = [];
  const warnings = [];
  for (const family of ['functional', 'narrative', 'visual']) {
    if (!families[family]?.length) errors.push(`missing-${family}-hashtags`);
  }
  if (identity.identityType === 'universe' && !families.narrative.includes('#nexus-world') && !families.narrative.includes('#living-nexus')) {
    warnings.push('universe-should-carry-nexus-narrative-tag');
  }
  if (['module', 'pipeline', 'runtime'].includes(identity.identityType) && identity.visualIdentity?.humanRepresentationAllowed) {
    errors.push('technical-entity-cannot-use-human-visual-representation');
  }
  if (/nossen/i.test(`${entity.id} ${entity.name}`) && identity.identityType !== 'universe') {
    errors.push('nossen-must-remain-universe');
  }
  const invalid = Object.entries(families)
    .flatMap(([family, values]) => values.map((value) => [family, value]))
    .filter(([, value]) => !/^#[a-z0-9][a-z0-9-]*$/.test(value));
  if (invalid.length) errors.push(`invalid-hashtags:${invalid.map(([family, value]) => `${family}:${value}`).join(',')}`);
  return { errors, warnings };
}

function representationRuleFor(entity, identity) {
  if (/(auth|secret|token|vault|restricted|security|policy)/i.test(`${entity.id} ${entity.name} ${entity.role}`) || entity.boundary === 'restricted-vault') {
    return 'Security = capsules/coffres.';
  }
  if (/(memory|corpus|neo4j|graph|library)/i.test(`${entity.id} ${entity.name} ${entity.role}`)) {
    return 'Memoire = graphes/bibliotheques.';
  }
  const base = TYPE_REPRESENTATION[identity.identityType] || 'artifact/system';
  if (identity.identityType === 'agent') return `Agents = personnages; ${identity.visualIdentity?.humanRepresentationAllowed ? 'human figure allowed' : 'non-human character identity only'}.`;
  if (identity.identityType === 'module') return 'Modules = artefacts/systemes.';
  if (identity.identityType === 'universe') return 'Univers = lieux/nexus.';
  if (identity.identityType === 'pipeline') return 'Pipelines = flux.';
  return `${identity.identityType} = ${base}.`;
}

function collectIdentityTags(proposals) {
  const byId = new Map();
  for (const proposal of proposals) {
    for (const [family, values] of Object.entries(proposal.families)) {
      for (const hashtag of values || []) {
        const id = identityTagNodeId(family, hashtag);
        const entry = byId.get(id) || {
          id,
          hashtag,
          normalized: hashtag.replace(/^#/, ''),
          family,
          entities: [],
        };
        entry.entities.push(proposal.entityId);
        byId.set(id, entry);
      }
    }
  }
  return Array.from(byId.values())
    .map((entry) => ({ ...entry, entities: Array.from(new Set(entry.entities)).sort(), entityCount: new Set(entry.entities).size }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.hashtag.localeCompare(b.hashtag));
}

function buildNeo4jRelations(proposal) {
  const relations = [];
  for (const [family, values] of Object.entries(proposal.families)) {
    for (const hashtag of values || []) {
      relations.push({
        from: proposal.entityId,
        type: 'HAS_IDENTITY_TAG',
        to: identityTagNodeId(family, hashtag),
        family,
        hashtag,
      });
    }
  }
  relations.push({
    from: proposal.entityId,
    type: 'HAS_IDENTITY_PROFILE',
    to: proposal.identityProfileId,
    family: 'profile',
    hashtag: '',
  });
  return relations;
}

function summarizeIdentityArchivistReport(report) {
  const proposals = report.proposals || [];
  const identityTags = report.identityTags || [];
  const neo4jRelations = report.neo4jRelations || [];
  const sourceCardPatches = report.sourceCardPatches || [];
  return {
    proposals: proposals.length,
    accepted: proposals.filter((proposal) => proposal.status === 'accepted').length,
    needsReview: proposals.filter((proposal) => proposal.status === 'needs-review').length,
    functionalTags: identityTags.filter((tag) => tag.family === 'functional').length,
    narrativeTags: identityTags.filter((tag) => tag.family === 'narrative').length,
    visualTags: identityTags.filter((tag) => tag.family === 'visual').length,
    identityTags: identityTags.length,
    sourceCardPatches: sourceCardPatches.length,
    neo4jRelations: neo4jRelations.length,
  };
}

function toIdentityTagsMarkdown(report) {
  const lines = [
    '# Identity Archivist',
    '',
    `Worker: ${report.worker.id} (${report.worker.role})`,
    `Generated: ${report.generatedAt}`,
    '',
    '## Method',
    '',
    ...report.rules.map((rule) => `- ${rule}`),
    '',
    '## Summary',
    '',
    `- Proposals: ${report.summary.proposals}`,
    `- Accepted: ${report.summary.accepted}`,
    `- Needs review: ${report.summary.needsReview}`,
    `- Functional tags: ${report.summary.functionalTags}`,
    `- Narrative tags: ${report.summary.narrativeTags}`,
    `- Visual tags: ${report.summary.visualTags}`,
    '',
    '## Proposals',
    '',
    '| Entity | Type | Functional | Narrative | Visual | Rule | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const proposal of report.proposals) {
    lines.push(`| ${md(proposal.name || proposal.entityId)} | ${md(proposal.identityType)} | ${md(proposal.families.functional.join(' '))} | ${md(proposal.families.narrative.join(' '))} | ${md(proposal.families.visual.join(' '))} | ${md(proposal.representationRule)} | ${md(proposal.status)} |`);
  }
  lines.push('', '## Neo4j', '');
  lines.push('- Node label: `FunesterieIdentityTag`');
  lines.push('- Relation: `HAS_IDENTITY_TAG`');
  lines.push('- Relation property: `family` (`functional`, `narrative`, `visual`)');
  return `${lines.join('\n')}\n`;
}

function toIdentityTagsCypher(report) {
  const lines = [
    '// Funesterie identity archivist export',
    `// Generated at ${report.generatedAt}`,
    'CREATE CONSTRAINT funesterie_identity_archivist_report_id IF NOT EXISTS FOR (n:FunesterieIdentityArchivistReport) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT funesterie_identity_tag_id IF NOT EXISTS FOR (n:FunesterieIdentityTag) REQUIRE n.id IS UNIQUE;',
    '',
    `MERGE (report:FunesterieIdentityArchivistReport {id: ${q(report.id)}})`,
    `SET report.schema = ${q(report.schema)}, report.workerId = ${q(report.worker.id)}, report.generatedAt = datetime(${q(report.generatedAt)}), report.proposals = ${report.summary.proposals}, report.accepted = ${report.summary.accepted}, report.needsReview = ${report.summary.needsReview};`,
    '',
  ];
  for (const tag of report.identityTags) {
    lines.push(
      `MERGE (tag:FunesterieIdentityTag {id: ${q(tag.id)}})`,
      `SET tag.hashtag = ${q(tag.hashtag)}, tag.normalized = ${q(tag.normalized)}, tag.family = ${q(tag.family)}, tag.entityCount = ${tag.entityCount};`,
      `MERGE (report)-[:HAS_IDENTITY_TAG]->(tag);`,
      ''
    );
  }
  for (const proposal of report.proposals) {
    lines.push(
      `MERGE (entity:FunesterieEcosystemNode {id: ${q(proposal.entityId)}})`,
      `SET entity.identityProfileId = ${q(proposal.identityProfileId)}, entity.identityType = ${q(proposal.identityType)}, entity.identityHashtags = ${qa(proposal.hashtags)}, entity.functionalHashtags = ${qa(proposal.families.functional)}, entity.narrativeHashtags = ${qa(proposal.families.narrative)}, entity.visualHashtags = ${qa(proposal.families.visual)}, entity.representationRule = ${q(proposal.representationRule)}, entity.archivistStatus = ${q(proposal.status)};`
    );
    for (const [family, values] of Object.entries(proposal.families)) {
      for (const hashtag of values || []) {
        lines.push(
          `MERGE (tag:FunesterieIdentityTag {id: ${q(identityTagNodeId(family, hashtag))}})`,
          `MERGE (entity)-[r:HAS_IDENTITY_TAG]->(tag)`,
          `SET r.family = ${q(family)}, r.hashtag = ${q(hashtag)}, r.source = ${q(WORKER.id)}, r.updatedAt = datetime(${q(report.generatedAt)});`
        );
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function applyArchivistPatchesToCorpus(corpus, report) {
  const patches = new Map((report.sourceCardPatches || []).map((patch) => [patch.sourceCardId, patch]));
  return {
    ...corpus,
    sourcePolicy: {
      ...(corpus.sourcePolicy || {}),
      identityArchivist: 'Source cards carry methodical functional/narrative/visual identity hashtag families.',
    },
    sourceCards: (corpus.sourceCards || []).map((card) => {
      const patch = patches.get(card.id);
      if (!patch) return card;
      return {
        ...card,
        identityHashtags: patch.identityHashtags,
        functionalHashtags: patch.functionalHashtags,
        narrativeHashtags: patch.narrativeHashtags,
        visualHashtags: patch.visualHashtags,
        representationRule: patch.representationRule,
        archivistStatus: patch.archivistStatus,
        archivistConfidence: patch.archivistConfidence,
      };
    }),
    identityArchivist: {
      reportId: report.id,
      workerId: report.worker.id,
      generatedAt: report.generatedAt,
      summary: report.summary,
    },
  };
}

function ensureFamily(primary = [], fallback = []) {
  return mergeHashtags(primary, fallback).slice(0, 8);
}

function confidenceFor(entity, identity) {
  if (entity.sourceCardId && entity.evidence?.length >= 2 && identity.id) return 'high';
  if (identity.id) return 'medium';
  return 'low';
}

function mergeHashtags(...groups) {
  return Array.from(new Set(groups.flat()
    .map((value) => String(value || '').trim().toLowerCase())
    .map((value) => (value.startsWith('#') ? value : `#${value}`))
    .map((value) => `#${value.replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-')}`)
    .filter((value) => /^#[a-z0-9][a-z0-9-]*$/.test(value))));
}

function identityTagNodeId(family, hashtag) {
  return `identity-tag:${normalizeId(family)}:${hashtagNodeId(hashtag).replace(/^hashtag:/, '')}`;
}

function cleanSignals(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !/([A-Za-z0-9_-]{20,}|:\/\/[^ ]*@)/.test(value))))
    .slice(0, 12);
}

function normalizeId(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function hashish(value) {
  let hash = 0;
  for (const char of String(value || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(16);
}

function md(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function q(value) {
  return JSON.stringify(String(value || ''));
}

function qa(values) {
  return JSON.stringify((Array.isArray(values) ? values : []).map((value) => String(value || '')));
}

module.exports = {
  SCHEMA,
  WORKER,
  FAMILY_RULES,
  applyArchivistPatchesToCorpus,
  buildIdentityArchivistReport,
  identityTagNodeId,
  summarizeIdentityArchivistReport,
  toIdentityTagsCypher,
  toIdentityTagsMarkdown,
};
