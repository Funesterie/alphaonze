'use strict';

const {
  assertAllowedQuery,
  assertPermission,
  assertTenantCaseAccess,
  policyError
} = require('./policy');

const REQUIRED_SENSITIVE_FIELDS = Object.freeze([
  'source_id',
  'source_type',
  'created_at',
  'classification',
  'confidence',
  'tenant_id',
  'case_id',
  'visibility',
  'verified_by',
  'verification_status'
]);

const CLASSIFICATIONS = Object.freeze(['public_demo', 'internal', 'restricted', 'sensitive']);
const INFORMATION_KINDS = Object.freeze(['fact', 'declaration', 'rapprochement', 'hypothese']);

const BROAD_QUERIES = new Set(['*', 'all', 'tout', 'tous', 'toutes', 'data', 'donnees', 'find']);
const CYPHER_MARKERS = /\b(MATCH|MERGE|CREATE|DELETE|DETACH|CALL|LOAD\s+CSV|DROP|REMOVE|SET|RETURN)\b|;|--|\/\*/i;

const SEMANTIC_ALIASES = Object.freeze({
  vehicule: ['voiture', 'auto', 'scooter', 'moto', 'clio', 'plaque', 'garage'],
  blanc: ['blanche', 'clair', 'claire'],
  telephone: ['appel', 'numero', 'portable', 'sms'],
  adresse: ['rue', 'garage', 'port-lumiere', 'lieu'],
  rendezvous: ['rendez-vous', 'rencontre', 'rdv'],
  temoin: ['declare', 'declaration', 'entendu']
});

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createEmptyState() {
  return {
    documents: [],
    nodes: new Map(),
    relations: [],
    audit: [],
    deletions: []
  };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value) {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 80) || 'item';
}

function nowIso() {
  return new Date().toISOString();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function recordAudit(state, context, action, detail = {}) {
  state.audit.push({
    id: `audit-${state.audit.length + 1}`,
    at: nowIso(),
    user_id: context.userId,
    role: context.role,
    tenant_id: context.tenantId,
    case_id: context.caseId,
    action,
    request_id: context.requestId,
    detail
  });
}

function validateSensitiveNode(node) {
  for (const field of REQUIRED_SENSITIVE_FIELDS) {
    if (node[field] === undefined || node[field] === '') {
      throw domainError('missing_required_sensitive_field', `Missing required field: ${field}`);
    }
  }
  if (!CLASSIFICATIONS.includes(node.classification)) {
    throw domainError('invalid_classification', `Invalid classification: ${node.classification}`);
  }
  if (!INFORMATION_KINDS.includes(node.information_kind)) {
    throw domainError('invalid_information_kind', `Invalid information kind: ${node.information_kind}`);
  }
  if (Number(node.confidence) < 0 || Number(node.confidence) > 1) {
    throw domainError('invalid_confidence', 'Confidence must be between 0 and 1.');
  }
}

function baseSensitiveFields(context, sourceId, sourceType, overrides = {}) {
  return {
    source_id: sourceId,
    source_type: sourceType,
    created_at: nowIso(),
    classification: overrides.classification || 'restricted',
    confidence: overrides.confidence ?? 0.8,
    tenant_id: context.tenantId,
    case_id: context.caseId,
    visibility: overrides.visibility || 'case',
    verified_by: overrides.verified_by ?? null,
    verification_status: overrides.verification_status || 'unverified',
    information_kind: overrides.information_kind || 'fact'
  };
}

function addNode(state, context, source, type, label, properties = {}) {
  const normalizedLabel = normalizeText(label);
  const id = `${context.tenantId}:${context.caseId}:${type}:${slug(label)}`;
  const existing = state.nodes.get(id);
  const node = {
    id,
    type,
    label,
    normalized_label: normalizedLabel,
    aliases: unique([normalizedLabel, ...(properties.aliases || []).map(normalizeText)]),
    ...baseSensitiveFields(context, source.source_id, source.source_type, properties),
    ...properties
  };
  validateSensitiveNode(node);

  if (existing) {
    existing.aliases = unique([...(existing.aliases || []), ...node.aliases]);
    existing.confidence = Math.max(existing.confidence, node.confidence);
    return existing;
  }

  state.nodes.set(id, node);
  return node;
}

function addRelation(state, context, source, fromNode, toNode, type, properties = {}) {
  const relation = {
    id: `rel-${state.relations.length + 1}`,
    from: fromNode.id,
    to: toNode.id,
    type,
    ...baseSensitiveFields(context, source.source_id, source.source_type, {
      confidence: properties.confidence ?? 0.65,
      information_kind: properties.information_kind || 'rapprochement',
      classification: properties.classification || 'restricted'
    }),
    ...properties
  };
  validateSensitiveNode(relation);
  state.relations.push(relation);
  return relation;
}

function matchAll(text, regex) {
  const values = [];
  for (const match of text.matchAll(regex)) {
    values.push(match[1] || match[0]);
  }
  return unique(values.map((value) => value.trim()));
}

function extractDemoEntities(text) {
  const persons = unique([
    ...matchAll(text, /\b(Camille Durand|Lina Morel|Noe Martin|Sami Legrand)\b/g),
    ...matchAll(text, /\b(?:M\.|Mme)\s+([A-Z][a-z]+ [A-Z][a-z]+)\b/g)
  ]);
  const phones = matchAll(text, /\b0[1-9](?:[ .-]?\d{2}){4}\b/g);
  const plates = matchAll(text, /\b[A-Z]{2}-\d{3}-[A-Z]{2}\b/g);
  const vehicles = unique([
    ...plates.map((plate) => `Plaque ${plate}`),
    ...matchAll(text, /\b(Renault Clio blanche|scooter blanc)\b/gi)
  ]);
  const addresses = matchAll(text, /\b\d{1,3} rue des [A-Za-z-]+, [A-Za-z-]+\b/g);
  const dates = matchAll(text, /\b2026-\d{2}-\d{2}(?: \d{2}:\d{2})?\b/g);
  const events = matchAll(text, /^Evenement:\s*(.+)$/gim);

  return {
    persons,
    phones,
    vehicles,
    addresses,
    dates,
    events
  };
}

function importDocument(state, context, input) {
  assertPermission(context, 'import_document');
  assertTenantCaseAccess(context, input.tenantId, input.caseId);

  if (!input.text || input.text.length < 20) {
    throw domainError('document_too_short', 'Document text is too short.');
  }
  if (!input.sourceId || !input.sourceType) {
    throw domainError('missing_source', 'Imported documents require source id and source type.');
  }

  const source = {
    source_id: input.sourceId,
    source_type: input.sourceType
  };
  const document = {
    id: input.sourceId,
    tenant_id: context.tenantId,
    case_id: context.caseId,
    source_type: input.sourceType,
    text: input.text,
    created_at: nowIso(),
    classification: input.classification || 'restricted'
  };
  state.documents.push(document);

  const extracted = extractDemoEntities(input.text);
  const nodes = [];
  for (const name of extracted.persons) {
    nodes.push(addNode(state, context, source, 'Person', name, { confidence: 0.84 }));
  }
  for (const phone of extracted.phones) {
    nodes.push(addNode(state, context, source, 'Phone', phone, { confidence: 0.93 }));
  }
  for (const vehicle of extracted.vehicles) {
    nodes.push(addNode(state, context, source, 'Vehicle', vehicle, { confidence: 0.78 }));
  }
  for (const address of extracted.addresses) {
    nodes.push(addNode(state, context, source, 'Address', address, { confidence: 0.88 }));
  }
  for (const date of extracted.dates) {
    nodes.push(addNode(state, context, source, 'Date', date, { confidence: 0.9 }));
  }
  for (const event of extracted.events) {
    nodes.push(
      addNode(state, context, source, 'Event', event, {
        confidence: 0.72,
        information_kind: 'declaration'
      })
    );
  }

  const persons = nodes.filter((node) => node.type === 'Person');
  const vehicles = nodes.filter((node) => node.type === 'Vehicle');
  const phones = nodes.filter((node) => node.type === 'Phone');
  const addresses = nodes.filter((node) => node.type === 'Address');

  if (persons[0] && phones[0]) {
    addRelation(state, context, source, persons[0], phones[0], 'MENTIONED_WITH', {
      information_kind: 'declaration',
      confidence: 0.66
    });
  }
  if (persons[0] && vehicles[0]) {
    addRelation(state, context, source, persons[0], vehicles[0], 'NEAR_VEHICLE', {
      information_kind: 'rapprochement',
      confidence: 0.57
    });
  }
  if (vehicles[0] && addresses[0]) {
    addRelation(state, context, source, vehicles[0], addresses[0], 'OBSERVED_NEAR', {
      information_kind: 'declaration',
      confidence: 0.69
    });
  }

  recordAudit(state, context, 'import_document', {
    source_id: input.sourceId,
    extracted_nodes: nodes.length
  });

  return {
    document,
    extracted,
    nodes,
    relations: state.relations.filter((relation) => relation.source_id === input.sourceId)
  };
}

function assertNoCypher(value) {
  if (CYPHER_MARKERS.test(String(value || ''))) {
    throw domainError('cypher_rejected', 'Free Cypher or Cypher-like input is not accepted.');
  }
}

function ensureNarrowQuery(query) {
  const normalized = normalizeText(query);
  assertNoCypher(query);
  if (!normalized || normalized.length < 3 || BROAD_QUERIES.has(normalized)) {
    throw domainError('query_too_broad', 'Query is too broad.');
  }
  return normalized;
}

function nodesForContext(state, context) {
  return [...state.nodes.values()].filter(
    (node) => node.tenant_id === context.tenantId && node.case_id === context.caseId
  );
}

function relationsForContext(state, context) {
  return state.relations.filter(
    (relation) => relation.tenant_id === context.tenantId && relation.case_id === context.caseId
  );
}

function sourceSnippet(state, node) {
  const document = state.documents.find(
    (doc) => doc.id === node.source_id && doc.tenant_id === node.tenant_id && doc.case_id === node.case_id
  );
  if (!document) {
    return null;
  }
  const index = normalizeText(document.text).indexOf(node.normalized_label || normalizeText(node.label));
  if (index < 0) {
    return document.text.slice(0, 180);
  }
  return document.text.slice(Math.max(0, index - 80), Math.min(document.text.length, index + 180));
}

function publicNode(state, node) {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    classification: node.classification,
    confidence: node.confidence,
    information_kind: node.information_kind,
    verification_status: node.verification_status,
    source_id: node.source_id,
    source_type: node.source_type,
    snippet: sourceSnippet(state, node)
  };
}

function lexicalSearch(state, context, query) {
  assertPermission(context, 'search');
  assertTenantCaseAccess(context, context.tenantId, context.caseId);
  const normalized = ensureNarrowQuery(query);
  const results = nodesForContext(state, context)
    .filter((node) => {
      const haystack = unique([node.normalized_label, ...(node.aliases || [])]).join(' ');
      return haystack.includes(normalized) || normalized.includes(node.normalized_label);
    })
    .map((node) => publicNode(state, node));

  recordAudit(state, context, 'search_lexical', { query, result_count: results.length });
  return results;
}

function expandSemanticTokens(query) {
  const tokens = new Set(normalizeText(query).split(/\s+/).filter(Boolean));
  for (const [key, aliases] of Object.entries(SEMANTIC_ALIASES)) {
    if (tokens.has(key) || aliases.some((alias) => tokens.has(normalizeText(alias)))) {
      tokens.add(key);
      aliases.forEach((alias) => tokens.add(normalizeText(alias)));
    }
  }
  return tokens;
}

function semanticSearch(state, context, query) {
  assertPermission(context, 'search');
  assertTenantCaseAccess(context, context.tenantId, context.caseId);
  ensureNarrowQuery(query);
  const tokens = expandSemanticTokens(query);
  const results = nodesForContext(state, context)
    .map((node) => {
      const nodeText = normalizeText(`${node.type} ${node.label} ${(node.aliases || []).join(' ')}`);
      let score = 0;
      for (const token of tokens) {
        if (nodeText.includes(token)) {
          score += 1;
        }
      }
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => ({ ...publicNode(state, entry.node), semantic_score: entry.score }));

  recordAudit(state, context, 'search_semantic', { query, result_count: results.length });
  return results;
}

function getEntityLinks(state, context, entityId) {
  assertPermission(context, 'links');
  assertNoCypher(entityId);
  const node = state.nodes.get(entityId);
  if (!node) {
    throw domainError('entity_not_found', 'Entity not found.');
  }
  assertTenantCaseAccess(context, node.tenant_id, node.case_id);

  const links = relationsForContext(state, context)
    .filter((relation) => relation.from === entityId || relation.to === entityId)
    .map((relation) => ({
      id: relation.id,
      type: relation.type,
      from: publicNode(state, state.nodes.get(relation.from)),
      to: publicNode(state, state.nodes.get(relation.to)),
      confidence: relation.confidence,
      information_kind: relation.information_kind,
      source_id: relation.source_id,
      source_type: relation.source_type
    }));

  recordAudit(state, context, 'entity_links', { entity_id: entityId, result_count: links.length });
  return links;
}

function getTimeline(state, context) {
  assertPermission(context, 'timeline');
  assertTenantCaseAccess(context, context.tenantId, context.caseId);
  const dates = nodesForContext(state, context)
    .filter((node) => node.type === 'Date')
    .map((node) => publicNode(state, node))
    .sort((left, right) => left.label.localeCompare(right.label));

  recordAudit(state, context, 'timeline', { result_count: dates.length });
  return dates;
}

function getSourcesForEntity(state, context, entityId) {
  assertPermission(context, 'sources');
  assertNoCypher(entityId);
  const node = state.nodes.get(entityId);
  if (!node) {
    throw domainError('entity_not_found', 'Entity not found.');
  }
  assertTenantCaseAccess(context, node.tenant_id, node.case_id);

  const sources = state.documents
    .filter(
      (document) =>
        document.id === node.source_id &&
        document.tenant_id === context.tenantId &&
        document.case_id === context.caseId
    )
    .map((document) => ({
      source_id: document.id,
      source_type: document.source_type,
      classification: document.classification,
      snippet: sourceSnippet(state, node)
    }));

  recordAudit(state, context, 'sources', { entity_id: entityId, result_count: sources.length });
  return sources;
}

function exportReport(state, context) {
  assertPermission(context, 'report');
  assertTenantCaseAccess(context, context.tenantId, context.caseId);
  const nodes = nodesForContext(state, context).map((node) => publicNode(state, node));
  const relations = relationsForContext(state, context).map((relation) => ({
    id: relation.id,
    type: relation.type,
    from: relation.from,
    to: relation.to,
    confidence: relation.confidence,
    information_kind: relation.information_kind,
    source_id: relation.source_id
  }));

  const report = {
    tenant_id: context.tenantId,
    case_id: context.caseId,
    generated_at: nowIso(),
    warning: 'Demo report. Human validation required.',
    nodes,
    relations,
    synthesis: [
      'Facts and declarations are listed separately from rapprochements.',
      'No hypothesis is validated without a human verifier.'
    ]
  };
  recordAudit(state, context, 'export_report', {
    node_count: nodes.length,
    relation_count: relations.length
  });
  return report;
}

function deleteCaseData(state, context, tenantId, caseId) {
  assertPermission(context, 'delete_case');
  assertTenantCaseAccess(context, tenantId, caseId);
  const before = {
    documents: state.documents.length,
    nodes: state.nodes.size,
    relations: state.relations.length
  };

  state.documents = state.documents.filter((doc) => doc.tenant_id !== tenantId || doc.case_id !== caseId);
  for (const [id, node] of state.nodes.entries()) {
    if (node.tenant_id === tenantId && node.case_id === caseId) {
      state.nodes.delete(id);
    }
  }
  state.relations = state.relations.filter(
    (relation) => relation.tenant_id !== tenantId || relation.case_id !== caseId
  );

  const deletion = {
    id: `deletion-${state.deletions.length + 1}`,
    tenant_id: tenantId,
    case_id: caseId,
    requested_by: context.userId,
    at: nowIso(),
    before,
    after: {
      documents: state.documents.length,
      nodes: state.nodes.size,
      relations: state.relations.length
    }
  };
  state.deletions.push(deletion);
  recordAudit(state, context, 'delete_case', deletion);
  return deletion;
}

function runAllowedQuery(state, context, payload) {
  if (payload.cypher) {
    throw domainError('cypher_rejected', 'Cypher is not accepted from this interface.');
  }
  const permission = assertAllowedQuery(payload.queryId);
  assertPermission(context, permission);

  switch (payload.queryId) {
    case 'search_lexical':
      return lexicalSearch(state, context, payload.query);
    case 'search_semantic':
      return semanticSearch(state, context, payload.query);
    case 'timeline_for_case':
      return getTimeline(state, context);
    case 'entity_links':
      return getEntityLinks(state, context, payload.entityId);
    case 'source_lookup':
      return getSourcesForEntity(state, context, payload.entityId);
    case 'report_summary':
      return exportReport(state, context);
    default:
      throw policyError('query_not_allowed', `Query id is not allowed: ${payload.queryId}`);
  }
}

function seedDemoCase(state, text) {
  const context = {
    userId: 'demo-enqueteur',
    role: 'enqueteur',
    tenantId: 'tenant-demo',
    caseId: 'case-demo-001',
    allowedCases: ['case-demo-001'],
    isAgent: false,
    requestId: 'seed-demo'
  };
  return importDocument(state, context, {
    tenantId: 'tenant-demo',
    caseId: 'case-demo-001',
    sourceId: 'fake-pv-001',
    sourceType: 'proces_verbal_fictif',
    text
  });
}

module.exports = {
  CLASSIFICATIONS,
  INFORMATION_KINDS,
  REQUIRED_SENSITIVE_FIELDS,
  assertNoCypher,
  createEmptyState,
  deleteCaseData,
  domainError,
  ensureNarrowQuery,
  exportReport,
  getEntityLinks,
  getSourcesForEntity,
  getTimeline,
  importDocument,
  lexicalSearch,
  recordAudit,
  runAllowedQuery,
  seedDemoCase,
  semanticSearch,
  validateSensitiveNode
};

