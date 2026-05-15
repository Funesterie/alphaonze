'use strict';

const SCHEMA = 'funesterie.identity-hashtags.v1';

const GLOBAL_IDENTITY_RULES = [
  'Identity hashtags are stable routing and visual anchors, not user-visible debug tags.',
  'Technical modules must be represented as systems, artifacts, structures or motifs, not human characters.',
  'Nossen is a living universe/nexus, not an agent.',
  'Secrets, credentials, local private paths and raw private source never become identity text.',
  'Image, UI, source cards, agent routing and Neo4j should all reuse the same identity profile.',
];

const REGISTRY = [
  profile('funesterie', 'Funesterie', 'universe', {
    functional: ['#ecosystem-nexus', '#creative-operating-system', '#agent-readable-graph', '#corpus-bridge', '#public-identity'],
    narrative: ['#creer-comprendre-connecter', '#living-map', '#shared-pact', '#maker-culture'],
    visual: {
      style: 'gothic-technological-nexus',
      palette: ['black', 'violet', 'silver', 'warm-gold'],
      representation: 'living ecosystem crest, constellation map and knowledge gate',
      symbolicRepresentation: 'crest plus graph constellation',
      humanRepresentationAllowed: false,
      promptAnchor: 'A gothic-tech ecosystem crest, violet circuitry, silver letterform, warm gold pact marks, no human character.',
    },
    routing: ['brand', 'briefing', 'public-surface', 'corpus'],
  }),
  profile('nossen', 'NOSSEN', 'universe', {
    functional: ['#universe-nexus', '#world-layer', '#creative-space', '#free-hands', '#narrative-operating-field'],
    narrative: ['#univers-des-mains-libres', '#living-nexus', '#pacte-fondateur', '#nothing-is-finished'],
    visual: {
      style: 'violet-cosmic-nexus',
      palette: ['deep-black', 'violet', 'lavender', 'cold-white'],
      representation: 'living universe, doorway, constellation and pact field',
      symbolicRepresentation: 'violet portal with pact glyphs',
      humanRepresentationAllowed: false,
      promptAnchor: 'NOSSEN as a living violet universe/nexus, cosmic doorway, pact symbols, free-hand creative field, not a single agent portrait.',
    },
    routing: ['universe', 'branding', 'posters', 'world-building'],
  }),
  profile('a11', 'A11', 'agent', {
    functional: ['#multimodal-core', '#pipeline-brain', '#semantic-processing', '#mcp-core', '#graph-memory'],
    narrative: ['#the-link', '#structure-made-usable', '#quiet-orchestrator', '#concrete-artifacts'],
    visual: {
      style: 'cold-systemic-core',
      palette: ['black', 'blue', 'white', 'cyan'],
      representation: 'abstract runtime entity, graph core and signal bridge',
      symbolicRepresentation: 'blue-white core linked to graph paths',
      humanRepresentationAllowed: false,
      promptAnchor: 'A11 as an abstract runtime core: blue-white graph brain, signal bridge, multimodal pipeline glyphs, no human body.',
    },
    routing: ['mcp', 'memory', 'image-video', 'coding', 'orchestration'],
  }),
  profile('kaen44', 'Kaen44', 'agent', {
    functional: ['#field-agent', '#desktop-runtime', '#copilot', '#workflow', '#operator'],
    narrative: ['#daily-copilot', '#kind-operator', '#client-ready', '#accessible-work'],
    visual: {
      style: 'violet-client-copilot',
      palette: ['black', 'violet', 'lavender', 'soft-cyan'],
      representation: 'friendly copilot figure or clean client-control interface',
      symbolicRepresentation: 'K mark, assistive icons and desktop orbit',
      humanRepresentationAllowed: true,
      promptAnchor: 'Kaen44 as a warm violet daily copilot, accessible client workflow UI, clean assistant presence and desktop orbit.',
    },
    routing: ['client-workflows', 'accessibility', 'documents', 'desktop', 'handoff'],
  }),
  profile('vivy', 'Vivy', 'agent', {
    functional: ['#voice-core', '#music-presence', '#sonic-identity', '#stage-share', '#emotion-to-audio'],
    narrative: ['#presence-musicale', '#voice-star', '#song-handoff', '#soft-stage'],
    visual: {
      style: 'pink-violet-musical-presence',
      palette: ['black', 'pink', 'violet', 'soft-white'],
      representation: 'musical presence, singer/studio figure and waveform constellation',
      symbolicRepresentation: 'star, microphone, waveform and stage light',
      humanRepresentationAllowed: true,
      promptAnchor: 'Vivy as a musical presence: pink-violet studio light, voice waveform, star motifs, microphone and stage-ready emotion.',
    },
    routing: ['music', 'voice', 'sfx', 'stage-share', 'video'],
  }),
  profile('mcp', 'MCP Bridge', 'pipeline', {
    functional: ['#mcp-core', '#tool-boundary', '#agent-bus', '#safe-bridge', '#capability-routing'],
    narrative: ['#controlled-gate', '#trusted-passage', '#no-secret-leak'],
    visual: systemVisual('secure bridge, tool gates and capability rails', ['black', 'cyan', 'green']),
    routing: ['mcp', 'security', 'tools', 'routing'],
  }),
  profile('ecosystem-scope', 'Ecosystem Scope', 'module', {
    functional: ['#scope-map', '#org-index', '#connector-visibility', '#metadata-only', '#agent-navigation'],
    narrative: ['#what-exists', '#cartography-layer', '#no-guessing'],
    visual: systemVisual('metadata map, repo constellations and module boundaries', ['black', 'blue', 'silver']),
    routing: ['scope', 'github', 'modules', 'neo4j'],
  }),
  profile('ecosystem-corpus', 'Ecosystem Corpus', 'module', {
    functional: ['#source-cards', '#corpus-index', '#knowledge-boundary', '#safe-summary', '#retrieval-layer'],
    narrative: ['#what-to-understand', '#memory-with-boundaries', '#readable-context'],
    visual: systemVisual('source cards, library shelves, graph edges and boundary seals', ['black', 'gold', 'violet']),
    routing: ['corpus', 'source-cards', 'briefing', 'neo4j'],
  }),
  profile('corpus', 'Corpus', 'module', {
    functional: ['#corpus-index', '#source-cards', '#knowledge-routing', '#safe-memory', '#summary-layer'],
    narrative: ['#curated-memory', '#context-library', '#evidence-first'],
    visual: systemVisual('indexed cards, memory shelves and evidence threads', ['black', 'gold', 'white']),
    routing: ['memory', 'source-cards', 'search'],
  }),
  profile('neo4j', 'Neo4j Graph', 'runtime', {
    functional: ['#graph-memory', '#relation-search', '#identity-traversal', '#corpus-graph', '#routing-graph'],
    narrative: ['#living-graph', '#map-of-relations', '#memory-spine'],
    visual: systemVisual('graph nodes, relation paths and memory topology', ['black', 'green', 'cyan']),
    routing: ['graph', 'memory', 'traversal'],
  }),
  profile('qflush', 'QFlush', 'runtime', {
    functional: ['#bounded-actions', '#worker-runtime', '#gamepad-bridge', '#job-flow', '#local-control'],
    narrative: ['#hands-on-runtime', '#safe-motion', '#demo-control'],
    visual: systemVisual('bounded command rails, action queue and gamepad signal bus', ['black', 'orange', 'cyan']),
    routing: ['qflush', 'workers', 'local-actions', 'gamepad'],
  }),
  profile('janus', 'Janus Vision', 'module', {
    functional: ['#vision-analyzer', '#frame-understanding', '#image-routing', '#identity-lock', '#visual-qa'],
    narrative: ['#two-faced-lens', '#look-before-making', '#visual-judge'],
    visual: systemVisual('dual lens, frame scanner and visual decision gate', ['black', 'violet', 'cyan']),
    routing: ['vision', 'image', 'video', 'qa'],
  }),
  profile('ekko', 'Ekko', 'module', {
    functional: ['#audio-listener', '#system-audio', '#voice-analysis', '#sound-context', '#ambient-input'],
    narrative: ['#listening-layer', '#audio-echo', '#signal-catcher'],
    visual: systemVisual('audio wave radar, listening ring and signal capture panel', ['black', 'cyan', 'pink']),
    routing: ['audio', 'voice', 'analysis'],
  }),
  profile('rome', 'Rome', 'module', {
    functional: ['#path-router', '#indexing-tool', '#navigation-layer', '#artifact-links'],
    narrative: ['#all-roads-visible', '#route-finder'],
    visual: systemVisual('path atlas, route lines and artifact waypoints', ['black', 'white', 'gold']),
    routing: ['paths', 'indexing', 'navigation'],
  }),
  profile('spyder', 'Spyder', 'module', {
    functional: ['#scanner', '#route-inspection', '#diagnostic-web', '#memory-hints'],
    narrative: ['#signal-web', '#quiet-scanner'],
    visual: systemVisual('scanning web, route fibers and diagnostic mesh', ['black', 'green', 'violet']),
    routing: ['scan', 'diagnostic', 'routes'],
  }),
  profile('cortex', 'Cortex', 'pipeline', {
    functional: ['#packet-router', '#runtime-cortex', '#action-hints', '#coordination-core'],
    narrative: ['#nervous-system', '#signal-routing'],
    visual: systemVisual('neural routing board and packet paths', ['black', 'blue', 'cyan']),
    routing: ['routing', 'runtime', 'coordination'],
  }),
  profile('doctor', 'Doctor', 'module', {
    functional: ['#health-check', '#diagnostic-agent', '#repair-advice', '#runtime-safety'],
    narrative: ['#system-medic', '#truth-before-fix'],
    visual: systemVisual('diagnostic board, pulse line and repair checklist', ['black', 'white', 'green']),
    routing: ['diagnostic', 'health', 'repair'],
  }),
  profile('piccolo', 'Piccolo', 'module', {
    functional: ['#small-repair', '#safe-patch', '#snapshot-helper', '#runtime-mender'],
    narrative: ['#tiny-fix', '#careful-hands'],
    visual: systemVisual('small repair toolkit, clean patches and snapshot tiles', ['black', 'green', 'gold']),
    routing: ['repair', 'patch', 'snapshot'],
  }),
  profile('telemetry', 'Telemetry', 'runtime', {
    functional: ['#event-trace', '#runtime-history', '#timeline', '#observability'],
    narrative: ['#what-happened', '#signal-memory'],
    visual: systemVisual('timeline pulses, event traces and status grid', ['black', 'cyan', 'white']),
    routing: ['observability', 'events', 'history'],
  }),
];

const ALIASES = new Map([
  ['k44', 'kaen44'],
  ['kaen', 'kaen44'],
  ['kaen-44', 'kaen44'],
  ['ivy', 'vivy'],
  ['a11mcp', 'mcp'],
  ['a11mcp-bridge', 'mcp'],
  ['a11-mcp-stdio-local', 'mcp'],
  ['a11mcp-private-http', 'mcp'],
  ['a11mcp-chatgpt-public', 'mcp'],
  ['mcp-client', 'mcp'],
  ['public-mcp', 'mcp'],
  ['github-org:funesterie', 'funesterie'],
  ['repo:funesterie', 'funesterie'],
  ['repo:nossen', 'nossen'],
  ['repo:a11mcp', 'mcp'],
  ['repo:alphaonze', 'a11'],
  ['repo:flush', 'qflush'],
  ['flush', 'qflush'],
  ['qflush-runtime', 'qflush'],
  ['qflush-libs', 'qflush'],
  ['a11-backend-server', 'a11'],
  ['a11-frontend-web', 'a11'],
  ['agent-domain-pack', 'ecosystem-corpus'],
  ['corpus-library', 'corpus'],
  ['neo4j-local', 'neo4j'],
  ['neo4j-aura', 'neo4j'],
  ['janus-vision', 'janus'],
  ['vision-dev', 'janus'],
  ['ekko-audio', 'ekko'],
]);

function profile(id, label, identityType, options) {
  const visual = options.visual || systemVisual('abstract system artifact', ['black', 'white']);
  const functionalHashtags = normalizeHashtags(options.functional || []);
  const narrativeHashtags = normalizeHashtags(options.narrative || []);
  const hashtags = mergeHashtags(functionalHashtags, narrativeHashtags);
  return {
    id,
    profileId: `identity:${id}`,
    label,
    identityType,
    hashtags,
    functionalHashtags,
    narrativeHashtags,
    visualIdentity: normalizeVisualIdentity(visual),
    routingTags: normalizeTags(options.routing || []),
    sourceCardUse: options.sourceCardUse || `Use ${label} identity to keep routing, UI copy, prompts and graph links coherent.`,
  };
}

function systemVisual(representation, palette = ['black', 'white']) {
  return {
    style: 'abstract-systemic-artifact',
    palette,
    representation,
    symbolicRepresentation: representation,
    humanRepresentationAllowed: false,
    promptAnchor: `${representation}; abstract system artifact; no human character.`,
  };
}

function normalizeVisualIdentity(value = {}) {
  return {
    style: String(value.style || 'abstract-systemic-artifact'),
    palette: Array.isArray(value.palette) ? value.palette.map(String) : [],
    representation: String(value.representation || 'abstract system artifact'),
    symbolicRepresentation: String(value.symbolicRepresentation || value.representation || 'abstract system artifact'),
    humanRepresentationAllowed: value.humanRepresentationAllowed === true,
    promptAnchor: String(value.promptAnchor || value.representation || 'abstract system artifact'),
  };
}

function normalizeTags(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().toLowerCase().replace(/^#+/, ''))
    .filter(Boolean)));
}

function normalizeHashtags(values) {
  return normalizeTags(values).map((value) => `#${value.replace(/[^a-z0-9-]+/g, '-')}`);
}

function mergeHashtags(...groups) {
  return Array.from(new Set(groups.flat().map((value) => {
    const raw = String(value || '').trim().toLowerCase();
    return raw.startsWith('#') ? raw : `#${raw}`;
  }).filter((value) => /^#[a-z0-9][a-z0-9-]*$/.test(value))));
}

function canonicalIdentityId(entityId) {
  const raw = String(entityId || '').trim().toLowerCase().replace(/\\/g, '/');
  const cleaned = raw
    .replace(/^source-card:(repo|module|package|contract|runtime):/, '$1:')
    .replace(/^repo:/, 'repo:')
    .replace(/^module:/, '')
    .replace(/^runtime:/, '')
    .replace(/^package:/, '')
    .replace(/^contract:/, '')
    .replace(/[:/]+/g, ':')
    .replace(/^:+|:+$/g, '');
  if (ALIASES.has(cleaned)) return ALIASES.get(cleaned);
  if (cleaned.startsWith('repo:') && ALIASES.has(cleaned)) return ALIASES.get(cleaned);
  const tail = cleaned.split(':').pop();
  if (ALIASES.has(tail)) return ALIASES.get(tail);
  if (/kaen|k44/.test(cleaned)) return 'kaen44';
  if (/vivy|ivy/.test(cleaned)) return 'vivy';
  if (/nossen/.test(cleaned)) return 'nossen';
  if (/janus|vision/.test(cleaned)) return 'janus';
  if (/ekko|audio/.test(cleaned)) return 'ekko';
  if (/neo4j|graph/.test(cleaned)) return 'neo4j';
  if (/qflush|flush|gamepad/.test(cleaned)) return 'qflush';
  if (/mcp/.test(cleaned)) return 'mcp';
  if (/corpus/.test(cleaned)) return 'corpus';
  if (/scope/.test(cleaned)) return 'ecosystem-scope';
  if (/a11|alphaonze/.test(cleaned)) return 'a11';
  return tail || cleaned || 'unknown';
}

function resolveIdentityProfile(entityId, context = {}) {
  const canonical = canonicalIdentityId(entityId || context.id || context.name);
  const known = REGISTRY.find((item) => item.id === canonical);
  if (known) return cloneProfile(known, entityId);
  return buildFallbackProfile(canonical, context, entityId);
}

function buildFallbackProfile(canonical, context = {}, entityId = canonical) {
  const kind = String(context.kind || context.type || '').toLowerCase();
  const domains = normalizeTags(context.domains || context.profile?.domains || []);
  const isUniverse = /universe|world|nexus/.test(kind);
  const isAgent = /agent|copilot/.test(kind);
  const identityType = isUniverse ? 'universe' : isAgent ? 'agent' : /runtime|service/.test(kind) ? 'runtime' : 'module';
  const baseFunctional = domains.length
    ? domains.slice(0, 5).map((item) => `#${item.replace(/[^a-z0-9-]+/g, '-')}`)
    : ['#metadata-node', '#routing-anchor'];
  const label = String(context.name || context.label || canonical || entityId || 'Identity node');
  const visual = identityType === 'agent'
    ? {
      style: 'agent-presence',
      palette: ['black', 'violet', 'white'],
      representation: 'agent presence with interface motifs',
      symbolicRepresentation: 'agent mark and interface orbit',
      humanRepresentationAllowed: true,
      promptAnchor: `${label} as an agent presence with interface motifs and coherent brand colors.`,
    }
    : systemVisual(`${label} as abstract module structure, artifact or motif`, ['black', 'violet', 'cyan']);
  return profile(normalizeBareId(canonical || entityId), label, identityType, {
    functional: mergeHashtags(baseFunctional, ['#identity-anchor']),
    narrative: ['#curated-role', '#coherent-generation'],
    visual,
    routing: domains,
    sourceCardUse: `Use ${label} identity as a stable routing and visual anchor.`,
  });
}

function cloneProfile(profileValue, originalEntityId = '') {
  return {
    ...profileValue,
    entityId: String(originalEntityId || profileValue.id),
    hashtags: [...profileValue.hashtags],
    functionalHashtags: [...profileValue.functionalHashtags],
    narrativeHashtags: [...profileValue.narrativeHashtags],
    visualIdentity: { ...profileValue.visualIdentity, palette: [...profileValue.visualIdentity.palette] },
    routingTags: [...profileValue.routingTags],
  };
}

function compactIdentityProfile(profileValue) {
  const profile = cloneProfile(profileValue);
  return {
    id: profile.profileId,
    canonicalId: profile.id,
    label: profile.label,
    identityType: profile.identityType,
    hashtags: profile.hashtags,
    functionalHashtags: profile.functionalHashtags,
    narrativeHashtags: profile.narrativeHashtags,
    visualIdentity: profile.visualIdentity,
    routingTags: profile.routingTags,
    sourceCardUse: profile.sourceCardUse,
  };
}

function buildIdentityPromptFragment(profileOrId, options = {}) {
  const profile = typeof profileOrId === 'string'
    ? resolveIdentityProfile(profileOrId, options.context || {})
    : profileOrId;
  const compact = compactIdentityProfile(profile);
  const visual = compact.visualIdentity;
  const rules = [];
  if (!visual.humanRepresentationAllowed) {
    rules.push('Do not represent this entity as a human character; use systems, artifacts, structures, symbols or environments.');
  }
  if (compact.identityType === 'universe') {
    rules.push('Treat it as a living universe or nexus, not as a single agent portrait.');
  }
  return [
    `Identity: ${compact.label} (${compact.identityType})`,
    `Hashtags: ${compact.hashtags.join(' ')}`,
    `Visual style: ${visual.style}`,
    `Palette: ${visual.palette.join(', ') || 'brand-coherent'}`,
    `Representation: ${visual.representation}`,
    `Prompt anchor: ${visual.promptAnchor}`,
    ...(rules.length ? [`Rules: ${rules.join(' ')}`] : []),
  ].join('\n');
}

function buildIdentityLayer(entities = []) {
  const byId = new Map();
  for (const item of REGISTRY) byId.set(item.profileId, compactIdentityProfile(item));
  for (const entity of entities || []) {
    const identity = entity?.identity
      ? compactIdentityProfile({
        id: entity.identity.canonicalId || normalizeBareId(entity.identity.id || entity.id),
        profileId: entity.identity.id || `identity:${normalizeBareId(entity.id)}`,
        label: entity.identity.label || entity.name || entity.id,
        identityType: entity.identity.identityType || 'module',
        hashtags: entity.identity.hashtags || [],
        functionalHashtags: entity.identity.functionalHashtags || [],
        narrativeHashtags: entity.identity.narrativeHashtags || [],
        visualIdentity: entity.identity.visualIdentity || systemVisual('abstract system artifact'),
        routingTags: entity.identity.routingTags || [],
        sourceCardUse: entity.identity.sourceCardUse || '',
      })
      : compactIdentityProfile(resolveIdentityProfile(entity?.id || entity?.name, entity || {}));
    byId.set(identity.id, identity);
  }
  const profiles = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema: SCHEMA,
    id: 'funesterie-identity-hashtags',
    label: 'Funesterie identity hashtags',
    mode: 'persistent-routing-visual-identity-layer',
    rules: GLOBAL_IDENTITY_RULES,
    profiles,
    summary: {
      profiles: profiles.length,
      agents: profiles.filter((item) => item.identityType === 'agent').length,
      universes: profiles.filter((item) => item.identityType === 'universe').length,
      nonHumanVisualProfiles: profiles.filter((item) => item.visualIdentity?.humanRepresentationAllowed !== true).length,
      hashtags: Array.from(new Set(profiles.flatMap((item) => item.hashtags || []))).length,
    },
  };
}

function identityLinksForEntity(entityId, identity) {
  if (!entityId || !identity?.id) return [];
  const links = [[entityId, 'HAS_IDENTITY_PROFILE', identity.id]];
  for (const hashtag of identity.hashtags || []) {
    links.push([identity.id, 'HAS_HASHTAG', hashtagNodeId(hashtag)]);
    links.push([entityId, 'HAS_IDENTITY_HASHTAG', hashtagNodeId(hashtag)]);
  }
  return links.map(([from, type, to]) => ({ from, type, to }));
}

function hashtagNodeId(hashtag) {
  return `hashtag:${String(hashtag || '').replace(/^#/, '').toLowerCase()}`;
}

function normalizeBareId(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/^identity:/, '')
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

module.exports = {
  SCHEMA,
  GLOBAL_IDENTITY_RULES,
  REGISTRY,
  buildIdentityLayer,
  buildIdentityPromptFragment,
  canonicalIdentityId,
  compactIdentityProfile,
  hashtagNodeId,
  identityLinksForEntity,
  resolveIdentityProfile,
};
