'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  createEmptyState,
  exportReport,
  lexicalSearch,
  seedDemoCase,
  semanticSearch
} = require('../backend/src/domain');

const state = createEmptyState();
const text = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'fake-pv-001.txt'), 'utf8');
seedDemoCase(state, text);

const context = {
  userId: 'smoke-analyste',
  role: 'analyste',
  tenantId: 'tenant-demo',
  caseId: 'case-demo-001',
  allowedCases: ['case-demo-001'],
  isAgent: false,
  requestId: 'smoke'
};

const lexical = lexicalSearch(state, context, 'Camille');
const semantic = semanticSearch(state, context, 'vehicule blanc proche du garage');
const report = exportReport(state, context);

console.log(
  JSON.stringify(
    {
      ok: true,
      lexical_results: lexical.length,
      semantic_results: semantic.length,
      report_nodes: report.nodes.length,
      audit_entries: state.audit.length
    },
    null,
    2
  )
);

