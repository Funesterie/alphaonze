const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Neo4jMemoryRouter,
  buildMirrorNodeCypher,
  collectBackupGraphs,
  dedupeMemoryResults,
  isLocalNeo4jUri,
  resolveRouterConfig,
  safeLabel,
  safeRelationshipType,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');

test('memory router detects local Neo4j URIs without treating Aura as local', () => {
  assert.equal(isLocalNeo4jUri('neo4j://127.0.0.1:7687'), true);
  assert.equal(isLocalNeo4jUri('bolt://localhost:7687'), true);
  assert.equal(isLocalNeo4jUri('neo4j+s://aa4680d2.databases.neo4j.io'), false);
});

test('memory router resolves Aura and local endpoints from separate env blocks', () => {
  const config = resolveRouterConfig({
    KIRO_V2: 'neo4j+s://aa4680d2.databases.neo4j.io',
    KIRO_V2_USER: 'aa4680d2',
    KIRO_V2_PASSWORD: 'test-aura-pass',
    KIRO_V2_DATABASE: 'aa4680d2',
    NEO4J_URI: 'neo4j://127.0.0.1:7687',
    NEO4J_USERNAME: 'neo4j',
    NEO4J_PASSWORD: 'secret-local',
    NEO4J_DATABASE: 'a11-knowledge-graph',
  });

  assert.equal(config.aura.uri, 'neo4j+s://aa4680d2.databases.neo4j.io');
  assert.equal(config.aura.database, 'aa4680d2');
  assert.equal(config.local.uri, 'neo4j://127.0.0.1:7687');
  assert.equal(config.local.database, 'a11-knowledge-graph');
  assert.equal(config.local.auth, 'basic');
});

test('memory router prefers dedicated A11 local auth over stale global local NEO4J auth', () => {
  const config = resolveRouterConfig({
    KIRO_V2: 'neo4j+s://aa4680d2.databases.neo4j.io',
    KIRO_V2_USER: 'aa4680d2',
    KIRO_V2_PASSWORD: 'test-aura-pass',
    NEO4J_URI: 'bolt://127.0.0.1:7687',
    NEO4J_USERNAME: 'neo4j',
    NEO4J_PASSWORD: 'stale-global-local',
    A11_LOCAL_NEO4J_URI: 'bolt://127.0.0.1:7687',
    A11_LOCAL_NEO4J_USER: 'fresh-local-user',
    A11_LOCAL_NEO4J_PASSWORD: 'fresh-local-password',
  });

  assert.equal(config.local.username, 'fresh-local-user');
  assert.equal(config.local.password, 'fresh-local-password');
});

test('memory router treats global NEO4J_URI as Aura when it points to cloud', () => {
  const config = resolveRouterConfig({
    NEO4J_URI: 'neo4j+s://aa4680d2.databases.neo4j.io',
    NEO4J_USERNAME: 'aa4680d2',
    NEO4J_PASSWORD: 'test-aura-pass',
    NEO4J_DATABASE: 'aa4680d2',
  });

  assert.equal(config.aura.uri, 'neo4j+s://aa4680d2.databases.neo4j.io');
  assert.equal(config.aura.username, 'aa4680d2');
  assert.equal(config.aura.password, 'test-aura-pass');
  assert.equal(config.aura.database, 'aa4680d2');
  assert.equal(config.local.uri, 'bolt://127.0.0.1:7687');
  assert.equal(config.local.database, 'neo4j');
  assert.equal(config.local.auth, 'none');
});

test('memory router keeps a no-auth sync fallback for stale local config', () => {
  const config = resolveRouterConfig({
    A11_LOCAL_NEO4J_URI: 'bolt://127.0.0.1:7687',
    A11_LOCAL_NEO4J_USER: 'neo4j',
    A11_LOCAL_NEO4J_PASSWORD: 'test-local-pass',
    A11_LOCAL_NEO4J_DATABASE: 'a11-knowledge-graph',
  });

  assert.equal(config.local.uri, 'bolt://127.0.0.1:7687');
  assert.equal(config.local.database, 'a11-knowledge-graph');
  assert.equal(config.local.auth, 'basic');
  assert.equal(config.local.fallbacks.length, 1);
  assert.equal(config.local.fallbacks[0].uri, 'bolt://127.0.0.1:17687');
  assert.equal(config.local.fallbacks[0].database, 'neo4j');
  assert.equal(config.local.fallbacks[0].auth, 'none');
});

test('memory router only uses port 17687 as the explicit sync-mirror fallback', () => {
  const config = resolveRouterConfig({
    A11_SYNC_MIRROR_NEO4J_URI: 'bolt://127.0.0.1:27687',
  });

  assert.equal(config.local.uri, 'bolt://127.0.0.1:7687');
  assert.equal(config.local.fallbacks[0].uri, 'bolt://127.0.0.1:27687');
  assert.equal(config.local.fallbacks[0].auth, 'none');
});

test('memory router sanitizes labels and relationship types for mirror cypher', () => {
  assert.equal(safeLabel('Memory Note'), 'Memory_Note');
  assert.equal(safeLabel('123 agent'), 'L_123_agent');
  assert.equal(safeRelationshipType('calls/mcp'), 'CALLS_MCP');

  const cypher = buildMirrorNodeCypher(['Memory Note', '123 agent'], { hasSourceId: true });
  assert.match(cypher, /MERGE \(n:Memory_Note \{id: \$sourceId\}\)/);
  assert.match(cypher, /SET n:A11AuraMirror/);
});

test('memory router property map keeps Neo4j-safe primitives and stringifies nested values', () => {
  const result = sanitizePropertyMap({
    ok: true,
    count: 2,
    tags: ['a', 'b'],
    nested: { a: 1 },
    empty: undefined,
  });

  assert.deepEqual(result, {
    ok: true,
    count: 2,
    tags: ['a', 'b'],
    nested: '{"a":1}',
  });
});

test('memory router deduplicates search results by canonical key and records sources', () => {
  const results = dedupeMemoryResults([
    { key: 'same', source: 'aura', properties: { id: 'same' } },
    { key: 'same', source: 'local', properties: { id: 'same' } },
    { key: 'other', source: 'local', properties: { id: 'other' } },
  ]);

  assert.equal(results.length, 2);
  assert.deepEqual(results[0].sources, ['aura', 'local']);
});

test('memory router rejects an unknown backup target before creating artifacts', async () => {
  const router = new Neo4jMemoryRouter(resolveRouterConfig({}));
  await assert.rejects(
    router.backupToSeagate({ target: 'unknown-target' }),
    /Invalid Neo4j backup target/
  );
});

test('legacy both backup preserves Aura when the optional local mirror is unavailable', async () => {
  const config = {
    aura: { name: 'aura', uri: 'neo4j+s://example.invalid', database: 'aura' },
    local: { name: 'local', uri: 'bolt://127.0.0.1:7687', database: 'neo4j' },
  };
  const exportGraph = async (endpoint) => {
    if (endpoint.name === 'local') throw new Error('local unavailable');
    return { endpoint, exportedAt: '2026-08-08T00:00:00.000Z', nodes: [{}], relationships: [] };
  };

  const graphs = await collectBackupGraphs(config, 'both', exportGraph);
  assert.equal(graphs.aura.nodes.length, 1);
  assert.equal(graphs.local.nodes.length, 0);
  assert.match(graphs.local.error, /local unavailable/);
  await assert.rejects(() => collectBackupGraphs(config, 'local', exportGraph), /local unavailable/);
});

test('legacy both backup still fails when required Aura is unavailable', async () => {
  const config = {
    aura: { name: 'aura' },
    local: { name: 'local' },
  };
  await assert.rejects(
    () => collectBackupGraphs(config, 'both', async () => { throw new Error('Aura unavailable'); }),
    /Aura unavailable/
  );
});
