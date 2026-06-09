'use strict';

const ROLES = Object.freeze({
  public_demo: {
    permissions: new Set(['read_demo', 'search', 'timeline', 'sources'])
  },
  analyste: {
    permissions: new Set(['search', 'timeline', 'sources', 'report', 'links'])
  },
  enqueteur: {
    permissions: new Set(['search', 'timeline', 'sources', 'report', 'links', 'import_document'])
  },
  superviseur: {
    permissions: new Set([
      'search',
      'timeline',
      'sources',
      'report',
      'links',
      'import_document',
      'delete_case',
      'read_audit'
    ])
  },
  administrateur_technique: {
    permissions: new Set(['technical_admin'])
  }
});

const MCP_ALLOWED_TOOLS = Object.freeze([
  'search_entities',
  'semantic_search',
  'entity_links',
  'timeline',
  'sources',
  'report_summary'
]);

const ALLOWED_QUERY_IDS = Object.freeze({
  search_lexical: 'search',
  search_semantic: 'search',
  timeline_for_case: 'timeline',
  entity_links: 'links',
  source_lookup: 'sources',
  report_summary: 'report'
});

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRole(role) {
  return String(role || 'public_demo').trim();
}

function assertKnownRole(role) {
  const normalized = normalizeRole(role);
  if (!ROLES[normalized]) {
    throw policyError('unknown_role', `Unknown role: ${normalized}`);
  }
  return normalized;
}

function assertNotAdminAgent(context) {
  const role = assertKnownRole(context.role);
  if (role === 'administrateur_technique' && context.isAgent) {
    throw policyError(
      'admin_role_forbidden_for_ai_agent',
      'Technical administrator credentials must never be used by an AI agent.'
    );
  }
}

function assertPermission(context, permission) {
  assertNotAdminAgent(context);
  const role = assertKnownRole(context.role);
  if (!ROLES[role].permissions.has(permission)) {
    throw policyError('permission_denied', `Permission denied for ${permission}`);
  }
}

function assertTenantCaseAccess(context, tenantId, caseId) {
  assertNotAdminAgent(context);
  if (!context.tenantId || context.tenantId !== tenantId) {
    throw policyError('tenant_access_denied', 'Tenant access denied.');
  }

  const allowedCases = new Set(context.allowedCases || [context.caseId].filter(Boolean));
  if (!allowedCases.has(caseId)) {
    throw policyError('case_access_denied', 'Case access denied.');
  }
}

function assertMcpToolAllowed(toolName) {
  if (!MCP_ALLOWED_TOOLS.includes(toolName)) {
    throw policyError('mcp_tool_not_allowed', `MCP tool is not allowed: ${toolName}`);
  }
}

function assertAllowedQuery(queryId) {
  if (!ALLOWED_QUERY_IDS[queryId]) {
    throw policyError('query_not_allowed', `Query id is not allowed: ${queryId}`);
  }
  return ALLOWED_QUERY_IDS[queryId];
}

function buildContext(headers = {}) {
  const get = (name, fallback) => headers[name] || headers[name.toLowerCase()] || fallback;
  return {
    userId: get('x-demo-user', 'demo-user'),
    role: normalizeRole(get('x-demo-role', 'analyste')),
    tenantId: get('x-demo-tenant', 'tenant-demo'),
    caseId: get('x-demo-case', 'case-demo-001'),
    allowedCases: String(get('x-demo-allowed-cases', get('x-demo-case', 'case-demo-001')))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    isAgent: String(get('x-agent', 'false')).toLowerCase() === 'true',
    requestId: get('x-request-id', `req-${Date.now()}`)
  };
}

module.exports = {
  ROLES,
  MCP_ALLOWED_TOOLS,
  ALLOWED_QUERY_IDS,
  assertAllowedQuery,
  assertKnownRole,
  assertMcpToolAllowed,
  assertNotAdminAgent,
  assertPermission,
  assertTenantCaseAccess,
  buildContext,
  policyError
};

