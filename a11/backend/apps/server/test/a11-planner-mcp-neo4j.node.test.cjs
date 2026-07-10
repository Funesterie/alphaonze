'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWorldContext,
  findNeo4jNodesViaMcp,
  parseMcpNeo4jRows,
} = require('../a11-planner.cjs');

function mcpText(payload) {
  return {
    result: {
      content: [
        {
          type: 'text',
          text: `Neo4j read query executed.\n\n${JSON.stringify(payload)}`,
        },
      ],
    },
  };
}

test('parseMcpNeo4jRows extracts bounded MCP tool rows', () => {
  const rows = parseMcpNeo4jRows(mcpText({
    rows: [{ node: { id: 'entity-1', label: 'Vivy' } }],
  }));
  assert.deepEqual(rows, [{ node: { id: 'entity-1', label: 'Vivy' } }]);
});

test('findNeo4jNodesViaMcp uses the guarded read tool and caps query input', async () => {
  let captured = null;
  const nodes = await findNeo4jNodesViaMcp('x'.repeat(180), 50, {
    callMcpTool: async (name, args) => {
      captured = { name, args };
      return mcpText({
        rows: [
          { labels: ['A11MemoryGraphNode'], node: { id: 'one', label: 'One' } },
          { node: { id: 'two', label: 'Two' } },
        ],
      });
    },
  });

  assert.equal(captured.name, 'neo4j_read_query');
  assert.equal(captured.args.limit, 10);
  assert.deepEqual(captured.args.params.terms, ['xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']);
  assert.match(captured.args.query, /^\s*MATCH \(n\)/);
  assert.doesNotMatch(captured.args.query, /\b(?:CREATE|MERGE|DELETE|SET)\b/i);
  assert.deepEqual(nodes, [
    { id: 'one', label: 'One', _labels: ['A11MemoryGraphNode'] },
    { id: 'two', label: 'Two' },
  ]);
});

test('buildWorldContext falls back to MCP when direct Neo4j is unavailable', async () => {
  const world = await buildWorldContext(
    { goal: 'Vivy dream clip', userId: 'a11' },
    {
      isNeo4jAvailable: () => false,
      callMcpTool: async () => mcpText({
        rows: [{ labels: ['Agent'], node: { id: 'vivy', label: 'Vivy' } }],
      }),
    }
  );

  assert.deepEqual(world.neo4jNodes, [{ id: 'vivy', label: 'Vivy', _labels: ['Agent'] }]);
  assert.ok(world.activeServices.includes('neo4j'));
});

test('buildWorldContext remains available when MCP Neo4j fails', async () => {
  const world = await buildWorldContext(
    { goal: 'offline graph', userId: 'a11' },
    {
      isNeo4jAvailable: () => false,
      callMcpTool: async () => {
        throw new Error('MCP unavailable');
      },
    }
  );

  assert.deepEqual(world.neo4jNodes, []);
  assert.equal(world.activeServices.includes('neo4j'), false);
});
