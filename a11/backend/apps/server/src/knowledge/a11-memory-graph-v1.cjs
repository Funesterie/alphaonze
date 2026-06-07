'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');
const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');

const DEFAULT_PATHS = {
  routeMap: path.join(GRAPH_DIR, 'a11-route-map.json'),
  runtimeHooks: path.join(GRAPH_DIR, 'a11-runtime-hooks.json'),
  ecosystemScope: path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json'),
  ecosystemCorpus: path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.json'),
  sessionState: path.join(RUNTIME_ROOT, 'codex-session-state-current.md'),
};

const SECRET_KEY_PATTERN = /(secret|token|password|passwd|pwd|apikey|api_key|bearer|private[_-]?key|credential|stripe|paypal|suno|civitai|huggingface|hf_)/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,})/i;

function hashText(value, length = 16) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function normalizeId(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w:/.@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function safeLabel(label) {
  const normalized = String(label || 'A11MemoryGraphNode')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidate = normalized || 'A11MemoryGraphNode';
  return /^[A-Za-z_]/.test(candidate) ? candidate : `L_${candidate}`;
}

function safeRel(type) {
  const rel = safeLabel(type || 'RELATED_TO').toUpperCase();
  return rel || 'RELATED_TO';
}

function cleanText(value, max = 500) {
  const text = String(value || '')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|bearer)\s*[:=]\s*[^,\s;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (SECRET_VALUE_PATTERN.test(text)) return '[redacted]';
  return text.slice(0, max);
}

function sanitizeProperties(properties = {}) {
  const out = {};
  for (const [key, rawValue] of Object.entries(properties || {})) {
    if (!key || SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted-key]';
      continue;
    }
    if (rawValue === undefined || rawValue === null) continue;
    if (Array.isArray(rawValue)) {
      out[key] = rawValue
        .filter((item) => item !== null && item !== undefined)
        .map((item) => cleanText(item, 220))
        .slice(0, 40);
      continue;
    }
    if (['string', 'number', 'boolean'].includes(typeof rawValue)) {
      out[key] = typeof rawValue === 'string' ? cleanText(rawValue, 600) : rawValue;
      continue;
    }
    out[key] = cleanText(JSON.stringify(rawValue), 900);
  }
  return out;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextSafe(filePath, maxBytes = 120_000) {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.subarray(0, maxBytes).toString('utf8');
  } catch {
    return '';
  }
}

function addNode(graph, id, labels, properties = {}) {
  const nodeId = normalizeId(id, `node:${hashText(JSON.stringify(properties))}`);
  const nodeLabels = [...new Set(['A11MemoryGraphNode', ...(Array.isArray(labels) ? labels : [labels]).filter(Boolean).map(safeLabel)])];
  const existing = graph.nodeMap.get(nodeId);
  const safeProps = sanitizeProperties({
    id: nodeId,
    ...properties,
  });
  if (existing) {
    existing.labels = [...new Set([...existing.labels, ...nodeLabels])];
    existing.properties = { ...existing.properties, ...safeProps };
    return existing;
  }
  const node = { id: nodeId, labels: nodeLabels, properties: safeProps };
  graph.nodeMap.set(nodeId, node);
  return node;
}

function addRel(graph, from, type, to, properties = {}) {
  const source = normalizeId(from);
  const target = normalizeId(to);
  if (!source || !target || source === 'unknown' || target === 'unknown') return null;
  const relType = safeRel(type);
  const key = `${source}|${relType}|${target}|${hashText(JSON.stringify(properties), 8)}`;
  if (graph.relMap.has(key)) return graph.relMap.get(key);
  const rel = {
    from: source,
    type: relType,
    to: target,
    properties: sanitizeProperties({
      source: 'a11-memory-graph-v1',
      ...properties,
    }),
  };
  graph.relMap.set(key, rel);
  return rel;
}

function buildMemoryGraph(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const generatedAt = options.generatedAt || new Date().toISOString();
  const graph = {
    schema: 'funesterie.a11-memory-graph.v1',
    generatedAt,
    paths,
    nodeMap: new Map(),
    relMap: new Map(),
  };

  const routeMap = options.routeMap || readJsonSafe(paths.routeMap);
  const runtimeHooks = options.runtimeHooks || readJsonSafe(paths.runtimeHooks);
  const ecosystemScope = options.ecosystemScope || readJsonSafe(paths.ecosystemScope);
  const ecosystemCorpus = options.ecosystemCorpus || readJsonSafe(paths.ecosystemCorpus);
  const sessionState = options.sessionState || readTextSafe(paths.sessionState);

  addNode(graph, 'project:funesterie', ['Project'], {
    name: 'Funesterie',
    summary: 'A11, Kaen44, Vivy, MCP, Qflush and graph memory workspace.',
    workspaceRoot: WORKSPACE_ROOT,
    sourcePolicy: 'metadata-only-no-secrets',
  });

  for (const agent of [
    ['agent:a11', 'A11', 'media-audio-video'],
    ['agent:kaen44', 'Kaen44', 'copilot-quotidien'],
    ['agent:vivy', 'Vivy', 'musical-agent'],
    ['agent:codex', 'Codex', 'coding-agent'],
    ['agent:grok', 'Grok', 'review-build-agent'],
    ['agent:claude', 'Claude', 'review-coordination-agent'],
  ]) {
    addNode(graph, agent[0], ['Agent'], { name: agent[1], role: agent[2] });
    addRel(graph, 'project:funesterie', 'HAS_AGENT', agent[0]);
  }

  for (const concept of [
    ['concept:graphrag', 'GraphRAG', 'Memory that can explain paths instead of only embedding similarity.'],
    ['concept:mcp', 'MCP', 'Model Context Protocol tools and capability boundary.'],
    ['concept:qflush', 'Qflush', 'Runtime orchestration and packet routing.'],
    ['concept:neo4j', 'Neo4j', 'Knowledge graph backing for agent memory.'],
    ['concept:prime-spiral', 'Prime Spiral', 'Experimental spectral and imaginary-space framework from the Djeff corpus.'],
    ['concept:numa', 'NUMA', 'Private Funesterie symbolic language for numbers, motifs, cycles and meanings.'],
    ['concept:magenta-line', 'Magenta Line', 'Transition axis across primes, composites and gaps; a phase route for order, chaos, speed and time.'],
    ['concept:spatial-imaginary-map', 'Spatial Imaginary Map', 'Hypercomplex coordinate map where primes are the real projection and imaginary axes carry deeper positions.'],
    ['concept:zen-container', 'ZEN Container', 'Zero-Exposed NEZ archive: encrypted multiload container that hides reconstruction order until the key.'],
    ['concept:wheeling-gate', 'Porte en Wheeling', 'Three-force rider model mapping wheelie mechanics to primes, composites and pattern gaps.'],
    ['concept:document-intelligence-watch', 'Document Intelligence watch', 'Keep Neo4j Document Intelligence on watch; preview/potentially paid, do not auto-enable.'],
  ]) {
    addNode(graph, concept[0], ['Concept'], { name: concept[1], summary: concept[2] });
    addRel(graph, 'project:funesterie', 'MENTIONS', concept[0]);
  }

  addNode(graph, 'decision:a11-memory-graph-v1', ['Decision'], {
    title: 'A11 Memory Graph v1',
    summary: 'Graph structure and links are stored; secrets stay in env/vault/provider dashboards.',
    decidedAt: generatedAt,
  });
  addRel(graph, 'decision:a11-memory-graph-v1', 'MENTIONS', 'concept:neo4j');
  addRel(graph, 'decision:a11-memory-graph-v1', 'MENTIONS', 'concept:graphrag');
  addRel(graph, 'decision:a11-memory-graph-v1', 'MENTIONS', 'concept:prime-spiral');
  addRel(graph, 'concept:numa', 'ENCODES', 'concept:magenta-line');
  addRel(graph, 'concept:magenta-line', 'MAPS', 'concept:prime-spiral');
  addRel(graph, 'concept:spatial-imaginary-map', 'PROJECTS_TO', 'concept:magenta-line');
  addRel(graph, 'concept:zen-container', 'USES', 'concept:spatial-imaginary-map');
  addRel(graph, 'concept:qflush', 'ROUTES', 'concept:zen-container');
  addRel(graph, 'concept:prime-spiral', 'RELATES_TO', 'concept:wheeling-gate');
  addRel(graph, 'concept:wheeling-gate', 'RELATES_TO', 'concept:qflush');
  addRel(graph, 'project:funesterie', 'HAS_DECISION', 'decision:a11-memory-graph-v1');

  ingestRouteMap(graph, routeMap);
  ingestRuntimeHooks(graph, runtimeHooks);
  ingestEcosystemScope(graph, ecosystemScope);
  ingestEcosystemCorpus(graph, ecosystemCorpus);
  ingestSessionState(graph, sessionState);

  const nodes = [...graph.nodeMap.values()];
  const relationships = [...graph.relMap.values()];
  return {
    ok: true,
    schema: graph.schema,
    generatedAt,
    sourcePolicy: {
      noSecrets: true,
      metadataOnly: true,
      documentIntelligence: 'watch-only-preview-potentially-paid',
    },
    summary: summarizeNodes(nodes, relationships),
    nodes,
    relationships,
  };
}

function ingestRouteMap(graph, routeMap) {
  if (!routeMap || typeof routeMap !== 'object') return;
  addNode(graph, 'file:a11-route-map', ['File'], {
    name: 'a11-route-map.json',
    path: DEFAULT_PATHS.routeMap,
    kind: 'route-map',
    generatedAt: routeMap.generatedAt || '',
  });
  addRel(graph, 'project:funesterie', 'STORED_IN', 'file:a11-route-map');

  const serviceEntries = Array.isArray(routeMap.services)
    ? routeMap.services.map((service) => [service?.id || service?.name || hashText(JSON.stringify(service || {})), service])
    : Object.entries(routeMap.services || {});
  for (const [name, service] of serviceEntries) {
    const id = `service:${name}`;
    addNode(graph, id, ['Service'], {
      name,
      port: service?.port || null,
      route: service?.route || service?.baseUrl || service?.health || '',
      protocol: service?.protocol || '',
      role: service?.role || '',
    });
    addRel(graph, 'project:funesterie', 'HAS_SERVICE', id);
    if (service?.canonicalPath || service?.script || service?.manifest) {
      for (const filePath of [service.canonicalPath, service.script, service.manifest].filter(Boolean)) {
        const fileId = `file:${hashText(filePath)}:${path.basename(String(filePath))}`;
        addNode(graph, fileId, ['File'], { path: filePath, name: path.basename(String(filePath)), kind: 'service-file' });
        addRel(graph, id, 'STORED_IN', fileId);
      }
    }
  }

  const publicUrl = routeMap.publicTarget?.url || '';
  if (publicUrl) {
    const domainId = `domain:${normalizeId(publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}`;
    addNode(graph, domainId, ['Domain'], { url: publicUrl, health: routeMap.publicTarget?.health || '' });
    addRel(graph, 'project:funesterie', 'DEPLOYED_ON', domainId);
  }

  for (const endpoint of routeMap.endpoints || []) {
    const id = endpoint.method === 'MCP tool' ? `mcp-tool:${endpoint.path}` : `endpoint:${endpoint.id || endpoint.path}`;
    addNode(graph, id, endpoint.method === 'MCP tool' ? ['McpTool'] : ['Endpoint'], {
      name: endpoint.id || endpoint.path,
      method: endpoint.method,
      path: endpoint.path,
      role: endpoint.role,
    });
    addRel(graph, 'project:funesterie', endpoint.method === 'MCP tool' ? 'EXPOSED_BY_MCP' : 'EXPOSES', id);
  }

  for (const [from, type, to] of routeMap.edges || []) {
    const fromId = guessRouteNodeId(from);
    const toId = guessRouteNodeId(to);
    addNode(graph, fromId, ['Concept'], { name: String(from || fromId) });
    addNode(graph, toId, ['Concept'], { name: String(to || toId) });
    addRel(graph, fromId, type || 'RELATED_TO', toId);
  }
}

function ingestRuntimeHooks(graph, runtimeHooks) {
  if (!runtimeHooks || typeof runtimeHooks !== 'object') return;
  addNode(graph, 'file:a11-runtime-hooks', ['File'], {
    name: 'a11-runtime-hooks.json',
    path: DEFAULT_PATHS.runtimeHooks,
    kind: 'runtime-hooks',
    generatedAt: runtimeHooks.generatedAt || '',
  });
  addRel(graph, 'project:funesterie', 'STORED_IN', 'file:a11-runtime-hooks');

  for (const moduleInfo of runtimeHooks.modules || []) {
    const id = `runtime-hook:${moduleInfo.id}`;
    addNode(graph, id, ['RuntimeHook', 'McpTool'], {
      name: moduleInfo.name,
      kind: moduleInfo.kind,
      role: moduleInfo.role,
      summary: moduleInfo.summary,
      capabilities: moduleInfo.capabilities || [],
    });
    addRel(graph, 'agent:a11', 'USES_TOOL', id);
    addRel(graph, id, 'WRITES_TO', 'concept:neo4j');
    for (const fileInfo of [...(moduleInfo.sourcePaths || []), ...(moduleInfo.watchedFiles || [])]) {
      const filePath = typeof fileInfo === 'string' ? fileInfo : fileInfo?.path;
      if (!filePath) continue;
      const fileId = `file:${hashText(filePath)}:${path.basename(filePath)}`;
      addNode(graph, fileId, ['File'], {
        name: path.basename(filePath),
        path: filePath,
        exists: typeof fileInfo === 'object' ? Boolean(fileInfo.exists) : undefined,
        kind: typeof fileInfo === 'object' ? fileInfo.kind : 'file',
      });
      addRel(graph, id, 'STORED_IN', fileId);
    }
  }

  for (const link of runtimeHooks.links || []) {
    const fromId = `runtime-hook:${link.from}`;
    const toId = `runtime-hook:${link.to}`;
    addNode(graph, fromId, ['RuntimeHook'], {
      name: link.from,
      kind: 'runtime-hook-reference',
    });
    addNode(graph, toId, ['RuntimeHook'], {
      name: link.to,
      kind: 'runtime-hook-reference',
    });
    addRel(graph, fromId, link.type || 'RELATED_TO', toId);
  }
}

function ingestEcosystemScope(graph, scope) {
  if (!scope || typeof scope !== 'object') return;
  addNode(graph, 'file:funesterie-ecosystem-scope', ['File'], {
    name: 'funesterie-ecosystem-scope.json',
    path: DEFAULT_PATHS.ecosystemScope,
    kind: 'ecosystem-scope',
    generatedAt: scope.generatedAt || '',
  });
  addRel(graph, 'project:funesterie', 'STORED_IN', 'file:funesterie-ecosystem-scope');

  for (const repo of scope.github?.repos || []) {
    const id = `repo:${repo.name}`;
    addNode(graph, id, ['Repo'], {
      name: repo.name,
      visibility: repo.visibility,
      defaultBranch: repo.defaultBranch,
      url: repo.url,
      primaryLanguage: repo.primaryLanguage || '',
      domains: repo.profile?.domains || [],
      summary: repo.profile?.technicalRole || repo.description || '',
      restricted: Boolean(repo.profile?.restricted),
    });
    addRel(graph, 'project:funesterie', 'HAS_REPO', id);
    if (repo.name === 'alphaonze') addRel(graph, id, 'DEPLOYS', 'service:backend');
  }

  for (const pkg of scope.packages || []) {
    const name = pkg.name || pkg.id;
    if (!name) continue;
    const id = `package:${name}`;
    addNode(graph, id, ['Package'], {
      name,
      scope: pkg.scope || '',
      version: pkg.version || pkg.currentVersion || '',
      role: pkg.role || pkg.summary || '',
    });
    addRel(graph, 'project:funesterie', 'HAS_PACKAGE', id);
  }
}

function ingestEcosystemCorpus(graph, corpus) {
  if (!corpus || typeof corpus !== 'object') return;
  addNode(graph, 'file:funesterie-ecosystem-corpus', ['File'], {
    name: 'funesterie-ecosystem-corpus.json',
    path: DEFAULT_PATHS.ecosystemCorpus,
    kind: 'ecosystem-corpus',
    generatedAt: corpus.generatedAt || '',
  });
  addRel(graph, 'project:funesterie', 'STORED_IN', 'file:funesterie-ecosystem-corpus');

  for (const domain of corpus.domains || []) {
    const id = `concept:${domain.id}`;
    addNode(graph, id, ['Concept'], {
      name: domain.label,
      summary: domain.summary,
      kind: 'corpus-domain',
    });
    addRel(graph, 'project:funesterie', 'MENTIONS', id);
  }

  for (const card of (corpus.sourceCards || []).slice(0, 120)) {
    const id = card.subjectId || card.id;
    if (!id) continue;
    addNode(graph, id, ['Concept'], {
      name: card.name || card.title,
      summary: card.publicSummary || card.role,
      boundary: card.boundary,
      domains: card.domains || [],
      confidence: card.confidence || '',
    });
    addRel(graph, 'file:funesterie-ecosystem-corpus', 'MENTIONS', id);
  }
}

function ingestSessionState(graph, text) {
  if (!text) return;
  addNode(graph, 'file:codex-session-state-current', ['File'], {
    name: 'codex-session-state-current.md',
    path: DEFAULT_PATHS.sessionState,
    kind: 'session-state',
  });
  addRel(graph, 'project:funesterie', 'STORED_IN', 'file:codex-session-state-current');

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    if (!/\b(incident|erreur|bug|fix|deploy|render|caddy|hetzner|neo4j|mcp|ollama|voix|video|audio)\b/i.test(line)) continue;
    const isIncident = /\b(incident|erreur|bug|fail|failed|down|bloqu|crash|timeout|524|502|500)\b/i.test(line);
    const id = `${isIncident ? 'incident' : 'decision'}:session:${hashText(line, 20)}`;
    addNode(graph, id, [isIncident ? 'Incident' : 'Decision'], {
      title: cleanText(line, 160),
      summary: cleanText(line, 500),
      sourceFile: DEFAULT_PATHS.sessionState,
    });
    addRel(graph, 'file:codex-session-state-current', isIncident ? 'MENTIONS' : 'HAS_DECISION', id);
    count += 1;
    if (count >= 80) break;
  }
}

function guessRouteNodeId(value) {
  const raw = String(value || '');
  if (raw.startsWith('service:') || raw.startsWith('agent:') || raw.startsWith('concept:')) return raw;
  if (/^(a11|kaen44|vivy|codex|grok|claude)$/i.test(raw)) return `agent:${raw.toLowerCase()}`;
  if (/^(backend|frontend|tts|ollama|qflush|neo4j|responder|runtime|corpus)$/i.test(raw)) return `service:${raw}`;
  return `concept:${raw}`;
}

function summarizeNodes(nodes, relationships) {
  const labelCounts = {};
  for (const node of nodes) {
    for (const label of node.labels || []) labelCounts[label] = (labelCounts[label] || 0) + 1;
  }
  return {
    nodes: nodes.length,
    relationships: relationships.length,
    labels: labelCounts,
  };
}

function findNode(graph, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  return graph.nodes.find((node) => {
    const haystack = [
      node.id,
      node.properties?.name,
      node.properties?.title,
      node.properties?.summary,
      node.properties?.url,
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  }) || null;
}

function traceService(query, options = {}) {
  const graph = options.graph || buildMemoryGraph(options);
  const node = findNode(graph, query);
  if (!node) {
    return { ok: false, query, message: 'Service introuvable dans A11 Memory Graph v1.', graphSummary: graph.summary };
  }
  const related = graph.relationships
    .filter((rel) => rel.from === node.id || rel.to === node.id)
    .slice(0, Number(options.limit || 80))
    .map((rel) => ({
      direction: rel.from === node.id ? 'outgoing' : 'incoming',
      type: rel.type,
      from: graph.nodes.find((candidate) => candidate.id === rel.from)?.properties?.name || rel.from,
      to: graph.nodes.find((candidate) => candidate.id === rel.to)?.properties?.name || rel.to,
    }));
  return {
    ok: true,
    query,
    node: publicNode(node),
    related,
    graphSummary: graph.summary,
  };
}

function findRecentIncidents(options = {}) {
  const graph = options.graph || buildMemoryGraph(options);
  const limit = Math.max(1, Math.min(50, Number(options.limit || 12)));
  const incidents = graph.nodes
    .filter((node) => node.labels.includes('Incident'))
    .slice(0, limit)
    .map(publicNode);
  return {
    ok: true,
    incidents,
    count: incidents.length,
    graphSummary: graph.summary,
  };
}

function explainAgentContext(agent = 'a11', options = {}) {
  const graph = options.graph || buildMemoryGraph(options);
  const node = findNode(graph, agent) || findNode(graph, `agent:${agent}`);
  if (!node) {
    return { ok: false, agent, message: 'Agent introuvable dans A11 Memory Graph v1.', graphSummary: graph.summary };
  }
  const rels = graph.relationships.filter((rel) => rel.from === node.id || rel.to === node.id);
  const neighborIds = new Set(rels.flatMap((rel) => [rel.from, rel.to]).filter((id) => id !== node.id));
  const neighbors = graph.nodes.filter((candidate) => neighborIds.has(candidate.id)).slice(0, Number(options.limit || 80));
  return {
    ok: true,
    agent,
    node: publicNode(node),
    tools: neighbors.filter((item) => item.labels.includes('McpTool') || item.labels.includes('RuntimeHook')).map(publicNode),
    services: neighbors.filter((item) => item.labels.includes('Service')).map(publicNode),
    concepts: neighbors.filter((item) => item.labels.includes('Concept')).map(publicNode),
    relations: rels.slice(0, 120).map((rel) => ({ from: rel.from, type: rel.type, to: rel.to })),
    graphSummary: graph.summary,
  };
}

function publicNode(node) {
  return {
    id: node.id,
    labels: node.labels.filter((label) => label !== 'A11MemoryGraphNode'),
    ...sanitizeProperties(node.properties || {}),
  };
}

function toMarkdown(graph) {
  const lines = [
    '# A11 Memory Graph v1',
    '',
    `Generated: ${graph.generatedAt}`,
    '',
    '## Policy',
    '',
    '- Metadata and links only.',
    '- No secrets, tokens, raw private source, or paid Document Intelligence activation.',
    '- Neo4j Document Intelligence stays watch-only until manually approved.',
    '',
    '## Summary',
    '',
    `- Nodes: ${graph.summary.nodes}`,
    `- Relationships: ${graph.summary.relationships}`,
    '',
    '## Labels',
    '',
  ];
  for (const [label, count] of Object.entries(graph.summary.labels).sort()) lines.push(`- ${label}: ${count}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_PATHS,
  buildMemoryGraph,
  cleanText,
  explainAgentContext,
  findRecentIncidents,
  hashText,
  normalizeId,
  publicNode,
  safeLabel,
  safeRel,
  sanitizeProperties,
  toMarkdown,
  traceService,
};
